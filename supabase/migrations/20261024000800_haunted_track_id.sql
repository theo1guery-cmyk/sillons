-- Collection Hantée: the board also gives each sound's Deezer track, so the game fetches a fresh extract the same way
-- as for the other cards (the extract links saved with the sounds expire after a few hours).
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'fee', (select market_fee_pct from settings),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'track_id', e.track_id, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', h.owner = uid,
                     'id', case when h.owner = uid then h.id end, 'grade', h.grade, 'cert', h.grade_cert,
                     'sale', (select jsonb_build_object('id', l.id, 'price', l.price) from haunted_listings l where l.card_id = h.id and l.status = 'active'))) order by h.no), '[]')
                   from haunted_cards h left join profiles p on p.id = h.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;
