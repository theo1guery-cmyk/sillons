-- Défis stayed empty for big collections: achievements_state() read every card of the player (joined to its track) at
-- each visit, which runs past the time limit with tens of thousands of cards. The card part of the values is now kept
-- per player and computed again only when the collection changed (cards_rev for cards leaving or changing, the number
-- of cards for new ones). The profile values (GOD packs, boosters opened, login streak) are always read fresh.
create table if not exists public.achievement_cache (
  owner uuid primary key references public.profiles on delete cascade,
  rev bigint not null,
  n bigint not null,
  j jsonb not null,
  at timestamptz not null default now()
);
alter table public.achievement_cache enable row level security;   -- no policy: only the functions below read it

create or replace function public.achievement_values_cached(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; n bigint; c achievement_cache; j jsonb; fresh jsonb;
begin
  select * into p from profiles where id = p_user;
  fresh := jsonb_build_object('god', coalesce(p.gods, 0), 'opened', coalesce(p.opened, 0), 'streak', coalesce(p.best_streak, 0));
  select count(*) into n from cards where owner = p_user;
  select * into c from achievement_cache where owner = p_user;
  if c.owner is not null and c.rev = p.cards_rev and c.n = n then return c.j || fresh; end if;
  begin
    j := achievement_values(p_user);
  exception when query_canceled then
    if c.owner is not null then return c.j || fresh; end if;   -- too slow right now: the last known values
    raise;
  end;
  insert into achievement_cache (owner, rev, n, j, at) values (p_user, p.cards_rev, n, j, now())
  on conflict (owner) do update set rev = excluded.rev, n = excluded.n, j = excluded.j, at = now();
  return j || fresh;
end $$;

create or replace function public.achievements_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v jsonb;
begin
  if uid is null then return '[]'::jsonb; end if;
  v := achievement_values_cached(uid);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.key, 'category', a.category, 'label', a.label, 'description', a.description,
    'goals', a.goals, 'rewards', a.rewards, 'titles', a.titles,
    'value', coalesce((v ->> a.key)::int, 0),
    'claimed', coalesce((select jsonb_agg(tier order by tier) from achievement_claims k where k.owner = uid and k.key = a.key), '[]'::jsonb))
    order by a.pos), '[]'::jsonb)
  from achievements a);
end $$;

create or replace function public.claim_achievement(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); a achievements; val int; i int; total int := 0;
begin
  select * into a from achievements where key = p_key;
  if a.key is null then raise exception 'unknown_achievement'; end if;
  val := (achievement_values_cached(uid) ->> p_key)::int;
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

revoke execute on function public.achievement_values_cached(uuid) from public, anon, authenticated;
revoke execute on function public.achievements_state(), public.claim_achievement(text) from public, anon;
grant execute on function public.achievements_state(), public.claim_achievement(text) to authenticated;
