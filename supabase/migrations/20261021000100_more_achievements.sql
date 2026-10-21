-- Many more achievements (about 45 new ones), in clearer groups. Also fixes four that stayed at 0 since
-- faster_achievements (albums, discos, artists, duelist were left out of achievement_values).
-- The values are computed in one pass over the player's cards and kept in achievement_cache.

insert into public.achievements (key, pos, category, label, description, goals, rewards, titles) values
  -- Collection
  ('total_cards', 105, 'Collection', 'Gros stock', 'Cartes au total, doublons compris', '{500,5000,25000}', '{50,200,800}', '{Stockeur,Entrepôt,Hangar}'),
  ('rares', 106, 'Collection', 'Rare collection', 'Rares différentes', '{25,250,1000}', '{50,200,800}', '{Curieux,Collectionneur averti,Conservateur}'),
  ('dupes', 107, 'Collection', 'Photocopieuse', 'Exemplaires d''une même carte', '{5,10,25}', '{50,150,500}', '{Doublon,Photocopieuse,Clonage}'),
  ('artists_n', 108, 'Collection', 'Carnet d''adresses', 'Artistes différents parmi tes titres', '{50,500,2000}', '{50,200,800}', '{Réseauteur,Carnet d''adresses,Annuaire}'),
  -- Raretés et Shiny
  ('epics', 203, 'Raretés et Shiny', 'Épique !', 'Épiques possédées', '{10,50,250}', '{50,200,800}', '{Épique,Héroïque,Titan}'),
  ('shiny_leg', 207, 'Raretés et Shiny', 'Joyau', 'Une Légendaire Shiny', '{1}', '{1000}', '{Joyau}'),
  ('diamonds', 208, 'Raretés et Shiny', 'Disque de diamant', 'Artistes certifiés Diamant différents', '{1,5,15}', '{100,400,1500}', '{Certifié,Multi-diamant,Hall of Fame}'),
  -- Musique
  ('explicit', 310, 'Musique', 'Parental Advisory', 'Titres explicites différents', '{10,100,500}', '{50,200,800}', '{Explicite,Censuré,Parental Advisory}'),
  ('oldies', 311, 'Musique', 'Vieux de la vieille', 'Titres sortis avant 1980', '{5,50,200}', '{50,200,800}', '{Rétro,Vintage,Antiquaire}'),
  ('fresh', 312, 'Musique', 'Tout frais', 'Titres sortis cette année', '{10,100,500}', '{50,200,800}', '{À la page,Tendance,Avant-gardiste}'),
  ('slow', 313, 'Musique', 'Tempo zen', 'Titres sous 80 BPM', '{5,50,200}', '{50,200,800}', '{Posé,Chill,Zen}'),
  ('long', 314, 'Musique', 'Fresque', 'Titres de plus de 6 minutes', '{5,25,100}', '{50,200,800}', '{Patient,Contemplatif,Épopée}'),
  ('y2k', 315, 'Musique', 'Nostalgie 2000', 'Titres sortis entre 2000 et 2009', '{10,100,500}', '{50,200,800}', '{Millennial,Bling-bling,Y2K}'),
  ('nineties', 316, 'Musique', 'Années 90', 'Titres sortis entre 1990 et 1999', '{10,100,500}', '{50,200,800}', '{Baggy,Walkman,Génération 90}'),
  -- Genres
  ('g_rap', 401, 'Genres', 'Tête de rap', 'Titres Rap différents', '{25,100,500}', '{30,120,500}', '{Rappeur,MC,Légende du rap}'),
  ('g_pop', 402, 'Genres', 'Pop star', 'Titres Pop différents', '{25,100,500}', '{30,120,500}', '{Popeux,Idole,Pop star}'),
  ('g_rock', 403, 'Genres', 'Rockeur', 'Titres Rock différents', '{25,100,500}', '{30,120,500}', '{Rockeur,Guitar hero,Rock star}'),
  ('g_electro', 404, 'Genres', 'Clubbeur', 'Titres Électro différents', '{25,100,500}', '{30,120,500}', '{Clubbeur,DJ,Headliner}'),
  ('g_soul', 405, 'Genres', 'Âme soul', 'Titres Soul / R&B différents', '{25,100,500}', '{30,120,500}', '{Groovy,Crooner,Soul man}'),
  ('g_chanson', 406, 'Genres', 'Chansonnier', 'Titres Chanson différents', '{25,100,500}', '{30,120,500}', '{Chansonnier,Poète,Grand Prix de la chanson}'),
  ('g_jazz', 407, 'Genres', 'Jazzman', 'Titres Jazz / Blues différents', '{25,100,500}', '{30,120,500}', '{Swingueur,Jazzman,Bluesman}'),
  ('g_latino', 408, 'Genres', 'Caliente', 'Titres Latino différents', '{25,100,500}', '{30,120,500}', '{Bailador,Caliente,Rey latino}'),
  ('g_afro', 409, 'Genres', 'Good vibes', 'Titres Afro / Reggae différents', '{25,100,500}', '{30,120,500}', '{Vibes,Rasta,Afro king}'),
  ('g_classique', 410, 'Genres', 'Maestro', 'Titres Classique / BO différents', '{25,100,500}', '{30,120,500}', '{Mélomane,Chef d''orchestre,Maestro}'),
  -- Titres
  ('love', 501, 'Titres', 'Love songs', 'Titres avec « love » ou « amour »', '{5,25,100}', '{50,200,800}', '{Romantique,Cœur d''artichaut,Cupidon}'),
  ('night', 502, 'Titres', 'Oiseau de nuit', 'Titres avec « nuit » ou « night »', '{5,25,100}', '{50,200,800}', '{Noctambule,Oiseau de nuit,Vampire}'),
  ('feat', 503, 'Titres', 'Featuring', 'Titres en featuring (feat.)', '{10,100,500}', '{50,200,800}', '{Invité,Collab,Roi du feat}'),
  ('remix', 504, 'Titres', 'Remixeur', 'Remix', '{5,50,200}', '{50,200,800}', '{Remixeur,Bidouilleur,Producteur fou}'),
  ('live', 505, 'Titres', 'En live', 'Titres enregistrés en live', '{5,25,100}', '{50,200,800}', '{Premier rang,Fosse,Backstage}'),
  ('numbers', 506, 'Titres', 'Numérologue', 'Titres avec un chiffre dans le nom', '{10,50,200}', '{50,200,800}', '{Matheux,Numérologue,Calculatrice}'),
  ('colors', 507, 'Titres', 'Palette', 'Titres avec une couleur (rouge, blue, noir…)', '{5,25,100}', '{50,200,800}', '{Peintre,Coloriste,Arc-en-ciel vivant}'),
  -- Gradation
  ('graded', 601, 'Gradation', 'Labo', 'Cartes gradées', '{1,25,100}', '{50,200,800}', '{Expert,Certificateur,Labo}'),
  ('gem', 602, 'Gradation', 'Gem Mint', 'Cartes gradées 10', '{1,5}', '{500,2000}', '{Gem Mint,Perfectionniste}'),
  ('first_pop', 603, 'Gradation', 'Numéro 1', 'Cartes gradées #001', '{1,10,50}', '{100,400,1500}', '{Pionnier,Premier de cordée,Patient zéro}'),
  -- Marché et échanges
  ('sales_n', 703, 'Marché et échanges', 'Vendeur', 'Ventes au marché', '{1,25,100}', '{50,200,800}', '{Vendeur,Commerçant,Grossiste}'),
  ('buys', 704, 'Marché et échanges', 'Acheteur', 'Achats au marché', '{1,25,100}', '{50,200,800}', '{Client,Habitué du marché,Acheteur compulsif}'),
  ('big_sale', 705, 'Marché et échanges', 'Grosse vente', 'Ta plus belle vente au marché (Streams)', '{1000,5000,20000}', '{100,400,1500}', '{Bon deal,Jackpot,Coup du siècle}'),
  -- Boosters
  ('store_packs', 802, 'Boosters', 'Client de la Boutique', 'Packs de la Boutique ouverts', '{10,100,500}', '{50,200,800}', '{Client,Habitué,VIP de la Boutique}'),
  ('deluxe', 803, 'Boosters', 'Grand luxe', 'Éditions Deluxe ouvertes', '{1,10,30}', '{50,200,800}', '{Luxe,Grand luxe,Palace}'),
  ('discards', 804, 'Boosters', 'Grand ménage', 'Cartes défaussées', '{100,1000,10000}', '{50,200,800}', '{Rangé,Minimaliste,Marie Kondo}'),
  -- Fidélité et défis
  ('logins', 902, 'Fidélité et défis', 'Toujours là', 'Jours de connexion au total', '{30,100,365}', '{100,400,1500}', '{Régulier,Pilier,Meuble}'),
  ('dailies', 903, 'Fidélité et défis', 'Assidu', 'Défis du jour réussis', '{10,100,500}', '{50,200,800}', '{Assidu,Acharné,Machine}'),
  ('pass_tiers', 904, 'Fidélité et défis', 'Saisonnier', 'Paliers du pass récupérés (toutes saisons)', '{10,30,60}', '{50,200,800}', '{Saisonnier,Vétéran,Tour du monde}'),
  ('ach_hunter', 905, 'Fidélité et défis', 'Chasseur de succès', 'Paliers de succès débloqués', '{10,50,120}', '{100,400,1500}', '{Chasseur,Traqueur,Complétionniste}'),
  ('rentier', 906, 'Fidélité et défis', 'Rentier', 'Streams gagnés au total (hors ventes)', '{1000,10000,100000}', '{50,200,800}', '{Épargnant,Rentier,Nabab}'),
  -- Blind test
  ('duels_played', 1002, 'Blind test', 'Habitué du ring', 'Duels blind test joués', '{10,100,500}', '{50,200,800}', '{Challenger,Habitué du ring,Increvable}'),
  ('duel_rating', 1003, 'Blind test', 'Classé', 'Meilleure cote au blind test', '{1200,1500,1800}', '{100,400,1500}', '{Classé,Maître,Grand maître}')
