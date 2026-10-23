-- La Nuit d'Halloween: a second series of the Collection Hantée, 13 other sounds in numbered copies (This Is Halloween
-- is a 1/1), that come out of boosters on 31 October only, from midnight to midnight (Paris). The cards wear their own
-- look (pumpkin and black). The first series goes on meanwhile; the Pack Hanté gives 20 times the chance for both.
-- On the 31 the pumpkins are doubled (quests and boosters). A copy not found by midnight never comes out.

alter table public.haunted_editions add column if not exists series smallint not null default 1;
alter table public.haunted_editions add column if not exists opens_at timestamptz;     -- null: the event's start
alter table public.haunted_editions add column if not exists closes_at timestamptz;    -- null: haunted_meta.ends_at

insert into public.haunted_editions (slot, query, title, artist, copies, weight, series, opens_at, closes_at)
select x.slot, x.query, x.title, x.artist, x.copies, x.weight, 2, '2026-10-31 00:00 Europe/Paris', '2026-11-01 00:00 Europe/Paris'
from (values
  (14, 'artist:"Danny Elfman" track:"This Is Halloween"', 'This Is Halloween', 'Danny Elfman', 1, .3),
  (15, 'artist:"The Rolling Stones" track:"Sympathy For The Devil"', 'Sympathy for the Devil', 'The Rolling Stones', 10, 1),
  (16, 'artist:"Bobby Pickett" track:"Monster Mash"', 'Monster Mash', 'Bobby "Boris" Pickett', 10, 1),
  (17, 'artist:"Screamin'' Jay Hawkins" track:"I Put a Spell on You"', 'I Put a Spell on You', 'Screamin'' Jay Hawkins', 10, 1),
  (18, 'artist:"John Carpenter" track:"Halloween"', 'Halloween (Main Theme)', 'John Carpenter', 10, 1),
  (19, 'artist:"Santana" track:"Black Magic Woman"', 'Black Magic Woman', 'Santana', 10, 1),
  (20, 'artist:"Donovan" track:"Season of the Witch"', 'Season of the Witch', 'Donovan', 10, 1),
  (21, 'artist:"Warren Zevon" track:"Werewolves of London"', 'Werewolves of London', 'Warren Zevon', 10, 1),
  (22, 'artist:"Blue Öyster Cult" track:"Don''t Fear the Reaper"', '(Don''t Fear) The Reaper', 'Blue Öyster Cult', 10, 1),
  (23, 'artist:"Metallica" track:"Enter Sandman"', 'Enter Sandman', 'Metallica', 10, 1),
  (24, 'artist:"Olivia Rodrigo" track:"vampire"', 'Vampire', 'Olivia Rodrigo', 10, 1),
  (25, 'artist:"Rob Zombie" track:"Dragula"', 'Dragula', 'Rob Zombie', 10, 1),
  (26, 'artist:"Creedence Clearwater Revival" track:"Bad Moon Rising"', 'Bad Moon Rising', 'Creedence Clearwater Revival', 10, 1)
) x(slot, query, title, artist, copies, weight)
on conflict (slot) do nothing;

-- the night of the 31 (Paris): pumpkins doubled
create or replace function public.halloween_night() returns boolean
language sql stable security definer set search_path = public as $$
  select halloween_on() and now() >= '2026-10-31 00:00 Europe/Paris' and now() < '2026-11-01 00:00 Europe/Paris'
$$;

