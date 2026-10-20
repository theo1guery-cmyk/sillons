-- Vinyles are harder to get without paying: the daily bonus gives 3 every 7 days of streak (no more 2 a day), an
-- achievement gives 2 (was 5), and the free season pass gives 5 at tiers 8, 16 and 26 only (was 10 at six tiers).
-- The Premium pass keeps its 25 at tiers 3, 9, 13, 17, 23 and 27. Same functions as 20261011000400_vinyls.sql otherwise.
create or replace function public.on_ledger_vinyls() returns trigger
language plpgsql security definer set search_path = public as $$
declare streak int;
begin
  if new.amount > 0 and new.reason like 'connexion du jour%' then
    streak := coalesce(substring(new.reason from 'série de (\d+)')::int, 0);
    if streak > 0 and streak % 7 = 0 then perform add_vinyls(new.owner, 3, 'série de ' || streak || ' jours'); end if;
  elsif new.amount > 0 and new.reason like 'succès : %' then perform add_vinyls(new.owner, 2, new.reason); end if;
  return new;
exception when others then return new;
end $$;

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
      when p_tier = 20 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', true))
      when p_tier = 15 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 4, 'shiny', false))
      when p_tier = 10 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', true))
      when p_tier = 5 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (3, 9, 13, 17, 23, 27) then jsonb_build_object('kind', 'vinyls', 'amount', 25)
      when p_tier % 2 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      else jsonb_build_object('kind', 'streams', 'amount', 200) end end
$$;
