-- Discord: the big pulls are announced in a Discord channel, through a channel webhook (Discord > channel settings >
-- Integrations > Webhooks). One message per booster that holds something worth it: a GOD pack, a Légendaire, a Shiny,
-- a Platine or Diamant artist. Sent by pg_net, which queues the request and never slows the booster down.
-- The webhook address is secret: it lives in a table players cannot read, and is set from the admin page.
create extension if not exists pg_net;

create table public.discord_settings (
  id boolean primary key default true check (id),
  webhook_url text not null default '',
  enabled boolean not null default true
);
insert into public.discord_settings default values;
alter table public.discord_settings enable row level security;

-- the cards of one booster are the owner's cards written in the same transaction
create index if not exists cards_owner_pulled_idx on public.cards (owner, pulled_at desc);

create function public.discord_post(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s discord_settings;
begin
  select * into s from discord_settings;
  if s.id is null or not s.enabled or s.webhook_url !~ '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/' then return; end if;
  perform net.http_post(url := s.webhook_url, body := p_body || jsonb_build_object('allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
                        headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;

-- Discord markdown off for names coming from Deezer or players
create function public.discord_esc(t text) returns text language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '([\\*_~`|])', '\\\1', 'g')
$$;

create function public.on_pack_announce() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; embeds jsonb := '[]'; head text; c record; n int := 0; leg int := 0; shiny int := 0; art int := 0;
  track_rar text[] := array['Commune', 'Peu commune', 'Rare', 'Épique', 'Mythique', 'Légendaire'];
  cert text[] := array['Démo', 'Single', 'Disque d''argent', 'Disque d''or', 'Disque de platine', 'Disque de diamant'];
  colors int[] := array[10130342, 6276234, 5217535, 11563519, 16731498, 16106061];       -- the rarity colours of the game
  certc int[] := array[9274008, 5224624, 13225174, 15776058, 15134456, 10478591];          -- the certification colours
begin
  if not (new.done and not old.done) then return new; end if;
  if not exists (select 1 from discord_settings where enabled and webhook_url <> '') then return new; end if;
  select pseudo into who from profiles where id = new.owner;
  for c in
    select k.kind, k.tier, k.holo, coalesce(t.title, a.name) title, t.artist, coalesce(nullif(t.cover, ''), a.picture) pic, a.fans
    from cards k left join tracks t on t.id = k.track_id left join artists a on a.id = k.artist_id
    where k.owner = new.owner and k.pulled_at = now() order by k.tier desc, k.holo desc
  loop
    if not (new.god or (c.kind = 'track' and c.tier = 5) or (c.holo and c.tier >= 4) or (c.kind = 'artist' and c.tier >= 4)) then continue; end if;
    n := n + 1;
    if c.kind = 'track' and c.tier = 5 then leg := leg + 1; end if;
    if c.holo then shiny := shiny + 1; end if;
    if c.kind = 'artist' and c.tier >= 4 then art := art + 1; end if;
    if n <= 10 then
      embeds := embeds || jsonb_strip_nulls(jsonb_build_object(
        'title', left((case when c.holo then '✨ Shiny · ' else '' end) ||
                      (case when c.kind = 'artist' then cert[c.tier + 1] else track_rar[c.tier + 1] end), 250),
        'description', left(case when c.kind = 'artist' then '**' || discord_esc(c.title) || '** · artiste' || coalesce(' · ' || replace(to_char(c.fans, 'FM999,999,999'), ',', ' ') || ' fans', '')
                            else '**' || discord_esc(c.title) || '** — ' || discord_esc(c.artist) end, 1000),
        'color', case when c.holo then 15320170 when c.kind = 'artist' then certc[c.tier + 1] else colors[c.tier + 1] end,
        'thumbnail', case when coalesce(c.pic, '') <> '' then jsonb_build_object('url', replace(c.pic, 'http:', 'https:')) end));
    end if;
  end loop;
  if n = 0 then return new; end if;
  head := case
    when new.god then '⚡ **GOD PACK !** **' || discord_esc(who) || '** vient d''ouvrir un GOD pack (1 chance sur 3 000) !'
    when art > 0 and n = 1 then '💿 **' || discord_esc(who) || '** a packé un artiste certifié !'
    when leg > 0 and n = 1 then '🌟 **' || discord_esc(who) || '** a packé une **Légendaire** !'
    when shiny > 0 and n = 1 then '✨ **' || discord_esc(who) || '** a packé une carte **Shiny** !'
    else '🔥 **' || discord_esc(who) || '** a fait un gros booster : ' || n || ' cartes rares !' end;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter', 'content', head, 'embeds', embeds));
  return new;
exception when others then return new;            -- an announcement never breaks a booster
end $$;
create trigger pack_announce after update of done on public.packs for each row execute function public.on_pack_announce();

-- ---------------------------------------------------------------- admin page
create function public.admin_discord_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s discord_settings;
begin
  perform require_admin();
  select * into s from discord_settings;
  return jsonb_build_object('set', coalesce(s.webhook_url, '') <> '', 'enabled', coalesce(s.enabled, false),
    'hint', case when coalesce(s.webhook_url, '') = '' then '' else '…' || right(s.webhook_url, 6) end);
end $$;

create function public.admin_discord_set(p_url text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_admin();
begin
  if p_url is not null and p_url <> '' and p_url !~ '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/' then raise exception 'bad_webhook'; end if;
  update discord_settings set webhook_url = coalesce(p_url, webhook_url), enabled = coalesce(p_enabled, enabled) where id;
  perform admin_log_add(me, null, 'discord', case when p_url is not null then 'webhook changé' else '' end ||
    case when p_enabled is not null then case when p_enabled then ' · activé' else ' · coupé' end else '' end);
end $$;

create function public.admin_discord_test() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if not exists (select 1 from discord_settings where webhook_url <> '') then raise exception 'bad_webhook'; end if;
  perform discord_post(jsonb_build_object('username', 'Zik Hunter',
    'content', '🎵 Test : les annonces de **Zik Hunter** arriveront dans ce salon (GOD packs, Légendaires, Shiny, artistes Platine et Diamant).'));
end $$;

revoke execute on function public.discord_post(jsonb), public.on_pack_announce(), public.admin_discord_get(),
  public.admin_discord_set(text, boolean), public.admin_discord_test() from public, anon, authenticated;
grant execute on function public.admin_discord_get(), public.admin_discord_set(text, boolean), public.admin_discord_test() to authenticated;
