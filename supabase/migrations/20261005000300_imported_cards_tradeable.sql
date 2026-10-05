-- imported collections become tradeable (decision of the game owner), now and for future imports
update public.cards set tradeable = true where not tradeable;
alter table public.cards alter column tradeable set default true;

create or replace function public.import_collection(p_cards jsonb, p_opened int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c jsonb; n int; added int := 0; k int;
begin
  if (select imported from profiles where id = uid) then raise exception 'already_imported'; end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 20000 then raise exception 'bad_import'; end if;
  for c in select * from jsonb_array_elements(p_cards) loop
    insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre)
    values ((c ->> 'id')::bigint, left(coalesce(c ->> 't', '?'), 300), left(coalesce(c ->> 'a', '?'), 300),
            left(coalesce(c ->> 'al', ''), 300), left(coalesce(c ->> 'cov', ''), 500),
            coalesce((c ->> 'd')::int, 0), coalesce((c ->> 'bpm')::int, 0), coalesce((c ->> 'y')::int, 0),
            coalesce((c ->> 'x')::int, 0) = 1, least(greatest(coalesce((c ->> 'g')::int, 10), 0), 10))
    on conflict (id) do nothing;
    n := least(greatest(coalesce((c ->> 'n')::int, 1), 1), 50);
    for k in 1..n loop
      insert into cards (owner, track_id, tier, rank, holo, tradeable, source)
      values (uid, (c ->> 'id')::bigint, tier_of(coalesce((c ->> 'rank')::int, 0)), coalesce((c ->> 'rank')::int, 0),
              k <= coalesce((c ->> 'holo')::int, 0), true, 'import');
      added := added + 1;
    end loop;
  end loop;
  update profiles set imported = true, opened = opened + greatest(coalesce(p_opened, 0), 0) where id = uid;
  return added;
end $$;
