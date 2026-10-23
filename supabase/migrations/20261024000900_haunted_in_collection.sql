-- Collection Hantée: the haunted copies become ordinary cards of the collection (table cards), in limited edition:
-- edition (the sound, 1 to 13) and edition_no (N° 01 to 10, or 1/1 for Thriller). They are graded, sold on the market
-- and traded like every card; they are never discarded nor deleted by a collection reset. haunted_cards stays the
-- register of the numbers given out, each pointing to its card. Internally a limited edition is a Légendaire (price
-- of grading, smallest price on the market); it shows its own card, not a Légendaire one.

alter table public.cards add column if not exists edition smallint references public.haunted_editions (slot);
alter table public.cards add column if not exists edition_no smallint;
create unique index if not exists cards_edition_no_idx on public.cards (edition, edition_no) where edition is not null;
alter table public.haunted_cards add column if not exists card_id uuid references public.cards on delete set null;
alter table public.listings add column if not exists edition smallint;   -- the market's « Édition limitée » filter

-- the 13 sounds as tracks (most are already known)
insert into public.tracks (id, title, artist, album, cover)
select track_id, title, artist, '', coalesce(cover, '') from public.haunted_editions where track_id is not null
on conflict (id) do nothing;

-- every copy already found becomes a card of its owner, with its grade; the copies on sale go to the market
do $$
declare h record; cid uuid; days int := coalesce((select listing_days from public.settings), 7);
begin
  for h in select hc.*, e.track_id, e.title, e.artist from public.haunted_cards hc join public.haunted_editions e on e.slot = hc.slot
           where hc.card_id is null and hc.owner is not null and e.track_id is not null loop
    insert into public.cards (owner, track_id, tier, rank, holo, tradeable, source, pulled_at, edition, edition_no, grade, grade_cert, grade_pop, graded_at)
    values (h.owner, h.track_id, 5, 950000, false, true, 'haunted', h.pulled_at, h.slot, h.no,
            h.grade, h.grade_cert, case when h.grade is not null then h.no end, h.graded_at)
    returning id into cid;
    update public.haunted_cards set card_id = cid where id = h.id;
    insert into public.listings (seller, card_id, track_id, tier, holo, title, artist, genre, price, expires_at, edition)
    select l.seller, cid, h.track_id, 5, false, h.title, h.artist, coalesce((select genre from public.tracks where id = h.track_id), 10), l.price,
           now() + days * interval '1 day', h.slot
    from public.haunted_listings l where l.card_id = h.id and l.status = 'active' and l.seller = h.owner;
  end loop;
  update public.haunted_listings set status = 'cancelled', closed_at = now() where status = 'active';
end $$;

-- a listing says when its card is a limited edition
create or replace function public.listing_edition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.edition := (select edition from cards where id = new.card_id);
  return new;
end $$;
drop trigger if exists listing_edition on public.listings;
create trigger listing_edition before insert on public.listings for each row execute function public.listing_edition();

-- the haunted copy found in a booster is a card of the collection
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
  insert into tracks (id, title, artist, album, cover) values (e.track_id, e.title, e.artist, '', coalesce(e.cover, '')) on conflict (id) do nothing;
  insert into cards (owner, track_id, tier, rank, holo, tradeable, source, edition, edition_no)
  values (uid, e.track_id, 5, 950000, false, true, 'haunted', e.slot, n) returning id into card_id;
  insert into haunted_cards (slot, no, owner, source, card_id) values (e.slot, n, uid, case when pk.haunted then 'pack' else 'booster' end, card_id);
  begin                                                          -- the news on the Discord (never breaks the booster)
    select pseudo into who from profiles where id = uid;
    perform discord_post(jsonb_build_object('username', 'Zik Hunter',
      'content', '🎃 **' || discord_esc(who) || '** a trouvé une carte de la **Collection Hantée** : **' || discord_esc(e.title) || '** — ' || discord_esc(e.artist)
                 || ' · N° ' || lpad(n::text, length(e.copies::text), '0') || '/' || e.copies || case when e.copies = 1 then ' 👑 (exemplaire unique !)' else '' end,
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('title', '🦇 Collection Hantée · ' || e.title, 'color', 16747050,
        'thumbnail', case when coalesce(e.cover, '') <> '' then jsonb_build_object('url', e.cover) end)))));
  exception when others then null;
  end;
  return jsonb_build_object('pumpkins', pk_gain, 'card', jsonb_build_object('id', card_id, 'card_id', card_id, 'track_id', e.track_id, 'slot', e.slot, 'no', n, 'of', e.copies,
    'title', e.title, 'artist', e.artist, 'cover', e.cover, 'preview', e.preview));
