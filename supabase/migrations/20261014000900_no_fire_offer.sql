-- "Tu es en feu !" is over on the server too: never open (the shop no longer offers it, and buying it is refused).
-- It also spares a look through the player's last hour of cards each time the shop is loaded.
create or replace function public.fire_until(p_user uuid) returns timestamptz language sql stable security definer set search_path = public as $$
  select null::timestamptz
$$;
revoke execute on function public.fire_until(uuid) from public, anon, authenticated;
