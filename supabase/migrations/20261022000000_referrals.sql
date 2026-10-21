-- Referrals. Every player has a link (…/?parrain=pseudo). A friend who signs up with it (or types the pseudo within
-- 7 days of signing up) gets 10 boosters, 500 Streams and an Édition Deluxe at once. The referrer is rewarded when the
-- friend really plays: 50 boosters opened on at least 5 different days (so fake accounts are not worth it). Then the
-- referrer gets 500 Streams per active friend (up to 50), and steps: 1 Édition Deluxe, 2 a Mythique, 3 a Légendaire,
-- 5 the VIP pass of the season, 10 a Légendaire Shiny, 20 the VIP pass of the next season.

create table if not exists public.referrals (
  referee uuid primary key references public.profiles on delete cascade,
  referrer uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  active_at timestamptz
);
create index if not exists referrals_referrer_idx on public.referrals (referrer);
alter table public.referrals enable row level security;          -- read through my_referral() only

create table if not exists public.referral_steps (
  owner uuid not null references public.profiles on delete cascade,
  step int not null,
  at timestamptz not null default now(),
  primary key (owner, step)
);
alter table public.referral_steps enable row level security;

alter table public.profiles add column if not exists vip_next_after int;   -- VIP pass owed for the season after this one

create or replace function public.referral_steps_def() returns table (n int, kind text, label text)
language sql immutable as $$
  values (1, 'deluxe', 'Une Édition Deluxe'), (2, 'mythic', 'Une carte Mythique'), (3, 'legend', 'Une carte Légendaire'),
         (5, 'vip', 'Le Pass VIP de la saison'), (10, 'shiny', 'Une Légendaire Shiny'), (20, 'vip_next', 'Le Pass VIP de la saison suivante')
$$;

