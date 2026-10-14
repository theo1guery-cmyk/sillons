-- The pass comes back, measured. Free track unchanged (Mythique at 10 and 20, Légendaire at 30, boosters, Streams).
-- VIP (4,99 € or 500 Vinyles):
--   * a booster every 3 minutes in the stock during the season (10 minutes for everybody else): the one advantage
--     that can be bought;
--   * 3 big boosters (tiers 5, 15, 25): 15 cards, every one Rare or better (they don't count for the daily challenges
--     nor the guaranteed Mythique);
--   * a Shiny surprise at the last tier, 280 Vinyles, 150 Streams on the other tiers, and 4 titles of the season.
-- Tiers can no longer be bought; a booster bought with Vinyles gives no XP; 300 XP a day at most.

alter table public.packs drop constraint if exists packs_kind_check;
alter table public.packs add constraint packs_kind_check check (kind in ('booster', 'genre', 'big'));
alter table public.profiles add column if not exists big_packs int not null default 0;

create table if not exists public.player_titles (
  owner uuid not null references public.profiles on delete cascade,
  title text not null,
  primary key (owner, title)
);
alter table public.player_titles enable row level security;
drop policy if exists "my titles" on public.player_titles;
create policy "my titles" on public.player_titles for select to authenticated using (owner = auth.uid());

create or replace function public.set_title(p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_title is not null and not exists (
    select 1 from achievement_claims k join achievements a on a.key = k.key
    where k.owner = uid and a.titles[k.tier] = p_title)
  and not exists (select 1 from player_titles where owner = uid and title = p_title) then
    raise exception 'title_not_earned';
  end if;
  update profiles set title = p_title where id = uid;
end $$;

create or replace function public.season_reward(p_tier int, p_premium boolean) returns jsonb language sql immutable as $$
  select case
    when not p_premium then case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 5, 'shiny', false))
      when p_tier in (10, 20) then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'track', 'tier', 4, 'shiny', false))
      when p_tier % 5 = 0 then jsonb_build_object('kind', 'boosters', 'amount', 3)
      when p_tier in (8, 16, 26) then jsonb_build_object('kind', 'vinyls', 'amount', 5)
      else jsonb_build_object('kind', 'streams', 'amount', case when p_tier < 10 then 50 when p_tier < 20 then 75 else 100 end) end
    else case
      when p_tier = 30 then jsonb_build_object('kind', 'card', 'card', jsonb_build_object('kind', 'any', 'tier', 5, 'shiny', true))
      when p_tier in (5, 15, 25) then jsonb_build_object('kind', 'big_booster', 'amount', 1)
      when p_tier in (10, 20) then jsonb_build_object('kind', 'vinyls', 'amount', 60)
      when p_tier in (6, 12, 18, 24) then jsonb_build_object('kind', 'vinyls', 'amount', 40)
      when p_tier = 3 then jsonb_build_object('kind', 'title', 'title', 'Backstage')
      when p_tier = 9 then jsonb_build_object('kind', 'title', 'title', 'Tête d''affiche')
      when p_tier = 21 then jsonb_build_object('kind', 'title', 'title', 'Rappel')
      when p_tier = 27 then jsonb_build_object('kind', 'title', 'title', 'VIP de la Tournée')
      else jsonb_build_object('kind', 'streams', 'amount', 150) end end
$$;

