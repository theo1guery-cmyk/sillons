-- Platine artists (and the other certifications): an exact draw, like the Mythiques and Légendaires. The server counts
-- the artists of that certification in the pool that the player doesn't own yet and draws one number between 1 and
-- that count: exactly the same chance for each. A player who owns them all gets one of all of them (as for Diamant).
-- Diamant artists keep their own list (20261011002400_diamond_list.sql).
create or replace function public.pool_pick_artist(p_uid uuid, p_tier smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare n int; v bigint;
begin
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
