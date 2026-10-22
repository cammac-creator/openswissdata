# FOSC : avis du registre du commerce (rubrique HR)

> **État au 22.10.2026.** Collecte construite et testée, **rien n'est publié** et aucune page ne lit ces données.
> Décision de Claude-Alain du 16.10.2026 (d3 = A, F8 accordé) : « des totaux, et les événements des sociétés ».
> En cas de doute, le code fait foi (`etl/fosc/`).

## Source

- Éditeur : Secrétariat d'État à l'économie (SECO), Portail des feuilles officielles, Feuille officielle suisse du
  commerce (FOSC), rubrique HR (registre du commerce). Sous-rubriques : HR01 nouvelles inscriptions, HR02 mutations,
  HR03 radiations.
- API publique, sans compte : documentation technique https://www.amtsblattportal.ch/docs/api/ (relue le 22.10.2026).
  - Liste d'un jour : `https://www.shab.ch/api/v1/publications?publicationStates=PUBLISHED&rubrics=HR&publicationDate.start=J&publicationDate.end=J`
    (pages de 2 000 au plus, tri stable par numéro de publication).
  - Détail d'un avis : `https://www.shab.ch/api/v1/publications/{id}/xml` (schéma d'export HR, version 1.26).
- Conditions : conditions générales (CG) du portail, https://shab.ch/static/agb_fr.pdf, version du 07.06.2024.
  Empreinte SHA-256 du PDF français relevée le 22.10.2026 : `e8770a63beb1b9a6344e347023410c9ad4c3d287187a8efa88745ce237bf708e`.
- Liste des formes juridiques : OFS, concept I14Y « Rechtsform eines Unternehmens » v1.2.0
  (`89bc55cc-3858-4c13-a5c8-7dc935dff29b`). Le code 0101 est l'entreprise individuelle.

## Ce que disent les conditions, et ce que la collecte en fait

