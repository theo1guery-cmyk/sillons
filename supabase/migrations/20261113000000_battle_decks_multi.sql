-- Several decks: up to 5, each with its name, its 5 cards and its Tête d'affiche. One of them defends (it is copied
-- into battle_decks, which the defense has always used); before each battle I choose the one I attack with.
-- My current deck becomes the deck 1, the one that defends.

create table if not exists public.battle_deck_slots (
  owner uuid not null references public.profiles on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  name text not null default 'Mon deck',
  cards uuid[] not null,
  artist uuid references public.cards on delete set null,
  updated_at timestamptz not null default now(),
  primary key (owner, slot)
);
alter table public.battle_deck_slots enable row level security;
alter table public.battle_decks add column if not exists def_slot smallint;

insert into public.battle_deck_slots (owner, slot, name, cards, artist)
select owner, 1, 'Mon deck', cards, artist from public.battle_decks where cardinality(cards) = 5
on conflict do nothing;
update public.battle_decks set def_slot = 1 where cardinality(cards) = 5 and def_slot is null;

-- the cards of a deck I attack with: one of my decks (still all mine, 5 different tracks), else my defense deck
create or replace function public.battle_slot_deck(p_user uuid, p_slot smallint) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare d uuid[];
begin
  if p_slot is null then return battle_deck_of(p_user); end if;
  select cards into d from battle_deck_slots where owner = p_user and slot = p_slot;
  if d is null or cardinality(d) <> 5 or (select count(distinct track_id) from cards where owner = p_user and kind = 'track' and id = any(d)) <> 5 then
    raise exception 'battle_deck_invalid';
  end if;
  return d;
end $$;

-- the Tête d'affiche of a deck: the one of the deck it is (if it is one of mine), else the one chosen, else the best
create or replace function public.battle_headliner(p_user uuid, p_deck uuid[]) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.id from battle_deck_slots s join cards c on c.id = s.artist and c.owner = p_user and c.kind = 'artist' where s.owner = p_user and s.cards = p_deck limit 1),
    (select c.id from battle_decks d join cards c on c.id = d.artist and c.owner = p_user and c.kind = 'artist' where d.owner = p_user and (d.cards = p_deck or cardinality(d.cards) <> 5)),
    (select c.id from cards c where c.owner = p_user and c.kind = 'artist'
     order by (select count(*) from cards k join tracks t on t.id = k.track_id where k.id = any(p_deck) and t.artist_id = c.artist_id) desc,
              c.tier desc, c.collector desc, c.holo desc limit 1))
$$;

-- my decks, with their cards as they fight
create or replace function public.battle_decks_list() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slot', s.slot, 'name', s.name, 'deck', coalesce(battle_vals(s.cards), '[]'),
    'artist', battle_headliner_json(battle_headliner(s.owner, s.cards)), 'artist_id', s.artist,
    'defense', s.slot is not distinct from (select def_slot from battle_decks where owner = s.owner),
    'ok', (select count(distinct track_id) from cards where owner = s.owner and kind = 'track' and id = any(s.cards)) = 5) order by s.slot), '[]')
  from battle_deck_slots s where s.owner = auth.uid()
$$;

create or replace function public.save_battle_deck(p_slot smallint, p_name text, p_cards uuid[], p_artist uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); n text := left(btrim(coalesce(p_name, '')), 24);
begin
  if p_slot is null or p_slot < 1 or p_slot > 5 then raise exception 'battle_deck_slot'; end if;
  if cardinality(p_cards) <> 5 or (select count(distinct x) from unnest(p_cards) x) <> 5 then raise exception 'battle_five'; end if;
  if (select count(*) from cards where owner = uid and kind = 'track' and id = any(p_cards)) <> 5 then raise exception 'not_owned'; end if;
  if (select count(distinct track_id) from cards where id = any(p_cards)) <> 5 then raise exception 'battle_same_track'; end if;
  if p_artist is not null and not exists (select 1 from cards where id = p_artist and owner = uid and kind = 'artist') then raise exception 'not_owned'; end if;
  insert into battle_deck_slots (owner, slot, name, cards, artist) values (uid, p_slot, coalesce(nullif(n, ''), 'Deck ' || p_slot), p_cards, p_artist)
  on conflict (owner, slot) do update set name = excluded.name, cards = excluded.cards, artist = excluded.artist, updated_at = now();
  -- the first deck defends; the defense deck stays up to date
  insert into battle_decks (owner, cards, artist, def_slot) values (uid, p_cards, p_artist, p_slot)
  on conflict (owner) do update set cards = case when battle_decks.def_slot is null or battle_decks.def_slot = p_slot then excluded.cards else battle_decks.cards end,
    artist = case when battle_decks.def_slot is null or battle_decks.def_slot = p_slot then excluded.artist else battle_decks.artist end,
    def_slot = coalesce(battle_decks.def_slot, p_slot);
end $$;

