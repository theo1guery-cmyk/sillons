-- Emergency: game in maintenance, and the 'pool-warm' job (25 Deezer calls in a row every minute) is stopped:
-- its runs could pile up on each other and hold the database's connections, which blocks the whole game.
update public.settings set maintenance = true, maintenance_msg = 'Gros bug : le jeu est en maintenance. On revient très vite !' where id = 1;
select cron.unschedule('pool-warm') where exists (select 1 from cron.job where jobname = 'pool-warm');
select pg_cancel_backend(pid) from pg_stat_activity
  where pid <> pg_backend_pid() and (query ilike '%pool_warm_step%' or (state = 'active' and now() - query_start > interval '30 seconds'));
-- what is still running (send this result if the game still does not come back)
select pid, state, now() - query_start as duree, left(query, 80) as requete from pg_stat_activity
  where datname = current_database() and pid <> pg_backend_pid() order by query_start;