create or replace function public.claim_season(p_tier int, p_premium boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress; r jsonb; c jsonb; x double precision;
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
  elsif r ->> 'kind' = 'big_booster' then
    update profiles set big_packs = big_packs + (r ->> 'amount')::int where id = uid;
  elsif r ->> 'kind' = 'title' then
    insert into player_titles (owner, title) values (uid, r ->> 'title') on conflict do nothing;
  elsif r ->> 'kind' = 'boosters' then
    update profiles set stock = stock + (r ->> 'amount')::int where id = uid;
  else
    c := r -> 'card';
    if c ->> 'kind' = 'any' then                         -- the Shiny surprise: drawn now, and the player is told which
      x := random();
      c := case when x < .4 then '{"kind": "track", "tier": 4}' when x < .7 then '{"kind": "artist", "tier": 4}'
                when x < .9 then '{"kind": "track", "tier": 5}' else '{"kind": "artist", "tier": 5}' end::jsonb
           || jsonb_build_object('shiny', true);
      r := jsonb_set(r, '{card}', c);
    end if;
    perform give_card(uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean);   -- queued if one is already waiting
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null, p_pay text default 'streams') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean; gift_god boolean := false; paid_with text; paid int; old packs; dry_now int; x_pw text; x_paid int;
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
      slots := slots || greatest(roll_tier(), 2::smallint);
      arts := arts || (random() < 0.02);
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