create or replace function public.set_defense_deck(p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s battle_deck_slots;
begin
  select * into s from battle_deck_slots where owner = uid and slot = p_slot;
  if s.owner is null then raise exception 'battle_deck_invalid'; end if;
  insert into battle_decks (owner, cards, artist, def_slot) values (uid, s.cards, s.artist, p_slot)
  on conflict (owner) do update set cards = excluded.cards, artist = excluded.artist, def_slot = excluded.def_slot;
end $$;

create or replace function public.delete_battle_deck(p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if (select def_slot from battle_decks where owner = uid) = p_slot then raise exception 'battle_deck_defense'; end if;
  delete from battle_deck_slots where owner = uid and slot = p_slot;
end $$;

drop function if exists public.battle_start(uuid);
drop function if exists public.battle_invite(uuid);
drop function if exists public.battle_answer(uuid, boolean);
drop function if exists public.battle_revenge(uuid);
create or replace function public.battle_start(p_friend uuid default null, p_deck smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); me_p profiles; opp uuid; ad uuid[]; dd uuid[]; b battles; w int := 150;
begin
  select * into me_p from profiles where id = uid for update;
  update battles set status = 'done', winner = defender, finished_at = now(), a_delta = 0, d_delta = 0
  where attacker = uid and status = 'playing' and mode <> 'live' and created_at < now() - interval '10 minutes';      -- a battle left behind is lost, without trophies
  select * into b from battles where attacker = uid and status = 'playing' and mode <> 'live' order by created_at desc limit 1;
  if b.id is not null then return battle_view(b, uid); end if;
  ad := battle_slot_deck(uid, p_deck);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  if p_friend is not null then
    if friend_state(uid, p_friend) <> 'friends' then raise exception 'not_friends'; end if;
    opp := p_friend;
  else
    -- an opponent: active lately, of about my trophies, not the same as my last 3 battles
    loop
      select pr.id into opp from profiles pr join presence pe on pe.id = pr.id
      where pr.id <> uid and pe.seen_at > now() - interval '14 days' and abs(pr.trophies - me_p.trophies) <= w
        and pr.id not in (select defender from battles where attacker = uid and defender is not null order by created_at desc limit 3)
        and (select count(distinct track_id) from cards where owner = pr.id and kind = 'track') >= 5
      order by random() limit 1;
      exit when opp is not null or w > 5000;
      w := w * 2;
    end loop;
    if opp is null then raise exception 'battle_no_opponent'; end if;
  end if;
  dd := battle_deck_of(opp);
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  insert into battles (attacker, defender, mode, a_cards, d_cards, a_vals, d_vals, stats)
  values (uid, opp, case when p_friend is null then 'ranked' else 'friend' end, ad, dd, battle_vals(ad), battle_vals(dd), battle_stats())
  returning * into b;
  return battle_view(b, uid);
end $$;

create or replace function public.battle_invite(p_friend uuid, p_deck smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ad uuid[]; b battles;
begin
  if friend_state(uid, p_friend) <> 'friends' then raise exception 'not_friends'; end if;
  ad := battle_slot_deck(uid, p_deck);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  update battles set status = 'expired' where attacker = uid and status = 'invite';
  insert into battles (attacker, defender, mode, status, a_cards, d_cards, a_vals, d_vals, stats)
  values (uid, p_friend, 'live', 'invite', ad, '{}', battle_vals(ad), '[]', battle_stats()) returning * into b;
  return battle_view(b, uid);
end $$;

create or replace function public.battle_answer(p_battle uuid, p_accept boolean, p_deck smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); b battles; dd uuid[];
begin
  select * into b from battles where id = p_battle and defender = uid and mode = 'live' for update;
  if b.id is null then raise exception 'battle_not_found'; end if;
  if b.status <> 'invite' or b.created_at < now() - interval '2 minutes' then raise exception 'battle_invite_gone'; end if;
  if not p_accept then update battles set status = 'declined', finished_at = now() where id = b.id; return null; end if;
  dd := battle_slot_deck(uid, p_deck);
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_need_five'; end if;
  update battles set status = 'playing', d_cards = dd, d_vals = battle_vals(dd), round_at = now() where id = b.id returning * into b;
  return battle_view(b, uid);
end $$;

create or replace function public.battle_revenge(p_battle uuid, p_deck smallint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); o battles; b battles; ad uuid[]; dd uuid[];
begin
  select * into b from battles where attacker = uid and status = 'playing' and mode <> 'live' order by created_at desc limit 1;
  if b.id is not null then return battle_view(b, uid); end if;
  select * into o from battles where id = p_battle and defender = uid and mode = 'ranked' and status = 'done' for update;
  if o.id is null or o.winner is distinct from o.attacker then raise exception 'battle_not_found'; end if;
  if not revenge_ok(o.id, uid) then
    if o.revenged or o.revenge_of is not null or o.finished_at < now() - interval '24 hours' then raise exception 'revenge_gone'; end if;
    if exists (select 1 from battles r where r.attacker = uid and r.defender = o.attacker and r.revenge_of is not null and r.created_at > now() - interval '24 hours') then raise exception 'revenge_same'; end if;
    raise exception 'revenge_limit';
  end if;
  ad := battle_slot_deck(uid, p_deck); dd := battle_deck_of(o.attacker);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  update battles set revenged = true where id = o.id;
  insert into battles (attacker, defender, mode, a_cards, d_cards, a_vals, d_vals, stats, revenge_of)
  values (uid, o.attacker, 'ranked', ad, dd, battle_vals(ad), battle_vals(dd), battle_stats(), o.id) returning * into b;
  return battle_view(b, uid) || jsonb_build_object('revenge', true);
end $$;

revoke execute on function public.battle_slot_deck(uuid, smallint) from public, anon, authenticated;
revoke execute on function public.battle_decks_list(), public.save_battle_deck(smallint, text, uuid[], uuid), public.set_defense_deck(smallint), public.delete_battle_deck(smallint),
  public.battle_start(uuid, smallint), public.battle_invite(uuid, smallint), public.battle_answer(uuid, boolean, smallint), public.battle_revenge(uuid, smallint) from public, anon;
grant execute on function public.battle_decks_list(), public.save_battle_deck(smallint, text, uuid[], uuid), public.set_defense_deck(smallint), public.delete_battle_deck(smallint),
  public.battle_start(uuid, smallint), public.battle_invite(uuid, smallint), public.battle_answer(uuid, boolean, smallint), public.battle_revenge(uuid, smallint) to authenticated;
