-- fix: the keep-one-copy check of discard_cards grouped on an expression the subquery could not see
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
  if exists (select 1 from (select kind, coalesce(track_id, artist_id) as ref, count(*) as n
                            from cards where owner = uid and id = any(p_cards) group by 1, 2) d
             where d.n >= (select count(*) from cards k where k.owner = uid and k.kind = d.kind
                           and coalesce(k.track_id, k.artist_id) = d.ref)) then
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

