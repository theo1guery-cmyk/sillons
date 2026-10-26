-- Noël (1 to 25 December): the event 'noel', switched on by itself at midnight on 1 December and off at midnight on
-- the 26th (Paris), or from the admin page.
--  * flocons (❄): won with the quests of the day, found in boosters, behind the doors of the calendar, or bought;
--  * the Advent calendar: one door a day from 1 to 24 December, a missed door can be opened later, never one to come;
--    the presents grow day after day, door 24 is the biggest (and may hold a Carte Givrée);
--  * the Cartes Givrées: 12 Christmas sounds in limited edition (All I Want for Christmas Is You is a 1/1, the others
--    5 copies each), the third series of the limited editions. They come out of boosters from 1 to 25 December, paced
--    so that all of them are out by the 25th;
--  * the Pack de Noël: 100 flocons, 5 cards Rare or better, 20 times the chance of a Carte Givrée (barely more for
--    the 1/1);
--  * the snow storms: 3 a day at times nobody knows, between 10:00 and 23:00, 15 minutes each. During a storm the
--    Mythiques and Légendaires come twice as often and the Pass gives 50 % more XP. A message on the Discord.

create or replace function public.admin_event_set(p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); e text := nullif(trim(coalesce(p_event, '')), '');
begin
  if e is not null and e not in ('halloween', 'noel') then raise exception 'bad_event'; end if;
  update settings set event = e where id = 1;
  perform admin_log_add(me, null, 'event', coalesce(e, 'aucun'));
end $$;

alter table public.profiles add column if not exists snowflakes int not null default 0 check (snowflakes >= 0);

create or replace function public.noel_on() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce((select event from settings where id = 1) = 'noel', false) $$;

-- the day of December in Paris: 0 before the 1st, 26 after the 25th
create or replace function public.noel_day() returns int
language sql stable set search_path = public as $$
  select case when now() < timestamptz '2026-12-01 00:00 Europe/Paris' then 0
              else least(26, (now() at time zone 'Europe/Paris')::date - date '2026-12-01' + 1) end
$$;

-- ---------------------------------------------------------------- the quests of the day
create table if not exists public.noel_claims (
  owner uuid not null references public.profiles on delete cascade,
  day date not null,
  key text not null,
  primary key (owner, day, key)
);
alter table public.noel_claims enable row level security;

create or replace function public.noel_quests(p_user uuid) returns table (key text, label text, progress int, goal int, reward int)
language sql stable security definer set search_path = public as $$
  with c as (select metric, n from daily_counters where owner = p_user and day = game_day())
  select * from (values
    ('visit', 'Rends visite au Père Noël', 1, 1, 5),
    ('open10', 'Ouvre 10 boosters', coalesce((select n from c where metric = 'packs'), 0), 10, 15),
    ('open30', 'Ouvre 30 boosters', coalesce((select n from c where metric = 'packs'), 0), 30, 20),
    ('open60', 'Ouvre 60 boosters', coalesce((select n from c where metric = 'packs'), 0), 60, 25),
    ('epic', 'Tire une Épique ou mieux', coalesce((select n from c where metric = 'tier3'), 0), 1, 10),
    ('dailies', 'Réussis tes 3 défis du jour', (select count(*)::int from daily_claims k where k.owner = p_user and k.day = game_day()), 3, 15),
    ('mythic', 'Tire une Mythique ou mieux', coalesce((select n from c where metric = 'tier4'), 0), 1, 10),
    ('market', 'Achète une carte au marché', coalesce((select n from c where metric = 'buys'), 0), 1, 10),
    ('duel', 'Gagne un clash blind test', coalesce((select n from c where metric = 'duel_rewards'), 0), 1, 10)) q(key, label, progress, goal, reward)
$$;

create or replace function public.noel_claim(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); q record;
begin
  if not noel_on() then raise exception 'event_over'; end if;
  select * into q from noel_quests(uid) x where x.key = p_key;
  if q.key is null then raise exception 'unknown_quest'; end if;
  if q.progress < q.goal then raise exception 'not_done'; end if;
  insert into noel_claims (owner, day, key) values (uid, game_day(), p_key) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  update profiles set snowflakes = snowflakes + q.reward where id = uid;
  return q.reward;
