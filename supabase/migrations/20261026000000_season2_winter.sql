-- Saison 2 · Tournée d'Hiver (11 November to 11 December).
--  * its own VIP items, at the same tiers as the Tournée Mondiale (3, 9, 21, 27): Médaillon Givré, Sachet Blizzard,
--    Dos de carte Aurore, Pseudo de glace. Every item ever received stays in the wardrobe and can be worn again;
--  * the snowman of everyone: each booster opened by any player during the season adds snow. Six steps; each step
--    finished gives a present to every player who opened at least one booster during the season (taken on the next
--    visit). The steps are set once, at the start, from the boosters opened per day lately, so the last one comes near
--    the end of the season. A message on the Discord at each step.

-- every item that can be worn, and its slot (the wardrobe checks against it)
create table if not exists public.cosmetic_items (item text primary key, slot text not null, name text not null);
alter table public.cosmetic_items enable row level security;
insert into public.cosmetic_items (item, slot, name) values
  ('avatar-tour', 'avatar', 'Médaillon Tournée'), ('pack-tour', 'pack', 'Sachet Tournée'), ('back-tour', 'back', 'Dos de carte Tournée'), ('name-gold', 'name', 'Pseudo gravé à l''or'),
  ('avatar-givre', 'avatar', 'Médaillon Givré'), ('pack-winter', 'pack', 'Sachet Blizzard'), ('back-winter', 'back', 'Dos de carte Aurore'), ('name-ice', 'name', 'Pseudo de glace')
on conflict (item) do nothing;

-- the items of the season shown now
create or replace function public.season_cosmetic(p_tier int) returns jsonb language sql stable set search_path = public as $$
  select case when coalesce((shown_season()).name, '') like 'Saison 2%' then case p_tier
      when 3 then '{"kind": "cosmetic", "item": "avatar-givre", "slot": "avatar", "name": "Médaillon Givré"}'
      when 9 then '{"kind": "cosmetic", "item": "pack-winter", "slot": "pack", "name": "Sachet Blizzard"}'
      when 21 then '{"kind": "cosmetic", "item": "back-winter", "slot": "back", "name": "Dos de carte Aurore"}'
      when 27 then '{"kind": "cosmetic", "item": "name-ice", "slot": "name", "name": "Pseudo de glace"}' end
    else case p_tier
      when 3 then '{"kind": "cosmetic", "item": "avatar-tour", "slot": "avatar", "name": "Médaillon Tournée"}'
      when 9 then '{"kind": "cosmetic", "item": "pack-tour", "slot": "pack", "name": "Sachet Tournée"}'
      when 21 then '{"kind": "cosmetic", "item": "back-tour", "slot": "back", "name": "Dos de carte Tournée"}'
      when 27 then '{"kind": "cosmetic", "item": "name-gold", "slot": "name", "name": "Pseudo gravé à l''or"}' end end::jsonb
$$;

create or replace function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql stable set search_path = public as $$
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

-- put on (or take off) an item the player has, from any season
create or replace function public.set_cosmetic(p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c jsonb;
begin
  if p_slot not in ('avatar', 'pack', 'back', 'name') then raise exception 'bad_slot'; end if;
  if p_item is not null then
    if not exists (select 1 from player_cosmetics where owner = uid and item = p_item) then raise exception 'not_owned'; end if;
    if not exists (select 1 from cosmetic_items where item = p_item and slot = p_slot) then raise exception 'bad_slot'; end if;
    update profiles set cosmetics = cosmetics || jsonb_build_object(p_slot, p_item) where id = uid returning cosmetics into c;
  else
    update profiles set cosmetics = cosmetics - p_slot where id = uid returning cosmetics into c;
  end if;
  return c;
end $$;

-- ---------------------------------------------------------------- the snowman of everyone
create table if not exists public.winter_meta (
  id int primary key default 1 check (id = 1),
  starts_at timestamptz not null default '2026-11-11 00:00 Europe/Paris',
  ends_at timestamptz not null default '2026-12-11 00:00 Europe/Paris',
  steps int[],                                     -- boosters of everyone needed for each step, set at the start
  announced smallint not null default 0            -- the last step told on the Discord
);
alter table public.winter_meta enable row level security;
insert into public.winter_meta (id) values (1) on conflict do nothing;
create table if not exists public.winter_claims (owner uuid references public.profiles on delete cascade, step smallint, at timestamptz not null default now(), primary key (owner, step));
alter table public.winter_claims enable row level security;

-- the boosters opened by everyone since the start of the season (from the counters of the day)
create or replace function public.winter_packs() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(n), 0) from daily_counters, winter_meta m
  where metric = 'packs' and day >= (m.starts_at at time zone 'Europe/Paris')::date and day < (m.ends_at at time zone 'Europe/Paris')::date
$$;

