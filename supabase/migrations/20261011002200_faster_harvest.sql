-- The walk through Deezer (20261011002100_fair_pool.sql) goes faster:
-- 1. the server visits 50 artists a minute instead of 15 (about 100 Deezer calls: the players' boosters keep most of
--    the server's quota);
-- 2. the browsers help while the game is open and idle: the server hands each one the next artists of the walk
--    (harvest_take), the browser fetches their top tracks and related artists on Deezer with its own quota and
--    reports them (harvest_report). A browser can't choose the artists, only report on those it was given, and what it
--    reports is checked again when a card is drawn (it can't decide what anyone receives). Capped per player and day.

alter table public.harvest_artists add column if not exists claimed_at timestamptz;
alter table public.harvest_artists add column if not exists claimed_by uuid;

create function public.harvest_take(p_n int default 5) returns bigint[]
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int := least(greatest(coalesce(p_n, 0), 0), 10); ids bigint[];
begin
  if coalesce((select d.n from daily_counters d where d.owner = uid and d.day = game_day() and d.metric = 'harvest'), 0) + n > 3000 then
    return '{}';
  end if;
  with x as (
    select id from harvest_artists
    where done_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by fans desc limit n for update skip locked
  )
, u as (update harvest_artists h set claimed_at = now(), claimed_by = uid from x where h.id = x.id returning h.id)
  select array_agg(u.id) into ids from u;
  if ids is null then return '{}'; end if;
  perform bump(uid, 'harvest', cardinality(ids));
  return ids;
end $$;

-- p_tracks: the artist's top tracks [{id, rank}]; p_related: its related artists [{id, fans}]
create function public.harvest_report(p_artist bigint, p_tracks jsonb, p_related jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n int := 0;
begin
  update harvest_artists set done_at = now(), claimed_at = null, claimed_by = null
  where id = p_artist and claimed_by = uid and done_at is null;
  if not found then return 0; end if;                -- only the artists the server gave to this player
  insert into track_pool (id, tier, src)
  select (e ->> 'id')::bigint, tier_of(least((e ->> 'rank')::int, 1000000)), 'seen'
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_tracks) = 'array' then p_tracks else '[]' end) limit 100) t(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'rank') ~ '^\d{1,7}$' and (e ->> 'rank')::int >= 250000
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  insert into harvest_artists (id, fans)
  select (e ->> 'id')::bigint, least((e ->> 'fans')::bigint, 2000000000)::int
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_related) = 'array' then p_related else '[]' end) limit 50) r(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'fans') ~ '^\d{1,10}$' and (e ->> 'fans')::bigint >= 10000
  on conflict (id) do nothing;
  insert into artist_pool (id, tier)
  select (e ->> 'id')::bigint, cert_of(least((e ->> 'fans')::bigint, 2000000000)::int, (e ->> 'id')::bigint)
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_related) = 'array' then p_related else '[]' end) limit 50) r(e)
  where (e ->> 'id') ~ '^\d{1,12}$' and (e ->> 'fans') ~ '^\d{1,10}$' and (e ->> 'fans')::bigint >= 10000
  on conflict (id) do nothing;
  return n;
end $$;

-- the server's own steps skip the artists a browser is visiting
create or replace function public.pool_harvest_step(p_n int default 50) returns int
language plpgsql security definer set search_path = public as $$
declare ar harvest_artists; j jsonb; e jsonb; n int := 0;
begin
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

revoke execute on function public.pool_harvest_step(int) from public, anon, authenticated;
revoke execute on function public.harvest_take(int), public.harvest_report(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.harvest_take(int), public.harvest_report(bigint, jsonb, jsonb) to authenticated;

select cron.schedule('pool-harvest', '* * * * *', 'select public.pool_harvest_step(50)');
