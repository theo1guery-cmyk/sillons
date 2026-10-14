-- Every card of a rarity has the same chance.
-- 1. An exact draw for Peu commune, Rare and Épique. Until now the server took the first track after a random point of
--    the pool's random order, so a track sitting after a big gap came more often. Now each track of a rarity has a
--    number (1, 2, 3… per rarity, like the Diamant list) and the server draws a number: exactly the same chance for
--    each. An owned track, or one of another genre in a genre booster, is drawn again (still equal chances among the
--    others). Communes keep the truly random Deezer numbers when there are enough, the pool otherwise; Mythiques and
--    Légendaires keep their exact draw.
-- 2. A complete catalogue. The walk through Deezer now keeps every track of an artist down to Peu commune (up to 500
--    a artist, instead of the top 100), and visits the artists from 1 000 fans (instead of 10 000). It starts a new
--    round now.
-- 3. Faster boosters: a track already known (fresh, with its album) no longer makes the server ask Deezer for its album.

alter table public.track_pool add column if not exists seq bigint;
create sequence if not exists public.track_pool_seq_0;
create sequence if not exists public.track_pool_seq_1;
create sequence if not exists public.track_pool_seq_2;
create sequence if not exists public.track_pool_seq_3;
create sequence if not exists public.track_pool_seq_4;
create sequence if not exists public.track_pool_seq_5;

