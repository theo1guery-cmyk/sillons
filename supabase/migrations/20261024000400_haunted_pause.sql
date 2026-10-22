-- Collection Hantée in maintenance (the cards' design is being redone): no copy comes out of boosters, the Pack Hanté
-- is closed, the board and the announcement say so. The copies already found stay with their owners. To reopen:
--   update public.haunted_meta set paused = false where id = 1;
-- (the pacing catches up by itself: the time lost raises the chance afterwards)
alter table public.haunted_meta add column if not exists paused boolean not null default false;
update public.haunted_meta set paused = true where id = 1;

create or replace function public.haunted_chance() returns double precision
language plpgsql security definer set search_path = public as $$
declare m haunted_meta; left_n int; hours double precision; today bigint; yday bigint; since double precision;
begin
  select * into m from haunted_meta where id = 1;
  if not halloween_on() or now() >= m.ends_at or m.paused then return 0; end if;
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

create or replace function public.haunted_pack_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); slots smallint[] := '{}'; arts boolean[] := '{}'; i int; pack_id uuid;
begin
  if not halloween_on() then raise exception 'event_over'; end if;
  if (select paused from haunted_meta where id = 1) then raise exception 'haunted_paused'; end if;
  if (select count(*) from packs where owner = uid and not done and not parked) >= 3 then raise exception 'too_many_open_packs'; end if;
  if (select pumpkins from profiles where id = uid for update) < 100 then raise exception 'not_enough_pumpkins'; end if;
  update profiles set pumpkins = pumpkins - 100 where id = uid;
  for i in 1..5 loop slots := slots || greatest(roll_tier(), 2::smallint); arts := arts || false; end loop;
  insert into packs (owner, kind, genre, slots, god, artist_slots, paid_with, paid, haunted)
  values (uid, 'booster', null, slots, false, arts, 'pumpkins', 100, true) returning id into pack_id;
  return jsonb_build_object('id', pack_id, 'slots', to_jsonb(slots), 'artists', to_jsonb(arts), 'god', false);
end $$;

create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', h.owner = uid) order by h.no), '[]')
                   from haunted_cards h left join profiles p on p.id = h.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;
