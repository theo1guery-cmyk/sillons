-- The Albums tab still ran past the statement timeout for the biggest collections (50 000+ cards, 30 000 albums):
-- my_albums() unpacked every album's tracklist and sent ~9 MB of JSON. my_albums_fast() counts the owned tracks of
-- each album from tracks.album_id (a Deezer track belongs to one album), reads the tracklist length from a stored
-- column, and sends each album as a short array. Also returns how many cards still wait for their album (that count
-- was a separate, slow request). About 10 times faster. my_albums() stays for pages opened before this update.
alter table public.albums add column if not exists n_tracks int generated always as (jsonb_array_length(tracks)) stored;

-- [id, title, artist, artist_id, cover, year, record_type, total, complete, owned, claimed]
create function public.my_albums_fast() returns jsonb
language sql stable security definer set search_path = public as $$
  with own as (select t.album_id id, count(distinct c.track_id) n from cards c join tracks t on t.id = c.track_id
               where c.owner = auth.uid() and t.album_id > 0 group by t.album_id),
       cl as (select album_id from album_claims where owner = auth.uid())
  select jsonb_build_object(
    'albums', coalesce((select jsonb_agg(jsonb_build_array(a.id, a.title, a.artist, a.artist_id, a.cover, a.year, a.record_type,
                                                           a.n_tracks, a.complete, least(own.n, a.n_tracks), cl.album_id is not null))
                        from own join albums a on a.id = own.id and a.record_type in ('album', 'ep') left join cl on cl.album_id = a.id), '[]'),
    'pending', (select count(*) from cards c join tracks t on t.id = c.track_id where c.owner = auth.uid() and t.album_id is null))
$$;

revoke execute on function public.my_albums_fast() from public, anon;
grant execute on function public.my_albums_fast() to authenticated;
