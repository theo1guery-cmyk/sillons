-- a card is a track (or artist) in one rarity: the rarity is the one it had when it was pulled and never changes.
-- The same track pulled as Légendaire, then as Mythique after it fell in the charts, gives two different cards.
-- Discarding must therefore keep one copy of each card, i.e. of each (track, rarity), not of each track.
create or replace function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from cards where id = any(p_cards) and collector) then raise exception 'collector_card'; end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then
    raise exception 'card_listed';
  end if;
  if exists (select 1 from (select kind, coalesce(track_id, artist_id) as ref, tier, count(*) as n
                            from cards where owner = uid and id = any(p_cards) group by 1, 2, 3) d
             where d.n >= (select count(*) from cards k where k.owner = uid and k.kind = d.kind
                           and coalesce(k.track_id, k.artist_id) = d.ref and k.tier = d.tier)) then
    raise exception 'keep_one';
  end if;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  select coalesce(sum(discard_value(tier)), 0), count(*) into gained, removed from cards where owner = uid and id = any(p_cards);
  delete from cards where owner = uid and id = any(p_cards);
  perform add_streams(uid, gained, 'défausse de ' || removed || ' carte(s)');
  perform bump(uid, 'discards', removed);
  return jsonb_build_object('removed', removed, 'gained', gained);
end $$;

