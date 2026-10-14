-- A card received through the next booster now says where it comes from. Before, a reward of the pass (or a card
-- bought in the shop) was announced on Discord as "offerte par l'équipe" and marked as a gift that an admin can take
-- back. forced_cards / card_queue / packs keep a reason: 'admin' (a gift of the team, as before), 'pass' or 'shop'.
-- The card's source is then 'pass' or 'shop' (it doesn't count for the daily challenges, like the gifts), it is not a
-- gift, and Discord says "🎟️ Récompense de saison" (or "🛍️ Boutique").

alter table public.forced_cards add column if not exists reason text not null default 'admin';
alter table public.card_queue add column if not exists reason text not null default 'shop';
alter table public.packs add column if not exists gift_reason text;
-- the cards already waiting that came from the pass (the claim of the season is recorded with them)
update public.forced_cards f set reason = case when exists (select 1 from season_cards s where s.owner = f.id) then 'pass' else 'shop' end where by is null;

create or replace function public.give_card(p_user uuid, p_kind text, p_tier smallint, p_shiny boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into forced_cards (id, kind, tier, shiny, reason) values (p_user, p_kind, p_tier, p_shiny, p_reason) on conflict (id) do nothing;
  if not found then insert into card_queue (owner, kind, tier, shiny, reason) values (p_user, p_kind, p_tier, p_shiny, p_reason); end if;
end $$;
-- the shop's purchases keep calling it with 4 arguments
create or replace function public.give_card(p_user uuid, p_kind text, p_tier smallint, p_shiny boolean) returns void
language sql security definer set search_path = public as $$ select give_card(p_user, p_kind, p_tier, p_shiny, 'shop') $$;

create or replace function public.on_forced_card_used() returns trigger
language plpgsql security definer set search_path = public as $$
declare q card_queue;
begin
  delete from card_queue where id = (select id from card_queue where owner = old.id order by id limit 1) returning * into q;
  if q.id is not null then insert into forced_cards (id, kind, tier, shiny, reason) values (q.owner, q.kind, q.tier, q.shiny, q.reason) on conflict (id) do nothing; end if;
  return old;
end $$;

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
    perform give_card(uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean, 'pass');   -- queued if one is already waiting
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
    delete from forced_cards where id = uid returning kind, tier, shiny, reason into gift_kind, gift, gift_shiny, gift_reason;
    if gift is not null then slots[5] := gift; arts[5] := gift_kind = 'artist'; end if;
  end if;

  if dry_now <> p.dry then update profiles set dry = 0 where id = uid; end if;

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot, gift_slot, gift_god, paid_with, paid, gift_reason)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end, case when gift is not null then 5 end, gift_god, paid_with, paid, gift_reason)
  returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; v_tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
  want smallint; cand bigint; chosen bigint; tries int; used_t bigint[] := '{}'; used_a bigint[] := '{}'; g smallint; anchored boolean; pooled boolean; v_src text;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> array_length(pk.slots, 1) then raise exception 'need_five_tracks'; end if;

  for i in 1..array_length(pk.slots, 1) loop
    is_artist := coalesce(pk.artist_slots[i], false);
    -- given by the team (can be taken back); a reward of the pass or a card bought in the shop is the player's own
    v_gifted := pk.gift_god or (coalesce(i = pk.gift_slot, false) and coalesce(pk.gift_reason, 'admin') = 'admin');
    v_src := case when coalesce(i = pk.gift_slot, false) and pk.gift_reason in ('pass', 'shop') then pk.gift_reason
                  when pk.god then 'god' else pk.kind end;      -- offered by an admin (can be taken back)
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
      values (uid, 'artist', chosen, v_tier, r, holo, v_src, v_gifted)
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
      values (uid, chosen, v_tier, r, holo, v_src, v_gifted)
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

create or replace function public.on_pack_announce() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; embeds jsonb := '[]'; head text; c record; n int := 0; leg int := 0; shiny int := 0; art int := 0; gift int := 0; season int := 0; shop int := 0;
  track_rar text[] := array['Commune', 'Peu commune', 'Rare', 'Épique', 'Mythique', 'Légendaire'];
  cert text[] := array['Démo', 'Single', 'Disque d''argent', 'Disque d''or', 'Disque de platine', 'Disque de diamant'];
  colors int[] := array[10130342, 6276234, 5217535, 11563519, 16731498, 16106061];       -- the rarity colours of the game
  certc int[] := array[9274008, 5224624, 13225174, 15776058, 15134456, 10478591];          -- the certification colours
