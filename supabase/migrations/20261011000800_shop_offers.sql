-- Shop, part 2: what Vinyles buy at the right moment, and the offers that make players pay.
--  * boosters: 10 for 80 Vinyles, 25 for 180 (shown when the stock is empty)
--  * the guaranteed Mythique now (stock empty, 5 boosters or less before the guarantee): 100 / 85 / 70 / 55 / 40 Vinyles
--    for 1 booster that is sure to hold it (the pity counter is set to its last step)
--  * the missing track of an album (1 or 2 missing): 30 to 500 Vinyles by rarity, the card cannot be traded
--  * season pass tiers: 40 Vinyles each, -20 % from 5 at once, -30 % from 10, -40 % from 20
--  * 80 Vinyles offered to every account (welcome gift), the first purchase of a Vinyles pack is doubled
--  * the offer of the day (changes at midnight, Paris time) and "Tu es en feu !" (1 hour after a GOD pack or a Légendaire)
-- Cards bought or won (pass, offers) go through give_card(): the last card of the next booster, and when one is already
-- waiting they queue up (card_queue) instead of failing.

-- ---------------------------------------------------------------- cards waiting their turn
create table public.card_queue (
  id bigint generated always as identity primary key,
  owner uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('track', 'artist')),
  tier smallint not null check (tier in (4, 5)),
  shiny boolean not null default false,
  created_at timestamptz not null default now()
);
create index card_queue_owner_idx on public.card_queue (owner, id);
alter table public.card_queue enable row level security;

create function public.give_card(p_user uuid, p_kind text, p_tier smallint, p_shiny boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into forced_cards (id, kind, tier, shiny) values (p_user, p_kind, p_tier, p_shiny) on conflict (id) do nothing;
  if not found then insert into card_queue (owner, kind, tier, shiny) values (p_user, p_kind, p_tier, p_shiny); end if;
end $$;

-- when the waiting card has been used (or cancelled), the next one in the queue takes its place
create function public.on_forced_card_used() returns trigger
language plpgsql security definer set search_path = public as $$
declare q card_queue;
begin
  delete from card_queue where id = (select id from card_queue where owner = old.id order by id limit 1) returning * into q;
  if q.id is not null then insert into forced_cards (id, kind, tier, shiny) values (q.owner, q.kind, q.tier, q.shiny) on conflict (id) do nothing; end if;
  return old;
end $$;
create trigger forced_card_used after delete on public.forced_cards for each row execute function public.on_forced_card_used();

-- the season pass gives its cards through the queue too (no more "a card is already waiting")
create or replace function public.claim_season(p_tier int, p_premium boolean) returns jsonb
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
  elsif r ->> 'kind' = 'vinyls' then
    perform add_vinyls(uid, (r ->> 'amount')::int, 'Pass saisonnier : palier ' || p_tier);
  elsif r ->> 'kind' = 'boosters' then
    update profiles set stock = stock + (r ->> 'amount')::int where id = uid;
  else
    c := r -> 'card';
    perform give_card(uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean);   -- queued if one is already waiting
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

-- ---------------------------------------------------------------- spending Vinyles

-- ---------------------------------------------------------------- 80 Vinyles to every account
create function public.on_profile_welcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform add_vinyls(new.id, 80, 'cadeau de bienvenue');
  return new;
exception when others then return new;
end $$;
create trigger profile_welcome after insert on public.profiles for each row execute function public.on_profile_welcome();
select public.add_vinyls(id, 80, 'cadeau de bienvenue') from public.profiles
where not exists (select 1 from public.vinyl_ledger l where l.owner = profiles.id and l.reason = 'cadeau de bienvenue');

-- ---------------------------------------------------------------- boosters for Vinyles
create function public.buy_boosters(p_count int) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); price int; bal int; st int;
begin
  price := case p_count when 10 then 80 when 25 then 180 end;
  if price is null then raise exception 'bad_pack'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < price then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -price, p_count || ' boosters');
  update profiles set stock = stock + p_count where id = uid returning stock into st;
  return st;
end $$;

-- the guaranteed Mythique, now: one booster whose pity is due (start_pack makes its first card a Mythique or better)
create function public.pity_price(p_left int) returns int language sql immutable as $$
  select case p_left when 1 then 40 when 2 then 55 when 3 then 70 when 4 then 85 when 5 then 100 end
