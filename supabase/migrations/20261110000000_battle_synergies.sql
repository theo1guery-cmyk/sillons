-- The synergies of the Bataille de cartes: the more cards of the deck share something, the stronger they all get.
-- * same artist: 2 tracks +4 each, 3 +8, 4 +12, 5 +16;
-- * same album (stronger): 2 +6, 3 +12, 4 +18, 5 +24;
-- * same year: 3 +4, 4 +7, 5 +10;
-- * same genre (not Inclassable): 3 +3, 4 +5, 5 +8;
-- * Arc-en-ciel: 5 different rarities, +6 to all.
-- They add up (with the Tête d'affiche too), up to +30 a card for the synergies.

create or replace function public.battle_vals(p_cards uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare owner_id uuid; h jsonb; res jsonb := '[]'; j jsonb; add int; syn int; syns jsonb; t tracks; n int; v int;
  arts text[]; albs text[]; years int[]; gens int[]; rainbow boolean;
begin
  select owner into owner_id from cards where id = p_cards[1];
  h := battle_headliner_json(battle_headliner(owner_id, p_cards));
  select array_agg(lower(t2.artist)), array_agg(lower(t2.artist || '|' || coalesce(t2.album, ''))), array_agg(t2.year::int), array_agg(t2.genre::int), count(distinct c.tier) >= 5
    into arts, albs, years, gens, rainbow from cards c join tracks t2 on t2.id = c.track_id where c.id = any(p_cards);
  for j in select battle_card(c) from cards c where c.id = any(p_cards) order by array_position(p_cards, c.id) loop
    select * into t from tracks where id = (j ->> 'track_id')::bigint;
    add := case when h is null then 0 when coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false) then (h ->> 'syn')::int else (h ->> 'aura')::int end;
    syn := 0; syns := '[]';
    n := (select count(*) from unnest(arts) x where x = lower(t.artist));
    if n >= 2 then v := (array[0, 4, 8, 12, 16])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'artist', 'n', n, 'v', v, 'of', t.artist)); end if;
    if coalesce(t.album, '') <> '' then
      n := (select count(*) from unnest(albs) x where x = lower(t.artist || '|' || t.album));
      if n >= 2 then v := (array[0, 6, 12, 18, 24])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'album', 'n', n, 'v', v, 'of', t.album)); end if;
    end if;
    if t.year is not null then
      n := (select count(*) from unnest(years) x where x = t.year);
      if n >= 3 then v := (array[0, 0, 4, 7, 10])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'year', 'n', n, 'v', v, 'of', t.year::text)); end if;
    end if;
    if t.genre is not null and t.genre <> 10 then
      n := (select count(*) from unnest(gens) x where x = t.genre);
      if n >= 3 then v := (array[0, 0, 3, 5, 8])[least(n, 5)]; syn := syn + v; syns := syns || jsonb_build_array(jsonb_build_object('k', 'genre', 'n', n, 'v', v, 'of', t.genre::text)); end if;
    end if;
    if rainbow then syn := syn + 6; syns := syns || jsonb_build_array(jsonb_build_object('k', 'rainbow', 'n', 5, 'v', 6)); end if;
    syn := least(syn, 30);
    if add + syn > 0 then
      j := j || jsonb_build_object('flow', (j ->> 'flow')::int + add + syn, 'endu', (j ->> 'endu')::int + add + syn, 'hype', (j ->> 'hype')::int + add + syn, 'pw', (j ->> 'pw')::int + add + syn);
    end if;
    if add > 0 then j := j || jsonb_build_object('syn', add, 'star', coalesce((j ->> 'artist_id')::bigint = (h ->> 'artist_id')::bigint, false), 'head', h ->> 'name'); end if;
    j := j || jsonb_build_object('syns', syns, 'sb', syn, 'album', t.album, 'year', t.year, 'genre', t.genre);
    res := res || jsonb_build_array(j);
  end loop;
  return res;
end $$;

-- the Bataille 2.0 (simulation) uses the same synergies instead of its own combos
create or replace function public.battle2_vals(p_cards uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '[]'; j jsonb; t tracks;
begin
  for j in select x from jsonb_array_elements(coalesce(battle_vals(p_cards), '[]')) x loop
    select * into t from tracks where id = (j ->> 'track_id')::bigint;
    j := j || jsonb_build_object('cost', battle2_cost((j ->> 'tier')::int), 'fam', battle2_family(t.genre), 'skill', battle2_skill(t.id, (j ->> 'tier')::int), 'combo', '[]'::jsonb, 'cb', 0);
    res := res || jsonb_build_array(j);
  end loop;
  return res;
end $$;
