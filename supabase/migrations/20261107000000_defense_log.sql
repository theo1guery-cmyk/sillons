-- The defense log and the revenge. While I was away my deck defended: when I come back, the game tells me who
-- attacked, which defenses held and which were lost (and the trophies). A defense lost in the last 24 hours can be
-- avenged once: a ranked battle against that player (trophies at stake as usual). If I win it, he is told.

alter table public.profiles add column if not exists defense_seen_at timestamptz not null default now();
alter table public.battles add column if not exists revenged boolean not null default false;
alter table public.battles add column if not exists revenge_of uuid references public.battles on delete set null;

-- the defenses since I last looked (the last 30 at most)
create or replace function public.battle_defenses() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (
    select b.*, p.pseudo, p.trophies opp_trophies, p.cosmetics from battles b join profiles p on p.id = b.attacker
    where b.defender = auth.uid() and b.mode = 'ranked' and b.status = 'done'
      and b.finished_at > (select defense_seen_at from profiles where id = auth.uid())
    order by b.finished_at desc limit 30)
  select jsonb_build_object('total', count(*), 'held', count(*) filter (where winner = defender), 'lost', count(*) filter (where winner = attacker),
    'delta', coalesce(sum(d_delta), 0),
    'list', coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', finished_at, 'who', pseudo, 'who_id', attacker, 'league', league_of(opp_trophies), 'cosmetics', cosmetics,
      'held', winner = defender, 'score', d_won || '-' || a_won, 'delta', d_delta,
      'revenge', winner = attacker and not revenged and finished_at > now() - interval '24 hours') order by finished_at desc), '[]'))
  from d
$$;

create or replace function public.battle_defenses_seen() returns void
language sql security definer set search_path = public as $$ update profiles set defense_seen_at = now() where id = auth.uid() $$;

-- the revenge: a ranked battle against the one who beat my deck (once, within 24 hours)
create or replace function public.battle_revenge(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); o battles; b battles; ad uuid[]; dd uuid[];
begin
  select * into b from battles where attacker = uid and status = 'playing' and mode <> 'live' order by created_at desc limit 1;
  if b.id is not null then return battle_view(b, uid); end if;
  select * into o from battles where id = p_battle and defender = uid and mode = 'ranked' and status = 'done' for update;
  if o.id is null or o.winner is distinct from o.attacker then raise exception 'battle_not_found'; end if;
  if o.revenged or o.finished_at < now() - interval '24 hours' then raise exception 'revenge_gone'; end if;
  ad := battle_deck_of(uid); dd := battle_deck_of(o.attacker);
  if coalesce(cardinality(ad), 0) < 5 then raise exception 'battle_need_five'; end if;
  if coalesce(cardinality(dd), 0) < 5 then raise exception 'battle_opp_five'; end if;
  update battles set revenged = true where id = o.id;
  insert into battles (attacker, defender, mode, a_cards, d_cards, a_vals, d_vals, stats, revenge_of)
  values (uid, o.attacker, 'ranked', ad, dd, battle_vals(ad), battle_vals(dd), battle_stats(), o.id) returning * into b;
  return battle_view(b, uid) || jsonb_build_object('revenge', true);
end $$;

-- a revenge won: the one who had attacked is told
create or replace function public.on_battle_revenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.revenge_of is not null and new.status = 'done' and old.status <> 'done' and new.winner = new.attacker then
    select pseudo into who from profiles where id = new.attacker;
    perform notify(new.defender, 'battle_revenge', who || ' a pris sa revanche ' || new.a_won || '-' || new.d_won || ' en Bataille de cartes (' || coalesce(new.d_delta, 0) || ' 🏆).');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists battle_revenge_told on public.battles;
create trigger battle_revenge_told after update on public.battles for each row execute function public.on_battle_revenge();

create or replace function public.battle_home() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); p profiles; d uuid[];
begin
  select * into p from profiles where id = uid;
  d := battle_deck_of(uid);
  return jsonb_build_object('trophies', p.trophies, 'best', p.best_trophies, 'league', league_of(p.trophies), 'wins', p.battle_wins, 'losses', p.battle_losses,
    'chosen', exists (select 1 from battle_decks where owner = uid),
    'deck', coalesce((select jsonb_agg(battle_card(c) order by array_position(d, c.id)) from cards c where c.id = any(d)), '[]'),
    'today', coalesce((select n from daily_counters where owner = uid and day = game_day() and metric = 'battle_win'), 0),
    'rank', (select count(*) + 1 from profiles where trophies > p.trophies),
    'defenses', (select count(*) from battles where defender = uid and mode = 'ranked' and status = 'done' and finished_at > p.defense_seen_at),
    'history', coalesce((select jsonb_agg(h order by h ->> 'at' desc) from (
      select jsonb_build_object('id', b.id, 'at', b.created_at, 'attack', b.attacker = uid,
        'other', (select pseudo from profiles where id = case when b.attacker = uid then b.defender else b.attacker end),
        'other_id', case when b.attacker = uid then b.defender else b.attacker end,
        'won', b.winner = uid, 'score', case when b.attacker = uid then b.a_won || '-' || b.d_won else b.d_won || '-' || b.a_won end,
        'delta', case when b.attacker = uid then b.a_delta else b.d_delta end, 'mode', b.mode,
        'revenge', b.defender = uid and b.mode = 'ranked' and b.winner = b.attacker and not b.revenged and b.finished_at > now() - interval '24 hours') h
      from battles b where (b.attacker = uid or b.defender = uid) and b.status = 'done' order by b.created_at desc limit 15) x), '[]'));
end $$;

revoke execute on function public.on_battle_revenge() from public, anon, authenticated;
revoke execute on function public.battle_defenses(), public.battle_defenses_seen(), public.battle_revenge(uuid) from public, anon;
grant execute on function public.battle_defenses(), public.battle_defenses_seen(), public.battle_revenge(uuid) to authenticated;