$$;
create function public.buy_pity() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s settings; p profiles; left_n int; price int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  p := refill_stock(p);
  update profiles set stock = p.stock, stock_at = p.stock_at where id = uid;
  if p.stock > 0 then raise exception 'stock_not_empty'; end if;
  left_n := s.pity - p.dry;
  price := pity_price(left_n);
  if price is null then raise exception 'pity_far'; end if;
  if p.vinyls < price then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -price, 'Mythique garantie');
  update profiles set stock = stock + 1, dry = greatest(dry, s.pity - 1) where id = uid;
end $$;

-- ---------------------------------------------------------------- the missing track of an album
create function public.album_track_price(p_tier int) returns int language sql immutable as $$
  select (array[30, 45, 70, 110, 250, 500])[least(5, greatest(0, p_tier)) + 1]
$$;
create function public.buy_album_track(p_album bigint, p_track bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); al albums; missing bigint[]; t jsonb; a jsonb; r int; tier smallint; price int; bal int; card_id uuid;
begin
  select * into al from albums where id = p_album;
  if al.id is null or not al.complete or al.record_type not in ('album', 'ep') then raise exception 'album_not_found'; end if;
  select array_agg((e ->> 'id')::bigint) into missing from jsonb_array_elements(al.tracks) e
  where not exists (select 1 from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint);
  if coalesce(array_length(missing, 1), 0) = 0 or array_length(missing, 1) > 2 or not (p_track = any(missing)) then raise exception 'album_far'; end if;
  t := deezer('track/' || p_track);
  if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', p_track; end if;
  a := deezer('album/' || (t -> 'album' ->> 'id'));
  r := coalesce((t ->> 'rank')::int, 0);
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
  tier := tier_of(r);
  price := album_track_price(tier);
  select vinyls into bal from profiles where id = uid for update;
  if bal < price then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -price, 'titre d''album : ' || coalesce(t ->> 'title', '?'));
  insert into cards (owner, track_id, tier, rank, holo, tradeable, source)
  values (uid, p_track, tier, r, false, false, 'shop') returning id into card_id;
  return jsonb_build_object('card', card_id, 'tier', tier, 'price', price);
end $$;

-- ---------------------------------------------------------------- season pass tiers: 40 each, cheaper in bulk
create function public.tiers_price(p_count int) returns int language sql immutable as $$
  select round(40 * p_count * case when p_count >= 20 then .6 when p_count >= 10 then .7 when p_count >= 5 then .8 else 1 end)::int
$$;
create function public.buy_season_tiers(p_count int) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); p season_progress; t int; bal int; price int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  insert into season_progress (owner, season_id) values (uid, s.id) on conflict do nothing;
  select * into p from season_progress where owner = uid and season_id = s.id for update;
  t := p.xp / s.xp_per_tier;
  if t >= s.tiers then raise exception 'max_tier'; end if;
  if p_count < 1 or t + p_count > s.tiers then raise exception 'bad_amount'; end if;
  price := tiers_price(p_count);
  select vinyls into bal from profiles where id = uid for update;
  if bal < price then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -price, 'Pass saisonnier : ' || p_count || ' palier' || case when p_count > 1 then 's' else '' end);
  update season_progress set xp = (t + p_count) * s.xp_per_tier where owner = uid and season_id = s.id;
  return t + p_count;
end $$;
create or replace function public.buy_season_tier() returns int
language sql security definer set search_path = public as $$ select buy_season_tiers(1) $$;

-- ---------------------------------------------------------------- paid offers
alter table public.shop_packs
  add column if not exists boosters int not null default 0,
  add column if not exists card_kind text,
  add column if not exists card_tier smallint,
  add column if not exists card_shiny boolean not null default false,
  add column if not exists daily boolean not null default false,   -- one of the offers of the day (one a day, in turn)
  add column if not exists fire boolean not null default false;    -- "Tu es en feu !": 1 hour after a GOD pack or a Légendaire
