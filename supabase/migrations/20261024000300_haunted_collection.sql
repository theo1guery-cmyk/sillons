-- Halloween: the "Collection Hantée". 13 sounds, each printed in a few numbered copies only (Thriller is a 1/1), with
-- one card design for all (no rarity). They come out of boosters during the event, with a chance the server paces so
-- that every copy is out by the end (2 November, midnight in Paris): fewer copies left or more time left → lower
-- chance; behind schedule → higher. Thriller has a lower weight, so it tends to come later, but can come any time.
-- The Pack Hanté (100 🎃 at the witch's): 5 cards Rare or better and 20 times the chance. More pumpkins too: new
-- quests, and pumpkins found in boosters.

create table if not exists public.haunted_meta (
  id int primary key default 1 check (id = 1),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default '2026-11-02 00:00 Europe/Paris',
  rate real, rate_at timestamptz                               -- boosters opened per hour, recomputed every 10 minutes
);
alter table public.haunted_meta enable row level security;
insert into public.haunted_meta (id) values (1) on conflict do nothing;

create table if not exists public.haunted_editions (
  slot smallint primary key,
  query text not null,                                          -- the Deezer search that finds it
  title text not null, artist text not null,
  copies smallint not null,                                     -- how many exist (10, or 1 for Thriller)
  weight real not null default 1,                               -- lower: comes out less often
  track_id bigint, cover text, preview text
);
alter table public.haunted_editions enable row level security;
insert into public.haunted_editions (slot, query, title, artist, copies, weight) values
  (1, 'artist:"Michael Jackson" track:"Thriller"', 'Thriller', 'Michael Jackson', 1, .3),
  (2, 'artist:"Ray Parker Jr." track:"Ghostbusters"', 'Ghostbusters', 'Ray Parker Jr.', 10, 1),
  (3, 'artist:"Rihanna" track:"Disturbia"', 'Disturbia', 'Rihanna', 10, 1),
  (4, 'artist:"Rockwell" track:"Somebody''s Watching Me"', 'Somebody''s Watching Me', 'Rockwell', 10, 1),
  (5, 'artist:"Kanye West" track:"Monster"', 'Monster', 'Kanye West', 10, 1),
  (6, 'artist:"Eminem" track:"Godzilla"', 'Godzilla', 'Eminem', 10, 1),
  (7, 'artist:"Billie Eilish" track:"bury a friend"', 'bury a friend', 'Billie Eilish', 10, 1),
  (8, 'artist:"Lady Gaga" track:"Bloody Mary"', 'Bloody Mary', 'Lady Gaga', 10, 1),
  (9, 'artist:"AC/DC" track:"Highway to Hell"', 'Highway to Hell', 'AC/DC', 10, 1),
  (10, 'artist:"The Cranberries" track:"Zombie"', 'Zombie', 'The Cranberries', 10, 1),
  (11, 'artist:"Bobby Boris Pickett" track:"Monster Mash"', 'Monster Mash', 'Bobby "Boris" Pickett', 10, 1),
  (12, 'artist:"Andrew Gold" track:"Spooky, Scary Skeletons"', 'Spooky, Scary Skeletons', 'Andrew Gold', 10, 1),
  (13, 'artist:"Tame Impala" track:"Dracula"', 'Dracula', 'Tame Impala', 10, 1)
on conflict (slot) do nothing;

create table if not exists public.haunted_cards (
  id uuid primary key default gen_random_uuid(),
  slot smallint not null references public.haunted_editions,
  no smallint not null,
  owner uuid references public.profiles on delete set null,
  source text not null default 'booster',                       -- 'booster', 'pack' (Pack Hanté), 'admin'
  pulled_at timestamptz not null default now(),
  unique (slot, no)
);
create index if not exists haunted_cards_owner_idx on public.haunted_cards (owner);
alter table public.haunted_cards enable row level security;

alter table public.packs add column if not exists haunted boolean not null default false;     -- a Pack Hanté
alter table public.packs add column if not exists haunted_rolled boolean not null default false;

-- finds each sound on Deezer (title, sleeve, preview); run again by haunted_collection() while one is missing
create or replace function public.haunted_resolve() returns void
language plpgsql security definer set search_path = public as $$
declare e record; j jsonb; t jsonb;
begin
  for e in select * from haunted_editions where track_id is null order by slot loop
    begin
      j := deezer('search?limit=10&q=' || replace(replace(replace(e.query, ' ', '%20'), '"', '%22'), '&', '%26'));
      select x into t from jsonb_array_elements(coalesce(j -> 'data', '[]')) x
      order by (lower(x ->> 'title') = lower(e.title)) desc, (x ->> 'rank')::int desc limit 1;
      if t is not null then
        update haunted_editions set track_id = (t ->> 'id')::bigint,
          cover = replace(coalesce(t -> 'album' ->> 'cover_xl', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
          preview = t ->> 'preview'
        where slot = e.slot;
      end if;
    exception when others then null;
    end;
  end loop;
end $$;

-- the chance that a booster holds a copy right now
create or replace function public.haunted_chance() returns double precision
language plpgsql security definer set search_path = public as $$
declare m haunted_meta; left_n int; hours double precision; today bigint; yday bigint; since double precision;
begin
  select * into m from haunted_meta where id = 1;
  if not halloween_on() or now() >= m.ends_at then return 0; end if;
  select coalesce(sum(e.copies), 0) - (select count(*) from haunted_cards) into left_n from haunted_editions e;
  if left_n <= 0 then return 0; end if;
  if m.rate is null or m.rate_at < now() - interval '10 minutes' then
    since := greatest(1, extract(epoch from now() - (game_day()::timestamp at time zone 'Europe/Paris')) / 3600);
    select coalesce(sum(n), 0) into today from daily_counters where day = game_day() and metric = 'packs';
    select coalesce(sum(n), 0) into yday from daily_counters where day = game_day() - 1 and metric = 'packs';
    m.rate := greatest(today / since, yday / 24.0, 1);
    update haunted_meta set rate = m.rate, rate_at = now() where id = 1;
  end if;
  hours := greatest(extract(epoch from m.ends_at - now()) / 3600, .05);
  return least(.5, left_n / greatest(m.rate * hours, 1));
end $$;

-- after a booster is drawn: maybe a haunted copy, maybe a few pumpkins (once per booster)
create or replace function public.haunted_roll(p_pack uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs; ch double precision; e haunted_editions; n int; card_id uuid; pk_gain int := 0; who text;
begin
  select * into pk from packs where id = p_pack and owner = uid and done and not haunted_rolled for update;
  if pk.id is null or not halloween_on() then return null; end if;
  update packs set haunted_rolled = true where id = pk.id;
  -- pumpkins hidden in the booster: 1 in 3, 2 to 4
  if random() < .33 then
    pk_gain := 2 + floor(random() * 3)::int;
    update profiles set pumpkins = pumpkins + pk_gain where id = uid;
  end if;
  ch := haunted_chance() * case when pk.haunted then 20 else 1 end;
  if random() >= least(ch, 1) then return jsonb_build_object('pumpkins', pk_gain); end if;
  -- which sound: weighted by the share of its copies still to come out (and Thriller's lower weight)
  select x.* into e from haunted_editions x
  where x.track_id is not null and (select count(*) from haunted_cards h where h.slot = x.slot) < x.copies
  order by -ln(greatest(random(), 1e-9)) / (x.weight * (x.copies - (select count(*) from haunted_cards h where h.slot = x.slot))::real / x.copies)
  limit 1 for update;
  if e.slot is null then return jsonb_build_object('pumpkins', pk_gain); end if;
  select count(*) + 1 into n from haunted_cards where slot = e.slot;
  insert into haunted_cards (slot, no, owner, source) values (e.slot, n, uid, case when pk.haunted then 'pack' else 'booster' end)
  returning id into card_id;
  begin                                                          -- the news on the Discord (never breaks the booster)
    select pseudo into who from profiles where id = uid;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '🎃 **' || discord_esc(who) || '** a trouvé une carte de la **Collection Hantée** : **' || discord_esc(e.title) || '** — ' || discord_esc(e.artist)
                 || ' · N° ' || lpad(n::text, length(e.copies::text), '0') || '/' || e.copies || case when e.copies = 1 then ' 👑 (exemplaire unique !)' else '' end,
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('title', '🦇 Collection Hantée · ' || e.title, 'color', 16747050,
        'thumbnail', case when coalesce(e.cover, '') <> '' then jsonb_build_object('url', e.cover) end)))));
  exception when others then null;
  end;
  return jsonb_build_object('pumpkins', pk_gain, 'card', jsonb_build_object('id', card_id, 'slot', e.slot, 'no', n, 'of', e.copies,
    'title', e.title, 'artist', e.artist, 'cover', e.cover, 'preview', e.preview));
end $$;

-- the Pack Hanté: 100 pumpkins, 5 cards Rare or better, 20 times the chance of a haunted copy
create or replace function public.haunted_pack_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); slots smallint[] := '{}'; arts boolean[] := '{}'; i int; pack_id uuid;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  if (select count(*) from packs where owner = uid and not done and not parked) >= 3 then raise exception 'too_many_open_packs'; end if;
  if (select pumpkins from profiles where id = uid for update) < 100 then raise exception 'not_enough_pumpkins'; end if;
  update profiles set pumpkins = pumpkins - 100 where id = uid;
  for i in 1..5 loop slots := slots || greatest(roll_tier(), 2::smallint); arts := arts || false; end loop;
  insert into packs (owner, kind, genre, slots, god, artist_slots, paid_with, paid, haunted)
  values (uid, 'booster', null, slots, false, arts, 'pumpkins', 100, true) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', false);
