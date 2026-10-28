-- Better presents at the end of a season of the leagues:
--   Bronze 3 boosters · Argent 5 boosters · Or 1 Grand booster + 1 Mythique · Platine 2 Grands boosters + 1 Mythique
--   Diamant 1 Légendaire + 1 Grand booster + 15 Vinyles
--   Légende 1 Légendaire Shiny + 1 Légendaire + 2 Grands boosters + 30 Vinyles, the Médaillon Légende (animated), the
--   Dos de carte Légende and the title « Légende · Saison N » (the cosmetics are for the Légende only).

insert into public.cosmetic_items (item, slot, name) values ('avatar-legende', 'avatar', 'Médaillon Légende'), ('back-legende', 'back', 'Dos de carte Légende')
on conflict (item) do nothing;

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
      when 'Légende' then
        perform give_card(p.id, 'track', 5::smallint, true, 'ligue Légende');
        perform give_card(p.id, 'track', 5::smallint, false, 'ligue Légende');
        update profiles set big_packs = big_packs + 2 where id = p.id;
        perform add_vinyls(p.id, 30, 'fin de saison : ligue Légende');
        insert into player_cosmetics (owner, item) values (p.id, 'avatar-legende'), (p.id, 'back-legende') on conflict do nothing;
        insert into player_titles (owner, title) values (p.id, 'Légende · ' || split_part(s.name, ' ·', 1)) on conflict do nothing;
      when 'Diamant' then
        perform give_card(p.id, 'track', 5::smallint, false, 'ligue Diamant');
        update profiles set big_packs = big_packs + 1 where id = p.id;
        perform add_vinyls(p.id, 15, 'fin de saison : ligue Diamant');
      when 'Platine' then
        perform give_card(p.id, 'track', 4::smallint, false, 'ligue Platine');
        update profiles set big_packs = big_packs + 2 where id = p.id;
      when 'Or' then
        perform give_card(p.id, 'track', 4::smallint, false, 'ligue Or');
        update profiles set big_packs = big_packs + 1 where id = p.id;
      when 'Argent' then update profiles set stock = stock + 5 where id = p.id;
      else update profiles set stock = stock + 3 where id = p.id;
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
