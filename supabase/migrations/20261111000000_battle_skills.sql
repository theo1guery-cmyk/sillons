-- The Bataille de cartes gets three things from the 2.0, for everyone:
-- * the skills: every Mythique and Légendaire has its own fixed skill (Remix, Encore, Refrain, Featuring, Larsen,
--   Hymne, Ovation); one skill can be fired per battle, when the card is played;
-- * the families: Street (rap, afro, latino) beats Mainstream (pop, soul, chanson) beats Live (rock, électro, jazz,
--   classique) beats Street: +10 to the card that has the upper hand;
-- * the defense plan: Agressif, Patient, Spécialiste or Imprévisible, the way my deck plays when it is attacked
--   (its skill too).
-- Jackpot (a Hype token) has no meaning without tokens: it becomes Ovation, +8 on the round.

create or replace function public.battle2_skill(p_track bigint, p_tier int) returns text language sql immutable as $$
  select case when p_tier >= 4 then (array['remix', 'encore', 'refrain', 'feat', 'larsen', 'hymne', 'ovation'])[1 + (abs(p_track) * 7919 % 7)::int] end
$$;

create or replace function public.battle_vals(p_cards uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare owner_id uuid; h jsonb; res jsonb := '[]'; j jsonb; add int; syn int; syns jsonb; t tracks; n int; v int;
  arts text[]; albs text[]; years int[]; gens int[]; rainbow boolean;
begin
  select owner into owner_id from cards where id = p_cards[1];
  h := battle_headliner_json(battle_headliner(owner_id, p_cards));
  select array_agg(lower(t2.artist)), array_agg(lower(t2.artist || '|' || coalesce(t2.album, ''))), array_agg(t2.year::int), array_agg(t2.genre::int), count(distinct c.tier) >= 5
    into arts, albs, years, gens, rainbow from cards c join tracks t2 on t2.id = c.track_id where c.id = any(p_cards);
  for j in select battle_card(c) from cards c where c.id = any(p_cards) order by array_position(p_cards, c.id) loop
    select * into t from tracks where id = (j ->> 'track_id')::bigint;
    add := case when h is null then 0 when coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false) then (h ->> 'syn')::int else (h ->> 'aura')::int end;
    syn := 0; syns := '[]';
    n := (select count(*) from unnest(arts) x where x = lower(t.artist));
    if n >= 2 then v := (array[0, 4, 8, 12, 16])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'artist', 'n', n, 'v', v, 'of', t.artist)); end if;
    if coalesce(t.album, '') <> '' then
      n := (select count(*) from unnest(albs) x where x = lower(t.artist || '|' || t.album));
      if n >= 2 then v := (array[0, 6, 12, 18, 24])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'album', 'n', n, 'v', v, 'of', t.album)); end if;
    end if;
    if t.year is not null then
      n := (select count(*) from unnest(years) x where x = t.year);
      if n >= 3 then v := (array[0, 0, 4, 7, 10])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'year', 'n', n, 'v', v, 'of', t.year::text)); end if;
    end if;
    if t.genre is not null and t.genre <> 10 then
      n := (select count(*) from unnest(gens) x where x = t.genre);
      if n >= 3 then v := (array[0, 0, 3, 5, 8])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'genre', 'n', n, 'v', v, 'of', t.genre::text)); end if;
    end if;
    if rainbow then syn := syn + 6; syns := syns || jsonb_build_array(jsonb_build_object('k', 'rainbow', 'n', 5, 'v', 6)); end if;
    syn := least(syn, 30);
    if add + syn > 0 then
      j := j || jsonb_build_object('flow', (j ->> 'flow')::int + add + syn, 'endu', (j ->> 'endu')::int + add + syn, 'hype', (j ->> 'hype')::int + add + syn, 'pw', (j ->> 'pw')::int + add + syn);
    end if;
    if add > 0 then j := j || jsonb_build_object('syn', add, 'star', coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false), 'head', h ->> 'name'); end if;
    j := j || jsonb_build_object('syns', syns, 'sb', syn, 'album', t.album, 'year', t.year, 'genre', t.genre,
      'fam', battle2_family(t.genre), 'skill', battle2_skill(t.id, (j ->> 'tier')::int));
    res := res || jsonb_build_array(j);
  end loop;
  return res;
