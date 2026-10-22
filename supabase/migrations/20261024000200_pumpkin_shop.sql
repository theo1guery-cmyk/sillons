-- Halloween: pumpkins (🎃) can be bought, with money (Stripe, or through tyt23 on the Discord while card payments are
-- off) or with Vinyles, and the admins can give or take them. All of it only while the Halloween event is on.

alter table public.shop_packs add column if not exists pumpkins int not null default 0;
alter table public.shop_packs add column if not exists pumpkin_vinyls int;        -- the same pack paid in Vinyles
alter table public.purchases add column if not exists pumpkins int not null default 0;

insert into public.shop_packs (id, name, cents, vinyls, pumpkins, pumpkin_vinyls) values
  ('pk60', '60 citrouilles', 99, 0, 60, 80),
  ('pk150', '150 citrouilles', 199, 0, 150, 160),
  ('pk400', '400 citrouilles', 499, 0, 400, 400),
  ('pk1000', '1 000 citrouilles', 999, 0, 1000, 800)
on conflict (id) do update set name = excluded.name, cents = excluded.cents, pumpkins = excluded.pumpkins, pumpkin_vinyls = excluded.pumpkin_vinyls;

-- the quote refuses a pumpkin pack when the event is over
create or replace function public.shop_quote(p_pack text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; s seasons;
begin
  if (select payments_off from settings where id = 1) and not exists (select 1 from admins where id = uid) then
    raise exception 'payments_maintenance';
  end if;
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  if k.pumpkins > 0 and not halloween_on() then raise exception 'event_over'; end if;
  if k.once and exists (select 1 from purchases where owner = uid and pack = k.id) then raise exception 'offer_used'; end if;
  if k.daily and (k.id <> today_offer() or exists (select 1 from purchases where owner = uid and pack = k.id
                  and (created_at at time zone 'Europe/Paris')::date = game_day())) then raise exception 'offer_expired'; end if;
  if k.fire and fire_until(uid) is null then raise exception 'offer_expired'; end if;
  if k.premium then
    s := current_season();
    if s.id is null then raise exception 'no_season'; end if;
    if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  end if;
  return jsonb_build_object('user', uid, 'email', (select email from auth.users where id = uid), 'name', k.name, 'cents', k.cents);
end $$;

-- a paid pumpkin pack is delivered even if the event ended in the minute between paying and the webhook
create or replace function public.credit_purchase(p_session text, p_user uuid, p_pack text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare k shop_packs; s seasons; taken boolean; v int;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  if exists (select 1 from purchases where session_id = p_session) then return; end if;
  s := current_season();
  taken := (k.once and exists (select 1 from purchases where owner = p_user and pack = k.id))
        or (k.daily and exists (select 1 from purchases where owner = p_user and pack = k.id
                                and (created_at at time zone 'Europe/Paris')::date = game_day()))
        or (k.fire and exists (select 1 from purchases where owner = p_user and pack = k.id and created_at > now() - interval '2 hours'))
        or (k.premium and (s.id is null or exists (select 1 from season_progress where owner = p_user and season_id = s.id and premium)));
  v := case when taken then greatest(1, round(coalesce(p_cents, k.cents) * 0.8)::int) else k.vinyls end;
  insert into purchases (session_id, owner, pack, cents, vinyls, pumpkins)
  values (p_session, p_user, p_pack, p_cents, v, case when taken then 0 else k.pumpkins end) on conflict do nothing;
  if not found then return; end if;
  if taken then                                         -- already used: the money becomes Vinyles at the normal rate
    perform add_vinyls(p_user, v, 'achat : ' || k.name || ' (déjà pris, converti en Vinyles)');
    return;
  end if;
  if k.vinyls > 0 then perform add_vinyls(p_user, k.vinyls, 'achat : ' || k.name); end if;
  if k.pumpkins > 0 then update profiles set pumpkins = pumpkins + k.pumpkins where id = p_user; end if;
  if k.boosters > 0 then update profiles set stock = stock + k.boosters where id = p_user; end if;
  if k.card_kind is not null then perform give_card(p_user, k.card_kind, k.card_tier, k.card_shiny); end if;
  if k.premium then
    insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
    on conflict (owner, season_id) do update set premium = true;
  end if;
end $$;
revoke execute on function public.credit_purchase(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.credit_purchase(text, uuid, text, int) to service_role;

-- a refund takes the pumpkins back too (as many as are left)
create or replace function public.revoke_purchase(p_intent text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases; k shop_packs; bal int; take int;
begin
  select * into pu from purchases where payment_intent = p_intent and revoked_at is null for update;
  if pu.session_id is null then return; end if;
  update purchases set revoked_at = now() where session_id = pu.session_id;
  if pu.owner is null then return; end if;
  select * into k from shop_packs where id = pu.pack;
  select vinyls into bal from profiles where id = pu.owner for update;
  take := least(bal, pu.vinyls);
  update profiles set vinyls = vinyls - take, vinyl_debt = vinyl_debt + (pu.vinyls - take),
                      stock = greatest(0, stock - coalesce(k.boosters, 0)),
                      pumpkins = greatest(0, pumpkins - pu.pumpkins) where id = pu.owner;
  insert into vinyl_ledger (owner, amount, reason) values (pu.owner, -take, 'achat remboursé (' || p_reason || ') : ' || coalesce(k.name, pu.pack));
  if k.premium then
    update season_progress set premium = false
    where owner = pu.owner and season_id = (select id from seasons where pu.created_at between starts_at and ends_at + interval '7 days' order by starts_at desc limit 1);
  end if;
  insert into admin_log (admin, target, action, detail)
  values (null, pu.owner, 'vinyls', 'Achat Stripe repris (' || p_reason || ') : ' || coalesce(k.name, pu.pack) || ', ' || pu.vinyls || ' Vinyles'
          || case when pu.pumpkins > 0 then ', ' || pu.pumpkins || ' citrouilles' else '' end);
end $$;
revoke execute on function public.revoke_purchase(text, text) from public, anon, authenticated;
grant execute on function public.revoke_purchase(text, text) to service_role;

-- the pumpkin packs, for the page (prices come from here, not from the page)
create or replace function public.pumpkin_packs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pumpkins', pumpkins, 'cents', cents, 'vinyls', pumpkin_vinyls) order by pumpkins), '[]')
  from shop_packs where pumpkins > 0
$$;

-- a pumpkin pack paid in Vinyles
create or replace function public.buy_pumpkins(p_pack text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; bal int; pk int;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  select * into k from shop_packs where id = p_pack and pumpkins > 0 and pumpkin_vinyls > 0;
  if k.id is null then raise exception 'bad_pack'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < k.pumpkin_vinyls then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -k.pumpkin_vinyls, 'achat : ' || k.name);
  update profiles set pumpkins = pumpkins + k.pumpkins where id = uid returning pumpkins into pk;
  return pk;
end $$;

-- the admins give or take pumpkins (never below zero), only while the event is on
create or replace function public.admin_pumpkins(p_user uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); bal int; amount int := p_amount;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  if p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'bad_amount'; end if;
  select pumpkins into bal from profiles where id = p_user for update;
  if bal is null then raise exception 'user_not_found'; end if;
  amount := greatest(amount, -bal);
  update profiles set pumpkins = pumpkins + amount where id = p_user returning pumpkins into bal;
  perform admin_log_add(me, p_user, 'pumpkins', amount || coalesce(' · ' || nullif(trim(p_reason), ''), ''));
  return bal;
end $$;
create or replace function public.admin_pumpkins_get(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if not halloween_on() then return null; end if;
  return (select pumpkins from profiles where id = p_user);
end $$;

revoke execute on function public.pumpkin_packs(), public.buy_pumpkins(text), public.admin_pumpkins(uuid, int, text), public.admin_pumpkins_get(uuid) from public, anon;
grant execute on function public.pumpkin_packs(), public.buy_pumpkins(text), public.admin_pumpkins(uuid, int, text), public.admin_pumpkins_get(uuid) to authenticated;
