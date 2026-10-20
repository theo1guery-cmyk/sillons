-- Graded cards. A copy can be sent for grading: it comes back sealed in a case with a grade from 4 to 10 (10 is rare),
-- a certificate number, and its rank among all the copies of that card (same track or artist, same rarity) ever
-- graded: the first one is #001. The price depends on the rarity. The case can be cracked (free) to get the raw card
-- back and grade it again; its number is never given out again. A graded card keeps its grade when traded or sold,
-- and is never discarded.

alter table public.cards
  add column grade smallint check (grade between 1 and 10),
  add column grade_cert bigint unique,
  add column grade_pop int,
  add column graded_at timestamptz;
create index cards_graded_idx on public.cards (grade desc, graded_at) where grade is not null;

create sequence public.grade_cert_seq start 10000001;
create table public.grade_pop (                 -- how many copies of a card have been graded so far
  kind text not null, ref bigint not null, tier smallint not null, n int not null default 0,
  primary key (kind, ref, tier)
);
alter table public.grade_pop enable row level security;      -- read through the functions only

create function public.grade_price(p_tier smallint) returns int language sql immutable set search_path = public as $$
  select (array[25, 50, 100, 250, 600, 1500])[p_tier + 1]
$$;

create function public.roll_grade() returns smallint language plpgsql volatile set search_path = public as $$
declare r double precision := random();
begin
  return case when r < 0.03 then 10 when r < 0.25 then 9 when r < 0.55 then 8 when r < 0.80 then 7
              when r < 0.90 then 6 when r < 0.96 then 5 else 4 end;
end $$;

create function public.grade_card(p_card uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c cards; price int; g smallint; pop int; cert bigint; label text;
begin
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null then raise exception 'card_not_owned'; end if;
  if c.grade is not null then raise exception 'already_graded'; end if;
  if is_listed(p_card) then raise exception 'card_listed'; end if;
  if card_in_duel(p_card) then raise exception 'card_in_duel'; end if;
  if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id = p_card) then
    raise exception 'card_in_offer';
  end if;
  price := grade_price(c.tier);
  if (select streams from profiles where id = uid) < price then raise exception 'not_enough_streams'; end if;
  label := coalesce((select title from tracks where id = c.track_id), (select name from artists where id = c.artist_id), '?');
  perform add_streams(uid, -price, 'gradation : ' || label);
  g := roll_grade();
  insert into grade_pop (kind, ref, tier, n) values (c.kind, coalesce(c.track_id, c.artist_id), c.tier, 1)
  on conflict (kind, ref, tier) do update set n = grade_pop.n + 1 returning n into pop;
  cert := nextval('grade_cert_seq');
  update cards set grade = g, grade_cert = cert, grade_pop = pop, graded_at = now() where id = p_card;
  return jsonb_build_object('grade', g, 'cert', cert, 'pop', pop, 'price', price);
end $$;

-- crack the case: the raw card comes back, ready to be graded again (and paid again)
create function public.crack_slab(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c cards;
begin
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null then raise exception 'card_not_owned'; end if;
  if c.grade is null then raise exception 'not_graded'; end if;
  if is_listed(p_card) then raise exception 'card_listed'; end if;
  if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id = p_card) then
    raise exception 'card_in_offer';
  end if;
  update cards set grade = null, grade_cert = null, grade_pop = null, graded_at = null where id = p_card;
end $$;

-- the register: the best graded cards of everyone (10s first, then the oldest), and how many of each grade exist
create function public.grade_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(x) from (
      select c.id, c.kind, c.track_id, c.artist_id, c.tier, c.rank, c.holo, c.grade, c.grade_cert as cert, c.grade_pop as pop, c.graded_at,
             p.pseudo as owner, t.title, t.artist, t.album, t.cover, t.year, t.genre, t.duration, t.bpm, t.explicit,
             a.name as artist_name, a.picture, a.fans, a.nb_album
      from cards c join profiles p on p.id = c.owner left join tracks t on t.id = c.track_id left join artists a on a.id = c.artist_id
      where c.grade is not null order by c.grade desc, c.tier desc, c.graded_at limit 30) x), '[]'),
    'counts', coalesce((select jsonb_object_agg(grade, n) from (select grade, count(*) n from cards where grade is not null group by grade) y), '{}'))
$$;

revoke execute on function public.roll_grade() from public, anon, authenticated;
grant execute on function public.grade_card(uuid), public.crack_slab(uuid), public.grade_board(), public.grade_price(smallint) to authenticated;

-- a graded card is never discarded, and "discard my duplicates" keeps the graded copy
create or replace function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from cards where id = any(p_cards) and collector) then raise exception 'collector_card'; end if;
  if exists (select 1 from cards where id = any(p_cards) and grade is not null) then raise exception 'graded_card'; end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then
    raise exception 'card_listed';
  end if;
  if exists (select 1 from (select kind, coalesce(track_id, artist_id) as ref, tier, count(*) as n
                            from cards where owner = uid and id = any(p_cards) group by 1, 2, 3) d
             where d.n >= (select count(*) from cards k where k.owner = uid and k.kind = d.kind
                           and coalesce(k.track_id, k.artist_id) = d.ref and k.tier = d.tier)) then
    raise exception 'keep_one';
  end if;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  select coalesce(sum(discard_value(tier)), 0), count(*) into gained, removed from cards where owner = uid and id = any(p_cards);
  delete from cards where owner = uid and id = any(p_cards);
  perform add_streams(uid, gained, 'défausse de ' || removed || ' carte(s)');
  perform bump(uid, 'discards', removed);
  return jsonb_build_object('removed', removed, 'gained', gained);
end $$;

create or replace function public.discard_all_duplicates() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[];
begin
  select array_agg(id) into ids from (
    select c.id, c.collector, c.grade, row_number() over (partition by c.kind, coalesce(c.track_id, c.artist_id), c.tier order by
             c.collector desc, (c.grade is not null) desc, c.grade desc nulls last,
             (exists (select 1 from listings l where l.card_id = c.id and l.status = 'active')) desc,
             c.holo desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid
  ) x where rn > 1 and not x.collector and x.grade is null
    and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = x.id and o.status = 'pending')
    and not exists (select 1 from listings l where l.card_id = x.id and l.status = 'active' and l.expires_at > now());
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;
