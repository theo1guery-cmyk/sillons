-- Artist cards: a card is now a track OR an artist. Artist rarity is a sales certification based on
-- Deezer fans (Démo, Single, Argent, Or, Platine, Diamant, stored as tiers 0 to 5). 1 card in 50
-- of a booster is an artist; completing a discography gives that artist's Collector card (account-bound).

-- ---------------------------------------------------------------- schema
alter table public.artists add column nb_album int not null default 0;

alter table public.cards
  add column kind text not null default 'track' check (kind in ('track', 'artist')),
  add column artist_id bigint references public.artists,
  add column collector boolean not null default false,
  alter column track_id drop not null,
  add constraint cards_kind_ref check ((kind = 'track' and track_id is not null) or (kind = 'artist' and artist_id is not null));
create index cards_owner_artist_idx on public.cards (owner, artist_id) where kind = 'artist';

alter table public.packs add column artist_slots boolean[] not null default '{}';

alter table public.listings
  alter column track_id drop not null,
  add column kind text not null default 'track',
  add column artist_id bigint references public.artists,
  add column picture text not null default '';
alter table public.sales alter column track_id drop not null, add column artist_id bigint;
create index sales_artist_idx on public.sales (artist_id, sold_at desc);

-- certification from Deezer fans
create function public.cert_of(fans int) returns smallint language sql immutable set search_path = public as $$
  select case when fans >= 10000000 then 5 when fans >= 1000000 then 4 when fans >= 150000 then 3
              when fans >= 20000 then 2 when fans >= 1000 then 1 else 0 end::smallint
$$;

-- ---------------------------------------------------------------- boosters: some slots become artists
create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  delete from packs where owner = uid and not done and created_at < now() - interval '15 minutes';
  if (select count(*) from packs where owner = uid and not done) >= 3 then raise exception 'too_many_open_packs'; end if;

  if p_kind = 'genre' then
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

  insert into packs (owner, kind, genre, slots, god, artist_slots) values (uid, p_kind, p_genre, slots, god, arts) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

-- p_tracks holds a Deezer track id, or an artist id for the artist slots
create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 then raise exception 'need_five_tracks'; end if;

  for i in 1..5 loop
    is_artist := coalesce(pk.artist_slots[i], false);
    holo := random() < 0.04;
    if is_artist then
      a := deezer('artist/' || p_tracks[i]);
      if a ->> 'error' is not null or a ->> 'id' is null then raise exception 'artist_not_found %', p_tracks[i]; end if;
      r := coalesce((a ->> 'nb_fan')::int, 0);
      tier := least(cert_of(r), pk.slots[i]);
      insert into artists (id, name, picture, fans, nb_album, fetched_at)
      values (p_tracks[i], coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
              r, coalesce((a ->> 'nb_album')::int, 0), to_timestamp(0))      -- discography list still to fetch
      on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans, nb_album = excluded.nb_album;
      was_owned := exists (select 1 from cards where owner = uid and kind = 'artist' and artist_id = p_tracks[i]);
      insert into cards (owner, kind, artist_id, tier, rank, holo, source)
      values (uid, 'artist', p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end)
      returning id into card_id;
    else
      if exists (select 1 from unnest(p_tracks) with ordinality u(x, j) where u.x = p_tracks[i] and u.j <> i
                 and not coalesce(pk.artist_slots[u.j], false)) then
        raise exception 'need_five_tracks';
      end if;
      t := deezer('track/' || p_tracks[i]);
      if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', p_tracks[i]; end if;
      a := deezer('album/' || (t -> 'album' ->> 'id'));
      r := coalesce((t ->> 'rank')::int, 0);
      tier := least(tier_of(r), pk.slots[i]);
      insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
      values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
              coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
              coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
              coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
              coalesce((t ->> 'explicit_lyrics')::boolean, false), type_of_genre(coalesce((a ->> 'genre_id')::int, -1)),
              (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
      on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
        cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
        explicit = excluded.explicit, genre = excluded.genre, album_id = excluded.album_id,
        artist_id = excluded.artist_id, updated_at = now();
      perform save_album(a);
      was_owned := exists (select 1 from cards where owner = uid and track_id = p_tracks[i]);
      insert into cards (owner, track_id, tier, rank, holo, source)
      values (uid, p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end)
      returning id into card_id;
    end if;
    top := greatest(top, tier);
    out := out || jsonb_build_object('card', card_id, 'kind', case when is_artist then 'artist' else 'track' end,
                                     'track', p_tracks[i], 'tier', tier, 'rank', r,
                                     'holo', holo, 'new', not was_owned, 'wanted', pk.slots[i]);
  end loop;

  update packs set done = true where id = pk.id;
  update profiles set opened = opened + 1,
                      dry = case when top >= 4 then 0 else dry + 1 end,
                      gods = gods + case when pk.god then 1 else 0 end
  where id = uid;
  return out;
end $$;

-- ---------------------------------------------------------------- counters
create or replace function public.on_card_pulled() returns trigger
language plpgsql security definer set search_path = public as $$
declare g smallint;
begin
  if new.source not in ('booster', 'genre', 'god') then return new; end if;
  perform bump(new.owner, 'cards');
  if new.tier >= 2 then perform bump(new.owner, 'tier2'); end if;
  if new.tier >= 3 then perform bump(new.owner, 'tier3'); end if;
  if new.holo then perform bump(new.owner, 'holo'); end if;
  if new.kind = 'artist' then
    perform bump(new.owner, 'artists');
    if not exists (select 1 from cards where owner = new.owner and kind = 'artist' and artist_id = new.artist_id and id <> new.id) then
      perform bump(new.owner, 'new');
    end if;
  else
    select genre into g from tracks where id = new.track_id;
    if g is not null then perform bump(new.owner, 'genre' || g); end if;
    if not exists (select 1 from cards where owner = new.owner and track_id = new.track_id and id <> new.id) then
      perform bump(new.owner, 'new');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- discard: one copy per track or artist always stays
create or replace function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from cards where id = any(p_cards) and collector) then raise exception 'collector_card'; end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then
    raise exception 'card_listed';
  end if;
  if exists (select 1 from cards c where c.owner = uid and c.id = any(p_cards)
             group by c.kind, coalesce(c.track_id, c.artist_id)
             having count(*) >= (select count(*) from cards k where k.owner = uid and k.kind = c.kind
                                 and coalesce(k.track_id, k.artist_id) = coalesce(c.track_id, c.artist_id))) then
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
    select c.id, c.collector, row_number() over (partition by c.kind, coalesce(c.track_id, c.artist_id) order by
             c.collector desc,
             (exists (select 1 from listings l where l.card_id = c.id and l.status = 'active')) desc,
             c.holo desc, c.tier desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid
  ) x where rn > 1 and not x.collector
    and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = x.id and o.status = 'pending')
    and not exists (select 1 from listings l where l.card_id = x.id and l.status = 'active' and l.expires_at > now());
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;

