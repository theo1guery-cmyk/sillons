-- Faster boosters. Every card of a booster used to be checked on Deezer while the player waited (one request after
-- the other, about 1 to 2 seconds): a track checked less than 3 days ago is now taken from what the server knows,
-- and a background job keeps the pool checked, so most boosters ask Deezer nothing. The cards also come back with
-- what the game shows of them, which saves the game a second request.

alter table public.track_pool add column if not exists rank int;

create or replace function public.tp_rank_of(t jsonb) returns int language sql immutable as $$ select coalesce((t ->> 'rank')::int, 0) $$;

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
        -- checked on Deezer less than 3 days ago, and known with its album: no need to ask Deezer again (fast)
        select jsonb_build_object('id', tr.id, 'title_short', tr.title, 'artist', jsonb_build_object('name', tr.artist, 'id', tr.artist_id),
                 'album', jsonb_build_object('id', tr.album_id, 'title', tr.album, 'cover_big', tr.cover), 'duration', tr.duration, 'bpm', tr.bpm,
                 'release_date', nullif(tr.year, 0)::text, 'explicit_lyrics', tr.explicit, 'rank', tp.rank), tr.genre
          into t, g
          from tracks tr join track_pool tp on tp.id = tr.id
          where tr.id = cand and tp.rank is not null and tp.checked_at > now() - interval '3 days'
            and tr.album_id is not null and tr.cover <> '' and tr.genre is not null;
        if found then
          r := tp_rank_of(t); a := jsonb_build_object('cover_big', t -> 'album' ->> 'cover_big');
          if pk.kind <> 'genre' or g = pk.genre then chosen := cand; pooled := true; end if;
          continue;
        end if;
        t := deezer('track/' || cand);
        if t ->> 'error' is not null or t ->> 'id' is null or not coalesce((t ->> 'readable')::boolean, true)
           or coalesce(t ->> 'preview', '') = '' then
          delete from track_pool where id = cand; continue;
        end if;
        r := coalesce((t ->> 'rank')::int, 0);
        update track_pool set rank = r, checked_at = now() where id = cand;     -- the cache of the next packs
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
  -- the cards with what the game shows of them (no second request needed)
  return (select coalesce(jsonb_agg(o.x || jsonb_build_object('meta', case when o.x ->> 'kind' = 'artist'
            then (select jsonb_build_object('id', ar.id, 'name', ar.name, 'picture', ar.picture, 'fans', ar.fans, 'nb_album', ar.nb_album) from artists ar where ar.id = (o.x ->> 'track')::bigint)
            else (select to_jsonb(tr) from tracks tr where tr.id = (o.x ->> 'track')::bigint) end) order by o.k), '[]')
          from jsonb_array_elements(out) with ordinality o(x, k));
end $$;

-- the background check of the pool: the oldest checks first, a few each minute
create or replace function public.pool_warm_step(n int) returns int
language plpgsql security definer set search_path = public as $$
declare p record; t jsonb; r int; k int := 0;
begin
  for p in select tp.id from track_pool tp where exists (select 1 from tracks tr where tr.id = tp.id and tr.album_id is not null and tr.cover <> '' and tr.genre is not null)
           and (tp.checked_at is null or tp.rank is null or tp.checked_at < now() - interval '2 days')
           order by tp.checked_at nulls first limit n loop
    begin
      t := deezer('track/' || p.id);
    exception when others then continue;
    end;
    if t ->> 'error' is not null or t ->> 'id' is null or not coalesce((t ->> 'readable')::boolean, true) or coalesce(t ->> 'preview', '') = '' then
      delete from track_pool where id = p.id; continue;
    end if;
    r := coalesce((t ->> 'rank')::int, 0);
    update track_pool set rank = r, checked_at = now(), next_tier = nullif(tier_of(r), tier) where id = p.id;
    k := k + 1;
  end loop;
  return k;
end $$;
revoke execute on function public.pool_warm_step(int), public.tp_rank_of(jsonb) from public, anon, authenticated;

select cron.unschedule('pool-warm') where exists (select 1 from cron.job where jobname = 'pool-warm');
select cron.schedule('pool-warm', '* * * * *', 'select public.pool_warm_step(25)');
