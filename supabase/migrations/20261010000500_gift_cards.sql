-- Admin page: offer the last card of a player's next booster: a Mythique or Légendaire track, a Platine or Diamant
-- artist, Shiny or not. Replaces forced_artists (20261010000400) with forced_cards. The browser finds a card of that
-- rarity and the server checks it on Deezer as usual; a Shiny gift marks that slot of the pack (packs.shiny_slot) and
-- finish_pack() makes it Shiny. start_pack() is the one from 20261010000400_gift_artist.sql, finish_pack() the one from
-- 20261008000100_diamond_at_7m.sql, each with the gift added. A GOD pack waiting comes first.
create table public.forced_cards (
  id uuid primary key references public.profiles on delete cascade,
  kind text not null check (kind in ('track', 'artist')),
  tier smallint not null check (tier in (4, 5)),
  shiny boolean not null default false,
  by uuid references public.profiles on delete set null,
  at timestamptz not null default now()
);
alter table public.forced_cards enable row level security;
insert into public.forced_cards (id, kind, tier, by, at) select id, 'artist', tier, by, at from public.forced_artists;
drop function if exists public.admin_gift_artist(uuid, int);
drop table public.forced_artists;

alter table public.packs add column if not exists shiny_slot smallint;

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint; gift_kind text; gift_shiny boolean;
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
    if found then god := true; end if;
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

  insert into packs (owner, kind, genre, slots, god, artist_slots, shiny_slot)
  values (uid, p_kind, p_genre, slots, god, arts, case when gift_shiny then 5 end) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

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

-- p_tier: 4 (Mythique / Platine), 5 (Légendaire / Diamant), or 0 to cancel
create function public.admin_gift_card(p_user uuid, p_kind text, p_tier int, p_shiny boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); label text;
begin
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if coalesce(p_tier, 0) = 0 then
    delete from forced_cards where id = p_user;
    perform admin_log_add(me, p_user, 'gift', 'carte annulée');
    return;
  end if;
  if p_kind not in ('track', 'artist') or p_tier not in (4, 5) then raise exception 'bad_amount'; end if;
  insert into forced_cards (id, kind, tier, shiny, by) values (p_user, p_kind, p_tier, coalesce(p_shiny, false), me)
  on conflict (id) do update set kind = excluded.kind, tier = excluded.tier, shiny = excluded.shiny, by = me, at = now();
  label := case when p_kind = 'artist' then case when p_tier = 5 then 'artiste Diamant' else 'artiste Platine' end
                else case when p_tier = 5 then 'Légendaire' else 'Mythique' end end || case when p_shiny then ' Shiny' else '' end;
  perform admin_log_add(me, p_user, 'gift', label || ' au prochain booster');
end $$;

create or replace function public.admin_gifts(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return jsonb_build_object('god', exists (select 1 from forced_gods where id = p_user),
    'card', (select jsonb_build_object('kind', kind, 'tier', tier, 'shiny', shiny) from forced_cards where id = p_user));
end $$;

revoke execute on function public.admin_gift_card(uuid, text, int, boolean) from public, anon;
grant execute on function public.admin_gift_card(uuid, text, int, boolean) to authenticated;