on conflict (key) do nothing;

-- the old ones, put in the new groups (their goals and claims are kept)
update public.achievements set pos = 101 where key = 'collector';
update public.achievements set pos = 102 where key = 'albums';
update public.achievements set pos = 103 where key = 'discos';
update public.achievements set pos = 104 where key = 'artists';
update public.achievements set pos = 201, category = 'Raretés et Shiny' where key = 'legends';
update public.achievements set pos = 202, category = 'Raretés et Shiny' where key = 'mythics';
update public.achievements set pos = 204, category = 'Raretés et Shiny', label = 'Brillant', description = 'Cartes Shiny', goals = '{1,5,25}' where key = 'holos';
update public.achievements set pos = 205, category = 'Raretés et Shiny' where key = 'rainbow';
update public.achievements set pos = 206, category = 'Raretés et Shiny' where key = 'god';
update public.achievements set pos = 300 + case key when 'digger' then 1 when 'zero' then 2 when 'decades' then 3 when 'genres' then 4 when 'fan' then 5
  when 'alphabet' then 6 when 'marathon' then 7 when 'interlude' then 8 when 'bpm200' then 9 end where category = 'Musique' and pos < 300;
update public.achievements set pos = 701, category = 'Marché et échanges' where key = 'trades';
update public.achievements set pos = 702, category = 'Marché et échanges' where key = 'trader';
update public.achievements set pos = 801, category = 'Boosters' where key = 'opened';
update public.achievements set pos = 901, category = 'Fidélité et défis' where key = 'streak';
update public.achievements set pos = 1001, category = 'Blind test' where key = 'duelist';

