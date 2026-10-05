-- Blind-test duels. Everything that matters is decided here: the rounds, the right answer (never sent before
-- the player answers), the timing (measured on the server) and the points. Cards' stats drive the duel:
-- rhythm → extract length, endurance → shield, hype → difficulty, power → damage when the opponent fails.

alter table public.profiles
  add column duel_rating int not null default 1000,
  add column duel_wins int not null default 0,
  add column duel_losses int not null default 0,
  add column duel_played int not null default 0;

create table public.duel_decks (
  owner uuid primary key references public.profiles on delete cascade,
  cards uuid[] not null default '{}',           -- 5 track cards
  artist_card uuid,                              -- optional artist card (passive bonus)
  updated_at timestamptz not null default now()
);

create table public.duels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('duel', 'training')),
  challenger uuid not null references public.profiles on delete cascade,
  opponent uuid references public.profiles on delete cascade,
  status text not null check (status in ('playing_a', 'waiting_b', 'playing_b', 'done', 'declined', 'expired')),
  bet boolean not null default false,
  bet_a_card uuid references public.cards on delete set null,
  bet_b_card uuid references public.cards on delete set null,
  bet_accepted boolean not null default false,
  a_artist_id bigint, a_artist_cert smallint,
  b_artist_id bigint, b_artist_cert smallint,
  score_a int, score_b int,
  winner uuid,
  bet_moved boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index duels_a_idx on public.duels (challenger, status);
create index duels_b_idx on public.duels (opponent, status);

create table public.duel_rounds (                -- never readable by players: holds the right answer
  duel_id uuid not null references public.duels on delete cascade,
  n smallint not null,
  side text not null check (side in ('a', 'b', 'self')),
  card_id uuid,
  track_id bigint not null,
  artist_id bigint,
  flow smallint not null, endu smallint not null, hype smallint not null, pw smallint not null,
  extract_ms int not null,
  choices jsonb not null,                        -- ["Titre — Artiste", …] in display order
  correct smallint not null,
  primary key (duel_id, n)
);

create table public.duel_answers (
  duel_id uuid not null references public.duels on delete cascade,
  n smallint not null,
  player uuid not null references public.profiles on delete cascade,
  served_at timestamptz not null default now(),
  answered_at timestamptz,
  choice smallint,
  correct boolean,
  points int not null default 0,
  damage int not null default 0,                 -- points for the card's owner when this player failed
  primary key (duel_id, n, player)
);

-- ---------------------------------------------------------------- card stats (same formulas as the site)
create function public.duel_stats(p_track bigint, p_rank int, out flow int, out endu int, out hype int, out pw int)
language plpgsql stable set search_path = public as $$
declare t tracks; tempo int;
begin
  select * into t from tracks where id = p_track;
  tempo := case when coalesce(t.bpm, 0) > 0 then t.bpm else 70 + (p_track % 91)::int end;
  flow := greatest(8, least(99, round((tempo - 60) / 130.0 * 99)));
  endu := greatest(5, least(99, round((coalesce(t.duration, 180) - 90) / 330.0 * 99)));
  hype := greatest(1, least(99, round(coalesce(p_rank, 0) / 1e6 * 99)));
  pw := round((flow + endu + hype * 2) / 4.0);
end $$;

-- ---------------------------------------------------------------- cards on a bet stay put
create function public.card_in_duel(p_card uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from duels where status in ('playing_a', 'waiting_b', 'playing_b')
                 and (bet_a_card = p_card or (bet_accepted and bet_b_card = p_card)))
$$;

create function public.guard_duel_cards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'cards' then
    if coalesce(current_setting('zh.duel_resolve', true), '') = '1' then return coalesce(new, old); end if;
    if card_in_duel(old.id) then raise exception 'card_in_duel'; end if;
    return coalesce(new, old);
  end if;
  if card_in_duel(new.card_id) then raise exception 'card_in_duel'; end if;   -- listings, offer_items
  return new;
