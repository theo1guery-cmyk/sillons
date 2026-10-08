-- Disque de diamant from 7 million Deezer fans (was 10 million): about 50 artists instead of about 23.
-- Plus a short "Diamant d'honneur" list: stars that Deezer's mostly French audience undercounts
-- (Travis Scott 4495513, Kanye West 230, Kendrick Lamar 525046). Same list in app.js (HONOR).
-- Cards already pulled keep their certification.

create or replace function public.cert_of(fans int) returns smallint language sql immutable set search_path = public as $$
  select case when fans >= 7000000 then 5 when fans >= 1000000 then 4 when fans >= 150000 then 3
              when fans >= 20000 then 2 when fans >= 1000 then 1 else 0 end::smallint
$$;

create or replace function public.cert_of(fans int, artist bigint) returns smallint language sql immutable set search_path = public as $$
  select case when artist in (4495513, 230, 525046) then 5::smallint else cert_of(fans) end
$$;
grant execute on function public.cert_of(int, bigint) to anon, authenticated;

-- the booster and the Collector use the artist-aware version
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
      holo := tier >= 4 and random() < (select shiny_chance from settings);   -- Shiny: Platine / Diamant only
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
      holo := tier >= 4 and random() < (select shiny_chance from settings);   -- Shiny: Mythique / Légendaire only
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
  values (uid, 'artist', p_artist, cert_of(r.fans, p_artist), r.fans, false, false, true, 'collector');
  return reward;
end $$;
