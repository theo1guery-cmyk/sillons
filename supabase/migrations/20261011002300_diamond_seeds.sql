-- Diamant artists: with the old browser search, a Diamant slot only found the "Diamant d'honneur" artists that load
-- (few French chart artists reach 7 M fans), so the same few came back (Aya Nakamura, Travis Scott, Booba, Céline Dion).
-- 1. The 10 artists of the honour list go straight into the artist pool as Diamant (cert_of gives them 5). An id that
--    no longer exists on Deezer is removed by the first draw that checks it.
-- 2. The walk through Deezer starts with them and with worldwide stars (the seeds app.js uses), not only the French
--    chart: artists with 7 M fans and more are mostly worldwide stars, related to one another.
insert into public.artist_pool (id, tier)
select x, 5 from unnest(array[4495513, 230, 525046, 148380152, 198, 8909272, 4429712, 5288900, 390, 1519461]::bigint[]) x
on conflict (id) do update set tier = 5;
insert into public.harvest_artists (id, fans)
select x, 100000000 from unnest(array[4495513, 230, 525046, 148380152, 198, 8909272, 4429712, 5288900, 390, 1519461,
  246791, 13, 564, 4050205, 75798, 1424821, 1182, 27, 12246, 5313805, 288166, 1188, 9635624]::bigint[]) x
on conflict (id) do update set fans = greatest(harvest_artists.fans, 100000000), done_at = null;
