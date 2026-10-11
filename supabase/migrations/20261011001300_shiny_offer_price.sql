-- A Shiny Légendaire almost never comes out of a booster (about 1 in 1 000 boosters), so the offer of the day that
-- guarantees one costs much more: 19,99 € instead of 7,99 € (still with 200 Vinyles).
update public.shop_packs set cents = 1999 where id = 'day_shiny';
