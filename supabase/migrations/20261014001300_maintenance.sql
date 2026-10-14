-- Maintenance: one switch on the admin page. While it is on, every player sees a maintenance screen and the server
-- refuses their actions (require_user raises 'maintenance'); admins keep playing as usual.
alter table public.settings add column if not exists maintenance boolean not null default false;
alter table public.settings add column if not exists maintenance_msg text;

create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from bans b where b.id = uid and (b.until is null or b.until > now())) then raise exception 'account_banned'; end if;
  if (select maintenance from settings where id = 1) and not exists (select 1 from admins where id = uid) then raise exception 'maintenance'; end if;
  return uid;
end $$;

-- what the page shows: null when the game is open (or for an admin), else the message
create or replace function public.maintenance() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when s.maintenance and not exists (select 1 from admins where id = auth.uid())
    then jsonb_build_object('msg', coalesce(nullif(trim(s.maintenance_msg), ''), 'Le jeu est en maintenance. On revient très vite !')) end
  from settings s where s.id = 1;
$$;

-- the heartbeat (every 30 s) also says it, so a game left open closes within 30 s
create or replace function public.heartbeat(p_active boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b bans;
begin
  if uid is null then return null; end if;
  insert into presence (id, seen_at, active_at) values (uid, now(), case when p_active then now() end)
  on conflict (id) do update set seen_at = now(), active_at = case when p_active then now() else presence.active_at end;
  select * into b from bans where id = uid and (until is null or until > now());
  return jsonb_build_object('admin', exists (select 1 from admins where id = uid),
    'ban', case when b.id is null then null else jsonb_build_object('until', b.until, 'reason', b.reason) end,
    'maintenance', maintenance());
end $$;

create or replace function public.admin_maintenance_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select jsonb_build_object('on', maintenance, 'msg', maintenance_msg) from settings where id = 1);
end $$;

create or replace function public.admin_maintenance_set(p_on boolean, p_msg text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  update settings set maintenance = p_on, maintenance_msg = nullif(trim(coalesce(p_msg, '')), '') where id = 1;
  perform admin_log_add(me, null, 'maintenance', case when p_on then 'activée' else 'coupée' end);
end $$;

revoke execute on function public.maintenance(), public.admin_maintenance_get(), public.admin_maintenance_set(boolean, text) from public, anon, authenticated;
grant execute on function public.maintenance() to anon, authenticated;
grant execute on function public.admin_maintenance_get(), public.admin_maintenance_set(boolean, text) to authenticated;
