-- Mythique and Légendaire tracks: an exact draw, like the Diamant list. The server counts the entries of the pool of
-- that rarity (and genre for a genre pack) and draws one number between 1 and that count: exactly the same chance for
-- each, from the first draw (the random positions of 20261011002000_server_picks.sql were only equal on average).
-- Mythiques and Légendaires can come back, as before. Communes to Épiques are unchanged.
create or replace function public.pool_pick_track(p_uid uuid, p_tier smallint, p_genre smallint, p_used bigint[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare x double precision := random(); v bigint; only_random boolean; n int;
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
