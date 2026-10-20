-- Admin page: "next booster is a GOD pack" for one player. The next booster that player opens on the site is a GOD
-- pack, with the full animation and the Discord announcement. start_pack() is the one from 20261005000700_artist_cards.sql,
-- with the gift checked right after the GOD roll.
create table public.forced_gods (
  id uuid primary key references public.profiles on delete cascade,
  by uuid references public.profiles on delete set null,
  at timestamptz not null default now()
);
alter table public.forced_gods enable row level security;

create or replace function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; arts boolean[] := '{}'; god boolean := false; pack_id uuid; i int;
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

  insert into packs (owner, kind, genre, slots, god, artist_slots) values (uid, p_kind, p_genre, slots, god, arts) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', god);
end $$;

create function public.admin_force_god(p_user uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if p_on then insert into forced_gods (id, by) values (p_user, me) on conflict (id) do update set by = me, at = now();
  else delete from forced_gods where id = p_user; end if;
  perform admin_log_add(me, p_user, 'god', case when p_on then 'prochain booster en GOD pack' else 'GOD pack annulé' end);
end $$;

-- the admin page shows whether a GOD pack is waiting
create function public.admin_god_pending(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return exists (select 1 from forced_gods where id = p_user);
end $$;

revoke execute on function public.admin_force_god(uuid, boolean), public.admin_god_pending(uuid) from public, anon;
grant execute on function public.admin_force_god(uuid, boolean), public.admin_god_pending(uuid) to authenticated;
