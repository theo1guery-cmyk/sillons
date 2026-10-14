-- Season 2 follows Season 1 without a gap: same length (a month, 30 tiers), from 11 November to 11 December. When
-- Season 1 ends, the rarities noted during it switch (rarity_switch_step) and Season 2 starts with them.
insert into public.seasons (name, starts_at, ends_at)
select 'Saison 2 · Tournée d''Hiver', '2026-11-11 00:00+01', '2026-12-11 00:00+01'
where not exists (select 1 from public.seasons where name like 'Saison 2%');
