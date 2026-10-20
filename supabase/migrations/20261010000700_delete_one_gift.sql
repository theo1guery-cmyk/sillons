-- Admin page: take back one offered card (from the list on the player's page), not only all of them at once.
-- Only a card marked as offered (or made for a test) can be removed this way.
create function public.admin_delete_gifted_card(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); k cards;
begin
  delete from cards where id = p_card and (gifted or source = 'test') returning * into k;
  if k.id is null then raise exception 'card_not_found'; end if;
  perform admin_log_add(me, k.owner, 'gift', '1 carte offerte supprimée');
end $$;

revoke execute on function public.admin_delete_gifted_card(uuid) from public, anon;
grant execute on function public.admin_delete_gifted_card(uuid) to authenticated;
