-- The ranked live: a queue of the players online, matched by trophies (the gap allowed grows while waiting); two
-- real players, both choosing their cards each round, trophies at stake for both. Nobody after 30 seconds: the game
-- falls back on a ranked battle against a deck.

alter table public.battles add column if not exists ranked boolean not null default false;

create table if not exists public.battle_queue (
  owner uuid primary key references public.profiles on delete cascade,
  trophies int not null,
  deck smallint,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  battle uuid references public.battles on delete set null
);
alter table public.battle_queue enable row level security;

create or replace function public.battle_resolve(b battles) returns battles
language plpgsql security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; mine jsonb := b.a_vals -> b.a_pick; his jsonb := b.d_vals -> b.d_pick; mv int; hv int; won boolean;
  st0 text := b.stats[b.round + 1]; a_sk boolean := b.a_skill is not distinct from b.round; d_sk boolean := b.d_skill is not distinct from b.round;
  ms text := mine ->> 'skill'; hs text := his ->> 'skill'; mf int := (mine ->> 'fam')::int; hf int := (his ->> 'fam')::int;
  abon jsonb := '[]'; dbon jsonb := '[]'; lost_a boolean := b.round > 0 and not coalesce((b.log -> -1 ->> 'won_a')::boolean, true);
  att profiles; def profiles; diff int; am record; dm record; ad int := 0; dd int := 0; rw int := 0; who text;
