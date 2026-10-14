-- Buying tiers of the pass with Vinyles is back (as before). Buying the missing cards of an album with Vinyles is
-- gone: a card is pulled, traded or bought on the market, never bought from the game.

create or replace function public.buy_season_tiers(p_count int) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); p season_progress; t int; bal int; price int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  insert into season_progress (owner, season_id) values (uid, s.id) on conflict do nothing;
  select * into p from season_progress where owner = uid and season_id = s.id for update;
  t := p.xp / s.xp_per_tier;
  if t >= s.tiers then raise exception 'max_tier'; end if;
  if p_count < 1 or t + p_count > s.tiers then raise exception 'bad_amount'; end if;
  price := tiers_price(p_count);
  select vinyls into bal from profiles where id = uid for update;
  if bal < price then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -price, 'Pass saisonnier : ' || p_count || ' palier' || case when p_count > 1 then 's' else '' end);
  update season_progress set xp = (t + p_count) * s.xp_per_tier where owner = uid and season_id = s.id;
  return t + p_count;
end $$;

create or replace function public.buy_album_track(p_album bigint, p_track bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'album_buy_closed';
end $$;

revoke execute on function public.buy_season_tiers(int), public.buy_album_track(bigint, bigint) from public, anon;
grant execute on function public.buy_season_tiers(int), public.buy_album_track(bigint, bigint) to authenticated;
