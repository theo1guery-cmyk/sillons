-- La Bataille de cartes: the collection fights. Each player has a deck of 5 track cards (chosen, or the 5 strongest).
-- A battle: I attack the deck of a player of about my level (his deck defends by itself). 5 rounds; each round the
-- server draws a stat (Flow, Endurance, Hype or Puissance, the stats printed on the cards), I play one of my cards
-- without seeing his, his deck answers, the higher value wins the round (rarity, grade and Shiny add a little).
-- 3 rounds won and the battle is won. Trophies go up or down with the result, more when the other one is stronger;
-- the defender wins or loses a few too. Trophies make the leagues: Bronze, Argent, Or, Platine, Diamant, Légende.
-- The first 5 battles won each day give 100 Streams each.

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
  status text not null default 'playing' check (status in ('playing', 'done')),
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
        'delta', case when b.attacker = uid then b.a_delta else b.d_delta end) h
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' order by b.created_at desc limit 15) x), '[]'));
end $$;

-- start a battle: an opponent of about my level (who has 5 track cards), the 5 stats drawn
create or replace function public.battle_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); me_p profiles; opp uuid; ad uuid[]; dd uuid[]; b battles; w int := 150; st text[];
begin
  select * into me_p from profiles where id = uid for update;
  update battles set status = 'done', winner = defender, finished_at = now(), a_delta = 0, d_delta = 0
  where attacker = uid and status = 'playing' and created_at < now() - interval '10 minutes';      -- a battle left behind is lost, without trophies
  if exists (select 1 from battles where attacker = uid and status = 'playing') then
    select * into b from battles where attacker = uid and status = 'playing' order by created_at desc limit 1;
    return battle_view(b, uid);
  end if;
  ad := battle_deck_of(uid);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
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
  dd := battle_deck_of(opp);
  st := array(select (array['flow', 'endu', 'hype', 'pw'])[1 + floor(random() * 4)::int] from generate_series(1, 5));
  insert into battles (attacker, defender, a_cards, d_cards, a_vals, d_vals, stats)
  values (uid, opp, ad, dd,
    (select jsonb_agg(battle_card(c) order by array_position(ad, c.id)) from cards c where c.id = any(ad)),
    (select jsonb_agg(battle_card(c) order by array_position(dd, c.id)) from cards c where c.id = any(dd)), st)
  returning * into b;
  return battle_view(b, uid);
end $$;

-- the battle as the attacker sees it: my cards, his cards played so far (the others hidden), the stat of this round
create or replace function public.battle_view(b battles, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'status', b.status, 'round', b.round, 'stat', case when b.status = 'playing' then b.stats[b.round + 1] end,
    'a_won', b.a_won, 'd_won', b.d_won, 'mine', b.a_vals, 'used', to_jsonb(b.a_used), 'log', b.log,
    'opp', (select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies), 'cosmetics', p.cosmetics, 'title', p.title)
            from profiles p where p.id = b.defender),
    'me', (select jsonb_build_object('pseudo', p.pseudo, 'trophies', p.trophies, 'league', league_of(p.trophies)) from profiles p where p.id = p_uid),
    'winner', case when b.status = 'done' then b.winner = p_uid end, 'delta', b.a_delta, 'reward', b.reward,
    'opp_cards', case when b.status = 'done' then b.d_vals end)
$$;

-- play a card (0 to 4) in this round; his deck answers: most often its best card for this stat, sometimes another
create or replace function public.battle_play(p_battle uuid, p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles; st text; mine jsonb; his jsonb; hs int; mv int; hv int; won boolean; att profiles; def profiles; diff int; ad int; dd int; rw int := 0;
begin
  select * into b from battles where id = p_battle and attacker = uid for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'playing' then return battle_view(b, uid); end if;
  if p_slot is null or p_slot < 0 or p_slot > 4 or p_slot = any(b.a_used) then raise exception 'battle_bad_card'; end if;
  st := b.stats[b.round + 1];
  mine := b.a_vals -> p_slot;
  if random() < .7 then
    select k into hs from generate_series(0, 4) k where not (k = any(b.d_used)) order by (b.d_vals -> k ->> st)::int desc, random() limit 1;
  else
    select k into hs from generate_series(0, 4) k where not (k = any(b.d_used)) order by random() limit 1;
  end if;
  his := b.d_vals -> hs;
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  won := mv > hv or (mv = hv and (mine ->> 'rank')::int >= (his ->> 'rank')::int);
  b.round := b.round + 1; b.a_used := b.a_used || p_slot::smallint; b.d_used := b.d_used || hs::smallint;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'mine', p_slot, 'his', his, 'mv', mv, 'hv', hv, 'won', won);
  if b.a_won >= 3 or b.d_won >= 3 or b.round >= 5 then
    b.status := 'done'; b.finished_at := now();
    select * into att from profiles where id = b.attacker for update;
    select * into def from profiles where id = b.defender for update;
    diff := coalesce(def.trophies, att.trophies) - att.trophies;
    if b.a_won > b.d_won then
      b.winner := uid;
      ad := greatest(15, least(45, 30 + diff / 20)); dd := -least(coalesce(def.trophies, 0), greatest(5, least(15, 10 + diff / 40)));
      perform bump(uid, 'battle_win');
      if (select n from daily_counters where owner = uid and day = game_day() and metric = 'battle_win') <= 5 then
        rw := 100; perform add_streams(uid, rw, 'Bataille de cartes gagnée');
      end if;
    else
      b.winner := b.defender;
      ad := -least(att.trophies, greatest(8, least(30, 20 + diff / 25))); dd := greatest(5, least(20, 10 - diff / 40));
    end if;
    b.a_delta := ad; b.d_delta := dd; b.reward := rw;
    update profiles set trophies = trophies + ad, best_trophies = greatest(best_trophies, trophies + ad),
      battle_wins = battle_wins + case when b.winner = uid then 1 else 0 end, battle_losses = battle_losses + case when b.winner = uid then 0 else 1 end where id = uid;
    if b.defender is not null then
      update profiles set trophies = greatest(0, trophies + dd), best_trophies = greatest(best_trophies, trophies + dd) where id = b.defender;
    end if;
    perform bump(uid, 'battles');
  end if;
  update battles set round = b.round, a_used = b.a_used, d_used = b.d_used, a_won = b.a_won, d_won = b.d_won, log = b.log, status = b.status,
    finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward where id = b.id;
  return battle_view(b, uid) || jsonb_build_object('last', b.log -> -1);
end $$;

-- the best of the battles
create or replace function public.battle_leaderboard() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pseudo', pseudo, 'title', title, 'cosmetics', cosmetics, 'trophies', trophies, 'league', league_of(trophies),
    'wins', battle_wins, 'losses', battle_losses, 'me', id = auth.uid()) order by trophies desc), '[]')
  from (select * from profiles where battle_wins + battle_losses > 0 order by trophies desc limit 50) p
$$;

revoke execute on function public.battle_card(cards), public.battle_deck_of(uuid), public.battle_view(battles, uuid) from public, anon, authenticated;
revoke execute on function public.set_battle_deck(uuid[]), public.battle_home(), public.battle_start(), public.battle_play(uuid, int), public.battle_leaderboard() from public, anon;
grant execute on function public.set_battle_deck(uuid[]), public.battle_home(), public.battle_start(), public.battle_play(uuid, int), public.battle_leaderboard() to authenticated;
