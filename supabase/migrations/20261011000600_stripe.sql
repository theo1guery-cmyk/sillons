-- Payments with Stripe. The packs and their prices live here (shop_packs), so a player cannot change a price from the
-- page. The Edge Function create-checkout asks shop_quote() (as the player) what a pack costs, then opens a Stripe
-- Checkout page. When Stripe confirms the payment, the Edge Function stripe-webhook calls credit_purchase() with the
-- secret key: it records the payment once (purchases, keyed by the Checkout session) and delivers the Vinyles or the
-- Premium pass. A session delivered twice (Stripe retries) is only delivered once.

create table public.shop_packs (
  id text primary key,
  name text not null,
  cents int not null check (cents >= 50),
  vinyls int not null default 0,
  premium boolean not null default false,       -- the Premium pass of the current season
  once boolean not null default false           -- one purchase per player (the welcome offer)
);
alter table public.shop_packs enable row level security;
insert into public.shop_packs (id, name, cents, vinyls, premium, once) values
  ('welcome', 'Offre de bienvenue : 300 Vinyles', 99, 300, false, true),
  ('v80', '80 Vinyles', 99, 80, false, false),
  ('v170', '170 Vinyles', 199, 170, false, false),
  ('v360', '360 Vinyles', 399, 360, false, false),
  ('v950', '950 Vinyles', 999, 950, false, false),
  ('v2000', '2 000 Vinyles', 1999, 2000, false, false),
  ('v5500', '5 500 Vinyles', 4999, 5500, false, false),
  ('pass', 'Pass Premium de la saison', 499, 0, true, false);

create table public.purchases (
  session_id text primary key,                  -- the Stripe Checkout session
  owner uuid references public.profiles on delete set null,
  pack text not null,
  cents int,
  vinyls int not null default 0,
  created_at timestamptz not null default now()
);
create index purchases_owner_idx on public.purchases (owner, created_at desc);
alter table public.purchases enable row level security;

-- what the player is about to pay (called by create-checkout with the player's session)
create function public.shop_quote(p_pack text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; s seasons;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  if k.once and exists (select 1 from purchases where owner = uid and pack = k.id) then raise exception 'offer_used'; end if;
  if k.premium then
    s := current_season();
    if s.id is null then raise exception 'no_season'; end if;
    if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  end if;
  return jsonb_build_object('user', uid, 'email', (select email from auth.users where id = uid), 'name', k.name, 'cents', k.cents);
end $$;

-- delivers a paid pack, once per Checkout session (called by stripe-webhook with the secret key only)
create function public.credit_purchase(p_session text, p_user uuid, p_pack text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare k shop_packs; s seasons;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  insert into purchases (session_id, owner, pack, cents, vinyls) values (p_session, p_user, p_pack, p_cents, k.vinyls) on conflict do nothing;
  if not found then return; end if;
  if k.vinyls > 0 then perform add_vinyls(p_user, k.vinyls, 'achat : ' || k.name); end if;
  if k.premium then
    s := current_season();
    if s.id is not null then
      insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
      on conflict (owner, season_id) do update set premium = true;
    end if;
  end if;
end $$;

-- the one-time offers this player has already bought (the page hides them)
create function public.my_offers_used() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct p.pack), '[]') from purchases p join shop_packs k on k.id = p.pack and k.once where p.owner = auth.uid()
$$;

revoke execute on function public.shop_quote(text), public.my_offers_used() from public, anon;
grant execute on function public.shop_quote(text), public.my_offers_used() to authenticated;
revoke execute on function public.credit_purchase(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.credit_purchase(text, uuid, text, int) to service_role;
