-- Players: a public profile for everyone (collection score and rank, stats, a showcase of 6 cards), friends (a request,
-- accepted or declined), and the whole collection of a friend.
--  * the collection score: each different card (a sound or an artist, in one rarity) counts once, by its rarity
--    (Commune 1, Peu commune 3, Rare 10, Épique 40, Mythique 250, Légendaire 1 500); a Shiny copy doubles it, the best
--    grade adds up to the same again (grade 10: +100 %); each limited edition copy is worth 3 000 (a 1/1: 10 000).
--    Saved in player_scores: at once for a profile looked at, every 15 minutes for the players seen lately.

create or replace function public.card_points(p_tier smallint) returns int language sql immutable as $$
  select case p_tier when 0 then 1 when 1 then 3 when 2 then 10 when 3 then 40 when 4 then 250 when 5 then 1500 else 0 end
$$;

create table if not exists public.player_scores (
  owner uuid primary key references public.profiles on delete cascade,
  score bigint not null default 0,
  distinct_cards int not null default 0,
  total_cards int not null default 0,
  tiers int[] not null default '{0,0,0,0,0,0}',     -- different cards per rarity
  shiny int not null default 0,
  graded int not null default 0,
  best_grade smallint,
  limited int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists player_scores_score_idx on public.player_scores (score desc);
alter table public.player_scores enable row level security;

create or replace function public.score_refresh(p_user uuid) returns player_scores
language plpgsql security definer set search_path = public as $$
declare r player_scores;
begin
  with d as (
    select coalesce(c.track_id::text, 'a' || c.artist_id) k, c.tier, bool_or(c.holo) sh, max(c.grade) g, count(*) n
    from cards c where c.owner = p_user and c.edition is null group by 1, 2),
  e as (select count(*) n, coalesce(sum(case when x.copies = 1 then 10000 else 3000 end), 0) pts
        from cards c join haunted_editions x on x.slot = c.edition where c.owner = p_user)
  select p_user,
    coalesce((select sum(card_points(tier) * (1 + case when sh then 1 else 0 end + coalesce(g, 0) / 10.0)) from d), 0)::bigint + (select pts from e),
    (select count(*) from d) + (select n from e),
    coalesce((select sum(n) from d), 0) + (select n from e),
    array(select coalesce((select count(*) from d where d.tier = t), 0)::int from generate_series(0, 5) t),
    (select count(*) from d where sh), (select count(*) from cards where owner = p_user and grade is not null),
    (select max(grade) from cards where owner = p_user), (select n from e), now()
  into r;
  insert into player_scores values (r.*)
  on conflict (owner) do update set score = excluded.score, distinct_cards = excluded.distinct_cards, total_cards = excluded.total_cards,
    tiers = excluded.tiers, shiny = excluded.shiny, graded = excluded.graded, best_grade = excluded.best_grade, limited = excluded.limited, updated_at = now();
  return r;
end $$;

-- every 15 minutes: the players seen in the last half hour (a score is never more than a quarter of an hour late for them)
create or replace function public.scores_tick() returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select id from presence where seen_at > now() - interval '30 minutes' loop
    begin perform score_refresh(u); exception when others then null; end;
  end loop;
end $$;
select cron.schedule('scores-tick', '*/15 * * * *', 'select public.scores_tick()');

-- ---------------------------------------------------------------- friends
create table if not exists public.friendships (
  a uuid not null references public.profiles on delete cascade,
  b uuid not null references public.profiles on delete cascade,
  requester uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  check (a < b)
);
create index if not exists friendships_b_idx on public.friendships (b);
alter table public.friendships enable row level security;

create or replace function public.friend_state(p_me uuid, p_other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p_me = p_other then 'me'
    else coalesce((select case when f.status = 'accepted' then 'friends' when f.requester = p_me then 'pending_out' else 'pending_in' end
                   from friendships f where f.a = least(p_me, p_other) and f.b = greatest(p_me, p_other)), 'none') end
$$;

-- ask (or accept, when the other one asked first)
create or replace function public.friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); st text; who text;
begin
  if p_user is null or p_user = uid then raise exception 'bad_player'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  st := friend_state(uid, p_user);
  if st = 'friends' or st = 'pending_out' then return st; end if;
  select pseudo into who from profiles where id = uid;
  if st = 'pending_in' then
    update friendships set status = 'accepted', accepted_at = now() where a = least(uid, p_user) and b = greatest(uid, p_user);
    perform notify(p_user, 'friend_accepted', who);
    return 'friends';
  end if;
  if (select count(*) from friendships where (a = uid or b = uid) and status = 'accepted') >= 200 then raise exception 'too_many_friends'; end if;
  if (select count(*) from friendships where requester = uid and status = 'pending') >= 50 then raise exception 'too_many_requests'; end if;
  insert into friendships (a, b, requester) values (least(uid, p_user), greatest(uid, p_user), uid);
  perform notify(p_user, 'friend_request', who);
  return 'pending_out';
end $$;

create or replace function public.friend_respond(p_user uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); who text;
begin
  if friend_state(uid, p_user) <> 'pending_in' then raise exception 'request_not_found'; end if;
  if p_accept then
    update friendships set status = 'accepted', accepted_at = now() where a = least(uid, p_user) and b = greatest(uid, p_user);
    select pseudo into who from profiles where id = uid;
    perform notify(p_user, 'friend_accepted', who);
    return 'friends';
  end if;
  delete from friendships where a = least(uid, p_user) and b = greatest(uid, p_user);
  return 'none';
end $$;

-- remove a friend, or take back a request
create or replace function public.friend_remove(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  delete from friendships where a = least(uid, p_user) and b = greatest(uid, p_user);
end $$;

create or replace function public.player_card(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'title', p.title, 'cosmetics', p.cosmetics,
    'online', coalesce((select seen_at > now() - interval '5 minutes' from presence where id = p.id), false),
    'seen_at', (select seen_at from presence where id = p.id), 'score', coalesce((select score from player_scores where owner = p.id), 0))
  from profiles p where p.id = p_id
$$;

create or replace function public.my_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select case when a = auth.uid() then b else a end other, status, requester, coalesce(accepted_at, created_at) at
             from friendships where a = auth.uid() or b = auth.uid())
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(player_card(other) order by at desc) from f where status = 'accepted'), '[]'),
    'incoming', coalesce((select jsonb_agg(player_card(other) order by at desc) from f where status = 'pending' and requester <> auth.uid()), '[]'),
    'outgoing', coalesce((select jsonb_agg(player_card(other) order by at desc) from f where status = 'pending' and requester = auth.uid()), '[]'))
