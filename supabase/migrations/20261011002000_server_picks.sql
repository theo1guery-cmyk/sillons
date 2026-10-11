-- The server picks the tracks and artists of a booster (security audit: the browser chose them, so a player could put
-- the most wanted Légendaire in a Légendaire slot, or complete albums and discographies on purpose).
-- The rarities are rolled exactly as before (start_pack); only WHICH card fills a slot changes.
--
-- track_pool / artist_pool: every track and artist known to the game, with its rarity. Filled by
--   * the cards already pulled (seeded below), and every card the server checks on Deezer;
--   * the tracks and artists the browsers find while exploring Deezer (pool_offer), including the random track
--     numbers they try in the background (src 'random': a true random draw over the whole catalogue).
-- A slot takes a random entry of its rarity (and genre for a genre pack) that the player doesn't own yet (Commune to
-- Épique; Mythique and Légendaire can come back), then the server checks it on Deezer: wrong rarity or genre, gone,
-- or not playable, the entry is corrected and another one is tried. Each entry gets a new random position once
-- drawn, so over time every entry of a rarity has the same chance. Communes and Peu communes come from the random
-- numbers only once there are enough of them. If the pool has nothing that fits, the browser's proposal is used,
-- checked as before.
-- What a browser offers is not trusted: it only places an entry in the pool, and the entry is checked when drawn.
-- Offers are capped per player and per day.

create table public.track_pool (
  id bigint primary key,
  tier smallint not null,
  genre smallint,                                   -- type_of_genre(), null when unknown
  src text not null default 'seen',                 -- 'card' (pulled), 'seen' (found by a browser), 'random' (random number)
  rnd double precision not null default random(),
  checked_at timestamptz
);
create index track_pool_tier on public.track_pool (tier, rnd);
create index track_pool_genre on public.track_pool (tier, genre, rnd);
create index track_pool_src on public.track_pool (tier, src, rnd);
alter table public.track_pool enable row level security;

create table public.artist_pool (
  id bigint primary key,
  tier smallint not null,
  rnd double precision not null default random(),
  checked_at timestamptz
);
create index artist_pool_tier on public.artist_pool (tier, rnd);
alter table public.artist_pool enable row level security;

-- seed: the tracks and artists already pulled, with their last known rank / fans
insert into public.track_pool (id, tier, genre, src, checked_at)
select x.track_id, tier_of(x.rank), t.genre, 'card', now()
from (select distinct on (track_id) track_id, rank from public.cards where track_id is not null order by track_id, pulled_at desc) x
join public.tracks t on t.id = x.track_id
on conflict (id) do nothing;
insert into public.artist_pool (id, tier, checked_at)
select a.id, cert_of(a.fans, a.id), now() from public.artists a where a.fans > 0
on conflict (id) do nothing;

-- ---------------------------------------------------------------- browsers offer what they found
-- p_tracks: [{id, rank, g (genre index, optional), r (true: random number)}]; p_artists: [{id, fans}]
create function public.pool_offer(p_tracks jsonb default '[]', p_artists jsonb default '[]') returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int; done int; added int := 0;
begin
  n := coalesce(jsonb_array_length(p_tracks), 0) + coalesce(jsonb_array_length(p_artists), 0);
  if n = 0 then return 0; end if;
  if n > 300 then raise exception 'too_many'; end if;
  done := coalesce((select d.n from daily_counters d where d.owner = uid and d.day = game_day() and d.metric = 'pool'), 0);
  if done + n > 3000 then return 0; end if;          -- enough for today
  perform bump(uid, 'pool', n);
  insert into track_pool (id, tier, genre, src)
  select (e ->> 'id')::bigint, tier_of(least(greatest(coalesce((e ->> 'rank')::int, 0), 0), 1000000)),
         case when (e ->> 'g') ~ '^\d+$' and (e ->> 'g')::int between 0 and 10 then (e ->> 'g')::int end,
         case when (e ->> 'r') = 'true' then 'random' else 'seen' end
  from jsonb_array_elements(p_tracks) e
  where (e ->> 'id') ~ '^\d{1,12}$'
  on conflict (id) do nothing;
  get diagnostics added = row_count;
  insert into artist_pool (id, tier)
  select (e ->> 'id')::bigint, cert_of(least(greatest(coalesce((e ->> 'fans')::int, 0), 0), 2000000000), (e ->> 'id')::bigint)
  from jsonb_array_elements(p_artists) e
  where (e ->> 'id') ~ '^\d{1,12}$'
  on conflict (id) do nothing;
  return added;
