-- Rarities are fixed for a season. During the season a track (or artist) keeps the rarity it had, for everybody: a
-- change seen on Deezer (by a booster or the walk) is only noted in next_tier. When a season ends, every noted change
-- is applied (rarity_switch_step, 20 000 a minute, then the draw numbers follow by themselves). A track found during
-- the season enters with its rarity of the moment. Cards already pulled keep the rarity they were pulled with.
-- A card drawn from the pool takes the rarity of the pool (the season's), not the one of the minute.

alter table public.track_pool add column if not exists next_tier smallint;
alter table public.artist_pool add column if not exists next_tier smallint;
create index if not exists track_pool_next on public.track_pool (id) where next_tier is not null;
create index if not exists artist_pool_next on public.artist_pool (id) where next_tier is not null;

create table if not exists public.rarity_switches (
  season_id int primary key references public.seasons,
  done_at timestamptz not null default now()
);
alter table public.rarity_switches enable row level security;
-- the seasons already over when this starts don't switch
insert into public.rarity_switches (season_id) select id from public.seasons where ends_at <= now() on conflict do nothing;

create or replace function public.rarity_switch_step(p_n int default 20000) returns int
language plpgsql security definer set search_path = public as $$
declare s int; n int; m int;
begin
  select id into s from seasons where ends_at <= now() and id not in (select season_id from rarity_switches) order by ends_at limit 1;
  if s is null then return 0; end if;
  update track_pool set tier = next_tier, next_tier = null
  where id in (select id from track_pool where next_tier is not null limit p_n);
  get diagnostics n = row_count;
  update artist_pool set tier = next_tier, next_tier = null
  where id in (select id from artist_pool where next_tier is not null limit p_n);
  get diagnostics m = row_count;
  if n + m = 0 then insert into rarity_switches (season_id) values (s) on conflict do nothing; end if;
  return n + m;
end $$;
revoke execute on function public.rarity_switch_step(int) from public, anon, authenticated;
select cron.schedule('rarity-switch', '* * * * *', 'select public.rarity_switch_step(20000)');

create or replace function public.pool_harvest_step(p_n int default 50) returns int
language plpgsql security definer set search_path = public as $$
declare ar harvest_artists; j jsonb; e jsonb; n int := 0; v bigint; pg int; low boolean;
begin
  for v in select id from artist_pool where tier = 5 and checked_at is null limit 5 loop
    j := deezer('artist/' || v);
    if j ->> 'error' is not null or j ->> 'id' is null then delete from artist_pool where id = v; continue; end if;
    update artist_pool set tier = cert_of(coalesce((j ->> 'nb_fan')::int, 0), v), checked_at = now() where id = v;
  end loop;
  if not exists (select 1 from harvest_artists where done_at is null) then
    update harvest_artists set done_at = null where done_at < now() - interval '30 days';
  end if;
  for ar in select * from harvest_artists
            where done_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')
            order by fans desc limit p_n for update skip locked loop
    -- all the artist's tracks down to Peu commune, page after page (a big artist has hundreds of Rares)
    for pg in 0..4 loop
      j := deezer('artist/' || ar.id || '/top?limit=100&index=' || pg * 100);
      low := false;
      for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
        if coalesce((e ->> 'rank')::int, 0) < 250000 then low := true; continue; end if;
        insert into track_pool (id, tier, src, checked_at)
        values ((e ->> 'id')::bigint, tier_of((e ->> 'rank')::int), 'seen', now())
        on conflict (id) do update set next_tier = nullif(excluded.tier, track_pool.tier), checked_at = now()
        where track_pool.next_tier is distinct from nullif(excluded.tier, track_pool.tier);
        n := n + 1;
      end loop;
      exit when low or jsonb_array_length(coalesce(j -> 'data', '[]')) < 100;
    end loop;
    j := deezer('artist/' || ar.id || '/related?limit=50');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      continue when coalesce((e ->> 'nb_fan')::int, 0) < 1000;
      insert into harvest_artists (id, fans) values ((e ->> 'id')::bigint, (e ->> 'nb_fan')::int)
      on conflict (id) do update set fans = excluded.fans
      where abs(harvest_artists.fans - excluded.fans) > greatest(harvest_artists.fans / 20, 1000);
      insert into artist_pool (id, tier, checked_at) values ((e ->> 'id')::bigint, cert_of((e ->> 'nb_fan')::int, (e ->> 'id')::bigint), now())
      on conflict (id) do update set next_tier = nullif(excluded.tier, artist_pool.tier), checked_at = now()
      where artist_pool.next_tier is distinct from nullif(excluded.tier, artist_pool.tier);
    end loop;
    update harvest_artists set done_at = now(), claimed_at = null, claimed_by = null where id = ar.id;
  end loop;
  return n;
end $$;
revoke execute on function public.pool_harvest_step(int) from public, anon, authenticated;

create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; v_tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
  want smallint; cand bigint; chosen bigint; tries int; used_t bigint[] := '{}'; used_a bigint[] := '{}'; g smallint; anchored boolean; pooled boolean;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 then raise exception 'need_five_tracks'; end if;

  for i in 1..5 loop
    is_artist := coalesce(pk.artist_slots[i], false);
    v_gifted := pk.gift_god or coalesce(i = pk.gift_slot, false);      -- offered by an admin (can be taken back)
    want := pk.slots[i];
    chosen := null; tries := 0; anchored := false; g := null; pooled := false;
    if is_artist then
      -- a Diamant: a number drawn in the Diamant list (it only has to still exist on Deezer)
      while want = 5 and chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := diamond_pick(uid, used_a);
        exit when cand is null;
        a := deezer('artist/' || cand);
        if a ->> 'error' is not null or a ->> 'id' is null then delete from diamond_artists where id = cand; continue; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        chosen := cand; anchored := true;
      end loop;
      -- the other certifications: the server's pick in the artist pool, checked on Deezer
      while want < 5 and chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := pool_pick_artist(uid, want, used_a);
        exit when cand is null;
        a := deezer('artist/' || cand);
        if a ->> 'error' is not null or a ->> 'id' is null then delete from artist_pool where id = cand; continue; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        -- its certification is the season's: a change is kept for the next season
        update artist_pool set next_tier = nullif(cert_of(r, cand), tier), checked_at = now()
        where id = cand and next_tier is distinct from nullif(cert_of(r, cand), tier);
        chosen := cand; pooled := true;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        if coalesce(p_tracks[i], 0) = 0 then raise exception 'need_proposals'; end if;
        chosen := p_tracks[i];
        a := deezer('artist/' || chosen);
        if a ->> 'error' is not null or a ->> 'id' is null then raise exception 'artist_not_found %', chosen; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        insert into artist_pool (id, tier, checked_at) values (chosen, cert_of(r, chosen), now())
        on conflict (id) do update set next_tier = nullif(excluded.tier, artist_pool.tier), checked_at = now();
      end if;
      used_a := used_a || chosen;
      v_tier := case when anchored or pooled then want else least(cert_of(r, chosen), want) end;
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Platine / Diamant only (or offered)
      insert into artists (id, name, picture, fans, nb_album, fetched_at)
      values (chosen, coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
              r, coalesce((a ->> 'nb_album')::int, 0), to_timestamp(0))      -- discography list still to fetch
      on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans, nb_album = excluded.nb_album
      where artists.name is distinct from excluded.name or artists.picture is distinct from excluded.picture
         or abs(artists.fans - excluded.fans) > greatest(artists.fans / 50, 100) or artists.nb_album is distinct from excluded.nb_album;
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
        -- a track already known (fresh, with its album): no need to ask Deezer for the album again
        select jsonb_build_object('cover_big', tr.cover), tr.genre into a, g from tracks tr
        where tr.id = cand and tr.updated_at > now() - interval '7 days' and tr.album_id is not null and tr.cover <> '' and tr.genre is not null;
        if not found then                          -- or its album is: its genre and cover are saved with it
          select jsonb_build_object('cover_big', al.cover), al.genre into a, g from albums al
          where al.id = (t -> 'album' ->> 'id')::bigint and al.genre is not null and al.cover <> '' and al.fetched_at > now() - interval '30 days';
        end if;
        if not found then
          a := deezer('album/' || (t -> 'album' ->> 'id'));
          g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        end if;
        -- its rarity is the season's: a change is kept for the next season
        update track_pool set next_tier = nullif(tier_of(r), tier), genre = g, checked_at = now()
        where id = cand and (next_tier is distinct from nullif(tier_of(r), tier) or genre is distinct from g);
        if pk.kind <> 'genre' or g = pk.genre then chosen := cand; pooled := true; end if;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        if coalesce(p_tracks[i], 0) = 0 then raise exception 'need_proposals'; end if;
        chosen := p_tracks[i];
        if chosen = any(used_t) then raise exception 'need_five_tracks'; end if;
        t := deezer('track/' || chosen);
        if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', chosen; end if;
        a := deezer('album/' || (t -> 'album' ->> 'id'));
        g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        r := coalesce((t ->> 'rank')::int, 0);
        insert into track_pool (id, tier, genre, src, checked_at)
        values (chosen, tier_of(r), type_of_genre(coalesce((a ->> 'genre_id')::int, -1)), 'seen', now())
        on conflict (id) do update set next_tier = nullif(excluded.tier, track_pool.tier), genre = excluded.genre, checked_at = now();
      end if;
      used_t := used_t || chosen;
      v_tier := case when pooled then want else least(tier_of(r), want) end;
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Mythique / Légendaire only (or offered)
      insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
      values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
              coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
              coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
              coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
              coalesce((t ->> 'explicit_lyrics')::boolean, false), g,
              (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
      on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
        cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
        explicit = excluded.explicit, genre = excluded.genre, album_id = excluded.album_id,
        artist_id = excluded.artist_id, updated_at = now()
      where tracks.updated_at < now() - interval '7 days' or tracks.album_id is null or tracks.cover = ''
         or tracks.genre is distinct from excluded.genre;
      if not exists (select 1 from albums al where al.id = (t -> 'album' ->> 'id')::bigint and al.fetched_at > now() - interval '7 days') then
        if a ? 'id' then perform save_album(a); end if;
      end if;
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
revoke execute on function public.finish_pack(uuid, bigint[]) from public, anon;
grant execute on function public.finish_pack(uuid, bigint[]) to authenticated;
