-- The last reward of the Pass VIP (tier 30) is a Shiny surprise: a Shiny Mythique (40 %), artist Platine (30 %),
-- Légendaire (20 %) or artist Diamant (10 %), drawn when the player claims it. season_reward() shows it as
-- {kind: 'any', tier: 5, shiny: true}; claim_season() (the one from 20261011000800_shop_offers.sql) draws the card and
-- returns the one drawn.
create or replace function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql immutable as $$
  select case
    when not p_premium then case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (10, 20) then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier % 5 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      when p_tier in (8, 16, 26) then jsonb_build_object('kind', 'vinyls', 'amount', 5)
      else jsonb_build_object('kind', 'streams', 'amount', case when p_tier < 10 then 50 when p_tier < 20 then 75 else 100 end) end
    else case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'any', 'tier', 5, 'shiny', true))
      when p_tier = 25 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 5, 'shiny', false))
      when p_tier = 20 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier = 15 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 4, 'shiny', false))
      when p_tier = 10 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier = 5 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (3, 9, 13, 17, 23, 27) then jsonb_build_object('kind', 'vinyls', 'amount', 25)
      when p_tier % 2 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      else jsonb_build_object('kind', 'streams', 'amount', 200) end end
$$;

create or replace function public.claim_season(p_tier int, p_premium boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress; r jsonb; c jsonb; x double precision;
begin
  if s.id is null then raise exception 'no_season'; end if;
  select * into p from season_progress where owner = uid and season_id = s.id for update;
  if p.owner is null or p_tier < 1 or p_tier > s.tiers or p.xp / s.xp_per_tier < p_tier then raise exception 'tier_locked'; end if;
  if p_premium and not p.premium then raise exception 'premium_only'; end if;
  if (case when p_premium then p.claimed_premium else p.claimed_free end) @> array[p_tier::smallint] then raise exception 'already_claimed'; end if;
  r := season_reward(p_tier, p_premium);
  if r ->> 'kind' = 'streams' then
    perform add_streams(uid, (r ->> 'amount')::int, 'Pass saisonnier : palier ' || p_tier);
  elsif r ->> 'kind' = 'vinyls' then
    perform add_vinyls(uid, (r ->> 'amount')::int, 'Pass saisonnier : palier ' || p_tier);
  elsif r ->> 'kind' = 'boosters' then
    update profiles set stock = stock + (r ->> 'amount')::int where id = uid;
  else
    c := r -> 'card';
    if c ->> 'kind' = 'any' then                         -- the Shiny surprise: drawn now, and the player is told which
      x := random();
      c := case when x < .4 then '{"kind": "track", "tier": 4}' when x < .7 then '{"kind": "artist", "tier": 4}'
                when x < .9 then '{"kind": "track", "tier": 5}' else '{"kind": "artist", "tier": 5}' end::jsonb
           || jsonb_build_object('shiny', true);
      r := jsonb_set(r, '{card}', c);
    end if;
    perform give_card(uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean);   -- queued if one is already waiting
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;