end $$;

-- ---------------------------------------------------------------- the draw
-- a random entry of that rarity (and genre), not owned yet (up to Épique), not already in this booster
create function public.pool_pick_track(p_uid uuid, p_tier smallint, p_genre smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint; only_random boolean;
begin
  -- Communes and Peu communes: from the random numbers (the whole catalogue) once there are enough of them
  only_random := p_tier <= 1 and p_genre is null
    and exists (select 1 from track_pool where tier = p_tier and src = 'random' offset 299);
  for pass in 1..2 loop
    select tp.id into v from track_pool tp
    where tp.tier = p_tier and (p_genre is null or tp.genre = p_genre) and (not only_random or tp.src = 'random')
      and (case when pass = 1 then tp.rnd >= x else tp.rnd < x end)
      and tp.id <> all(coalesce(p_used, '{}'))
      and (p_tier >= 4 or not exists (select 1 from cards c where c.owner = p_uid and c.track_id = tp.id))
    order by tp.rnd limit 1;
    exit when v is not null;
  end loop;
  return v;
end $$;

create function public.pool_pick_artist(p_uid uuid, p_tier smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint;
begin
  for pass in 1..2 loop
    select ap.id into v from artist_pool ap
    where ap.tier = p_tier and (case when pass = 1 then ap.rnd >= x else ap.rnd < x end)
      and ap.id <> all(coalesce(p_used, '{}'))
      and not exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = ap.id)
    order by ap.rnd limit 1;
    exit when v is not null;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------- finish_pack: the server's own cards
-- p_tracks: the browser's proposals, used only when the pool has nothing for a slot (checked on Deezer as before)
create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; v_tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
  want smallint; cand bigint; chosen bigint; tries int; used_t bigint[] := '{}'; used_a bigint[] := '{}'; g smallint;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 then raise exception 'need_five_tracks'; end if;

  for i in 1..5 loop
    is_artist := coalesce(pk.artist_slots[i], false);
    v_gifted := pk.gift_god or coalesce(i = pk.gift_slot, false);      -- offered by an admin (can be taken back)
    want := pk.slots[i];
    chosen := null; tries := 0;
    if is_artist then
      -- the server's pick, checked on Deezer
      while chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := pool_pick_artist(uid, want, used_a);
        exit when cand is null;
        a := deezer('artist/' || cand);
        if a ->> 'error' is not null or a ->> 'id' is null then delete from artist_pool where id = cand; continue; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        update artist_pool set tier = cert_of(r, cand), rnd = random(), checked_at = now() where id = cand;
        if cert_of(r, cand) = want then chosen := cand; end if;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        chosen := p_tracks[i];
        a := deezer('artist/' || chosen);
        if a ->> 'error' is not null or a ->> 'id' is null then raise exception 'artist_not_found %', chosen; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        insert into artist_pool (id, tier, checked_at) values (chosen, cert_of(r, chosen), now())
        on conflict (id) do update set tier = excluded.tier, checked_at = now();
      end if;
      used_a := used_a || chosen;
      v_tier := least(cert_of(r, chosen), want);
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Platine / Diamant only (or offered)
      insert into artists (id, name, picture, fans, nb_album, fetched_at)
      values (chosen, coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
              r, coalesce((a ->> 'nb_album')::int, 0), to_timestamp(0))      -- discography list still to fetch
      on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans, nb_album = excluded.nb_album;
      was_owned := exists (select 1 from cards where owner = uid and kind = 'artist' and artist_id = chosen);
      insert into cards (owner, kind, artist_id, tier, rank, holo, source, gifted)
      values (uid, 'artist', chosen, v_tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
      returning id into card_id;
    else
      while chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := pool_pick_track(uid, want, case when pk.kind = 'genre' then pk.genre end, used_t);
        exit when cand is null;
        t := deezer('track/' || cand);
        if t ->> 'error' is not null or t ->> 'id' is null or not coalesce((t ->> 'readable')::boolean, true)
           or coalesce(t ->> 'preview', '') = '' then
          delete from track_pool where id = cand; continue;
        end if;
        r := coalesce((t ->> 'rank')::int, 0);
        a := deezer('album/' || (t -> 'album' ->> 'id'));
        g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        update track_pool set tier = tier_of(r), genre = g, rnd = random(), checked_at = now() where id = cand;
        if tier_of(r) = want and (pk.kind <> 'genre' or g = pk.genre) then chosen := cand; end if;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        chosen := p_tracks[i];
        if chosen = any(used_t) then raise exception 'need_five_tracks'; end if;
        t := deezer('track/' || chosen);
        if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', chosen; end if;
        a := deezer('album/' || (t -> 'album' ->> 'id'));
        r := coalesce((t ->> 'rank')::int, 0);
        insert into track_pool (id, tier, genre, src, checked_at)
        values (chosen, tier_of(r), type_of_genre(coalesce((a ->> 'genre_id')::int, -1)), 'seen', now())
        on conflict (id) do update set tier = excluded.tier, genre = excluded.genre, checked_at = now();
      end if;
      used_t := used_t || chosen;
      v_tier := least(tier_of(r), want);
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Mythique / Légendaire only (or offered)
      insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
      values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
              coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
              coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
              coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
              coalesce((t ->> 'explicit_lyrics')::boolean, false), type_of_genre(coalesce((a ->> 'genre_id')::int, -1)),
              (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
      on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
        cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
        explicit = excluded.explicit, genre = excluded.genre, album_id = excluded.album_id,
        artist_id = excluded.artist_id, updated_at = now();
      perform save_album(a);
      was_owned := exists (select 1 from cards where owner = uid and track_id = chosen);
      insert into cards (owner, track_id, tier, rank, holo, source, gifted)
      values (uid, chosen, v_tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
      returning id into card_id;
    end if;
    top := greatest(top, v_tier);
    out := out || jsonb_build_object('card', card_id, 'kind', case when is_artist then 'artist' else 'track' end,
                                     'track', chosen, 'tier', v_tier, 'rank', r,
                                     'holo', holo, 'new', not was_owned, 'wanted', want);
  end loop;

  update packs set done = true where id = pk.id;
  update profiles set opened = opened + 1,
                      dry = case when top >= 4 then 0 else dry + 1 end,
                      gods = gods + case when pk.god then 1 else 0 end
  where id = uid;
  return out;
end $$;

-- ---------------------------------------------------------------- filling the top of the pool
-- Run from the SQL editor (select pool_harvest();): the Deezer charts (all and by genre) and the top tracks of the
-- chart's artists, so the Mythiques and Légendaires are nearly all in the pool from the start. Safe to run again.
create function public.pool_harvest(p_artists int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare j jsonb; e jsonb; g int; n int := 0; arts bigint[] := '{}'; ar bigint;
begin
  foreach g in array array[0, 116, 132, 152, 85, 464, 106, 113, 165, 169, 52, 129, 153, 197, 122, 75] loop
    j := deezer('chart/' || g || '/tracks?limit=100');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      insert into track_pool (id, tier, genre, src, checked_at)
      values ((e ->> 'id')::bigint, tier_of(coalesce((e ->> 'rank')::int, 0)), case when g > 0 then type_of_genre(g) end, 'seen', now())
      on conflict (id) do update set tier = excluded.tier, genre = coalesce(excluded.genre, track_pool.genre), checked_at = now();
      n := n + 1;
      ar := (e -> 'artist' ->> 'id')::bigint;
      if ar is not null and not ar = any(arts) then arts := arts || ar; end if;
    end loop;
  end loop;
  foreach ar in array arts[1:p_artists] loop
    j := deezer('artist/' || ar || '/top?limit=50');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      insert into track_pool (id, tier, src, checked_at)
      values ((e ->> 'id')::bigint, tier_of(coalesce((e ->> 'rank')::int, 0)), 'seen', now())
      on conflict (id) do update set tier = excluded.tier, checked_at = now();
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.pool_harvest(int) from public, anon, authenticated;

revoke execute on function public.pool_pick_track(uuid, smallint, smallint, bigint[]), public.pool_pick_artist(uuid, smallint, bigint[])
  from public, anon, authenticated;
revoke execute on function public.pool_offer(jsonb, jsonb), public.finish_pack(uuid, bigint[]) from public, anon;
grant execute on function public.pool_offer(jsonb, jsonb), public.finish_pack(uuid, bigint[]) to authenticated;
