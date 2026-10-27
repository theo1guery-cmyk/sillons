-- La Bataille de cartes: the collection fights. Each player has a deck of 5 track cards (chosen, or the 5 strongest).
-- A battle: I attack the deck of a player of about my level (his deck defends by itself). 5 rounds; each round the
-- server draws a stat (Flow, Endurance, Hype or Puissance, the stats printed on the cards), I play one of my cards
-- without seeing his, his deck answers, the higher value wins the round (rarity, grade and Shiny add a little).
-- 3 rounds won and the battle is won. Trophies go up or down with the result, more when the other one is stronger;
-- the defender wins or loses a few too. Trophies make the leagues: Bronze, Argent, Or, Platine, Diamant, Légende.
-- The first 5 battles won each day give 100 Streams each.
-- With a friend: a friendly battle against his deck (he gets the result), or a live battle when he is online (he
-- accepts, then each round both choose a card; 25 seconds to play, else a card is played at random). Friendly and
-- live battles give no trophies nor Streams and do not count in the tournament.

alter table public.profiles add column if not exists trophies int not null default 0 check (trophies >= 0);
alter table public.profiles add column if not exists best_trophies int not null default 0;
alter table public.profiles add column if not exists battle_wins int not null default 0;
alter table public.profiles add column if not exists battle_losses int not null default 0;
create index if not exists profiles_trophies_idx on public.profiles (trophies desc);

create table if not exists public.battle_decks (owner uuid primary key references public.profiles on delete cascade, cards uuid[] not null);
alter table public.battle_decks enable row level security;

create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  attacker uuid not null references public.profiles on delete cascade,
  defender uuid references public.profiles on delete set null,
  a_cards uuid[] not null, d_cards uuid[] not null,
  a_vals jsonb not null, d_vals jsonb not null,       -- the stats of each card, fixed at the start
  stats text[] not null,                             -- the stat of each round, drawn at the start (shown one at a time)
  round smallint not null default 0,                 -- rounds played
  a_used smallint[] not null default '{}', d_used smallint[] not null default '{}',
  a_won smallint not null default 0, d_won smallint not null default 0,
  log jsonb not null default '[]',
  mode text not null default 'ranked' check (mode in ('ranked', 'friend', 'live')),
  status text not null default 'playing' check (status in ('invite', 'playing', 'done', 'declined', 'expired')),
  a_pick smallint, d_pick smallint, round_at timestamptz,   -- live: the cards chosen in this round, and when it began
  winner uuid, a_delta int, d_delta int, reward int not null default 0,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists battles_attacker_idx on public.battles (attacker, created_at desc);
create index if not exists battles_defender_idx on public.battles (defender, created_at desc);
alter table public.battles enable row level security;

create or replace function public.league_of(p_trophies int) returns text language sql immutable as $$
  select case when p_trophies >= 3200 then 'Légende' when p_trophies >= 2300 then 'Diamant' when p_trophies >= 1500 then 'Platine'
              when p_trophies >= 900 then 'Or' when p_trophies >= 400 then 'Argent' else 'Bronze' end
$$;

-- a card in battle: its 4 stats, a little more for its rarity, its grade and Shiny
create or replace function public.battle_card(c cards) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; bonus int;
begin
  select * into s from duel_stats(c.track_id, c.rank);
  bonus := c.tier * 3 + coalesce(c.grade, 0) + case when c.holo then 4 else 0 end;
  return jsonb_build_object('id', c.id, 'track_id', c.track_id, 'tier', c.tier, 'holo', c.holo, 'grade', c.grade, 'rank', c.rank, 'bonus', bonus,
    'flow', s.flow + bonus, 'endu', s.endu + bonus, 'hype', s.hype + bonus, 'pw', s.pw + bonus,
    'title', (select title from tracks where id = c.track_id), 'artist', (select artist from tracks where id = c.track_id),
    'cover', (select cover from tracks where id = c.track_id), 'bpm', (select bpm from tracks where id = c.track_id),
    'duration', (select duration from tracks where id = c.track_id), 'edition', c.edition, 'edition_no', c.edition_no);
end $$;

