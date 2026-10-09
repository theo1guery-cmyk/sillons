-- More "Diamant d'honneur" (Diamant whatever the fan count), picked by Theo: Mauvais Djo 148380152, Céline Dion 198,
-- Aya Nakamura 8909272, GIMS 4429712, Niska 5288900, Booba 390, PNL 1519461 — with Travis Scott 4495513,
-- Kanye West 230, Kendrick Lamar 525046. Same list in app.js (HONOR). Cards already pulled keep their certification.
create or replace function public.cert_of(fans int, artist bigint) returns smallint language sql immutable set search_path = public as $$
  select case when artist in (4495513, 230, 525046, 148380152, 198, 8909272, 4429712, 5288900, 390, 1519461) then 5::smallint else cert_of(fans) end
$$;
