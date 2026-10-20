-- Genre packs (Boutique) cost more in Streams (400, was 100) and can also be paid in Vinyles (15). The pack remembers how
-- it was paid (packs.paid_with, packs.paid), so a booster that fails to fill is refunded the same way.
-- start_pack() gets a third parameter, p_pay ('streams' or 'vinyls'); it is the one from 20261010000600_gifted_cards.sql
-- otherwise. abandon_pack() is the one from 20261010000800_find_old_gifts.sql plus the refund in Vinyles.
update public.settings set genre_pack_price = 400;
alter table public.packs add column if not exists paid_with text, add column if not exists paid int;

drop function public.start_pack(text, int);
create function public.start_pack(p_kind text default 'booster', p_genre int default null, p_pay text default 'streams') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean; gift_god boolean := false; paid_with text; paid int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  delete from packs where owner = uid and not done and created_at < now() - interval '15 minutes';
  if (select count(*) from packs where owner = uid and not done) >= 3 then raise exception 'too_many_open_packs'; end if;

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
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.02 / 0.30 then 5 else 4 end;
      arts[1] := false;
    end if;
  end if;

  -- a card offered by an admin: the last card of this booster is that rarity, track or artist, Shiny or not (used up)
  if not god and p_kind = 'booster' then
    delete from forced_cards where id = uid returning kind, tier, shiny into gift_kind, gift, gift_shiny;
    if gift is not null then slots[5] := gift; arts[5] := gift_kind = 'artist'; end if;
  end if;

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot, gift_slot, gift_god, paid_with, paid)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end, case when gift is not null then 5 end, gift_god, paid_with, paid)
  returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

create or replace function public.abandon_pack(p_pack uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs;
begin
  delete from packs where id = p_pack and owner = uid and not done returning * into pk;
  if pk.id is null then return; end if;
  if pk.kind = 'genre' and pk.paid_with = 'vinyls' then
    perform add_vinyls(uid, pk.paid, 'remboursement d''un pack de la Boutique');
  elsif pk.kind = 'genre' then
    perform add_streams(uid, coalesce(pk.paid, (select genre_pack_price from settings)), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = least(10, stock + 1) where id = uid;
  end if;
  if pk.gift_god then insert into forced_gods (id) values (uid) on conflict (id) do nothing; end if;
  if pk.gift_slot is not null then
    insert into forced_cards (id, kind, tier, shiny)
    values (uid, case when pk.artist_slots[pk.gift_slot] then 'artist' else 'track' end, pk.slots[pk.gift_slot], pk.shiny_slot is not null)
    on conflict (id) do nothing;
  end if;
end $$;

revoke execute on function public.start_pack(text, int, text) from public, anon;
grant execute on function public.start_pack(text, int, text) to authenticated;