end $$;
create trigger cards_duel_delete before delete on public.cards for each row execute function public.guard_duel_cards();
create trigger cards_duel_owner before update of owner on public.cards for each row execute function public.guard_duel_cards();
create trigger listings_duel before insert on public.listings for each row execute function public.guard_duel_cards();
create trigger offer_items_duel before insert on public.offer_items for each row execute function public.guard_duel_cards();

-- ---------------------------------------------------------------- deck
create function public.set_deck(p_cards uuid[], p_artist uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if coalesce(array_length(p_cards, 1), 0) <> 5 then raise exception 'deck_needs_five'; end if;
  if (select count(distinct track_id) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then
    raise exception 'deck_bad_cards';
  end if;
  if p_artist is not null and not exists (select 1 from cards where id = p_artist and owner = uid and kind = 'artist') then
    raise exception 'deck_bad_cards';
  end if;
  insert into duel_decks (owner, cards, artist_card, updated_at) values (uid, p_cards, p_artist, now())
  on conflict (owner) do update set cards = excluded.cards, artist_card = excluded.artist_card, updated_at = now();
end $$;

-- a player's 5 duel cards: their saved deck if still all owned, otherwise their 5 most powerful tracks
create function public.deck_of(p_user uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare d duel_decks; ids uuid[];
begin
  select * into d from duel_decks where owner = p_user;
  if d.owner is not null and (select count(*) from cards where owner = p_user and id = any(d.cards)) = 5 then return d.cards; end if;
  select array_agg(id) into ids from (
    select id from (select distinct on (track_id) id, tier, rank from cards
                    where owner = p_user and kind = 'track' order by track_id, tier desc) one_per_track
    order by tier desc, rank desc limit 5) best;
  return ids;
end $$;

-- ---------------------------------------------------------------- rounds
-- one round from a card: stats, extract length, the right answer among 3 plausible wrong ones (same genre)
create function public.make_round(p_duel uuid, p_n int, p_side text, p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c cards; t tracks; st record; wrong text[]; labels text[]; pos int; i int; label text;
begin
  select * into c from cards where id = p_card;
  select * into t from tracks where id = c.track_id;
  st := duel_stats(c.track_id, c.rank);
  label := t.title || ' — ' || t.artist;
  select array_agg(l) into wrong from (
    select x.title || ' — ' || x.artist as l from tracks x
    where x.genre = t.genre and lower(x.artist) <> lower(t.artist) and x.id <> t.id
      and x.title || ' — ' || x.artist <> label
    order by random() limit 3) w;
  if coalesce(array_length(wrong, 1), 0) < 3 then
    select array_agg(l) into wrong from (
      select x.title || ' — ' || x.artist as l from tracks x where lower(x.artist) <> lower(t.artist) order by random() limit 3) w;
  end if;
  pos := floor(random() * 4)::int;              -- where the right answer sits (0..3)
  labels := '{}';
  for i in 0..3 loop
    labels := labels || case when i = pos then label else wrong[case when i < pos then i + 1 else i end] end;
  end loop;
  insert into duel_rounds (duel_id, n, side, card_id, track_id, artist_id, flow, endu, hype, pw, extract_ms, choices, correct)
  values (p_duel, p_n, p_side, p_card, c.track_id, t.artist_id, st.flow, st.endu, st.hype, st.pw,
          round(20000 - st.flow / 99.0 * 12000), to_jsonb(labels), pos);
end $$;

create function public.notify(p_user uuid, p_type text, p_title text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (owner, type, title) values (p_user, p_type, p_title)
$$;

-- ---------------------------------------------------------------- start a duel / a training
create function public.create_duel(p_opponent uuid, p_bet_mine uuid default null, p_bet_theirs uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); da uuid[]; db uuid[]; did uuid; picks uuid[]; sides text[]; i int; o int[];
        aart duel_decks; bart duel_decks; acert smallint; bcert smallint; aid bigint; bid bigint;
begin
  update duels set status = 'expired', finished_at = now() where status = 'waiting_b' and created_at < now() - interval '3 days';
  if p_opponent = uid then raise exception 'self_duel'; end if;
  if not exists (select 1 from profiles where id = p_opponent) then raise exception 'player_not_found'; end if;
  if (select count(*) from duels where challenger = uid and status in ('playing_a', 'waiting_b', 'playing_b')) >= 10 then raise exception 'too_many_duels'; end if;
  da := deck_of(uid); db := deck_of(p_opponent);
  if coalesce(array_length(da, 1), 0) < 3 then raise exception 'deck_needs_five'; end if;
  if coalesce(array_length(db, 1), 0) < 3 then raise exception 'opponent_no_cards'; end if;
  if (p_bet_mine is null) <> (p_bet_theirs is null) then raise exception 'bet_needs_two_cards'; end if;
  if p_bet_mine is not null then
    if trade_wait(uid) > interval '0' or trade_wait(p_opponent) > interval '0' then raise exception 'account_too_new'; end if;
    if not exists (select 1 from cards where id = p_bet_mine and owner = uid and tradeable) then raise exception 'give_not_owned'; end if;
    if not exists (select 1 from cards where id = p_bet_theirs and owner = p_opponent and tradeable) then raise exception 'take_not_owned'; end if;
    if is_listed(p_bet_mine) or is_listed(p_bet_theirs) then raise exception 'card_listed'; end if;
    if card_in_duel(p_bet_mine) or card_in_duel(p_bet_theirs) then raise exception 'card_in_duel'; end if;
    if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id in (p_bet_mine, p_bet_theirs)) then
      raise exception 'card_in_offer';
    end if;
  end if;
  select * into aart from duel_decks where owner = uid;
  select * into bart from duel_decks where owner = p_opponent;
  select artist_id, tier into aid, acert from cards where id = aart.artist_card and owner = uid;
  select artist_id, tier into bid, bcert from cards where id = bart.artist_card and owner = p_opponent;
  insert into duels (kind, challenger, opponent, status, bet, bet_a_card, bet_b_card, a_artist_id, a_artist_cert, b_artist_id, b_artist_cert)
  values ('duel', uid, p_opponent, 'playing_a', p_bet_mine is not null, p_bet_mine, p_bet_theirs, aid, acert, bid, bcert)
  returning id into did;
  -- 3 cards from each deck, in a random order
  select array_agg(x order by random()) into picks from (
    (select unnest(da) x order by random() limit 3) union all (select unnest(db) x order by random() limit 3)) s;
  for i in 1..array_length(picks, 1) loop
    perform make_round(did, i, case when picks[i] = any(da) then 'a' else 'b' end, picks[i]);
  end loop;
  return did;
end $$;

create function public.start_training() returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); did uuid; picks uuid[]; i int;
begin
  delete from duels where challenger = uid and kind = 'training' and status = 'playing_a';
  select array_agg(id) into picks from (
    select id from (select distinct on (track_id) id, track_id from cards where owner = uid and kind = 'track' order by track_id, random()) d
    order by random() limit 6) s;
  if coalesce(array_length(picks, 1), 0) < 4 then raise exception 'not_enough_cards'; end if;
  insert into duels (kind, challenger, status) values ('training', uid, 'playing_a') returning id into did;
  for i in 1..array_length(picks, 1) loop perform make_round(did, i, 'self', picks[i]); end loop;
  return did;
end $$;

-- ---------------------------------------------------------------- the opponent's turn
create function public.accept_duel(p_duel uuid, p_accept_bet boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d duels;
begin
  select * into d from duels where id = p_duel for update;
  if d.id is null or d.opponent <> uid or d.status <> 'waiting_b' then raise exception 'duel_not_found'; end if;
  if d.bet and p_accept_bet then
    if d.bet_a_card is null or not exists (select 1 from cards where id = d.bet_a_card and owner = d.challenger) then raise exception 'bet_card_gone'; end if;
    if not exists (select 1 from cards where id = d.bet_b_card and owner = uid and tradeable) then raise exception 'bet_card_gone'; end if;
    if is_listed(d.bet_b_card) or card_in_duel(d.bet_b_card) then raise exception 'card_in_duel'; end if;
    if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id = d.bet_b_card) then
      raise exception 'card_in_offer';
    end if;
    update duels set bet_accepted = true, status = 'playing_b' where id = d.id;
  else
    update duels set bet = false, bet_accepted = false, status = 'playing_b' where id = d.id;   -- played without the bet
  end if;
end $$;

create function public.decline_duel(p_duel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d duels;
begin
  update duels set status = 'declined', finished_at = now() where id = p_duel and opponent = uid and status = 'waiting_b' returning * into d;
  if d.id is null then raise exception 'duel_not_found'; end if;
  perform notify(d.challenger, 'duel_declined', (select pseudo from profiles where id = uid));
end $$;

-- who is playing this duel right now, as 'a', 'b' or null
create function public.duel_role(d duels, p_user uuid) returns text language sql immutable as $$
  select case when d.challenger = p_user and d.status = 'playing_a' then 'a'
              when d.opponent = p_user and d.status = 'playing_b' then 'b' end
$$;

-- serve the next round: only the extract and the 4 labels. The timer starts now, on the server.
create function public.duel_round(p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d duels; role text; r duel_rounds; n int; total int; t jsonb; ans duel_answers;
begin
  select * into d from duels where id = p_duel;
  role := duel_role(d, uid);
  if role is null then raise exception 'duel_not_found'; end if;
  select count(*) into total from duel_rounds where duel_id = d.id;
  select coalesce(max(a.n), 0) into n from duel_answers a where a.duel_id = d.id and a.player = uid and a.answered_at is not null;
  n := n + 1;
  if n > total then raise exception 'duel_over'; end if;
  select * into r from duel_rounds where duel_id = d.id and duel_rounds.n = n;
  insert into duel_answers (duel_id, n, player) values (d.id, n, uid) on conflict do nothing;   -- a reload does not restart the clock
  select * into ans from duel_answers a where a.duel_id = d.id and a.n = r.n and a.player = uid;
  t := deezer('track/' || r.track_id);
  return jsonb_build_object('n', n, 'total', total, 'preview', t ->> 'preview', 'extract_ms', r.extract_ms,
    'choices', r.choices, 'mine', case when r.side = 'self' then null else r.side = role end,
    'elapsed_ms', round(extract(epoch from now() - ans.served_at) * 1000));
end $$;

create function public.duel_answer(p_duel uuid, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d duels; role text; r duel_rounds; a duel_answers; ms numeric; ok boolean;
        pts numeric := 0; dmg int := 0; my_cert smallint; my_artist bigint; total int; t tracks; c cards;
begin
  select * into d from duels where id = p_duel for update;
  role := duel_role(d, uid);
  if role is null then raise exception 'duel_not_found'; end if;
  select * into a from duel_answers x where x.duel_id = d.id and x.player = uid and x.answered_at is null order by x.n limit 1 for update;
  if a.duel_id is null then raise exception 'no_round'; end if;
  select * into r from duel_rounds where duel_id = d.id and n = a.n;
  ms := extract(epoch from now() - a.served_at) * 1000;
  ok := coalesce(p_choice = r.correct, false) and ms <= r.extract_ms + 3000;          -- 3 s of grace for loading the extract
  my_cert := case role when 'a' then d.a_artist_cert else d.b_artist_cert end;
  my_artist := case role when 'a' then d.a_artist_id else d.b_artist_id end;
  if ok then
    pts := 1000 * greatest(0.3, 1 - 0.7 * least(1, ms / r.extract_ms)) * (2 - r.hype / 100.0);   -- faster, rarer = more
    if r.side <> 'self' and r.side <> role then pts := pts * (1 - r.endu / 200.0) * 1.2; end if;  -- the card's shield, the attack bonus
    if my_cert is not null then pts := pts * (1 + 0.05 * (my_cert + 1)); end if;                 -- artist card, passive
    if my_artist is not null and my_artist = r.artist_id then pts := pts * 1.5; end if;           -- that artist's own track
  elsif r.side <> 'self' and r.side <> role then
    dmg := r.pw * 5;                                                                               -- the card hits its owner's score
  end if;
  update duel_answers set answered_at = now(), choice = p_choice, correct = ok, points = round(pts), damage = dmg
  where duel_id = d.id and n = a.n and player = uid;
  select * into c from cards where id = r.card_id;
  select * into t from tracks where id = r.track_id;
  select count(*) into total from duel_rounds where duel_id = d.id;
  if a.n = total then perform duel_turn_done(d.id, role); end if;
  return jsonb_build_object('correct', ok, 'correct_index', r.correct, 'points', round(pts), 'damage', dmg, 'ms', round(ms),
    'last', a.n = total, 'side', r.side, 'mine', case when r.side = 'self' then null else r.side = role end,
    'card', jsonb_build_object('track_id', r.track_id, 'tier', coalesce(c.tier, tier_of(coalesce(c.rank, 0))), 'rank', coalesce(c.rank, 0),
      'title', t.title, 'artist', t.artist, 'album', t.album, 'cover', t.cover, 'duration', t.duration, 'bpm', t.bpm,
      'year', t.year, 'explicit', t.explicit, 'genre', t.genre,
      'flow', r.flow, 'endu', r.endu, 'hype', r.hype, 'pw', r.pw, 'extract_ms', r.extract_ms));
end $$;

-- end of a player's 6 rounds: hand over to the opponent, or settle the duel
create function public.duel_turn_done(p_duel uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare d duels; sa int; sb int; win uuid; lose uuid; ra int; rb int; ea numeric; k int := 32; day_count int; gain int;
begin
  select * into d from duels where id = p_duel for update;
  if d.kind = 'training' then
    sa := (select coalesce(sum(points), 0) from duel_answers where duel_id = d.id);
    gain := least(15, sa / 400);
    select coalesce(n, 0) into day_count from daily_counters where owner = d.challenger and day = game_day() and metric = 'training_rewards';
    if coalesce(day_count, 0) < 5 and gain > 0 then
      perform add_streams(d.challenger, gain, 'entraînement blind test');
      perform bump(d.challenger, 'training_rewards');
    end if;
    perform bump(d.challenger, 'trainings');
    update duels set status = 'done', score_a = sa, finished_at = now() where id = d.id;
    return;
  end if;
  if p_role = 'a' then
    update duels set status = 'waiting_b' where id = d.id;
    perform notify(d.opponent, 'duel_challenge', (select pseudo from profiles where id = d.challenger));
    return;
  end if;
  -- both have played: points + the damage each player's cards did
  sa := (select coalesce(sum(points), 0) from duel_answers where duel_id = d.id and player = d.challenger)
      + (select coalesce(sum(damage), 0) from duel_answers where duel_id = d.id and player = d.opponent);
  sb := (select coalesce(sum(points), 0) from duel_answers where duel_id = d.id and player = d.opponent)
      + (select coalesce(sum(damage), 0) from duel_answers where duel_id = d.id and player = d.challenger);
  win := case when sa > sb then d.challenger when sb > sa then d.opponent end;
  lose := case when sa > sb then d.opponent when sb > sa then d.challenger end;
  -- rating (Elo)
  select duel_rating into ra from profiles where id = d.challenger;
  select duel_rating into rb from profiles where id = d.opponent;
  ea := 1 / (1 + power(10, (rb - ra) / 400.0));
  update profiles set duel_rating = greatest(100, duel_rating + round(k * ((case when sa > sb then 1 when sa = sb then .5 else 0 end) - ea))),
    duel_played = duel_played + 1, duel_wins = duel_wins + (sa > sb)::int, duel_losses = duel_losses + (sa < sb)::int where id = d.challenger;
  update profiles set duel_rating = greatest(100, duel_rating + round(k * ((case when sb > sa then 1 when sa = sb then .5 else 0 end) - (1 - ea)))),
    duel_played = duel_played + 1, duel_wins = duel_wins + (sb > sa)::int, duel_losses = duel_losses + (sb < sa)::int where id = d.opponent;
  -- Streams (10 rewarded duels a day each)
  for win, gain in select x.u, x.g from (values (d.challenger, case when sa > sb then 50 when sa = sb then 25 else 10 end),
                                               (d.opponent, case when sb > sa then 50 when sa = sb then 25 else 10 end)) x(u, g) loop
    select coalesce(n, 0) into day_count from daily_counters where owner = win and day = game_day() and metric = 'duel_rewards';
    if coalesce(day_count, 0) < 10 then perform add_streams(win, gain, 'duel blind test'); perform bump(win, 'duel_rewards'); end if;
    perform bump(win, 'duels');
  end loop;
  win := case when sa > sb then d.challenger when sb > sa then d.opponent end;
  if win is not null then perform bump(win, 'duel_win'); end if;
  -- the bet: the loser's staked card goes to the winner
  if d.bet and d.bet_accepted and win is not null then
    perform set_config('zh.duel_resolve', '1', true);
    update cards set owner = win where id = case when win = d.challenger then d.bet_b_card else d.bet_a_card end and owner = lose;
    perform set_config('zh.duel_resolve', '', true);
    update offers set status = 'expired', decided_at = now() where status = 'pending'
      and id in (select offer_id from offer_items where card_id in (d.bet_a_card, d.bet_b_card));
    update duels set bet_moved = true where id = d.id;
  end if;
  update duels set status = 'done', score_a = sa, score_b = sb, winner = case when sa > sb then d.challenger when sb > sa then d.opponent end,
    finished_at = now() where id = d.id;
  perform notify(d.challenger, 'duel_result', (select pseudo from profiles where id = d.opponent));
end $$;

-- ---------------------------------------------------------------- lists
create function public.my_duels() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x ->> 'created_at') desc), '[]') from (
    select jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'created_at', d.created_at, 'finished_at', d.finished_at,
      'me', case when d.challenger = auth.uid() then 'a' else 'b' end,
      'other', (select pseudo from profiles where id = case when d.challenger = auth.uid() then d.opponent else d.challenger end),
      'other_title', (select title from profiles where id = case when d.challenger = auth.uid() then d.opponent else d.challenger end),
      'score_me', case when d.challenger = auth.uid() then d.score_a else d.score_b end,
      'score_other', case when d.challenger = auth.uid() then d.score_b else d.score_a end,
      'won', d.winner = auth.uid(), 'draw', d.status = 'done' and d.kind = 'duel' and d.winner is null,
      'bet', d.bet, 'bet_accepted', d.bet_accepted, 'bet_moved', d.bet_moved,
      'bet_mine', (select jsonb_build_object('title', coalesce(t.title, ar.name), 'tier', c.tier, 'kind', c.kind) from cards c left join tracks t on t.id = c.track_id left join artists ar on ar.id = c.artist_id
                   where c.id = case when d.challenger = auth.uid() then d.bet_a_card else d.bet_b_card end),
      'bet_theirs', (select jsonb_build_object('title', coalesce(t.title, ar.name), 'tier', c.tier, 'kind', c.kind) from cards c left join tracks t on t.id = c.track_id left join artists ar on ar.id = c.artist_id
                   where c.id = case when d.challenger = auth.uid() then d.bet_b_card else d.bet_a_card end)) x
    from duels d
    where (d.challenger = auth.uid() or (d.opponent = auth.uid() and d.status <> 'playing_a')) and d.kind = 'duel'
    order by d.created_at desc limit 40) s
$$;

create function public.duel_leaderboard() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('pseudo', pseudo, 'title', title, 'rating', duel_rating, 'wins', duel_wins,
    'losses', duel_losses, 'me', id = auth.uid()) order by duel_rating desc), '[]')
  from (select * from profiles where duel_played > 0 order by duel_rating desc limit 30) p
$$;

create function public.my_deck() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cards', coalesce((select cards from duel_decks where owner = auth.uid()), '{}'),
                            'artist_card', (select artist_card from duel_decks where owner = auth.uid()),
                            'auto', deck_of(auth.uid()))
