-- The Pass VIP keeps a single Shiny, the final reward (artist Diamant Shiny, tier 30): tier 10 becomes a Mythique and
-- tier 20 a Légendaire (no longer Shiny), so the Shiny stays rare and the offer of the day that guarantees one keeps
-- its worth. The pass costs 7,99 € or 700 Vinyles (was 4,99 € / 450). Cards already claimed are kept.
create or replace function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql immutable as $$
  select case
    when not p_premium then case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (10, 20) then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier % 5 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      when p_tier in (8, 16, 26) then jsonb_build_object('kind', 'vinyls', 'amount', 5)
      else jsonb_build_object('kind', 'streams', 'amount', case when p_tier < 10 then 50 when p_tier < 20 then 75 else 100 end) end
    else case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 5, 'shiny', true))
      when p_tier = 25 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 5, 'shiny', false))
      when p_tier = 20 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier = 15 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 4, 'shiny', false))
      when p_tier = 10 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier = 5 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (3, 9, 13, 17, 23, 27) then jsonb_build_object('kind', 'vinyls', 'amount', 25)
      when p_tier % 2 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      else jsonb_build_object('kind', 'streams', 'amount', 200) end end
$$;

create or replace function public.buy_season_premium() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); bal int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < 700 then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -700, 'Pass Premium');
  insert into season_progress (owner, season_id, premium) values (uid, s.id, true)
  on conflict (owner, season_id) do update set premium = true;
end $$;

update public.shop_packs set cents = 799 where id = 'pass';
