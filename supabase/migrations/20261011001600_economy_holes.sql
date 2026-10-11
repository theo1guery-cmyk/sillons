-- Two holes in the economy: a chosen Légendaire bought from an album cost 500 Vinyles (about 5 €) while one takes about
-- 1 000 boosters (about 100 € of refills), and the offer of the day "Légendaire" gave back 500 Vinyles (worth its 4,99 €)
-- so the Légendaire was free. Album tracks: Mythique 400, Légendaire 1 500. Offer of the day: 150 Vinyles.
create or replace function public.album_track_price(p_tier int) returns int language sql immutable as $$
  select (array[30, 45, 70, 110, 400, 1500])[least(5, greatest(0, p_tier)) + 1]
$$;
update public.shop_packs set vinyls = 150, name = 'Offre du jour : 150 Vinyles + 1 Légendaire garantie' where id = 'day_leg';
