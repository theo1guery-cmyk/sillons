-- Season pass: a season lasts about a month and has 30 tiers. Players earn XP by playing (5 per booster opened, 50 more
-- for a GOD pack, and 1 per 10 Streams won from the daily bonus, challenges, albums, discographies, achievements and
-- blind test training). Each tier has a free reward and a Premium one: Streams, boosters, or a card offered as the last
-- card of the next booster (forced_cards, like the admin gifts). Premium is switched on from the admin page for now
-- (no payment yet). Rewards stay claimable 7 days after the end of the season.

create table public.seasons (
  id serial primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  tiers int not null default 30,
  xp_per_tier int not null default 200
);
alter table public.seasons enable row level security;
insert into public.seasons (name, starts_at, ends_at) values ('Saison 1 · Premier pressage', '2026-10-11 00:00+02', '2026-11-11 00:00+01');

create table public.season_progress (
  owner uuid not null references public.profiles on delete cascade,
  season_id int not null references public.seasons on delete cascade,
  xp int not null default 0,
  premium boolean not null default false,
  claimed_free smallint[] not null default '{}',
  claimed_premium smallint[] not null default '{}',
  primary key (owner, season_id)
);
alter table public.season_progress enable row level security;

create function public.current_season() returns seasons language sql stable set search_path = public as $$
  select * from seasons where now() >= starts_at and now() < ends_at order by starts_at desc limit 1
$$;

-- the reward of a tier: {kind: 'streams'|'boosters'|'card', amount, card: {kind, tier, shiny}}
create function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql immutable as $$
  select case
    when not p_premium then case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (10, 20) then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier % 5 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      else jsonb_build_object('kind', 'streams', 'amount', case when p_tier < 10 then 50 when p_tier < 20 then 75 else 100 end) end
    else case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 5, 'shiny', true))
      when p_tier = 25 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 5, 'shiny', false))
      when p_tier = 20 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', true))
      when p_tier = 15 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'artist', 'tier', 4, 'shiny', false))
      when p_tier = 10 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', true))
      when p_tier = 5 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier % 2 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      else jsonb_build_object('kind', 'streams', 'amount', 200) end end
$$;

-- ---------------------------------------------------------------- XP
create function public.season_add_xp(p_user uuid, p_xp int) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons := current_season();
begin
  if s.id is null or coalesce(p_xp, 0) <= 0 then return; end if;
  insert into season_progress (owner, season_id, xp) values (p_user, s.id, p_xp)
  on conflict (owner, season_id) do update set xp = season_progress.xp + excluded.xp;
end $$;

create function public.on_pack_season_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done then perform season_add_xp(new.owner, 5 + case when new.god then 50 else 0 end); end if;
  return new;
exception when others then return new;            -- XP never breaks a booster
end $$;
create trigger pack_season_xp after update of done on public.packs for each row execute function public.on_pack_season_xp();

-- Streams won by playing (not sales, refunds, gifts, discarded duplicates or the pass itself)
create function public.on_ledger_season_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 and new.reason !~ '^(vente au marché|remboursement|cadeau|défausse|Pass saisonnier)' then
    perform season_add_xp(new.owner, greatest(1, new.amount / 10)::int);
  end if;
  return new;
exception when others then return new;
end $$;
create trigger ledger_season_xp after insert on public.stream_ledger for each row execute function public.on_ledger_season_xp();

-- ---------------------------------------------------------------- the player
-- the season shown: the current one, or the last one for 7 days after its end (to claim what is left)
create function public.shown_season() returns seasons language sql stable set search_path = public as $$
  select * from seasons where now() >= starts_at and now() < ends_at + interval '7 days' order by starts_at desc limit 1
$$;

create function public.my_season() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress;
begin
  if s.id is null then return null; end if;
  select * into p from season_progress where owner = uid and season_id = s.id;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'tiers', s.tiers, 'xp_per_tier', s.xp_per_tier,
    'xp', coalesce(p.xp, 0), 'premium', coalesce(p.premium, false),
    'claimed_free', to_jsonb(coalesce(p.claimed_free, '{}')), 'claimed_premium', to_jsonb(coalesce(p.claimed_premium, '{}')),
    'gift_pending', exists (select 1 from forced_cards where id = uid),
    'rewards', (select jsonb_agg(jsonb_build_object('tier', t, 'free', season_reward(t, false), 'premium', season_reward(t, true)) order by t)
                from generate_series(1, s.tiers) t));
end $$;

create function public.claim_season(p_tier int, p_premium boolean) returns jsonb
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
  elsif r ->> 'kind' = 'boosters' then
    update profiles set stock = stock + (r ->> 'amount')::int where id = uid;
  else
    c := r -> 'card';
    insert into forced_cards (id, kind, tier, shiny) values (uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean)
    on conflict (id) do nothing;
    if not found then raise exception 'gift_pending'; end if;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

-- ---------------------------------------------------------------- admin page
create function public.admin_season_premium(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); s seasons := shown_season();
begin
  if s.id is null then raise exception 'no_season'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  insert into season_progress (owner, season_id, premium) values (p_user, s.id, p_on)
  on conflict (owner, season_id) do update set premium = excluded.premium;
  perform admin_log_add(me, p_user, 'pass', case when p_on then 'Pass Premium activé' else 'Pass Premium retiré' end);
end $$;

create function public.admin_season_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s seasons := shown_season(); p season_progress;
begin
  perform require_admin();
  if s.id is null then return null; end if;
  select * into p from season_progress where owner = p_user and season_id = s.id;
  return jsonb_build_object('name', s.name, 'xp', coalesce(p.xp, 0), 'tier', least(s.tiers, coalesce(p.xp, 0) / s.xp_per_tier), 'tiers', s.tiers,
                            'premium', coalesce(p.premium, false));
end $$;

revoke execute on function public.current_season(), public.shown_season(), public.season_add_xp(uuid, int), public.on_pack_season_xp(),
  public.on_ledger_season_xp() from public, anon, authenticated;
revoke execute on function public.my_season(), public.claim_season(int, boolean), public.admin_season_premium(uuid, boolean),
  public.admin_season_get(uuid) from public, anon;
grant execute on function public.my_season(), public.claim_season(int, boolean), public.admin_season_premium(uuid, boolean),
  public.admin_season_get(uuid) to authenticated;
