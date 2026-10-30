-- The pool's background check is removed for good: its runs took about 13 seconds each, every minute, and with the
-- boosters it used up the database's disk budget until the game stopped answering. A booster still takes a track
-- checked less than 3 days ago from what the server knows; the others are checked on Deezer as before.
select cron.unschedule('pool-warm') where exists (select 1 from cron.job where jobname = 'pool-warm');
drop function if exists public.pool_warm_step(int);
