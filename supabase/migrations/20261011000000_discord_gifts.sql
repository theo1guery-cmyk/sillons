-- Discord: the announcements say when a pull was offered by the team (a GOD pack or a card given from the admin page),
-- so players know it was not luck: "🎁 Offerte" on the card, and a message saying it was a gift. Needs cards.gifted and
-- packs.gift_god (20261010000600_gifted_cards.sql). Same as on_pack_announce() in 20261010000200_discord.sql otherwise.
create or replace function public.on_pack_announce() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; embeds jsonb := '[]'; head text; c record; n int := 0; leg int := 0; shiny int := 0; art int := 0; gift int := 0;
  track_rar text[] := array['Commune', 'Peu commune', 'Rare', 'Épique', 'Mythique', 'Légendaire'];
  cert text[] := array['Démo', 'Single', 'Disque d''argent', 'Disque d''or', 'Disque de platine', 'Disque de diamant'];
  colors int[] := array[10130342, 6276234, 5217535, 11563519, 16731498, 16106061];       -- the rarity colours of the game
  certc int[] := array[9274008, 5224624, 13225174, 15776058, 15134456, 10478591];          -- the certification colours
begin
  if not (new.done and not old.done) then return new; end if;
  if not exists (select 1 from discord_settings where enabled and webhook_url <> '') then return new; end if;
  select pseudo into who from profiles where id = new.owner;
  for c in
    select k.kind, k.tier, k.holo, k.gifted, coalesce(t.title, a.name) title, t.artist, coalesce(nullif(t.cover, ''), a.picture) pic, a.fans
    from cards k left join tracks t on t.id = k.track_id left join artists a on a.id = k.artist_id
    where k.owner = new.owner and k.pulled_at = now() order by k.tier desc, k.holo desc
  loop
    if not (new.god or (c.kind = 'track' and c.tier = 5) or (c.holo and c.tier >= 4) or (c.kind = 'artist' and c.tier >= 4)) then continue; end if;
    n := n + 1;
    if c.kind = 'track' and c.tier = 5 then leg := leg + 1; end if;
    if c.holo then shiny := shiny + 1; end if;
    if c.kind = 'artist' and c.tier >= 4 then art := art + 1; end if;
    if c.gifted then gift := gift + 1; end if;
    if n <= 10 then
      embeds := embeds || jsonb_strip_nulls(jsonb_build_object(
        'title', left((case when c.gifted and not new.gift_god then '🎁 Offerte · ' else '' end) || (case when c.holo then '✨ Shiny · ' else '' end) ||
                      (case when c.kind = 'artist' then cert[c.tier + 1] else track_rar[c.tier + 1] end), 250),
        'description', left(case when c.kind = 'artist' then '**' || discord_esc(c.title) || '** · artiste' || coalesce(' · ' || replace(to_char(c.fans, 'FM999,999,999'), ',', ' ') || ' fans', '')
                            else '**' || discord_esc(c.title) || '** — ' || discord_esc(c.artist) end, 1000),
        'color', case when c.holo then 15320170 when c.kind = 'artist' then certc[c.tier + 1] else colors[c.tier + 1] end,
        'thumbnail', case when coalesce(c.pic, '') <> '' then jsonb_build_object('url', replace(c.pic, 'http:', 'https:')) end));
    end if;
  end loop;
  if n = 0 then return new; end if;
  head := case
    when new.god and new.gift_god then '🎁 **' || discord_esc(who) || '** ouvre un **GOD pack offert** par l''équipe Zik Hunter !'
    when gift = n then '🎁 **' || discord_esc(who) || '** a reçu ' || case when n = 1 then 'une carte offerte' else n || ' cartes offertes' end || ' par l''équipe Zik Hunter !'
    when new.god then '⚡ **GOD PACK !** **' || discord_esc(who) || '** vient d''ouvrir un GOD pack (1 chance sur 3 000) !'
    when art > 0 and n = 1 then '💿 **' || discord_esc(who) || '** a packé un artiste certifié !'
    when leg > 0 and n = 1 then '🌟 **' || discord_esc(who) || '** a packé une **Légendaire** !'
    when shiny > 0 and n = 1 then '✨ **' || discord_esc(who) || '** a packé une carte **Shiny** !'
    else '🔥 **' || discord_esc(who) || '** a fait un gros booster : ' || n || ' cartes rares !' end
    || case when gift > 0 and gift < n then ' (dont ' || gift || ' offerte' || case when gift > 1 then 's' else '' end || ' par l''équipe)' else '' end;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content', head, 'embeds', embeds));
  return new;
exception when others then return new;            -- an announcement never breaks a booster
end $$;
