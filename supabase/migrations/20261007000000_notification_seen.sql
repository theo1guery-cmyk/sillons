-- mark a single notification as read (notifications_read() clears them all)
create or replace function public.notification_seen(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update notifications set read = true where id = p_id and owner = auth.uid()
$$;
revoke execute on function public.notification_seen(bigint) from public, anon;
grant execute on function public.notification_seen(bigint) to authenticated;
