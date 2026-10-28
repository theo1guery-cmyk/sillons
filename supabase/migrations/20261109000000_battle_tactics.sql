-- The Bataille de cartes gets a gamble, while staying simple: the Boost. Once per battle, +15 to my card on the round
-- I choose. The other side has one too, and I only know whether it is spent.
-- The deck that defends plays smarter: it keeps its cards for the stats where they matter most, and boosts on the
-- decisive rounds.

alter table public.battles add column if not exists a_boost smallint, add column if not exists d_boost smallint;

-- the defending deck's card for this round: strong here, but not the one it needs most later (and a bit of surprise)
create or replace function public.battle_ai_pick(b battles) returns int
language sql volatile security definer set search_path = public as $$
  select k from generate_series(0, 4) k
  where not (k = any(b.d_used))
  order by case when random() < .2 then random() * 100 else
    (b.d_vals -> k ->> b.stats[b.round + 1])::int
    - .5 * coalesce((select max((b.d_vals -> k ->> s)::int - (select max((b.d_vals -> o ->> s)::int) from generate_series(0, 4) o where o <> k and not (o = any(b.d_used))))
                     from unnest(b.stats[b.round + 2:5]) s), 0) end desc
  limit 1
$$;

create or replace function public.battle_resolve(b battles) returns battles
language plpgsql security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; mine jsonb := b.a_vals -> b.a_pick; his jsonb := b.d_vals -> b.d_pick; mv int; hv int; won boolean;
  att profiles; def profiles; diff int; am record; dm record; ad int := 0; dd int := 0; rw int := 0; who text;
begin
  mv := (mine ->> st)::int + case when b.a_boost = b.round then 15 else 0 end; hv := (his ->> st)::int + case when b.d_boost = b.round then 15 else 0 end;
  won := mv > hv or (mv = hv and (coalesce((mine ->> 'gem')::boolean, false) > coalesce((his ->> 'gem')::boolean, false)
    or (coalesce((mine ->> 'gem')::boolean, false) = coalesce((his ->> 'gem')::boolean, false) and (mine ->> 'rank')::int >= (his ->> 'rank')::int)));   -- a 9 or a 10 wins the ties
  b.round := b.round + 1; b.a_used := b.a_used || b.a_pick; b.d_used := b.d_used || b.d_pick;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'a_slot', b.a_pick, 'd_slot', b.d_pick, 'a', mine, 'd', his, 'av', mv, 'dv', hv, 'won_a', won, 'ab', coalesce(b.a_boost = b.round - 1, false), 'db', coalesce(b.d_boost = b.round - 1, false));
  b.a_pick := null; b.d_pick := null; b.round_at := now();
  if b.a_won >= 3 or b.d_won >= 3 or b.round >= 5 then
    b.status := 'done'; b.finished_at := now();
    b.winner := case when b.a_won > b.d_won then b.attacker else b.defender end;
    if b.mode = 'ranked' then
      select * into att from profiles where id = b.attacker for update;
      select * into def from profiles where id = b.defender for update;
      diff := coalesce(def.trophies, att.trophies) - att.trophies;
      am := league_mult(att.trophies); dm := league_mult(coalesce(def.trophies, 0));
      if b.winner = b.attacker then
        ad := greatest(1, round(greatest(15, least(45, 30 + diff / 20)) * am.g)); dd := -least(coalesce(def.trophies, 0), round(greatest(5, least(15, 10 + diff / 40)) * dm.l)::int);
        perform bump(b.attacker, 'battle_win');
        if (select n from daily_counters where owner = b.attacker and day = game_day() and metric = 'battle_win') <= 5 then
          rw := 100; perform add_streams(b.attacker, rw, 'Bataille de cartes gagnée');
        end if;
      else
        ad := -least(att.trophies, round(greatest(8, least(30, 20 + diff / 25)) * am.l)::int); dd := greatest(1, round(greatest(5, least(20, 10 - diff / 40)) * dm.g));
      end if;
      update profiles set trophies = trophies + ad, best_trophies = greatest(best_trophies, trophies + ad),
        battle_wins = battle_wins + case when b.winner = b.attacker then 1 else 0 end, battle_losses = battle_losses + case when b.winner = b.attacker then 0 else 1 end where id = b.attacker;
      if b.defender is not null then
        update profiles set trophies = greatest(0, trophies + dd), best_trophies = greatest(best_trophies, trophies + dd) where id = b.defender;
      end if;
      perform bump(b.attacker, 'battles');
    elsif b.mode = 'friend' then
      select pseudo into who from profiles where id = b.attacker;
      perform notify(b.defender, 'battle_friend', who || case when b.winner = b.attacker then ' a battu ton deck ' else ' a perdu contre ton deck ' end
                     || greatest(b.a_won, b.d_won) || '-' || least(b.a_won, b.d_won) || ' en Bataille de cartes amicale.');
    end if;
    b.a_delta := ad; b.d_delta := dd; b.reward := rw;
  end if;
  update battles set round = b.round, a_used = b.a_used, d_used = b.d_used, a_won = b.a_won, d_won = b.d_won, log = b.log, status = b.status,
    a_pick = null, d_pick = null, round_at = b.round_at, finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward, a_boost = b.a_boost, d_boost = b.d_boost where id = b.id;
  return b;
