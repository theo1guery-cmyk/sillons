-- Halloween: pumpkins (🎃) won with daily Halloween quests, spent at the witch's: the transmutation cauldron (5 cards of a
-- rarity → 1 card of the next one; 5 Mythiques → a Légendaire half of the time, else a Mythique) and the restoration
-- elixir (a graded card tries +1 to its grade, never above 9). Everything works only while the event is 'halloween'.
alter table public.profiles add column if not exists pumpkins int not null default 0 check (pumpkins >= 0);

create table if not exists public.halloween_claims (
  owner uuid not null references public.profiles on delete cascade,
  day date not null,
  key text not null,
  primary key (owner, day, key)
);
alter table public.halloween_claims enable row level security;

create or replace function public.halloween_on() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce((select event from settings where id = 1) = 'halloween', false) $$;

-- the quests of the day: key, label, progress (from the day's counters), goal, pumpkins
create or replace function public.halloween_quests(p_user uuid) returns table (key text, label text, progress int, goal int, reward int)
language sql stable security definer set search_path = public as $$
  with c as (select metric, n from daily_counters where owner = p_user and day = game_day())
  select * from (values
    ('open10', 'Ouvre 10 boosters', coalesce((select n from c where metric = 'packs'), 0), 10, 15),
    ('open30', 'Ouvre 30 boosters', coalesce((select n from c where metric = 'packs'), 0), 30, 20),
    ('epic', 'Tire une Épique ou mieux', coalesce((select n from c where metric = 'tier3'), 0), 1, 10),
    ('dailies', 'Réussis tes 3 défis du jour', (select count(*)::int from daily_claims k where k.owner = p_user and k.day = game_day()), 3, 15),
    ('duel', 'Gagne un clash blind test', coalesce((select n from c where metric = 'duel_rewards'), 0), 1, 10)) q(key, label, progress, goal, reward)
$$;

create or replace function public.halloween_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  return jsonb_build_object('active', halloween_on(), 'pumpkins', (select pumpkins from profiles where id = uid),
    'quests', (select jsonb_agg(jsonb_build_object('key', q.key, 'label', q.label, 'progress', least(q.progress, q.goal), 'goal', q.goal, 'reward', q.reward,
                 'claimed', exists (select 1 from halloween_claims h where h.owner = uid and h.day = game_day() and h.key = q.key)))
               from halloween_quests(uid) q));
end $$;

create or replace function public.halloween_claim(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); q record;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  select * into q from halloween_quests(uid) x where x.key = p_key;
  if q.key is null then raise exception 'unknown_quest'; end if;
  if q.progress < q.goal then raise exception 'not_done'; end if;
  insert into halloween_claims (owner, day, key) values (uid, game_day(), p_key) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  update profiles set pumpkins = pumpkins + q.reward where id = uid;
  return q.reward;
end $$;

-- a new track card of a rarity, picked on the server like in a booster (fetched from Deezer, saved in tracks)
create or replace function public.make_track_card(p_user uuid, p_tier smallint, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cand bigint; t jsonb; a jsonb; g smallint; r int; tries int := 0; card_id uuid; was_owned boolean;
begin
  loop
    tries := tries + 1;
    if tries > 6 then raise exception 'cauldron_empty'; end if;
    cand := pool_pick_track(p_user, p_tier, null, '{}');
    if cand is null then raise exception 'cauldron_empty'; end if;
    t := deezer('track/' || cand);
    if t ->> 'error' is not null or t ->> 'id' is null or not coalesce((t ->> 'readable')::boolean, true) or coalesce(t ->> 'preview', '') = '' then
      delete from track_pool where id = cand; continue;
    end if;
    exit;
  end loop;
  r := coalesce((t ->> 'rank')::int, 0);
  select jsonb_build_object('cover_big', al.cover, 'release_date', null), al.genre into a, g from albums al
  where al.id = (t -> 'album' ->> 'id')::bigint and al.genre is not null and al.cover <> '';
  if not found then
    a := deezer('album/' || (t -> 'album' ->> 'id'));
    g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
    if a ? 'id' then perform save_album(a); end if;
  end if;
  insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
  values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
          coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
          coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
          coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
          coalesce((t ->> 'explicit_lyrics')::boolean, false), g, (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
  on conflict (id) do update set updated_at = now();
  was_owned := exists (select 1 from cards where owner = p_user and track_id = cand);
  insert into cards (owner, track_id, tier, rank, holo, source) values (p_user, cand, p_tier, r, false, p_source) returning id into card_id;
  return (select jsonb_build_object('id', card_id, 'kind', 'track', 'track_id', tr.id, 'tier', p_tier, 'rank', r, 'holo', false, 'new', not was_owned,
            'title', tr.title, 'artist', tr.artist, 'album', tr.album, 'cover', tr.cover, 'duration', tr.duration, 'bpm', tr.bpm,
            'year', tr.year, 'explicit', tr.explicit, 'genre', tr.genre) from tracks tr where tr.id = cand);
end $$;

-- the cauldron: 5 track cards of the same rarity (Rare, Épique or Mythique) and pumpkins → 1 card of the next rarity
create or replace function public.cauldron_price(p_tier smallint) returns int language sql immutable as $$
  select case p_tier when 2 then 20 when 3 then 40 when 4 then 80 end
$$;
create or replace function public.cauldron_brew(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); tier smallint; price int; got smallint; ok boolean := true; card jsonb;
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
  if tier = 4 and random() >= .5 then ok := false; got := 4; end if;    -- the Légendaire: half of the time
  card := make_track_card(uid, got, 'cauldron');
  return jsonb_build_object('success', ok, 'tier', got, 'card', card, 'price', price);
end $$;

-- the elixir: a graded card tries +1 (never above 9); a miss costs only the pumpkins
create or replace function public.elixir_chance(p_grade smallint) returns int language sql immutable as $$
  select case when p_grade <= 5 then 70 when p_grade = 6 then 50 when p_grade = 7 then 35 when p_grade = 8 then 20 else 0 end
$$;
create or replace function public.elixir_pour(p_card uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c cards; ok boolean;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null then raise exception 'not_owned'; end if;
  if c.grade is null then raise exception 'not_graded'; end if;
  if c.grade >= 9 then raise exception 'elixir_max'; end if;
  if (select pumpkins from profiles where id = uid for update) < 30 then raise exception 'not_enough_pumpkins'; end if;
  update profiles set pumpkins = pumpkins - 30 where id = uid;
  ok := random() * 100 < elixir_chance(c.grade);
  if ok then update cards set grade = grade + 1 where id = c.id; end if;
  return jsonb_build_object('success', ok, 'grade', c.grade + case when ok then 1 else 0 end, 'before', c.grade);
end $$;

revoke execute on function public.halloween_on(), public.halloween_quests(uuid), public.make_track_card(uuid, smallint, text) from public, anon, authenticated;
revoke execute on function public.halloween_state(), public.halloween_claim(text), public.cauldron_brew(uuid[]), public.elixir_pour(uuid),
  public.cauldron_price(smallint), public.elixir_chance(smallint) from public, anon;
grant execute on function public.halloween_state(), public.halloween_claim(text), public.cauldron_brew(uuid[]), public.elixir_pour(uuid),
  public.cauldron_price(smallint), public.elixir_chance(smallint) to authenticated;
