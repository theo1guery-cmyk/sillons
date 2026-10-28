-- New odds (the game was too stingy at the top):
--  * a card of a booster: Commune 67 %, Peu commune 22,5 %, Rare 8 %, Épique 2 %, Mythique 0,45 %, Légendaire 0,05 %
--    (snow storms of Christmas: Mythique 0,9 %, Légendaire 0,1 %);
--  * 1 card in 30 is an artist, its certification with its own odds: Démo 40 %, Single 30 %, Argent 18 %, Or 9,75 %,
--    Platine 2 %, Diamant 0,25 % (doubled for Platine and Diamant during a storm);
--  * Shiny 2 %, GOD pack 1 in 2 000, a Mythique or better guaranteed after 50 boosters without;
--  * the big booster of the VIP pass: Rare 72 %, Épique 21 %, Mythique 5,5 %, Légendaire 1,5 %.

create or replace function public.roll_tier() returns smallint language plpgsql volatile set search_path = public as $$
declare r double precision := random() * 100;
begin
  if storm_on() then                                   -- Noël: Mythiques and Légendaires twice as likely
    if r < 66.5 then return 0; end if;
    if r < 89 then return 1; end if;
    if r < 97 then return 2; end if;
    if r < 99 then return 3; end if;
    if r < 99.9 then return 4; end if;
    return 5;
  end if;
  if r < 67 then return 0; end if;
  if r < 89.5 then return 1; end if;
  if r < 97.5 then return 2; end if;
  if r < 99.5 then return 3; end if;
  if r < 99.95 then return 4; end if;
  return 5;
end $$;

create or replace function public.roll_artist_tier() returns smallint language plpgsql volatile set search_path = public as $$
declare r double precision := random() * 100;
begin
  if storm_on() then
    if r < 37.75 then return 0; end if;
    if r < 67.75 then return 1; end if;
    if r < 85.75 then return 2; end if;
    if r < 95.5 then return 3; end if;
    if r < 99.5 then return 4; end if;
    return 5;
  end if;
  if r < 40 then return 0; end if;
  if r < 70 then return 1; end if;
  if r < 88 then return 2; end if;
  if r < 97.75 then return 3; end if;
  if r < 99.75 then return 4; end if;
  return 5;
end $$;
revoke execute on function public.roll_artist_tier() from public, anon, authenticated;

create or replace function public.big_tier() returns smallint language sql volatile as $$
  select case when x < .72 then 2 when x < .93 then 3 when x < .985 then 4 else 5 end::smallint from (select random() x) r
$$;
revoke execute on function public.big_tier() from public, anon, authenticated;

update public.settings set shiny_chance = 0.02, god_chance = 1.0 / 2000, pity = 50;

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null, p_pay text default 'streams') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean; gift_god boolean := false; paid_with text; paid int; gift_reason text; old packs; dry_now int; x_pw text; x_paid int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre', 'big') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
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

  if p_kind = 'big' then                              -- a big booster of the VIP pass (15 cards, all Rare or better)
    if p.big_packs <= 0 and not exists (select 1 from packs where owner = uid and not done and parked and kind = 'big') then
      raise exception 'no_big_pack';
    end if;
    if not exists (select 1 from packs where owner = uid and not done and parked and kind = 'big') then
      update profiles set big_packs = big_packs - 1 where id = uid;
    end if;
    paid_with := 'big'; paid := 1;
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

  if p_kind = 'big' then
    for i in 1..15 loop
      slots := slots || big_tier();
      arts := arts || (random() < 1.0 / 30);
    end loop;
    insert into packs (owner, kind, genre, slots, god, artist_slots, paid_with, paid)
    values (uid, 'big', null, slots, false, arts, 'big', 1) returning id into pack_id;
    return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', false);
  end if;

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
      arts := arts || (p_kind = 'booster' and random() < 1.0 / 30);   -- 1 card in 30 is an artist, with the odds of the certifications
      slots := slots || case when arts[i] then roll_artist_tier() else roll_tier() end;
    end loop;
    if slots[5] < 2 then slots[5] := 2; end if;         -- the last card is Rare or better
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.05 / 0.50 then 5 else 4 end;
      arts[1] := false;
    end if;
    if (select max(x) from unnest(slots) x) >= 4 then dry_now := 0; end if;   -- the guarantee serves one booster, not three opened at once
  end if;

  -- a card offered by an admin: the last card of this booster is that rarity, track or artist, Shiny or not (used up)
  if not god and p_kind = 'booster' then
    delete from forced_cards where id = uid returning kind, tier, shiny, reason into gift_kind, gift, gift_shiny, gift_reason;
    if gift is not null then slots[5] := gift; arts[5] := gift_kind = 'artist'; end if;
  end if;

  if dry_now <> p.dry then update profiles set dry = 0 where id = uid; end if;

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot, gift_slot, gift_god, paid_with, paid, gift_reason)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end, case when gift is not null then 5 end, gift_god, paid_with, paid, gift_reason)
  returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;