create or replace function public.achievement_values(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select c.track_id, c.tier, c.holo, c.rank, t.artist, t.year, t.genre, t.duration, t.bpm, t.explicit, lower(t.title) title
             from cards c join tracks t on t.id = c.track_id where c.owner = p_user and c.kind = 'track'),
       a as (select count(distinct track_id) collector,
                    count(*) filter (where tier = 5) legends,
                    count(*) filter (where tier = 4) mythics,
                    count(*) filter (where tier = 3) epics,
                    count(distinct track_id) filter (where tier = 2) rares,
                    count(*) filter (where holo) holos,
                    count(*) filter (where holo and tier = 5) shiny_leg,
                    count(distinct tier) rainbow,
                    count(distinct track_id) filter (where rank < 1000) digger,
                    count(*) filter (where rank = 0) zero,
                    count(distinct year / 10) filter (where year >= 1950) decades,
                    count(distinct genre) genres,
                    count(distinct upper(left(artist, 1))) filter (where upper(left(artist, 1)) between 'A' and 'Z') alphabet,
                    count(distinct lower(artist)) artists_n,
                    count(*) filter (where duration > 600) marathon,
                    count(*) filter (where duration between 1 and 59) interlude,
                    count(*) filter (where bpm >= 200) bpm200,
                    count(distinct track_id) filter (where bpm between 1 and 79) slow,
                    count(distinct track_id) filter (where duration > 360) long,
                    count(distinct track_id) filter (where explicit) explicit,
                    count(distinct track_id) filter (where year between 1900 and 1979) oldies,
                    count(distinct track_id) filter (where year = extract(year from now())::int) fresh,
                    count(distinct track_id) filter (where year between 2000 and 2009) y2k,
                    count(distinct track_id) filter (where year between 1990 and 1999) nineties,
                    count(distinct track_id) filter (where genre = 0) g_rap,
                    count(distinct track_id) filter (where genre = 1) g_pop,
                    count(distinct track_id) filter (where genre = 2) g_rock,
                    count(distinct track_id) filter (where genre = 3) g_electro,
                    count(distinct track_id) filter (where genre = 4) g_soul,
                    count(distinct track_id) filter (where genre = 5) g_chanson,
                    count(distinct track_id) filter (where genre = 6) g_jazz,
                    count(distinct track_id) filter (where genre = 7) g_latino,
                    count(distinct track_id) filter (where genre = 8) g_afro,
                    count(distinct track_id) filter (where genre = 9) g_classique,
                    count(distinct track_id) filter (where title ~ '(love|amour)') love,
                    count(distinct track_id) filter (where title ~ '(nuit|night)') night,
                    count(distinct track_id) filter (where title ~ '(feat\.|\(with |ft\.)') feat,
                    count(distinct track_id) filter (where title ~ 'remix') remix,
                    count(distinct track_id) filter (where title ~ '(\mlive\M|en concert)') live,
                    count(distinct track_id) filter (where title ~ '[0-9]') numbers,
                    count(distinct track_id) filter (where title ~ '\m(rouge|bleu|blue|noir|black|blanc|white|red|vert|green|jaune|yellow|rose|pink|gold|violet|purple|orange)\M') colors
             from c),
       f as (select coalesce(max(n), 0) fan from (select count(distinct track_id) n from c group by lower(artist)) x),
       d as (select coalesce(max(n), 0) dupes from (select count(*) n from c group by track_id) x),
       g as (select count(*) total_cards,
                    count(*) filter (where grade is not null) graded,
                    count(*) filter (where grade = 10) gem,
                    count(*) filter (where grade_pop = 1) first_pop,
                    count(distinct artist_id) filter (where kind = 'artist') artists,
                    count(distinct artist_id) filter (where kind = 'artist' and tier = 5) diamonds
             from cards where owner = p_user),
       l as (select count(*) filter (where reason like 'achat d''un pack%') - count(*) filter (where reason like 'remboursement d''un pack%') store_packs,
                    coalesce(sum(coalesce(substring(reason from 'défausse de (\d+)')::int, 0)) filter (where reason like 'défausse de%'), 0) discards,
                    count(*) filter (where reason like 'connexion du jour%') logins,
                    count(*) filter (where reason like 'défi du jour%') dailies,
                    coalesce(sum(amount) filter (where amount > 0 and reason not like 'vente au marché%' and reason not like 'remboursement%'), 0) rentier
             from stream_ledger where owner = p_user),
       p as (select gods, opened, best_streak, duel_wins, duel_played, duel_rating from profiles where id = p_user)
  select jsonb_build_object(
    'collector', a.collector, 'legends', a.legends, 'mythics', a.mythics, 'epics', a.epics, 'rares', a.rares, 'holos', a.holos,
    'shiny_leg', a.shiny_leg, 'rainbow', a.rainbow, 'god', p.gods, 'digger', a.digger, 'zero', a.zero, 'decades', a.decades,
    'genres', a.genres, 'fan', f.fan, 'alphabet', a.alphabet, 'artists_n', a.artists_n, 'marathon', a.marathon,
    'interlude', a.interlude, 'bpm200', a.bpm200, 'slow', a.slow, 'long', a.long, 'explicit', a.explicit, 'oldies', a.oldies,
    'fresh', a.fresh, 'y2k', a.y2k, 'nineties', a.nineties,
    'g_rap', a.g_rap, 'g_pop', a.g_pop, 'g_rock', a.g_rock, 'g_electro', a.g_electro, 'g_soul', a.g_soul,
    'g_chanson', a.g_chanson, 'g_jazz', a.g_jazz, 'g_latino', a.g_latino, 'g_afro', a.g_afro, 'g_classique', a.g_classique,
    'love', a.love, 'night', a.night, 'feat', a.feat, 'remix', a.remix, 'live', a.live, 'numbers', a.numbers, 'colors', a.colors)
  || jsonb_build_object(   -- (a jsonb_build_object takes 100 arguments at most)
    'dupes', d.dupes, 'total_cards', g.total_cards, 'graded', g.graded, 'gem', g.gem, 'first_pop', g.first_pop,
    'artists', g.artists, 'diamonds', g.diamonds,
    'albums', (select count(*) from album_claims where owner = p_user),
    'discos', (select count(*) from disco_claims where owner = p_user),
    'trades', (select count(*) from offers where status = 'accepted' and (from_user = p_user or to_user = p_user)),
    'trader', (select coalesce(sum(price - floor(price * (select market_fee_pct from settings) / 100.0)), 0) from sales where seller = p_user),
    'sales_n', (select count(*) from sales where seller = p_user),
    'buys', (select count(*) from sales where buyer = p_user),
    'big_sale', (select coalesce(max(price), 0) from sales where seller = p_user),
    'opened', p.opened, 'streak', p.best_streak,
    'store_packs', greatest(l.store_packs, 0),
    'deluxe', (select count(*) from packs where owner = p_user and kind = 'big' and done),
    'discards', l.discards, 'logins', l.logins, 'dailies', l.dailies, 'rentier', l.rentier,
    'pass_tiers', (select coalesce(sum(cardinality(claimed_free) + cardinality(claimed_premium)), 0) from season_progress where owner = p_user),
    'ach_hunter', (select count(*) from achievement_claims where owner = p_user),
    'duelist', p.duel_wins, 'duels_played', p.duel_played, 'duel_rating', p.duel_rating)
  from a, f, d, g, l left join p on true