begin
  if not (new.done and not old.done) then return new; end if;
  if not exists (select 1 from discord_settings where enabled and webhook_url <> '') then return new; end if;
  select pseudo into who from profiles where id = new.owner;
  for c in
    select k.kind, k.tier, k.holo, k.gifted, k.source, coalesce(t.title, a.name) title, t.artist, coalesce(nullif(t.cover, ''), a.picture) pic, a.fans
    from cards k left join tracks t on t.id = k.track_id left join artists a on a.id = k.artist_id
    where k.owner = new.owner and k.pulled_at = now() order by k.tier desc, k.holo desc
  loop
    if not (new.god or (c.kind = 'track' and c.tier = 5) or (c.holo and c.tier >= 4) or (c.kind = 'artist' and c.tier >= 4)) then continue; end if;
    n := n + 1;
    if c.kind = 'track' and c.tier = 5 then leg := leg + 1; end if;
    if c.holo then shiny := shiny + 1; end if;
    if c.kind = 'artist' and c.tier >= 4 then art := art + 1; end if;
    if c.gifted then gift := gift + 1; end if;
    if c.source = 'pass' then season := season + 1; end if;
    if c.source = 'shop' then shop := shop + 1; end if;
    if n <= 10 then
      embeds := embeds || jsonb_strip_nulls(jsonb_build_object(
        'title', left((case when c.source = 'pass' then '🎟️ Récompense de saison · ' when c.source = 'shop' then '🛍️ Boutique · ' when c.gifted and not new.gift_god then '🎁 Offerte · ' else '' end) || (case when c.holo then '✨ Shiny · ' else '' end) ||
                      (case when c.kind = 'artist' then cert[c.tier + 1] else track_rar[c.tier + 1] end), 250),
        'description', left(case when c.kind = 'artist' then '**' || discord_esc(c.title) || '** · artiste' || coalesce(' · ' || replace(to_char(c.fans, 'FM999,999,999'), ',', ' ') || ' fans', '')
                            else '**' || discord_esc(c.title) || '** — ' || discord_esc(c.artist) end, 1000),
        'color', case when c.holo then 15320170 when c.kind = 'artist' then certc[c.tier + 1] else colors[c.tier + 1] end,
        'thumbnail', case when coalesce(c.pic, '') <> '' then jsonb_build_object('url', replace(c.pic, 'http:', 'https:')) end));
    end if;
  end loop;
  if n = 0 then return new; end if;
  head := case
    when new.god and new.gift_god then '🎁 **' || discord_esc(who) || '** ouvre un **GOD pack offert** par l''équipe Zik Hunter !'
    when season = n then '🎟️ **' || discord_esc(who) || '** reçoit sa récompense de saison : ' || case when n = 1 then
      case when leg > 0 then 'une **Légendaire** !' when art > 0 then 'un artiste certifié !' else 'une carte rare !' end else n || ' cartes rares !' end
    when shop = n then '🛍️ **' || discord_esc(who) || '** ouvre sa carte de la Boutique !'
    when gift = n then '🎁 **' || discord_esc(who) || '** a reçu ' || case when n = 1 then 'une carte offerte' else n || ' cartes offertes' end || ' par l''équipe Zik Hunter !'
    when new.god then '⚡ **GOD PACK !** **' || discord_esc(who) || '** vient d''ouvrir un GOD pack (1 chance sur 3 000) !'
    when art > 0 and n = 1 then '💿 **' || discord_esc(who) || '** a packé un artiste certifié !'
    when leg > 0 and n = 1 then '🌟 **' || discord_esc(who) || '** a packé une **Légendaire** !'
    when shiny > 0 and n = 1 then '✨ **' || discord_esc(who) || '** a packé une carte **Shiny** !'
    else '🔥 **' || discord_esc(who) || '** a fait un gros booster : ' || n || ' cartes rares !' end
    || case when gift > 0 and gift < n then ' (dont ' || gift || ' offerte' || case when gift > 1 then 's' else '' end || ' par l''équipe)' else '' end
    || case when season > 0 and season < n then ' (dont ' || season || ' récompense' || case when season > 1 then 's' else '' end || ' de saison)' else '' end;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content', head, 'embeds', embeds));
  return new;
exception when others then return new;            -- an announcement never breaks a booster
end $$;

revoke execute on function public.give_card(uuid, text, smallint, boolean), public.give_card(uuid, text, smallint, boolean, text),
  public.on_forced_card_used(), public.on_pack_announce() from public, anon, authenticated;
revoke execute on function public.claim_season(int, boolean), public.start_pack(text, int, text), public.finish_pack(uuid, bigint[]) from public, anon;
grant execute on function public.claim_season(int, boolean), public.start_pack(text, int, text), public.finish_pack(uuid, bigint[]) to authenticated;
