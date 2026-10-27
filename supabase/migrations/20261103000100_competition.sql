-- The competition around the Bataille de cartes and the collection:
--  * leaderboards: collection score, trophies, Légendaires, clash, this week's challenge, this weekend's tournament
--    (everyone, or my friends only), with my own place;
--  * the challenge of the week (Monday to Sunday): one goal for everyone, drawn in turn (boosters opened, Mythiques
--    pulled, battles won, new cards, clashes won). Top 10 rewarded on Monday, podium on the Discord;
--  * the tournament of the weekend (Saturday and Sunday): every battle counts, 3 points a victory, 1 a defeat. Top 10
--    rewarded on Monday too;
--  * the end of a season (with the Pass): a present by league, then trophies come down halfway above 900.

-- ---------------------------------------------------------------- the week
create or replace function public.week_start(p_day date) returns date language sql immutable as $$ select p_day - (extract(isodow from p_day)::int - 1) $$;

create table if not exists public.weekly_challenges (
  week date primary key,                                  -- its Monday
  metric text not null, label text not null, unit text not null,
  closed boolean not null default false
);
alter table public.weekly_challenges enable row level security;

create or replace function public.challenge_pick(p_week date) returns weekly_challenges
language plpgsql security definer set search_path = public as $$
declare w weekly_challenges; opts text[][] := array[
    ['packs', 'Ouvre le plus de boosters', 'boosters'], ['battle_win', 'Gagne le plus de batailles', 'victoires'], ['tier4', 'Tire le plus de Mythiques et Légendaires', 'cartes'],
    ['new', 'Trouve le plus de nouvelles cartes', 'nouvelles cartes'], ['duel_win', 'Gagne le plus de clashs blind test', 'victoires']];
  k int;
begin
  select * into w from weekly_challenges where week = p_week;
  if w.week is not null then return w; end if;
  k := 1 + ((p_week - date '2026-11-02') / 7) % 5;
  if k < 1 then k := k + 5; end if;
  insert into weekly_challenges (week, metric, label, unit) values (p_week, opts[k][1], opts[k][2], opts[k][3]) on conflict do nothing;
  select * into w from weekly_challenges where week = p_week;
  return w;
end $$;

-- the scores of a challenge: the sum of its counter over the week
create or replace function public.challenge_scores(p_week date, p_metric text) returns table (owner uuid, score bigint)
language sql stable security definer set search_path = public as $$
  select owner, sum(n)::bigint from daily_counters where metric = p_metric and day >= p_week and day < p_week + 7 and n > 0 group by owner
$$;
-- the scores of a tournament (the Saturday and Sunday of a week): 3 a victory, 1 a defeat
create or replace function public.tournament_scores(p_week date) returns table (owner uuid, score bigint)
language sql stable security definer set search_path = public as $$
  select owner, (sum(n) filter (where metric = 'battle_win') * 2 + sum(n) filter (where metric = 'battles'))::bigint
  from daily_counters where metric in ('battles', 'battle_win') and day in (p_week + 5, p_week + 6) group by owner
  having sum(n) filter (where metric = 'battles') > 0
$$;