end $$;

-- the defending deck, by its plan: its card for this round, and whether it fires its skill
create or replace function public.battle_ai(b battles, out slot int, out skill boolean)
language plpgsql volatile security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; plan text := coalesce((select plan from battle_decks where owner = b.defender), 'spec');
  decisive boolean := b.a_won = 2 or b.d_won = 2 or b.round = 4; c jsonb; sk text;
begin
  select k into slot from generate_series(0, 4) k where not (k = any(b.d_used))
  order by case plan
    when 'aggro' then (b.d_vals -> k ->> 'pw')::int
    when 'patient' then case when decisive then (b.d_vals -> k ->> st)::int else -(b.d_vals -> k ->> 'pw')::int end
    when 'random' then random() * 100
    else (b.d_vals -> k ->> st)::int + random() * 12 end desc
  limit 1;
  c := b.d_vals -> slot; sk := c ->> 'skill';
  skill := b.d_skill is null and sk is not null and case sk
    when 'refrain' then b.round > 0 and (b.log -> -1 ->> 'won_a')::boolean
    when 'hymne' then b.a_won = 2 or b.d_won = 2
    when 'feat' then exists (select 1 from unnest(b.d_used) u where b.d_vals -> u ->> 'artist' = c ->> 'artist')
    else plan = 'aggro' or decisive or random() < .5 end;
end $$;

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
    'winner', case when b.status = 'done' then b.winner = p_uid end, 'delta', case when s.a then b.a_delta else b.d_delta end, 'reward', case when s.a then b.reward else 0 end,
    'opp_cards', case when b.status = 'done' then case when s.a then b.d_vals else b.a_vals end end)
  from s
$$;

