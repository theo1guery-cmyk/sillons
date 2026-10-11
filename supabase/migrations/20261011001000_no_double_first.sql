-- No more doubled first purchase: the welcome offer already makes the first purchase cheap, and doubling a big pack
-- (1 900 Vinyles for 9,99 €) was far too generous. Same as credit_purchase() in 20261011000800_shop_offers.sql otherwise.
create or replace function public.credit_purchase(p_session text, p_user uuid, p_pack text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare k shop_packs; s seasons;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  insert into purchases (session_id, owner, pack, cents, vinyls) values (p_session, p_user, p_pack, p_cents, k.vinyls) on conflict do nothing;
  if not found then return; end if;
  if k.vinyls > 0 then perform add_vinyls(p_user, k.vinyls, 'achat : ' || k.name); end if;
  if k.boosters > 0 then update profiles set stock = stock + k.boosters where id = p_user; end if;
  if k.card_kind is not null then perform give_card(p_user, k.card_kind, k.card_tier, k.card_shiny); end if;
  if k.premium then
    s := current_season();
    if s.id is not null then
      insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
      on conflict (owner, season_id) do update set premium = true;
    end if;
  end if;
end $$;