-- The numbering of the tracks already in the pool runs in the background, 20 000 a minute (all at once ran past the
-- SQL editor's time limit). When it is done the job adds the index of the numbers and stops; until then the draws
-- keep the previous method.
create or replace function public.pool_number_step(p_n int default 20000) returns int
language plpgsql security definer set search_path = public as $$
declare t int; n int := 0; k int;
begin
  if to_regclass('public.track_pool_unnumbered') is null then
    create index track_pool_unnumbered on public.track_pool (tier) where seq is null;
  end if;
  for t in 0..5 loop
    exit when n >= p_n;
    update track_pool set seq = nextval('public.track_pool_seq_' || t)
    where id in (select id from track_pool where tier = t and seq is null limit p_n - n);
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  if n = 0 then
    create unique index if not exists track_pool_tier_seq on public.track_pool (tier, seq);
    drop index if exists public.track_pool_unnumbered;
    perform cron.unschedule('pool-number');
  end if;
  return n;
end $$;
revoke execute on function public.pool_number_step(int) from public, anon, authenticated;
select cron.schedule('pool-number', '* * * * *', 'select public.pool_number_step(20000)');

-- a new track, or one that changed rarity, takes the next number of its rarity
create or replace function public.track_pool_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.tier is distinct from old.tier then
    new.seq := nextval('public.track_pool_seq_' || new.tier);
  end if;
  return new;
end $$;
revoke execute on function public.track_pool_number() from public, anon, authenticated;
drop trigger if exists track_pool_number on public.track_pool;
create trigger track_pool_number before insert or update of tier on public.track_pool
  for each row execute function public.track_pool_number();

create or replace function public.pool_pick_track(p_uid uuid, p_tier smallint, p_genre smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint; g smallint; only_random boolean; n int; top bigint; k int; pick bigint;
begin
  if p_tier >= 4 then
    select count(*) into n from track_pool tp
    where tp.tier = p_tier and (p_genre is null or tp.genre = p_genre) and tp.id <> all(coalesce(p_used, '{}'));
    if n = 0 then return null; end if;
    select tp.id into v from track_pool tp
    where tp.tier = p_tier and (p_genre is null or tp.genre = p_genre) and tp.id <> all(coalesce(p_used, '{}'))
    order by tp.id offset floor(random() * n)::int limit 1;
    return v;
  end if;
  only_random := p_tier <= 1 and p_genre is null
    and exists (select 1 from track_pool where tier = p_tier and src = 'random' offset 299);
  if not only_random and to_regclass('public.track_pool_tier_seq') is not null then   -- numbering done
    -- a number drawn among the rarity's numbers; a hole, an owned track or another genre: draw again
    execute format('select last_value from public.track_pool_seq_%s', p_tier) into top;
    for k in 1..60 loop
      pick := 1 + floor(random() * top)::bigint;     -- drawn once, not row by row
      select tp.id, tp.genre into v, g from track_pool tp where tp.tier = p_tier and tp.seq = pick;
      continue when v is null or v = any(coalesce(p_used, '{}')) or (p_genre is not null and g is distinct from p_genre);
      continue when exists (select 1 from cards c where c.owner = p_uid and c.track_id = v);
      return v;
    end loop;
    v := null;
  end if;
  -- the random Deezer numbers for Communes and Peu communes (used once), or when the draws above found nothing
  for pass in 1..2 loop
    select tp.id into v from track_pool tp
    where tp.tier = p_tier and (p_genre is null or tp.genre = p_genre) and (not only_random or tp.src = 'random')
      and (case when pass = 1 then tp.rnd >= x else tp.rnd < x end)
      and tp.id <> all(coalesce(p_used, '{}'))
      and not exists (select 1 from cards c where c.owner = p_uid and c.track_id = tp.id)
    order by tp.rnd limit 1;
    exit when v is not null;
  end loop;
  if only_random and v is not null then delete from track_pool where id = v; end if;
  return v;
end $$;
revoke execute on function public.pool_pick_track(uuid, smallint, smallint, bigint[]) from public, anon, authenticated;

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
        on conflict (id) do update set tier = excluded.tier, checked_at = now() where track_pool.tier <> excluded.tier;
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
      on conflict (id) do update set tier = excluded.tier, checked_at = now() where artist_pool.tier <> excluded.tier;
    end loop;
    update harvest_artists set done_at = now(), claimed_at = null, claimed_by = null where id = ar.id;
  end loop;
  return n;
end $$;
revoke execute on function public.pool_harvest_step(int) from public, anon, authenticated;

-- a browser helping the walk reports the same: up to 500 tracks of the artist, related artists from 1 000 fans
create or replace function public.harvest_report(p_artist bigint, p_tracks jsonb, p_related jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int := 0;
begin
  update harvest_artists set done_at = now(), claimed_at = null, claimed_by = null
  where id = p_artist and claimed_by = uid and done_at is null;
  if not found then return 0; end if;                -- only the artists the server gave to this player
  insert into track_pool (id, tier, src)
  select (e ->> 'id')::bigint, tier_of(least((e ->> 'rank')::int, 1000000)), 'seen'
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_tracks) = 'array' then p_tracks else '[]' end) limit 500) t(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'rank') ~ '^\d{1,7}$' and (e ->> 'rank')::int >= 250000
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  insert into harvest_artists (id, fans)
  select (e ->> 'id')::bigint, least((e ->> 'fans')::bigint, 2000000000)::int
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_related) = 'array' then p_related else '[]' end) limit 50) r(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'fans') ~ '^\d{1,10}$' and (e ->> 'fans')::bigint >= 1000
  on conflict (id) do nothing;
  insert into artist_pool (id, tier)
  select (e ->> 'id')::bigint, cert_of(least((e ->> 'fans')::bigint, 2000000000)::int, (e ->> 'id')::bigint)
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_related) = 'array' then p_related else '[]' end) limit 50) r(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'fans') ~ '^\d{1,10}$' and (e ->> 'fans')::bigint >= 1000
  on conflict (id) do nothing;
  return n;
end $$;
revoke execute on function public.harvest_report(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.harvest_report(bigint, jsonb, jsonb) to authenticated;

-- the artists known from 1 000 fans join the walk, which starts a new round
insert into public.harvest_artists (id, fans) select id, fans from public.artists where fans >= 1000 on conflict do nothing;
update public.harvest_artists set done_at = null, claimed_at = null, claimed_by = null;

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
    chosen := null; tries := 0; anchored := false; g := null;
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
        update artist_pool set tier = cert_of(r, cand), checked_at = now() where id = cand and tier <> cert_of(r, cand);
        if cert_of(r, cand) = want then chosen := cand; end if;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        if coalesce(p_tracks[i], 0) = 0 then raise exception 'need_proposals'; end if;
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
        if not found then
          a := deezer('album/' || (t -> 'album' ->> 'id'));
          g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        end if;
        update track_pool set tier = tier_of(r), genre = g, rnd = case when want < 4 then random() else rnd end, checked_at = now()
        where id = cand and (want < 4 or tier <> tier_of(r) or genre is distinct from g);
        if tier_of(r) = want and (pk.kind <> 'genre' or g = pk.genre) then chosen := cand; end if;
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
