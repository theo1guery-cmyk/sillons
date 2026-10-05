-- advisor fixes: pinned search_path on helpers, auth.uid() evaluated once per query in policies
alter function public.tier_of(int) set search_path = public;
alter function public.type_of_genre(int) set search_path = public;
alter function public.roll_tier() set search_path = public;
alter function public.refill_stock(public.profiles) set search_path = public;
alter function public.require_user() set search_path = public;

drop policy "own packs" on public.packs;
create policy "own packs" on public.packs for select to authenticated using (owner = (select auth.uid()));
drop policy "own offers" on public.offers;
create policy "own offers" on public.offers for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
drop policy "items of own offers" on public.offer_items;
create policy "items of own offers" on public.offer_items for select to authenticated
  using (exists (select 1 from public.offers o where o.id = offer_id
                 and (o.from_user = (select auth.uid()) or o.to_user = (select auth.uid()))));
