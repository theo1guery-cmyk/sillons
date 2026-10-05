-- Albums and discographies: complete an album (own every one of its tracks) or an artist's whole
-- studio discography for a Streams reward and a gold badge.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.tracks add column album_id bigint, add column artist_id bigint;
create index tracks_album_idx on public.tracks (album_id);
create index tracks_artist_idx on public.tracks (artist_id);

create table public.albums (
  id bigint primary key,
  title text not null,
  artist_id bigint,
  artist text not null default '',
  cover text not null default '',
  record_type text not null default 'album',
  nb_tracks int not null default 0,
  year int not null default 0,
  tracks jsonb not null default '[]',          -- [{id, title, rank}] in album order
  complete boolean not null default false,      -- false while the tracklist is shorter than nb_tracks
  fetched_at timestamptz not null default now()
);
create index albums_artist_idx on public.albums (artist_id);

create table public.artists (
  id bigint primary key,
  name text not null,
  picture text not null default '',
  fans int not null default 0,
  studio_albums bigint[] not null default '{}', -- the albums a discography needs
  fetched_at timestamptz not null default now()
);

create table public.album_claims (
  owner uuid not null references public.profiles on delete cascade,
  album_id bigint not null references public.albums,
  reward int not null,
  claimed_at timestamptz not null default now(),
  primary key (owner, album_id)
);
create table public.disco_claims (
  owner uuid not null references public.profiles on delete cascade,
  artist_id bigint not null references public.artists,
  reward int not null,
  claimed_at timestamptz not null default now(),
  primary key (owner, artist_id)
);

-- an album counts for a discography when it is a studio album: no special editions, lives, remixes or compilations
create function public.is_studio(p_title text, p_type text) returns boolean language sql immutable set search_path = public as $$
  select p_type = 'album' and p_title !~* '(edition|édition|deluxe|remaster|remix|live|alive|anniversary|instrumental|acoustic|version|reconfigured|soundtrack|motion picture|b-sides|greatest|best of|collection|anthology|karaoke|tribute|essentials|hits|en concert|unplugged|mtv|session|reissue|expanded|bonus|demos)'
$$;

