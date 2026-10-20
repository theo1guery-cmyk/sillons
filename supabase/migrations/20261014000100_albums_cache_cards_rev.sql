-- Albums tab: computed once and kept. For a 90 000-card collection my_albums_fast read about 37 MB and ran past the
-- 8 s limit, so the tab stopped loading. Now the owned tracks are made distinct first (one album lookup per track
-- instead of per card), and the result is kept in album_cache with a signature of the collection (track cards count
-- and sum of their ids, albums claimed). Opening the tab again only checks the signature (index only); it is computed
-- again when the collection changed, or after an hour (albums completed meanwhile by the backfill).
create table if not exists public.album_cache (
  owner uuid primary key references auth.users on delete cascade,
  sig text not null,
  data jsonb not null,
  at timestamptz not null default now()
);
alter table public.album_cache enable row level security;      -- no policy: only my_albums_fast reads and writes it

-- [id, title, artist, artist_id, cover, year, record_type, total, complete, owned, claimed]
create or replace function public.my_albums_fast() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s text; c album_cache; res jsonb;
begin
  if uid is null then return jsonb_build_object('albums', '[]'::jsonb, 'pending', 0); end if;
  select count(*) || ':' || coalesce(sum(track_id), 0) || ':' || (select count(*) from album_claims where owner = uid)
    into s from cards where owner = uid and track_id is not null;
  select * into c from album_cache where owner = uid;
  if c.owner is not null and c.sig = s and c.at > now() - interval '1 hour' then return c.data; end if;

  with mine as (select distinct track_id from cards where owner = uid and track_id is not null),
       tr as (select t.album_id from mine join tracks t on t.id = mine.track_id),
       own as (select album_id id, count(*) n from tr where album_id > 0 group by album_id),
       cl as (select album_id from album_claims where owner = uid)
  select jsonb_build_object(
    'albums', coalesce((select jsonb_agg(jsonb_build_array(a.id, a.title, a.artist, a.artist_id, a.cover, a.year, a.record_type,
                                                           a.n_tracks, a.complete, least(own.n, a.n_tracks), cl.album_id is not null))
                        from own join albums a on a.id = own.id and a.record_type in ('album', 'ep') left join cl on cl.album_id = a.id), '[]'),
    'pending', (select count(*) from cards cc join tracks t on t.id = cc.track_id where cc.owner = uid and t.album_id is null))
  into res;
  insert into album_cache (owner, sig, data, at) values (uid, s, res, now())
  on conflict (owner) do update set sig = excluded.sig, data = excluded.data, at = now();
  return res;
end $$;
revoke execute on function public.my_albums_fast() from public, anon;
grant execute on function public.my_albums_fast() to authenticated;

-- Collection kept in the browser: at sign-in it only downloads the cards pulled since its last visit. A card that
-- leaves or changes (trade, sale, discard, flag) bumps the owner's cards_rev, and a browser holding an older
-- cards_rev downloads the whole collection again. New cards need no bump: they come after the last one seen.
alter table public.profiles add column if not exists cards_rev bigint not null default 0;

create or replace function public.cards_rev_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update profiles set cards_rev = cards_rev + 1 where id in (select distinct owner from old_cards);
  else
    update profiles set cards_rev = cards_rev + 1
    where id in (select owner from old_cards union select owner from new_cards);
  end if;
  return null;
end $$;
revoke execute on function public.cards_rev_bump() from public, anon, authenticated;

drop trigger if exists cards_rev_delete on public.cards;
create trigger cards_rev_delete after delete on public.cards
  referencing old table as old_cards for each statement execute function public.cards_rev_bump();
drop trigger if exists cards_rev_update on public.cards;
create trigger cards_rev_update after update on public.cards
  referencing old table as old_cards new table as new_cards for each statement execute function public.cards_rev_bump();
