-- Every booster now has a Rare (20261011001700_rare_guaranteed.sql), so the challenge of the day "Tire une Rare ou mieux"
-- was won by opening one booster. It becomes "Tire 3 Épiques ou mieux" (about 30 boosters), for 60 Streams.
update public.daily_defs set label = 'Tire 3 Épiques ou mieux', metric = 'tier3', goal = 3, reward = 60 where key = 'rare1';
