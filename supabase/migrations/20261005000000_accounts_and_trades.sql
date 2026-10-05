-- Sillons TCG: accounts, server-verified boosters, collections and trades.
-- Players never write tables directly: every change goes through the security-definer
-- functions below, which check ownership, rarity and trade rules on the server.

create extension if not exists http with schema extensions;

-- ---------------------------------------------------------------- settings
create table public.settings (
  id int primary key default 1 check (id = 1),
  test_mode boolean not null default true,          -- unlimited boosters while testing
  god_chance double precision not null default 1.0 / 3000,
  pity int not null default 70,
  trade_min_age interval not null default interval '48 hours',
  max_pending_offers int not null default 20
);
insert into public.settings default values;

-- ---------------------------------------------------------------- rarity + genre (same rules as app.js)
create function public.tier_of(r int) returns smallint language sql immutable as $$
  select case when r >= 950000 then 5 when r >= 850000 then 4 when r >= 700000 then 3
              when r >= 450000 then 2 when r >= 250000 then 1 else 0 end::smallint
$$;

create function public.type_of_genre(gid int) returns smallint language sql immutable as $$
  select case
    when gid = 116 then 0                      -- Rap
    when gid = 132 then 1                      -- Pop
    when gid in (152, 85, 464) then 2          -- Rock
    when gid in (106, 113) then 3              -- Électro
    when gid in (165, 169) then 4              -- Soul / R&B
    when gid = 52 then 5                       -- Chanson
    when gid in (129, 153) then 6              -- Jazz / Blues
    when gid in (197, 122, 75) then 7          -- Latino
    when gid in (2, 144) then 8                -- Afro / Reggae
    when gid in (98, 173) then 9               -- Classique / BO
    else 10 end::smallint                      -- Inclassable
$$;

-- ---------------------------------------------------------------- players
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  pseudo text not null check (pseudo ~ '^[A-Za-z0-9_.-]{3,20}$'),
  created_at timestamptz not null default now(),
  opened int not null default 0,
  dry int not null default 0,                   -- boosters since the last Mythique or better
  gods int not null default 0,
  stock int not null default 10,
  stock_at timestamptz not null default now(),
  imported boolean not null default false
);
create unique index profiles_pseudo_key on public.profiles (lower(pseudo));

-- a profile is created with the account; the pseudo comes from the sign-up form
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, pseudo) values (new.id, new.raw_user_meta_data ->> 'pseudo');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.pseudo_available(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select p ~ '^[A-Za-z0-9_.-]{3,20}$' and not exists (select 1 from profiles where lower(pseudo) = lower(p))
$$;

-- ---------------------------------------------------------------- cards
create table public.tracks (                   -- Deezer metadata, written by the server only
  id bigint primary key,
  title text not null,
  artist text not null,
  album text not null default '',
  cover text not null default '',
  duration int not null default 0,
  bpm int not null default 0,
  year int not null default 0,
  explicit boolean not null default false,
  genre smallint not null default 10,
  updated_at timestamptz not null default now()
);

create table public.cards (                    -- one row per copy, so a trade moves one exact copy
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade,
  track_id bigint not null references public.tracks,
  tier smallint not null check (tier between 0 and 5),
  rank int not null default 0,
  holo boolean not null default false,
  tradeable boolean not null default true,      -- false for collections imported from before accounts
  source text not null default 'booster',
  pulled_at timestamptz not null default now()
);
create index cards_owner_idx on public.cards (owner, track_id);

create table public.packs (                    -- rarities rolled by the server, waiting for tracks
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('booster', 'genre')),
  genre smallint,
  slots smallint[] not null,
  god boolean not null default false,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- trades
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles on delete cascade,
  to_user uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index offers_to_idx on public.offers (to_user, status);
create index offers_from_idx on public.offers (from_user, status);

create table public.offer_items (
  offer_id uuid not null references public.offers on delete cascade,
  card_id uuid not null references public.cards on delete cascade,
  side text not null check (side in ('give', 'take')),   -- give: from_user's card, take: to_user's card
  primary key (offer_id, card_id)
);
create index offer_items_card_idx on public.offer_items (card_id);

-- ---------------------------------------------------------------- read access (writes only via functions)
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.cards enable row level security;
alter table public.packs enable row level security;
alter table public.offers enable row level security;
alter table public.offer_items enable row level security;

create policy "settings are public" on public.settings for select using (true);
create policy "profiles are visible to players" on public.profiles for select to authenticated using (true);
create policy "tracks are public" on public.tracks for select using (true);
create policy "collections are visible to players" on public.cards for select to authenticated using (true);
create policy "own packs" on public.packs for select to authenticated using (owner = auth.uid());
create policy "own offers" on public.offers for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy "items of own offers" on public.offer_items for select to authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id and (o.from_user = auth.uid() or o.to_user = auth.uid())));

revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------- helpers
create function public.require_user() returns uuid language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  return uid;
end $$;

-- Deezer call from the database, retried when Deezer asks to slow down (error code 4)
create function public.deezer(path text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j jsonb; tries int := 0;
begin
  loop
    select content::jsonb into j from extensions.http_get('https://api.deezer.com/' || path);
    exit when j ->> 'error' is null or (j -> 'error' ->> 'code') <> '4' or tries >= 3;
    tries := tries + 1;
    perform pg_sleep(1.2 * tries);
  end loop;
  return j;
end $$;
revoke execute on function public.deezer(text) from public, anon, authenticated;

create function public.roll_tier() returns smallint language plpgsql volatile as $$
declare r double precision := random() * 100;
begin
  if r < 70 then return 0; end if;
  if r < 91 then return 1; end if;
  if r < 98 then return 2; end if;
  if r < 99.7 then return 3; end if;
  if r < 99.98 then return 4; end if;
  return 5;
end $$;

-- the refill rule of the booster stock (one every 30 min, up to 10)
create function public.refill_stock(p public.profiles) returns public.profiles language plpgsql as $$
declare gained int;
begin
  if p.stock >= 10 then p.stock_at := now(); return p; end if;
  gained := floor(extract(epoch from now() - p.stock_at) / 1800);
  if gained > 0 then
    p.stock := least(10, p.stock + gained);
    p.stock_at := case when p.stock >= 10 then now() else p.stock_at + gained * interval '30 minutes' end;
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------- boosters
-- 1. the server rolls the five rarities (and the GOD pack / pity)
create function public.start_pack(p_kind text default 'booster', p_genre int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  s settings; p profiles; slots smallint[] := '{}'; god boolean := false; pack_id uuid; i int;
begin
  select * into s from settings;
  select * into p from profiles where id = uid for update;
  if p.id is null then raise exception 'no_profile'; end if;
  if p_kind not in ('booster', 'genre') or (p_kind = 'genre' and (p_genre is null or p_genre not between 0 and 9)) then
    raise exception 'bad_pack';
  end if;
  delete from packs where owner = uid and not done and created_at < now() - interval '15 minutes';
  if (select count(*) from packs where owner = uid and not done) >= 3 then raise exception 'too_many_open_packs'; end if;

  p := refill_stock(p);
  if not s.test_mode and p_kind = 'booster' then
    if p.stock <= 0 then raise exception 'no_stock'; end if;
    if p.stock >= 10 then p.stock_at := now(); end if;
    p.stock := p.stock - 1;
  end if;
  update profiles set stock = p.stock, stock_at = p.stock_at where id = uid;

  god := p_kind = 'booster' and random() < s.god_chance;
  if god then
    slots := array[5]::smallint[];
    for i in 1..4 loop slots := slots || (case when random() < .5 then 4 else 5 end)::smallint; end loop;
  else
    for i in 1..5 loop slots := slots || roll_tier(); end loop;
    if p.dry + 1 >= s.pity and (select max(x) from unnest(slots) x) < 4 then
      slots[1] := case when random() < 0.02 / 0.30 then 5 else 4 end;
    end if;
  end if;

  insert into packs (owner, kind, genre, slots, god) values (uid, p_kind, p_genre, slots, god) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'god', god);
end $$;

-- 2. the player's browser found five tracks; the server checks each one on Deezer and keeps
--    the rarity at or below what it rolled, so a card can never be rarer than its draw
create function public.finish_pack(p_pack uuid, p_tracks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_user();
  pk packs; i int; t jsonb; a jsonb; r int; tier smallint; holo boolean;
  out jsonb := '[]'; card_id uuid; was_owned boolean; top smallint := 0;
begin
  select * into pk from packs where id = p_pack and owner = uid and not done for update;
  if pk.id is null then raise exception 'pack_not_found'; end if;
  if coalesce(array_length(p_tracks, 1), 0) <> 5 or (select count(distinct x) from unnest(p_tracks) x) <> 5 then
    raise exception 'need_five_tracks';
  end if;

  for i in 1..5 loop
    t := deezer('track/' || p_tracks[i]);
    if t ->> 'error' is not null or t ->> 'id' is null then raise exception 'track_not_found %', p_tracks[i]; end if;
    a := deezer('album/' || (t -> 'album' ->> 'id'));
    r := coalesce((t ->> 'rank')::int, 0);
    tier := least(tier_of(r), pk.slots[i]);
    top := greatest(top, tier);
    holo := random() < 0.04;

    insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, updated_at)
    values ((t ->> 'id')::bigint,
            coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'),
            coalesce(t -> 'artist' ->> 'name', '?'),
            coalesce(t -> 'album' ->> 'title', ''),
            replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
            coalesce((t ->> 'duration')::int, 0),
            coalesce(round((t ->> 'bpm')::numeric)::int, 0),
            coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
            coalesce((t ->> 'explicit_lyrics')::boolean, false),
            type_of_genre(coalesce((a ->> 'genre_id')::int, -1)),
            now())
    on conflict (id) do update set title = excluded.title, artist = excluded.artist, album = excluded.album,
      cover = excluded.cover, duration = excluded.duration, bpm = excluded.bpm, year = excluded.year,
      explicit = excluded.explicit, genre = excluded.genre, updated_at = now();

    was_owned := exists (select 1 from cards where owner = uid and track_id = p_tracks[i]);
    insert into cards (owner, track_id, tier, rank, holo, source)
    values (uid, p_tracks[i], tier, r, holo, case when pk.god then 'god' else pk.kind end)
    returning id into card_id;
    out := out || jsonb_build_object('card', card_id, 'track', p_tracks[i], 'tier', tier, 'rank', r,
                                     'holo', holo, 'new', not was_owned, 'wanted', pk.slots[i]);
  end loop;

  update packs set done = true where id = pk.id;
  update profiles set opened = opened + 1,
                      dry = case when top >= 4 then 0 else dry + 1 end,
                      gods = gods + case when pk.god then 1 else 0 end
  where id = uid;
  return out;
end $$;

-- ---------------------------------------------------------------- import of a pre-account collection (once)
create function public.import_collection(p_cards jsonb, p_opened int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c jsonb; n int; added int := 0; k int;
begin
  if (select imported from profiles where id = uid) then raise exception 'already_imported'; end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 20000 then raise exception 'bad_import'; end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre)
    values ((c ->> 'id')::bigint, left(coalesce(c ->> 't', '?'), 300), left(coalesce(c ->> 'a', '?'), 300),
            left(coalesce(c ->> 'al', ''), 300), left(coalesce(c ->> 'cov', ''), 500),
            coalesce((c ->> 'd')::int, 0), coalesce((c ->> 'bpm')::int, 0), coalesce((c ->> 'y')::int, 0),
            coalesce((c ->> 'x')::int, 0) = 1, least(greatest(coalesce((c ->> 'g')::int, 10), 0), 10))
    on conflict (id) do nothing;
    n := least(greatest(coalesce((c ->> 'n')::int, 1), 1), 50);
    for k in 1..n loop
      insert into cards (owner, track_id, tier, rank, holo, tradeable, source)
      values (uid, (c ->> 'id')::bigint, tier_of(coalesce((c ->> 'rank')::int, 0)), coalesce((c ->> 'rank')::int, 0),
              k <= coalesce((c ->> 'holo')::int, 0), false, 'import');
      added := added + 1;
    end loop;
  end loop;
  update profiles set imported = true, opened = opened + greatest(coalesce(p_opened, 0), 0) where id = uid;
  return added;
end $$;

-- ---------------------------------------------------------------- trades
-- trading needs a verified address and an account old enough (anti multi-account farming)
create function public.trade_wait(p_user uuid) returns interval
language sql stable security definer set search_path = public as $$
  select greatest(interval '0', (p.created_at + s.trade_min_age) - now())
  from profiles p, settings s where p.id = p_user
$$;

create function public.create_offer(p_to uuid, p_give uuid[], p_take uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s settings; offer uuid; c uuid;
begin
  select * into s from settings;
  if p_to = uid then raise exception 'self_trade'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'player_not_found'; end if;
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;
  if trade_wait(p_to) > interval '0' then raise exception 'target_too_new'; end if;
  if coalesce(array_length(p_give, 1), 0) not between 1 and 5 or coalesce(array_length(p_take, 1), 0) not between 1 and 5 then
    raise exception 'one_to_five_cards';
  end if;
  if (select count(*) from cards where id = any(p_give) and owner = uid and tradeable) <> array_length(p_give, 1) then
    raise exception 'give_not_owned';
  end if;
  if (select count(*) from cards where id = any(p_take) and owner = p_to and tradeable) <> array_length(p_take, 1) then
    raise exception 'take_not_owned';
  end if;
  if (select count(*) from offers where from_user = uid and status = 'pending') >= s.max_pending_offers then
    raise exception 'too_many_offers';
  end if;
  insert into offers (from_user, to_user) values (uid, p_to) returning id into offer;
  foreach c in array p_give loop insert into offer_items values (offer, c, 'give'); end loop;
  foreach c in array p_take loop insert into offer_items values (offer, c, 'take'); end loop;
  return offer;
end $$;

-- both sides change hands in one transaction, or nothing happens
create function public.accept_offer(p_offer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); o offers; ids uuid[];
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or o.to_user <> uid then raise exception 'offer_not_found'; end if;
  if o.status <> 'pending' then raise exception 'offer_closed'; end if;
  if trade_wait(uid) > interval '0' then raise exception 'account_too_new'; end if;

  select array_agg(card_id) into ids from offer_items where offer_id = o.id;
  perform 1 from cards where id = any(ids) for update;
  if exists (select 1 from offer_items i join cards c on c.id = i.card_id
             where i.offer_id = o.id and c.owner <> case i.side when 'give' then o.from_user else o.to_user end)
     or (select count(*) from cards where id = any(ids)) <> array_length(ids, 1) then
    update offers set status = 'expired', decided_at = now() where id = o.id;
    return 'cards_moved';                -- a copy left one of the two collections in the meantime
  end if;

  update cards c set owner = case i.side when 'give' then o.to_user else o.from_user end
  from offer_items i where i.offer_id = o.id and c.id = i.card_id;
  update offers set status = 'accepted', decided_at = now() where id = o.id;
  -- other offers that counted on these copies can no longer happen
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id <> o.id and id in (select offer_id from offer_items where card_id = any(ids));
  return 'accepted';
end $$;

create function public.refuse_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update offers set status = 'refused', decided_at = now() where id = p_offer and to_user = uid and status = 'pending';
  if not found then raise exception 'offer_not_found'; end if;
end $$;

create function public.cancel_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update offers set status = 'cancelled', decided_at = now() where id = p_offer and from_user = uid and status = 'pending';
  if not found then raise exception 'offer_not_found'; end if;
end $$;

-- ---------------------------------------------------------------- reset + account deletion
create function public.reset_collection() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update offers set status = 'cancelled', decided_at = now()
  where status = 'pending' and (from_user = uid or to_user = uid);
  delete from cards where owner = uid;
  delete from packs where owner = uid;
  update profiles set opened = 0, dry = 0, gods = 0, stock = 10, stock_at = now() where id = uid;
end $$;

create function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := require_user();
begin
  delete from auth.users where id = uid;   -- profile, cards, packs and offers follow by cascade
end $$;

-- a booster check calls Deezer ten times from the database: give requests more than the default 8 s
alter role authenticated set statement_timeout = '30s';

-- ---------------------------------------------------------------- who may call what
revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int) to anon, authenticated;
grant execute on function public.start_pack(text, int), public.finish_pack(uuid, bigint[]),
  public.import_collection(jsonb, int), public.trade_wait(uuid), public.create_offer(uuid, uuid[], uuid[]),
  public.accept_offer(uuid), public.refuse_offer(uuid), public.cancel_offer(uuid),
  public.reset_collection(), public.delete_account() to authenticated;
revoke execute on function public.deezer(text), public.roll_tier(), public.refill_stock(public.profiles),
  public.handle_new_user(), public.require_user() from authenticated;
