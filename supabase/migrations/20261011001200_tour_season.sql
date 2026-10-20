-- Season 1 becomes "Tournée Mondiale": the pass is a concert tour (each tier a city, from Paris to Los Angeles, see
-- pass.js) and Premium is shown as "Pass VIP". Only names change.
update public.seasons set name = 'Saison 1 · Tournée Mondiale' where name = 'Saison 1 · Premier pressage';
update public.shop_packs set name = 'Pass VIP · Tournée Mondiale' where id = 'pass';