$$;

-- ---------------------------------------------------------------- challenges + achievement
insert into public.daily_defs values
  ('duel1', 'Joue un duel blind test', 'duels', 1, 30),
  ('duelwin1', 'Gagne un duel blind test', 'duel_win', 1, 50),
  ('train1', 'Fais un entraînement blind test', 'trainings', 1, 15);
insert into public.achievements values
  ('duelist', 24, 'Échanges et fidélité', 'Duelliste', 'Duels blind test gagnés', '{1,25,100}', '{50,250,1000}', '{Duelliste,Oreille d''or,Shazam humain}');

create or replace function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.*, t.artist, t.year, t.genre, t.duration, t.bpm from cards c join tracks t on t.id = c.track_id where c.owner = p_user),
       p as (select * from profiles where id = p_user)
  select jsonb_build_object(
    'collector', (select count(distinct track_id) from c),
    'legends', (select count(*) from cards where owner = p_user and tier = 5 and kind = 'track'),
    'mythics', (select count(*) from cards where owner = p_user and tier = 4 and kind = 'track'),
    'holos', (select count(*) from cards where owner = p_user and holo),
    'rainbow', (select count(distinct tier) from c),
    'god', (select gods from p),
    'albums', (select count(*) from album_claims where owner = p_user),
    'discos', (select count(*) from disco_claims where owner = p_user),
    'artists', (select count(distinct artist_id) from cards where owner = p_user and kind = 'artist'),
    'digger', (select count(distinct track_id) from c where rank < 1000),
    'zero', (select count(*) from c where rank = 0),
    'decades', (select count(distinct year / 10) from c where year >= 1950),
    'genres', (select count(distinct genre) from c),
    'fan', (select coalesce(max(n), 0) from (select count(distinct track_id) n from c group by lower(artist)) a),
    'alphabet', (select count(distinct upper(left(artist, 1))) from c where upper(left(artist, 1)) between 'A' and 'Z'),
    'marathon', (select count(*) from c where duration > 600),
    'interlude', (select count(*) from c where duration between 1 and 59),
    'bpm200', (select count(*) from c where bpm >= 200),
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'opened', (select opened from p),
    'streak', (select best_streak from p),
    'trader', (select coalesce(sum(price - floor(price * (select market_fee_pct from settings) / 100.0)), 0) from sales where seller = p_user),
    'duelist', (select duel_wins from p))
