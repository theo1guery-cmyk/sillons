-- Streams (the game currency), discarding duplicates, daily challenges and permanent achievements.
-- Balances only change inside the functions below; every change is written to stream_ledger.

alter table public.profiles
  add column streams bigint not null default 0 check (streams >= 0),
  add column login_streak int not null default 0,
  add column best_streak int not null default 0,
  add column last_login date,
  add column title text;

create table public.stream_ledger (
  id bigint generated always as identity primary key,
  owner uuid not null references public.profiles on delete cascade,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index stream_ledger_owner_idx on public.stream_ledger (owner, created_at desc);

create function public.game_day() returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

create function public.add_streams(p_user uuid, p_amount bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  update profiles set streams = streams + p_amount where id = p_user returning streams into bal;
  insert into stream_ledger (owner, amount, reason) values (p_user, p_amount, p_reason);
  return bal;
end $$;

-- ---------------------------------------------------------------- what happened today (for daily challenges)
create table public.daily_counters (
  owner uuid not null references public.profiles on delete cascade,
  day date not null,
  metric text not null,
  n int not null default 0,
  primary key (owner, day, metric)
);
create function public.bump(p_user uuid, p_metric text, p_n int default 1) returns void
language sql security definer set search_path = public as $$
  insert into daily_counters (owner, day, metric, n) values (p_user, game_day(), p_metric, p_n)
  on conflict (owner, day, metric) do update set n = daily_counters.n + excluded.n
$$;

-- every card pulled from a booster feeds the counters
create function public.on_card_pulled() returns trigger
language plpgsql security definer set search_path = public as $$
declare g smallint;
begin
  if new.source not in ('booster', 'genre', 'god') then return new; end if;
  select genre into g from tracks where id = new.track_id;
  perform bump(new.owner, 'cards');
  if new.tier >= 2 then perform bump(new.owner, 'tier2'); end if;
  if new.tier >= 3 then perform bump(new.owner, 'tier3'); end if;
  if new.holo then perform bump(new.owner, 'holo'); end if;
  if g is not null then perform bump(new.owner, 'genre' || g); end if;
  if not exists (select 1 from cards where owner = new.owner and track_id = new.track_id and id <> new.id) then
    perform bump(new.owner, 'new');
  end if;
  return new;
end $$;
create trigger card_pulled after insert on public.cards for each row execute function public.on_card_pulled();

create function public.on_pack_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done then
    perform bump(new.owner, 'packs');
    if new.kind = 'genre' then perform bump(new.owner, 'store_packs'); end if;
  end if;
  return new;
end $$;
create trigger pack_done after update on public.packs for each row execute function public.on_pack_done();

create function public.on_offer_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform bump(new.from_user, 'trades');
    perform bump(new.to_user, 'trades');
  end if;
  return new;
end $$;
create trigger offer_accepted after update on public.offers for each row execute function public.on_offer_accepted();

-- ---------------------------------------------------------------- discarding duplicates
create function public.discard_value(t smallint) returns int language sql immutable set search_path = public as $$
  select case t when 3 then 10 when 4 then 50 when 5 then 100 else 1 end
$$;

-- discard chosen copies; at least one copy of each track always stays in the collection
create function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from cards c where c.owner = uid and c.id = any(p_cards)
             group by c.track_id
             having count(*) >= (select count(*) from cards k where k.owner = uid and k.track_id = c.track_id)) then
    raise exception 'keep_one';
  end if;
  -- offers counting on these copies can no longer happen
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  select coalesce(sum(discard_value(tier)), 0), count(*) into gained, removed from cards where owner = uid and id = any(p_cards);
  delete from cards where owner = uid and id = any(p_cards);
  perform add_streams(uid, gained, 'défausse de ' || removed || ' carte(s)');
  perform bump(uid, 'discards', removed);
  return jsonb_build_object('removed', removed, 'gained', gained);
end $$;

-- discard every duplicate at once: keeps the best copy of each track (holo, then rarity),
-- and leaves alone copies that are part of a pending offer
create function public.discard_all_duplicates() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[];
begin
  select array_agg(id) into ids from (
    select c.id, row_number() over (partition by c.track_id order by c.holo desc, c.tier desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid
      and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = c.id and o.status = 'pending')
  ) x where rn > 1;
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;

-- ---------------------------------------------------------------- daily login streak
create function public.claim_login() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; today date := game_day(); streak int; reward int;
begin
  select * into p from profiles where id = uid for update;
  if p.last_login = today then raise exception 'already_claimed'; end if;
  streak := case when p.last_login = today - 1 then p.login_streak + 1 else 1 end;
  reward := (array[5, 10, 15, 20, 25, 30, 50])[least(streak, 7)];
  update profiles set login_streak = streak, best_streak = greatest(best_streak, streak), last_login = today where id = uid;
  perform add_streams(uid, reward, 'connexion du jour (série de ' || streak || ')');
  return jsonb_build_object('streak', streak, 'reward', reward);
end $$;

-- ---------------------------------------------------------------- daily challenges: 3 per player per day
create table public.daily_defs (
  key text primary key,
  label text not null,
  metric text not null,
  goal int not null,
  reward int not null
);
insert into public.daily_defs values
  ('open3', 'Ouvre 3 boosters', 'packs', 3, 10),
  ('open10', 'Ouvre 10 boosters', 'packs', 10, 25),
  ('new10', 'Tire 10 cartes que tu n''avais pas', 'new', 10, 15),
  ('rare1', 'Tire une Rare ou mieux', 'tier2', 1, 15),
  ('epic1', 'Tire une Épique ou mieux', 'tier3', 1, 40),
  ('holo1', 'Tire une carte Holo', 'holo', 1, 30),
  ('trade1', 'Fais un échange', 'trades', 1, 20),
  ('discard5', 'Défausse 5 doublons', 'discards', 5, 10),
  ('store1', 'Ouvre un pack de la Boutique', 'store_packs', 1, 15),
  ('rap2', 'Tire 2 cartes Rap', 'genre0', 2, 15),
  ('pop2', 'Tire 2 cartes Pop', 'genre1', 2, 15),
  ('rock2', 'Tire 2 cartes Rock', 'genre2', 2, 15),
  ('electro2', 'Tire 2 cartes Électro', 'genre3', 2, 15),
  ('soul2', 'Tire 2 cartes Soul / R&B', 'genre4', 2, 15),
  ('chanson1', 'Tire une carte Chanson', 'genre5', 1, 15),
  ('jazz1', 'Tire une carte Jazz / Blues', 'genre6', 1, 15),
  ('latino1', 'Tire une carte Latino', 'genre7', 1, 15),
  ('afro1', 'Tire une carte Afro / Reggae', 'genre8', 1, 15),
  ('classique1', 'Tire une carte Classique / BO', 'genre9', 1, 15);

create table public.daily_claims (
  owner uuid not null references public.profiles on delete cascade,
  day date not null,
  key text not null references public.daily_defs,
  primary key (owner, day, key)
);

create function public.todays_challenges(p_user uuid) returns setof public.daily_defs
language sql stable security definer set search_path = public as $$
  select * from daily_defs order by md5(p_user::text || game_day()::text || key) limit 3
$$;

create function public.daily_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'day', game_day(),
    'login', (select jsonb_build_object('claimed', p.last_login = game_day(),
                                        'streak', case when p.last_login >= game_day() - 1 then p.login_streak else 0 end,
                                        'next', (array[5, 10, 15, 20, 25, 30, 50])[least(case when p.last_login = game_day() - 1 then p.login_streak + 1 else 1 end, 7)])
              from profiles p where p.id = auth.uid()),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object(
        'key', d.key, 'label', d.label, 'goal', d.goal, 'reward', d.reward,
        'progress', least(d.goal, coalesce((select n from daily_counters c where c.owner = auth.uid() and c.day = game_day() and c.metric = d.metric), 0)),
        'claimed', exists (select 1 from daily_claims k where k.owner = auth.uid() and k.day = game_day() and k.key = d.key)))
      from todays_challenges(auth.uid()) d), '[]'::jsonb))