end $$;

-- ---------------------------------------------------------------- the snow storms
create table if not exists public.noel_storms (
  starts_at timestamptz primary key,
  day date not null,
  announced boolean not null default false
);
create index if not exists noel_storms_day_idx on public.noel_storms (day);
alter table public.noel_storms enable row level security;          -- the times stay a surprise

create or replace function public.storm_on() returns boolean
language sql stable security definer set search_path = public as $$
  select noel_on() and exists (select 1 from noel_storms where starts_at <= now() and starts_at > now() - interval '15 minutes')
$$;

-- the storm now, for the banner: when it ends (null: no storm)
create or replace function public.noel_storm() returns timestamptz
language sql stable security definer set search_path = public as $$
  select starts_at + interval '15 minutes' from noel_storms
  where noel_on() and starts_at <= now() and starts_at > now() - interval '15 minutes' order by starts_at desc limit 1
$$;

-- the 3 storms of a day: between 10:00 and 22:45 (Paris), at least 1 h 30 apart
create or replace function public.noel_plan_storms(p_day date) returns void
language plpgsql security definer set search_path = public as $$
declare m int[]; tries int := 0;
begin
  if exists (select 1 from noel_storms where day = p_day) then return; end if;
  loop
    tries := tries + 1;
    m := array(select (600 + floor(random() * 766))::int x from generate_series(1, 3) order by 1);
    exit when (m[2] - m[1] >= 90 and m[3] - m[2] >= 90) or tries > 200;
  end loop;
  insert into noel_storms (starts_at, day)
  select (p_day::timestamp + make_interval(mins => x)) at time zone 'Europe/Paris', p_day from unnest(m) x
  on conflict do nothing;
end $$;

-- the storms make the Mythiques and Légendaires twice as likely (the Commune ones pay for it)
create or replace function public.roll_tier() returns smallint language plpgsql volatile set search_path = public as $$
declare r double precision := random() * 100;
begin
  if storm_on() then
    if r < 69.7 then return 0; end if;
    if r < 90.7 then return 1; end if;
    if r < 97.7 then return 2; end if;
    if r < 99.4 then return 3; end if;
    if r < 99.96 then return 4; end if;
    return 5;
  end if;
  if r < 70 then return 0; end if;
  if r < 91 then return 1; end if;
  if r < 98 then return 2; end if;
  if r < 99.7 then return 3; end if;
  if r < 99.98 then return 4; end if;
  return 5;
end $$;

-- and the Pass gives 50 % more XP
create or replace function public.season_xp_boost() returns numeric
language sql stable security definer set search_path = public as $$
  select (case when xp_boost_until is null or now() < xp_boost_until then greatest(1, xp_boost) else 1 end)
         * case when storm_on() then 1.5 else 1 end from settings where id = 1
$$;

