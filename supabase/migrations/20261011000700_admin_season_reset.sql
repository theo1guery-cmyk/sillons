-- Admin page: put a player's season pass back to zero (XP, rewards claimed, cards linked to the pass). The Premium pass is
-- kept unless p_premium_too (it may have been paid). Rewards already received stay in the collection.
create function public.admin_season_reset(p_user uuid, p_premium_too boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); s seasons := shown_season();
begin
  if s.id is null then raise exception 'no_season'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  update season_progress set xp = 0, claimed_free = '{}', claimed_premium = '{}',
         premium = case when p_premium_too then false else premium end
  where owner = p_user and season_id = s.id;
  delete from season_cards where owner = p_user and season_id = s.id;
  perform admin_log_add(me, p_user, 'pass', 'pass remis à zéro' || case when p_premium_too then ' (Premium retiré)' else '' end);
end $$;

revoke execute on function public.admin_season_reset(uuid, boolean) from public, anon;
grant execute on function public.admin_season_reset(uuid, boolean) to authenticated;
