# Recherche TARES, NOGA et FINMA : couverture, mesure et limites

Mise à jour le 28.09.2026. Concerne les outils MCP `tariff_semantic_search`, `classify_text` et `finma_search`
(outils à droits ; les outils anonymes `tariff_lookup`, `kyc_check` et `cross_walk` sont inchangés).

## Ce qui est servi

### `tariff_semantic_search` (TARES)

- **Index** : `src/mcp/data/embeddings/tares_index.json` (métadonnées et textes) et `tares_index.bin` (vecteurs).
- **Source** : structure tarifaire publiée par l'OFDF, `Tarifstruktur.xlsx`
  (<https://www.bazg.admin.ch/dam/de/sd-web/x0cFz-OgqaF2/Tarifstruktur.xlsx>), feuille `Struktur_01.03.2025`,
  « Stand 11.02.2025 », SHA-256 `5610cb42…88601126`, lue le 28.09.2026 (Last-Modified du serveur : 22.12.2025).
  Ce fichier est identique, octet pour octet, à celui lu en avril 2026, et c'est celui que surveille le contrôle
  des sources (`etl/canary-baseline.json`, clé `tares.tarifstruktur`). Un test vérifie que les deux empreintes
  restent égales.
- **Couverture** : 7 511 lignes à 8 chiffres, soit exactement les lignes du TARES embarqué (`tares.csv`) et le
  nombre de lignes de la version servie 2026.09.28.
- **Texte de chaque ligne** : son chemin officiel, dans les quatre langues : position à 4 chiffres, textes
  intermédiaires non numérotés et sous-positions (VT6, TN6, VT8), puis la ligne. Exemple pour 0901.2100 :
  « Café, même torréfié ou décaféiné; … › café torréfié › non décaféiné ». Sans ce chemin, « non décaféiné »
  ou « autres » ne disait pas de quel produit il s'agissait. Le titre du chapitre n'est pas ajouté : mesuré,
  il n'améliorait rien. Les sous-chapitres ne sont pas ajoutés non plus.
- **Classement** :
  1. d'abord les mots officiels : BM25 sur les trigrammes de caractères des quatre chemins, divisé par le
     meilleur score de la requête ;
  2. ensuite le sens, avec un poids de 0,3 : le cosinus avec le vecteur de la ligne, ramené entre la médiane
     et le maximum des lignes. Il départage les ex æquo et rattrape les synonymes ;
  3. si aucune ligne ne partage un trigramme avec la requête, le sens seul.

  Une requête en forme de numéro (2 à 8 chiffres, points admis) liste les lignes de ce numéro, sans
  charger le modèle.
- **Réponse** : pour chaque ligne, le code, la désignation dans la langue demandée (`lang`, FR par défaut), le
  chemin officiel, un score relatif, la similarité, le rang par mots et `in_current_tares`. S'y ajoutent
  `data_version`, la version TARES servie (`null` quand c'est la copie embarquée), et `index`, qui décrit
  l'index utilisé : date de construction, source, version, empreinte, nombre d'entrées, langues, modèle et
  révision.

### `classify_text` (NOGA 2025)

- **Index** : `noga_2025_index.json` et `noga_2025_index.bin`.
- **Source** : `data/classifications/classifications-2026.04.29-test-work/noga_2025.csv`, qui provient de
  l'OFS par i14y et suit le référentiel de classifications 2026.09.25. Son SHA-256 est `01f645ab…3b52fff9` ; un
  test vérifie que l'index vient bien de ce fichier.
- **Couverture** : 798 genres à 6 chiffres, et donc les 651 classes. Une classe n'apparaît plus à côté de son
  genre de même libellé : l'ancien index en occupait deux places sur cinq.
- **Texte vectorisé** : le libellé du genre dans les quatre langues. Section, division, groupe et classe sont
  rendus dans `path`, mais pas ajoutés au texte : sur le jeu d'évaluation, les ajouter faisait tomber le top-1
  de 83 % à 62 %.
- **Réponse** : le genre, son libellé dans la langue demandée, `class_code` (la classe à 4 chiffres, qui est
  aussi la classe NACE 2.1), `path` et un score (cosinus). S'y ajoutent `reference_version`, la version du
  référentiel servi par `cross_walk`, et `index`. Un code saisi (« 62.10 », « NOGA 1071 ») liste ses genres.

### `finma_search` (registre FINMA)

- **Classement** : le même que `kyc_check`, défini dans `src/mcp/name-match.ts` : exact, début sur un mot entier,
  mot entier, début de nom, sous-chaîne, puis tous les mots dans un autre ordre. Les suppositions de frappe
  viennent toujours après, avec une distance d'édition de 1 pour un mot de 4 à 7 lettres et de 2 à partir de
  8 lettres. Un mot de moins de 4 lettres doit correspondre exactement.
- **Normalisation, des deux côtés** : casse, accents et ponctuation ; retrait des formes juridiques (AG, SA,
  Sàrl, GmbH, Ltd, S.A., société anonyme…) ; comparaison supplémentaire de ä/ö/ü sous la forme ae/oe/ue.
- **Bornes** : 200 caractères et 8 mots distincts au plus. Les formes normalisées du registre sont calculées une
  fois par version chargée ; les distances d'édition, une fois par mot distinct.
- **Réponse** : chaque résultat porte `match_type` (`exact` … `fuzzy`) et un score qui dépend du type. Si aucun
  nom ne correspond, la réponse est vide au lieu du nom le moins éloigné. Elle indique aussi `data_version`, la
  version FINMA servie (`null` pour la copie embarquée).

## Mesure

Jeu d'évaluation : `scripts/search-eval/cases.json`. Chaque attente est justifiée par un fragment mot pour mot de
la désignation officielle ou par un nom du registre embarqué, et le script vérifie ces justifications. Mesure :
`scripts/evaluate-search.ts`. Le script appelle les vrais gestionnaires, avec l'index livré et le modèle figé,
et coupe le réseau pendant la mesure.

| Outil | Jeu | Requêtes | Avant : top-1 / top-5 / MRR | Après : top-1 / top-5 / MRR |
|---|---|---:|---|---|
| tariff_semantic_search | principal FR/DE/EN/IT | 51 | 35,3 % / 49,0 % / 0,419 | 74,5 % / 82,4 % / 0,790 |
| tariff_semantic_search | contrôle | 20 | 25,0 % / 45,0 % / 0,361 | 65,0 % / 80,0 % / 0,714 |
| tariff_semantic_search | numéros tarifaires | 4 | 0 % / 0 % / 0 | 100 % / 100 % / 1 |
| classify_text | principal | 24 | 62,5 % / 91,7 % / 0,742 | 83,3 % / 95,8 % / 0,885 |
| classify_text | contrôle | 10 | 30,0 % / 70,0 % / 0,524 | 70,0 % / 100 % / 0,808 |
| classify_text | codes NOGA | 2 | 0 % / 0 % / 0 | 100 % / 100 % / 1 |
| finma_search | principal | 22 | 81,8 % / 95,5 % / 0,886 | 95,5 % / 100 % / 0,970 |

Comment lire ces chiffres :

- **Jeu principal** : il a servi à choisir la méthode parmi une dizaine de variantes. Ses résultats sont donc
  optimistes.
- **Jeu de contrôle** : il a été écrit après ce choix et mesuré une seule fois. C'est l'estimation honnête.
- **Précision** : une requête vaut 2 points sur 51, 5 points sur 20, 4 points sur 24 et 10 points sur 10.
- **TARES** : l'essentiel du gain vient des mots officiels du chemin. Les vecteurs du chemin seuls ne donnent
  que 41 % de top-1, contre 35 % avant.
- **Dégradations** : sur le jeu principal, 6 requêtes TARES classent la bonne ligne moins haut qu'avant, dont
  deux sortent des vingt premiers : « Traktor für die Landwirtschaft » et « scarponi da sci ». FINMA en compte
  une, « Julius Baer » (rang 2 → 3), parce que le classement imposé place d'abord les noms qui commencent par
  les mots de la requête. NOGA n'en compte aucune.

## Reconstruire les index

1. Préparer le modèle figé : `npm run models:prepare:embedding`.
2. Obtenir la structure tarifaire du jour dans un bronze daté, par la collecte de l'ETL (`downloadAllSources`
   dans `etl/tares/sources.ts`), sans publication.
3. Lancer `npx tsx scripts/build-search-indexes.ts --tares --noga --tarifstruktur <bronze>/tarifstruktur-<sha>.xlsx`.
   L'option `--cache <dossier privé>` réutilise des vecteurs déjà calculés pour les mêmes textes.
4. Mesurer avec `npx tsx scripts/evaluate-search.ts --structure <même fichier>`, puis comparer aux tableaux
   ci-dessus avant de remplacer les index livrés.

Il faut reconstruire l'index TARES quand le contrôle des sources signale une nouvelle `Tarifstruktur`, et l'index
NOGA quand `noga_2025.csv` change. Les tests échouent tant que l'index ne suit pas.

## Limites connues

- **Publication hebdomadaire du TARES** : elle ne met pas l'index à jour. Une ligne de l'index absente de la
  version servie est signalée (`in_current_tares: false`) ; une ligne nouvelle du tarif n'est pas trouvable par
  cet outil avant reconstruction, mais reste lisible avec `tariff_lookup`.
- **Mots des chemins** : les mots viennent du vocabulaire officiel. Une négation (« nicht geröstet ») partage les
  mêmes mots que l'affirmation, et c'est le sens qui départage. Un nom commercial absent des désignations
  (« jeans », « E-Bike ») dépend du sens seul, dont le poids est limité.
- **Longueur des chemins** : 540 chemins français sur 7 511 (7 %) dépassent les 128 jetons d'entraînement du
  modèle. Transformers.js ne les tronque pas (jusqu'à 512 jetons).
- **Vecteurs de l'index et de la requête** : ceux de l'index sont calculés par lots de 32 textes triés par
  longueur, alors qu'une requête est vectorisée seule. Les 51 requêtes TARES, vectorisées des deux façons, gardent
  un cosinus d'au moins 0,99 entre les deux résultats.
- **Encodage des vecteurs** : sur 8 bits, avec un écart de cosinus au plus de 0,003 par rapport au float32. Sur
  les 51 requêtes, le premier résultat du sens est le même 50 fois et les cinq premiers sont identiques.
- **Classification NOGA** : une classification libre n'a pas de réponse officielle, et le score ne remplace pas
  l'attribution de l'OFS. L'italien n'est pas mesuré pour NOGA.
- **FINMA, tous les mots** : le niveau « tous les mots » reprend `kyc_check` et accepte une sous-chaîne.
  « Credit Suisse », absent du registre, rend ainsi « Crédit Agricole next bank (Suisse) SA » avec le type
  `all_words`.
- **FINMA, version mesurée** : la mesure porte sur la copie embarquée d'avril. En production, le registre est
  actualisé chaque jour depuis R2.
- **Fichiers vendus** : l'archive TARES vendue contient toujours les vecteurs historiques de l'ETL
  (`etl/tares/embeddings.ts`, désignation française de la ligne seule). Ce chantier ne la modifie pas.
