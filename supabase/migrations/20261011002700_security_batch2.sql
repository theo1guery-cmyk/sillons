-- Security batch 2 (audit of 2026-10-11).
-- 1. Duels: the wrong answers came from tracks the player whose card it is doesn't own, and every collection is public:
--    a script could pick the right answer. They now come from that player's own collection (same genre first).
-- 2. Duels between one's own accounts: Streams only between accounts old enough to trade (trade_min_age), and 2
--    rewarded duels a day per pair of players (rating and statistics are kept).
-- 3. Albums: the same cards passed from account to account completed the same album for each one. A card copy that
--    completed an album counts no more for that album (album_claim_cards; discographies follow, they need the albums).
--    Existing claims: the claimants' current copies are marked.
-- 4. Stripe refunds and disputes (stripe-webhook): the purchase is taken back (revoke_purchase): Vinyles (what is left;
--    the rest is a debt paid by the next Vinyles received), boosters, Pass VIP; logged for the admin page.

-- 1 and 2
create or replace function public.make_round(p_duel uuid, p_n int, p_side text, p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c cards; t tracks; st record; wrong text[]; labels text[]; pos int; i int; label text;
begin
  select * into c from cards where id = p_card;
  select * into t from tracks where id = c.track_id;
  st := duel_stats(c.track_id, c.rank);
  label := t.title || ' — ' || t.artist;
  -- the wrong answers come from the same player's collection (collections are public: answers from other players'
  -- tracks would give the right one away), same genre first
  select array_agg(l) into wrong from (
    select l from (select distinct x.title || ' — ' || x.artist as l, (x.genre = t.genre) as same from tracks x
                   join cards k on k.track_id = x.id and k.owner = c.owner
                   where lower(x.artist) <> lower(t.artist) and x.id <> t.id and x.title || ' — ' || x.artist <> label) y
    order by same desc, random() limit 3) w;
  if coalesce(array_length(wrong, 1), 0) < 3 then
  select array_agg(l) into wrong from (
    select x.title || ' — ' || x.artist as l from tracks x
    where x.genre = t.genre and lower(x.artist) <> lower(t.artist) and x.id <> t.id
      and x.title || ' — ' || x.artist <> label
    order by random() limit 3) w;
  end if;
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

create or replace function public.duel_turn_done(p_duel uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare d duels; sa int; sb int; win uuid; lose uuid; ra int; rb int; ea numeric; k int := 32; day_count int; gain int; paid boolean;
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
  -- Streams (10 rewarded duels a day each), only between accounts old enough to trade, and 2 a day per pair of players
  paid := trade_wait(d.challenger) = interval '0' and trade_wait(d.opponent) = interval '0'
    and (select count(*) from duels x where x.id <> d.id and x.kind = 'duel' and x.status = 'done'
           and (x.finished_at at time zone 'Europe/Paris')::date = game_day()
           and ((x.challenger = d.challenger and x.opponent = d.opponent) or (x.challenger = d.opponent and x.opponent = d.challenger))) < 2;
  for win, gain in select x.u, x.g from (values (d.challenger, case when sa > sb then 50 when sa = sb then 25 else 10 end),
                                               (d.opponent, case when sb > sa then 50 when sa = sb then 25 else 10 end)) x(u, g) loop
    select coalesce(n, 0) into day_count from daily_counters where owner = win and day = game_day() and metric = 'duel_rewards';
    if paid and coalesce(day_count, 0) < 10 then perform add_streams(win, gain, 'duel blind test'); perform bump(win, 'duel_rewards'); end if;
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

-- 3
create table public.album_claim_cards (
  card_id uuid not null references public.cards on delete cascade,
  album_id bigint not null,
  primary key (card_id, album_id)
);
alter table public.album_claim_cards enable row level security;
insert into public.album_claim_cards (card_id, album_id)
select c.id, k.album_id from album_claims k
join albums a on a.id = k.album_id
cross join lateral jsonb_array_elements(a.tracks) e
join cards c on c.owner = k.owner and c.track_id = (e ->> 'id')::bigint
on conflict do nothing;

create or replace function public.claim_album(p_album bigint) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); a albums; missing int; reward int; used uuid[];
begin
  perform fetch_album(p_album);                 -- check against Deezer's current tracklist
  select * into a from albums where id = p_album;
  if a.id is null or a.record_type not in ('album', 'ep') or not a.complete or jsonb_array_length(a.tracks) = 0 then
    raise exception 'album_not_found';
  end if;
  select count(*) into missing from jsonb_array_elements(a.tracks) e
  where not exists (select 1 from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint);
  if missing > 0 then raise exception 'album_incomplete'; end if;
  -- one copy of each track that has not already completed this album for someone (cards passed from account to account)
  select array_agg(k.id) into used from jsonb_array_elements(a.tracks) e
  cross join lateral (select c.id from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint
                        and not exists (select 1 from album_claim_cards u where u.card_id = c.id and u.album_id = p_album)
                      order by c.pulled_at limit 1) k;
  if coalesce(cardinality(used), 0) < jsonb_array_length(a.tracks) then raise exception 'album_cards_used'; end if;
  reward := album_reward(jsonb_array_length(a.tracks));
  insert into album_claims (owner, album_id, reward) values (uid, p_album, reward) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  insert into album_claim_cards (card_id, album_id) select x, p_album from unnest(used) x on conflict do nothing;
  perform add_streams(uid, reward, 'album complet : ' || a.title);
  return reward;