create or replace function public.park_pack(pk packs) returns void
language plpgsql security definer set search_path = public as $$
begin
  update packs set parked = true where id = pk.id;
  if pk.kind = 'big' then
    null;                                             -- it stays parked and comes back as the next big booster
  elsif pk.kind = 'genre' and pk.paid_with = 'vinyls' then
    perform add_vinyls(pk.owner, pk.paid, 'remboursement d''un pack de la Boutique');
  elsif pk.kind = 'genre' then
    perform add_streams(pk.owner, coalesce(pk.paid, (select genre_pack_price from settings)), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = stock + 1 where id = pk.owner;
  end if;
end $$;

create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; v_tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
  want smallint; cand bigint; chosen bigint; tries int; used_t bigint[] := '{}'; used_a bigint[] := '{}'; g smallint; anchored boolean; pooled boolean;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> array_length(pk.slots, 1) then raise exception 'need_five_tracks'; end if;

  for i in 1..array_length(pk.slots, 1) loop
    is_artist := coalesce(pk.artist_slots[i], false);
    v_gifted := pk.gift_god or coalesce(i = pk.gift_slot, false);      -- offered by an admin (can be taken back)
    want := pk.slots[i];
    chosen := null; tries := 0; anchored := false; g := null; pooled := false;
    if is_artist then
      -- a Diamant: a number drawn in the Diamant list (it only has to still exist on Deezer)
      while want = 5 and chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := diamond_pick(uid, used_a);
        exit when cand is null;
        a := deezer('artist/' || cand);
        if a ->> 'error' is not null or a ->> 'id' is null then delete from diamond_artists where id = cand; continue; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        chosen := cand; anchored := true;
      end loop;
      -- the other certifications: the server's pick in the artist pool, checked on Deezer
      while want < 5 and chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := pool_pick_artist(uid, want, used_a);
        exit when cand is null;
        a := deezer('artist/' || cand);
        if a ->> 'error' is not null or a ->> 'id' is null then delete from artist_pool where id = cand; continue; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        -- its certification is the season's: a change is kept for the next season
        update artist_pool set next_tier = nullif(cert_of(r, cand), tier), checked_at = now()
        where id = cand and next_tier is distinct from nullif(cert_of(r, cand), tier);
        chosen := cand; pooled := true;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        if coalesce(p_tracks[i], 0) = 0 then raise exception 'need_proposals'; end if;
        chosen := p_tracks[i];
        a := deezer('artist/' || chosen);
        if a ->> 'error' is not null or a ->> 'id' is null then raise exception 'artist_not_found %', chosen; end if;
        r := coalesce((a ->> 'nb_fan')::int, 0);
        insert into artist_pool (id, tier, checked_at) values (chosen, cert_of(r, chosen), now())
        on conflict (id) do update set next_tier = nullif(excluded.tier, artist_pool.tier), checked_at = now();
      end if;
      used_a := used_a || chosen;
      v_tier := case when anchored or pooled then want else least(cert_of(r, chosen), want) end;
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Platine / Diamant only (or offered)
      insert into artists (id, name, picture, fans, nb_album, fetched_at)
      values (chosen, coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
              r, coalesce((a ->> 'nb_album')::int, 0), to_timestamp(0))      -- discography list still to fetch
      on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans, nb_album = excluded.nb_album
      where artists.name is distinct from excluded.name or artists.picture is distinct from excluded.picture
         or abs(artists.fans - excluded.fans) > greatest(artists.fans / 50, 100) or artists.nb_album is distinct from excluded.nb_album;
      was_owned := exists (select 1 from cards where owner = uid and kind = 'artist' and artist_id = chosen);
      insert into cards (owner, kind, artist_id, tier, rank, holo, source, gifted)
      values (uid, 'artist', chosen, v_tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
      returning id into card_id;
    else
      while chosen is null and tries < 4 loop
        tries := tries + 1;
        cand := pool_pick_track(uid, want, case when pk.kind = 'genre' then pk.genre end, used_t);
        exit when cand is null;
        t := deezer('track/' || cand);
        if t ->> 'error' is not null or t ->> 'id' is null or not coalesce((t ->> 'readable')::boolean, true)
           or coalesce(t ->> 'preview', '') = '' then
          delete from track_pool where id = cand; continue;
        end if;
        r := coalesce((t ->> 'rank')::int, 0);
        -- a track already known (fresh, with its album): no need to ask Deezer for the album again
        select jsonb_build_object('cover_big', tr.cover), tr.genre into a, g from tracks tr
        where tr.id = cand and tr.updated_at > now() - interval '7 days' and tr.album_id is not null and tr.cover <> '' and tr.genre is not null;
        if not found then                          -- or its album is: its genre and cover are saved with it
          select jsonb_build_object('cover_big', al.cover), al.genre into a, g from albums al
          where al.id = (t -> 'album' ->> 'id')::bigint and al.genre is not null and al.cover <> '' and al.fetched_at > now() - interval '30 days';
        end if;
        if not found then
          a := deezer('album/' || (t -> 'album' ->> 'id'));
          g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        end if;
        -- its rarity is the season's: a change is kept for the next season
        update track_pool set next_tier = nullif(tier_of(r), tier), genre = g, checked_at = now()
        where id = cand and (next_tier is distinct from nullif(tier_of(r), tier) or genre is distinct from g);
        if pk.kind <> 'genre' or g = pk.genre then chosen := cand; pooled := true; end if;
      end loop;
      if chosen is null then                         -- nothing in the pool: the browser's proposal, capped as before
        if coalesce(p_tracks[i], 0) = 0 then raise exception 'need_proposals'; end if;
        chosen := p_tracks[i];
        if chosen = any(used_t) then raise exception 'need_five_tracks'; end if;
        t := deezer('track/' || chosen);
        if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', chosen; end if;
        a := deezer('album/' || (t -> 'album' ->> 'id'));
        g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
        r := coalesce((t ->> 'rank')::int, 0);
        insert into track_pool (id, tier, genre, src, checked_at)
        values (chosen, tier_of(r), type_of_genre(coalesce((a ->> 'genre_id')::int, -1)), 'seen', now())
        on conflict (id) do update set next_tier = nullif(excluded.tier, track_pool.tier), genre = excluded.genre, checked_at = now();
      end if;
      used_t := used_t || chosen;
      v_tier := case when pooled then want else least(tier_of(r), want) end;
      holo := v_tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Mythique / Légendaire only (or offered)
      insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
      values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
              coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
              coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
              coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
              coalesce((t ->> 'explicit_lyrics')::boolean, false), g,
              (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
      on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
        cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
        explicit = excluded.explicit, genre = excluded.genre, album_id = excluded.album_id,
        artist_id = excluded.artist_id, updated_at = now()
      where tracks.updated_at < now() - interval '7 days' or tracks.album_id is null or tracks.cover = ''
         or tracks.genre is distinct from excluded.genre;
      if not exists (select 1 from albums al where al.id = (t -> 'album' ->> 'id')::bigint and al.fetched_at > now() - interval '7 days') then
        if a ? 'id' then perform save_album(a); end if;
      end if;
      was_owned := exists (select 1 from cards where owner = uid and track_id = chosen);
      insert into cards (owner, track_id, tier, rank, holo, source, gifted)
      values (uid, chosen, v_tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
      returning id into card_id;
    end if;
    top := greatest(top, v_tier);
    out := out || jsonb_build_object('card', card_id, 'kind', case when is_artist then 'artist' else 'track' end,
                                     'track', chosen, 'tier', v_tier, 'rank', r,
                                     'holo', holo, 'new', not was_owned, 'wanted', want);
  end loop;

  update packs set done = true where id = pk.id;
  update profiles set opened = opened + 1,
                      dry = case when pk.kind = 'big' then dry when top >= 4 then 0 else dry + 1 end,
                      gods = gods + case when pk.god then 1 else 0 end
  where id = uid;
  return out;
end $$;

create or replace function public.refill_stock(p public.profiles) returns public.profiles language plpgsql set search_path = public as $$
declare gained int; iv int := 600;
begin
  if p.stock >= 10 then p.stock_at := now(); return p; end if;
  -- VIP of the current season: a booster every 3 minutes
  if exists (select 1 from season_progress sp join seasons se on se.id = sp.season_id
             where sp.owner = p.id and sp.premium and now() >= se.starts_at and now() < se.ends_at) then iv := 180; end if;
  gained := floor(extract(epoch from now() - p.stock_at) / iv);
  if gained > 0 then
    p.stock := least(10, p.stock + gained);
    p.stock_at := case when p.stock >= 10 then now() else p.stock_at + gained * iv * interval '1 second' end;
  end if;
  return p;
end $$;

create or replace function public.buy_season_premium() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := current_season(); bal int;
begin
  if s.id is null then raise exception 'no_season'; end if;
  if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < 500 then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -500, 'Pass Premium');
  insert into season_progress (owner, season_id, premium) values (uid, s.id, true)
  on conflict (owner, season_id) do update set premium = true;
end $$;
update public.shop_packs set cents = 499 where id = 'pass';

create or replace function public.buy_season_tiers(p_count int) returns int
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'tiers_closed';
end $$;

create or replace function public.season_add_xp(p_user uuid, p_xp int) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons := current_season(); done int; n int;
begin
  if s.id is null or coalesce(p_xp, 0) <= 0 then return; end if;
  -- at most 300 XP a day: the pass is played over the season, not finished in two days
  done := coalesce((select d.n from daily_counters d where d.owner = p_user and d.day = game_day() and d.metric = 'season_xp'), 0);
  n := least(p_xp, 300 - done);
  if n <= 0 then return; end if;
  perform bump(p_user, 'season_xp', n);
  p_xp := n;
  insert into season_progress (owner, season_id, xp) values (p_user, s.id, p_xp)
  on conflict (owner, season_id) do update set xp = season_progress.xp + excluded.xp;
end $$;

create or replace function public.on_pack_season_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done and new.paid_with is distinct from 'vinyls' then   -- a booster bought with Vinyles gives no XP
    perform season_add_xp(new.owner, 5 + case when new.god then 50 else 0 end); end if;
  return new;
exception when others then return new;            -- XP never breaks a booster
end $$;

revoke execute on function public.refill_stock(public.profiles), public.park_pack(packs), public.season_add_xp(uuid, int),
  public.on_pack_season_xp() from public, anon, authenticated;
revoke execute on function public.start_pack(text, int, text), public.finish_pack(uuid, bigint[]), public.claim_season(int, boolean),
  public.set_title(text), public.buy_season_premium(), public.buy_season_tiers(int) from public, anon;
grant execute on function public.start_pack(text, int, text), public.finish_pack(uuid, bigint[]), public.claim_season(int, boolean),
  public.set_title(text), public.buy_season_premium(), public.buy_season_tiers(int) to authenticated;
