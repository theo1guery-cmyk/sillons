-- Events: a theme for the whole site (for now 'halloween'), switched on and off from the admin page.
alter table public.settings add column if not exists event text;      -- null = no event

create or replace function public.admin_event_set(p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); e text := nullif(trim(coalesce(p_event, '')), '');
begin
  if e is not null and e not in ('halloween') then raise exception 'bad_event'; end if;
  update settings set event = e where id = 1;
  perform admin_log_add(me, null, 'event', coalesce(e, 'aucun'));
end $$;
revoke execute on function public.admin_event_set(text) from public, anon, authenticated;
grant execute on function public.admin_event_set(text) to authenticated;
