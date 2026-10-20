-- The welcome offer gives 200 Vinyles (was 300): with the 80 offered at sign-up and one small pack, 300 was enough to
-- buy the Premium pass (450) for under 2 €.
update public.shop_packs set vinyls = 200, name = 'Offre de bienvenue : 200 Vinyles' where id = 'welcome';