$$;

create function public.claim_daily(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d daily_defs; done int;
begin
  select * into d from todays_challenges(uid) t where t.key = p_key;
  if d.key is null then raise exception 'not_today'; end if;
  select coalesce(n, 0) into done from daily_counters where owner = uid and day = game_day() and metric = d.metric;
  if coalesce(done, 0) < d.goal then raise exception 'not_done'; end if;
  insert into daily_claims values (uid, game_day(), d.key) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  perform add_streams(uid, d.reward, 'défi du jour : ' || d.label);
  return d.reward;
end $$;

-- ---------------------------------------------------------------- permanent achievements (bronze / argent / or)
create table public.achievements (
  key text primary key,
  pos int not null,
  category text not null,
  label text not null,
  description text not null,
  goals int[] not null,
  rewards int[] not null,
  titles text[] not null
);
insert into public.achievements values
  ('collector', 1, 'Collection', 'Collectionneur', 'Cartes différentes', '{100,1000,10000}', '{50,250,1000}', '{Collectionneur,Archiviste,Encyclopédie}'),
  ('legends', 2, 'Collection', 'Chasseur de légendes', 'Légendaires possédées', '{1,5,25}', '{50,250,1000}', '{Chasseur de légendes,Légende vivante,Panthéon}'),
  ('mythics', 3, 'Collection', 'Mythomane', 'Mythiques possédées', '{5,25,100}', '{50,250,1000}', '{Mythomane,Mythologue,Olympien}'),
  ('holos', 4, 'Collection', 'Brillant', 'Cartes Holo', '{5,25,100}', '{50,250,1000}', '{Brillant,Scintillant,Éblouissant}'),
  ('rainbow', 5, 'Collection', 'Arc-en-ciel', 'Une carte de chaque rareté', '{6}', '{250}', '{Arc-en-ciel}'),
  ('god', 6, 'Collection', 'Élu des dieux', 'Ouvrir un GOD pack', '{1}', '{500}', '{Élu des dieux}'),
  ('digger', 10, 'Musique', 'Diggeur', 'Cartes à moins de 1 000 points de popularité', '{10,100,500}', '{50,250,1000}', '{Diggeur,Diggeur d''argent,Diggeur d''or}'),
  ('zero', 11, 'Musique', 'Personne ne connaît', 'Une carte à 0 écoute', '{1}', '{100}', '{Découvreur}'),
  ('decades', 12, 'Musique', 'Voyage dans le temps', 'Décennies différentes (1950 → 2020)', '{4,6,8}', '{50,250,1000}', '{Voyageur,Historien,Maître du temps}'),
  ('genres', 13, 'Musique', 'Globe-trotteur', 'Genres différents', '{5,8,11}', '{50,250,1000}', '{Globe-trotteur,Éclectique,Omnivore}'),
  ('fan', 14, 'Musique', 'Fan absolu', 'Titres différents d''un même artiste', '{10,25,50}', '{50,250,1000}', '{Fan,Superfan,Fan absolu}'),
  ('alphabet', 15, 'Musique', 'Alphabet', 'Artistes commençant par des lettres différentes', '{10,20,26}', '{50,250,1000}', '{Abécédaire,Lettré,De A à Z}'),
  ('marathon', 16, 'Musique', 'Marathon', 'Un titre de plus de 10 minutes', '{1}', '{100}', '{Marathonien}'),
  ('interlude', 17, 'Musique', 'Interlude', 'Un titre de moins d''une minute', '{1}', '{100}', '{Express}'),
  ('bpm200', 18, 'Musique', '200 BPM', 'Un titre à 200 BPM ou plus', '{1}', '{100}', '{Turbo}'),
  ('trades', 20, 'Échanges et fidélité', 'Négociateur', 'Échanges réussis', '{1,25,100}', '{50,250,1000}', '{Négociateur,Marchand,Magnat}'),
  ('opened', 21, 'Échanges et fidélité', 'Ouvreur compulsif', 'Boosters ouverts', '{100,1000,10000}', '{50,250,1000}', '{Ouvreur,Déballeur,Insatiable}'),
  ('streak', 22, 'Échanges et fidélité', 'Fidèle', 'Jours de connexion d''affilée', '{7,30,365}', '{50,250,1000}', '{Fidèle,Habitué,Inconditionnel}');

create table public.achievement_claims (
  owner uuid not null references public.profiles on delete cascade,
  key text not null references public.achievements,
  tier int not null,
  claimed_at timestamptz not null default now(),
  primary key (owner, key, tier)
);

-- every achievement value, computed from what the player owns and has done
create function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.*, t.artist, t.year, t.genre, t.duration, t.bpm from cards c join tracks t on t.id = c.track_id where c.owner = p_user),
       p as (select * from profiles where id = p_user)
  select jsonb_build_object(
    'collector', (select count(distinct track_id) from c),
    'legends', (select count(*) from c where tier = 5),
    'mythics', (select count(*) from c where tier = 4),
    'holos', (select count(*) from c where holo),
    'rainbow', (select count(distinct tier) from c),
    'god', (select gods from p),
    'digger', (select count(distinct track_id) from c where rank < 1000),
    'zero', (select count(*) from c where rank = 0),
    'decades', (select count(distinct year / 10) from c where year >= 1950),
    'genres', (select count(distinct genre) from c),
    'fan', (select coalesce(max(n), 0) from (select count(distinct track_id) n from c group by lower(artist)) a),
    'alphabet', (select count(distinct upper(left(artist, 1))) from c where upper(left(artist, 1)) between 'A' and 'Z'),
    'marathon', (select count(*) from c where duration > 600),
    'interlude', (select count(*) from c where duration between 1 and 59),
    'bpm200', (select count(*) from c where bpm >= 200),
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'opened', (select opened from p),
    'streak', (select best_streak from p))
