-- Season pass: once a card reward has arrived (as the last card of a booster), the pass shows the card the player really
-- got instead of examples. season_cards remembers each card reward claimed; the card itself is found the next time the
-- pass is opened: the first offered card of that kind and rarity pulled after the claim. Rewards claimed before this
-- migration are matched from the start of the season. my_season() and claim_season() are the ones from
-- 20261011000200_season_pass.sql, plus that.
create table public.season_cards (
  owner uuid not null references public.profiles on delete cascade,
  season_id int not null references public.seasons on delete cascade,
  tier smallint not null,
  premium boolean not null,
  kind text not null,
  card_tier smallint not null,
  shiny boolean not null default false,
  claimed_at timestamptz not null default now(),
  card_id uuid references public.cards on delete set null,
  primary key (owner, season_id, tier, premium)
);
alter table public.season_cards enable row level security;

-- the card rewards already claimed
insert into public.season_cards (owner, season_id, tier, premium, kind, card_tier, shiny, claimed_at)
select p.owner, p.season_id, x.t, x.prem, r -> 'card' ->> 'kind', (r -> 'card' ->> 'tier')::smallint, (r -> 'card' ->> 'shiny')::boolean, s.starts_at
from public.season_progress p join public.seasons s on s.id = p.season_id
cross join lateral (select unnest(p.claimed_free) t, false prem union all select unnest(p.claimed_premium), true) x
cross join lateral (select public.season_reward(x.t, x.prem) r) rr
where r ->> 'kind' = 'card'
on conflict do nothing;

create function public.season_resolve(p_user uuid, p_season int) returns void
language plpgsql security definer set search_path = public as $$
declare g season_cards; found_id uuid;
begin
  for g in select * from season_cards where owner = p_user and season_id = p_season and card_id is null order by claimed_at desc, tier desc loop   -- newest first: each takes the first card after its own claim
    select k.id into found_id from cards k
    where k.owner = p_user and k.gifted and k.pulled_at >= g.claimed_at and k.kind = g.kind and k.tier = g.card_tier and (not g.shiny or k.holo)
      and not exists (select 1 from season_cards x where x.card_id = k.id)
    order by k.pulled_at, k.id limit 1;
    if found_id is not null then
      update season_cards set card_id = found_id where owner = g.owner and season_id = g.season_id and tier = g.tier and premium = g.premium;
    end if;
  end loop;
end $$;

create or replace function public.my_season() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress;
begin
  if s.id is null then return null; end if;
  perform season_resolve(uid, s.id);
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

create or replace function public.claim_season(p_tier int, p_premium boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); s seasons := shown_season(); p season_progress; r jsonb; c jsonb;
begin
  if s.id is null then raise exception 'no_season'; end if;
  select * into p from season_progress where owner = uid and season_id = s.id for update;
  if p.owner is null or p_tier < 1 or p_tier > s.tiers or p.xp / s.xp_per_tier < p_tier then raise exception 'tier_locked'; end if;
  if p_premium and not p.premium then raise exception 'premium_only'; end if;
  if (case when p_premium then p.claimed_premium else p.claimed_free end) @> array[p_tier::smallint] then raise exception 'already_claimed'; end if;
  r := season_reward(p_tier, p_premium);
  if r ->> 'kind' = 'streams' then
    perform add_streams(uid, (r ->> 'amount')::int, 'Pass saisonnier : palier ' || p_tier);
  elsif r ->> 'kind' = 'boosters' then
    update profiles set stock = stock + (r ->> 'amount')::int where id = uid;
  else
    c := r -> 'card';
    insert into forced_cards (id, kind, tier, shiny) values (uid, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean)
    on conflict (id) do nothing;
    if not found then raise exception 'gift_pending'; end if;
    insert into season_cards (owner, season_id, tier, premium, kind, card_tier, shiny)
    values (uid, s.id, p_tier, p_premium, c ->> 'kind', (c ->> 'tier')::smallint, (c ->> 'shiny')::boolean) on conflict do nothing;
  end if;
  if p_premium then update season_progress set claimed_premium = claimed_premium || p_tier::smallint where owner = uid and season_id = s.id;
  else update season_progress set claimed_free = claimed_free || p_tier::smallint where owner = uid and season_id = s.id; end if;
  return r;
end $$;

revoke execute on function public.season_resolve(uuid, int) from public, anon, authenticated;
