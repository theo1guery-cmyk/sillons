-- The ranked live: as soon as somebody else is waiting, the battle begins, whatever his level (the closest in
-- trophies first when several are waiting). The trophies won and lost still depend on the gap.

create or replace function public.battle_queue_poll() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); q battle_queue; o battle_queue; b battles; ad uuid[]; dd uuid[]; waited int;
begin
  select * into q from battle_queue where owner = uid for update;
  if q.owner is null then return jsonb_build_object('status', 'gone'); end if;
  if q.battle is not null then
    select * into b from battles where id = q.battle;
    delete from battle_queue where owner = uid;
    return jsonb_build_object('status', 'matched', 'battle', battle_view(b, uid));
  end if;
  update battle_queue set seen_at = now() where owner = uid;
  delete from battle_queue where battle is null and seen_at < now() - interval '8 seconds';
  waited := extract(epoch from now() - q.joined_at)::int;
  for o in select * from battle_queue where owner <> uid and battle is null and seen_at > now() - interval '8 seconds'
           order by abs(trophies - q.trophies), joined_at for update skip locked loop
    begin
      ad := battle_slot_deck(uid, q.deck); dd := battle_slot_deck(o.owner, o.deck);
    exception when others then continue;
    end;
    if coalesce(cardinality(ad), 0) < 5 or coalesce(cardinality(dd), 0) < 5 then continue; end if;
    insert into battles (attacker, defender, mode, ranked, status, a_cards, d_cards, a_vals, d_vals, stats, round_at)
    values (uid, o.owner, 'live', true, 'playing', ad, dd, battle_vals(ad), battle_vals(dd), battle_stats(), now()) returning * into b;
    update battle_queue set battle = b.id where owner = o.owner;
    delete from battle_queue where owner = uid;
    return jsonb_build_object('status', 'matched', 'battle', battle_view(b, uid));
  end loop;
  return jsonb_build_object('status', 'waiting', 'waited', waited,
    'others', (select count(*) from battle_queue where owner <> uid and battle is null and seen_at > now() - interval '8 seconds'));
end $$;
