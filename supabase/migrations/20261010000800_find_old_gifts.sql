-- Admin page: the offered cards packed before 20261010000600_gifted_cards.sql were not marked, so the GOD packs and the
-- artists given earlier were missing from the "Cartes offertes" list. They are found again from the admin log: the
-- first GOD pack a player opened after "prochain booster en GOD pack", and the card of the right kind and rarity in the
-- first booster opened after "… au prochain booster" (unless the gift was cancelled or changed in between).
-- And a booster that fails to fill (Deezer down…) now gives the gift back with the booster, instead of losing it.

-- GOD packs offered
with g as (
  select l.target, l.at,
    (select min(k.pulled_at) from cards k where k.owner = l.target and k.source = 'god' and k.pulled_at > l.at) t
  from admin_log l where l.action = 'god' and l.detail = 'prochain booster en GOD pack' and l.target is not null
)
update cards k set gifted = true from g
where g.t is not null and k.owner = g.target and k.source = 'god' and k.pulled_at = g.t and not k.gifted
  and not exists (select 1 from admin_log c where c.target = g.target and c.action = 'god' and c.at > g.at and c.at < g.t);

-- cards offered (tracks and artists)
with g as (
  select l.target, l.at,
    case when l.detail like 'artiste%' then 'artist' else 'track' end kind,
    case when l.detail ~ '(Diamant|Légendaire)' then 5 else 4 end tier,
    l.detail like '% Shiny %' shiny,
    (select min(k.pulled_at) from cards k where k.owner = l.target and k.source = 'booster' and k.pulled_at > l.at) t
  from admin_log l where l.action = 'gift' and l.detail like '% au prochain booster' and l.target is not null
)
update cards set gifted = true where id in (
  select (select k.id from cards k where k.owner = g.target and k.pulled_at = g.t and k.kind = g.kind and k.tier = g.tier
          order by k.holo = g.shiny desc limit 1)
  from g where g.t is not null
    and not exists (select 1 from admin_log c where c.target = g.target and c.action = 'gift' and c.at > g.at and c.at < g.t));

-- a booster abandoned because it could not be filled gives its gift back
create or replace function public.abandon_pack(p_pack uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs;
begin
  delete from packs where id = p_pack and owner = uid and not done returning * into pk;
  if pk.id is null then return; end if;
  if pk.kind = 'genre' then
    perform add_streams(uid, (select genre_pack_price from settings), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = least(10, stock + 1) where id = uid;
  end if;
  if pk.gift_god then insert into forced_gods (id) values (uid) on conflict (id) do nothing; end if;
  if pk.gift_slot is not null then
    insert into forced_cards (id, kind, tier, shiny)
    values (uid, case when pk.artist_slots[pk.gift_slot] then 'artist' else 'track' end, pk.slots[pk.gift_slot], pk.shiny_slot is not null)
    on conflict (id) do nothing;
  end if;
end $$;