-- the presents of a top 10 (1st, 2nd, 3rd, then 4th to 10th)
create or replace function public.podium_give(p_user uuid, p_place int, p_what text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_place = 1 then perform give_card(p_user, 'track', 5::smallint, false, p_what); perform add_streams(p_user, 5000, p_what || ' : 1re place'); return '1 Légendaire + 5 000 Streams';
  elsif p_place = 2 then perform give_card(p_user, 'track', 4::smallint, false, p_what); perform add_streams(p_user, 3000, p_what || ' : 2e place'); return '1 Mythique + 3 000 Streams';
  elsif p_place = 3 then perform give_card(p_user, 'track', 4::smallint, false, p_what); perform add_streams(p_user, 2000, p_what || ' : 3e place'); return '1 Mythique + 2 000 Streams';
  else update profiles set big_packs = big_packs + 1 where id = p_user; perform add_streams(p_user, 1000, p_what || ' : top 10'); return '1 Grand booster + 1 000 Streams';
  end if;
end $$;

create table if not exists public.podiums (
  week date not null, kind text not null check (kind in ('challenge', 'tournament')),
  place int not null, owner uuid references public.profiles on delete set null, score bigint not null, prize text,
  primary key (week, kind, place)
);
alter table public.podiums enable row level security;

-- Monday: the challenge and the tournament of last week are closed, their top 10 rewarded, the podium told
create or replace function public.competition_tick() returns void
language plpgsql security definer set search_path = public as $$
declare this date := week_start(game_day()); w weekly_challenges; r record; k int; prize text; msg text; names text[];
begin
  perform challenge_pick(this);
  for w in select * from weekly_challenges where week < this and not closed order by week loop
    update weekly_challenges set closed = true where week = w.week;
    -- the challenge
    k := 0; names := '{}';
    for r in select s.owner, s.score, p.pseudo from challenge_scores(w.week, w.metric) s join profiles p on p.id = s.owner order by s.score desc, p.pseudo limit 10 loop
      k := k + 1; prize := podium_give(r.owner, k, 'défi de la semaine');
      insert into podiums values (w.week, 'challenge', k, r.owner, r.score, prize) on conflict do nothing;
      perform notify(r.owner, 'podium', 'Défi de la semaine : tu finis ' || k || case when k = 1 then 're' else 'e' end || ' ! Ton cadeau : ' || prize);
      if k <= 3 then names := array_append(names, (array['🥇', '🥈', '🥉'])[k] || ' **' || discord_esc(r.pseudo) || '** (' || r.score || ')'); end if;
    end loop;
    -- the tournament
    k := 0; msg := '';
    for r in select s.owner, s.score, p.pseudo from tournament_scores(w.week) s join profiles p on p.id = s.owner order by s.score desc, p.pseudo limit 10 loop
      k := k + 1; prize := podium_give(r.owner, k, 'tournoi du week-end');
      insert into podiums values (w.week, 'tournament', k, r.owner, r.score, prize) on conflict do nothing;
      perform notify(r.owner, 'podium', 'Tournoi du week-end : tu finis ' || k || case when k = 1 then 'er' else 'e' end || ' ! Ton cadeau : ' || prize);
      if k <= 3 then msg := msg || (array['🥇', '🥈', '🥉'])[k] || ' **' || discord_esc(r.pseudo) || '** (' || r.score || ' pts)  '; end if;
    end loop;
    begin
      perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content',
        '🏆 **Les podiums de la semaine**' || E'\n' || '🎯 Défi « ' || w.label || ' » : ' || coalesce(nullif(array_to_string(names, '  '), ''), 'personne cette fois') || E'\n'
        || '🏟️ Tournoi du week-end : ' || coalesce(nullif(msg, ''), 'personne cette fois') || E'\n'
        || 'Le nouveau défi est lancé : « ' || (select label from weekly_challenges where week = this) || ' ». À vous de jouer !'));
    exception when others then null;
    end;
  end loop;
end $$;
select cron.schedule('competition-tick', '7 * * * *', 'select public.competition_tick()');

-- ---------------------------------------------------------------- the end of a season: a present by league, trophies halved above 900
create table if not exists public.league_rewards_done (season_id int primary key, at timestamptz not null default now());
alter table public.league_rewards_done enable row level security;

create or replace function public.league_season_tick() returns void
language plpgsql security definer set search_path = public as $$
declare s seasons; p record;
begin
  select * into s from seasons where ends_at <= now() and ends_at > now() - interval '3 days'
    and id not in (select season_id from league_rewards_done) order by ends_at desc limit 1;
  if s.id is null then return; end if;
  insert into league_rewards_done (season_id) values (s.id);
  for p in select id, trophies, league_of(trophies) lg from profiles where battle_wins + battle_losses > 0 loop
    case p.lg
      when 'Légende' then perform give_card(p.id, 'track', 5::smallint, true, 'ligue Légende'); insert into player_titles (owner, title) values (p.id, 'Légende de la ' || split_part(s.name, ' ·', 1)) on conflict do nothing;
      when 'Diamant' then perform give_card(p.id, 'track', 5::smallint, false, 'ligue Diamant');
      when 'Platine' then perform give_card(p.id, 'track', 4::smallint, false, 'ligue Platine');
      when 'Or' then update profiles set big_packs = big_packs + 1 where id = p.id;
      when 'Argent' then update profiles set stock = stock + 3 where id = p.id;
      else perform add_streams(p.id, 500, 'fin de saison : ligue Bronze');
    end case;
    perform notify(p.id, 'league_end', 'Fin de saison : tu termines en ligue ' || p.lg || ' avec ' || p.trophies || ' trophées. Ton cadeau t''attend !');
  end loop;
  update profiles set trophies = 900 + (trophies - 900) / 2 where trophies > 900;
  begin
    perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content',
      '🛡️ **Fin de la saison des ligues !** Chacun reçoit son cadeau selon sa ligue, et les trophées redescendent à mi-chemin au-dessus de l''Or. Les Légendes : '
      || coalesce((select string_agg('**' || discord_esc(pseudo) || '**', ', ' order by trophies desc) from profiles where trophies >= 2200 and battle_wins > 0), 'aucune cette fois') || '. La nouvelle saison commence maintenant !'));
  exception when others then null;
  end;