$$;

create function public.achievements_state() returns jsonb
language sql stable security definer set search_path = public as $$
  with v as (select achievement_values(auth.uid()) j)
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.key, 'category', a.category, 'label', a.label, 'description', a.description,
    'goals', a.goals, 'rewards', a.rewards, 'titles', a.titles,
    'value', (v.j ->> a.key)::int,
    'claimed', coalesce((select jsonb_agg(tier order by tier) from achievement_claims k where k.owner = auth.uid() and k.key = a.key), '[]'::jsonb))
    order by a.pos), '[]'::jsonb)
  from achievements a, v
$$;

-- claims every tier already reached and not yet paid
create function public.claim_achievement(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); a achievements; val int; i int; total int := 0;
begin
  select * into a from achievements where key = p_key;
  if a.key is null then raise exception 'unknown_achievement'; end if;
  val := (achievement_values(uid) ->> p_key)::int;
  for i in 1..array_length(a.goals, 1) loop
    if val >= a.goals[i] then
      insert into achievement_claims (owner, key, tier) values (uid, p_key, i) on conflict do nothing;
      if found then
        total := total + a.rewards[i];
        perform add_streams(uid, a.rewards[i], 'succès : ' || a.titles[i]);
      end if;
    end if;
  end loop;
  if total = 0 then raise exception 'not_done'; end if;
  return total;