-- ---------------------------------------------------------------- market: artist listings and cote
create or replace function public.create_listing(p_card uuid, p_price bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s settings; c cards; t tracks; ar artists; lid uuid;
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
  if c.kind = 'artist' then
    select * into ar from artists where id = c.artist_id;
    insert into listings (seller, card_id, kind, artist_id, picture, tier, holo, title, artist, genre, price, expires_at)
    values (uid, c.id, 'artist', c.artist_id, ar.picture, c.tier, c.holo, ar.name, 'Artiste', 10, p_price, now() + s.listing_days * interval '1 day')
    returning id into lid;
  else
    select * into t from tracks where id = c.track_id;
    insert into listings (seller, card_id, track_id, tier, holo, title, artist, genre, price, expires_at)
    values (uid, c.id, c.track_id, c.tier, c.holo, t.title, t.artist, t.genre, p_price, now() + s.listing_days * interval '1 day')
    returning id into lid;
  end if;
  return lid;
end $$;

create or replace function public.buy_listing(p_listing uuid) returns jsonb
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
  insert into sales (track_id, artist_id, tier, holo, price, seller, buyer)
  values (l.track_id, case when l.kind = 'artist' then l.artist_id end, l.tier, l.holo, l.price, l.seller, uid);
  perform bump(uid, 'buys');
  perform bump(l.seller, 'sales');
  return jsonb_build_object('status', 'bought', 'price', l.price, 'fee', fee);
end $$;

drop function public.price_stats(bigint);
create function public.price_stats(p_track bigint default null, p_artist bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales', count(*),
    'last', (select price from sales where (p_artist is null and track_id = p_track) or (p_artist is not null and artist_id = p_artist and track_id is null)
             order by sold_at desc limit 1),
    'avg', round(avg(price)), 'min', min(price), 'max', max(price),
    'lowest_listing', (select min(price) from listings where status = 'active' and expires_at > now()
                       and ((p_artist is null and track_id = p_track) or (p_artist is not null and kind = 'artist' and artist_id = p_artist))))
  from (select price from sales where (p_artist is null and track_id = p_track) or (p_artist is not null and artist_id = p_artist and track_id is null)
        order by sold_at desc limit 20) recent
$$;

-- ---------------------------------------------------------------- the Collector card for a complete discography
create or replace function public.claim_discography(p_artist bigint) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r artists; reward int;
begin
  select * into r from artists where id = p_artist;
  if r.id is null or cardinality(r.studio_albums) = 0 then raise exception 'artist_not_found'; end if;
  if exists (select 1 from unnest(r.studio_albums) s(id)
             where not exists (select 1 from album_claims k where k.owner = uid and k.album_id = s.id)) then
    raise exception 'discography_incomplete';
  end if;
  reward := greatest(500, 200 * cardinality(r.studio_albums));
  insert into disco_claims (owner, artist_id, reward) values (uid, p_artist, reward) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  perform add_streams(uid, reward, 'discographie complète : ' || r.name);
  insert into cards (owner, kind, artist_id, tier, rank, holo, tradeable, collector, source)
  values (uid, 'artist', p_artist, cert_of(r.fans), r.fans, true, false, true, 'collector');
  return reward;
end $$;

-- ---------------------------------------------------------------- achievements + daily challenge
insert into public.achievements values
  ('artists', 9, 'Collection', 'Mur des artistes', 'Cartes d''artiste différentes', '{10,50,200}', '{50,250,1000}', '{Groupie,Tourneur,Producteur}');
insert into public.daily_defs values ('artist1', 'Tire une carte d''artiste', 'artists', 1, 30);

create or replace function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.*, t.artist, t.year, t.genre, t.duration, t.bpm from cards c join tracks t on t.id = c.track_id where c.owner = p_user),
       p as (select * from profiles where id = p_user)
  select jsonb_build_object(
    'collector', (select count(distinct track_id) from c),
    'legends', (select count(*) from cards where owner = p_user and tier = 5 and kind = 'track'),
    'mythics', (select count(*) from cards where owner = p_user and tier = 4 and kind = 'track'),
    'holos', (select count(*) from cards where owner = p_user and holo),
    'rainbow', (select count(distinct tier) from c),
    'god', (select gods from p),
    'albums', (select count(*) from album_claims where owner = p_user),
    'discos', (select count(*) from disco_claims where owner = p_user),
    'artists', (select count(distinct artist_id) from cards where owner = p_user and kind = 'artist'),
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
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int), public.cert_of(int) to anon, authenticated;
grant execute on function public.price_stats(bigint, bigint) to authenticated;
