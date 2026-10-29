-- The Bataille 2.0 (admin simulation) is removed. What the Bataille kept from it stays: the families
-- (battle2_family), the skills (battle2_skill) and the defense plan (battle_decks.plan).
delete from public.battles where v2 or mode = 'sim';
drop function if exists public.battle2_home();
drop function if exists public.set_battle_deck2(uuid[], text);
drop function if exists public.battle2_start();
drop function if exists public.battle2_play(uuid, int, int, boolean);
drop function if exists public.battle2_ai(battles);
drop function if exists public.battle2_view(battles);
drop function if exists public.battle2_vals(uuid[]);
drop function if exists public.battle2_deck_of(uuid);
drop function if exists public.battle2_budget(int);
drop function if exists public.battle2_cost(int);
alter table public.battle_decks drop column if exists cards2;