end $$;

-- the title shown next to the pseudo: any title the player has earned (null clears it)
create function public.set_title(p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_title is not null and not exists (
    select 1 from achievement_claims k join achievements a on a.key = k.key
    where k.owner = uid and a.titles[k.tier] = p_title) then
    raise exception 'title_not_earned';
  end if;
  update profiles set title = p_title where id = uid;
end $$;

-- ---------------------------------------------------------------- access
alter table public.stream_ledger enable row level security;
alter table public.daily_counters enable row level security;
alter table public.daily_defs enable row level security;
alter table public.daily_claims enable row level security;
alter table public.achievements enable row level security;
alter table public.achievement_claims enable row level security;
create policy "own ledger" on public.stream_ledger for select to authenticated using (owner = (select auth.uid()));
create policy "daily defs are public" on public.daily_defs for select using (true);
create policy "achievements are public" on public.achievements for select using (true);
create policy "claims are visible to players" on public.achievement_claims for select to authenticated using (true);
revoke insert, update, delete on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int) to anon, authenticated;
grant execute on function public.discard_cards(uuid[]), public.discard_all_duplicates(), public.claim_login(),
  public.daily_state(), public.claim_daily(text), public.achievements_state(), public.claim_achievement(text),
  public.set_title(text) to authenticated;
revoke execute on function public.add_streams(uuid, bigint, text), public.bump(uuid, text, int),
  public.achievement_values(uuid), public.todays_challenges(uuid), public.on_card_pulled(), public.on_pack_done(),
  public.on_offer_accepted(), public.game_day(), public.discard_value(smallint) from authenticated;
