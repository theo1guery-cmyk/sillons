-- Wishlist (cards you are looking for, with an alert when one is put on the market)
-- and tags to sort your own collection. A card is identified by kind + ref (track id or artist id).

-- ---------------------------------------------------------------- wishlist
create table public.wishlist (
  owner uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('track', 'artist')),
  ref bigint not null,
  title text not null,
  artist text not null default '',
  cover text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner, kind, ref)
);
create index wishlist_ref_idx on public.wishlist (kind, ref);

create table public.notifications (
  id bigint generated always as identity primary key,
  owner uuid not null references public.profiles on delete cascade,
  type text not null,
  listing_id uuid references public.listings on delete cascade,
  title text not null,
  price bigint,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_owner_idx on public.notifications (owner, read, created_at desc);

create function public.wish_toggle(p_kind text, p_ref bigint, p_title text, p_artist text default '', p_cover text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if p_kind not in ('track', 'artist') then raise exception 'bad_card'; end if;
  delete from wishlist where owner = uid and kind = p_kind and ref = p_ref;
  if found then return false; end if;                     -- removed
  if (select count(*) from wishlist where owner = uid) >= 300 then raise exception 'wishlist_full'; end if;
  insert into wishlist (owner, kind, ref, title, artist, cover)
  values (uid, p_kind, p_ref, left(coalesce(p_title, '?'), 200), left(coalesce(p_artist, ''), 200), left(coalesce(p_cover, ''), 500));
  return true;                                            -- added
end $$;

-- a new listing alerts everyone who wishes for that card
create function public.on_listing_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (owner, type, listing_id, title, price)
  select w.owner, 'wish_listed', new.id, new.title, new.price
  from wishlist w
  where w.owner <> new.seller
    and ((new.kind = 'artist' and w.kind = 'artist' and w.ref = new.artist_id)
      or (new.kind = 'track' and w.kind = 'track' and w.ref = new.track_id));
  return new;
end $$;
create trigger listing_created after insert on public.listings for each row execute function public.on_listing_created();

-- a card you just got leaves your wishlist
create function public.on_card_owned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from wishlist where owner = new.owner
    and ((new.kind = 'artist' and kind = 'artist' and ref = new.artist_id) or (new.kind = 'track' and kind = 'track' and ref = new.track_id));
  return new;
end $$;
create trigger card_owned_insert after insert on public.cards for each row execute function public.on_card_owned();
create trigger card_owned_update after update of owner on public.cards for each row execute function public.on_card_owned();

create function public.notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read = true where owner = auth.uid() and not read
$$;

-- ---------------------------------------------------------------- tags
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  color text not null default '#e7b14a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index tags_owner_name_key on public.tags (owner, lower(name));

create table public.card_tags (
  tag_id uuid not null references public.tags on delete cascade,
  owner uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('track', 'artist')),
  ref bigint not null,
  primary key (tag_id, kind, ref)
);
create index card_tags_owner_idx on public.card_tags (owner);

create function public.tag_create(p_name text, p_color text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); tid uuid;
begin
  if (select count(*) from tags where owner = uid) >= 40 then raise exception 'too_many_tags'; end if;
  if exists (select 1 from tags where owner = uid and lower(name) = lower(trim(p_name))) then raise exception 'tag_exists'; end if;
  insert into tags (owner, name, color) values (uid, trim(p_name), p_color) returning id into tid;
  return tid;
end $$;

create function public.tag_delete(p_tag uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from tags where id = p_tag and owner = require_user();
end $$;

create function public.tag_toggle(p_tag uuid, p_kind text, p_ref bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user();
begin
  if not exists (select 1 from tags where id = p_tag and owner = uid) then raise exception 'tag_not_found'; end if;
  delete from card_tags where tag_id = p_tag and kind = p_kind and ref = p_ref;
  if found then return false; end if;
  insert into card_tags (tag_id, owner, kind, ref) values (p_tag, uid, p_kind, p_ref);
  return true;
end $$;

-- ---------------------------------------------------------------- access
alter table public.wishlist enable row level security;
alter table public.notifications enable row level security;
alter table public.tags enable row level security;
alter table public.card_tags enable row level security;
create policy "own wishlist" on public.wishlist for select to authenticated using (owner = (select auth.uid()));
create policy "own notifications" on public.notifications for select to authenticated using (owner = (select auth.uid()));
create policy "own tags" on public.tags for select to authenticated using (owner = (select auth.uid()));
create policy "own card tags" on public.card_tags for select to authenticated using (owner = (select auth.uid()));
revoke insert, update, delete on all tables in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.tier_of(int), public.type_of_genre(int), public.cert_of(int) to anon, authenticated;
grant execute on function public.wish_toggle(text, bigint, text, text, text), public.notifications_read(),
  public.tag_create(text, text), public.tag_delete(uuid), public.tag_toggle(uuid, text, bigint) to authenticated;
revoke execute on function public.on_listing_created(), public.on_card_owned() from authenticated;
