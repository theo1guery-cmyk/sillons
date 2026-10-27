-- Zik Hunter Wrapped: the year of a player, told in a few screens (from 1 December, Paris; the admins can look before).
-- Everything comes from what the game already keeps: the counters of each day, the cards owned, the Streams earned,
-- the clashes, the gradings, the score of collection and its rank.

create or replace function public.my_wrapped() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; s player_scores; best jsonb; graded jsonb; arts jsonb; days int; top_day record;
  packs bigint; cards bigint; fresh bigint; sales bigint; buys bigint; trades bigint; streams bigint; ahead bigint; total bigint; kind text;
begin
  if now() < timestamptz '2026-12-01 00:00 Europe/Paris' and not exists (select 1 from admins where id = uid) then raise exception 'wrapped_soon'; end if;
  select * into p from profiles where id = uid;
  s := score_refresh(uid);
  select count(distinct day) into days from daily_counters where owner = uid and n > 0;
  select day, n into top_day from daily_counters where owner = uid and metric = 'packs' order by n desc, day limit 1;
  select coalesce(sum(n) filter (where metric = 'packs'), 0), coalesce(sum(n) filter (where metric = 'cards'), 0), coalesce(sum(n) filter (where metric = 'new'), 0),
         coalesce(sum(n) filter (where metric = 'sales'), 0), coalesce(sum(n) filter (where metric = 'buys'), 0), coalesce(sum(n) filter (where metric = 'trades'), 0)
  into packs, cards, fresh, sales, buys, trades from daily_counters where owner = uid;
  packs := greatest(packs, p.opened);
  select coalesce(sum(amount), 0) into streams from stream_ledger where owner = uid and amount > 0;
  -- the most beautiful card: a limited edition first, then the rarest, the best graded, the Shiny, the most famous
  select card_json(c) into best from cards c where c.owner = uid
  order by (c.edition is not null) desc, c.tier desc, c.grade desc nulls last, c.holo desc, c.rank desc limit 1;
  select card_json(c) into graded from cards c where c.owner = uid and c.grade is not null order by c.grade desc, c.tier desc, c.rank desc limit 1;
  -- the artists I hold the most cards of
  select coalesce(jsonb_agg(jsonb_build_object('artist', artist, 'n', n, 'cover', cover) order by n desc), '[]') into arts from (
    select t.artist, count(*) n, (array_agg(t.cover order by c.tier desc, c.rank desc))[1] cover
    from cards c join tracks t on t.id = c.track_id where c.owner = uid and c.kind = 'track' and t.artist <> '' group by t.artist order by n desc limit 5) a;
  select count(*) filter (where score > s.score), count(*) filter (where score > 0) into ahead, total from player_scores;
  -- what kind of player: the thing done the most, compared to everyone
  kind := case
    when p.duel_wins >= 15 and p.duel_wins * 4 >= packs / 10 then 'duel'
    when sales + buys >= 30 then 'trader'
    when s.graded >= 10 then 'grader'
    when s.tiers[6] >= 3 or s.limited >= 1 then 'lucky'
    when packs >= 500 then 'hunter'
    else 'collector' end;
  return jsonb_build_object('pseudo', p.pseudo, 'cosmetics', p.cosmetics, 'since', p.created_at, 'days', days,
    'packs', packs, 'gods', p.gods, 'cards', greatest(cards, s.total_cards), 'new', fresh, 'top_day', case when top_day.day is not null then jsonb_build_object('day', top_day.day, 'packs', top_day.n) end,
    'streams', streams, 'sales', sales, 'buys', buys, 'trades', trades,
    'best', best, 'graded', graded, 'artists', arts,
    'score', s.score, 'distinct', s.distinct_cards, 'tiers', to_jsonb(s.tiers), 'shiny', s.shiny, 'n_graded', s.graded, 'limited', s.limited,
    'rank', ahead + 1, 'players', total, 'top_pct', greatest(1, ceil(100.0 * (ahead + 1) / greatest(total, 1)))::int,
    'duel_wins', p.duel_wins, 'duel_losses', p.duel_losses, 'duel_rating', p.duel_rating, 'kind', kind);
end $$;
revoke execute on function public.my_wrapped() from public, anon;
grant execute on function public.my_wrapped() to authenticated;