-- ---------------------------------------------------------------- the Cartes Givrées
insert into public.haunted_editions (slot, query, title, artist, copies, weight, series, opens_at, closes_at)
select x.slot, x.query, x.title, x.artist, x.copies, x.weight, 3, '2026-12-01 00:00 Europe/Paris', '2026-12-26 00:00 Europe/Paris'
from (values
  (30, 'artist:"Mariah Carey" track:"All I Want for Christmas Is You"', 'All I Want for Christmas Is You', 'Mariah Carey', 1, .3),
  (31, 'artist:"Wham!" track:"Last Christmas"', 'Last Christmas', 'Wham!', 5, 1),
  (32, 'artist:"Bobby Helms" track:"Jingle Bell Rock"', 'Jingle Bell Rock', 'Bobby Helms', 5, 1),
  (33, 'artist:"Brenda Lee" track:"Rockin'' Around The Christmas Tree"', 'Rockin'' Around the Christmas Tree', 'Brenda Lee', 5, 1),
  (34, 'artist:"José Feliciano" track:"Feliz Navidad"', 'Feliz Navidad', 'José Feliciano', 5, 1),
  (35, 'artist:"Michael Bublé" track:"It''s Beginning To Look A Lot Like Christmas"', 'It''s Beginning to Look a Lot Like Christmas', 'Michael Bublé', 5, 1),
  (36, 'artist:"Ariana Grande" track:"Santa Tell Me"', 'Santa Tell Me', 'Ariana Grande', 5, 1),
  (37, 'artist:"Dean Martin" track:"Let It Snow"', 'Let It Snow!', 'Dean Martin', 5, 1),
  (38, 'artist:"Frank Sinatra" track:"Jingle Bells"', 'Jingle Bells', 'Frank Sinatra', 5, 1),
  (39, 'artist:"Tino Rossi" track:"Petit Papa Noël"', 'Petit Papa Noël', 'Tino Rossi', 5, 1),
  (40, 'artist:"Justin Bieber" track:"Mistletoe"', 'Mistletoe', 'Justin Bieber', 5, 1),
  (41, 'artist:"Kelly Clarkson" track:"Underneath the Tree"', 'Underneath the Tree', 'Kelly Clarkson', 5, 1)
) x(slot, query, title, artist, copies, weight)
on conflict (slot) do nothing;

create table if not exists public.noel_meta (
  id int primary key default 1 check (id = 1),
  rate real, rate_at timestamptz                                -- boosters opened per hour, recomputed every 10 minutes
);
alter table public.noel_meta enable row level security;
insert into public.noel_meta (id) values (1) on conflict do nothing;

alter table public.packs add column if not exists noel boolean not null default false;          -- a Pack de Noël
alter table public.packs add column if not exists noel_rolled boolean not null default false;

-- the chance that a booster holds a Carte Givrée right now: the copies still to come, over the boosters expected until
-- the evening of the 25th (18:00), so that all of them are out by then
create or replace function public.noel_chance() returns double precision
language plpgsql security definer set search_path = public as $$
declare m noel_meta; left_n int; hours double precision; today bigint; yday bigint; since double precision;
begin
  if not noel_on() or noel_day() not between 1 and 25 then return 0; end if;
  select coalesce(sum(e.copies), 0) - (select count(*) from haunted_cards h join haunted_editions x on x.slot = h.slot where x.series = 3)
  into left_n from haunted_editions e where e.series = 3;
  if left_n <= 0 then return 0; end if;
  select * into m from noel_meta where id = 1;
  if m.rate is null or m.rate_at < now() - interval '10 minutes' then
    since := greatest(1, extract(epoch from now() - (game_day()::timestamp at time zone 'Europe/Paris')) / 3600);
    select coalesce(sum(n), 0) into today from daily_counters where day = game_day() and metric = 'packs';
    select coalesce(sum(n), 0) into yday from daily_counters where day = game_day() - 1 and metric = 'packs';
    m.rate := greatest(today / since, yday / 24.0, 1);
    update noel_meta set rate = m.rate, rate_at = now() where id = 1;
  end if;
  hours := greatest(extract(epoch from timestamptz '2026-12-25 18:00 Europe/Paris' - now()) / 3600, .05);
  return least(.5, left_n / greatest(m.rate * hours, 1));
end $$;

