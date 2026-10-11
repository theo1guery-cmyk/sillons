# Zik Hunter

Un jeu de cartes à collectionner où chaque carte est un vrai morceau de Deezer, pioché en direct dans tout le catalogue. Plus un morceau est écouté, plus sa carte est rare : les légendaires sont les vrais tubes.

## Jouer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765.

## Comment ça marche

- **Pas de serveur.** Le navigateur appelle directement l'API publique Deezer en JSONP (l'API n'autorise pas les appels `fetch` depuis un autre site).
- **Booster** : 5 cartes tirées dans tout Deezer.
  - **Communes** : tirage d'un numéro de morceau au hasard (de 1 à 4,2 milliards), donc chaque morceau a la même chance, même ceux que personne n'écoute. Environ 1 numéro sur 12 est un morceau jouable, alors une boucle en arrière-plan garde une réserve prête quand Deezer n'est pas occupé. Si la réserve est vide, recherche aléatoire (mots, prénoms, villes, années, syllabes).
  - **Raretés plus hautes** : playlists publiques, marche d'artiste en artiste (artistes similaires) et recherches triées par popularité. Les morceaux trouvés en route sont gardés en réserve pour les tirages suivants.
- **Boutique** : des boosters d'un seul genre (playlists du genre, artistes du genre et radios Deezer, avec vérification du genre de l'album) à 100 Streams (`genre_pack_price`), compte obligatoire. Remboursés si l'ouverture échoue.
- **Catalogue** : recherche dans tout Deezer (titre ou artiste), avec les tubes du moment par défaut. Chaque carte montre sa rareté et si tu l'as déjà. Le genre, le BPM et l'année ne sont chargés que pour les cartes visibles à l'écran.
- **Rareté** : selon le classement Deezer (`rank`, de 0 à 1 000 000).

  | Rareté | Classement Deezer | Chance par carte |
  |---|---|---|
  | Commune | moins de 250 000 | 70 % |
  | Peu commune | 250 000 et plus | 21 % |
  | Rare | 450 000 et plus | 7 % |
  | Épique | 700 000 et plus | 1,7 % |
  | Mythique | 850 000 et plus | 0,28 % |
  | Légendaire | 950 000 et plus | 0,02 % |