end $$;

-- the board: who holds which number (the owner of its card today), its grade, its price when on the market
create or replace function public.haunted_collection() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if exists (select 1 from haunted_editions where track_id is null) then perform haunted_resolve(); end if;
  return jsonb_build_object('ends_at', (select ends_at from haunted_meta where id = 1), 'active', halloween_on(), 'paused', (select paused from haunted_meta where id = 1),
    'fee', (select market_fee_pct from settings),
    'editions', (select jsonb_agg(jsonb_build_object('slot', e.slot, 'track_id', e.track_id, 'title', e.title, 'artist', e.artist, 'of', e.copies, 'cover', e.cover, 'preview', e.preview,
        'copies', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('no', h.no, 'pseudo', p.pseudo, 'mine', c.owner = uid,
                     'id', case when c.owner = uid then c.id end, 'grade', c.grade, 'cert', c.grade_cert,
                     'sale', (select jsonb_build_object('id', l.id, 'price', l.price) from listings l
                              where l.card_id = c.id and l.status = 'active' and l.expires_at > now()))) order by h.no), '[]')
                   from haunted_cards h left join cards c on c.id = h.card_id left join profiles p on p.id = c.owner where h.slot = e.slot)) order by e.slot)
      from haunted_editions e));
end $$;

-- the haunted cards' own grading and sale are replaced by those of the collection
drop function if exists public.haunted_grade(uuid);
drop function if exists public.haunted_crack(uuid);
drop function if exists public.haunted_sell(uuid, bigint);
drop function if exists public.haunted_unsell(uuid);
drop function if exists public.haunted_buy(uuid);

-- a limited edition is never discarded, and is not a duplicate of the same sound's ordinary card
create or replace function public.discard_cards(p_cards uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); gained int; removed int;
begin
  if coalesce(array_length(p_cards, 1), 0) = 0 then raise exception 'nothing_to_discard'; end if;
  perform 1 from cards where owner = uid and id = any(p_cards) for update;
  if (select count(*) from cards where owner = uid and id = any(p_cards)) <> (select count(distinct x) from unnest(p_cards) x) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from cards where id = any(p_cards) and collector) then raise exception 'collector_card'; end if;
  if exists (select 1 from cards where id = any(p_cards) and grade is not null) then raise exception 'graded_card'; end if;
  if exists (select 1 from cards where id = any(p_cards) and edition is not null) then raise exception 'limited_edition'; end if;
  if exists (select 1 from listings where card_id = any(p_cards) and status = 'active' and expires_at > now()) then
    raise exception 'card_listed';
  end if;
  if exists (select 1 from (select kind, coalesce(track_id, artist_id) as ref, tier, count(*) as n
                            from cards where owner = uid and id = any(p_cards) group by 1, 2, 3) d
             where d.n >= (select count(*) from cards k where k.owner = uid and k.kind = d.kind and k.edition is null
                           and coalesce(k.track_id, k.artist_id) = d.ref and k.tier = d.tier)) then
    raise exception 'keep_one';
  end if;
  update offers set status = 'expired', decided_at = now()
  where status = 'pending' and id in (select offer_id from offer_items where card_id = any(p_cards));
  select coalesce(sum(discard_value(tier)), 0), count(*) into gained, removed from cards where owner = uid and id = any(p_cards);
  delete from cards where owner = uid and id = any(p_cards);
  perform add_streams(uid, gained, 'défausse de ' || removed || ' carte(s)');
  perform bump(uid, 'discards', removed);
  return jsonb_build_object('removed', removed, 'gained', gained);