| Exigence | Où | Dans le code |
|---|---|---|
| Accepter les CG avant la première utilisation, puis tous les 90 jours | CG 1.2 al. 1 | `FOSC_TERMS_ACCEPTED_ON` (16.10.2026) ; au-delà de 90 jours, la collecte ne lit plus le portail et échoue visiblement. Nouvelle acceptation = geste de Claude-Alain. |
| S'informer de la version actuelle des CG | CG 1.1 al. 4 | Le PDF des CG est relu à chaque passage ; une empreinte différente arrête la collecte. |
| Protection des données ; art. 11 al. 3 OFOSC par analogie | CG 3.3 | Aucune donnée de personne : champs structurés des sociétés seulement, entreprises individuelles dans des totaux. |
| Données d'entreprises dans la structure du registre IDE | CG 3.3 | IDE contrôlé (chiffre de contrôle) et écrit `CHE-xxx.xxx.xxx`. |
| Indiquer la source | CG 3.3 | `source` dans chaque document de totaux. |
| « Ceci n'est pas une publication officielle… » | CG 3.3 | `not_official_notice` (formules FR, DE, EN des CG). |
| Reprendre les indications de qualité du SECO | CG 3.3 | `source_quality_notice` (CG 2 al. 1 et avertissement de la documentation de l'API). |
| Respecter la durée de publication de chaque avis | Réponse du SECO du 12.10.2026 | Règle de conservation ci-dessous. |

Les CG ne fixent aucune limite chiffrée de requêtes. La collecte reste polie : une requête à la fois, 500 ms de pause,
attente qui double sur 429 ou 503 (jamais moins que `Retry-After`, arrêt au-delà de 300 s), 3 000 requêtes au plus
par passage, heure limite de 60 minutes.

## Ce qui est lu et ce qui est gardé

Les réponses sont lues **en mémoire seulement** : aucune copie brute, ni sur disque ni en artefact, parce qu'elles
contiennent le texte libre des avis (noms de personnes, buts, adresses). C'est un écart voulu à la règle « bronze
d'abord » des autres collectes.

Du détail XML, seuls sont lus `content/testImport` et, **bloc par bloc**, chaque `content/commonsNew/company`
(état après l'événement) et chaque `content/commonsActual/company` (état avant : mutation, radiation), avec leurs
propres `uid`, `legalForm` et `seat`. Le schéma autorise plusieurs blocs par côté et un `uid` absent : un IDE n'est
jamais associé à la forme ou au siège d'un autre bloc. Le chemin est comparé en entier : l'IDE de l'organe de
révision n'est jamais lu.

**Lignes d'événements (argent)** : une ligne par avis seulement si chaque côté (après, avant) porte au plus un bloc
société, si le bloc retenu (après ; avant pour une radiation) a un IDE valide, une forme et un siège, si aucun champ
n'est répété dans un bloc, et si les formes juridiques de tous les blocs (avant et après) sont dans la liste blanche
`ROW_STORABLE_LEGAL_FORMS` : SA, Sàrl, SCmA, coopérative, association, fondation, SCmPC, SICAV, SICAF, institut de
droit public. Champs : identifiant technique de l'avis (idempotence et revérification, jamais publié), IDE, type
d'événement (sous-rubrique), date de publication, numéro OFS de la commune du siège, canton, forme juridique, jour
de suppression (`delete_on`), date de la dernière revérification.

**Totaux seulement** : entreprise individuelle (0101), procuration non commerciale (0118), représentant d'indivision
(0119), société en nom collectif (0103), société en commandite (0104), succursales (0111, 0151), forme particulière
(0113), forme absente ou inconnue, toute mutation dont l'état avant ou après sort de la liste blanche, tout avis à
plusieurs blocs société d'un même côté (sa forme n'est gardée dans les totaux que si tous ses blocs la partagent),
et tout avis dont le bloc retenu n'a pas d'IDE. La liste
blanche est plus stricte que la décision, qui ne nomme que l'entreprise individuelle ; l'élargir est une décision
de Claude-Alain.

Le siège est un nom de commune (le numéro OFS n'existe pas sur les avis de la FOSC). Il est rapproché du répertoire
officiel des localités (`src/mcp/data/localities.csv`) par égalité exacte : même nom et même canton que l'avis,
sinon même nom s'il ne désigne qu'une commune en Suisse ; à défaut la commune reste vide et le cas est compté. Le
canton retenu est celui de la commune du siège : le canton d'un avis est celui de l'office qui publie, qui diffère
lors d'un transfert de siège dans un autre canton.

## Durée de publication et conservation

- Les avis HR n'ont pas d'échéance dans l'API (`expirationDate` vide) et restent consultables des années sur le
  portail : c'est l'accès « pour une durée indéterminée » de l'art. 11 al. 2 OFOSC, que le service d'annonces peut
  limiter (au moins un mois) ou réduire pour un avis qui contient des données personnelles (al. 3).
- Règle appliquée, la plus prudente : (a) chaque ligne a un jour de suppression `delete_on`, l'`expirationDate` de
  l'avis si elle existe, au plus tard le 30e jour après la publication J (`MAX_RETENTION_DAYS`, plancher d'un mois
  de l'art. 11 al. 2) ; le passage d'un jour T supprime toute ligne dont `delete_on` tombe au plus tard le
  lendemain (T + 1), et n'enregistre pas un tel avis : la ligne n'existe donc plus le jour J + 30 (ni le jour de
  l'échéance) dès que le passage de la veille a eu lieu, sinon elle part au premier passage suivant ; (b) une ligne
  part dès que l'avis n'est plus dans la liste PUBLISHED de son jour, relue à chaque passage pour chaque jour
  stocké ; (c) une ligne part si elle n'a pas pu être revérifiée depuis plus de 3 jours. Ces suppressions sont
  enregistrées à chaque passage qui a pu relire l'état, même si un jour échoue ensuite. Prolonger la conservation
  est une décision de Claude-Alain.

## Totaux (or, non publié)

Document `openswissdata.fosc-hr-monthly-totals` v1 : par mois, totaux par type d'événement × canton × forme
juridique, entreprises individuelles comprises, avec la source, la mention non officielle, les indications de
qualité, la méthode et la couverture (jours collectés, jours manquants). Un jour de la fenêtre de rattrapage
(7 jours) est recalculé en entier s'il change ; ensuite il est figé, et un mois est figé quand tous ses jours ont
quitté la fenêtre. Aucun nom, aucun IDE, aucun classement d'entreprise.

**Ce qui resterait publiable après la durée de publication : à décider avant toute publication.** Une case de 1
dans un petit canton ou pour une forme rare désigne un seul avis, souvent une entreprise individuelle ; il faudra
choisir un seuil de petites cases, le niveau de détail (canton ou national) et la durée d'affichage.

## Stockage et circuit

- Passage réel : bucket R2 privé existant, objets `fosc/argent/hr-state-v1.json` (état) et
  `fosc/or/hr-monthly-totals-v1.json` (totaux), réécrits à chaque passage. Jamais dans le dépôt (public, historique
  permanent) ni dans un artefact GitHub.
- Simulation : `FOSC_DRY_RUN=1 npm run sync:fosc -- --out <dossier hors du dépôt> [--days J1,J2] [--sample-details N]`.
  Elle lit l'API réelle, écrit seulement dans le dossier indiqué et n'affiche que des nombres.
- Passage réel : `npm run sync:fosc -- --write-r2` (workflow planifié ; sans identifiants R2, refus).
- Tests : `tests/etl/fosc-*.test.ts`, données synthétiques (`tests/helpers/fosc-portal.ts`).
