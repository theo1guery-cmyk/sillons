-- The market ("La Bourse aux disques"): fixed-price listings paid in Streams, 5 % fee,
-- price history per track. Boutique packs now cost Streams.

alter table public.settings
  add column genre_pack_price int not null default 100,
  add column market_fee_pct int not null default 5,
  add column listing_days int not null default 7,
  add column max_listings int not null default 50;

-- ---------------------------------------------------------------- paid Boutique packs
create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; god boolean := false; pack_id uuid; i int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  delete from packs where owner = uid and not done and created_at < now() - interval '15 minutes';
  if (select count(*) from packs where owner = uid and not done) >= 3 then raise exception 'too_many_open_packs'; end if;

  if p_kind = 'genre' then                     -- Boutique packs are bought with Streams, test mode or not
    if p.streams < s.genre_pack_price then raise exception 'not_enough_streams'; end if;
    perform add_streams(uid, -s.genre_pack_price, 'achat d''un pack de la Boutique');
  end if;

  p := refill_stock(p);
  if not s.test_mode and p_kind = 'booster' then
    if p.stock <= 0 then raise exception 'no_stock'; end if;
    if p.stock >= 10 then p.stock_at := now(); end if;
    p.stock := p.stock - 1;
  end if;
  update profiles set stock = p.stock, stock_at = p.stock_at where id = uid;

  god := p_kind = 'booster' and random() < s.god_chance;
  if god then
    slots := array[5]::smallint[];
    for i in 1..4 loop slots := slots || (case when random() < .5 then 4 else 5 end)::smallint; end loop;
  else
    for i in 1..5 loop slots := slots || roll_tier(); end loop;
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.02 / 0.30 then 5 else 4 end;
    end if;
  end if;

  insert into packs (owner, kind, genre, slots, god) values (uid, p_kind, p_genre, slots, god) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'god', god);
end $$;

