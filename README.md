# Sillons TCG

Un jeu de cartes à collectionner où chaque carte est un vrai morceau de Deezer, pioché en direct dans tout le catalogue. Plus un morceau est écouté, plus sa carte est rare : les légendaires sont les vrais tubes.

## Jouer en local

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765.

## Comment ça marche

- **Pas de serveur.** Le navigateur appelle directement l'API publique Deezer en JSONP (l'API n'autorise pas les appels `fetch` depuis un autre site).
- **Booster Mix** : recherches aléatoires dans tout Deezer (mots courants en plusieurs langues et combinaisons de lettres). Pour les raretés hautes, les résultats sont triés par popularité.
- **Boosters par genre** : radios de genre de Deezer, en vérifiant le vrai genre de l'album.
- **Rareté** : selon le classement Deezer (`rank`, de 0 à 1 000 000).

  | Rareté | Classement Deezer |
  |---|---|
  | Commune | moins de 200 000 |
  | Peu commune | 200 000 et plus |
  | Rare | 400 000 et plus |
  | Épique | 650 000 et plus |
  | Légendaire | 850 000 et plus |

- **Stats** : rythme (BPM), endurance (durée), hype (classement), puissance (moyenne pondérée).
- **Sauvegarde** : la collection est stockée dans le `localStorage` du navigateur.
- **Limite de débit** : Deezer accepte environ 50 requêtes par 5 secondes par IP. Un booster en utilise 15 à 30, et le jeu temporise et réessaie tout seul.

## Fichiers

- `index.html` : la page
- `styles.css` : le design (cartes, boosters, collection)
- `app.js` : les appels Deezer, les tirages, la collection, les extraits audio