drop function if exists public.battle_play(uuid, int);
create or replace function public.battle_play(p_battle uuid, p_slot int, p_skill boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles; st text; side_a boolean; ai record;
begin
  select * into b from battles where id = p_battle and (attacker = uid or defender = uid) for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'playing' then return battle_view(b, uid); end if;
  side_a := uid = b.attacker;
  if b.mode <> 'live' and not side_a then raise exception 'battle_not_found'; end if;
  if p_slot is null or p_slot < 0 or p_slot > 4 or p_slot = any(case when side_a then b.a_used else b.d_used end) then raise exception 'battle_bad_card'; end if;
  if side_a then b.a_pick := p_slot; else b.d_pick := p_slot; end if;
  if coalesce(p_skill, false) then     -- a skill: one per battle, on a card that has one
    if side_a and b.a_skill is null and b.a_vals -> p_slot ->> 'skill' is not null then b.a_skill := b.round;
    elsif not side_a and b.d_skill is null and b.d_vals -> p_slot ->> 'skill' is not null then b.d_skill := b.round; end if;
  end if;
  if b.mode <> 'live' then
    select * into ai from battle_ai(b);
    b.d_pick := ai.slot; if ai.skill then b.d_skill := b.round; end if;
  end if;
  if b.a_pick is not null and b.d_pick is not null then
    b := battle_resolve(b);
    return battle_view(b, uid) || jsonb_build_object('last', battle_view(b, uid) -> 'log' -> -1);
  end if;
  update battles set a_pick = b.a_pick, d_pick = b.d_pick, a_skill = b.a_skill, d_skill = b.d_skill where id = b.id;
  return battle_view(b, uid);
end $$;

create or replace function public.battle_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; d uuid[];
begin
  select * into p from profiles where id = uid;
  d := battle_deck_of(uid);
  return jsonb_build_object('trophies', p.trophies, 'best', p.best_trophies, 'league', league_of(p.trophies), 'wins', p.battle_wins, 'losses', p.battle_losses,
    'chosen', exists (select 1 from battle_decks where owner = uid and cardinality(cards) = 5),
    'deck', coalesce(battle_vals(d), '[]'),
    'artist', battle_headliner_json(battle_headliner(uid, d)), 'plan', coalesce((select plan from battle_decks where owner = uid), 'spec'), 'artist_chosen', (select artist is not null from battle_decks where owner = uid),
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
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' and b.mode <> 'sim' order by b.created_at desc limit 15) x), '[]'));
end $$;

create or replace function public.set_battle_deck(p_cards uuid[], p_artist uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_artist is not null and not exists (select 1 from cards where id = p_artist and owner = uid and kind = 'artist') then raise exception 'not_owned'; end if;
  if p_cards is null or cardinality(p_cards) = 0 then        -- the automatic deck (the plan is kept)
    update battle_decks set cards = '{}', artist = p_artist where owner = uid; return;
  end if;
  if cardinality(p_cards) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'battle_five'; end if;
  if (select count(*) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then raise exception 'not_owned'; end if;
  if (select count(distinct track_id) from cards where id = any(p_cards)) <> 5 then raise exception 'battle_same_track'; end if;
  insert into battle_decks (owner, cards, artist) values (uid, p_cards, p_artist) on conflict (owner) do update set cards = excluded.cards, artist = excluded.artist;
end $$;

create or replace function public.set_battle_plan(p_plan text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_plan not in ('aggro', 'patient', 'spec', 'random') then raise exception 'bad_plan'; end if;
  insert into battle_decks (owner, cards, plan) values (uid, '{}', p_plan)
  on conflict (owner) do update set plan = excluded.plan;
end $$;

create or replace function public.battle2_play(p_battle uuid, p_slot int, p_bet int default 0, p_skill boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_admin(); b battles; ai record; st text; st0 text; mine jsonb; his jsonb; ms text; hs text; mv int; hv int; won boolean;
  mf int; hf int; mfam int; hfam int; mbon jsonb := '[]'; hbon jsonb := '[]'; m_sk boolean; h_sk boolean; bet int := coalesce(p_bet, 0);
begin
  select * into b from battles where id = p_battle and attacker = uid and v2 for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'playing' then return battle2_view(b); end if;
  if p_slot is null or p_slot < 0 or p_slot > 4 or p_slot = any(b.a_used) then raise exception 'battle_bad_card'; end if;
  if bet < 0 or bet > least(2, b.a_tokens) then raise exception 'battle_bad_bet'; end if;
  mine := b.a_vals -> p_slot; ms := mine ->> 'skill';
  m_sk := coalesce(p_skill, false) and ms is not null and b.a_skill is null;
  select * into ai from battle2_ai(b);
  his := b.d_vals -> ai.slot; hs := his ->> 'skill'; h_sk := ai.skill;
  st := b.stats[b.round + 1]; st0 := st;
  -- Remix: the stat is drawn again (among the three others)
  if (m_sk and ms = 'remix') or (h_sk and hs = 'remix') then
    st := (select x from unnest(array['flow', 'endu', 'hype', 'pw']) x where x <> st0 order by random() limit 1);
  end if;
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  -- the families: +10 to the one that has the upper hand
  mfam := (mine ->> 'fam')::int; hfam := (his ->> 'fam')::int;
  if mfam is not null and hfam is not null and (mfam + 1) % 3 = hfam then mv := mv + 10; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Famille', 'v', 10)); end if;
  if mfam is not null and hfam is not null and (hfam + 1) % 3 = mfam then hv := hv + 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Famille', 'v', 10)); end if;
  -- the tokens
  if bet > 0 then mv := mv + bet * 8; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Jetons ×' || bet, 'v', bet * 8)); end if;
  if ai.bet > 0 then hv := hv + ai.bet * 8; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Jetons ×' || ai.bet, 'v', ai.bet * 8)); end if;
  -- the skills
  if m_sk then
    if ms = 'refrain' and b.round > 0 and not (b.log -> -1 ->> 'won_a')::boolean then mv := mv + 12; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Refrain', 'v', 12)); end if;
    if ms = 'feat' and exists (select 1 from unnest(b.a_used) u where b.a_vals -> u ->> 'artist' = mine ->> 'artist') then mv := mv + 10; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Featuring', 'v', 10)); end if;
    if ms = 'hymne' and (b.a_won = 2 or b.d_won = 2) then mv := mv + 10; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Hymne', 'v', 10)); end if;
    if ms = 'ovation' then mv := mv + 8; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Ovation', 'v', 8)); end if;
    if ms = 'larsen' then hv := hv - 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Larsen', 'v', -10)); end if;
  end if;
  if h_sk then
    if hs = 'refrain' and b.round > 0 and (b.log -> -1 ->> 'won_a')::boolean then hv := hv + 12; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Refrain', 'v', 12)); end if;
    if hs = 'feat' and exists (select 1 from unnest(b.d_used) u where b.d_vals -> u ->> 'artist' = his ->> 'artist') then hv := hv + 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Featuring', 'v', 10)); end if;
    if hs = 'hymne' and (b.a_won = 2 or b.d_won = 2) then hv := hv + 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Hymne', 'v', 10)); end if;
    if hs = 'ovation' then hv := hv + 8; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Ovation', 'v', 8)); end if;
    if hs = 'larsen' then mv := mv - 10; mbon := mbon || jsonb_build_array(jsonb_build_object('t', 'Larsen', 'v', -10)); end if;
  end if;
  won := mv > hv or (mv = hv and (coalesce((mine ->> 'gem')::boolean, false) > coalesce((his ->> 'gem')::boolean, false)
    or (coalesce((mine ->> 'gem')::boolean, false) = coalesce((his ->> 'gem')::boolean, false) and (mine ->> 'rank')::int >= (his ->> 'rank')::int)));
  b.a_tokens := b.a_tokens - bet + case when m_sk and ms = 'jackpot' then 1 else 0 end;
  b.d_tokens := b.d_tokens - ai.bet + case when h_sk and hs = 'jackpot' then 1 else 0 end;
  if m_sk then b.a_skill := b.round; end if;
  if h_sk then b.d_skill := b.round; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'stat0', st0, 'mine', p_slot, 'his', his, 'mv', mv, 'hv', hv, 'mb', (mine ->> st)::int, 'hb', (his ->> st)::int,
    'mbon', mbon, 'hbon', hbon, 'msk', case when m_sk then ms end, 'hsk', case when h_sk then hs end, 'mbet', bet, 'hbet', ai.bet, 'won', won, 'won_a', won);
  -- Encore: my card comes back to my hand (it is not used up)
  if not (m_sk and ms = 'encore') then b.a_used := b.a_used || p_slot::smallint; end if;
  if not (h_sk and hs = 'encore') then b.d_used := b.d_used || ai.slot::smallint; end if;
  b.round := b.round + 1;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  if b.a_won >= 3 or b.d_won >= 3 or b.round >= 5 then
    b.status := 'done'; b.finished_at := now(); b.winner := case when b.a_won > b.d_won then b.attacker else b.defender end;
    b.a_delta := 0; b.d_delta := 0;
  end if;
  update battles set round = b.round, a_used = b.a_used, d_used = b.d_used, a_won = b.a_won, d_won = b.d_won, log = b.log, status = b.status,
    finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, a_tokens = b.a_tokens, d_tokens = b.d_tokens,
    a_skill = b.a_skill, d_skill = b.d_skill where id = b.id;
  return battle2_view(b) || jsonb_build_object('last', b.log -> -1);
end $$;

revoke execute on function public.battle_ai(battles) from public, anon, authenticated;
revoke execute on function public.battle_play(uuid, int, boolean), public.set_battle_plan(text) from public, anon;
grant execute on function public.battle_play(uuid, int, boolean), public.set_battle_plan(text) to authenticated;