-- my deck: the cards chosen (still mine), else my 5 strongest different tracks
create or replace function public.battle_deck_of(p_user uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare d uuid[];
begin
  select cards into d from battle_decks where owner = p_user;
  if d is not null and (select count(*) from cards where owner = p_user and kind = 'track' and id = any(d)) = 5 then return d; end if;
  select array_agg(id) into d from (
    select id from (select distinct on (c.track_id) c.id, c.tier, c.rank, (select pw from duel_stats(c.track_id, c.rank)) pw
                    from cards c where c.owner = p_user and c.kind = 'track' order by c.track_id, c.tier desc, c.rank desc) x
    order by pw + tier * 3 desc limit 5) y;
  return d;
end $$;

create or replace function public.set_battle_deck(p_cards uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_cards is null or cardinality(p_cards) = 0 then delete from battle_decks where owner = uid; return; end if;
  if cardinality(p_cards) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'battle_five'; end if;
  if (select count(*) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then raise exception 'not_owned'; end if;
  if (select count(distinct track_id) from cards where id = any(p_cards)) <> 5 then raise exception 'battle_same_track'; end if;
  insert into battle_decks (owner, cards) values (uid, p_cards) on conflict (owner) do update set cards = excluded.cards;
end $$;

-- what the battle tab shows: my trophies, league, deck, the last battles (mine and against me)
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
    'history', coalesce((select jsonb_agg(h order by h ->> 'at' desc) from (
      select jsonb_build_object('id', b.id, 'at', b.created_at, 'attack', b.attacker = uid,
        'other', (select pseudo from profiles where id = case when b.attacker = uid then b.defender else b.attacker end),
        'other_id', case when b.attacker = uid then b.defender else b.attacker end,
        'won', b.winner = uid, 'score', case when b.attacker = uid then b.a_won || '-' || b.d_won else b.d_won || '-' || b.a_won end,
        'delta', case when b.attacker = uid then b.a_delta else b.d_delta end, 'mode', b.mode) h
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' order by b.created_at desc limit 15) x), '[]'));
end $$;

-- the 5 stats of a battle, drawn at its start
create or replace function public.battle_stats() returns text[] language sql volatile as $$
  select array(select (array['flow', 'endu', 'hype', 'pw'])[1 + floor(random() * 4)::int] from generate_series(1, 5))
$$;
create or replace function public.battle_vals(p_cards uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(battle_card(c) order by array_position(p_cards, c.id)) from cards c where c.id = any(p_cards)
$$;

-- start a battle: ranked against an opponent of about my level, or friendly against a friend's deck
create or replace function public.battle_start(p_friend uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); me_p profiles; opp uuid; ad uuid[]; dd uuid[]; b battles; w int := 150;
begin
  select * into me_p from profiles where id = uid for update;
  update battles set status = 'done', winner = defender, finished_at = now(), a_delta = 0, d_delta = 0
  where attacker = uid and status = 'playing' and mode <> 'live' and created_at < now() - interval '10 minutes';      -- a battle left behind is lost, without trophies
  select * into b from battles where attacker = uid and status = 'playing' and mode <> 'live' order by created_at desc limit 1;
  if b.id is not null then return battle_view(b, uid); end if;
  ad := battle_deck_of(uid);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  if p_friend is not null then
    if friend_state(uid, p_friend) <> 'friends' then raise exception 'not_friends'; end if;
    opp := p_friend;
  else
    -- an opponent: active lately, of about my trophies, not the same as my last 3 battles
    loop
      select pr.id into opp from profiles pr join presence pe on pe.id = pr.id
      where pr.id <> uid and pe.seen_at > now() - interval '14 days' and abs(pr.trophies - me_p.trophies) <= w
        and pr.id not in (select defender from battles where attacker = uid and defender is not null order by created_at desc limit 3)
        and (select count(distinct track_id) from cards where owner = pr.id and kind = 'track') >= 5
      order by random() limit 1;
      exit when opp is not null or w > 5000;
      w := w * 2;
    end loop;
    if opp is null then raise exception 'battle_no_opponent'; end if;
  end if;
  dd := battle_deck_of(opp);
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  insert into battles (attacker, defender, mode, a_cards, d_cards, a_vals, d_vals, stats)
  values (uid, opp, case when p_friend is null then 'ranked' else 'friend' end, ad, dd, battle_vals(ad), battle_vals(dd), battle_stats())
  returning * into b;
  return battle_view(b, uid);
end $$;

-- a live battle: I invite a friend (online); he accepts within 2 minutes or the invitation goes
create or replace function public.battle_invite(p_friend uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ad uuid[]; b battles;
begin
  if friend_state(uid, p_friend) <> 'friends' then raise exception 'not_friends'; end if;
  ad := battle_deck_of(uid);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  update battles set status = 'expired' where attacker = uid and status = 'invite';
  insert into battles (attacker, defender, mode, status, a_cards, d_cards, a_vals, d_vals, stats)
  values (uid, p_friend, 'live', 'invite', ad, '{}', battle_vals(ad), '[]', battle_stats()) returning * into b;
  return battle_view(b, uid);
end $$;

create or replace function public.battle_answer(p_battle uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles; dd uuid[];
begin
  select * into b from battles where id = p_battle and defender = uid and mode = 'live' for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'invite' or b.created_at < now() - interval '2 minutes' then raise exception 'battle_invite_gone'; end if;
  if not p_accept then update battles set status = 'declined', finished_at = now() where id = b.id; return null; end if;
  dd := battle_deck_of(uid);
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_need_five'; end if;
  update battles set status = 'playing', d_cards = dd, d_vals = battle_vals(dd), round_at = now() where id = b.id returning * into b;
  return battle_view(b, uid);
end $$;

-- the invitations for me, and my live battle going on (asked every few seconds by the page)
create or replace function public.battle_invites() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'from', p.pseudo, 'from_id', p.id, 'league', league_of(p.trophies)))
                         from battles b join profiles p on p.id = b.attacker
                         where b.defender = auth.uid() and b.mode = 'live' and b.status = 'invite' and b.created_at > now() - interval '2 minutes'), '[]'),
    'live', (select b.id from battles b where (b.attacker = auth.uid() or b.defender = auth.uid()) and b.mode = 'live' and b.status = 'playing' order by b.created_at desc limit 1))
$$;

-- the battle as one side sees it: my cards, the cards of the other one played so far (the others hidden), this round
create or replace function public.battle_view(b battles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select p_uid = b.attacker a)
  select jsonb_build_object('id', b.id, 'mode', b.mode, 'status', b.status, 'round', b.round,
    'stat', case when b.status = 'playing' then b.stats[b.round + 1] end,
    'a_won', case when s.a then b.a_won else b.d_won end, 'd_won', case when s.a then b.d_won else b.a_won end,
    'mine', case when s.a then b.a_vals else b.d_vals end, 'used', to_jsonb(case when s.a then b.a_used else b.d_used end),
    'picked', case when s.a then b.a_pick else b.d_pick end is not null, 'opp_picked', case when s.a then b.d_pick else b.a_pick end is not null,
    'deadline', case when b.mode = 'live' and b.status = 'playing' then b.round_at + interval '25 seconds' end,
    'log', coalesce((select jsonb_agg(case when s.a then jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'a_slot', 'his', x -> 'd', 'mv', x -> 'av', 'hv', x -> 'dv', 'won', (x ->> 'won_a')::boolean)
                                       else jsonb_build_object('stat', x ->> 'stat', 'mine', x -> 'd_slot', 'his', x -> 'a', 'mv', x -> 'dv', 'hv', x -> 'av', 'won', not (x ->> 'won_a')::boolean) end order by k)
                     from jsonb_array_elements(b.log) with ordinality t(x, k)), '[]'),
    'opp', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies), 'cosmetics', p.cosmetics, 'title', p.title)
            from profiles p where p.id = case when s.a then b.defender else b.attacker end),
    'me', (select jsonb_build_object('pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies)) from profiles p where p.id = p_uid),
    'winner', case when b.status = 'done' then b.winner = p_uid end, 'delta', case when s.a then b.a_delta else b.d_delta end, 'reward', case when s.a then b.reward else 0 end,
    'opp_cards', case when b.status = 'done' then case when s.a then b.d_vals else b.a_vals end end)
  from s
$$;

-- resolve the round when both cards are known; the end of the battle (trophies for a ranked one)
create or replace function public.battle_resolve(b battles) returns battles
language plpgsql security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; mine jsonb := b.a_vals -> b.a_pick; his jsonb := b.d_vals -> b.d_pick; mv int; hv int; won boolean;
  att profiles; def profiles; diff int; ad int := 0; dd int := 0; rw int := 0; who text;
begin
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  won := mv > hv or (mv = hv and (mine ->> 'rank')::int >= (his ->> 'rank')::int);
  b.round := b.round + 1; b.a_used := b.a_used || b.a_pick; b.d_used := b.d_used || b.d_pick;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'a_slot', b.a_pick, 'd_slot', b.d_pick, 'a', mine, 'd', his, 'av', mv, 'dv', hv, 'won_a', won);
  b.a_pick := null; b.d_pick := null; b.round_at := now();
  if b.a_won >= 3 or b.d_won >= 3 or b.round >= 5 then
    b.status := 'done'; b.finished_at := now();
    b.winner := case when b.a_won > b.d_won then b.attacker else b.defender end;
    if b.mode = 'ranked' then
      select * into att from profiles where id = b.attacker for update;
      select * into def from profiles where id = b.defender for update;
      diff := coalesce(def.trophies, att.trophies) - att.trophies;
      if b.winner = b.attacker then
        ad := greatest(15, least(45, 30 + diff / 20)); dd := -least(coalesce(def.trophies, 0), greatest(5, least(15, 10 + diff / 40)));
        perform bump(b.attacker, 'battle_win');
        if (select n from daily_counters where owner = b.attacker and day = game_day() and metric = 'battle_win') <= 5 then
          rw := 100; perform add_streams(b.attacker, rw, 'Bataille de cartes gagnée');
        end if;
      else
        ad := -least(att.trophies, greatest(8, least(30, 20 + diff / 25))); dd := greatest(5, least(20, 10 - diff / 40));
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
    a_pick = null, d_pick = null, round_at = b.round_at, finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward where id = b.id;
  return b;
end $$;

-- the state of a battle (a live one moves on when the time to play is over: a card at random for who did not play)
create or replace function public.battle_state(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles;
begin
  select * into b from battles where id = p_battle and (attacker = uid or defender = uid) for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status = 'invite' and b.created_at < now() - interval '2 minutes' then update battles set status = 'expired' where id = b.id returning * into b; end if;
  if b.mode = 'live' and b.status = 'playing' and b.round_at < now() - interval '27 seconds' then
    if b.a_pick is null then select k into b.a_pick from generate_series(0, 4) k where not (k = any(b.a_used)) order by random() limit 1; end if;
    if b.d_pick is null then select k into b.d_pick from generate_series(0, 4) k where not (k = any(b.d_used)) order by random() limit 1; end if;
    b := battle_resolve(b);
  end if;
  return battle_view(b, uid);
end $$;

-- play a card (0 to 4) in this round. Ranked and friendly: the other deck answers at once (most often its best card
-- for this stat, sometimes another). Live: my card waits for his, the round is resolved when both are in.
create or replace function public.battle_play(p_battle uuid, p_slot int) returns jsonb
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
  if b.mode <> 'live' then
    st := b.stats[b.round + 1];
    if random() < .7 then
      select k into b.d_pick from generate_series(0, 4) k where not (k = any(b.d_used)) order by (b.d_vals -> k ->> st)::int desc, random() limit 1;
    else
      select k into b.d_pick from generate_series(0, 4) k where not (k = any(b.d_used)) order by random() limit 1;
    end if;
  end if;
  if b.a_pick is not null and b.d_pick is not null then
    b := battle_resolve(b);
    return battle_view(b, uid) || jsonb_build_object('last', battle_view(b, uid) -> 'log' -> -1);
  end if;
  update battles set a_pick = b.a_pick, d_pick = b.d_pick where id = b.id;
  return battle_view(b, uid);
end $$;

-- the best of the battles
create or replace function public.battle_leaderboard() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pseudo', pseudo, 'title', title, 'cosmetics', cosmetics, 'trophies', trophies, 'league', league_of(trophies),
    'wins', battle_wins, 'losses', battle_losses, 'me', id = auth.uid()) order by trophies desc), '[]')
  from (select * from profiles where battle_wins + battle_losses > 0 order by trophies desc limit 50) p
$$;

revoke execute on function public.battle_card(cards), public.battle_deck_of(uuid), public.battle_view(battles, uuid), public.battle_resolve(battles),
  public.battle_vals(uuid[]), public.battle_stats() from public, anon, authenticated;
revoke execute on function public.set_battle_deck(uuid[]), public.battle_home(), public.battle_start(uuid), public.battle_play(uuid, int), public.battle_leaderboard(),
  public.battle_invite(uuid), public.battle_answer(uuid, boolean), public.battle_invites(), public.battle_state(uuid) from public, anon;
grant execute on function public.set_battle_deck(uuid[]), public.battle_home(), public.battle_start(uuid), public.battle_play(uuid, int), public.battle_leaderboard(),
  public.battle_invite(uuid), public.battle_answer(uuid, boolean), public.battle_invites(), public.battle_state(uuid) to authenticated;