end $$;

create or replace function public.discard_all_duplicates() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); ids uuid[];
begin
  select array_agg(id) into ids from (
    select c.id, c.collector, c.grade, row_number() over (partition by c.kind, coalesce(c.track_id, c.artist_id), c.tier order by
             c.collector desc, (c.grade is not null) desc, c.grade desc nulls last,
             (exists (select 1 from listings l where l.card_id = c.id and l.status = 'active')) desc,
             c.holo desc, c.rank desc, c.pulled_at) as rn
    from cards c where c.owner = uid and c.edition is null
  ) x where rn > 1 and not x.collector and x.grade is null
    and not exists (select 1 from offer_items i join offers o on o.id = i.offer_id where i.card_id = x.id and o.status = 'pending')
    and not exists (select 1 from listings l where l.card_id = x.id and l.status = 'active' and l.expires_at > now());
  if ids is null then return jsonb_build_object('removed', 0, 'gained', 0); end if;
  return discard_cards(ids);
end $$;

-- a collection reset keeps the limited editions
create or replace function public.collection_reset_start(p_keep uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); r collection_resets; kept uuid[];
begin
  select * into r from collection_resets where owner = uid and done_at is null for update;
  if r.owner is null then raise exception 'no_reset'; end if;
  if r.started_at is not null then return jsonb_build_object('left', (select count(*) from cards where owner = uid and id <> all(r.keep))); end if;
  select coalesce(array_agg(id), '{}') into kept from cards where owner = uid and (id = any(coalesce(p_keep, '{}')) or edition is not null);
  update collection_resets set keep = kept, started_at = now() where owner = uid;
  return jsonb_build_object('left', (select count(*) from cards where owner = uid and id <> all(kept)));
end $$;

create or replace function public.reset_collection() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  update offers set status = 'cancelled', decided_at = now()
  where status = 'pending' and (from_user = uid or to_user = uid);
  delete from cards where owner = uid and edition is null;
  delete from packs where owner = uid and not parked;
  update profiles set opened = 0, dry = 0, gods = 0 where id = uid;
end $$;

-- a graded limited edition keeps its number (N° 03/10) as its rank among the graded copies
create or replace function public.grade_card(p_card uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c cards; price int; g smallint; pop int; cert bigint; label text;
begin
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null then raise exception 'card_not_owned'; end if;
  if c.grade is not null then raise exception 'already_graded'; end if;
  if is_listed(p_card) then raise exception 'card_listed'; end if;
  if card_in_duel(p_card) then raise exception 'card_in_duel'; end if;
  if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id = p_card) then
    raise exception 'card_in_offer';
  end if;
  price := grade_price(c.tier);
  if (select streams from profiles where id = uid) < price then raise exception 'not_enough_streams'; end if;
  label := coalesce((select title from tracks where id = c.track_id), (select name from artists where id = c.artist_id), '?');
  perform add_streams(uid, -price, 'gradation : ' || label);
  g := roll_grade();
  if c.edition is not null then pop := c.edition_no;
  else
    insert into grade_pop (kind, ref, tier, n) values (c.kind, coalesce(c.track_id, c.artist_id), c.tier, 1)
    on conflict (kind, ref, tier) do update set n = grade_pop.n + 1 returning n into pop;
  end if;
  cert := nextval('grade_cert_seq');
  update cards set grade = g, grade_cert = cert, grade_pop = pop, graded_at = now() where id = p_card;
  return jsonb_build_object('grade', g, 'cert', cert, 'pop', pop, 'price', price);
end $$;