-- a failed opening gives back the booster from the stock, or the Streams of a Boutique pack
create or replace function public.abandon_pack(p_pack uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs;
begin
  delete from packs where id = p_pack and owner = uid and not done returning * into pk;
  if pk.id is null then return; end if;
  if pk.kind = 'genre' then
    perform add_streams(uid, (select genre_pack_price from settings), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = least(10, stock + 1) where id = uid;
  end if;
end $$;

-- ---------------------------------------------------------------- listings
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller uuid not null references public.profiles on delete cascade,
  card_id uuid not null references public.cards on delete cascade,
  -- copied from the card at listing time, so the market can be searched and sorted
  track_id bigint not null references public.tracks,
  tier smallint not null,
  holo boolean not null,
  title text not null,
  artist text not null,
  genre smallint not null,
  price bigint not null check (price > 0),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled', 'expired')),
  buyer uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);
create unique index listings_one_active_per_card on public.listings (card_id) where status = 'active';
create index listings_active_idx on public.listings (status, expires_at);
create index listings_seller_idx on public.listings (seller, status);
create index listings_search_idx on public.listings (lower(title), lower(artist)) where status = 'active';

create table public.sales (                     -- price history, kept even when cards are discarded
  id bigint generated always as identity primary key,
  track_id bigint not null references public.tracks,
  tier smallint not null,
  holo boolean not null,
  price bigint not null,
  seller uuid references public.profiles on delete set null,
  buyer uuid references public.profiles on delete set null,
  sold_at timestamptz not null default now()
);
create index sales_track_idx on public.sales (track_id, sold_at desc);

-- listings past their date are closed whenever the market is touched
create function public.expire_listings() returns void
language sql security definer set search_path = public as $$
  update listings set status = 'expired', closed_at = now() where status = 'active' and expires_at <= now()
$$;

create function public.is_listed(p_card uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from listings where card_id = p_card and status = 'active' and expires_at > now())
$$;

-- a card on sale cannot be put in a trade offer
create function public.offer_item_not_listed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_listed(new.card_id) then raise exception 'card_listed'; end if;
  return new;
end $$;
create trigger offer_item_not_listed before insert on public.offer_items
  for each row execute function public.offer_item_not_listed();

create function public.create_listing(p_card uuid, p_price bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s settings; c cards; t tracks; lid uuid;
begin
  select * into s from settings;
  perform expire_listings();
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null or not c.tradeable then raise exception 'card_not_owned'; end if;
  if is_listed(p_card) then raise exception 'card_listed'; end if;
  if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = p_card and o.status = 'pending') then
    raise exception 'card_in_offer';
  end if;
  if p_price < discard_value(c.tier) then raise exception 'price_too_low'; end if;
  if p_price > 10000000 then raise exception 'price_too_high'; end if;
  if (select count(*) from listings where seller = uid and status = 'active') >= s.max_listings then raise exception 'too_many_listings'; end if;
  select * into t from tracks where id = c.track_id;
  insert into listings (seller, card_id, track_id, tier, holo, title, artist, genre, price, expires_at)
  values (uid, c.id, c.track_id, c.tier, c.holo, t.title, t.artist, t.genre, p_price, now() + s.listing_days * interval '1 day')
  returning id into lid;
  return lid;
end $$;

create function public.cancel_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update listings set status = 'cancelled', closed_at = now() where id = p_listing and seller = uid and status = 'active';
  if not found then raise exception 'listing_not_found'; end if;
end $$;

-- the buyer pays, the seller receives the price minus the fee, the card changes hands: all or nothing
create function public.buy_listing(p_listing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s settings; l listings; fee bigint; bal bigint;
begin
  select * into s from settings;
  select * into l from listings where id = p_listing for update;
  if l.id is null then raise exception 'listing_not_found'; end if;
  if l.status <> 'active' or l.expires_at <= now() then raise exception 'listing_closed'; end if;
  if l.seller = uid then raise exception 'own_listing'; end if;
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;
  perform 1 from cards where id = l.card_id and owner = l.seller for update;
  if not found then
    update listings set status = 'cancelled', closed_at = now() where id = l.id;
    return jsonb_build_object('status', 'card_gone');
  end if;
  select streams into bal from profiles where id = uid for update;
  if bal < l.price then raise exception 'not_enough_streams'; end if;

  fee := floor(l.price * s.market_fee_pct / 100.0);
  perform add_streams(uid, -l.price, 'achat au marché : ' || l.title);
  perform add_streams(l.seller, l.price - fee, 'vente au marché : ' || l.title);
  update cards set owner = uid where id = l.card_id;
  update listings set status = 'sold', buyer = uid, closed_at = now() where id = l.id;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = l.card_id);
  insert into sales (track_id, tier, holo, price, seller, buyer) values (l.track_id, l.tier, l.holo, l.price, l.seller, uid);
  perform bump(uid, 'buys');
  perform bump(l.seller, 'sales');
  return jsonb_build_object('status', 'bought', 'price', l.price, 'fee', fee);
end $$;

-- the "cote" of a track: recent sales of any of its copies
create function public.price_stats(p_track bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales', count(*),
    'last', (select price from sales where track_id = p_track order by sold_at desc limit 1),
    'avg', round(avg(price)),
    'min', min(price),
    'max', max(price),
    'lowest_listing', (select min(price) from listings where track_id = p_track and status = 'active' and expires_at > now()))
  from (select price from sales where track_id = p_track order by sold_at desc limit 20) recent
$$;

-- ---------------------------------------------------------------- listed cards stay put
create or replace function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then
    raise exception 'card_listed';
  end if;
  if exists (select 1 from cards c where c.owner = uid and c.id = any(p_cards)
             group by c.track_id
             having count(*) >= (select count(*) from cards k where k.owner = uid and k.track_id = c.track_id)) then
    raise exception 'keep_one';
  end if;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  select coalesce(sum(discard_value(tier)), 0), count(*) into gained, removed from cards where owner = uid and id = any(p_cards);
  delete from cards where owner = uid and id = any(p_cards);
  perform add_streams(uid, gained, 'défausse de ' || removed || ' carte(s)');
  perform bump(uid, 'discards', removed);
  return jsonb_build_object('removed', removed, 'gained', gained);
end $$;

create or replace function public.discard_all_duplicates() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[];
begin
  select array_agg(id) into ids from (
    select c.id, row_number() over (partition by c.track_id order by
             (exists (select 1 from listings l where l.card_id = c.id and l.status = 'active')) desc,
             c.holo desc, c.tier desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid
  ) x where rn > 1
    and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = x.id and o.status = 'pending')
    and not exists (select 1 from listings l where l.card_id = x.id and l.status = 'active' and l.expires_at > now());
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;

-- ---------------------------------------------------------------- new daily challenges + Trader achievement
insert into public.daily_defs values
  ('sell1', 'Vends une carte au marché', 'sales', 1, 20),
  ('buy1', 'Achète une carte au marché', 'buys', 1, 15);
insert into public.achievements values
  ('trader', 23, 'Échanges et fidélité', 'Trader', 'Streams gagnés en vendant au marché', '{500,5000,50000}', '{50,250,1000}', '{Trader,Courtier,Loup de la Bourse}');

create or replace function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.*, t.artist, t.year, t.genre, t.duration, t.bpm from cards c join tracks t on t.id = c.track_id where c.owner = p_user),
       p as (select * from profiles where id = p_user)
  select jsonb_build_object(
    'collector', (select count(distinct track_id) from c),
    'legends', (select count(*) from c where tier = 5),
    'mythics', (select count(*) from c where tier = 4),
    'holos', (select count(*) from c where holo),
    'rainbow', (select count(distinct tier) from c),
    'god', (select gods from p),
    'digger', (select count(distinct track_id) from c where rank < 1000),
    'zero', (select count(*) from c where rank = 0),
    'decades', (select count(distinct year / 10) from c where year >= 1950),
    'genres', (select count(distinct genre) from c),
    'fan', (select coalesce(max(n), 0) from (select count(distinct track_id) n from c group by lower(artist)) a),
    'alphabet', (select count(distinct upper(left(artist, 1))) from c where upper(left(artist, 1)) between 'A' and 'Z'),
    'marathon', (select count(*) from c where duration > 600),
    'interlude', (select count(*) from c where duration between 1 and 59),
    'bpm200', (select count(*) from c where bpm >= 200),
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'opened', (select opened from p),
    'streak', (select best_streak from p),
    'trader', (select coalesce(sum(price - floor(price * (select market_fee_pct from settings) / 100.0)), 0) from sales where seller = p_user))
$$;

-- ---------------------------------------------------------------- access
alter table public.listings enable row level security;
alter table public.sales enable row level security;
create policy "listings are visible to players" on public.listings for select to authenticated using (true);
create policy "sales are visible to players" on public.sales for select to authenticated using (true);
revoke insert, update, delete on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int) to anon, authenticated;
grant execute on function public.create_listing(uuid, bigint), public.cancel_listing(uuid), public.buy_listing(uuid),
  public.price_stats(bigint) to authenticated;
revoke execute on function public.expire_listings(), public.is_listed(uuid), public.offer_item_not_listed()
  from authenticated;
