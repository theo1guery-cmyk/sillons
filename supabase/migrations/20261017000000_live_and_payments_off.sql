-- The game goes live: test mode ends (10 boosters in stock, one more every 10 min, 3 min with the VIP pass), and real
-- money payments are paused (the rest of the game keeps working). Both are switches on the admin page.
alter table public.settings add column if not exists payments_off boolean not null default false;

-- a player's checkout is refused while payments are paused (an admin can still try one)
create or replace function public.shop_quote(p_pack text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; s seasons;
begin
  if (select payments_off from settings where id = 1) and not exists (select 1 from admins where id = uid) then
    raise exception 'payments_maintenance';
  end if;
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
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

create or replace function public.admin_switches_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select jsonb_build_object('test_mode', test_mode, 'payments_off', payments_off) from settings where id = 1);
end $$;

create or replace function public.admin_switch_set(p_key text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if p_key = 'test_mode' then
    update settings set test_mode = p_on where id = 1;
    -- leaving test mode: everyone starts with a full stock
    if not p_on then update profiles set stock = 10, stock_at = now() where stock < 10; end if;
  elsif p_key = 'payments_off' then
    update settings set payments_off = p_on where id = 1;
  else
    raise exception 'bad_switch';
  end if;
  perform admin_log_add(me, null, p_key, case when p_on then 'activé' else 'coupé' end);
end $$;

revoke execute on function public.admin_switches_get(), public.admin_switch_set(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_switches_get(), public.admin_switch_set(text, boolean) to authenticated;

-- now: live, payments paused
update public.settings set test_mode = false, payments_off = true where id = 1;
update public.profiles set stock = 10, stock_at = now() where stock < 10;
