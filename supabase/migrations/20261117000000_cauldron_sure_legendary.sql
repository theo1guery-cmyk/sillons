-- The cauldron: 5 Mythiques now always give a Légendaire (it was half of the time).
create or replace function public.cauldron_brew(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); tier smallint; price int; got smallint; card jsonb;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  if coalesce(array_length(p_cards, 1), 0) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'cauldron_five'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards) and kind = 'track') <> 5 then raise exception 'not_owned'; end if;
  if (select count(distinct c.tier) from cards c where c.id = any(p_cards)) <> 1 then raise exception 'cauldron_same'; end if;
  select min(c.tier) into tier from cards c where c.id = any(p_cards);
  price := cauldron_price(tier);
  if price is null then raise exception 'cauldron_tier'; end if;
  if exists (select 1 from cards where id = any(p_cards) and (collector or grade is not null or holo)) then raise exception 'cauldron_special'; end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then raise exception 'card_listed'; end if;
  if (select pumpkins from profiles where id = uid for update) < price then raise exception 'not_enough_pumpkins'; end if;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  delete from cards where owner = uid and id = any(p_cards);
  update profiles set pumpkins = pumpkins - price where id = uid;
  got := tier + 1;
  card := make_track_card(uid, got, 'cauldron');
  return jsonb_build_object('success', true, 'tier', got, 'card', card, 'price', price);
end $$;
