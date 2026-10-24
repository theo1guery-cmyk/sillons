-- La Nuit d'Halloween: five legends of Halloween become 1/1 (a single copy each): This Is Halloween (already one),
-- Monster Mash, I Put a Spell on You, the Halloween theme by John Carpenter and (Don't Fear) The Reaper. A lower weight
-- makes them come out later in the night, like Thriller. Only while none of them has been found.
update public.haunted_editions set copies = 1, weight = .5
where slot in (16, 17, 18, 22) and not exists (select 1 from public.haunted_cards h where h.slot = haunted_editions.slot);

create or replace function public.nuit_halloween_announce() returns void
language plpgsql security definer set search_path = public as $$
begin
  if now() < '2026-10-31 00:00 Europe/Paris' or now() >= '2026-10-31 01:00 Europe/Paris' then return; end if;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter',
    'content', '🌕 **La Nuit d''Halloween commence !** Jusqu''à minuit seulement, 13 nouvelles cartes en édition limitée se cachent dans les boosters, dont **5 légendes en un seul exemplaire** : This Is Halloween, Monster Mash, I Put a Spell on You, Halloween (Main Theme) et (Don''t Fear) The Reaper. Et toutes les citrouilles sont doublées. 🎃'));
exception when others then null;
end $$;
revoke execute on function public.nuit_halloween_announce() from public, anon, authenticated;
