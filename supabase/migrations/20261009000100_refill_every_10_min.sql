-- one booster every 10 minutes (was 30), still up to 10 in stock
create or replace function public.refill_stock(p public.profiles) returns public.profiles language plpgsql set search_path = public as $$
declare gained int;
begin
  if p.stock >= 10 then p.stock_at := now(); return p; end if;
  gained := floor(extract(epoch from now() - p.stock_at) / 600);
  if gained > 0 then
    p.stock := least(10, p.stock + gained);
    p.stock_at := case when p.stock >= 10 then now() else p.stock_at + gained * interval '10 minutes' end;
  end if;
  return p;
end $$;
revoke execute on function public.refill_stock(public.profiles) from public, anon, authenticated;
