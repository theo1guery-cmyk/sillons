-- The Cartes Givrées (series 3) stay out of the board until the Christmas event opens on 1 December (Paris): before
-- that, only the admins see them (the Atelier's preview). Same board as before otherwise.
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); early boolean := noel_day() < 1 and not exists (select 1 from admins where id = uid);
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'fee', (select market_fee_pct from settings), 'now', now(), 'night', halloween_night(),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'series', e.series, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
        'track_id', e.track_id, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', c.owner = uid,
                     'id', case when c.owner = uid then c.id end, 'grade', c.grade, 'cert', c.grade_cert,
                     'sale', (select jsonb_build_object('id', l.id, 'price', l.price) from listings l
                              where l.card_id = c.id and l.status = 'active' and l.expires_at > now()))) order by h.no), '[]')
                   from haunted_cards h left join cards c on c.id = h.card_id left join profiles p on p.id = c.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e where not (early and e.series = 3)));
end $$;
