-- Discard quests were a dead end: a card can only be discarded if it is a duplicate (one copy is always kept), and many
-- players don't have duplicates or don't find where. The daily challenge "Défausse 5 doublons" becomes "Ouvre 5 boosters",
-- and the Halloween quest "Défausse 20 cartes" becomes "Tire une Mythique ou mieux" (same keys: today's claims stay).
update public.daily_defs set label = 'Ouvre 5 boosters', metric = 'packs', goal = 5, reward = 10 where key = 'discard5';

create or replace function public.halloween_quests(p_user uuid) returns table (key text, label text, progress int, goal int, reward int)
language sql stable security definer set search_path = public as $$
  with c as (select metric, n from daily_counters where owner = p_user and day = game_day())
  select * from (values
    ('visit', 'Rends visite à la sorcière', 1, 1, 5),
    ('open10', 'Ouvre 10 boosters', coalesce((select n from c where metric = 'packs'), 0), 10, 15),
    ('open30', 'Ouvre 30 boosters', coalesce((select n from c where metric = 'packs'), 0), 30, 20),
    ('open60', 'Ouvre 60 boosters', coalesce((select n from c where metric = 'packs'), 0), 60, 25),
    ('epic', 'Tire une Épique ou mieux', coalesce((select n from c where metric = 'tier3'), 0), 1, 10),
    ('dailies', 'Réussis tes 3 défis du jour', (select count(*)::int from daily_claims k where k.owner = p_user and k.day = game_day()), 3, 15),
    ('discard', 'Tire une Mythique ou mieux', coalesce((select n from c where metric = 'tier4'), 0), 1, 10),   -- was "discard 20 cards": many players have nothing to discard
    ('market', 'Achète une carte au marché', coalesce((select n from c where metric = 'buys'), 0), 1, 10),
    ('duel', 'Gagne un clash blind test', coalesce((select n from c where metric = 'duel_rewards'), 0), 1, 10)) q(key, label, progress, goal, reward)
$$;
