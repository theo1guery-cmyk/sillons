-- The end of Holo cards. The "holo" flag now means Shiny: only a Mythique or Légendaire track (or a
-- Platine / Diamant artist) can be Shiny, with a tiny chance (1 in 100 by default).

alter table public.settings add column shiny_chance double precision not null default 0.01;

-- existing Holo cards become plain cards
update public.cards set holo = false where holo;
update public.listings set holo = false where holo;

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
      tier := least(cert_of(r), pk.slots[i]);
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


-- the Collector is its own thing, never Shiny
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
  values (uid, 'artist', p_artist, cert_of(r.fans), r.fans, false, false, true, 'collector');
  return reward;
end $$;

-- counters: a Mythique-or-better counter replaces the Holo one
create or replace function public.on_card_pulled() returns trigger
language plpgsql security definer set search_path = public as $$
declare g smallint;
begin
  if new.source not in ('booster', 'genre', 'god') then return new; end if;
  perform bump(new.owner, 'cards');
  if new.tier >= 2 then perform bump(new.owner, 'tier2'); end if;
  if new.tier >= 3 then perform bump(new.owner, 'tier3'); end if;
  if new.tier >= 4 then perform bump(new.owner, 'tier4'); end if;
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

-- the "Holo" daily challenge becomes "a Mythique or better"; the Brillant achievement counts Shiny cards
update public.daily_defs set label = 'Tire une Mythique ou mieux', metric = 'tier4', goal = 1, reward = 60 where key = 'holo1';
update public.achievements set label = 'Shiny', description = 'Cartes Shiny (Mythiques et Légendaires, 1 chance sur 100)',
  goals = '{1,3,10}', rewards = '{250,1000,5000}', titles = '{Shiny,Étincelant,Joyau}' where key = 'holos';
