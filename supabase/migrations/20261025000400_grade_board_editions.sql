-- The hall of fame of grading: a limited edition shows as such (its own card and its N°), for everyone.
create or replace function public.grade_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(x) from (
      select c.id, c.kind, c.track_id, c.artist_id, c.tier, c.rank, c.holo, c.grade, c.grade_cert as cert, c.grade_pop as pop, c.graded_at, c.edition, c.edition_no,
             p.pseudo as owner, t.title, t.artist, t.album, t.cover, t.year, t.genre, t.duration, t.bpm, t.explicit,
             a.name as artist_name, a.picture, a.fans, a.nb_album
      from cards c join profiles p on p.id = c.owner left join tracks t on t.id = c.track_id left join artists a on a.id = c.artist_id
      where c.grade is not null order by c.grade desc, c.tier desc, c.graded_at limit 30) x), '[]'),
    'counts', coalesce((select jsonb_object_agg(grade, n) from (select grade, count(*) n from cards where grade is not null group by grade) y), '{}'))
$$;
