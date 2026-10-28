-- The Bataille de cartes rewards the whole collection:
-- * the grading counts: a graded card gets a real bonus (6: +3, 7: +5, 8: +7, 9: +11, 10: +16 on every stat) and a 9
--   or a 10 wins the ties ("Sang-froid");
-- * the artist cards play: one of them goes on the poster of my deck, the "Tête d'affiche". Every track of that artist
--   in my deck gets +5 +2 per certification (+4 more if Shiny or Collector), the other tracks a small aura. Without a
--   choice, the game takes the artist card that suits my deck best (my deck defends with it too).

alter table public.battle_decks add column if not exists artist uuid references public.cards on delete set null;

create or replace function public.battle_grade_bonus(g smallint) returns int language sql immutable as $$
  select case when g is null or g < 1 then 0 else (array[0, 0, 1, 1, 1, 3, 5, 7, 11, 16])[least(g, 10)] end
$$;

create or replace function public.battle_card(c cards) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; bonus int; t tracks;
begin
  select * into s from duel_stats(c.track_id, c.rank);
  select * into t from tracks where id = c.track_id;
  bonus := c.tier * 3 + battle_grade_bonus(c.grade) + case when c.holo then 4 else 0 end;
  return jsonb_build_object('id', c.id, 'track_id', c.track_id, 'tier', c.tier, 'holo', c.holo, 'grade', c.grade, 'rank', c.rank, 'bonus', bonus,
    'gb', battle_grade_bonus(c.grade), 'gem', coalesce(c.grade, 0) >= 9, 'artist_id', t.artist_id,
    'flow', s.flow + bonus, 'endu', s.endu + bonus, 'hype', s.hype + bonus, 'pw', s.pw + bonus,
    'title', t.title, 'artist', t.artist, 'cover', t.cover, 'bpm', t.bpm, 'duration', t.duration, 'edition', c.edition, 'edition_no', c.edition_no);
end $$;

-- the Tête d'affiche of a deck: the one chosen if still mine, else the artist card that suits the deck best
create or replace function public.battle_headliner(p_user uuid, p_deck uuid[]) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.id from battle_decks d join cards c on c.id = d.artist and c.owner = p_user and c.kind = 'artist' where d.owner = p_user),
    (select c.id from cards c where c.owner = p_user and c.kind = 'artist'
     order by (select count(*) from cards k join tracks t on t.id = k.track_id where k.id = any(p_deck) and t.artist_id = c.artist_id) desc,
              c.tier desc, c.collector desc, c.holo desc limit 1))
$$;

create or replace function public.battle_headliner_json(p_card uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'artist_id', c.artist_id, 'name', a.name, 'picture', a.picture, 'fans', a.fans, 'tier', c.tier, 'holo', c.holo, 'collector', c.collector,
    'syn', 5 + 2 * c.tier + case when c.holo or c.collector then 4 else 0 end, 'aura', c.tier / 2 + case when c.collector then 1 else 0 end)
  from cards c left join artists a on a.id = c.artist_id where c.id = p_card
$$;

-- the values of a deck for a battle: each card, plus the bonus of the Tête d'affiche
create or replace function public.battle_vals(p_cards uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare owner_id uuid; h jsonb; res jsonb := '[]'; j jsonb; add int;
begin
  select owner into owner_id from cards where id = p_cards[1];
  h := battle_headliner_json(battle_headliner(owner_id, p_cards));
  for j in select battle_card(c) from cards c where c.id = any(p_cards) order by array_position(p_cards, c.id) loop
    add := case when h is null then 0 when coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false) then (h ->> 'syn')::int else (h ->> 'aura')::int end;
    if add > 0 then
      j := j || jsonb_build_object('flow', (j ->> 'flow')::int + add, 'endu', (j ->> 'endu')::int + add, 'hype', (j ->> 'hype')::int + add, 'pw', (j ->> 'pw')::int + add,
        'syn', add, 'star', coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false), 'head', h ->> 'name');
    end if;
    res := res || jsonb_build_array(j);
  end loop;
  return res;
end $$;

drop function if exists public.set_battle_deck(uuid[]);
create or replace function public.set_battle_deck(p_cards uuid[], p_artist uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_artist is not null and not exists (select 1 from cards where id = p_artist and owner = uid and kind = 'artist') then raise exception 'not_owned'; end if;
  if p_cards is null or cardinality(p_cards) = 0 then delete from battle_decks where owner = uid; return; end if;
  if cardinality(p_cards) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'battle_five'; end if;
  if (select count(*) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then raise exception 'not_owned'; end if;
  if (select count(distinct track_id) from cards where id = any(p_cards)) <> 5 then raise exception 'battle_same_track'; end if;
  insert into battle_decks (owner, cards, artist) values (uid, p_cards, p_artist) on conflict (owner) do update set cards = excluded.cards, artist = excluded.artist;
end $$;

create or replace function public.battle_resolve(b battles) returns battles
language plpgsql security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; mine jsonb := b.a_vals -> b.a_pick; his jsonb := b.d_vals -> b.d_pick; mv int; hv int; won boolean;
  att profiles; def profiles; diff int; am record; dm record; ad int := 0; dd int := 0; rw int := 0; who text;
begin
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  won := mv > hv or (mv = hv and (coalesce((mine ->> 'gem')::boolean, false) > coalesce((his ->> 'gem')::boolean, false)
    or (coalesce((mine ->> 'gem')::boolean, false) = coalesce((his ->> 'gem')::boolean, false) and (mine ->> 'rank')::int >= (his ->> 'rank')::int)));   -- a 9 or a 10 wins the ties
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
    a_pick = null, d_pick = null, round_at = b.round_at, finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward where id = b.id;
  return b;
end $$;

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
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' order by b.created_at desc limit 15) x), '[]'));
end $$;

revoke execute on function public.battle_grade_bonus(smallint), public.battle_headliner(uuid, uuid[]), public.battle_headliner_json(uuid) from public, anon, authenticated;
revoke execute on function public.set_battle_deck(uuid[], uuid) from public, anon;
grant execute on function public.set_battle_deck(uuid[], uuid) to authenticated;
