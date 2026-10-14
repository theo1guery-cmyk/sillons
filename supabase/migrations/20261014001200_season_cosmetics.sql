-- The VIP titles of the pass become items of the season, seen in the game (a theme per season, here the tour):
--   tier 3  · Bracelet Backstage: a gold ticket ring around the avatar
--   tier 9  · Sachet Tournée: the booster's sachet dressed for the tour (night, stage lights, "Tournée Mondiale")
--   tier 21 · Dos de carte Tournée: the back of the cards in the openings
--   tier 27 · Pseudo doré: the pseudo written in gold
-- An item is kept for good (player_cosmetics) and put on when received; profiles.cosmetics holds what is worn, by
-- slot. The players who already took those tiers (titles) receive the items too.

create table if not exists public.player_cosmetics (
  owner uuid not null references public.profiles on delete cascade,
  item text not null,
  at timestamptz not null default now(),
  primary key (owner, item)
);
alter table public.player_cosmetics enable row level security;
drop policy if exists "my cosmetics" on public.player_cosmetics;
create policy "my cosmetics" on public.player_cosmetics for select to authenticated using (owner = auth.uid());
alter table public.profiles add column if not exists cosmetics jsonb not null default '{}';

-- the items of the season, by tier: {kind, item, slot, name}
create or replace function public.season_cosmetic(p_tier int) returns jsonb language sql immutable as $$
  select case p_tier
    when 3 then '{"kind": "cosmetic", "item": "avatar-tour", "slot": "avatar", "name": "Bracelet Backstage"}'
    when 9 then '{"kind": "cosmetic", "item": "pack-tour", "slot": "pack", "name": "Sachet Tournée"}'
    when 21 then '{"kind": "cosmetic", "item": "back-tour", "slot": "back", "name": "Dos de carte Tournée"}'
    when 27 then '{"kind": "cosmetic", "item": "name-gold", "slot": "name", "name": "Pseudo doré"}' end::jsonb
$$;

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
      when p_tier in (5, 15, 25) then jsonb_build_object('kind', 'big_booster', 'amount', 1)
      when p_tier in (10, 20) then jsonb_build_object('kind', 'vinyls', 'amount', 60)
      when p_tier in (6, 12, 18, 24) then jsonb_build_object('kind', 'vinyls', 'amount', 40)
      when p_tier in (3, 9, 21, 27) then season_cosmetic(p_tier)
      else jsonb_build_object('kind', 'streams', 'amount', 150) end end
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
  elsif r ->> 'kind' = 'big_booster' then
    update profiles set big_packs = big_packs + (r ->> 'amount')::int where id = uid;
  elsif r ->> 'kind' = 'cosmetic' then                 -- an item of the season, put on at once
    insert into player_cosmetics (owner, item) values (uid, r ->> 'item') on conflict do nothing;
    update profiles set cosmetics = cosmetics || jsonb_build_object(r ->> 'slot', r ->> 'item') where id = uid;
  elsif r ->> 'kind' = 'title' then
    insert into player_titles (owner, title) values (uid, r ->> 'title') on conflict do nothing;
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
    perform give_card(uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean, 'pass');   -- queued if one is already waiting
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

-- put on (or take off, p_item null) an item the player has
create or replace function public.set_cosmetic(p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c jsonb;
begin
  if p_slot not in ('avatar', 'pack', 'back', 'name') then raise exception 'bad_slot'; end if;
  if p_item is not null then
    if not exists (select 1 from player_cosmetics where owner = uid and item = p_item) then raise exception 'not_owned'; end if;
    if not exists (select 1 from generate_series(1, 30) t where season_cosmetic(t) ->> 'item' = p_item and season_cosmetic(t) ->> 'slot' = p_slot) then
      raise exception 'bad_slot';
    end if;
    update profiles set cosmetics = cosmetics || jsonb_build_object(p_slot, p_item) where id = uid returning cosmetics into c;
  else
    update profiles set cosmetics = cosmetics - p_slot where id = uid returning cosmetics into c;
  end if;
  return c;
end $$;

-- the VIP players who already took those tiers
insert into public.player_cosmetics (owner, item)
select sp.owner, public.season_cosmetic(t) ->> 'item' from public.season_progress sp, unnest(sp.claimed_premium) t where t in (3, 9, 21, 27)
on conflict do nothing;
update public.profiles p set cosmetics = coalesce((select jsonb_object_agg(public.season_cosmetic(t) ->> 'slot', public.season_cosmetic(t) ->> 'item')
  from public.season_progress sp, unnest(sp.claimed_premium) t where sp.owner = p.id and t in (3, 9, 21, 27)), '{}')
where exists (select 1 from public.season_progress sp where sp.owner = p.id and sp.claimed_premium && array[3, 9, 21, 27]::smallint[]);

revoke execute on function public.season_cosmetic(int) from public, anon;
revoke execute on function public.claim_season(int, boolean), public.set_cosmetic(text, text) from public, anon;
grant execute on function public.claim_season(int, boolean), public.set_cosmetic(text, text) to authenticated;
