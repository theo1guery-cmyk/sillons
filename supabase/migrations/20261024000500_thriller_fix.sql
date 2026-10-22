-- Thriller (the only 1/1 of the Collection Hantée) came out far too early: Hope91 found it at once.
-- 1. Hope91's copy is taken back (Thriller is in play again), and Hope91 gets Dracula as an ordinary Légendaire instead.
-- 2. Thriller is much rarer: its weight goes from .3 to .03 (about 1 haunted card in 400 instead of 1 in 40), and the
--    Pack Hanté no longer multiplies its chance. It still comes out by the end: when it is the last one left, it is picked.

do $$
declare hope uuid; tid bigint; t jsonb; a jsonb; g smallint;
begin
  select id into hope from profiles where lower(pseudo) = 'hope91';
  if hope is null then raise notice 'hope91 not found'; return; end if;
  -- 1. the Thriller copy goes back
  delete from haunted_cards where slot = 1 and owner = hope;
  if found then insert into admin_log (admin, target, action, detail) values (null, hope, 'haunted', 'Thriller repris (sorti trop tôt), Dracula Légendaire offert'); end if;
  -- 2. Dracula, an ordinary Légendaire track card
  select track_id into tid from haunted_editions where slot = 13;
  if tid is null then raise notice 'Dracula not resolved'; return; end if;
  t := deezer('track/' || tid);
  if t ->> 'id' is null then raise notice 'Dracula not found on Deezer: give it from the admin page'; return; end if;
  a := deezer('album/' || (t -> 'album' ->> 'id'));
  g := type_of_genre(coalesce((a ->> 'genre_id')::int, -1));
  insert into tracks (id, title, artist, album, cover, duration, bpm, year, explicit, genre, album_id, artist_id, updated_at)
  values ((t ->> 'id')::bigint, coalesce(nullif(t ->> 'title_short', ''), t ->> 'title'), coalesce(t -> 'artist' ->> 'name', '?'),
          coalesce(t -> 'album' ->> 'title', ''), replace(coalesce(a ->> 'cover_big', t -> 'album' ->> 'cover_big', ''), 'http:', 'https:'),
          coalesce((t ->> 'duration')::int, 0), coalesce(round((t ->> 'bpm')::numeric)::int, 0),
          coalesce(nullif(left(coalesce(t ->> 'release_date', a ->> 'release_date', ''), 4), '')::int, 0),
          coalesce((t ->> 'explicit_lyrics')::boolean, false), g, (t -> 'album' ->> 'id')::bigint, (t -> 'artist' ->> 'id')::bigint, now())
  on conflict (id) do update set updated_at = now();
  insert into cards (owner, track_id, tier, rank, holo, source) values (hope, tid, 5, coalesce((t ->> 'rank')::int, 0), false, 'gift');
end $$;

update public.haunted_editions set weight = .03 where slot = 1;

create or replace function public.haunted_roll(p_pack uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); pk packs; ch double precision; e haunted_editions; n int; card_id uuid; pk_gain int := 0; who text;
begin
  select * into pk from packs where id = p_pack and owner = uid and done and not haunted_rolled for update;
  if pk.id is null or not halloween_on() then return null; end if;
  update packs set haunted_rolled = true where id = pk.id;
  -- pumpkins hidden in the booster: 1 in 3, 2 to 4
  if random() < .33 then
    pk_gain := 2 + floor(random() * 3)::int;
    update profiles set pumpkins = pumpkins + pk_gain where id = uid;
  end if;
  ch := haunted_chance() * case when pk.haunted then 20 else 1 end;
  if random() >= least(ch, 1) then return jsonb_build_object('pumpkins', pk_gain); end if;
  -- which sound: weighted by the share of its copies still to come out (and Thriller's lower weight)
  select x.* into e from haunted_editions x
  where x.track_id is not null and (select count(*) from haunted_cards h where h.slot = x.slot) < x.copies
  order by -ln(greatest(random(), 1e-9)) / (x.weight * case when pk.haunted and x.copies = 1 then .1 else 1 end   -- the Pack Hanté doesn't help for the 1/1
                                           * (x.copies - (select count(*) from haunted_cards h where h.slot = x.slot))::real / x.copies)
  limit 1 for update;
  if e.slot is null then return jsonb_build_object('pumpkins', pk_gain); end if;
  select count(*) + 1 into n from haunted_cards where slot = e.slot;
  insert into haunted_cards (slot, no, owner, source) values (e.slot, n, uid, case when pk.haunted then 'pack' else 'booster' end)
  returning id into card_id;
  begin                                                          -- the news on the Discord (never breaks the booster)
    select pseudo into who from profiles where id = uid;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '🎃 **' || discord_esc(who) || '** a trouvé une carte de la **Collection Hantée** : **' || discord_esc(e.title) || '** — ' || discord_esc(e.artist)
                 || ' · N° ' || lpad(n::text, length(e.copies::text), '0') || '/' || e.copies || case when e.copies = 1 then ' 👑 (exemplaire unique !)' else '' end,
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('title', '🦇 Collection Hantée · ' || e.title, 'color', 16747050,
        'thumbnail', case when coalesce(e.cover, '') <> '' then jsonb_build_object('url', e.cover) end)))));
  exception when others then null;
  end;
  return jsonb_build_object('pumpkins', pk_gain, 'card', jsonb_build_object('id', card_id, 'slot', e.slot, 'no', n, 'of', e.copies,
    'title', e.title, 'artist', e.artist, 'cover', e.cover, 'preview', e.preview));
end $$;

revoke execute on function public.haunted_roll(uuid) from public, anon;
grant execute on function public.haunted_roll(uuid) to authenticated;
