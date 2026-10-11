-- Security batch 1 (audit of 2026-10-11).
-- 1. import_collection() is dropped: it created the cards the browser sent (any rarity, Shiny, 50 copies, tradeable) and
--    wrote the browser's track data (cover URLs) into the shared tracks table. Covers that are not https URLs are erased.
-- 2. Free rerolls: start_pack() shows the rarities and abandon_pack() refunded the booster, so a script could abandon
--    until a GOD pack. Now an abandoned booster is put aside (packs.parked), refunded, and comes back with the same
--    rarities as the next booster of its kind: abandoning never draws again. Its gift stays in it (no gift lost), a
--    parked pack cannot be finished, and a booster left open for 15 min is put aside the same way (it was lost before).
-- 3. The refund of a booster no longer caps the stock at 10 (bought boosters were lost), and reset_collection() no longer
--    refills the stock to 10.
-- 4. The pity guarantee served up to 3 boosters opened at once: a booster that has a Mythique or better sets dry to 0
--    when it is drawn.
-- 5. Stripe: a one-time, daily or "fire" offer paid twice (several checkout pages open), a pass already owned or paid
--    with no season gives Vinyles at the normal rate (80 per euro) instead of the offer.

-- 1
drop function if exists public.import_collection(jsonb, int);
update public.tracks set cover = '' where cover <> '' and (cover !~ '^https://' or cover ~ '[\s"''<>]');

-- 2
alter table public.packs add column if not exists parked boolean not null default false;

create or replace function public.park_pack(pk packs) returns void
language plpgsql security definer set search_path = public as $$
begin
  update packs set parked = true where id = pk.id;
  if pk.kind = 'genre' and pk.paid_with = 'vinyls' then
    perform add_vinyls(pk.owner, pk.paid, 'remboursement d''un pack de la Boutique');
  elsif pk.kind = 'genre' then
    perform add_streams(pk.owner, coalesce(pk.paid, (select genre_pack_price from settings)), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = stock + 1 where id = pk.owner;
  end if;
end $$;

create or replace function public.abandon_pack(p_pack uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done and not parked for update;
  if pk.id is null then return; end if;
  perform park_pack(pk);
end $$;

create or replace function public.on_pack_finish_parked() returns trigger language plpgsql as $$
begin
  if new.done and not old.done and old.parked then raise exception 'pack_parked'; end if;
  return new;
end $$;
drop trigger if exists pack_finish_parked on public.packs;
create trigger pack_finish_parked before update of done on public.packs for each row execute function public.on_pack_finish_parked();

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null, p_pay text default 'streams') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean; gift_god boolean := false; paid_with text; paid int; old packs; dry_now int; x_pw text; x_paid int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  -- a booster left open (page closed…) is put aside, refunded, and comes back as the next booster of its kind
  for old in select * from packs where owner = uid and not done and not parked and created_at < now() - interval '15 minutes' for update loop
    perform park_pack(old);
  end loop;
  select * into p from profiles where id = uid;
  if (select count(*) from packs where owner = uid and not done and not parked) >= 3 then raise exception 'too_many_open_packs'; end if;

  if p_kind = 'genre' and p_pay = 'vinyls' then          -- a genre pack paid in Vinyles
    if p.vinyls < 15 then raise exception 'not_enough_vinyls'; end if;
    perform add_vinyls(uid, -15, 'pack de la Boutique');
    paid_with := 'vinyls'; paid := 15;
  elsif p_kind = 'genre' then
    if p.streams < s.genre_pack_price then raise exception 'not_enough_streams'; end if;
    perform add_streams(uid, -s.genre_pack_price, 'achat d''un pack de la Boutique');
    paid_with := 'streams'; paid := s.genre_pack_price;
  end if;

  p := refill_stock(p);
  if not s.test_mode and p_kind = 'booster' then
    if p.stock <= 0 then raise exception 'no_stock'; end if;
    if p.stock >= 10 then p.stock_at := now(); end if;
    p.stock := p.stock - 1;
  end if;
  update profiles set stock = p.stock, stock_at = p.stock_at where id = uid;

  -- a booster put aside comes back first, with the same rarities: abandoning never draws again
  select * into old from packs where owner = uid and not done and parked and kind = p_kind and genre is not distinct from p_genre
  order by created_at limit 1 for update;
  if old.id is not null then
    x_pw := paid_with; x_paid := paid;
    update packs set parked = false, created_at = now(), paid_with = x_pw, paid = x_paid where id = old.id;
    return jsonb_build_object('id', old.id, 'slots', to_jsonb(old.slots), 'artists', to_jsonb(old.artist_slots), 'god', old.god);
  end if;
  dry_now := p.dry;

  god := p_kind = 'booster' and random() < s.god_chance;
  -- a GOD pack offered by an admin: this booster is it (the gift is used up)
  if p_kind = 'booster' then
    delete from forced_gods where id = uid;
    if found then god := true; gift_god := true; end if;
  end if;
  if god then
    slots := array[5]::smallint[];
    for i in 1..4 loop slots := slots || (case when random() < .5 then 4 else 5 end)::smallint; end loop;
    arts := array[false, false, false, false, false];
  else
    for i in 1..5 loop
      slots := slots || roll_tier();
      arts := arts || (p_kind = 'booster' and random() < 0.02);   -- 1 card in 50 is an artist
    end loop;
    if slots[5] < 2 then slots[5] := 2; end if;         -- the last card is Rare or better
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.02 / 0.30 then 5 else 4 end;
      arts[1] := false;
    end if;
    if (select max(x) from unnest(slots) x) >= 4 then dry_now := 0; end if;   -- the guarantee serves one booster, not three opened at once
  end if;

  -- a card offered by an admin: the last card of this booster is that rarity, track or artist, Shiny or not (used up)
  if not god and p_kind = 'booster' then
    delete from forced_cards where id = uid returning kind, tier, shiny into gift_kind, gift, gift_shiny;
    if gift is not null then slots[5] := gift; arts[5] := gift_kind = 'artist'; end if;
  end if;

  if dry_now <> p.dry then update profiles set dry = 0 where id = uid; end if;

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot, gift_slot, gift_god, paid_with, paid)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end, case when gift is not null then 5 end, gift_god, paid_with, paid)
  returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