-- a Carte Givrée for a player: which sound, weighted by the share of its copies still to come (and the 1/1's lower
-- weight); p_pack: from a Pack de Noël (no real help for the 1/1); p_unique: the 1/1 can come out. Null when none is left.
create or replace function public.noel_give(p_user uuid, p_source text, p_pack boolean, p_unique boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e haunted_editions; n int; card_id uuid; who text;
begin
  if exists (select 1 from haunted_editions where series = 3 and track_id is null) then perform haunted_resolve(); end if;
  select x.* into e from haunted_editions x
  where x.series = 3 and x.track_id is not null and (p_unique or x.copies > 1)
    and (select count(*) from haunted_cards h where h.slot = x.slot) < x.copies
  order by -ln(greatest(random(), 1e-9)) / (x.weight * case when p_pack and x.copies = 1 then .1 else 1 end
                                           * (x.copies - (select count(*) from haunted_cards h where h.slot = x.slot))::real / x.copies)
  limit 1 for update;
  if e.slot is null then return null; end if;
  select count(*) + 1 into n from haunted_cards where slot = e.slot;
  insert into tracks (id, title, artist, album, cover) values (e.track_id, e.title, e.artist, '', coalesce(e.cover, '')) on conflict (id) do nothing;
  insert into cards (owner, track_id, tier, rank, holo, tradeable, source, edition, edition_no)
  values (p_user, e.track_id, 5, 950000, false, true, 'givree', e.slot, n) returning id into card_id;
  insert into haunted_cards (slot, no, owner, source, card_id) values (e.slot, n, p_user, p_source, card_id);
  begin                                                          -- the news on the Discord (never breaks the rest)
    select pseudo into who from profiles where id = p_user;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '❄️ **' || discord_esc(who) || '** a trouvé une **Carte Givrée** : **' || discord_esc(e.title) || '** — ' || discord_esc(e.artist)
                 || ' · N° ' || n || '/' || e.copies || case when e.copies = 1 then ' 👑 (exemplaire unique !)' else '' end
                 || case when p_source = 'calendar' then ' (derrière la porte 24 du calendrier)' else '' end,
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('title', '❄️ Carte Givrée · ' || e.title, 'color', 11393254,
        'thumbnail', case when coalesce(e.cover, '') <> '' then jsonb_build_object('url', e.cover) end)))));
  exception when others then null;
  end;
  return jsonb_build_object('id', card_id, 'card_id', card_id, 'track_id', e.track_id, 'slot', e.slot, 'no', n, 'of', e.copies,
    'series', e.series, 'title', e.title, 'artist', e.artist, 'cover', e.cover, 'preview', e.preview);
end $$;

-- after a booster is drawn: maybe flocons (1 in 3, 2 to 4), maybe a Carte Givrée
create or replace function public.noel_roll(p_pack uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs; gain int := 0; card jsonb;
begin
  select * into pk from packs where id = p_pack and owner = uid and done and not noel_rolled for update;
  if pk.id is null or not noel_on() then return null; end if;
  update packs set noel_rolled = true where id = pk.id;
  if random() < .33 then
    gain := 2 + floor(random() * 3)::int;
    update profiles set snowflakes = snowflakes + gain where id = uid;
  end if;
  if random() < least(noel_chance() * case when pk.noel then 20 else 1 end, 1) then
    card := noel_give(uid, case when pk.noel then 'pack' else 'booster' end, pk.noel, true);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('snowflakes', gain, 'card', card));
end $$;

-- the Pack de Noël: 100 flocons, 5 cards Rare or better, 20 times the chance of a Carte Givrée
create or replace function public.noel_pack_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); slots smallint[] := '{}'; arts boolean[] := '{}'; i int; pack_id uuid;
begin
  if not noel_on() then raise exception 'event_over'; end if;
  if (select count(*) from packs where owner = uid and not done and not parked) >= 3 then raise exception 'too_many_open_packs'; end if;
  if (select snowflakes from profiles where id = uid for update) < 100 then raise exception 'not_enough_snowflakes'; end if;
  update profiles set snowflakes = snowflakes - 100 where id = uid;
  for i in 1..5 loop slots := slots || greatest(roll_tier(), 2::smallint); arts := arts || false; end loop;
  insert into packs (owner, kind, genre, slots, god, artist_slots, paid_with, paid, noel)
  values (uid, 'booster', null, slots, false, arts, 'snowflakes', 100, true) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', false);
end $$;

-- a Pack Hanté or a Pack de Noël left open gives its pumpkins or flocons back and is never served again
create or replace function public.park_pack(pk packs) returns void
language plpgsql security definer set search_path = public as $$
begin
  if pk.haunted or pk.noel then
    update packs set parked = true, genre = -1 where id = pk.id;
    if pk.noel then update profiles set snowflakes = snowflakes + coalesce(pk.paid, 100) where id = pk.owner;
    else update profiles set pumpkins = pumpkins + coalesce(pk.paid, 100) where id = pk.owner; end if;
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

