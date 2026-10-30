-- The game reopens after the outage: maintenance off, the Noël clock back on, and 10 boosters for everyone.
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'noel-tick';
update public.settings set maintenance = false where id = 1;
update public.profiles set stock = stock + 10;