begin
  a_sk := a_sk and ms is not null; d_sk := d_sk and hs is not null;
  -- Remix: the stat of the round is drawn again
  if (a_sk and ms = 'remix') or (d_sk and hs = 'remix') then
    st := (select x from unnest(array['flow', 'endu', 'hype', 'pw']) x where x <> st0 order by random() limit 1);
  end if;
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  -- the families: Street beats Mainstream beats Live beats Street, +10
  if mf is not null and hf is not null and (mf + 1) % 3 = hf then mv := mv + 10; abon := abon || '[{"t": "Famille", "v": 10}]'; end if;
  if mf is not null and hf is not null and (hf + 1) % 3 = mf then hv := hv + 10; dbon := dbon || '[{"t": "Famille", "v": 10}]'; end if;
  -- the skills (one per battle and per side)
  if a_sk then
    if ms = 'refrain' and lost_a then mv := mv + 12; abon := abon || '[{"t": "Refrain", "v": 12}]'; end if;
    if ms = 'feat' and exists (select 1 from unnest(b.a_used) u where b.a_vals -> u ->> 'artist' = mine ->> 'artist') then mv := mv + 10; abon := abon || '[{"t": "Featuring", "v": 10}]'; end if;
    if ms = 'hymne' and (b.a_won = 2 or b.d_won = 2) then mv := mv + 10; abon := abon || '[{"t": "Hymne", "v": 10}]'; end if;
    if ms = 'ovation' then mv := mv + 8; abon := abon || '[{"t": "Ovation", "v": 8}]'; end if;
    if ms = 'larsen' then hv := hv - 10; dbon := dbon || '[{"t": "Larsen", "v": -10}]'; end if;
  end if;
  if d_sk then
    if hs = 'refrain' and b.round > 0 and not lost_a then hv := hv + 12; dbon := dbon || '[{"t": "Refrain", "v": 12}]'; end if;
    if hs = 'feat' and exists (select 1 from unnest(b.d_used) u where b.d_vals -> u ->> 'artist' = his ->> 'artist') then hv := hv + 10; dbon := dbon || '[{"t": "Featuring", "v": 10}]'; end if;
    if hs = 'hymne' and (b.a_won = 2 or b.d_won = 2) then hv := hv + 10; dbon := dbon || '[{"t": "Hymne", "v": 10}]'; end if;
    if hs = 'ovation' then hv := hv + 8; dbon := dbon || '[{"t": "Ovation", "v": 8}]'; end if;
    if hs = 'larsen' then mv := mv - 10; abon := abon || '[{"t": "Larsen", "v": -10}]'; end if;
  end if;
  won := mv > hv or (mv = hv and (coalesce((mine ->> 'gem')::boolean, false) > coalesce((his ->> 'gem')::boolean, false)
    or (coalesce((mine ->> 'gem')::boolean, false) = coalesce((his ->> 'gem')::boolean, false) and (mine ->> 'rank')::int >= (his ->> 'rank')::int)));   -- a 9 or a 10 wins the ties
  b.round := b.round + 1;
  if not (a_sk and ms = 'encore') then b.a_used := b.a_used || b.a_pick; end if;     -- Encore: the card comes back to the hand
  if not (d_sk and hs = 'encore') then b.d_used := b.d_used || b.d_pick; end if;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'a_slot', b.a_pick, 'd_slot', b.d_pick, 'a', mine, 'd', his, 'av', mv, 'dv', hv, 'won_a', won,
    'ab', (mine ->> st)::int, 'db', (his ->> st)::int, 'stat0', st0, 'abon', abon, 'dbon', dbon, 'ask', case when a_sk then ms end, 'dsk', case when d_sk then hs end);
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
    elsif b.mode = 'live' and b.ranked then
      -- the ranked live: two real players, each one wins or loses as if he had attacked
      select * into att from profiles where id = b.attacker for update;
      select * into def from profiles where id = b.defender for update;
      am := league_mult(att.trophies); dm := league_mult(def.trophies);
      if b.winner = b.attacker then
        ad := greatest(1, round(greatest(15, least(45, 30 + (def.trophies - att.trophies) / 20)) * am.g));
        dd := -least(def.trophies, round(greatest(8, least(30, 20 + (att.trophies - def.trophies) / 25)) * dm.l)::int);
      else
        dd := greatest(1, round(greatest(15, least(45, 30 + (att.trophies - def.trophies) / 20)) * dm.g));
        ad := -least(att.trophies, round(greatest(8, least(30, 20 + (def.trophies - att.trophies) / 25)) * am.l)::int);
      end if;
      perform bump(b.winner, 'battle_win');
      if (select n from daily_counters where owner = b.winner and day = game_day() and metric = 'battle_win') <= 5 then
        rw := 100; perform add_streams(b.winner, rw, 'Bataille de cartes gagnée');
      end if;
      update profiles set trophies = greatest(0, trophies + ad), best_trophies = greatest(best_trophies, trophies + ad),
        battle_wins = battle_wins + case when b.winner = b.attacker then 1 else 0 end, battle_losses = battle_losses + case when b.winner = b.attacker then 0 else 1 end where id = b.attacker;
      update profiles set trophies = greatest(0, trophies + dd), best_trophies = greatest(best_trophies, trophies + dd),
        battle_wins = battle_wins + case when b.winner = b.defender then 1 else 0 end, battle_losses = battle_losses + case when b.winner = b.defender then 0 else 1 end where id = b.defender;
      perform bump(b.attacker, 'battles'); perform bump(b.defender, 'battles');
    elsif b.mode = 'friend' then
      select pseudo into who from profiles where id = b.attacker;
      perform notify(b.defender, 'battle_friend', who || case when b.winner = b.attacker then ' a battu ton deck ' else ' a perdu contre ton deck ' end
                     || greatest(b.a_won, b.d_won) || '-' || least(b.a_won, b.d_won) || ' en Bataille de cartes amicale.');
    end if;
    b.a_delta := ad; b.d_delta := dd; b.reward := rw;
  end if;
  update battles set round = b.round, a_used = b.a_used, d_used = b.d_used, a_won = b.a_won, d_won = b.d_won, log = b.log, status = b.status,
    a_pick = null, d_pick = null, round_at = b.round_at, finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward, a_skill = b.a_skill, d_skill = b.d_skill where id = b.id;
  return b;
end $$;

