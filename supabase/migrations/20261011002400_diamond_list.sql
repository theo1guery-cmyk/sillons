-- The Diamant list: the Diamant artists are anchored in a list, each with its number. When the server rolls a Diamant
-- artist, it draws one number at random among the artists of the list the player doesn't own yet (all of them if the
-- player owns them all): exactly the same chance for each. An artist in the list stays Diamant even if its fans drop.
-- The list starts with the honour list and the artists of 7 M fans and more already known, and grows by itself: every
-- artist of 7 M fans and more that the SERVER checks on Deezer (its walk, or a draw) joins it. What browsers report is
-- not enough: the server's walk checks a few such reported artists each minute. An artist no longer on Deezer leaves the
-- list at the first draw that falls on it.
-- select num, id, name, fans from diamond_artists order by num;   -- the list

create table public.diamond_artists (
  num serial unique,
  id bigint primary key,
  added_at timestamptz not null default now()
);
alter table public.diamond_artists enable row level security;

insert into public.diamond_artists (id)
select x from unnest(array[4495513, 230, 525046, 148380152, 198, 8909272, 4429712, 5288900, 390, 1519461]::bigint[]) x
on conflict do nothing;
insert into public.diamond_artists (id) select id from public.artists where fans >= 7000000 order by fans desc on conflict do nothing;
insert into public.diamond_artists (id) select id from public.artist_pool where tier = 5 and checked_at is not null on conflict do nothing;

-- an artist the server checked at 7 M fans or more joins the list
create function public.on_artist_pool_diamond() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier = 5 and new.checked_at is not null then insert into diamond_artists (id) values (new.id) on conflict do nothing; end if;
  return new;
end $$;
create trigger artist_pool_diamond after insert or update of tier, checked_at on public.artist_pool
for each row execute function public.on_artist_pool_diamond();

-- the draw: a number at random among the Diamant the player doesn't own (or among all of them)
create function public.diamond_pick(p_uid uuid, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare n int; v bigint;
begin
  select count(*) into n from diamond_artists d where d.id <> all(coalesce(p_used, '{}'))
    and not exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = d.id);
  if n > 0 then
    select d.id into v from diamond_artists d where d.id <> all(coalesce(p_used, '{}'))
      and not exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = d.id)
    order by d.num offset floor(random() * n)::int limit 1;
    return v;
  end if;
  select count(*) into n from diamond_artists d where d.id <> all(coalesce(p_used, '{}'));
  if n = 0 then return null; end if;
  select d.id into v from diamond_artists d where d.id <> all(coalesce(p_used, '{}')) order by d.num offset floor(random() * n)::int limit 1;
  return v;
end $$;

create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; v_tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
  want smallint; cand bigint; chosen bigint; tries int; used_t bigint[] := '{}'; used_a bigint[] := '{}'; g smallint; anchored boolean;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 then raise exception 'need_five_tracks'; end if;

  for i in 1..5 loop
    is_artist := coalesce(pk.artist_slots[i], false);
    v_gifted := pk.gift_god or coalesce(i = pk.gift_slot, false);      -- offered by an admin (can be taken back)
    want := pk.slots[i];
    chosen := null; tries := 0; anchored := false;
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
      v_tier := case when anchored then 5 else least(cert_of(r, chosen), want) end;
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

-- the server's walk also checks, each minute, a few artists that browsers reported at 7 M fans or more
create or replace function public.pool_harvest_step(p_n int default 50) returns int
language plpgsql security definer set search_path = public as $$
declare ar harvest_artists; j jsonb; e jsonb; n int := 0; v bigint;
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
    j := deezer('artist/' || ar.id || '/top?limit=100');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      continue when coalesce((e ->> 'rank')::int, 0) < 250000;
      insert into track_pool (id, tier, src, checked_at)
      values ((e ->> 'id')::bigint, tier_of((e ->> 'rank')::int), 'seen', now())
      on conflict (id) do update set tier = excluded.tier, checked_at = now();
      n := n + 1;
    end loop;
    j := deezer('artist/' || ar.id || '/related?limit=50');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      continue when coalesce((e ->> 'nb_fan')::int, 0) < 10000;
      insert into harvest_artists (id, fans) values ((e ->> 'id')::bigint, (e ->> 'nb_fan')::int)
      on conflict (id) do update set fans = excluded.fans;
      insert into artist_pool (id, tier, checked_at) values ((e ->> 'id')::bigint, cert_of((e ->> 'nb_fan')::int, (e ->> 'id')::bigint), now())
      on conflict (id) do update set tier = excluded.tier, checked_at = now();
    end loop;
    update harvest_artists set done_at = now(), claimed_at = null, claimed_by = null where id = ar.id;
  end loop;
  return n;
end $$;

revoke execute on function public.diamond_pick(uuid, bigint[]), public.on_artist_pool_diamond(), public.pool_harvest_step(int)
  from public, anon, authenticated;
revoke execute on function public.finish_pack(uuid, bigint[]) from public, anon;
grant execute on function public.finish_pack(uuid, bigint[]) to authenticated;
