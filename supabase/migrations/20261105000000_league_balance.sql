-- The leagues get harder as they go up: the higher my league, the less a victory brings and the more a defeat costs,
-- when I attack and when my deck defends. At equal level: Bronze +36 / −10, Argent +30 / −16, Or +27 / −20,
-- Platine +24 / −25, Diamant +20 / −30, Légende +15 / −40 (a defense: about a third of it).
-- The end of a season brings trophies down further: halved, never under 400 for those above.

create or replace function public.league_mult(p_trophies int, out g numeric, out l numeric)
language sql immutable as $$
  select case when p_trophies >= 3200 then .5 when p_trophies >= 2300 then .65 when p_trophies >= 1500 then .8
              when p_trophies >= 900 then .9 when p_trophies >= 400 then 1 else 1.2 end,
         case when p_trophies >= 3200 then 2 when p_trophies >= 2300 then 1.5 when p_trophies >= 1500 then 1.25
              when p_trophies >= 900 then 1 when p_trophies >= 400 then .8 else .5 end
$$;

create or replace function public.battle_resolve(b battles) returns battles
language plpgsql security definer set search_path = public as $$
declare st text := b.stats[b.round + 1]; mine jsonb := b.a_vals -> b.a_pick; his jsonb := b.d_vals -> b.d_pick; mv int; hv int; won boolean;
  att profiles; def profiles; diff int; am record; dm record; ad int := 0; dd int := 0; rw int := 0; who text;
begin
  mv := (mine ->> st)::int; hv := (his ->> st)::int;
  won := mv > hv or (mv = hv and (mine ->> 'rank')::int >= (his ->> 'rank')::int);
  b.round := b.round + 1; b.a_used := b.a_used || b.a_pick; b.d_used := b.d_used || b.d_pick;
  if won then b.a_won := b.a_won + 1; else b.d_won := b.d_won + 1; end if;
  b.log := b.log || jsonb_build_object('stat', st, 'a_slot', b.a_pick, 'd_slot', b.d_pick, 'a', mine, 'd', his, 'av', mv, 'dv', hv, 'won_a', won);
  b.a_pick := null; b.d_pick := null; b.round_at := now();
  if b.a_won >= 3 or b.d_won >= 3 or b.round >= 5 then
    b.status := 'done'; b.finished_at := now();
    b.winner := case when b.a_won > b.d_won then b.attacker else b.defender end;
    if b.mode = 'ranked' then
      select * into att from profiles where id = b.attacker for update;
      select * into def from profiles where id = b.defender for update;
      diff := coalesce(def.trophies, att.trophies) - att.trophies;
      am := league_mult(att.trophies); dm := league_mult(coalesce(def.trophies, 0));
      if b.winner = b.attacker then
        ad := greatest(1, round(greatest(15, least(45, 30 + diff / 20)) * am.g)); dd := -least(coalesce(def.trophies, 0), round(greatest(5, least(15, 10 + diff / 40)) * dm.l)::int);
        perform bump(b.attacker, 'battle_win');
        if (select n from daily_counters where owner = b.attacker and day = game_day() and metric = 'battle_win') <= 5 then
          rw := 100; perform add_streams(b.attacker, rw, 'Bataille de cartes gagnée');
        end if;
      else
        ad := -least(att.trophies, round(greatest(8, least(30, 20 + diff / 25)) * am.l)::int); dd := greatest(1, round(greatest(5, least(20, 10 - diff / 40)) * dm.g));
      end if;
      update profiles set trophies = trophies + ad, best_trophies = greatest(best_trophies, trophies + ad),
        battle_wins = battle_wins + case when b.winner = b.attacker then 1 else 0 end, battle_losses = battle_losses + case when b.winner = b.attacker then 0 else 1 end where id = b.attacker;
      if b.defender is not null then
        update profiles set trophies = greatest(0, trophies + dd), best_trophies = greatest(best_trophies, trophies + dd) where id = b.defender;
      end if;
      perform bump(b.attacker, 'battles');
    elsif b.mode = 'friend' then
      select pseudo into who from profiles where id = b.attacker;
      perform notify(b.defender, 'battle_friend', who || case when b.winner = b.attacker then ' a battu ton deck ' else ' a perdu contre ton deck ' end
                     || greatest(b.a_won, b.d_won) || '-' || least(b.a_won, b.d_won) || ' en Bataille de cartes amicale.');
    end if;
    b.a_delta := ad; b.d_delta := dd; b.reward := rw;
  end if;
  update battles set round = b.round, a_used = b.a_used, d_used = b.d_used, a_won = b.a_won, d_won = b.d_won, log = b.log, status = b.status,
    a_pick = null, d_pick = null, round_at = b.round_at, finished_at = b.finished_at, winner = b.winner, a_delta = b.a_delta, d_delta = b.d_delta, reward = b.reward where id = b.id;
  return b;
end $$;

create or replace function public.league_season_tick() returns void
language plpgsql security definer set search_path = public as $$
declare s seasons; p record;
begin
  select * into s from seasons where ends_at <= now() and ends_at > now() - interval '3 days'
    and id not in (select season_id from league_rewards_done) order by ends_at desc limit 1;
  if s.id is null then return; end if;
  insert into league_rewards_done (season_id) values (s.id);
  for p in select id, trophies, league_of(trophies) lg from profiles where battle_wins + battle_losses > 0 loop
    case p.lg
      when 'Légende' then perform give_card(p.id, 'track', 5::smallint, true, 'ligue Légende'); insert into player_titles (owner, title) values (p.id, 'Légende de la ' || split_part(s.name, ' ·', 1)) on conflict do nothing;
      when 'Diamant' then perform give_card(p.id, 'track', 5::smallint, false, 'ligue Diamant');
      when 'Platine' then perform give_card(p.id, 'track', 4::smallint, false, 'ligue Platine');
      when 'Or' then update profiles set big_packs = big_packs + 1 where id = p.id;
      when 'Argent' then update profiles set stock = stock + 3 where id = p.id;
      else perform add_streams(p.id, 500, 'fin de saison : ligue Bronze');
    end case;
    perform notify(p.id, 'league_end', 'Fin de saison : tu termines en ligue ' || p.lg || ' avec ' || p.trophies || ' trophées. Ton cadeau t''attend !');
  end loop;
  update profiles set trophies = greatest(least(trophies, 400), trophies / 2) where trophies > 400;   -- halved, never under 400 for those above
  begin
    perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content',
      '🛡️ **Fin de la saison des ligues !** Chacun reçoit son cadeau selon sa ligue, et les trophées sont divisés par deux (jamais sous 400 pour ceux qui étaient au-dessus). Les Légendes : '
      || coalesce((select string_agg('**' || discord_esc(pseudo) || '**', ', ' order by trophies desc) from profiles where trophies >= 2200 and battle_wins > 0), 'aucune cette fois') || '. La nouvelle saison commence maintenant !'));
  exception when others then null;
  end;
end $$;