end $$;
select cron.schedule('league-season-tick', '17 * * * *', 'select public.league_season_tick()');

-- ---------------------------------------------------------------- leaderboards
-- p_kind: collection, trophies, legends, duel, challenge, tournament; p_friends: only my friends (and me)
create or replace function public.leaderboard(p_kind text, p_friends boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); this date := week_start(game_day()); w weekly_challenges; rows jsonb; mine jsonb;
begin
  w := challenge_pick(this);
  create temp table if not exists lb_tmp (owner uuid, score bigint, extra text) on commit drop;
  truncate lb_tmp;
  if p_kind = 'collection' then insert into lb_tmp select owner, score, null from player_scores where score > 0;
  elsif p_kind = 'trophies' then insert into lb_tmp select id, trophies, league_of(trophies) from profiles where battle_wins + battle_losses > 0;
  elsif p_kind = 'legends' then insert into lb_tmp select owner, tiers[6], null from player_scores where tiers[6] > 0;
  elsif p_kind = 'duel' then insert into lb_tmp select id, duel_rating, duel_wins || ' V' from profiles where duel_played > 0;
  elsif p_kind = 'challenge' then insert into lb_tmp select owner, score, null from challenge_scores(this, w.metric);
  elsif p_kind = 'tournament' then insert into lb_tmp select owner, score, null from tournament_scores(this);
  else raise exception 'bad_kind'; end if;
  if p_friends then
    delete from lb_tmp where owner <> uid and owner not in (select case when a = uid then b else a end from friendships where (a = uid or b = uid) and status = 'accepted');
  end if;
  select coalesce(jsonb_agg(x order by (x ->> 'rank')::int), '[]') into rows from (
    select jsonb_build_object('rank', rank() over (order by l.score desc), 'id', p.id, 'pseudo', p.pseudo, 'title', p.title, 'cosmetics', p.cosmetics,
      'score', l.score, 'extra', l.extra, 'league', league_of(p.trophies), 'me', p.id = uid) x
    from lb_tmp l join profiles p on p.id = l.owner order by l.score desc, p.pseudo limit 50) t;
  select jsonb_build_object('rank', (select count(*) + 1 from lb_tmp o where o.score > l.score), 'score', l.score) into mine from lb_tmp l where l.owner = uid;
  return jsonb_build_object('rows', rows, 'me', mine, 'total', (select count(*) from lb_tmp),
    'challenge', jsonb_build_object('label', w.label, 'unit', w.unit, 'ends', (this + 7)::timestamp at time zone 'Europe/Paris'),
    'tournament', jsonb_build_object('starts', (this + 5)::timestamp at time zone 'Europe/Paris', 'ends', (this + 7)::timestamp at time zone 'Europe/Paris',
       'on', game_day() >= this + 5),
    'last', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'place', d.place, 'pseudo', p.pseudo, 'score', d.score, 'prize', d.prize) order by d.kind, d.place), '[]')
             from podiums d left join profiles p on p.id = d.owner where d.week = this - 7 and d.place <= 3));
end $$;

revoke execute on function public.challenge_pick(date), public.challenge_scores(date, text), public.tournament_scores(date), public.podium_give(uuid, int, text),
  public.competition_tick(), public.league_season_tick() from public, anon, authenticated;
revoke execute on function public.leaderboard(text, boolean) from public, anon;
grant execute on function public.leaderboard(text, boolean) to authenticated;

select public.challenge_pick(public.week_start(public.game_day()));