end $$;

create or replace function public.battle_view(b battles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select p_uid = b.attacker a)
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'round', b.round,
    'stat', case when b.status = 'playing' then b.stats[b.round + 1] end,
    'boost', case when s.a then b.a_boost else b.d_boost end, 'opp_boost', case when s.a then b.d_boost else b.a_boost end,
    'a_won', case when s.a then b.a_won else b.d_won end, 'd_won', case when s.a then b.d_won else b.a_won end,
    'mine', case when s.a then b.a_vals else b.d_vals end, 'used', to_jsonb(case when s.a then b.a_used else b.d_used end),
    'picked', case when s.a then b.a_pick else b.d_pick end is not null, 'opp_picked', case when s.a then b.d_pick else b.a_pick end is not null,
    'deadline', case when b.mode = 'live' and b.status = 'playing' then b.round_at + interval '25 seconds' end,
    'log', coalesce((select jsonb_agg(case when s.a then jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'a_slot', 'his', x -> 'd', 'mv', x -> 'av', 'hv', x -> 'dv', 'won', (x ->> 'won_a')::boolean, 'mb', coalesce((x ->> 'ab')::boolean, false), 'hb', coalesce((x ->> 'db')::boolean, false))
                                       else jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'd_slot', 'his', x -> 'a', 'mv', x -> 'dv', 'hv', x -> 'av', 'won', not (x ->> 'won_a')::boolean, 'mb', coalesce((x ->> 'db')::boolean, false), 'hb', coalesce((x ->> 'ab')::boolean, false)) end order by k)
                     from jsonb_array_elements(b.log) with ordinality t(x, k)), '[]'),
    'opp', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies), 'cosmetics', p.cosmetics, 'title', p.title)
            from profiles p where p.id = case when s.a then b.defender else b.attacker end),
    'me', (select jsonb_build_object('pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies)) from profiles p where p.id = p_uid),
    'winner', case when b.status = 'done' then b.winner = p_uid end, 'delta', case when s.a then b.a_delta else b.d_delta end, 'reward', case when s.a then b.reward else 0 end,
    'opp_cards', case when b.status = 'done' then case when s.a then b.d_vals else b.a_vals end end)
  from s
$$;

drop function if exists public.battle_play(uuid, int);
create or replace function public.battle_play(p_battle uuid, p_slot int, p_boost boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles; st text; side_a boolean;
begin
  select * into b from battles where id = p_battle and (attacker = uid or defender = uid) for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'playing' then return battle_view(b, uid); end if;
  side_a := uid = b.attacker;
  if b.mode <> 'live' and not side_a then raise exception 'battle_not_found'; end if;
  if p_slot is null or p_slot < 0 or p_slot > 4 or p_slot = any(case when side_a then b.a_used else b.d_used end) then raise exception 'battle_bad_card'; end if;
  if side_a then b.a_pick := p_slot; else b.d_pick := p_slot; end if;
  if p_boost then
    if side_a and b.a_boost is null then b.a_boost := b.round; elsif not side_a and b.d_boost is null then b.d_boost := b.round; end if;
  end if;
  if b.mode <> 'live' then
    b.d_pick := battle_ai_pick(b);
    -- its Boost: on a decisive round (match point for one side, or the last chance), sometimes earlier
    if b.d_boost is null and (b.a_won = 2 or b.d_won = 2 or b.round = 4 or random() < .15) then b.d_boost := b.round; end if;
  end if;
  if b.a_pick is not null and b.d_pick is not null then
    b := battle_resolve(b);
    return battle_view(b, uid) || jsonb_build_object('last', battle_view(b, uid) -> 'log' -> -1);
  end if;
  update battles set a_pick = b.a_pick, d_pick = b.d_pick, a_boost = b.a_boost, d_boost = b.d_boost where id = b.id;
  return battle_view(b, uid);
end $$;

revoke execute on function public.battle_ai_pick(battles) from public, anon, authenticated;
revoke execute on function public.battle_play(uuid, int, boolean) from public, anon;
grant execute on function public.battle_play(uuid, int, boolean) to authenticated;
