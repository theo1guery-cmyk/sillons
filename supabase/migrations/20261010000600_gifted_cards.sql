-- Admin page: the cards offered by an admin (a GOD pack or a card given from the player's page) are marked, so they can
-- be listed and taken back. cards.gifted is set by finish_pack() from the pack (packs.gift_god, packs.gift_slot), which
-- start_pack() fills when it uses up a gift. Cards made by hand for tests (source 'test') count as gifts too. Gifts
-- handed out before this migration were not marked and stay as they are. start_pack() and finish_pack() are the ones
-- from 20261010000500_gift_cards.sql, plus the marks.
alter table public.packs add column if not exists gift_slot smallint, add column if not exists gift_god boolean not null default false;
alter table public.cards add column if not exists gifted boolean not null default false;
create index if not exists cards_gifted_idx on public.cards (owner) where gifted or source = 'test';

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean; gift_god boolean := false;
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

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot, gift_slot, gift_god)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end, case when gift is not null then 5 end, gift_god)
  returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; tier smallint; holo boolean; is_artist boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0; v_gifted boolean;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 then raise exception 'need_five_tracks'; end if;

  for i in 1..5 loop
    is_artist := coalesce(pk.artist_slots[i], false);
    v_gifted := pk.gift_god or coalesce(i = pk.gift_slot, false);      -- offered by an admin (can be taken back)
    if is_artist then
      a := deezer('artist/' || p_tracks[i]);
      if a ->> 'error' is not null or a ->> 'id' is null then raise exception 'artist_not_found %', p_tracks[i]; end if;
      r := coalesce((a ->> 'nb_fan')::int, 0);
      tier := least(cert_of(r, p_tracks[i]), pk.slots[i]);
      holo := tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Platine / Diamant only (or offered)
      insert into artists (id, name, picture, fans, nb_album, fetched_at)
      values (p_tracks[i], coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
              r, coalesce((a ->> 'nb_album')::int, 0), to_timestamp(0))      -- discography list still to fetch
      on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans, nb_album = excluded.nb_album;
      was_owned := exists (select 1 from cards where owner = uid and kind = 'artist' and artist_id = p_tracks[i]);
      insert into cards (owner, kind, artist_id, tier, rank, holo, source, gifted)
      values (uid, 'artist', p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
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
      holo := tier >= 4 and (coalesce(i = pk.shiny_slot, false) or random() < (select shiny_chance from settings));   -- Shiny: Mythique / Légendaire only (or offered)
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
      insert into cards (owner, track_id, tier, rank, holo, source, gifted)
      values (uid, p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end, v_gifted)
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

create function public.admin_gifted_cards(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'tier', k.tier, 'holo', k.holo, 'at', k.pulled_at,
      'title', coalesce(t.title, a.name, '?'), 'artist', t.artist) order by k.pulled_at desc)
    from cards k left join tracks t on t.id = k.track_id left join artists a on a.id = k.artist_id
    where k.owner = p_user and (k.gifted or k.source = 'test')), '[]');
end $$;

-- takes back every offered card of a player (their market listings and trade offers go with them)
create function public.admin_delete_gifted(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); n int;
begin
  delete from cards where owner = p_user and (gifted or source = 'test');
  get diagnostics n = row_count;
  perform admin_log_add(me, p_user, 'gift', n || ' carte' || case when n > 1 then 's' else '' end || ' offerte' || case when n > 1 then 's' else '' end || ' supprimée' || case when n > 1 then 's' else '' end);
  return n;
end $$;

revoke execute on function public.admin_gifted_cards(uuid), public.admin_delete_gifted(uuid) from public, anon;
grant execute on function public.admin_gifted_cards(uuid), public.admin_delete_gifted(uuid) to authenticated;
