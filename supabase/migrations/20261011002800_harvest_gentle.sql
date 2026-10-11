-- The walk through Deezer (pg_cron, 20261011002200_faster_harvest.sql) slowed the whole game down: 50 artists a minute
-- = about 100 Deezer calls, made one after the other inside the database, each holding a connection while it waits, and
-- deezer() sleeps and retries when Deezer says "quota". A run could last more than a minute, so runs piled up, took the
-- database's connections (slow logins) and spent the server's Deezer quota that boosters need (slow packs).
-- Now: one run at a time (advisory lock), 8 artists every 3 minutes, a short timeout and no retry for the walk, and the
-- run stops at the first quota error. The browsers' help (harvest_take / harvest_report) does most of the walk anyway,
-- with their own Deezer quota.

-- a Deezer call for background work: 3 s at most, no retry, null when it fails
create or replace function public.deezer_quick(path text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j jsonb;
begin
  begin perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '3000'); exception when others then null; end;
  select content::jsonb into j from extensions.http_get('https://api.deezer.com/' || path);
  return j;
exception when others then return null;
end $$;

create or replace function public.pool_harvest_step(p_n int default 8) returns int
language plpgsql security definer set search_path = public as $$
declare ar harvest_artists; j jsonb; e jsonb; n int := 0; v bigint;
begin
  if not pg_try_advisory_xact_lock(724501) then return 0; end if;   -- a run is already going
  for v in select id from artist_pool where tier = 5 and checked_at is null limit 2 loop
    j := deezer_quick('artist/' || v);
    exit when j is null or (j -> 'error' ->> 'code') = '4';
    if j ->> 'error' is not null or j ->> 'id' is null then delete from artist_pool where id = v; continue; end if;
    update artist_pool set tier = cert_of(coalesce((j ->> 'nb_fan')::int, 0), v), checked_at = now() where id = v;
  end loop;
  if not exists (select 1 from harvest_artists where done_at is null) then
    update harvest_artists set done_at = null where done_at < now() - interval '30 days';
  end if;
  for ar in select * from harvest_artists
            where done_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')
            order by fans desc limit least(greatest(p_n, 0), 20) for update skip locked loop
    j := deezer_quick('artist/' || ar.id || '/top?limit=100');
    exit when j is null or (j -> 'error' ->> 'code') = '4';           -- Deezer is slow or says "quota": stop for now
    for e in select * from jsonb_array_elements(coalesce(j -> 'data', '[]')) loop
      continue when coalesce((e ->> 'rank')::int, 0) < 250000;
      insert into track_pool (id, tier, src, checked_at)
      values ((e ->> 'id')::bigint, tier_of((e ->> 'rank')::int), 'seen', now())
      on conflict (id) do update set tier = excluded.tier, checked_at = now();
      n := n + 1;
    end loop;
    j := deezer_quick('artist/' || ar.id || '/related?limit=50');
    exit when j is null or (j -> 'error' ->> 'code') = '4';
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

revoke execute on function public.deezer_quick(text), public.pool_harvest_step(int) from public, anon, authenticated;

select cron.schedule('pool-harvest', '*/3 * * * *', 'select public.pool_harvest_step(8)');