-- ---------------------------------------------------------------- the Advent calendar
create table if not exists public.noel_advent (
  owner uuid not null references public.profiles on delete cascade,
  day smallint not null check (day between 1 and 24),
  at timestamptz not null default now(),
  gift jsonb,
  primary key (owner, day)
);
alter table public.noel_advent enable row level security;

-- the present behind each door: [kind, amount, label]
create or replace function public.noel_gift(p_day int) returns jsonb
language sql immutable as $$
  select (array[
    '{"kind": "snowflakes", "n": 10, "label": "10 flocons"}',
    '{"kind": "streams", "n": 300, "label": "300 Streams"}',
    '{"kind": "boosters", "n": 1, "label": "1 booster"}',
    '{"kind": "snowflakes", "n": 15, "label": "15 flocons"}',
    '{"kind": "vinyls", "n": 10, "label": "10 Vinyles"}',
    '{"kind": "boosters", "n": 2, "label": "2 boosters (Saint-Nicolas)"}',
    '{"kind": "streams", "n": 500, "label": "500 Streams"}',
    '{"kind": "card", "n": 3, "label": "1 carte Épique"}',
    '{"kind": "snowflakes", "n": 20, "label": "20 flocons"}',
    '{"kind": "boosters", "n": 2, "label": "2 boosters"}',
    '{"kind": "vinyls", "n": 15, "label": "15 Vinyles"}',
    '{"kind": "big", "n": 1, "label": "1 Grand booster"}',
    '{"kind": "streams", "n": 800, "label": "800 Streams"}',
    '{"kind": "snowflakes", "n": 30, "label": "30 flocons"}',
    '{"kind": "boosters", "n": 3, "label": "3 boosters"}',
    '{"kind": "card", "n": 4, "label": "1 carte Mythique"}',
    '{"kind": "vinyls", "n": 25, "label": "25 Vinyles"}',
    '{"kind": "snowflakes", "n": 40, "label": "40 flocons"}',
    '{"kind": "big", "n": 1, "label": "1 Grand booster"}',
    '{"kind": "streams", "n": 1500, "label": "1 500 Streams"}',
    '{"kind": "snowflakes", "n": 50, "label": "50 flocons"}',
    '{"kind": "big", "n": 2, "label": "2 Grands boosters"}',
    '{"kind": "vinyls", "n": 40, "label": "40 Vinyles"}',
    '{"kind": "noel", "n": 5, "label": "1 carte Légendaire, 100 flocons et peut-être une Carte Givrée"}'
  ]::jsonb[])[p_day]
$$;

create or replace function public.noel_open(p_day int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); g jsonb := noel_gift(p_day); card jsonb; label text := '❄ porte ' || p_day || ' du calendrier';
begin
  if not noel_on() then raise exception 'event_over'; end if;
  if p_day is null or p_day < 1 or p_day > 24 then raise exception 'bad_day'; end if;
  if p_day > noel_day() then raise exception 'door_locked'; end if;
  insert into noel_advent (owner, day, gift) values (uid, p_day, g) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  case g ->> 'kind'
    when 'snowflakes' then update profiles set snowflakes = snowflakes + (g ->> 'n')::int where id = uid;
    when 'streams' then perform add_streams(uid, (g ->> 'n')::bigint, label);
    when 'vinyls' then perform add_vinyls(uid, (g ->> 'n')::int, label);
    when 'boosters' then update profiles set stock = stock + (g ->> 'n')::int where id = uid;
    when 'big' then update profiles set big_packs = big_packs + (g ->> 'n')::int where id = uid;
    when 'card' then perform give_card(uid, 'track', (g ->> 'n')::smallint, false, 'calendar');
    else                                                -- door 24: a Légendaire, 100 flocons, and 1 chance in 8 of a Givrée (not the 1/1)
      perform give_card(uid, 'track', 5::smallint, false, 'calendar');
      update profiles set snowflakes = snowflakes + 100 where id = uid;
      if random() < .125 then card := noel_give(uid, 'calendar', false, false); end if;
  end case;
  return jsonb_strip_nulls(jsonb_build_object('gift', g, 'card', card));