-- 3
create or replace function public.reset_collection() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update offers set status = 'cancelled', decided_at = now()
  where status = 'pending' and (from_user = uid or to_user = uid);
  delete from cards where owner = uid;
  delete from packs where owner = uid and not parked;
  update profiles set opened = 0, dry = 0, gods = 0 where id = uid;
end $$;

-- 5
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
  insert into purchases (session_id, owner, pack, cents, vinyls) values (p_session, p_user, p_pack, p_cents, v) on conflict do nothing;
  if not found then return; end if;
  if taken then                                         -- already used: the money becomes Vinyles at the normal rate
    perform add_vinyls(p_user, v, 'achat : ' || k.name || ' (déjà pris, converti en Vinyles)');
    return;
  end if;
  if k.vinyls > 0 then perform add_vinyls(p_user, k.vinyls, 'achat : ' || k.name); end if;
  if k.boosters > 0 then update profiles set stock = stock + k.boosters where id = p_user; end if;
  if k.card_kind is not null then perform give_card(p_user, k.card_kind, k.card_tier, k.card_shiny); end if;
  if k.premium then
    insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
    on conflict (owner, season_id) do update set premium = true;
  end if;
end $$;

revoke execute on function public.park_pack(packs), public.on_pack_finish_parked() from public, anon, authenticated;
revoke execute on function public.credit_purchase(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.credit_purchase(text, uuid, text, int) to service_role;
revoke execute on function public.start_pack(text, int, text), public.abandon_pack(uuid), public.reset_collection() from public, anon;
grant execute on function public.start_pack(text, int, text), public.abandon_pack(uuid), public.reset_collection() to authenticated;