insert into public.shop_packs (id, name, cents, vinyls, boosters, card_kind, card_tier, card_shiny, daily, fire) values
  ('day_leg', 'Offre du jour : 500 Vinyles + 1 Légendaire garantie', 499, 500, 0, 'track', 5, false, true, false),
  ('day_boost', 'Offre du jour : 40 boosters + 150 Vinyles', 299, 150, 40, null, null, false, true, false),
  ('day_plat', 'Offre du jour : 1 artiste Platine garanti + 300 Vinyles', 499, 300, 0, 'artist', 4, false, true, false),
  ('day_shiny', 'Offre du jour : 1 Légendaire Shiny garantie + 200 Vinyles', 799, 200, 0, 'track', 5, true, true, false),
  ('fire', 'Tu es en feu ! 50 boosters', 299, 0, 50, null, null, false, false, true);

create function public.today_offer() returns text language sql stable security definer set search_path = public as $$
  select id from shop_packs where daily order by id
  offset ((game_day() - date '2026-01-01') % greatest(1, (select count(*) from shop_packs where daily)::int)) limit 1
$$;
-- until when the player can take "Tu es en feu !" (null: not now)
create function public.fire_until(p_user uuid) returns timestamptz language sql stable security definer set search_path = public as $$
  select case when x.at is not null and not exists (select 1 from purchases where owner = p_user and pack = 'fire' and created_at >= x.at)
              then x.at + interval '1 hour' end
  from (select max(pulled_at) at from cards where owner = p_user and pulled_at > now() - interval '1 hour'
          and ((kind = 'track' and tier = 5) or source = 'god')) x
$$;

create or replace function public.shop_quote(p_pack text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; s seasons;
begin
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

-- delivery: Vinyles (doubled on the very first purchase of a Vinyles pack), boosters, a card, the Premium pass
create or replace function public.credit_purchase(p_session text, p_user uuid, p_pack text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare k shop_packs; s seasons; first boolean; v int;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  first := not exists (select 1 from purchases where owner = p_user);
  v := k.vinyls * case when first and k.id like 'v%' then 2 else 1 end;
  insert into purchases (session_id, owner, pack, cents, vinyls) values (p_session, p_user, p_pack, p_cents, v) on conflict do nothing;
  if not found then return; end if;
  if v > 0 then perform add_vinyls(p_user, v, 'achat : ' || k.name || case when v > k.vinyls then ' (premier achat doublé)' else '' end); end if;
  if k.boosters > 0 then update profiles set stock = stock + k.boosters where id = p_user; end if;
  if k.card_kind is not null then perform give_card(p_user, k.card_kind, k.card_tier, k.card_shiny); end if;
  if k.premium then
    s := current_season();
    if s.id is not null then
      insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
      on conflict (owner, season_id) do update set premium = true;
    end if;
  end if;
end $$;

-- what the shop shows this player
create function public.my_shop() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := require_user(); d shop_packs; p profiles; s settings;
begin
  select * into d from shop_packs where id = today_offer();
  select * into p from profiles where id = uid;
  select * into s from settings;
  return jsonb_build_object(
    'used', (select coalesce(jsonb_agg(distinct x.pack), '[]') from purchases x join shop_packs k on k.id = x.pack and k.once where x.owner = uid),
    'bought', exists (select 1 from purchases where owner = uid),
    'daily', jsonb_build_object('id', d.id, 'name', d.name, 'cents', d.cents, 'vinyls', d.vinyls, 'boosters', d.boosters,
               'card', case when d.card_kind is not null then jsonb_build_object('kind', d.card_kind, 'tier', d.card_tier, 'shiny', d.card_shiny) end,
               'taken', exists (select 1 from purchases where owner = uid and pack = d.id and (created_at at time zone 'Europe/Paris')::date = game_day()),
               'ends_at', ((game_day() + 1)::timestamp at time zone 'Europe/Paris')),
    'fire_until', fire_until(uid),
    'pity_left', s.pity - p.dry);
end $$;

revoke execute on function public.give_card(uuid, text, smallint, boolean), public.on_forced_card_used(), public.on_profile_welcome(),
  public.fire_until(uuid) from public, anon, authenticated;
revoke execute on function public.buy_boosters(int), public.buy_pity(), public.buy_album_track(bigint, bigint), public.buy_season_tiers(int),
  public.my_shop() from public, anon;
grant execute on function public.buy_boosters(int), public.buy_pity(), public.buy_album_track(bigint, bigint), public.buy_season_tiers(int),
  public.my_shop() to authenticated;
