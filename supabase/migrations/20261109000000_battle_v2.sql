-- La Bataille 2.0, in simulation for the admins only (the players keep the Bataille they know):
-- * the deck has a budget: each card costs by its rarity (Commune and Peu commune 1, Rare 2, Épique 3, Mythique 4,
--   Légendaire 5), the budget grows with the league (14 in Bronze … 18 in Diamant and Légende). A deck over budget is
--   composed again automatically, the best possible within the budget;
-- * three families of genres: Street (rap, latino, afro) beats Mainstream (pop, soul, chanson) beats Live (rock,
--   électro, jazz, classique) beats Street: +10 to the card that has the upper hand. Inclassable is neutral;
-- * combos: 2 tracks of the same album (+5 each), 3 tracks of the same year (+5 each);
-- * every Mythique and Légendaire has its own fixed skill; one skill can be fired per battle;
-- * 3 Hype tokens per battle: 0, 1 or 2 bet each round, +8 each, the other side only sees how many are left;
-- * the defense plan: Agressif, Patient, Spécialiste or Imprévisible, the way my deck defends (its tokens and its
--   skill too).

alter table public.battle_decks add column if not exists cards2 uuid[], add column if not exists plan text not null default 'spec';
alter table public.battle_decks drop constraint if exists battle_decks_plan_check;
alter table public.battle_decks add constraint battle_decks_plan_check check (plan in ('aggro', 'patient', 'spec', 'random'));

alter table public.battles drop constraint if exists battles_mode_check;
alter table public.battles add constraint battles_mode_check check (mode in ('ranked', 'friend', 'live', 'sim'));
alter table public.battles add column if not exists v2 boolean not null default false,
  add column if not exists a_tokens smallint not null default 3, add column if not exists d_tokens smallint not null default 3,
  add column if not exists a_skill smallint, add column if not exists d_skill smallint,          -- the round a skill was fired in
  add column if not exists d_plan text;

create or replace function public.battle2_cost(p_tier int) returns int language sql immutable as $$
  select (array[1, 1, 2, 3, 4, 5])[least(greatest(coalesce(p_tier, 0), 0), 5) + 1]
$$;
create or replace function public.battle2_budget(p_trophies int) returns int language sql immutable as $$
  select case when p_trophies >= 2300 then 18 when p_trophies >= 1500 then 17 when p_trophies >= 900 then 16 when p_trophies >= 400 then 15 else 14 end
$$;
-- 0 Street, 1 Mainstream, 2 Live, null Inclassable; a beats b when (a + 1) % 3 = b
create or replace function public.battle2_family(p_genre int) returns int language sql immutable as $$
  select case when p_genre in (0, 7, 8) then 0 when p_genre in (1, 4, 5) then 1 when p_genre in (2, 3, 6, 9) then 2 end
$$;
create or replace function public.battle2_skill(p_track bigint, p_tier int) returns text language sql immutable as $$
  select case when p_tier >= 4 then (array['remix', 'encore', 'refrain', 'feat', 'larsen', 'hymne', 'jackpot'])[1 + (abs(p_track) * 7919 % 7)::int] end
$$;