create or replace function public.battle_view(b battles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select p_uid = b.attacker a)
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'round', b.round,
    'stat', case when b.status = 'playing' then b.stats[b.round + 1] end,
    'ranked', b.mode = 'ranked' or coalesce(b.ranked, false),
    'skill_used', case when s.a then b.a_skill else b.d_skill end is not null, 'opp_skill_used', case when s.a then b.d_skill else b.a_skill end is not null,
    'a_won', case when s.a then b.a_won else b.d_won end, 'd_won', case when s.a then b.d_won else b.a_won end,
    'mine', case when s.a then b.a_vals else b.d_vals end, 'used', to_jsonb(case when s.a then b.a_used else b.d_used end),
    'picked', case when s.a then b.a_pick else b.d_pick end is not null, 'opp_picked', case when s.a then b.d_pick else b.a_pick end is not null,
    'deadline', case when b.mode = 'live' and b.status = 'playing' then b.round_at + interval '25 seconds' end,
    'log', coalesce((select jsonb_agg(case when s.a then jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'a_slot', 'his', x -> 'd', 'mv', x -> 'av', 'hv', x -> 'dv', 'won', (x ->> 'won_a')::boolean, 'stat0', x ->> 'stat0', 'mb', x -> 'ab', 'hb', x -> 'db', 'mbon', x -> 'abon', 'hbon', x -> 'dbon', 'msk', x ->> 'ask', 'hsk', x ->> 'dsk')
                                       else jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'd_slot', 'his', x -> 'a', 'mv', x -> 'dv', 'hv', x -> 'av', 'won', not (x ->> 'won_a')::boolean, 'stat0', x ->> 'stat0', 'mb', x -> 'db', 'hb', x -> 'ab', 'mbon', x -> 'dbon', 'hbon', x -> 'abon', 'msk', x ->> 'dsk', 'hsk', x ->> 'ask') end order by k)
                     from jsonb_array_elements(b.log) with ordinality t(x, k)), '[]'),
    'opp', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies), 'cosmetics', p.cosmetics, 'title', p.title)
            from profiles p where p.id = case when s.a then b.defender else b.attacker end),
    'me', (select jsonb_build_object('pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies)) from profiles p where p.id = p_uid),
    'winner', case when b.status = 'done' then b.winner = p_uid end, 'delta', case when s.a then b.a_delta else b.d_delta end, 'reward', case when s.a = (b.winner = b.attacker) then b.reward else 0 end,
    'opp_cards', case when b.status = 'done' then case when s.a then b.d_vals else b.a_vals end end)
  from s
$$;

-- waiting: is somebody of my level waiting too? then the battle begins, for both
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
           and abs(trophies - q.trophies) <= 150 + 25 * greatest(waited, extract(epoch from now() - joined_at)::int)
           order by joined_at for update skip locked loop
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

create or replace function public.battle_queue_join(p_deck smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d uuid[];
begin
  d := battle_slot_deck(uid, p_deck);
  if coalesce(cardinality(d), 0) < 5 then raise exception 'battle_need_five'; end if;
  if exists (select 1 from battles where (attacker = uid or defender = uid) and mode = 'live' and status = 'playing') then raise exception 'battle_live_busy'; end if;
  insert into battle_queue (owner, trophies, deck) values (uid, (select trophies from profiles where id = uid), p_deck)
  on conflict (owner) do update set trophies = excluded.trophies, deck = excluded.deck, joined_at = now(), seen_at = now(), battle = null;
  return battle_queue_poll();
end $$;

create or replace function public.battle_queue_leave() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); q battle_queue; b battles;
begin
  delete from battle_queue where owner = uid returning * into q;
  if q.battle is not null then select * into b from battles where id = q.battle; return jsonb_build_object('status', 'matched', 'battle', battle_view(b, uid)); end if;
  return jsonb_build_object('status', 'left');
end $$;

revoke execute on function public.battle_queue_poll(), public.battle_queue_join(smallint), public.battle_queue_leave() from public, anon;
grant execute on function public.battle_queue_poll(), public.battle_queue_join(smallint), public.battle_queue_leave() to authenticated;