- **Tirage** : les 5 cartes ont les mêmes chances (pas de carte garantie) et sont révélées de la moins rare à la plus rare. En moyenne, une Légendaire tous les 1 000 boosters.
- **Doublons** : jamais de doublon de la Commune à l'Épique (si aucune nouveauté de la rareté voulue n'est trouvée, on prend une nouveauté de la rareté la plus proche). Mythiques et Légendaires peuvent revenir.
- **Test** : 500 boosters puis 100 packs de genre d'affilée sur une collection vierge, soit 3 000 cartes et 0 doublon.
- **Shiny** (plus de Holo) : une Mythique ou Légendaire (ou un artiste Platine ou Diamant) a 1 chance sur 100 (`shiny_chance`) d'être Shiny : carte noire laquée, lettres dorées, reflet de lumière, pochette en couleur. Seules les Mythiques, Légendaires et Diamant ont une animation de reflet (performances).
- **Raccourci local** `#galerie` : une carte de chaque sorte, pour vérifier les designs.
- **GOD pack** : 1 booster sur 3 000 se transforme en GOD pack (pack doré animé). Il contient 1 Légendaire garantie, et chacune des 4 autres cartes a 50 % de chances d'être Mythique et 50 % d'être Légendaire. Ne s'applique pas aux packs de la Boutique.
- **Animations de révélation** : les Épiques, Mythiques et Légendaires se chargent dans leur couleur avant de se retourner (aura, tremblement), puis éclatent (onde, étincelles). Pour les Légendaires, l'écran s'assombrit, des rayons dorés tournent et un flash blanc accompagne le bandeau. « Tout retourner » révèle les cartes une par une.
- **Raccourcis locaux** (seulement sur localhost) : `#god` à la fin de l'adresse donne un GOD pack au prochain booster, `#demo` un booster avec une Épique, une Mythique et une Légendaire.
- **Pitié** : après 70 boosters sans Mythique ni Légendaire, le suivant en contient une.
- **Mode test** (`TEST_MODE` dans `app.js`) : boosters illimités. Une fois désactivé, le stock s'applique.
- **Stock** : 10 boosters maximum, un nouveau toutes les 10 minutes quand le stock n'est pas plein. Un booster qui échoue à s'ouvrir est rendu.
- **Stats** : rythme (BPM), endurance (durée), hype (classement), puissance (moyenne pondérée).
- **Comptes (Supabase)** : connexion par e-mail et mot de passe, avec vérification de l'adresse par lien. Avec un compte, la collection est sur le serveur. Le serveur tire les raretés (GOD pack et pitié compris), le navigateur cherche les morceaux, puis le serveur les vérifie sur Deezer : une carte n'est jamais plus rare que son tirage. Toutes les écritures passent par des fonctions SQL (`supabase/migrations/`), les tables sont en lecture seule pour les joueurs.
- **Échanges** : 1 à 5 cartes de chaque côté. Le serveur échange les deux côtés d'un coup, ou rien du tout ; une offre dont une carte a changé de main expire. Il faut un compte assez ancien (réglage `trade_min_age`, 48 h prévu, 0 pendant les tests) et 20 offres en attente au maximum. Une collection importée d'avant les comptes est échangeable elle aussi.
- **Streams** (monnaie, côté serveur uniquement, avec un historique dans `stream_ledger`) : défausse des doublons (1 pour Commune, Peu commune et Rare, 10 pour Épique, 50 pour Mythique, 100 pour Légendaire ; on garde toujours un exemplaire), prime de connexion sur 7 jours (5 → 50), 3 défis du jour par joueur (tirés parmi `daily_defs`, renouvelés à minuit heure de Paris), succès permanents bronze, argent et or (`achievements`) qui débloquent des titres affichables sous le pseudo.
- **Marché (« La Bourse aux disques »)** : vente à prix fixe en Streams, achat immédiat, taxe de 5 % (`market_fee_pct`), annonces de 7 jours (`listing_days`), 50 annonces maximum. Prix plancher = valeur de défausse. Une carte en vente ne peut être ni défaussée ni proposée en échange. Historique des ventes par titre (`sales`) qui donne la cote affichée sur les cartes. Succès « Trader » et défis du jour « vends / achète une carte ».
- **Albums et discographies** : chaque titre est rattaché à son album (`tracks.album_id`). Un album (type album ou EP sur Deezer) est complet quand on possède tous ses titres : 10 Streams par titre (de 50 à 500), vérifié sur la liste Deezer actuelle. Une discographie = tous les albums studio d'un artiste (`is_studio` écarte éditions spéciales, lives, remixes, compilations) : 200 Streams par album, 500 minimum. Une tâche `pg_cron` (`sillons-backfill`, chaque minute) rattache les titres importés à leur album et charge les listes de titres manquantes.
- **Cartes d'artiste** (avec un compte) : chaque carte d'un booster a 1 chance sur 50 d'être un artiste. Rareté = certification selon les fans Deezer : Démo (< 1 000), Single (1 000+), Disque d'argent (20 000+), d'or (150 000+), de platine (1 M+), de diamant (7 M+, plus trois « Diamant d'honneur » sous-comptés par Deezer : Travis Scott, Kanye West, Kendrick Lamar, plus Mauvais Djo, Céline Dion, Aya Nakamura, GIMS, Niska, Booba et PNL), tirée avec les mêmes chances que les raretés des morceaux et vérifiée par le serveur. Cadre dans la matière de la certification (carton, laque, argent, or, platine, cristal taillé). Les Platine sont les petites sœurs de l'Icône Diamant : photo pleine carte, nom satiné à la verticale, cadre arrondi en platine brossé, pastille « PLATINE » avec un petit disque, sans signature (Shiny : laque noire et lettres dorées). Compléter une discographie donne la carte Collector de l'artiste (noire laquée, photo en noir et blanc, lettres dorées ; liée au compte : ni échangeable, ni vendable, ni défaussable). Succès « Mur des artistes ».
- **Liste de souhaits** (avec un compte) : bouton ♡ dans la fiche d'une carte non possédée et dans la liste des titres d'un album ; section dans le Marché avec le prix le plus bas en vente ; alerte (pastille + message) dès qu'une carte de la liste est mise en vente ; une carte obtenue sort de la liste.
- **Étiquettes** (avec un compte) : jusqu'à 40 étiquettes colorées par joueur, posées depuis la fiche d'une carte, filtre dans la Collection, points de couleur sous les cartes.
- **Clashs blind test** (avec un compte) : deck de 5 morceaux (+ 1 carte d'artiste en bonus). Défi entre amis en différé : 6 manches (3 morceaux de chaque deck), extrait + 4 réponses ; le serveur choisit les manches, garde la bonne réponse (table `duel_rounds` illisible pour les joueurs) et chronomètre. Stats : rythme → durée de l'extrait (8 à 20 s), endurance → bouclier (jusqu'à −50 %), hype → difficulté (jusqu'à ×2), puissance → dégâts (×5) si l'adversaire sèche. Victoire +50 Streams, défaite +10, égalité +25 (10 clashs récompensés par jour), cote Elo et classement. Pari de cartes optionnel, accepté par les deux : les cartes pariées sont bloquées pendant le duel, le perdant donne la sienne. Mode Entraînement sur sa propre collection.
- **Réglages serveur** (table `settings`) : `test_mode`, `god_chance`, `pity`, `trade_min_age`, `max_pending_offers`.
- **Sauvegarde sans compte** : la collection, le stock et le compteur de pitié sont stockés dans le `localStorage` du navigateur.
- **Limite de débit** : Deezer accepte environ 50 requêtes par 5 secondes par IP. Un booster en utilise 15 à 30, et le jeu temporise et réessaie tout seul.

## Fichiers

- `index.html` : la page
- `styles.css` : le design (cartes, boosters, collection)
- `app.js` : les appels Deezer, les tirages, la collection, les extraits audio
- `online.js` : comptes, collection en ligne, import et échanges (Supabase)
- **Annonces Discord** : GOD packs, Légendaires, Shiny et artistes Platine ou Diamant sont annoncés dans un salon Discord par un webhook (adresse réglée dans la page Admin, gardée dans une table illisible par les joueurs ; envoi par `pg_net`, sans ralentir le booster). Migration `20261010000200_discord.sql`.
- **Streams** : la monnaie a sa pièce, un disque d'or (`brand/streams-coin.svg`). Quand le solde monte, des pièces volent de l'endroit cliqué jusqu'au compteur, qui compte jusqu'au nouveau solde (`coinRain` dans `app.js`, appelée par `loadProfile` ; rien si « réduire les animations » est activé).
- **Annonces Discord des cadeaux** : un GOD pack ou une carte offerts par l'équipe sont annoncés comme tels (« 🎁 … GOD pack offert », « 🎁 Offerte » sur la carte). Migration `20261011000000_discord_gifts.sql`.
- **Albums rapides** : `my_albums_fast()` compte les titres possédés de chaque album depuis `tracks.album_id`, lit la longueur de la liste dans `albums.n_tracks` (colonne calculée) et renvoie chaque album en tableau court, avec le nombre de cartes sans album. Environ 10 fois plus rapide que `my_albums()` pour les collections de plus de 50 000 cartes. Migration `20261011000100_albums_fast.sql`.
- **Vinyles** (monnaie rare) : achètent un palier du pass (30) ou le Pass Premium (450). Gagnés sans payer : 2 par prime du jour, 5 par succès, et certains paliers du pass ; l'équipe peut en donner depuis la page Admin. `add_vinyls()` et `vinyl_ledger`, migration `20261011000400_vinyls.sql`.
- **Pass saisonnier** (onglet Pass) : 30 paliers par saison, une récompense gratuite et une Premium par palier (Streams, boosters, ou une carte offerte dans le prochain booster). XP : 5 par booster, +50 pour un GOD pack, 1 pour 10 Streams gagnés en jouant (pas les ventes ni les défausses), comptée par des déclencheurs. Le Premium s'active depuis la page Admin (pas encore de paiement). `pass.js`, `pass.css`, migration `20261011000200_season_pass.sql`.
- **GOD pack offert** : depuis la fiche d'un joueur (page Admin), son prochain booster est un GOD pack (`forced_gods`, vérifié dans `start_pack`). Migration `20261010000300_force_god.sql`.
- **Carte offerte** : depuis la fiche d'un joueur (page Admin), la dernière carte de son prochain booster est la carte choisie : Mythique, Légendaire, artiste Platine ou Diamant, Shiny ou non (`forced_cards` dans `start_pack`, `packs.shiny_slot` dans `finish_pack`). Migrations `20261010000400_gift_artist.sql` puis `20261010000500_gift_cards.sql`.
- **Cartes offertes reprises** : les cartes d'un GOD pack offert ou d'une carte offerte sont marquées (`cards.gifted`) ; la fiche d'un joueur les liste et peut les supprimer une par une ou toutes (avec les cartes de test, `source = 'test'`). Migrations `20261010000600_gifted_cards.sql` et `20261010000700_delete_one_gift.sql`. Les cadeaux ouverts avant le marquage sont retrouvés grâce au journal admin, et un booster qui n'a pas pu être rempli rend son cadeau (`abandon_pack`) : `20261010000800_find_old_gifts.sql`.
- `sw.js` : garde sur l'appareil, après la première visite, les fichiers de l'animation des artistes (three.js et modèles de la pochette signée) ; sur ordinateur, la scène est aussi préparée en arrière-plan dès l'ouverture de la page
- `admin.js`, `admin.css` : page Admin (comptes de la table `admins`) : joueurs en ligne en temps réel, comptes, bannissements, avertissements, message à tous, Streams et boosters, journal des actions ; côté joueur, l'écran de suspension et les messages de l'équipe
- `duels.js` : clashs blind test et entraînement
- `supabase/migrations/` : la base de données, les règles d'accès et les fonctions serveur

## Crédits

- Platine 3D de l'ouverture des hits : « [Yamaha TT-300 Record Player](https://sketchfab.com/3d-models/yamaha-tt-300-record-player-3577a2a1a0c24218bd5d768beccf218e) » par [AleixoAlonso](https://sketchfab.com/AleixoAlonso), licence [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Modifiée : textures compressées, marques effacées, couvercle retiré (`brand/3d/`).
- Rendu 3D : [three.js](https://threejs.org) 0.160, chargé depuis jsDelivr seulement quand un booster contient un hit.
