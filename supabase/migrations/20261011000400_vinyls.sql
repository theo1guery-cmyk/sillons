-- Vinyles: a second, rarer currency (like gems). They buy what Streams cannot: a season pass tier (30) or the Premium
-- pass (450). Players also earn a few without paying: 2 with each daily bonus, 5 with each achievement, and some tiers of
-- the season pass give them (free and Premium). The team can give or take them from the admin page.
-- Every change goes through add_vinyls() and is written to vinyl_ledger.

alter table public.profiles add column if not exists vinyls int not null default 0 check (vinyls >= 0);

create table public.vinyl_ledger (
  id bigint generated always as identity primary key,
  owner uuid not null references public.profiles on delete cascade,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index vinyl_ledger_owner_idx on public.vinyl_ledger (owner, created_at desc);
alter table public.vinyl_ledger enable row level security;

create function public.add_vinyls(p_user uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  update profiles set vinyls = vinyls + p_amount where id = p_user returning vinyls into bal;
  if bal is null then raise exception 'user_not_found'; end if;
  insert into vinyl_ledger (owner, amount, reason) values (p_user, p_amount, p_reason);
  return bal;
end $$;

-- earned by playing: the daily bonus and the achievements (they already pay Streams; this adds Vinyles)
create function public.on_ledger_vinyls() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 and new.reason like 'connexion du jour%' then perform add_vinyls(new.owner, 2, 'connexion du jour');
  elsif new.amount > 0 and new.reason like 'succès : %' then perform add_vinyls(new.owner, 5, new.reason); end if;
  return new;
exception when others then return new;
end $$;
create trigger ledger_vinyls after insert on public.stream_ledger for each row execute function public.on_ledger_vinyls();

-- the season pass: some tiers now give Vinyles (free: 10 at tiers 4, 8, 12, 16, 22, 26; Premium: 25 at 3, 9, 13, 17, 23, 27)
create or replace function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql immutable as $$
  select case
    when not p_premium then case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (10, 20) then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier % 5 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      when p_tier in (4, 8, 12, 16, 22, 26) then jsonb_build_object('kind', 'vinyls', 'amount', 10)
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

create or replace function public.claim_season(p_tier int, p_premium boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress; r jsonb; c jsonb;
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
    insert into forced_cards (id, kind, tier, shiny) values (uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean)
    on conflict (id) do nothing;
    if not found then raise exception 'gift_pending'; end if;
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

-- ---------------------------------------------------------------- spending Vinyles
create function public.buy_season_tier() returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); p season_progress; t int; bal int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < 30 then raise exception 'not_enough_vinyls'; end if;
  insert into season_progress (owner, season_id) values (uid, s.id) on conflict do nothing;
  select * into p from season_progress where owner = uid and season_id = s.id for update;
  t := p.xp / s.xp_per_tier;
  if t >= s.tiers then raise exception 'max_tier'; end if;
  perform add_vinyls(uid, -30, 'Pass saisonnier : palier ' || (t + 1) || ' acheté');
  update season_progress set xp = (t + 1) * s.xp_per_tier where owner = uid and season_id = s.id;
  return t + 1;
end $$;

create function public.buy_season_premium() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); bal int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < 450 then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -450, 'Pass Premium');
  insert into season_progress (owner, season_id, premium) values (uid, s.id, true)
  on conflict (owner, season_id) do update set premium = true;
end $$;

-- ---------------------------------------------------------------- admin page
create function public.admin_vinyls(p_user uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); bal int; amount int := p_amount;
begin
  if p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'bad_amount'; end if;
  select vinyls into bal from profiles where id = p_user;
  if bal is null then raise exception 'user_not_found'; end if;
  amount := greatest(amount, -bal);
  if amount = 0 then return bal; end if;
  bal := add_vinyls(p_user, amount, coalesce(nullif(trim(p_reason), ''), 'cadeau de l''équipe'));
  perform admin_log_add(me, p_user, 'vinyls', amount || coalesce(' · ' || nullif(p_reason, ''), ''));
  return bal;
end $$;

-- the player's page shows their Vinyles next to the pass
create or replace function public.admin_season_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s seasons := shown_season(); p season_progress;
begin
  perform require_admin();
  if s.id is null then return jsonb_build_object('vinyls', (select vinyls from profiles where id = p_user)); end if;
  select * into p from season_progress where owner = p_user and season_id = s.id;
  return jsonb_build_object('name', s.name, 'xp', coalesce(p.xp, 0), 'tier', least(s.tiers, coalesce(p.xp, 0) / s.xp_per_tier), 'tiers', s.tiers,
                            'premium', coalesce(p.premium, false), 'vinyls', (select vinyls from profiles where id = p_user));
end $$;

revoke execute on function public.add_vinyls(uuid, int, text), public.on_ledger_vinyls() from public, anon, authenticated;
revoke execute on function public.buy_season_tier(), public.buy_season_premium(), public.admin_vinyls(uuid, int, text) from public, anon;
grant execute on function public.buy_season_tier(), public.buy_season_premium(), public.admin_vinyls(uuid, int, text) to authenticated;
