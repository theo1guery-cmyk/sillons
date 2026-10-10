-- Admin page: live presence, accounts, bans, warnings, messages to everyone, Streams and boosters, an action log.
-- Everything lives in tables players cannot read (RLS on, no policy); only the security definer functions below
-- touch them, and every admin_* function checks that the caller is an admin first.

-- ---------------------------------------------------------------- tables
create table public.admins (id uuid primary key references public.profiles on delete cascade);
insert into public.admins select id from public.profiles where lower(pseudo) = 'tyt23' on conflict do nothing;

-- the last heartbeat of each player: seen_at = the game is open, active_at = they touched it in the last 2 minutes
create table public.presence (
  id uuid primary key references public.profiles on delete cascade,
  seen_at timestamptz not null default now(),
  active_at timestamptz
);
create index presence_seen_idx on public.presence (seen_at desc);

-- a ban; until null = for good
create table public.bans (
  id uuid primary key references public.profiles on delete cascade,
  until timestamptz,
  reason text not null default '',
  by uuid references public.profiles on delete set null,
  at timestamptz not null default now()
);

create table public.admin_log (
  id bigint generated always as identity primary key,
  admin uuid references public.profiles on delete set null,
  target uuid references public.profiles on delete set null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);
create index admin_log_at_idx on public.admin_log (at desc);

alter table public.admins enable row level security;
alter table public.presence enable row level security;
alter table public.bans enable row level security;
alter table public.admin_log enable row level security;

-- ---------------------------------------------------------------- helpers
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where id = auth.uid())
$$;

create function public.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from admins where id = uid) then raise exception 'not_admin'; end if;
  return uid;
end $$;

-- every write a player makes goes through require_user(): a banned account can still look, not act
create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from bans b where b.id = uid and (b.until is null or b.until > now())) then raise exception 'account_banned'; end if;
  return uid;
end $$;

-- ---------------------------------------------------------------- the player's side
-- called every 30 s while the game is open; says whether the player is an admin, or banned
create function public.heartbeat(p_active boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b bans;
begin
  if uid is null then return null; end if;
  insert into presence (id, seen_at, active_at) values (uid, now(), case when p_active then now() end)
  on conflict (id) do update set seen_at = now(), active_at = case when p_active then now() else presence.active_at end;
  select * into b from bans where id = uid and (until is null or until > now());
  return jsonb_build_object('admin', exists (select 1 from admins where id = uid),
    'ban', case when b.id is null then null else jsonb_build_object('until', b.until, 'reason', b.reason) end);
end $$;

-- ---------------------------------------------------------------- the admin's side
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select jsonb_build_object(
    'active_now', (select count(*) from presence where active_at > now() - interval '2 minutes'),
    'open_now',   (select count(*) from presence where seen_at > now() - interval '75 seconds'),
    'active_1h',  (select count(*) from presence where active_at > now() - interval '1 hour'),
    'active_24h', (select count(*) from presence where active_at > now() - interval '24 hours'),
    'active_7d',  (select count(*) from presence where active_at > now() - interval '7 days'),
    'accounts',   (select count(*) from profiles),
    'new_24h',    (select count(*) from profiles where created_at > now() - interval '24 hours'),
    'new_7d',     (select count(*) from profiles where created_at > now() - interval '7 days'),
    'banned',     (select count(*) from bans where until is null or until > now()),
    'opened',     (select coalesce(sum(opened), 0) from profiles),
    'gods',       (select coalesce(sum(gods), 0) from profiles)));
end $$;

-- players, newest activity first; p_filter: all | online | active24 | banned | new | admins
create function public.admin_users(p_q text default '', p_filter text default 'all', p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(coalesce(trim(p_q), '')) || '%';
begin
  perform require_admin();
  return coalesce((select jsonb_agg(x order by (x ->> 'online')::boolean desc, x ->> 'active_at' desc nulls last, x ->> 'created_at' desc) from (
    select jsonb_build_object(
      'id', p.id, 'pseudo', p.pseudo, 'email', u.email, 'created_at', p.created_at,
      'seen_at', pr.seen_at, 'active_at', pr.active_at,
      'online', coalesce(pr.active_at > now() - interval '2 minutes', false),
      'streams', p.streams, 'opened', p.opened, 'gods', p.gods, 'stock', p.stock,
      'admin', a.id is not null,
      'ban', case when b.id is null then null else jsonb_build_object('until', b.until, 'reason', b.reason, 'at', b.at) end,
      'warnings', (select count(*) from notifications n where n.owner = p.id and n.type = 'admin_warning')) x
    from profiles p
    join auth.users u on u.id = p.id
    left join presence pr on pr.id = p.id
    left join admins a on a.id = p.id
    left join bans b on b.id = p.id and (b.until is null or b.until > now())
    where (lower(p.pseudo) like q or lower(u.email) like q)
      and case p_filter
        when 'online' then pr.active_at > now() - interval '2 minutes'
        when 'active24' then pr.active_at > now() - interval '24 hours'
        when 'banned' then b.id is not null
        when 'new' then p.created_at > now() - interval '7 days'
        when 'admins' then a.id is not null
        else true end
    order by pr.active_at desc nulls last, p.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  ) s), '[]');
end $$;

-- one player in detail: counts, last warnings, ban history from the log
create function public.admin_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select jsonb_build_object(
    'cards', (select count(*) from cards where owner = p_user),
    'listings', (select count(*) from listings where seller = p_user and status = 'active'),
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'warnings', coalesce((select jsonb_agg(jsonb_build_object('at', n.created_at, 'message', n.title, 'read', n.read) order by n.created_at desc)
                          from notifications n where n.owner = p_user and n.type = 'admin_warning'), '[]'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'detail', l.detail,
                                                          'admin', (select pseudo from profiles where id = l.admin)) order by l.at desc)
                     from (select * from admin_log where target = p_user order by at desc limit 20) l), '[]')));
