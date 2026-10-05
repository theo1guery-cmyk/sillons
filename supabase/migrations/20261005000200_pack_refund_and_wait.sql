-- give a booster back when its opening failed before the cards were checked
create function public.abandon_pack(p_pack uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs;
begin
  delete from packs where id = p_pack and owner = uid and not done returning * into pk;
  if pk.id is not null and pk.kind = 'booster' and not (select test_mode from settings) then
    update profiles set stock = least(10, stock + 1) where id = uid;
  end if;
end $$;

-- seconds left before the signed-in player may trade (0 = can trade)
create function public.my_trade_wait() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, ceil(extract(epoch from (p.created_at + s.trade_min_age) - now())))::int
  from profiles p, settings s where p.id = auth.uid()
$$;

revoke execute on function public.abandon_pack(uuid), public.my_trade_wait() from public, anon;
grant execute on function public.abandon_pack(uuid), public.my_trade_wait() to authenticated;
