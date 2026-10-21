-- Season XP, redone: even the VIP players hardly moved. Every action now gives XP directly, the VIP pass gives +50 %,
-- the daily ceiling is 600 XP (900 VIP), and an XP boost (x2 until the end of season 1) multiplies gains and ceiling.
--   booster 10 · Édition Deluxe 30 · GOD pack 100 · daily challenge 50 · login bonus 25 · other Streams won: 1 XP per 5
-- (a booster paid with Vinyles still gives none; market sales, refunds, gifts, discards and pass rewards give none)
alter table public.settings add column if not exists xp_boost numeric not null default 1;
alter table public.settings add column if not exists xp_boost_until timestamptz;
update public.settings set xp_boost = 2, xp_boost_until = '2026-11-11 00:00+01' where id = 1;

create or replace function public.season_xp_boost() returns numeric
language sql stable security definer set search_path = public as $$
  select case when xp_boost_until is null or now() < xp_boost_until then greatest(1, xp_boost) else 1 end from settings where id = 1
$$;
create or replace function public.season_xp_vip(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from season_progress sp join seasons se on se.id = sp.season_id
                 where sp.owner = p_user and sp.premium and now() >= se.starts_at and now() < se.ends_at)
$$;
create or replace function public.season_xp_cap(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select (case when season_xp_vip(p_user) then 900 else 600 end * season_xp_boost())::int
$$;

create or replace function public.season_add_xp(p_user uuid, p_xp int) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons := current_season(); done int; n int;
begin
  if s.id is null or coalesce(p_xp, 0) <= 0 then return; end if;
  n := round(p_xp * case when season_xp_vip(p_user) then 1.5 else 1 end * season_xp_boost());
  done := coalesce((select d.n from daily_counters d where d.owner = p_user and d.day = game_day() and d.metric = 'season_xp'), 0);
  n := least(n, season_xp_cap(p_user) - done);
  if n <= 0 then return; end if;
  perform bump(p_user, 'season_xp', n);
  insert into season_progress (owner, season_id, xp) values (p_user, s.id, n)
  on conflict (owner, season_id) do update set xp = season_progress.xp + excluded.xp;
end $$;

create or replace function public.on_pack_season_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done and new.paid_with is distinct from 'vinyls' then   -- a booster bought with Vinyles gives no XP
    perform season_add_xp(new.owner, case when new.god then 100 when new.kind = 'big' then 30 else 10 end);
  end if;
  return new;
exception when others then return new;            -- XP never breaks a booster
end $$;

create or replace function public.on_ledger_season_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 and new.reason !~ '^(vente au marché|remboursement|cadeau|défausse|Pass saisonnier)' then
    perform season_add_xp(new.owner, case when new.reason like 'défi du jour%' then 50
                                          when new.reason like 'connexion du jour%' then 25
                                          else greatest(1, new.amount / 5)::int end);
  end if;
  return new;
exception when others then return new;
end $$;

-- the pass page also gets the XP of the day, the ceiling, the VIP bonus and the boost
create or replace function public.my_season() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress;
begin
  if s.id is null then return null; end if;
  perform season_resolve(uid, s.id);
  perform referral_vip_apply(uid);
  select * into p from season_progress where owner = uid and season_id = s.id;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'tiers', s.tiers, 'xp_per_tier', s.xp_per_tier,
    'xp', coalesce(p.xp, 0), 'premium', coalesce(p.premium, false),
    'claimed_free', to_jsonb(coalesce(p.claimed_free, '{}')), 'claimed_premium', to_jsonb(coalesce(p.claimed_premium, '{}')),
    'gift_pending', exists (select 1 from forced_cards where id = uid),
    'xp_today', coalesce((select d.n from daily_counters d where d.owner = uid and d.day = game_day() and d.metric = 'season_xp'), 0),
    'xp_cap', season_xp_cap(uid), 'xp_vip', season_xp_vip(uid), 'xp_boost', season_xp_boost(),
    'xp_boost_until', (select xp_boost_until from settings where id = 1),
    'rewards', (select jsonb_agg(jsonb_build_object('tier', t, 'free', season_reward(t, false), 'premium', season_reward(t, true)) order by t)
                from generate_series(1, s.tiers) t),
    'got', coalesce((select jsonb_agg(jsonb_build_object('tier', g.tier, 'premium', g.premium, 'card', jsonb_build_object(
        'id', k.id, 'kind', k.kind, 'tier', k.tier, 'holo', k.holo, 'rank', k.rank, 'track_id', k.track_id, 'artist_id', k.artist_id,
        'title', t.title, 'artist', t.artist, 'album', t.album, 'cover', t.cover, 'duration', t.duration, 'bpm', t.bpm, 'year', t.year,
        'explicit', t.explicit, 'genre', t.genre, 'name', a.name, 'picture', a.picture, 'fans', a.fans, 'nb_album', a.nb_album)))
      from season_cards g join cards k on k.id = g.card_id and k.owner = uid
      left join tracks t on t.id = k.track_id left join artists a on a.id = k.artist_id
      where g.owner = uid and g.season_id = s.id), '[]'));
end $$;


revoke execute on function public.season_xp_boost(), public.season_xp_vip(uuid), public.season_xp_cap(uuid) from public, anon, authenticated;
