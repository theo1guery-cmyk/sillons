-- Collection Hantée: the copies can be graded (600 Streams, the same roll as the other cards, a certificate number;
-- their number N° xx/10 stays their rank) and sold between players for Streams, from the board at the witch's and
-- from the collection page. A copy on sale cannot be graded; the case can be cracked to grade it again. The seller
-- receives the price minus the market fee; the grade goes with the card.

alter table public.haunted_cards
  add column if not exists grade smallint check (grade between 1 and 10),
  add column if not exists grade_cert bigint unique,
  add column if not exists graded_at timestamptz;

create table if not exists public.haunted_listings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.haunted_cards on delete cascade,
  seller uuid references public.profiles on delete set null,
  price bigint not null check (price > 0),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists haunted_listings_one_active on public.haunted_listings (card_id) where status = 'active';
alter table public.haunted_listings enable row level security;      -- read through haunted_collection only

create or replace function public.haunted_grade(p_card uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); h haunted_cards; e haunted_editions; g smallint; cert bigint; price int := 600;
begin
  select * into h from haunted_cards where id = p_card and owner = uid for update;
  if h.id is null then raise exception 'card_not_owned'; end if;
  if h.grade is not null then raise exception 'already_graded'; end if;
  if exists (select 1 from haunted_listings where card_id = p_card and status = 'active') then raise exception 'card_listed'; end if;
  if (select streams from profiles where id = uid) < price then raise exception 'not_enough_streams'; end if;
  select * into e from haunted_editions where slot = h.slot;
  perform add_streams(uid, -price, 'gradation : ' || e.title || ' (Collection Hantée)');
  g := roll_grade(); cert := nextval('grade_cert_seq');
  update haunted_cards set grade = g, grade_cert = cert, graded_at = now() where id = p_card;
  return jsonb_build_object('grade', g, 'cert', cert, 'price', price);
end $$;

create or replace function public.haunted_crack(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_listings where card_id = p_card and status = 'active') then raise exception 'card_listed'; end if;
  update haunted_cards set grade = null, grade_cert = null, graded_at = null where id = p_card and owner = uid and grade is not null;
  if not found then raise exception 'card_not_owned'; end if;
end $$;

create or replace function public.haunted_sell(p_card uuid, p_price bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); lid uuid;
begin
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;
  perform 1 from haunted_cards where id = p_card and owner = uid for update;
  if not found then raise exception 'card_not_owned'; end if;
  if exists (select 1 from haunted_listings where card_id = p_card and status = 'active') then raise exception 'card_listed'; end if;
  if p_price < 100 then raise exception 'haunted_price_low'; end if;
  if p_price > 10000000 then raise exception 'price_too_high'; end if;
  insert into haunted_listings (card_id, seller, price) values (p_card, uid, p_price) returning id into lid;
  return lid;
end $$;

create or replace function public.haunted_unsell(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update haunted_listings set status = 'cancelled', closed_at = now() where card_id = p_card and seller = uid and status = 'active';
  if not found then raise exception 'listing_not_found'; end if;
end $$;

create or replace function public.haunted_buy(p_listing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); l haunted_listings; e haunted_editions; h haunted_cards; fee bigint; who text;
begin
  select * into l from haunted_listings where id = p_listing for update;
  if l.id is null then raise exception 'listing_not_found'; end if;
  if l.status <> 'active' then raise exception 'listing_closed'; end if;
  if l.seller = uid then raise exception 'own_listing'; end if;
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;
  select * into h from haunted_cards where id = l.card_id for update;
  if h.owner is distinct from l.seller then
    update haunted_listings set status = 'cancelled', closed_at = now() where id = l.id;
    raise exception 'listing_closed';
  end if;
  if (select streams from profiles where id = uid for update) < l.price then raise exception 'not_enough_streams'; end if;
  select * into e from haunted_editions where slot = h.slot;
  fee := floor(l.price * (select market_fee_pct from settings) / 100.0);
  perform add_streams(uid, -l.price, 'achat : ' || e.title || ' (Collection Hantée)');
  perform add_streams(l.seller, l.price - fee, 'vente : ' || e.title || ' (Collection Hantée)');
  update haunted_cards set owner = uid where id = h.id;
  update haunted_listings set status = 'sold', buyer = uid, closed_at = now() where id = l.id;
  perform bump(uid, 'buys'); perform bump(l.seller, 'sales');
  begin                                                          -- the news on the Discord (never breaks the sale)
    select pseudo into who from profiles where id = uid;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '🦇 **' || discord_esc(who) || '** a acheté **' || discord_esc(e.title) || '** N° ' || lpad(h.no::text, length(e.copies::text), '0') || '/' || e.copies
                 || ' de la Collection Hantée pour **' || to_char(l.price, 'FM999G999G999') || ' Streams**'));
  exception when others then null;
  end;
  return jsonb_build_object('price', l.price, 'fee', fee, 'slot', h.slot, 'no', h.no);
end $$;

-- the board: each copy now says its owner's card id (mine only), its grade and its price when on sale
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'fee', (select market_fee_pct from settings),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', h.owner = uid,
                     'id', case when h.owner = uid then h.id end, 'grade', h.grade, 'cert', h.grade_cert,
                     'sale', (select jsonb_build_object('id', l.id, 'price', l.price) from haunted_listings l where l.card_id = h.id and l.status = 'active'))) order by h.no), '[]')
                   from haunted_cards h left join profiles p on p.id = h.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;

revoke execute on function public.haunted_grade(uuid), public.haunted_crack(uuid), public.haunted_sell(uuid, bigint), public.haunted_unsell(uuid), public.haunted_buy(uuid) from public, anon;
grant execute on function public.haunted_grade(uuid), public.haunted_crack(uuid), public.haunted_sell(uuid, bigint), public.haunted_unsell(uuid), public.haunted_buy(uuid) to authenticated;
