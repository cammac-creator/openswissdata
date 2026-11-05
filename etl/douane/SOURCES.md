# Commerce extérieur de l'OFDF : collecte privée

> **État au 05.11.2026.** Décision de Claude-Alain du 05.11.2026 : donnée publique sans personne, récoltée et servie
> gratuitement, source citée, depuis l'espace privé, sans lettre ni accord ; retirée sous 48 heures si le propriétaire le
> demande ; rien de cette zone dans le dépôt public, un paquet ou un export ; rien de vendu. **Ce lot s'arrête à la
> collecte : aucune route, aucun outil MCP, aucune page ne lit ce document.** En cas de doute, le code fait foi.

## Source et droits
Éditeur : Office fédéral de la douane et de la sécurité des frontières (OFDF, BAZG en allemand). Fichiers en français,
relus sur les fiches opendata.swiss le 05.11.2026.

| Fichier | Fiche | Adresse | Contenu | Depuis |
|---|---|---|---|---|
| Recettes douanières | [`0e37ee1f`](https://opendata.swiss/fr/dataset/0e37ee1f-9e15-449f-8cf5-84069571d530) | `https://ocean.bazg.admin.ch/open-data-reports/ZE_TN8_IMP_fr/ZE_TN8_IMP_fr.zip` | Importations et droits, par mois, tarif, pays, genre de taux | 2000 |
| Importations | [`e6bcc098`](https://opendata.swiss/fr/dataset/e6bcc098-2c55-4305-a5ed-35c7bf7cde55) | `https://ocean.nivel.bazg.admin.ch/open-data-reports/TN8_IMP_fr/TN8_IMP_fr.zip` | Par mois, tarif, pays | 1988 |
| Exportations | même fiche | `https://ocean.nivel.bazg.admin.ch/open-data-reports/TN8_EXP_fr/TN8_EXP_fr.zip` | Par mois, tarif, pays | 1988 |
| Concordance CPA et tarif | [`6ef9265a`](https://opendata.swiss/fr/dataset/6ef9265a-070f-4b3a-9006-e9827ab1fc1b) | `https://ocean.bazg.admin.ch/open-data-reports/CPA_TN_MAPPING_v1/CPA_TN_MAPPING_v1.csv` | CPA à 6 chiffres, tarif à 8 chiffres, validité | 2012 |

- **Licence affichée : `terms_by_ask`** sur chaque ressource (usage libre avec indication de la source ; usage commercial
  seulement avec l'autorisation de l'éditeur). **Nous n'avons demandé ni obtenu aucun accord pour ces fichiers.**
  L'autorisation écrite du 21.04.2026 vise TARES, pas eux : le registre a une licence distincte
  (`BAZG_BY_ASK`), à ne jamais confondre avec `BAZG`.
- **Règle du 05.11.2026** (`projets/openswissdata/DECISIONS.md`, même règle qu'IBANforge le 28.10.2026) : service gratuit, source
  citée, rien de vendu sans une nouvelle décision. Un éditeur peut réclamer, y compris après avoir vu qu'on ne lui a rien demandé.
- **Retrait sous 48 heures sur demande** : supprimer l'objet `douane/or/current-v1.txt.gz` du bucket privé, désactiver
  `refresh-douane.yml`, retirer ce que le service en lit. Il n'existe ni copie datée, ni artefact, ni ligne de ces données dans le dépôt.
- Le document porte ces trois points dans `notice` et, pour chaque fichier, l'adresse, la fiche, la licence, l'empreinte et
  la date de la source.

## Aucune personne
Aucune colonne ne porte de personne : période, tarif, pays, type de biens, type et genre de taux, unité, quantités, valeurs,
droits, état et date de mise à jour. Réserve : le fichier ne dit pas combien d'importateurs se cachent derrière une
cellule ; une petite cellule peut en pratique correspondre à une seule entreprise, telle que l'OFDF la publie.

## Le piège des libellés
Le libellé du tarif contient des points-virgules, entre guillemets, et des guillemets internes échappés par `\"`, ce qu'un lecteur
CSV standard ne comprend pas. Lignes concernées le 05.11.2026 : 898 609 dans les recettes, 893 528 dans les importations,
1 296 596 dans les exportations. Lu par position depuis la gauche, le fichier des recettes donne pour 2025 des
droits de 6,41 à 7,08 milliards, selon ce que le lecteur fait des champs illisibles, au lieu de 0,83.

`parse.ts` ne lit donc jamais le libellé : colonnes fixes à gauche de lui, colonnes fixes à droite, le milieu est jeté. Chaque champ
gardé passe un contrôle strict ; un point-virgule ailleurs décale la lecture et arrête la collecte, au lieu de fausser un total.

## Le document réduit
Objet unique `douane/or/current-v1.txt.gz`, bucket R2 privé, réécrit à chaque passage. Une première ligne JSON (provenance,
lignes et totaux par fichier et par année, tarifs hors du total conjoncturel, concordance), puis une ligne par
année × tarif × pays, triée par tarif, pays, année :

`tn8;country;year;import_value_chf;import_kg;duties_chf;export_value_chf;export_kg`

- **Une cellule vide veut dire absente de la source, jamais zéro.** Droits avant 2000 : vides. `0` : droits nuls relevés.
- Valeur et poids des importations viennent du fichier du commerce (depuis 1988) ; les droits, du fichier des recettes.
- **Rien d'autre ne sort** : ni libellé, ni nom de pays, ni euros, ni dollars, ni mois, ni genre de taux. Un code de pays se lit
  avec l'année : `CS` y a voulu dire Tchécoslovaquie, puis Serbie-et-Monténégro.
- 2026 est une année provisoire (`provisional`, 9 mois au 05.11.2026) : ne jamais la comparer à une année close sans le dire.
- Les totaux officiels du commerce sont « conjoncturels », sans or ni assimilés : `non_conjunctural` liste, par sens, les 81
  tarifs concernés et leurs années. En 2025, ils pèsent 190 milliards d'importations sur 423.

## Le total, et ce qu'il prouve
Mesure du 05.11.2026 sur les vrais fichiers, publiés le 20.10.2026, mis à jour le 13.10.2026 :

| Contrôle | Attendu | Lu | Écart |
|---|---|---|---|
| Importations 2025, total conjoncturel | 232,7 milliards (communiqué de l'OFDF du 29.01.2026) | 232,85 | +0,06 % |
| Exportations 2025, total conjoncturel | 287,0 milliards (même communiqué) | 286,84 | -0,06 % |
| Valeur importée, recettes contre commerce, 27 années | Égalité, deux fichiers de l'OFDF | Égalité au franc près | 0 |
| Droits 2025 | 778 M (Compte d'État 2025, tome 1A) | 825,3 M | **+6,1 %** |
| Droits 2024 | 738 M (même tome) | 766,4 M | **+3,8 %** |

**L'écart sur les droits est mesuré et non expliqué.** La statistique et la comptabilité de la Confédération ne couvrent pas
forcément la même chose ; nous ne savons pas pourquoi elles diffèrent et l'écart monte à environ 13 % avant 2024
(1 340 M contre 1 184 M en 2023, repère lu dans un extrait de recherche, non relu dans le compte). Le fichier est donc
juste au franc près pour la valeur, et sa colonne de droits n'est recoupée qu'à quelques pour cent. Ne jamais présenter
ces droits comme les recettes du compte de la Confédération.

Le document retrouve aussi, aux mêmes chiffres, un exemple calculé à part sur le fichier source le 03.11.2026 : vin (2204) importé
en 2025, Italie 390,3 M et 66,18 M de droits (17,0 %), France 462,5 M et 31,83 M (6,9 %).

## Arrêts de la collecte (rien n'est envoyé, le document précédent reste)
- **Forme** : archive qui n'a pas exactement un membre CSV, nom de membre refusé, colonnes qui changent, ligne vide ou trop
  courte, champ gardé illisible, montant négatif ou non entier.
- **Volume** : moins de 25, 25 et 28 millions de lignes (mesuré : 29,8, 29,2 et 34,1) ; plus de 15 millions d'agrégats (mesuré :
  8,7) ; plus de 0,1 % de valeurs vides ; concordance de moins de 10 000 lignes (mesuré : 13 194) ; baisse de plus de 3 %.
- **Couverture** : année manquante, année ancienne provisoire ou incomplète, année future, dernière année trop vieille.
- **Totaux** : bandes du tableau ci-dessus (1 % pour le commerce, 0,01 % entre les deux fichiers, de 0,95 à 1,2 fois le compte
  pour les droits), droits d'une année close hors de 0,4 à 2 milliards.
- **Date de la source** : plus d'une valeur de `Date_actualisation` dans un fichier, date future, date de plus de 75 jours, date qui
  recule. Le `metadata_modified` de la fiche ne compte pas : il ne suit pas les données (28.01.2026 pour le commerce).
- **Version précédente** : année close qui bouge de plus de 1 %, année disparue.
- **Relecture du document fini** : même nombre de lignes et mêmes totaux au franc près que pendant la lecture, y compris les
  totaux conjoncturels, chaque ligne de la forme attendue, tri strict. Une ligne qui ne passe pas arrête tout.

Une anomalie examinée s'adopte par l'entrée `accepter_anomalie` du déclenchement manuel, un passage réel lancé à la main (F6) ;
seuls une baisse, une année close qui bouge et une source figée ou qui recule s'adoptent. Un nouveau chiffre officiel annuel
s'ajoute à la main dans `build.ts`, après relecture.

## Étages et écart à la règle
Source → bronze temporaire (les fichiers du passage, effacés dès qu'ils sont lus) → or réduit dans R2. Écart voulu à la règle du
bronze daté : 2 Go par mois de données publiques, et un dépôt public n'a pas à en garder d'artefact. Limite : une ancienne version
d'un fichier ne se relit pas si l'OFDF la remplace. L'empreinte et la date de chaque fichier restent dans le document.

## Mémoire et durée
Mesures sur un Mac (Apple Silicon, `/usr/bin/time -l`) le 05.11.2026, sur le programme lui-même, en simulation :

| Passage | Durée | Mémoire maximale |
|---|---|---|
| Complet, téléchargement compris, tas limité à 6 Go, Mac occupé par d'autres calculs | 10 min 00 (téléchargement 5 min 50, lecture 3 min 38, écriture 28 s, relecture 3 s) | 3,4 Go |
| Sur les fichiers déjà téléchargés, sans limite posée | 2 min 41 | 2,7 Go |
| Sur les fichiers déjà téléchargés, tas limité à 2 Go | 2 min 47 | 2,4 Go |

Volumes : 93 millions de lignes, 32 Go décompressés, jamais écrits sur le disque ; un ZIP à la fois, moins de 1 Go de disque.
Résultat : 8 708 095 lignes d'agrégats, 290 Mo bruts, 91,5 Mo compressés, en-tête JSON de 656 Ko. Les empreintes des
fichiers téléchargés par le programme sont celles d'un téléchargement séparé par `curl`.

**Non mesuré sur un exécuteur GitHub, ni l'envoi vers R2** : un `workflow_dispatch` n'existe qu'une fois le workflow sur la branche
principale, et aucun passage réel n'a été lancé. Un exécuteur standard a 16 Go de mémoire et environ 14 Go de disque, soit
largement de quoi faire, mais il est plus lent qu'un Mac. Le passage journalise sa durée par étape et sa mémoire maximale : la
première simulation manuelle après fusion en donne la preuve. Temps maximal du travail : 120 minutes.