end $$;

create function public.admin_log_add(p_admin uuid, p_target uuid, p_action text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into admin_log (admin, target, action, detail) values (p_admin, p_target, p_action, left(coalesce(p_detail, ''), 500))
$$;

-- p_hours null or 0 = for good
create function public.admin_ban(p_user uuid, p_hours int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); v_until timestamptz := case when coalesce(p_hours, 0) > 0 then now() + make_interval(hours => p_hours) end;
begin
  if p_user = me or exists (select 1 from admins where id = p_user) then raise exception 'cannot_ban_admin'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  insert into bans (id, until, reason, by, at) values (p_user, v_until, left(coalesce(p_reason, ''), 300), me, now())
  on conflict (id) do update set until = excluded.until, reason = excluded.reason, by = excluded.by, at = now();
  perform admin_log_add(me, p_user, 'ban', case when v_until is null then 'définitif' else p_hours || ' h' end || coalesce(' · ' || nullif(p_reason, ''), ''));
end $$;

create function public.admin_unban(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  delete from bans where id = p_user;
  perform admin_log_add(me, p_user, 'unban', '');
end $$;

-- a warning the player has to read (a dialog in the game)
create function public.admin_warn(p_user uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if coalesce(trim(p_message), '') = '' then raise exception 'empty_message'; end if;
  insert into notifications (owner, type, title) values (p_user, 'admin_warning', left(trim(p_message), 500));
  perform admin_log_add(me, p_user, 'warn', p_message);
end $$;

-- a message to every player (shown once, in a dialog)
create function public.admin_broadcast(p_message text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); n int;
begin
  if coalesce(trim(p_message), '') = '' then raise exception 'empty_message'; end if;
  insert into notifications (owner, type, title) select id, 'admin_message', left(trim(p_message), 500) from profiles;
  get diagnostics n = row_count;
  perform admin_log_add(me, null, 'broadcast', p_message);
  return n;
end $$;

-- Streams can be taken away too (negative amount)
create function public.admin_streams(p_user uuid, p_amount bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); amount bigint := p_amount; bal bigint;
begin
  if p_amount = 0 or abs(p_amount) > 10000000 then raise exception 'bad_amount'; end if;
  select streams into bal from profiles where id = p_user;
  if bal is null then raise exception 'user_not_found'; end if;
  amount := greatest(amount, -bal);                       -- never below zero
  if amount = 0 then return bal; end if;
  bal := add_streams(p_user, amount, coalesce(nullif(trim(p_reason), ''), 'cadeau de l''équipe'));
  perform admin_log_add(me, p_user, 'streams', amount || coalesce(' · ' || nullif(p_reason, ''), ''));
  return bal;
end $$;

create function public.admin_boosters(p_user uuid, p_count int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); s int;
begin
  if p_count = 0 or abs(p_count) > 100 then raise exception 'bad_amount'; end if;
  update profiles set stock = greatest(0, stock + p_count) where id = p_user returning stock into s;
  perform admin_log_add(me, p_user, 'boosters', p_count::text);
  return s;
end $$;

create function public.admin_log_list(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'detail', l.detail,
      'admin', (select pseudo from profiles where id = l.admin), 'target', (select pseudo from profiles where id = l.target)) order by l.at desc)
    from (select * from admin_log order by at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) l), '[]');
end $$;

-- ---------------------------------------------------------------- rights
revoke execute on function public.is_admin(), public.require_admin(), public.heartbeat(boolean), public.admin_stats(),
  public.admin_users(text, text, int), public.admin_user(uuid), public.admin_log_add(uuid, uuid, text, text),
  public.admin_ban(uuid, int, text), public.admin_unban(uuid), public.admin_warn(uuid, text), public.admin_broadcast(text),
  public.admin_streams(uuid, bigint, text), public.admin_boosters(uuid, int), public.admin_log_list(int) from public, anon;
grant execute on function public.is_admin(), public.heartbeat(boolean), public.admin_stats(), public.admin_users(text, text, int),
  public.admin_user(uuid), public.admin_ban(uuid, int, text), public.admin_unban(uuid), public.admin_warn(uuid, text),
  public.admin_broadcast(text), public.admin_streams(uuid, bigint, text), public.admin_boosters(uuid, int), public.admin_log_list(int)
  to authenticated;
revoke execute on function public.admin_log_add(uuid, uuid, text, text), public.require_admin() from authenticated;