$$;

-- the values changed shape: everyone's cache is computed again on the next visit
delete from public.achievement_cache;

-- the profile values read fresh at every visit (not cached): also the blind test ones
create or replace function public.achievement_values_cached(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; n bigint; c achievement_cache; j jsonb; fresh jsonb;
begin
  select * into p from profiles where id = p_user;
  fresh := jsonb_build_object('god', coalesce(p.gods, 0), 'opened', coalesce(p.opened, 0), 'streak', coalesce(p.best_streak, 0),
    'duelist', coalesce(p.duel_wins, 0), 'duels_played', coalesce(p.duel_played, 0), 'duel_rating', coalesce(p.duel_rating, 0),
    'ach_hunter', (select count(*) from achievement_claims where owner = p_user));
  select count(*) into n from cards where owner = p_user;
  select * into c from achievement_cache where owner = p_user;
  -- also computed again after 10 minutes: daily challenges, logins, market and pass move without the cards changing
  if c.owner is not null and c.rev = p.cards_rev and c.n = n and c.at > now() - interval '10 minutes' then return c.j || fresh; end if;
  begin
    j := achievement_values(p_user);
  exception when query_canceled then
    if c.owner is not null then return c.j || fresh; end if;
    raise;
  end;
  insert into achievement_cache (owner, rev, n, j, at) values (p_user, p.cards_rev, n, j, now())
  on conflict (owner) do update set rev = excluded.rev, n = excluded.n, j = excluded.j, at = now();
  return j || fresh;
end $$;
revoke execute on function public.achievement_values_cached(uuid) from public, anon, authenticated;