-- the steps, once: the boosters per day of the last week, over the 30 days, cut at 8 %, 20 %, 35 %, 55 %, 75 % and 92 %
create or replace function public.winter_steps() returns int[]
language plpgsql security definer set search_path = public as $$
declare m winter_meta; per_day double precision; total double precision;
begin
  select * into m from winter_meta where id = 1 for update;
  if m.steps is not null then return m.steps; end if;
  select coalesce(sum(n), 0) / 7.0 into per_day from daily_counters
  where metric = 'packs' and day >= (m.starts_at at time zone 'Europe/Paris')::date - 7 and day < (m.starts_at at time zone 'Europe/Paris')::date;
  total := greatest(per_day, 200) * extract(epoch from m.ends_at - m.starts_at) / 86400;
  m.steps := array(select (ceil(total * f / 100.0) * 100)::int from unnest(array[.08, .20, .35, .55, .75, .92]) f);
  update winter_meta set steps = m.steps where id = 1;
  return m.steps;
end $$;

create or replace function public.winter_on() returns boolean
language sql stable security definer set search_path = public as $$
  select now() >= starts_at and now() < ends_at + interval '7 days' from winter_meta where id = 1
$$;

-- what the pass shows: the boosters of everyone, the steps, those I already received
create or replace function public.winter_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); m winter_meta;
begin
  select * into m from winter_meta where id = 1;
  if not winter_on() then return null; end if;
  return jsonb_build_object('packs', winter_packs(), 'steps', to_jsonb(winter_steps()), 'ends_at', m.ends_at,
    'claimed', coalesce((select jsonb_agg(step order by step) from winter_claims where owner = uid), '[]'));
end $$;

-- the presents of the steps finished, for a player who opened at least one booster during the season
create or replace function public.winter_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); m winter_meta; packs bigint; st int[]; k int; got jsonb := '[]';
begin
  if not winter_on() then return got; end if;
  select * into m from winter_meta where id = 1;
  if not exists (select 1 from daily_counters where owner = uid and metric = 'packs' and n > 0
                 and day >= (m.starts_at at time zone 'Europe/Paris')::date and day < (m.ends_at at time zone 'Europe/Paris')::date) then return got; end if;
  packs := winter_packs(); st := winter_steps();
  for k in 1..6 loop
    exit when packs < st[k];
    insert into winter_claims (owner, step) values (uid, k) on conflict do nothing;
    continue when not found;
    case k
      when 1 then update profiles set stock = stock + 2 where id = uid;
      when 2 then perform add_streams(uid, 2000, 'bonhomme de neige : le corps');
      when 3 then update profiles set big_packs = big_packs + 1 where id = uid;
      when 4 then perform add_vinyls(uid, 60, 'bonhomme de neige : les yeux et la carotte');
      when 5 then perform give_card(uid, 'track', 4::smallint, false, 'snowman');
      else perform give_card(uid, 'track', 5::smallint, false, 'snowman');
    end case;
    got := got || to_jsonb(k);
  end loop;
  return got;
end $$;

-- every 10 minutes: a step just finished is told on the Discord
create or replace function public.winter_tick() returns void
language plpgsql security definer set search_path = public as $$
declare m winter_meta; packs bigint; st int[]; reached int := 0; k int;
  names text[] := array['la base', 'le corps', 'la tête', 'les yeux et la carotte', 'l''écharpe', 'le chapeau'];
  gifts text[] := array['2 boosters', '2 000 Streams', '1 Grand booster', '60 Vinyles', '1 carte Mythique', '1 carte Légendaire'];
begin
  select * into m from winter_meta where id = 1;
  if now() < m.starts_at or now() >= m.ends_at then return; end if;
  packs := winter_packs(); st := winter_steps();
  for k in 1..6 loop exit when packs < st[k]; reached := k; end loop;
  if reached <= m.announced then return; end if;
  update winter_meta set announced = reached where id = 1;
  begin
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '⛄ **Le bonhomme de neige avance !** Tous ensemble, vous avez ouvert ' || replace(to_char(packs, 'FM999G999G999'), ',', ' ') || ' boosters. Étape '
                 || reached || ' sur 6 terminée : ' || names[reached] || case when reached = 6 then '. Il est complet !' else '.' end
                 || ' Cadeau pour tous ceux qui ont ouvert un booster cette saison : **' || gifts[reached] || '**. Il t''attend sur la page du Pass.'));
  exception when others then null;
  end;
end $$;
select cron.schedule('winter-tick', '*/10 * * * *', 'select public.winter_tick()');

revoke execute on function public.winter_packs(), public.winter_steps(), public.winter_tick(), public.winter_on() from public, anon, authenticated;
revoke execute on function public.winter_state(), public.winter_claim() from public, anon;
grant execute on function public.winter_state(), public.winter_claim() to authenticated;
