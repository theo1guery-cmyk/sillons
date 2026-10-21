-- Grand ménage, fix: the last step did everything at once (last cards, renumbering every graded card, albums) and went
-- past the server's time limit, so it was undone each time. Now each call does one small piece of the work.

-- finds the graded copies of one card quickly (the renumbering reads them)
create index if not exists cards_graded_ref_idx on public.cards (kind, (coalesce(track_id, artist_id)), tier) where grade is not null;

create or replace function public.collection_reset_step() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r collection_resets; ids uuid[]; left_n bigint; k record; cnt int; todo int;
begin
  select * into r from collection_resets where owner = uid and done_at is null and started_at is not null for update;
  if r.owner is null then raise exception 'no_reset'; end if;
  -- 1. the cards that are not kept, 2000 at a time
  select array_agg(id) into ids from (select id from cards where owner = uid and id <> all(r.keep) limit 2000) x;
  if ids is not null then
    insert into collection_reset_refs (kind, ref, tier)
    select distinct kind, coalesce(track_id, artist_id), tier from cards where id = any(ids) and grade is not null
    on conflict do nothing;
    update offers set status = 'expired', decided_at = now()
    where status = 'pending' and id in (select offer_id from offer_items where card_id = any(ids));
    delete from cards where id = any(ids);
    select count(*) into left_n from cards where owner = uid and id <> all(r.keep);
    return jsonb_build_object('left', left_n, 'done', false);
  end if;
  -- 2. the numbering of the graded cards that were deleted is redone, as if they had never been graded (100 cards a call)
  for k in select * from collection_reset_refs limit 100 for update skip locked loop
    with o as (select id, row_number() over (order by graded_at, grade_cert) rn from cards
               where kind = k.kind and coalesce(track_id, artist_id) = k.ref and tier = k.tier and grade is not null)
    update cards c set grade_pop = o.rn from o where c.id = o.id and c.grade_pop is distinct from o.rn;
    select count(*) into cnt from cards where kind = k.kind and coalesce(track_id, artist_id) = k.ref and tier = k.tier and grade is not null;
    update grade_pop set n = cnt where grade_pop.kind = k.kind and grade_pop.ref = k.ref and grade_pop.tier = k.tier;
    delete from collection_reset_refs x where x.kind = k.kind and x.ref = k.ref and x.tier = k.tier;
  end loop;
  select count(*) into todo from collection_reset_refs;
  if todo > 0 then return jsonb_build_object('left', 0, 'pops', todo, 'done', false); end if;
  -- 3. albums no longer complete, and discographies whose collector card is gone: they can be completed again
  delete from album_claims ac where ac.owner = uid and exists (
    select 1 from albums a, jsonb_array_elements(a.tracks) e where a.id = ac.album_id
      and not exists (select 1 from cards c where c.owner = uid and c.track_id = (e ->> 'id')::bigint));
  delete from disco_claims dc where dc.owner = uid
    and not exists (select 1 from cards c where c.owner = uid and c.kind = 'artist' and c.artist_id = dc.artist_id and c.collector);
  delete from achievement_cache where owner = uid;
  update collection_resets set done_at = now() where owner = uid;
  return jsonb_build_object('left', 0, 'done', true);
end $$;

revoke execute on function public.collection_reset_step() from public, anon;
grant execute on function public.collection_reset_step() to authenticated;