$$;

-- ---------------------------------------------------------------- access
alter table public.duel_decks enable row level security;
alter table public.duels enable row level security;
alter table public.duel_rounds enable row level security;      -- no policy: players never read rounds
alter table public.duel_answers enable row level security;
create policy "own deck" on public.duel_decks for select to authenticated using (owner = (select auth.uid()));
create policy "own duels" on public.duels for select to authenticated using (challenger = (select auth.uid()) or opponent = (select auth.uid()));
create policy "own answers" on public.duel_answers for select to authenticated using (player = (select auth.uid()));
revoke insert, update, delete on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int), public.cert_of(int) to anon, authenticated;
grant execute on function public.set_deck(uuid[], uuid), public.create_duel(uuid, uuid, uuid), public.start_training(),
  public.accept_duel(uuid, boolean), public.decline_duel(uuid), public.duel_round(uuid), public.duel_answer(uuid, int),
  public.my_duels(), public.duel_leaderboard(), public.my_deck() to authenticated;
revoke execute on function public.duel_stats(bigint, int), public.card_in_duel(uuid), public.guard_duel_cards(), public.deck_of(uuid),
  public.make_round(uuid, int, text, uuid), public.notify(uuid, text, text), public.duel_role(public.duels, uuid),
  public.duel_turn_done(uuid, text) from authenticated;