end $$;

-- a Pack Hanté left open gives its pumpkins back and is never served again as an ordinary booster
create or replace function public.park_pack(pk packs) returns void
language plpgsql security definer set search_path = public as $$
begin
  if pk.haunted then
    update packs set parked = true, genre = -1 where id = pk.id;
    update profiles set pumpkins = pumpkins + coalesce(pk.paid, 100) where id = pk.owner;
    return;
  end if;
  update packs set parked = true where id = pk.id;
  if pk.kind = 'big' then
    null;                                             -- it stays parked and comes back as the next big booster
  elsif pk.kind = 'genre' and pk.paid_with = 'vinyls' then
    perform add_vinyls(pk.owner, pk.paid, 'remboursement d''un pack de la Boutique');
  elsif pk.kind = 'genre' then
    perform add_streams(pk.owner, coalesce(pk.paid, (select genre_pack_price from settings)), 'remboursement d''un pack de la Boutique');
  elsif not (select test_mode from settings) then
    update profiles set stock = stock + 1 where id = pk.owner;
  end if;
end $$;

-- the board: every sound, its copies still to come, who holds which number; and mine
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', h.owner = uid) order by h.no), '[]')
                   from haunted_cards h left join profiles p on p.id = h.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;

-- more ways to win pumpkins: new quests (and pumpkins found in boosters, in haunted_roll)
create or replace function public.halloween_quests(p_user uuid) returns table (key text, label text, progress int, goal int, reward int)
language sql stable security definer set search_path = public as $$
  with c as (select metric, n from daily_counters where owner = p_user and day = game_day())
  select * from (values
    ('visit', 'Rends visite à la sorcière', 1, 1, 5),
    ('open10', 'Ouvre 10 boosters', coalesce((select n from c where metric = 'packs'), 0), 10, 15),
    ('open30', 'Ouvre 30 boosters', coalesce((select n from c where metric = 'packs'), 0), 30, 20),
    ('open60', 'Ouvre 60 boosters', coalesce((select n from c where metric = 'packs'), 0), 60, 25),
    ('epic', 'Tire une Épique ou mieux', coalesce((select n from c where metric = 'tier3'), 0), 1, 10),
    ('dailies', 'Réussis tes 3 défis du jour', (select count(*)::int from daily_claims k where k.owner = p_user and k.day = game_day()), 3, 15),
    ('discard', 'Défausse 20 cartes', coalesce((select n from c where metric = 'discards'), 0), 20, 10),
    ('market', 'Achète une carte au marché', coalesce((select n from c where metric = 'buys'), 0), 1, 10),
    ('duel', 'Gagne un clash blind test', coalesce((select n from c where metric = 'duel_rewards'), 0), 1, 10)) q(key, label, progress, goal, reward)
$$;

-- admins: give a copy of a sound to a player (the next number), e.g. for a contest
create or replace function public.admin_haunted_give(p_user uuid, p_slot smallint) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); e haunted_editions; n int;
begin
  select * into e from haunted_editions where slot = p_slot for update;
  if e.slot is null then raise exception 'bad_pack'; end if;
  select count(*) + 1 into n from haunted_cards where slot = e.slot;
  if n > e.copies then raise exception 'haunted_sold_out'; end if;
  insert into haunted_cards (slot, no, owner, source) values (e.slot, n, p_user, 'admin');
  perform admin_log_add(me, p_user, 'haunted', e.title || ' N° ' || n || '/' || e.copies);
  return n;
end $$;

revoke execute on function public.haunted_resolve(), public.haunted_chance() from public, anon, authenticated;
revoke execute on function public.haunted_roll(uuid), public.haunted_pack_start(), public.haunted_collection(), public.admin_haunted_give(uuid, smallint) from public, anon;
grant execute on function public.haunted_roll(uuid), public.haunted_pack_start(), public.haunted_collection(), public.admin_haunted_give(uuid, smallint) to authenticated;

select public.haunted_resolve();