-- the values of a deck for the Bataille 2.0: those of the Bataille, plus the cost, the family, the skill and the combos
create or replace function public.battle2_vals(p_cards uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := battle_vals(p_cards); res jsonb := '[]'; j jsonb; t tracks; add int; combo text[]; albums bigint[]; years int[];
begin
  select array_agg(t2.album_id), array_agg(t2.year::int) into albums, years from cards c join tracks t2 on t2.id = c.track_id where c.id = any(p_cards);
  for j in select x from jsonb_array_elements(coalesce(v, '[]')) x loop
    select * into t from tracks where id = (j ->> 'track_id')::bigint;
    add := 0; combo := '{}';
    if coalesce(t.album_id, -1) > 0 and (select count(*) from unnest(albums) a where a = t.album_id) >= 2 then add := add + 5; combo := array_append(combo, 'album'); end if;
    if t.year is not null and (select count(*) from unnest(years) y where y = t.year) >= 3 then add := add + 5; combo := array_append(combo, 'millesime'); end if;
    j := j || jsonb_build_object('cost', battle2_cost((j ->> 'tier')::int), 'fam', battle2_family(t.genre), 'skill', battle2_skill(t.id, (j ->> 'tier')::int),
      'year', t.year, 'combo', to_jsonb(combo), 'cb', add);
    if add > 0 then
      j := j || jsonb_build_object('flow', (j ->> 'flow')::int + add, 'endu', (j ->> 'endu')::int + add, 'hype', (j ->> 'hype')::int + add, 'pw', (j ->> 'pw')::int + add);
    end if;
    res := res || jsonb_build_array(j);
  end loop;
  return res;
end $$;

-- the deck of the Bataille 2.0: the one chosen if it still fits the budget, else the best possible within it
create or replace function public.battle2_deck_of(p_user uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare d uuid[]; bud int; r record; spent int := 0; n int := 0;
begin
  bud := battle2_budget((select trophies from profiles where id = p_user));
  select cards2 into d from battle_decks where owner = p_user;
  if d is not null and cardinality(d) = 5 and (select count(distinct track_id) from cards where owner = p_user and kind = 'track' and id = any(d)) = 5
     and (select sum(battle2_cost(tier)) from cards where id = any(d)) <= bud then return d; end if;
  d := '{}';
  for r in select x.id, x.tier from (select distinct on (c.track_id) c.id, c.tier, c.rank, (select pw from duel_stats(c.track_id, c.rank)) pw
                                      from cards c where c.owner = p_user and c.kind = 'track' order by c.track_id, c.tier desc, c.rank desc) x
           order by x.pw + x.tier * 3 desc loop
    exit when n = 5;
    if spent + battle2_cost(r.tier) + (4 - n) <= bud then d := d || r.id; spent := spent + battle2_cost(r.tier); n := n + 1; end if;
  end loop;
  return d;
end $$;

create or replace function public.battle2_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_admin(); p profiles; d uuid[]; chosen uuid[];
begin
  select * into p from profiles where id = uid;
  d := battle2_deck_of(uid);
  select cards2 into chosen from battle_decks where owner = uid;
  return jsonb_build_object('budget', battle2_budget(p.trophies), 'league', league_of(p.trophies), 'deck', coalesce(battle2_vals(d), '[]'),
    'cost', (select sum(battle2_cost(tier)) from cards where id = any(d)), 'chosen', chosen is not null, 'recomposed', chosen is not null and chosen is distinct from d,
    'plan', coalesce((select plan from battle_decks where owner = uid), 'spec'),
    'artist', battle_headliner_json(battle_headliner(uid, d)));
end $$;

create or replace function public.set_battle_deck2(p_cards uuid[], p_plan text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_admin(); bud int;
begin
  if p_plan is not null and p_plan not in ('aggro', 'patient', 'spec', 'random') then raise exception 'bad_plan'; end if;
  if p_cards is not null and cardinality(p_cards) > 0 then
    if cardinality(p_cards) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'battle_five'; end if;
    if (select count(*) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then raise exception 'not_owned'; end if;
    if (select count(distinct track_id) from cards where id = any(p_cards)) <> 5 then raise exception 'battle_same_track'; end if;
    bud := battle2_budget((select trophies from profiles where id = uid));
    if (select sum(battle2_cost(tier)) from cards where id = any(p_cards)) > bud then raise exception 'battle_budget'; end if;
  end if;
  insert into battle_decks (owner, cards, cards2, plan) values (uid, coalesce(battle_deck_of(uid), '{}'), nullif(p_cards, '{}'), coalesce(p_plan, 'spec'))
  on conflict (owner) do update set cards2 = case when p_cards is null then battle_decks.cards2 else nullif(p_cards, '{}') end, plan = coalesce(p_plan, battle_decks.plan);
end $$;

-- what a side sees of a battle 2.0 (only the attacker plays, in simulation)
create or replace function public.battle2_view(b battles) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'v2', true, 'status', b.status, 'round', b.round,
    'stat', case when b.status = 'playing' then b.stats[b.round + 1] end, 'a_won', b.a_won, 'd_won', b.d_won,
    'mine', b.a_vals, 'used', to_jsonb(b.a_used), 'opp_played', (select count(*) from jsonb_array_elements(b.log)),
    'tokens', b.a_tokens, 'opp_tokens', b.d_tokens, 'skill_used', b.a_skill is not null, 'opp_skill_used', b.d_skill is not null,
    'log', b.log,
    'opp', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies), 'cosmetics', p.cosmetics) from profiles p where p.id = b.defender),
    'me', (select jsonb_build_object('pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies)) from profiles p where p.id = b.attacker),
    'winner', case when b.status = 'done' then b.winner = b.attacker end,
    'opp_cards', case when b.status = 'done' then b.d_vals end, 'plan', case when b.status = 'done' then b.d_plan end)
$$;

create or replace function public.battle2_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_admin(); opp uuid; ad uuid[]; dd uuid[]; b battles;
begin
  update battles set status = 'done', winner = defender, finished_at = now() where attacker = uid and status = 'playing' and v2;
  ad := battle2_deck_of(uid);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  select pr.id into opp from profiles pr join presence pe on pe.id = pr.id
  where pr.id <> uid and pe.seen_at > now() - interval '30 days' and (select count(distinct track_id) from cards where owner = pr.id and kind = 'track') >= 5
  order by abs(pr.trophies - (select trophies from profiles where id = uid)) + random() * 400 limit 1;
  if opp is null then raise exception 'battle_no_opponent'; end if;
  dd := battle2_deck_of(opp);
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  insert into battles (attacker, defender, mode, v2, a_cards, d_cards, a_vals, d_vals, stats, d_plan)
  values (uid, opp, 'sim', true, ad, dd, battle2_vals(ad), battle2_vals(dd), battle_stats(), coalesce((select plan from battle_decks where owner = opp), 'spec'))
  returning * into b;
  return battle2_view(b);
end $$;

-- the defending deck, by its plan: its card, its tokens, its skill
create or replace function public.battle2_ai(b battles, out slot int, out bet int, out skill boolean)
language plpgsql volatile security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; plan text := coalesce(b.d_plan, 'spec'); decisive boolean := b.a_won = 2 or b.d_won = 2 or b.round = 4;
  c jsonb; sk text;
begin
  select k into slot from generate_series(0, 4) k where not (k = any(b.d_used))
  order by case plan
    when 'aggro' then (b.d_vals -> k ->> 'pw')::int
    when 'patient' then case when decisive then (b.d_vals -> k ->> st)::int else -(b.d_vals -> k ->> 'pw')::int end
    when 'random' then random() * 100
    else (b.d_vals -> k ->> st)::int + random() * 12 end desc
  limit 1;
  bet := least(b.d_tokens, case plan
    when 'aggro' then case when b.round < 2 then 2 else 1 end
    when 'patient' then case when decisive then 2 when b.round >= 3 then 1 else 0 end
    when 'random' then floor(random() * 3)::int
    else case when decisive then 2 when random() < .35 then 1 else 0 end end);
  c := b.d_vals -> slot; sk := c ->> 'skill';
  skill := b.d_skill is null and sk is not null and case sk
    when 'refrain' then b.round > 0 and (b.log -> -1 ->> 'won_a')::boolean
    when 'hymne' then b.a_won = 2 or b.d_won = 2
    when 'feat' then exists (select 1 from unnest(b.d_used) u where b.d_vals -> u ->> 'artist' = c ->> 'artist')
    else plan = 'aggro' or decisive or random() < .5 end;
end $$;

-- one round: my card, my tokens, my skill; the defending deck answers; everything is counted
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
    if ms = 'larsen' then hv := hv - 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Larsen', 'v', -10)); end if;
  end if;
  if h_sk then
    if hs = 'refrain' and b.round > 0 and (b.log -> -1 ->> 'won_a')::boolean then hv := hv + 12; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Refrain', 'v', 12)); end if;
    if hs = 'feat' and exists (select 1 from unnest(b.d_used) u where b.d_vals -> u ->> 'artist' = his ->> 'artist') then hv := hv + 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Featuring', 'v', 10)); end if;
    if hs = 'hymne' and (b.a_won = 2 or b.d_won = 2) then hv := hv + 10; hbon := hbon || jsonb_build_array(jsonb_build_object('t', 'Hymne', 'v', 10)); end if;
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

-- the simulations stay out of the history of the Bataille (the defender never hears of them)
create or replace function public.battle_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; d uuid[];
begin
  select * into p from profiles where id = uid;
  d := battle_deck_of(uid);
  return jsonb_build_object('trophies', p.trophies, 'best', p.best_trophies, 'league', league_of(p.trophies), 'wins', p.battle_wins, 'losses', p.battle_losses,
    'chosen', exists (select 1 from battle_decks where owner = uid),
    'deck', coalesce(battle_vals(d), '[]'),
    'artist', battle_headliner_json(battle_headliner(uid, d)), 'artist_chosen', (select artist is not null from battle_decks where owner = uid),
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

revoke execute on function public.battle2_cost(int), public.battle2_budget(int), public.battle2_family(int), public.battle2_skill(bigint, int),
  public.battle2_vals(uuid[]), public.battle2_deck_of(uuid), public.battle2_view(battles), public.battle2_ai(battles) from public, anon, authenticated;
revoke execute on function public.battle2_home(), public.set_battle_deck2(uuid[], text), public.battle2_start(), public.battle2_play(uuid, int, int, boolean) from public, anon;
grant execute on function public.battle2_home(), public.set_battle_deck2(uuid[], text), public.battle2_start(), public.battle2_play(uuid, int, int, boolean) to authenticated;
