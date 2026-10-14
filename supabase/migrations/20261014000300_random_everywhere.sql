-- The most equal chances at every rarity.
-- Communes, Peu communes and the Démo / Single artists come from random Deezer numbers: the server draws a number
-- between 1 and the highest known one and keeps what is there, so every Deezer track (or artist), famous or known by
-- twelve people, has exactly the same chance to be found. Those found are numbered by rarity (track_random,
-- artist_random) and a booster draws one of these numbers. They are no longer used up: the stock only grows, and
-- each draw stays equal between all of Deezer's tracks of that rarity.
-- The server now looks numbers up itself every minute (50 tracks, 10 artists), on top of the players' browsers.
-- Rare to Légendaire and Argent to Diamant keep the exact draw over the complete catalogue of the walk.

create sequence if not exists public.track_random_seq_0;
create sequence if not exists public.track_random_seq_1;
create sequence if not exists public.artist_random_seq_0;
create sequence if not exists public.artist_random_seq_1;

create table if not exists public.track_random (
  id bigint primary key references public.track_pool on delete cascade,
  tier smallint not null,
  seq bigint not null,
  unique (tier, seq)
);
alter table public.track_random enable row level security;
alter table public.artist_pool add column if not exists src text not null default 'seen';
create table if not exists public.artist_random (
  id bigint primary key references public.artist_pool on delete cascade,
  tier smallint not null,
  seq bigint not null,
  unique (tier, seq)
);
alter table public.artist_random enable row level security;

-- a random find of rarity 0 or 1 gets the next number of its rarity; a change of rarity takes it out (or renumbers it)
create or replace function public.random_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'track_pool' then
    if tg_op = 'UPDATE' and old.tier is distinct from new.tier then delete from track_random where id = new.id; end if;
    if new.src = 'random' and new.tier <= 1 then
      insert into track_random (id, tier, seq) values (new.id, new.tier, nextval('public.track_random_seq_' || new.tier))
      on conflict (id) do nothing;
    end if;
  else
    if tg_op = 'UPDATE' and old.tier is distinct from new.tier then delete from artist_random where id = new.id; end if;
    if new.src = 'random' and new.tier <= 1 then
      insert into artist_random (id, tier, seq) values (new.id, new.tier, nextval('public.artist_random_seq_' || new.tier))
      on conflict (id) do nothing;
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.random_sync() from public, anon, authenticated;
drop trigger if exists track_random_sync on public.track_pool;
create trigger track_random_sync after insert or update of src, tier on public.track_pool
  for each row execute function public.random_sync();
drop trigger if exists artist_random_sync on public.artist_pool;
create trigger artist_random_sync after insert or update of src, tier on public.artist_pool
  for each row execute function public.random_sync();

-- the random finds already there
insert into public.track_random (id, tier, seq)
select id, tier, nextval('public.track_random_seq_' || tier) from public.track_pool where src = 'random' and tier <= 1
on conflict (id) do nothing;

-- the server's own random numbers, every minute
create or replace function public.pool_random_step(p_tracks int default 50, p_artists int default 10) returns int
language plpgsql security definer set search_path = public as $$
declare top bigint; v bigint; j jsonb; n int := 0; k int;
begin
  top := greatest(coalesce((select max(id) from track_pool), 0), 3000000000);
  for k in 1..p_tracks loop
    v := 1 + floor(random() * top)::bigint;
    j := deezer('track/' || v);
    continue when j ->> 'id' is null or j ->> 'error' is not null or not coalesce((j ->> 'readable')::boolean, true)
               or coalesce(j ->> 'preview', '') = '';
    insert into track_pool (id, tier, src) values (v, tier_of(least(coalesce((j ->> 'rank')::int, 0), 1000000)), 'random')
    on conflict (id) do update set src = 'random' where track_pool.src <> 'random';
    n := n + 1;
  end loop;
  top := greatest(coalesce((select max(id) from artist_pool), 0), 200000000);
  for k in 1..p_artists loop
    v := 1 + floor(random() * top)::bigint;
    j := deezer('artist/' || v);
    continue when j ->> 'id' is null or j ->> 'error' is not null or coalesce((j ->> 'nb_album')::int, 0) = 0;
    insert into artist_pool (id, tier, src, checked_at) values (v, cert_of(coalesce((j ->> 'nb_fan')::int, 0), v), 'random', now())
    on conflict (id) do update set src = 'random' where artist_pool.src <> 'random';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.pool_random_step(int, int) from public, anon, authenticated;
select cron.schedule('pool-random', '* * * * *', 'select public.pool_random_step(50, 10)');

create or replace function public.pool_pick_track(p_uid uuid, p_tier smallint, p_genre smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint; g smallint; only_random boolean := false; n int; top bigint; k int; pick bigint;
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
  -- Communes and Peu communes: a track among those found by a random Deezer number (each Deezer track had the same
  -- chance to be found), once there are enough of them; a genre booster needs the genre, so it uses the numbered pool
  if p_tier <= 1 and p_genre is null then
    execute format('select last_value from public.track_random_seq_%s', p_tier) into top;
    if top >= 500 then
      for k in 1..60 loop
        pick := 1 + floor(random() * top)::bigint;
        select r.id into v from track_random r where r.tier = p_tier and r.seq = pick;
        continue when v is null or v = any(coalesce(p_used, '{}'));
        continue when exists (select 1 from cards c where c.owner = p_uid and c.track_id = v);
        return v;
      end loop;
      v := null;
    end if;
  end if;
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
  -- when the draws above found nothing
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

create or replace function public.pool_pick_artist(p_uid uuid, p_tier smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare n int; v bigint; top bigint; k int; pick bigint;
begin
  -- Démo and Single: an artist found by a random Deezer number (the small artists, all of them, with the same chance)
  if p_tier <= 1 then
    execute format('select last_value from public.artist_random_seq_%s', p_tier) into top;
    if top >= 300 then
      for k in 1..60 loop
        pick := 1 + floor(random() * top)::bigint;
        select r.id into v from artist_random r where r.tier = p_tier and r.seq = pick;
        continue when v is null or v = any(coalesce(p_used, '{}'));
        continue when exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = v);
        return v;
      end loop;
      v := null;
    end if;
  end if;
  select count(*) into n from artist_pool ap
  where ap.tier = p_tier and ap.id <> all(coalesce(p_used, '{}'))
    and not exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = ap.id);
  if n > 0 then
    select ap.id into v from artist_pool ap
    where ap.tier = p_tier and ap.id <> all(coalesce(p_used, '{}'))
      and not exists (select 1 from cards c where c.owner = p_uid and c.kind = 'artist' and c.artist_id = ap.id)
    order by ap.id offset floor(random() * n)::int limit 1;
    return v;
  end if;
  select count(*) into n from artist_pool ap where ap.tier = p_tier and ap.id <> all(coalesce(p_used, '{}'));
  if n = 0 then return null; end if;
  select ap.id into v from artist_pool ap where ap.tier = p_tier and ap.id <> all(coalesce(p_used, '{}'))
  order by ap.id offset floor(random() * n)::int limit 1;
  return v;
end $$;
revoke execute on function public.pool_pick_artist(uuid, smallint, bigint[]) from public, anon, authenticated;
