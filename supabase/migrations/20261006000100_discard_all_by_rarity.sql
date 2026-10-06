-- "défausser mes doublons" keeps one copy of each card, i.e. of each (track, rarity): with the Légendaire and a
-- Mythique of the same track, the Mythique is another card, not a duplicate (it used to be picked, then refused).
create or replace function public.discard_all_duplicates() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[];
begin
  select array_agg(id) into ids from (
    select c.id, c.collector, row_number() over (partition by c.kind, coalesce(c.track_id, c.artist_id), c.tier order by
             c.collector desc,
             (exists (select 1 from listings l where l.card_id = c.id and l.status = 'active')) desc,
             c.holo desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid
  ) x where rn > 1 and not x.collector
    and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = x.id and o.status = 'pending')
    and not exists (select 1 from listings l where l.card_id = x.id and l.status = 'active' and l.expires_at > now());
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;
