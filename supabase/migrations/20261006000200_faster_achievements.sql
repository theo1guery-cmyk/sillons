-- achievement_values read the player's cards about fifteen times (one sub-query per achievement). With collections of
-- 30 000+ cards and a call after every booster, it saturated the database. Same values, one pass over the cards.
create or replace function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.track_id, c.tier, c.holo, c.rank, t.artist, t.year, t.genre, t.duration, t.bpm
             from cards c join tracks t on t.id = c.track_id where c.owner = p_user),
       a as (select count(distinct track_id) collector,
                    count(*) filter (where tier = 5) legends,
                    count(*) filter (where tier = 4) mythics,
                    count(*) filter (where holo) holos,
                    count(distinct tier) rainbow,
                    count(distinct track_id) filter (where rank < 1000) digger,
                    count(*) filter (where rank = 0) zero,
                    count(distinct year / 10) filter (where year >= 1950) decades,
                    count(distinct genre) genres,
                    count(distinct upper(left(artist, 1))) filter (where upper(left(artist, 1)) between 'A' and 'Z') alphabet,
                    count(*) filter (where duration > 600) marathon,
                    count(*) filter (where duration between 1 and 59) interlude,
                    count(*) filter (where bpm >= 200) bpm200
             from c),
       f as (select coalesce(max(n), 0) fan from (select count(distinct track_id) n from c group by lower(artist)) x),
       p as (select gods, opened, best_streak from profiles where id = p_user)
  select jsonb_build_object(
    'collector', a.collector, 'legends', a.legends, 'mythics', a.mythics, 'holos', a.holos, 'rainbow', a.rainbow,
    'god', p.gods, 'digger', a.digger, 'zero', a.zero, 'decades', a.decades, 'genres', a.genres, 'fan', f.fan,
    'alphabet', a.alphabet, 'marathon', a.marathon, 'interlude', a.interlude, 'bpm200', a.bpm200,
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'opened', p.opened, 'streak', p.best_streak,
    'trader', (select coalesce(sum(price - floor(price * (select market_fee_pct from settings) / 100.0)), 0) from sales where seller = p_user))
  from a, f left join p on true
$$;
