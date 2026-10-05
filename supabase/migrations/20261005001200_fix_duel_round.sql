-- fix: a variable named like a column in duel_round
create or replace function public.duel_round(p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); d duels; role text; r duel_rounds; nxt int; total int; t jsonb; ans duel_answers;
begin
  select * into d from duels where id = p_duel;
  role := duel_role(d, uid);
  if role is null then raise exception 'duel_not_found'; end if;
  select count(*) into total from duel_rounds where duel_id = d.id;
  select coalesce(max(a.n), 0) into nxt from duel_answers a where a.duel_id = d.id and a.player = uid and a.answered_at is not null;
  nxt := nxt + 1;
  if nxt > total then raise exception 'duel_over'; end if;
  select * into r from duel_rounds x where x.duel_id = d.id and x.n = nxt;
  insert into duel_answers (duel_id, n, player) values (d.id, nxt, uid) on conflict do nothing;   -- a reload does not restart the clock
  select * into ans from duel_answers a where a.duel_id = d.id and a.n = r.n and a.player = uid;
  t := deezer('track/' || r.track_id);
  return jsonb_build_object('n', nxt, 'total', total, 'preview', t ->> 'preview', 'extract_ms', r.extract_ms,
    'choices', r.choices, 'mine', case when r.side = 'self' then null else r.side = role end,
    'elapsed_ms', round(extract(epoch from now() - ans.served_at) * 1000));
end $$;

