-- my_albums counted each album's owned tracks twice, each time probing the player's whole card list from inside a
-- per-album sub-query. With collections of tens of thousands of cards (a booster every 10 minutes now), the Albums tab
-- ran past the statement timeout and never loaded. Same result, in one pass: the album tracklists are unnested once
-- and joined to the player's distinct tracks.
create or replace function public.my_albums() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (select distinct c.track_id, t.album_id from cards c join tracks t on t.id = c.track_id
                where c.owner = auth.uid() and t.album_id > 0),
       ids as (select distinct track_id from mine),
       al as (select a.* from albums a where a.id in (select album_id from mine) and a.record_type in ('album', 'ep')),
       own as (select al.id, count(*) n from al cross join lateral jsonb_array_elements(al.tracks) e
               join ids on ids.track_id = (e ->> 'id')::bigint group by al.id),
       cl as (select album_id from album_claims where owner = auth.uid())
  select coalesce(jsonb_agg(x order by x -> 'claimed' desc, (x ->> 'pct')::numeric desc, x ->> 'title'), '[]') from (
    select jsonb_build_object(
      'id', al.id, 'title', al.title, 'artist', al.artist, 'artist_id', al.artist_id, 'cover', al.cover, 'year', al.year,
      'type', al.record_type, 'total', jsonb_array_length(al.tracks), 'complete', al.complete,
      'owned', coalesce(own.n, 0),
      'pct', round(100.0 * coalesce(own.n, 0) / greatest(1, jsonb_array_length(al.tracks))),
      'reward', album_reward(jsonb_array_length(al.tracks)),
      'claimed', cl.album_id is not null) x
    from al left join own on own.id = al.id left join cl on cl.album_id = al.id
  ) s
$$;
