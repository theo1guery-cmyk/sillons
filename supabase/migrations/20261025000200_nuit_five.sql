-- La Nuit d'Halloween, final list: only 5 cards, each in a single copy (1/1), on the most famous Halloween sounds:
-- This Is Halloween, the Addams Family theme, the Halloween theme (John Carpenter), the Stranger Things theme and
-- Bach's Toccata and Fugue in D minor (the organ of the vampires). The other sounds of the night are removed (none was
-- found: the night has not started). Run after 20261025000000 (and 20261025000100 if it was run).
delete from public.haunted_editions e
where e.series = 2 and e.slot > 18 and not exists (select 1 from public.haunted_cards h where h.slot = e.slot);

insert into public.haunted_editions (slot, query, title, artist, copies, weight, series, opens_at, closes_at)
values (14, '', '', '', 1, 1, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris'),
       (15, '', '', '', 1, 1, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris'),
       (16, '', '', '', 1, 1, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris'),
       (17, '', '', '', 1, 1, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris'),
       (18, '', '', '', 1, 1, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris')
on conflict (slot) do nothing;

update public.haunted_editions e set query = x.query, title = x.title, artist = x.artist, copies = 1, weight = 1,
  track_id = case when e.title = x.title then e.track_id end, cover = case when e.title = x.title then e.cover end,
  preview = case when e.title = x.title then e.preview end     -- a new sound is searched again on Deezer
from (values
  (14, 'artist:"Danny Elfman" track:"This Is Halloween"', 'This Is Halloween', 'Danny Elfman'),
  (15, 'artist:"Vic Mizzy" track:"The Addams Family"', 'La Famille Addams', 'Vic Mizzy'),
  (16, 'artist:"John Carpenter" track:"Halloween"', 'Halloween (Main Theme)', 'John Carpenter'),
  (17, 'artist:"Kyle Dixon" track:"Stranger Things"', 'Stranger Things', 'Kyle Dixon & Michael Stein'),
  (18, 'artist:"Johann Sebastian Bach" track:"Toccata and Fugue in D Minor"', 'Toccata et Fugue en ré mineur', 'Johann Sebastian Bach')
) x(slot, query, title, artist)
where e.slot = x.slot and not exists (select 1 from public.haunted_cards h where h.slot = e.slot);

create or replace function public.nuit_halloween_announce() returns void
language plpgsql security definer set search_path = public as $$
begin
  if now() < '2026-10-31 00:00 Europe/Paris' or now() >= '2026-10-31 01:00 Europe/Paris' then return; end if;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter',
    'content', '🌕 **La Nuit d''Halloween commence !** Jusqu''à minuit seulement, **5 cartes légendaires en un seul exemplaire** se cachent dans les boosters : This Is Halloween, La Famille Addams, Halloween (Main Theme), Stranger Things et la Toccata de Bach. Une seule personne aura chacune. Et toutes les citrouilles sont doublées. 🎃'));
exception when others then null;
end $$;
revoke execute on function public.nuit_halloween_announce() from public, anon, authenticated;