-- store an album from a Deezer album object (already fetched by finish_pack, or fetched here)
create function public.save_album(a jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare list jsonb;
begin
  if a is null or a ->> 'id' is null or a ->> 'error' is not null then return; end if;
  list := coalesce((select jsonb_agg(jsonb_build_object('id', (x ->> 'id')::bigint,
                                                         'title', coalesce(nullif(x ->> 'title_short', ''), x ->> 'title'),
                                                         'rank', coalesce((x ->> 'rank')::int, 0)))
                    from jsonb_array_elements(a -> 'tracks' -> 'data') x), '[]');
  insert into albums (id, title, artist_id, artist, cover, record_type, nb_tracks, year, tracks, complete, fetched_at)
  values ((a ->> 'id')::bigint, coalesce(a ->> 'title', ''), (a -> 'artist' ->> 'id')::bigint, coalesce(a -> 'artist' ->> 'name', ''),
          replace(coalesce(a ->> 'cover_big', ''), 'http:', 'https:'), coalesce(a ->> 'record_type', 'album'),
          coalesce((a ->> 'nb_tracks')::int, 0), coalesce(nullif(left(coalesce(a ->> 'release_date', ''), 4), '')::int, 0),
          list, jsonb_array_length(list) >= coalesce((a ->> 'nb_tracks')::int, 0), now())
  on conflict (id) do update set title = excluded.title, artist_id = excluded.artist_id, artist = excluded.artist,
    cover = excluded.cover, record_type = excluded.record_type, nb_tracks = excluded.nb_tracks, year = excluded.year,
    tracks = case when excluded.complete or not albums.complete then excluded.tracks else albums.tracks end,
    complete = albums.complete or excluded.complete, fetched_at = now();
end $$;

-- fetch an album (with its full tracklist when Deezer truncates it)
create function public.fetch_album(p_album bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb; t jsonb;
begin
  a := deezer('album/' || p_album);
  if a ->> 'error' is not null then return; end if;
  if jsonb_array_length(coalesce(a -> 'tracks' -> 'data', '[]')) < coalesce((a ->> 'nb_tracks')::int, 0) then
    t := deezer('album/' || p_album || '/tracks?limit=500');
    if t ->> 'error' is null then a := jsonb_set(a, '{tracks}', jsonb_build_object('data', t -> 'data')); end if;
  end if;
  perform save_album(a);
end $$;

-- the player asks for an album or an artist that is not known yet
create function public.ensure_album(p_album bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_user();
  if not exists (select 1 from albums where id = p_album and complete) then perform fetch_album(p_album); end if;
end $$;

create function public.ensure_artist(p_artist bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb; l jsonb; studio bigint[];
begin
  perform require_user();
  if exists (select 1 from artists where id = p_artist and fetched_at > now() - interval '7 days') then return; end if;
  a := deezer('artist/' || p_artist);
  if a ->> 'error' is not null then raise exception 'artist_not_found'; end if;
  l := deezer('artist/' || p_artist || '/albums?limit=200');
  -- studio albums by this artist, one per title (Deezer often lists the same album twice)
  select coalesce(array_agg(id order by id), '{}') into studio from (
    select distinct on (lower(x ->> 'title')) (x ->> 'id')::bigint as id
    from jsonb_array_elements(coalesce(l -> 'data', '[]')) x
    where is_studio(x ->> 'title', x ->> 'record_type')
    order by lower(x ->> 'title'), (x ->> 'release_date') ) s;
  insert into artists (id, name, picture, fans, studio_albums, fetched_at)
  values (p_artist, coalesce(a ->> 'name', '?'), replace(coalesce(a ->> 'picture_big', ''), 'http:', 'https:'),
          coalesce((a ->> 'nb_fan')::int, 0), studio, now())
  on conflict (id) do update set name = excluded.name, picture = excluded.picture, fans = excluded.fans,
    studio_albums = excluded.studio_albums, fetched_at = now();
end $$;

-- ---------------------------------------------------------------- new pulls carry their album and artist
create or replace function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; tier smallint; holo boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 or (select count(distinct x) from unnest(p_tracks) x) <> 5 then
    raise exception 'need_five_tracks';
  end if;

  for i in 1..5 loop
    t := deezer('track/' || p_tracks[i]);
    if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', p_tracks[i]; end if;
    a := deezer('album/' || (t -> 'album' ->> 'id'));
    r := coalesce((t ->> 'rank')::int, 0);
    tier := least(tier_of(r), pk.slots[i]);
    top := greatest(top, tier);
    holo := random() < 0.04;

    insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
    values ((t ->> 'id')::bigint,
            coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'),
            coalesce(t -> 'artist' ->> 'name', '?'),
            coalesce(t -> 'album' ->> 'title', ''),
            replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
            coalesce((t ->> 'duration')::int, 0),
            coalesce(round((t ->> 'bpm')::numeric)::int, 0),
            coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
            coalesce((t ->> 'explicit_lyrics')::boolean, false),
            type_of_genre(coalesce((a ->> 'genre_id')::int, -1)),
            (t -> 'album' ->> 'id')::bigint,
            (t -> 'artist' ->> 'id')::bigint,
            now())
    on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
      cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
      explicit = excluded.explicit, genre = excluded.genre, album_id = excluded.album_id,
      artist_id = excluded.artist_id, updated_at = now();
    perform save_album(a);

    was_owned := exists (select 1 from cards where owner = uid and track_id = p_tracks[i]);
    insert into cards (owner, track_id, tier, rank, holo, source)
    values (uid, p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end)
    returning id into card_id;
    out := out || jsonb_build_object('card', card_id, 'track', p_tracks[i], 'tier', tier, 'rank', r,
                                     'holo', holo, 'new', not was_owned, 'wanted', pk.slots[i]);
  end loop;

  update packs set done = true where id = pk.id;
  update profiles set opened = opened + 1,
                      dry = case when top >= 4 then 0 else dry + 1 end,
                      gods = gods + case when pk.god then 1 else 0 end
  where id = uid;
  return out;
end $$;

-- ---------------------------------------------------------------- background filling (imports, older cards)
create function public.backfill_step(p_tracks int default 60, p_albums int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint; t jsonb; aid bigint;
begin
  for tid in select id from tracks where album_id is null order by updated_at desc limit p_tracks loop
    t := deezer('track/' || tid);
    update tracks set album_id = coalesce((t -> 'album' ->> 'id')::bigint, -1), artist_id = (t -> 'artist' ->> 'id')::bigint
    where id = tid;
  end loop;
  for aid in select distinct t.album_id from tracks t left join albums a on a.id = t.album_id
             where t.album_id > 0 and (a.id is null or not a.complete) limit p_albums loop
    perform fetch_album(aid);
  end loop;
end $$;
select cron.schedule('sillons-backfill', '* * * * *', 'select public.backfill_step(40, 20)');

-- ---------------------------------------------------------------- progress and claims
create function public.album_reward(n int) returns int language sql immutable set search_path = public as $$
  select least(500, greatest(50, n * 10))
$$;

-- every album the player has at least one track of
create function public.my_albums() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (select distinct c.track_id, t.album_id from cards c join tracks t on t.id = c.track_id
                where c.owner = auth.uid() and t.album_id > 0)
  select coalesce(jsonb_agg(x order by x -> 'claimed' desc, (x ->> 'pct')::numeric desc, x ->> 'title'), '[]') from (
    select jsonb_build_object(
      'id', a.id, 'title', a.title, 'artist', a.artist, 'artist_id', a.artist_id, 'cover', a.cover, 'year', a.year,
      'type', a.record_type, 'total', jsonb_array_length(a.tracks), 'complete', a.complete,
      'owned', (select count(*) from jsonb_array_elements(a.tracks) e where (e ->> 'id')::bigint in (select track_id from mine)),
      'pct', round(100.0 * (select count(*) from jsonb_array_elements(a.tracks) e where (e ->> 'id')::bigint in (select track_id from mine))
                   / greatest(1, jsonb_array_length(a.tracks))),
      'reward', album_reward(jsonb_array_length(a.tracks)),
      'claimed', exists (select 1 from album_claims k where k.owner = auth.uid() and k.album_id = a.id)) x
    from albums a where a.id in (select album_id from mine) and a.record_type in ('album', 'ep')
  ) s
$$;

create function public.claim_album(p_album bigint) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); a albums; missing int; reward int;
begin
  perform fetch_album(p_album);                 -- check against Deezer's current tracklist
  select * into a from albums where id = p_album;
  if a.id is null or a.record_type not in ('album', 'ep') or not a.complete or jsonb_array_length(a.tracks) = 0 then
    raise exception 'album_not_found';
  end if;
  select count(*) into missing from jsonb_array_elements(a.tracks) e
  where not exists (select 1 from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint);
  if missing > 0 then raise exception 'album_incomplete'; end if;
  reward := album_reward(jsonb_array_length(a.tracks));
  insert into album_claims (owner, album_id, reward) values (uid, p_album, reward) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  perform add_streams(uid, reward, 'album complet : ' || a.title);
  return reward;
end $$;

-- discography of every artist the player has completed at least one album of, or owns 5+ tracks of
create function public.my_discographies() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (select t.artist_id, count(distinct c.track_id) n from cards c join tracks t on t.id = c.track_id
                where c.owner = auth.uid() and t.artist_id is not null group by t.artist_id),
       done as (select a.artist_id, k.album_id from album_claims k join albums a on a.id = k.album_id where k.owner = auth.uid())
  select coalesce(jsonb_agg(x order by x -> 'claimed' desc, (x ->> 'done')::numeric / greatest(1, (x ->> 'total')::numeric) desc, x ->> 'name'), '[]') from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'picture', r.picture, 'fans', r.fans, 'known', r.id is not null,
      'total', cardinality(r.studio_albums),
      'done', (select count(*) from done d where d.album_id = any(r.studio_albums)),
      'albums', (select coalesce(jsonb_agg(jsonb_build_object('id', al.id, 'title', coalesce(al.title, '…'), 'cover', al.cover,
                   'claimed', exists (select 1 from done d where d.album_id = s.id)) order by al.year), '[]')
                 from unnest(r.studio_albums) s(id) left join albums al on al.id = s.id),
      'reward', greatest(500, 200 * cardinality(r.studio_albums)),
      'claimed', exists (select 1 from disco_claims k where k.owner = auth.uid() and k.artist_id = r.id)) x
    from artists r
    where r.id in (select artist_id from mine where n >= 5) or r.id in (select artist_id from done)
  ) s
$$;

-- artists worth showing a discography for, not fetched yet (the site asks for them one by one)
create function public.my_missing_artists() returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(artist_id), '{}') from (
    select t.artist_id from cards c join tracks t on t.id = c.track_id
    where c.owner = auth.uid() and t.artist_id is not null and not exists (select 1 from artists r where r.id = t.artist_id)
    group by t.artist_id having count(distinct c.track_id) >= 5 order by count(distinct c.track_id) desc limit 20) s
$$;

create function public.claim_discography(p_artist bigint) returns int
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
  return reward;
end $$;

-- ---------------------------------------------------------------- achievements
insert into public.achievements values
  ('albums', 7, 'Collection', 'Album complet', 'Albums complétés', '{1,10,50}', '{50,250,1000}', '{Mélomane,Discophile,Disquaire}'),
  ('discos', 8, 'Collection', 'Discographie complète', 'Discographies complètes', '{1,5,20}', '{100,500,2000}', '{Fan de la première heure,Biographe,Encyclopédiste}');

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
    'albums', (select count(*) from album_claims where owner = p_user),
    'discos', (select count(*) from disco_claims where owner = p_user),
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
alter table public.albums enable row level security;
alter table public.artists enable row level security;
alter table public.album_claims enable row level security;
alter table public.disco_claims enable row level security;
create policy "albums are public" on public.albums for select using (true);
create policy "artists are public" on public.artists for select using (true);
create policy "album claims are visible to players" on public.album_claims for select to authenticated using (true);
create policy "discography claims are visible to players" on public.disco_claims for select to authenticated using (true);
revoke insert, update, delete on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int) to anon, authenticated;
grant execute on function public.ensure_album(bigint), public.ensure_artist(bigint), public.my_albums(), public.claim_album(bigint),
  public.my_discographies(), public.my_missing_artists(), public.claim_discography(bigint) to authenticated;
revoke execute on function public.save_album(jsonb), public.fetch_album(bigint), public.backfill_step(int, int),
  public.is_studio(text, text), public.album_reward(int) from authenticated;
