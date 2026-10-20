-- Admin page: "offer a Platine or Diamant artist" to one player. The last card of that player's next booster is an
-- artist slot of that certification (the browser finds such an artist, the server checks its fans on Deezer), with the
-- signed-sleeve animation and the Discord announcement. start_pack() is the one from 20261010000300_force_god.sql, plus
-- the gift. A GOD pack waiting comes first; the artist then comes with the booster after.
create table public.forced_artists (
  id uuid primary key references public.profiles on delete cascade,
  tier smallint not null check (tier in (4, 5)),
  by uuid references public.profiles on delete set null,
  at timestamptz not null default now()
);
alter table public.forced_artists enable row level security;

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int; gift smallint;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  delete from packs where owner = uid and not done and created_at < now() - interval '15 minutes';
  if (select count(*) from packs where owner = uid and not done) >= 3 then raise exception 'too_many_open_packs'; end if;

  if p_kind = 'genre' then
    if p.streams < s.genre_pack_price then raise exception 'not_enough_streams'; end if;
    perform add_streams(uid, -s.genre_pack_price, 'achat d''un pack de la Boutique');
  end if;

  p := refill_stock(p);
  if not s.test_mode and p_kind = 'booster' then
    if p.stock <= 0 then raise exception 'no_stock'; end if;
    if p.stock >= 10 then p.stock_at := now(); end if;
    p.stock := p.stock - 1;
  end if;
  update profiles set stock = p.stock, stock_at = p.stock_at where id = uid;

  god := p_kind = 'booster' and random() < s.god_chance;
  -- a GOD pack offered by an admin: this booster is it (the gift is used up)
  if p_kind = 'booster' then
    delete from forced_gods where id = uid;
    if found then god := true; end if;
  end if;
  if god then
    slots := array[5]::smallint[];
    for i in 1..4 loop slots := slots || (case when random() < .5 then 4 else 5 end)::smallint; end loop;
    arts := array[false, false, false, false, false];
  else
    for i in 1..5 loop
      slots := slots || roll_tier();
      arts := arts || (p_kind = 'booster' and random() < 0.02);   -- 1 card in 50 is an artist
    end loop;
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.02 / 0.30 then 5 else 4 end;
      arts[1] := false;
    end if;
  end if;

  -- a certified artist offered by an admin: the last card of this booster is one (the gift is used up)
  if not god and p_kind = 'booster' then
    delete from forced_artists where id = uid returning tier into gift;
    if gift is not null then slots[5] := gift; arts[5] := true; end if;
  end if;

  insert into packs (owner, kind, genre, slots, god, artist_slots) values (uid, p_kind, p_genre, slots, god, arts) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

-- p_tier: 4 = Platine, 5 = Diamant, null or 0 = cancel
create function public.admin_gift_artist(p_user uuid, p_tier int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if coalesce(p_tier, 0) = 0 then
    delete from forced_artists where id = p_user;
    perform admin_log_add(me, p_user, 'gift', 'artiste annulé');
  elsif p_tier in (4, 5) then
    insert into forced_artists (id, tier, by) values (p_user, p_tier, me) on conflict (id) do update set tier = excluded.tier, by = me, at = now();
    perform admin_log_add(me, p_user, 'gift', case when p_tier = 5 then 'artiste Diamant' else 'artiste Platine' end || ' au prochain booster');
  else raise exception 'bad_amount'; end if;
end $$;

-- the gifts waiting for one player
create function public.admin_gifts(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return jsonb_build_object('god', exists (select 1 from forced_gods where id = p_user),
    'artist', (select tier from forced_artists where id = p_user));
end $$;

revoke execute on function public.admin_gift_artist(uuid, int), public.admin_gifts(uuid) from public, anon;
grant execute on function public.admin_gift_artist(uuid, int), public.admin_gifts(uuid) to authenticated;
