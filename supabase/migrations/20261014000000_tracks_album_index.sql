-- my_albums_fast read about 37 MB a call for a big collection: for each card it fetched the whole track row (title,
-- cover, …) only to know its album. This index carries the album and genre next to the id, so the albums page and
-- the achievements count from the index alone, without opening the tracks.
create index if not exists tracks_id_album_genre on public.tracks (id) include (album_id, genre);
