-- The revenge, tightened: it was possible to avenge a revenge (and so on, forever), and to take one revenge per
-- defense lost against the same player. Now: a revenge cannot itself be avenged, one revenge against the same
-- player per 24 hours, and 3 revenges a day at most.

create or replace function public.revenge_ok(p_battle uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from battles o where o.id = p_battle and o.defender = uid and o.mode = 'ranked' and o.status = 'done'
      and o.winner = o.attacker and not o.revenged and o.revenge_of is null and o.finished_at > now() - interval '24 hours'
      and not exists (select 1 from battles r where r.attacker = uid and r.defender = o.attacker and r.revenge_of is not null and r.created_at > now() - interval '24 hours'))
    and (select count(*) from battles r where r.attacker = uid and r.revenge_of is not null and r.created_at > now() - interval '24 hours') < 3
$$;

create or replace function public.battle_defenses() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (
    select b.*, p.pseudo, p.trophies opp_trophies, p.cosmetics from battles b join profiles p on p.id = b.attacker
    where b.defender = auth.uid() and b.mode = 'ranked' and b.status = 'done'
      and b.finished_at > (select defense_seen_at from profiles where id = auth.uid())
    order by b.finished_at desc limit 30)
  select jsonb_build_object('total', count(*), 'held', count(*) filter (where winner = defender), 'lost', count(*) filter (where winner = attacker),
    'delta', coalesce(sum(d_delta), 0),
    'list', coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', finished_at, 'who', pseudo, 'who_id', attacker, 'league', league_of(opp_trophies), 'cosmetics', cosmetics,
      'held', winner = defender, 'score', d_won || '-' || a_won, 'delta', d_delta,
      'revenge', revenge_ok(d.id, auth.uid())) order by finished_at desc), '[]'))
  from d
$$;

create or replace function public.battle_revenge(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); o battles; b battles; ad uuid[]; dd uuid[];
begin
  select * into b from battles where attacker = uid and status = 'playing' and mode <> 'live' order by created_at desc limit 1;
  if b.id is not null then return battle_view(b, uid); end if;
  select * into o from battles where id = p_battle and defender = uid and mode = 'ranked' and status = 'done' for update;
  if o.id is null or o.winner is distinct from o.attacker then raise exception 'battle_not_found'; end if;
  if not revenge_ok(o.id, uid) then
    if o.revenged or o.revenge_of is not null or o.finished_at < now() - interval '24 hours' then raise exception 'revenge_gone'; end if;
    if exists (select 1 from battles r where r.attacker = uid and r.defender = o.attacker and r.revenge_of is not null and r.created_at > now() - interval '24 hours') then raise exception 'revenge_same'; end if;
    raise exception 'revenge_limit';
  end if;
  ad := battle_deck_of(uid); dd := battle_deck_of(o.attacker);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  update battles set revenged = true where id = o.id;
  insert into battles (attacker, defender, mode, a_cards, d_cards, a_vals, d_vals, stats, revenge_of)
  values (uid, o.attacker, 'ranked', ad, dd, battle_vals(ad), battle_vals(dd), battle_stats(), o.id) returning * into b;
  return battle_view(b, uid) || jsonb_build_object('revenge', true);
end $$;

create or replace function public.battle_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; d uuid[];
begin
  select * into p from profiles where id = uid;
  d := battle_deck_of(uid);
  return jsonb_build_object('trophies', p.trophies, 'best', p.best_trophies, 'league', league_of(p.trophies), 'wins', p.battle_wins, 'losses', p.battle_losses,
    'chosen', exists (select 1 from battle_decks where owner = uid),
    'deck', coalesce((select jsonb_agg(battle_card(c) order by array_position(d, c.id)) from cards c where c.id = any(d)), '[]'),
    'today', coalesce((select n from daily_counters where owner = uid and day = game_day() and metric = 'battle_win'), 0),
    'rank', (select count(*) + 1 from profiles where trophies > p.trophies),
    'defenses', (select count(*) from battles where defender = uid and mode = 'ranked' and status = 'done' and finished_at > p.defense_seen_at),
    'history', coalesce((select jsonb_agg(h order by h ->> 'at' desc) from (
      select jsonb_build_object('id', b.id, 'at', b.created_at, 'attack', b.attacker = uid,
        'other', (select pseudo from profiles where id = case when b.attacker = uid then b.defender else b.attacker end),
        'other_id', case when b.attacker = uid then b.defender else b.attacker end,
        'won', b.winner = uid, 'score', case when b.attacker = uid then b.a_won || '-' || b.d_won else b.d_won || '-' || b.a_won end,
        'delta', case when b.attacker = uid then b.a_delta else b.d_delta end, 'mode', b.mode,
        'revenge', b.defender = uid and revenge_ok(b.id, uid)) h
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' order by b.created_at desc limit 15) x), '[]'));
end $$;

revoke execute on function public.revenge_ok(uuid, uuid) from public, anon, authenticated;
