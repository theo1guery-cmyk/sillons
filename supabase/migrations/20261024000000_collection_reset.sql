-- Collection reset ("grand ménage") for a few accounts chosen by the admin: the player picks the cards to keep, every
-- other card is deleted, as if it had never existed:
--   * a deleted graded card leaves no trace: the copies of that card still graded are numbered again (#001, #002…)
--     in the order they were graded, and the next one graded takes the next number;
--   * albums no longer complete and discographies whose collector card is gone can be completed and claimed again.
-- Big collections are deleted in steps (a call per step) so no call runs too long.
create table if not exists public.collection_resets (
  owner uuid primary key references public.profiles on delete cascade,
  keep uuid[],
  started_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.collection_resets enable row level security;
create table if not exists public.collection_reset_refs (       -- the graded cards deleted: their numbering is redone at the end
  kind text not null, ref bigint not null, tier smallint not null, primary key (kind, ref, tier)
);
alter table public.collection_reset_refs enable row level security;

insert into public.collection_resets (owner)
select id from public.profiles where lower(pseudo) in ('toutoune', 'hope91', 'tyt23')
on conflict (owner) do nothing;

create or replace function public.collection_reset_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); r collection_resets;
begin
  select * into r from collection_resets where owner = uid and done_at is null;
  if r.owner is null then return null; end if;
  return jsonb_build_object('started', r.started_at is not null, 'kept', coalesce(cardinality(r.keep), 0));
end $$;

create or replace function public.collection_reset_start(p_keep uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r collection_resets; kept uuid[];
begin
  select * into r from collection_resets where owner = uid and done_at is null for update;
  if r.owner is null then raise exception 'no_reset'; end if;
  if r.started_at is not null then return jsonb_build_object('left', (select count(*) from cards where owner = uid and id <> all(r.keep))); end if;
  select coalesce(array_agg(id), '{}') into kept from cards where owner = uid and id = any(coalesce(p_keep, '{}'));
  update collection_resets set keep = kept, started_at = now() where owner = uid;
  return jsonb_build_object('left', (select count(*) from cards where owner = uid and id <> all(kept)));
end $$;

create or replace function public.collection_reset_step() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r collection_resets; ids uuid[]; left_n bigint; k record; cnt int;
begin
  select * into r from collection_resets where owner = uid and done_at is null and started_at is not null for update;
  if r.owner is null then raise exception 'no_reset'; end if;
  select array_agg(id) into ids from (select id from cards where owner = uid and id <> all(r.keep) limit 8000) x;
  if ids is not null then
    insert into collection_reset_refs (kind, ref, tier)
    select distinct kind, coalesce(track_id, artist_id), tier from cards where id = any(ids) and grade is not null
    on conflict do nothing;
    update offers set status = 'expired', decided_at = now()
    where status = 'pending' and id in (select offer_id from offer_items where card_id = any(ids));
    delete from cards where id = any(ids);
  end if;
  select count(*) into left_n from cards where owner = uid and id <> all(r.keep);
  if left_n > 0 then return jsonb_build_object('left', left_n, 'done', false); end if;
  -- the end: the numbering of the graded cards that were deleted is redone, as if they had never been graded
  for k in select * from collection_reset_refs loop
    with o as (select id, row_number() over (order by graded_at, grade_cert) rn from cards
               where kind = k.kind and coalesce(track_id, artist_id) = k.ref and tier = k.tier and grade is not null)
    update cards c set grade_pop = o.rn from o where c.id = o.id and c.grade_pop is distinct from o.rn;
    select count(*) into cnt from cards where kind = k.kind and coalesce(track_id, artist_id) = k.ref and tier = k.tier and grade is not null;
    update grade_pop set n = cnt where grade_pop.kind = k.kind and grade_pop.ref = k.ref and grade_pop.tier = k.tier;
  end loop;
  delete from collection_reset_refs;
  -- albums no longer complete, and discographies whose collector card is gone: they can be completed again
  delete from album_claims ac where ac.owner = uid and exists (
    select 1 from albums a, jsonb_array_elements(a.tracks) e where a.id = ac.album_id
      and not exists (select 1 from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint));
  delete from disco_claims dc where dc.owner = uid
    and not exists (select 1 from cards c where c.owner = uid and c.kind = 'artist' and c.artist_id = dc.artist_id and c.collector);
  delete from achievement_cache where owner = uid;
  update collection_resets set done_at = now() where owner = uid;
  return jsonb_build_object('left', 0, 'done', true);
end $$;

revoke execute on function public.collection_reset_state(), public.collection_reset_start(uuid[]), public.collection_reset_step() from public, anon;
grant execute on function public.collection_reset_state(), public.collection_reset_start(uuid[]), public.collection_reset_step() to authenticated;