$$;

-- ---------------------------------------------------------------- the profile
alter table public.profiles add column if not exists showcase uuid[] not null default '{}';

-- the showcase: up to 6 of my cards, in my order
create or replace function public.set_showcase(p_cards uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[] := coalesce(p_cards, '{}');
begin
  if array_length(ids, 1) > 6 then raise exception 'showcase_six'; end if;
  if (select count(*) from cards where owner = uid and id = any(ids)) <> coalesce(array_length(ids, 1), 0) then raise exception 'not_owned'; end if;
  update profiles set showcase = ids where id = uid;
end $$;

create or replace function public.card_json(c cards) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'kind', c.kind, 'track_id', c.track_id, 'artist_id', c.artist_id, 'tier', c.tier, 'rank', c.rank,
    'holo', c.holo, 'collector', c.collector, 'grade', c.grade, 'grade_cert', c.grade_cert, 'grade_pop', c.grade_pop, 'edition', c.edition, 'edition_no', c.edition_no,
    'pulled_at', c.pulled_at,
    'track', (select to_jsonb(t) - 'updated_at' from (select title, artist, album, cover, duration, bpm, year, explicit, genre from tracks where id = c.track_id) t),
    'artist', (select to_jsonb(a) from (select name, picture, fans, nb_album from artists where id = c.artist_id) a)))
$$;

create or replace function public.player_profile(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; s player_scores; show jsonb;
begin
  select * into p from profiles where id = p_user;
  if p.id is null then raise exception 'user_not_found'; end if;
  select * into s from player_scores where owner = p_user;
  if s.owner is null or s.updated_at < now() - interval '5 minutes' then s := score_refresh(p_user); end if;
  -- the showcase: the cards chosen (still owned), else the 6 best
  select coalesce(jsonb_agg(card_json(c) order by array_position(p.showcase, c.id)), '[]') into show from cards c where c.owner = p_user and c.id = any(p.showcase);
  if jsonb_array_length(show) = 0 then
    select coalesce(jsonb_agg(card_json(c)), '[]') into show
    from (select * from cards c where c.owner = p_user
          order by (c.edition is not null) desc, c.tier desc, c.grade desc nulls last, c.holo desc, c.rank desc limit 6) c;
  end if;
  return player_card(p_user) || jsonb_build_object(
    'created_at', p.created_at, 'friend', friend_state(uid, p_user), 'showcase', show, 'chosen', cardinality(p.showcase) > 0,
    'rank', (select count(*) + 1 from player_scores where score > s.score), 'players', (select count(*) from player_scores where score > 0),
    'stats', jsonb_build_object('score', s.score, 'distinct', s.distinct_cards, 'total', s.total_cards, 'tiers', to_jsonb(s.tiers), 'shiny', s.shiny,
      'graded', s.graded, 'best_grade', s.best_grade, 'limited', s.limited, 'opened', p.opened, 'gods', p.gods,
      'duel_rating', p.duel_rating, 'duel_wins', p.duel_wins, 'duel_losses', p.duel_losses, 'duel_played', p.duel_played),
    'friends', (select count(*) from friendships where (a = p_user or b = p_user) and status = 'accepted'));
end $$;

-- find players by the start of their pseudo
create or replace function public.find_players(p_q text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(player_card(id) || jsonb_build_object('friend', friend_state(auth.uid(), id)) order by lower(pseudo)), '[]')
  from (select id, pseudo from profiles where length(trim(p_q)) >= 2 and lower(pseudo) like lower(replace(replace(trim(p_q), '%', ''), '_', '\_')) || '%'
        order by lower(pseudo) limit 12) x
$$;

revoke execute on function public.score_refresh(uuid), public.scores_tick(), public.friend_state(uuid, uuid), public.player_card(uuid),
  public.card_json(cards) from public, anon, authenticated;
revoke execute on function public.friend_request(uuid), public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.my_friends(),
  public.set_showcase(uuid[]), public.player_profile(uuid), public.find_players(text) from public, anon;
grant execute on function public.friend_request(uuid), public.friend_respond(uuid, boolean), public.friend_remove(uuid), public.my_friends(),
  public.set_showcase(uuid[]), public.player_profile(uuid), public.find_players(text) to authenticated;

-- the scores of everyone, once, at the start
select public.score_refresh(id) from public.profiles;