-- the chance that a booster holds a copy of a series right now: its copies still to come, over the boosters expected
-- until its end
create or replace function public.haunted_chance(p_series smallint) returns double precision
language plpgsql security definer set search_path = public as $$
declare m haunted_meta; left_n int; hours double precision; today bigint; yday bigint; since double precision; t0 timestamptz; t1 timestamptz;
begin
  select * into m from haunted_meta where id = 1;
  select min(coalesce(opens_at, '-infinity')), max(coalesce(closes_at, m.ends_at)) into t0, t1 from haunted_editions where series = p_series;
  if not halloween_on() or m.paused or t1 is null or now() < t0 or now() >= t1 then return 0; end if;
  select coalesce(sum(e.copies), 0) - (select count(*) from haunted_cards h join haunted_editions x on x.slot = h.slot where x.series = p_series)
  into left_n from haunted_editions e where e.series = p_series;
  if left_n <= 0 then return 0; end if;
  if m.rate is null or m.rate_at < now() - interval '10 minutes' then
    since := greatest(1, extract(epoch from now() - (game_day()::timestamp at time zone 'Europe/Paris')) / 3600);
    select coalesce(sum(n), 0) into today from daily_counters where day = game_day() and metric = 'packs';
    select coalesce(sum(n), 0) into yday from daily_counters where day = game_day() - 1 and metric = 'packs';
    m.rate := greatest(today / since, yday / 24.0, 1);
    update haunted_meta set rate = m.rate, rate_at = now() where id = 1;
  end if;
  hours := greatest(extract(epoch from t1 - now()) / 3600, .05);
  return least(.5, left_n / greatest(m.rate * hours, 1));
end $$;
create or replace function public.haunted_chance() returns double precision
language sql security definer set search_path = public as $$ select haunted_chance(1::smallint) $$;

-- after a booster is drawn: maybe a haunted copy (the night's series first, then the first one), maybe pumpkins
create or replace function public.haunted_roll(p_pack uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs; ch double precision; e haunted_editions; n int; card_id uuid; pk_gain int := 0; who text; sr smallint;
begin
  select * into pk from packs where id = p_pack and owner = uid and done and not haunted_rolled for update;
  if pk.id is null or not halloween_on() then return null; end if;
  update packs set haunted_rolled = true where id = pk.id;
  -- pumpkins hidden in the booster: 1 in 3, 2 to 4 (doubled on the night of the 31)
  if random() < .33 then
    pk_gain := (2 + floor(random() * 3)::int) * case when halloween_night() then 2 else 1 end;
    update profiles set pumpkins = pumpkins + pk_gain where id = uid;
  end if;
  foreach sr in array array[2, 1]::smallint[] loop
    ch := haunted_chance(sr) * case when pk.haunted then 20 else 1 end;
    continue when random() >= least(ch, 1);
    -- which sound: weighted by the share of its copies still to come out (and the 1/1's lower weight)
    select x.* into e from haunted_editions x
    where x.series = sr and x.track_id is not null and (select count(*) from haunted_cards h where h.slot = x.slot) < x.copies
    order by -ln(greatest(random(), 1e-9)) / (x.weight * case when pk.haunted and x.copies = 1 then .1 else 1 end   -- the Pack Hanté doesn't help for a 1/1
                                             * (x.copies - (select count(*) from haunted_cards h where h.slot = x.slot))::real / x.copies)
    limit 1 for update;
    exit when e.slot is not null;
  end loop;
  if e.slot is null then return jsonb_build_object('pumpkins', pk_gain); end if;
  select count(*) + 1 into n from haunted_cards where slot = e.slot;
  insert into tracks (id, title, artist, album, cover) values (e.track_id, e.title, e.artist, '', coalesce(e.cover, '')) on conflict (id) do nothing;
  insert into cards (owner, track_id, tier, rank, holo, tradeable, source, edition, edition_no)
  values (uid, e.track_id, 5, 950000, false, true, 'haunted', e.slot, n) returning id into card_id;
  insert into haunted_cards (slot, no, owner, source, card_id) values (e.slot, n, uid, case when pk.haunted then 'pack' else 'booster' end, card_id);
  begin                                                          -- the news on the Discord (never breaks the booster)
    select pseudo into who from profiles where id = uid;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', case when e.series = 2 then '🎃 **' || discord_esc(who) || '** a trouvé une carte de la **Nuit d''Halloween** : **'
                      else '🎃 **' || discord_esc(who) || '** a trouvé une carte de la **Collection Hantée** : **' end
                 || discord_esc(e.title) || '** — ' || discord_esc(e.artist)
                 || ' · N° ' || lpad(n::text, length(e.copies::text), '0') || '/' || e.copies || case when e.copies = 1 then ' 👑 (exemplaire unique !)' else '' end,
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('title', case when e.series = 2 then '🌕 Nuit d''Halloween · ' else '🦇 Collection Hantée · ' end || e.title,
        'color', case when e.series = 2 then 16747040 else 16747050 end,
        'thumbnail', case when coalesce(e.cover, '') <> '' then jsonb_build_object('url', e.cover) end)))));
  exception when others then null;
  end;
  return jsonb_build_object('pumpkins', pk_gain, 'card', jsonb_build_object('id', card_id, 'card_id', card_id, 'track_id', e.track_id, 'slot', e.slot, 'no', n, 'of', e.copies,
    'series', e.series, 'title', e.title, 'artist', e.artist, 'cover', e.cover, 'preview', e.preview));
