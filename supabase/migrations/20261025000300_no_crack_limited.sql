-- A graded limited edition (Collection Hantée, Nuit d'Halloween) stays in its case for good: its case cannot be cracked.
create or replace function public.crack_slab(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_user(); c cards;
begin
  select * into c from cards where id = p_card and owner = uid for update;
  if c.id is null then raise exception 'card_not_owned'; end if;
  if c.grade is null then raise exception 'not_graded'; end if;
  if c.edition is not null then raise exception 'limited_edition_case'; end if;
  if is_listed(p_card) then raise exception 'card_listed'; end if;
  if exists (select 1 from offer_items i join offers o on o.id = i.offer_id where o.status = 'pending' and i.card_id = p_card) then
    raise exception 'card_in_offer';
  end if;
  update cards set grade = null, grade_cert = null, grade_pop = null, graded_at = null where id = p_card;
end $$;