end $$;

-- ---------------------------------------------------------------- the page
create or replace function public.noel_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  return jsonb_build_object('active', noel_on(), 'day', noel_day(), 'snowflakes', (select snowflakes from profiles where id = uid),
    'storm', noel_storm(), 'chance', noel_chance(),
    'storms_left', (select count(*) from noel_storms where day = (now() at time zone 'Europe/Paris')::date and starts_at > now()),
    'doors', (select jsonb_agg(jsonb_build_object('day', d, 'gift', noel_gift(d) ->> 'label',
                'open', exists (select 1 from noel_advent a where a.owner = uid and a.day = d)) order by d) from generate_series(1, 24) d),
    'quests', (select jsonb_agg(jsonb_build_object('key', q.key, 'label', q.label, 'progress', least(q.progress, q.goal), 'goal', q.goal, 'reward', q.reward,
                 'claimed', exists (select 1 from noel_claims c where c.owner = uid and c.day = game_day() and c.key = q.key)))
               from noel_quests(uid) q));
end $$;

-- ---------------------------------------------------------------- the flocon shop
alter table public.shop_packs add column if not exists snowflakes int not null default 0;
alter table public.shop_packs add column if not exists snowflake_vinyls int;       -- the same pack paid in Vinyles
alter table public.purchases add column if not exists snowflakes int not null default 0;

insert into public.shop_packs (id, name, cents, vinyls, snowflakes, snowflake_vinyls) values
  ('sf60', '60 flocons', 99, 0, 60, 80),
  ('sf150', '150 flocons', 199, 0, 150, 160),
  ('sf400', '400 flocons', 499, 0, 400, 400),
  ('sf1000', '1 000 flocons', 999, 0, 1000, 800)
on conflict (id) do update set name = excluded.name, cents = excluded.cents, snowflakes = excluded.snowflakes, snowflake_vinyls = excluded.snowflake_vinyls;

