-- The XP boost of the pass, set from the admin page: a multiplier (x1 = off) and an end date (none = until changed).
create or replace function public.admin_xp_boost_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select jsonb_build_object('mult', xp_boost, 'until', xp_boost_until, 'active', season_xp_boost()) from settings where id = 1);
end $$;

create or replace function public.admin_xp_boost_set(p_mult numeric, p_until timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if p_mult is null or p_mult < 1 or p_mult > 5 then raise exception 'bad_amount'; end if;
  update settings set xp_boost = p_mult, xp_boost_until = p_until where id = 1;
  perform admin_log_add(me, null, 'xp_boost', case when p_mult = 1 then 'coupé'
    else 'x' || trim(trailing '.' from trim(trailing '0' from p_mult::text)) || coalesce(' jusqu''au ' || to_char(p_until at time zone 'Europe/Paris', 'DD/MM HH24:MI'), ' sans fin') end);
end $$;

revoke execute on function public.admin_xp_boost_get(), public.admin_xp_boost_set(numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_xp_boost_get(), public.admin_xp_boost_set(numeric, timestamptz) to authenticated;