-- the VIP pass of the current season (500 Vinyles, its price, if the player already has it)
create or replace function public.referral_give_vip(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons := current_season();
begin
  if s.id is null then update profiles set vip_next_after = 0 where id = p_user; return; end if;   -- no season now: the next one
  if exists (select 1 from season_progress where owner = p_user and season_id = s.id and premium) then
    perform add_vinyls(p_user, 500, 'parrainage : Pass VIP (déjà actif)');
  else
    insert into season_progress (owner, season_id, premium) values (p_user, s.id, true)
    on conflict (owner, season_id) do update set premium = true;
  end if;
end $$;

-- the VIP pass owed for a later season, given as soon as that season is on
create or replace function public.referral_vip_apply(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons := current_season(); after int;
begin
  select vip_next_after into after from profiles where id = p_user;
  if after is null or s.id is null or s.id <= after then return; end if;
  update profiles set vip_next_after = null where id = p_user;
  perform referral_give_vip(p_user);
  insert into notifications (owner, type, title) values (p_user, 'referral', 'Ton Pass VIP de parrainage est activé pour cette saison !');
end $$;

-- a friend just became active: the referrer's rewards
create or replace function public.referral_activate(p_referee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid; who text; cnt int; d record; s seasons;
begin
  update referrals set active_at = now() where referee = p_referee and active_at is null returning referrer into r;
  if r is null then return; end if;
  select pseudo into who from profiles where id = p_referee;
  select count(*) into cnt from referrals where referrer = r and active_at is not null;
  if cnt <= 50 then perform add_streams(r, 500, 'parrainage : ' || coalesce(who, '?') || ' est actif'); end if;
  insert into notifications (owner, type, title) values (r, 'referral', coalesce(who, 'Ton filleul') || ' est maintenant actif : +500 Streams !');
  for d in select * from referral_steps_def() x where x.n <= cnt order by x.n loop
    insert into referral_steps (owner, step) values (r, d.n) on conflict do nothing;
    continue when not found;
    if d.kind = 'deluxe' then update profiles set big_packs = big_packs + 1 where id = r;
    elsif d.kind = 'mythic' then perform give_card(r, 'track', 4::smallint, false, 'referral');
    elsif d.kind = 'legend' then perform give_card(r, 'track', 5::smallint, false, 'referral');
    elsif d.kind = 'shiny' then perform give_card(r, 'track', 5::smallint, true, 'referral');
    elsif d.kind = 'vip' then perform referral_give_vip(r);
    elsif d.kind = 'vip_next' then s := current_season(); update profiles set vip_next_after = coalesce(s.id, 0) where id = r;
    end if;
    if d.n = 1 then insert into player_titles (owner, title) values (r, 'Parrain') on conflict do nothing; end if;
    if d.n = 10 then insert into player_titles (owner, title) values (r, 'Ambassadeur') on conflict do nothing; end if;
    insert into notifications (owner, type, title) values (r, 'referral', 'Palier de parrainage ' || d.n || ' : ' || lower(left(d.label, 1)) || substr(d.label, 2) || ' !');
  end loop;
end $$;

-- after each booster: is this player a friend who just became active?
create or replace function public.referral_on_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from referrals where referee = new.id and active_at is null)
     and (select count(distinct (created_at at time zone 'Europe/Paris')::date) from packs where owner = new.id and done) >= 5 then
    perform referral_activate(new.id);
  end if;
  return new;
exception when others then return new;      -- never block an opening
end $$;
drop trigger if exists referral_on_open on public.profiles;
create trigger referral_on_open after update of opened on public.profiles
  for each row when (new.opened >= 50 and new.opened > old.opened) execute function public.referral_on_open();

-- the friend says who invited them (from the link, or typed within 7 days)
create or replace function public.set_referrer(p_pseudo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r profiles; mine profiles;
begin
  select * into mine from profiles where id = uid;
  if exists (select 1 from referrals where referee = uid) then raise exception 'already_referred'; end if;
  if mine.created_at < now() - interval '7 days' then raise exception 'referral_too_late'; end if;
  select * into r from profiles where lower(pseudo) = lower(trim(p_pseudo));
  if r.id is null then raise exception 'referrer_not_found'; end if;
  if r.id = uid or exists (select 1 from referrals where referee = r.id and referrer = uid) then raise exception 'referral_self'; end if;
  insert into referrals (referee, referrer) values (uid, r.id);
  update profiles set stock = stock + 10, big_packs = big_packs + 1 where id = uid;
  perform add_streams(uid, 500, 'parrainage : bienvenue de la part de ' || r.pseudo);
  insert into notifications (owner, type, title) values (r.id, 'referral', coalesce(mine.pseudo, 'Un ami') || ' s''est inscrit avec ton lien ! Il compte dès 50 boosters ouverts sur 5 jours.');
  return jsonb_build_object('referrer', r.pseudo);
end $$;

-- everything the Parrainage panel shows
create or replace function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); mine profiles; cnt int;
begin
  perform referral_vip_apply(uid);
  select * into mine from profiles where id = uid;
  select count(*) into cnt from referrals where referrer = uid and active_at is not null;
  return jsonb_build_object(
    'code', mine.pseudo,
    'referrer', (select p.pseudo from referrals x join profiles p on p.id = x.referrer where x.referee = uid),
    'can_set', not exists (select 1 from referrals where referee = uid) and mine.created_at > now() - interval '7 days',
    'active', cnt,
    'vip_next', mine.vip_next_after is not null,
    'steps', (select jsonb_agg(jsonb_build_object('n', d.n, 'kind', d.kind, 'label', d.label,
                'done', exists (select 1 from referral_steps k where k.owner = uid and k.step = d.n)) order by d.n) from referral_steps_def() d),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('pseudo', p.pseudo, 'opened', least(p.opened, 50), 'active', x.active_at is not null,
                'days', least(5, (select count(distinct (k.created_at at time zone 'Europe/Paris')::date) from packs k where k.owner = x.referee and k.done)))
                order by x.active_at is null, x.created_at desc)
              from (select * from referrals where referrer = uid order by created_at desc limit 100) x join profiles p on p.id = x.referee), '[]'));
end $$;

-- the pass page gives the VIP pass owed by the referral as soon as the new season is on
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

revoke execute on function public.referral_steps_def(), public.referral_give_vip(uuid), public.referral_vip_apply(uuid),
  public.referral_activate(uuid), public.referral_on_open() from public, anon, authenticated;
revoke execute on function public.set_referrer(text), public.my_referral() from public, anon;
grant execute on function public.set_referrer(text), public.my_referral() to authenticated;
