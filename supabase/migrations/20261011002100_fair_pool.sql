-- Every track gets its chance, not only those someone already came across (20261011002000_server_picks.sql).
-- 1. Communes and Peu communes: the SERVER draws random Deezer track numbers (pool_probe_ids) and the browsers only
--    look them up and report (pool_probe_report): a browser can't choose which numbers enter the pool, only report
--    on the ones it was given (and what it reports is checked again when the card is drawn). Such an entry is used
--    once and removed: a Commune is a fresh random number of the whole catalogue each time.
--    pool_offer() no longer accepts entries marked random.
-- 2. Rare and above: the server walks Deezer by itself, artist after artist (most fans first, then their related
--    artists), and stores their top tracks: pool_harvest_step(), run every minute by pg_cron. The Mythiques and
--    Légendaires (popular artists' tracks) are nearly all found in the first days, then the walk goes on with smaller
--    artists, and starts again every 30 days to follow the charts.

-- ---------------------------------------------------------------- 1. random numbers drawn by the server
create table public.pool_probes (
  owner uuid not null references public.profiles on delete cascade,
  id bigint not null,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);
alter table public.pool_probes enable row level security;

create function public.pool_probe_ids(p_n int default 40) returns bigint[]
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int := least(greatest(coalesce(p_n, 0), 0), 50); top bigint; ids bigint[];
begin
  if coalesce((select d.n from daily_counters d where d.owner = uid and d.day = game_day() and d.metric = 'probe'), 0) + n > 5000 then
    return '{}';
  end if;
  perform bump(uid, 'probe', n);
  delete from pool_probes where owner = uid and created_at < now() - interval '1 hour';
  top := greatest(coalesce((select max(id) from track_pool), 0), 3000000000);   -- the newest track numbers
  select array_agg(1 + floor(random() * top)::bigint) into ids from generate_series(1, n);
  insert into pool_probes (owner, id) select uid, x from unnest(ids) x on conflict do nothing;
  return ids;
end $$;

-- p: [{id, rank}] for the numbers that are a playable track, [{id}] for the others
create function public.pool_probe_report(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); e jsonb; v bigint; added int := 0;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 100 then raise exception 'too_many'; end if;
  for e in select * from jsonb_array_elements(p) loop
    continue when (e ->> 'id') !~ '^\d{1,12}$';
    v := (e ->> 'id')::bigint;
    delete from pool_probes where owner = uid and id = v;
    continue when not found;                       -- only the numbers the server gave to this player
    if (e ->> 'rank') ~ '^\d{1,7}$' then
      insert into track_pool (id, tier, src) values (v, tier_of(least((e ->> 'rank')::int, 1000000)), 'random')
      on conflict (id) do update set src = 'random';
      added := added + 1;
    end if;
  end loop;
  return added;
end $$;

-- browsers may still offer what they find while exploring, never as random numbers
create or replace function public.pool_offer(p_tracks jsonb default '[]', p_artists jsonb default '[]') returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int; done int; added int := 0;
begin
  n := coalesce(jsonb_array_length(p_tracks), 0) + coalesce(jsonb_array_length(p_artists), 0);
  if n = 0 then return 0; end if;
  if n > 300 then raise exception 'too_many'; end if;
  done := coalesce((select d.n from daily_counters d where d.owner = uid and d.day = game_day() and d.metric = 'pool'), 0);
  if done + n > 3000 then return 0; end if;
  perform bump(uid, 'pool', n);
  insert into track_pool (id, tier, src)
  select (e ->> 'id')::bigint, tier_of(least(greatest(coalesce((e ->> 'rank')::int, 0), 0), 1000000)), 'seen'
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

-- Communes and Peu communes drawn from the random numbers are used once
create or replace function public.pool_pick_track(p_uid uuid, p_tier smallint, p_genre smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint; only_random boolean;
begin
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
  if only_random and v is not null then delete from track_pool where id = v; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- 2. the server's walk through Deezer
create table public.harvest_artists (
  id bigint primary key,
  fans int not null default 0,
  done_at timestamptz
);
create index harvest_artists_todo on public.harvest_artists (fans desc) where done_at is null;
alter table public.harvest_artists enable row level security;

insert into public.harvest_artists (id, fans) select id, fans from public.artists where fans >= 10000 on conflict do nothing;

create function public.pool_harvest_step(p_n int default 15) returns int
language plpgsql security definer set search_path = public as $$
declare ar harvest_artists; j jsonb; e jsonb; n int := 0;
begin
  -- the walk is over: start again with the artists not seen for 30 days
  if not exists (select 1 from harvest_artists where done_at is null) then
    update harvest_artists set done_at = null where done_at < now() - interval '30 days';
  end if;
  for ar in select * from harvest_artists where done_at is null order by fans desc limit p_n for update skip locked loop
    j := deezer('artist/' || ar.id || '/top?limit=100');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      continue when coalesce((e ->> 'rank')::int, 0) < 250000;     -- Peu commune and above (Communes: random numbers)
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
    update harvest_artists set done_at = now() where id = ar.id;
  end loop;
  return n;
end $$;

-- the charts also bring their artists into the walk
create or replace function public.pool_harvest(p_artists int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare j jsonb; e jsonb; g int; n int := 0;
begin
  foreach g in array array[0, 116, 132, 152, 85, 464, 106, 113, 165, 169, 52, 129, 153, 197, 122, 75] loop
    j := deezer('chart/' || g || '/tracks?limit=100');
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      insert into track_pool (id, tier, genre, src, checked_at)
      values ((e ->> 'id')::bigint, tier_of(coalesce((e ->> 'rank')::int, 0)), case when g > 0 then type_of_genre(g) end, 'seen', now())
      on conflict (id) do update set tier = excluded.tier, genre = coalesce(excluded.genre, track_pool.genre), checked_at = now();
      insert into harvest_artists (id) values ((e -> 'artist' ->> 'id')::bigint) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  update harvest_artists set fans = 100000000 where fans = 0;     -- chart artists first in the walk
  return n + pool_harvest_step(least(greatest(p_artists, 0), 100));
end $$;

revoke execute on function public.pool_harvest_step(int), public.pool_harvest(int) from public, anon, authenticated;
revoke execute on function public.pool_probe_ids(int), public.pool_probe_report(jsonb), public.pool_offer(jsonb, jsonb),
  public.pool_pick_track(uuid, smallint, smallint, bigint[]) from public, anon;
revoke execute on function public.pool_pick_track(uuid, smallint, smallint, bigint[]) from authenticated;
grant execute on function public.pool_probe_ids(int), public.pool_probe_report(jsonb), public.pool_offer(jsonb, jsonb) to authenticated;

-- every minute: 15 artists of the walk (about 30 Deezer calls)
create extension if not exists pg_cron;
select cron.schedule('pool-harvest', '* * * * *', 'select public.pool_harvest_step(15)');