end $$;

-- the board: each sound says its series and its window
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'fee', (select market_fee_pct from settings), 'now', now(), 'night', halloween_night(),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'series', e.series, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
        'track_id', e.track_id, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', c.owner = uid,
                     'id', case when c.owner = uid then c.id end, 'grade', c.grade, 'cert', c.grade_cert,
                     'sale', (select jsonb_build_object('id', l.id, 'price', l.price) from listings l
                              where l.card_id = c.id and l.status = 'active' and l.expires_at > now()))) order by h.no), '[]')
                   from haunted_cards h left join cards c on c.id = h.card_id left join profiles p on p.id = c.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;

-- the quests give double pumpkins on the night of the 31
create or replace function public.halloween_quests(p_user uuid) returns table (key text, label text, progress int, goal int, reward int)
language sql stable security definer set search_path = public as $$
  with c as (select metric, n from daily_counters where owner = p_user and day = game_day()), k as (select case when halloween_night() then 2 else 1 end m)
  select q.key, q.label, q.progress, q.goal, q.reward * (select m from k) from (values
    ('visit', 'Rends visite à la sorcière', 1, 1, 5),
    ('open10', 'Ouvre 10 boosters', coalesce((select n from c where metric = 'packs'), 0), 10, 15),
    ('open30', 'Ouvre 30 boosters', coalesce((select n from c where metric = 'packs'), 0), 30, 20),
    ('open60', 'Ouvre 60 boosters', coalesce((select n from c where metric = 'packs'), 0), 60, 25),
    ('epic', 'Tire une Épique ou mieux', coalesce((select n from c where metric = 'tier3'), 0), 1, 10),
    ('dailies', 'Réussis tes 3 défis du jour', (select count(*)::int from daily_claims k where k.owner = p_user and k.day = game_day()), 3, 15),
    ('discard', 'Tire une Mythique ou mieux', coalesce((select n from c where metric = 'tier4'), 0), 1, 10),
    ('market', 'Achète une carte au marché', coalesce((select n from c where metric = 'buys'), 0), 1, 10),
    ('duel', 'Gagne un clash blind test', coalesce((select n from c where metric = 'duel_rewards'), 0), 1, 10)) q(key, label, progress, goal, reward)
$$;

-- midnight on the 31: the news on the Discord
create or replace function public.nuit_halloween_announce() returns void
language plpgsql security definer set search_path = public as $$
begin
  if now() < '2026-10-31 00:00 Europe/Paris' or now() >= '2026-10-31 01:00 Europe/Paris' then return; end if;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter',
    'content', '🌕 **La Nuit d''Halloween commence !** Jusqu''à minuit seulement, 13 nouvelles cartes en édition limitée se cachent dans les boosters, dont **This Is Halloween**, en un seul exemplaire. Et toutes les citrouilles sont doublées. 🎃'));
exception when others then null;
end $$;
revoke execute on function public.nuit_halloween_announce(), public.halloween_night(), public.haunted_chance(smallint) from public, anon, authenticated;
select cron.schedule('nuit-halloween', '0 23 30 10 *', 'select public.nuit_halloween_announce()');   -- 23:00 UTC = midnight in Paris (winter time)