end $$;

-- 4
alter table public.purchases add column if not exists payment_intent text;
alter table public.purchases add column if not exists revoked_at timestamptz;
create index if not exists purchases_intent_idx on public.purchases (payment_intent);
alter table public.profiles add column if not exists vinyl_debt int not null default 0;

-- Vinyles received pay a debt first
create or replace function public.add_vinyls(p_user uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare bal int; debt int; pay int := 0;
begin
  if p_amount > 0 then
    select vinyl_debt into debt from profiles where id = p_user for update;
    pay := least(coalesce(debt, 0), p_amount);
  end if;
  update profiles set vinyls = vinyls + p_amount - pay, vinyl_debt = vinyl_debt - pay where id = p_user returning vinyls into bal;
  if bal is null then raise exception 'user_not_found'; end if;
  insert into vinyl_ledger (owner, amount, reason) values (p_user, p_amount, p_reason);
  if pay > 0 then insert into vinyl_ledger (owner, amount, reason) values (p_user, -pay, 'dette (achat remboursé)'); end if;
  return bal;
end $$;

create function public.purchase_intent(p_session text, p_intent text) returns void
language sql security definer set search_path = public as $$
  update purchases set payment_intent = p_intent where session_id = p_session and payment_intent is null
$$;

create function public.revoke_purchase(p_intent text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases; k shop_packs; bal int; take int;
begin
  select * into pu from purchases where payment_intent = p_intent and revoked_at is null for update;
  if pu.session_id is null then return; end if;
  update purchases set revoked_at = now() where session_id = pu.session_id;
  if pu.owner is null then return; end if;
  select * into k from shop_packs where id = pu.pack;
  select vinyls into bal from profiles where id = pu.owner for update;
  take := least(bal, pu.vinyls);
  update profiles set vinyls = vinyls - take, vinyl_debt = vinyl_debt + (pu.vinyls - take),
                      stock = greatest(0, stock - coalesce(k.boosters, 0)) where id = pu.owner;
  insert into vinyl_ledger (owner, amount, reason) values (pu.owner, -take, 'achat remboursé (' || p_reason || ') : ' || coalesce(k.name, pu.pack));
  if k.premium then
    update season_progress set premium = false
    where owner = pu.owner and season_id = (select id from seasons where pu.created_at between starts_at and ends_at + interval '7 days' order by starts_at desc limit 1);
  end if;
  insert into admin_log (admin, target, action, detail)
  values (null, pu.owner, 'vinyls', 'Achat Stripe repris (' || p_reason || ') : ' || coalesce(k.name, pu.pack) || ', ' || pu.vinyls || ' Vinyles');
end $$;

revoke execute on function public.purchase_intent(text, text), public.revoke_purchase(text, text), public.add_vinyls(uuid, int, text)
  from public, anon, authenticated;
grant execute on function public.purchase_intent(text, text), public.revoke_purchase(text, text) to service_role;