create or replace function public.shop_quote(p_pack text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; s seasons;
begin
  if (select payments_off from settings where id = 1) and not exists (select 1 from admins where id = uid) then
    raise exception 'payments_maintenance';
  end if;
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  if k.pumpkins > 0 and not halloween_on() then raise exception 'event_over'; end if;
  if k.snowflakes > 0 and not noel_on() then raise exception 'event_over'; end if;
  if k.once and exists (select 1 from purchases where owner = uid and pack = k.id) then raise exception 'offer_used'; end if;
  if k.daily and (k.id <> today_offer() or exists (select 1 from purchases where owner = uid and pack = k.id
                  and (created_at at time zone 'Europe/Paris')::date = game_day())) then raise exception 'offer_expired'; end if;
  if k.fire and fire_until(uid) is null then raise exception 'offer_expired'; end if;
  if k.premium then
    s := current_season();
    if s.id is null then raise exception 'no_season'; end if;
    if exists (select 1 from season_progress where owner = uid and season_id = s.id and premium) then raise exception 'already_premium'; end if;
  end if;
  return jsonb_build_object('user', uid, 'email', (select email from auth.users where id = uid), 'name', k.name, 'cents', k.cents);
end $$;

create or replace function public.credit_purchase(p_session text, p_user uuid, p_pack text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare k shop_packs; s seasons; taken boolean; v int;
begin
  select * into k from shop_packs where id = p_pack;
  if k.id is null then raise exception 'bad_pack'; end if;
  if exists (select 1 from purchases where session_id = p_session) then return; end if;
  s := current_season();
  taken := (k.once and exists (select 1 from purchases where owner = p_user and pack = k.id))
        or (k.daily and exists (select 1 from purchases where owner = p_user and pack = k.id
                                and (created_at at time zone 'Europe/Paris')::date = game_day()))
        or (k.fire and exists (select 1 from purchases where owner = p_user and pack = k.id and created_at > now() - interval '2 hours'))
        or (k.premium and (s.id is null or exists (select 1 from season_progress where owner = p_user and season_id = s.id and premium)));
  v := case when taken then greatest(1, round(coalesce(p_cents, k.cents) * 0.8)::int) else k.vinyls end;
  insert into purchases (session_id, owner, pack, cents, vinyls, pumpkins, snowflakes)
  values (p_session, p_user, p_pack, p_cents, v, case when taken then 0 else k.pumpkins end, case when taken then 0 else k.snowflakes end) on conflict do nothing;
  if not found then return; end if;
  if taken then                                         -- already used: the money becomes Vinyles at the normal rate
    perform add_vinyls(p_user, v, 'achat : ' || k.name || ' (déjà pris, converti en Vinyles)');
    return;
  end if;
  if k.vinyls > 0 then perform add_vinyls(p_user, k.vinyls, 'achat : ' || k.name); end if;
  if k.pumpkins > 0 then update profiles set pumpkins = pumpkins + k.pumpkins where id = p_user; end if;
  if k.snowflakes > 0 then update profiles set snowflakes = snowflakes + k.snowflakes where id = p_user; end if;
  if k.boosters > 0 then update profiles set stock = stock + k.boosters where id = p_user; end if;
  if k.card_kind is not null then perform give_card(p_user, k.card_kind, k.card_tier, k.card_shiny); end if;
  if k.premium then
    insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
    on conflict (owner, season_id) do update set premium = true;
  end if;
end $$;
revoke execute on function public.credit_purchase(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.credit_purchase(text, uuid, text, int) to service_role;

create or replace function public.revoke_purchase(p_intent text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pu purchases; k shop_packs; bal int; take int;
begin
  select * into pu from purchases where payment_intent = p_intent and revoked_at is null for update;
  if pu.session_id is null then return; end if;
  update purchases set revoked_at = now() where session_id = pu.session_id;
  if pu.owner is null then return; end if;
  select * into k from shop_packs where id = pu.pack;
  select vinyls into bal from profiles where id = pu.owner for update;
  take := least(bal, pu.vinyls);
  update profiles set vinyls = vinyls - take, vinyl_debt = vinyl_debt + (pu.vinyls - take),
                      stock = greatest(0, stock - coalesce(k.boosters, 0)),
                      pumpkins = greatest(0, pumpkins - pu.pumpkins),
                      snowflakes = greatest(0, snowflakes - pu.snowflakes) where id = pu.owner;
  insert into vinyl_ledger (owner, amount, reason) values (pu.owner, -take, 'achat remboursé (' || p_reason || ') : ' || coalesce(k.name, pu.pack));
  if k.premium then
    update season_progress set premium = false
    where owner = pu.owner and season_id = (select id from seasons where pu.created_at between starts_at and ends_at + interval '7 days' order by starts_at desc limit 1);
  end if;
  insert into admin_log (admin, target, action, detail)
  values (null, pu.owner, 'vinyls', 'Achat Stripe repris (' || p_reason || ') : ' || coalesce(k.name, pu.pack) || ', ' || pu.vinyls || ' Vinyles'
          || case when pu.pumpkins > 0 then ', ' || pu.pumpkins || ' citrouilles' else '' end
          || case when pu.snowflakes > 0 then ', ' || pu.snowflakes || ' flocons' else '' end);
end $$;
revoke execute on function public.revoke_purchase(text, text) from public, anon, authenticated;
grant execute on function public.revoke_purchase(text, text) to service_role;

create or replace function public.snowflake_packs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'snowflakes', snowflakes, 'cents', cents, 'vinyls', snowflake_vinyls) order by snowflakes), '[]')
  from shop_packs where snowflakes > 0
$$;

create or replace function public.buy_snowflakes(p_pack text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); k shop_packs; bal int; n int;
begin
  if not noel_on() then raise exception 'event_over'; end if;
  select * into k from shop_packs where id = p_pack and snowflakes > 0 and snowflake_vinyls > 0;
  if k.id is null then raise exception 'bad_pack'; end if;
  select vinyls into bal from profiles where id = uid for update;
  if bal < k.snowflake_vinyls then raise exception 'not_enough_vinyls'; end if;
  perform add_vinyls(uid, -k.snowflake_vinyls, 'achat : ' || k.name);
  update profiles set snowflakes = snowflakes + k.snowflakes where id = uid returning snowflakes into n;
  return n;
end $$;

-- ---------------------------------------------------------------- the clock: on, off, storms, Discord
create or replace function public.noel_tick() returns void
language plpgsql security definer set search_path = public as $$
declare d int := noel_day(); s noel_storms;
begin
  -- midnight on 1 December: the event starts by itself; midnight on the 26th: it ends
  if d between 1 and 25 and (select event from settings where id = 1) is null
     and now() < timestamptz '2026-12-01 00:10 Europe/Paris' then
    update settings set event = 'noel' where id = 1;
    begin
      perform discord_post(jsonb_build_object('username', 'Zik Hunter',
        'content', '🎄 **Noël commence sur Zik Hunter !** Jusqu''au 25 décembre : un calendrier de l''Avent avec un cadeau chaque jour, '
                   || '12 **Cartes Givrées** en édition limitée dans les boosters (dont **All I Want for Christmas Is You**, en un seul exemplaire), '
                   || 'des flocons à gagner et des tempêtes de neige surprises. Rendez-vous à l''Atelier du Père Noël ! ❄️'));
    exception when others then null;
    end;
  end if;
  if d >= 26 and (select event from settings where id = 1) = 'noel' and now() < timestamptz '2026-12-26 00:10 Europe/Paris' then
    update settings set event = null where id = 1;
  end if;
  if not noel_on() or d not between 1 and 25 then return; end if;
  perform noel_plan_storms((now() at time zone 'Europe/Paris')::date);
  for s in select * from noel_storms where not announced and starts_at <= now() and starts_at > now() - interval '15 minutes' for update loop
    update noel_storms set announced = true where starts_at = s.starts_at;
    begin
      perform discord_post(jsonb_build_object('username', 'Zik Hunter',
        'content', '🌨️ **Tempête de neige !** Pendant 15 minutes, les Mythiques et les Légendaires tombent deux fois plus souvent '
                   || 'et le Pass donne 50 % d''XP en plus. Ouvre tes boosters avant que ça se calme !'));
    exception when others then null;
    end;
  end loop;
  update noel_storms set announced = true where not announced and starts_at <= now() - interval '15 minutes';
end $$;
select cron.schedule('noel-tick', '* * * * *', 'select public.noel_tick()');

-- the admins give or take flocons (never below zero)
create or replace function public.admin_snowflakes(p_user uuid, p_amount int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin(); bal int; amount int := p_amount;
begin
  if p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'bad_amount'; end if;
  select snowflakes into bal from profiles where id = p_user for update;
  if bal is null then raise exception 'user_not_found'; end if;
  amount := greatest(amount, -bal);
  update profiles set snowflakes = snowflakes + amount where id = p_user returning snowflakes into bal;
  perform admin_log_add(me, p_user, 'snowflakes', amount || coalesce(' · ' || nullif(trim(p_reason), ''), ''));
  return bal;
end $$;

revoke execute on function public.noel_on(), public.noel_quests(uuid), public.storm_on(), public.noel_plan_storms(date), public.noel_chance(),
  public.noel_give(uuid, text, boolean, boolean), public.noel_tick(), public.noel_gift(int) from public, anon, authenticated;
revoke execute on function public.noel_claim(text), public.noel_roll(uuid), public.noel_pack_start(), public.noel_open(int), public.noel_state(),
  public.snowflake_packs(), public.buy_snowflakes(text), public.admin_snowflakes(uuid, int, text) from public, anon;
grant execute on function public.noel_claim(text), public.noel_roll(uuid), public.noel_pack_start(), public.noel_open(int), public.noel_state(),
  public.snowflake_packs(), public.buy_snowflakes(text), public.admin_snowflakes(uuid, int, text) to authenticated;
grant execute on function public.noel_storm(), public.noel_day() to anon, authenticated;

select public.haunted_resolve();
