# Sillons TCG

Un jeu de cartes à collectionner où chaque carte est un vrai morceau de Deezer, pioché en direct dans tout le catalogue. Plus un morceau est écouté, plus sa carte est rare : les légendaires sont les vrais tubes.

## Jouer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765.

## Comment ça marche

- **Pas de serveur.** Le navigateur appelle directement l'API publique Deezer en JSONP (l'API n'autorise pas les appels `fetch` depuis un autre site).
- **Booster** : un seul type de booster, 5 cartes tirées dans tout Deezer. La recherche aléatoire mélange des milliers de mots, prénoms, villes, années et syllabes inventées, à une profondeur de résultats aléatoire, pour atteindre des millions de morceaux. 
- **Boutique** : des boosters d'un seul genre (Deezer genre radios, avec vérification du genre de l'album), gratuits pendant les tests, payants plus tard (vinyles ou argent réel).
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
- **Doublons** : un morceau déjà possédé est écarté. Il ne revient que si aucun nouveau morceau de cette rareté n'est trouvé.
- **Pitié** : après 70 boosters sans Mythique ni Légendaire, le suivant en contient une.
- **Mode test** (`TEST_MODE` dans `app.js`) : boosters illimités. Une fois désactivé, le stock s'applique.
- **Stock** : 10 boosters maximum, un nouveau toutes les 30 minutes quand le stock n'est pas plein. Un booster qui échoue à s'ouvrir est rendu.
- **Stats** : rythme (BPM), endurance (durée), hype (classement), puissance (moyenne pondérée).
- **Sauvegarde** : la collection, le stock et le compteur de pitié sont stockés dans le `localStorage` du navigateur.
- **Limite de débit** : Deezer accepte environ 50 requêtes par 5 secondes par IP. Un booster en utilise 15 à 30, et le jeu temporise et réessaie tout seul.

## Fichiers

- `index.html` : la page
- `styles.css` : le design (cartes, boosters, collection)
- `app.js` : les appels Deezer, les tirages, la collection, les extraits audio
