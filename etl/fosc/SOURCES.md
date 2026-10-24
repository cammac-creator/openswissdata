# FOSC : avis du registre du commerce, faillites, concordats, liquidations et appels aux créanciers

> **État au 24.10.2026.** Collecte construite et testée, **rien n'est publié** et aucune page ne lit ces données.
> Décision de Claude-Alain du 16.10.2026 (d3 = A, F8 accordé) : « des totaux, et les événements des sociétés ».
> Étendue le 24.10.2026 aux faillites, concordats, liquidations et appels aux créanciers, **pour les sociétés
> seulement** (section « Faillites, concordats, liquidations et appels aux créanciers » ci-dessous).
> En cas de doute, le code fait foi (`etl/fosc/`).

## Source

- Éditeur : Secrétariat d'État à l'économie (SECO), Portail des feuilles officielles, Feuille officielle suisse du
  commerce (FOSC). Rubriques lues : HR (registre du commerce : HR01 nouvelles inscriptions, HR02 mutations, HR03
  radiations) ; depuis le 24.10.2026, KK (faillites), NA (concordats), LS (appels aux créanciers suite à la
  liquidation) et SR (autres appels aux créanciers relevant du droit des sociétés).
- API publique, sans compte : documentation technique https://www.amtsblattportal.ch/docs/api/ (relue le 22.10.2026
  et le 24.10.2026) ; catalogue des rubriques et de leurs intitulés officiels : `https://www.shab.ch/api/v1/rubrics`.
  - Liste d'un jour, une seule requête pour toutes les rubriques lues :
    `https://www.shab.ch/api/v1/publications?publicationStates=PUBLISHED&rubrics=HR&rubrics=KK&rubrics=NA&rubrics=LS&rubrics=SR&publicationDate.start=J&publicationDate.end=J`
    (pages de 2 000 au plus, tri stable par numéro de publication).
  - Détail d'un avis : `https://www.shab.ch/api/v1/publications/{id}/xml` (schémas d'export, version 1.26 :
    `https://www.shab.ch/api/v1/schemas/shab/1.26/<code>-export.xsd`).
- Conditions : conditions générales (CG) du portail, https://shab.ch/static/agb_fr.pdf, version du 07.06.2024.
  Empreinte SHA-256 du PDF français relevée le 22.10.2026 : `e8770a63beb1b9a6344e347023410c9ad4c3d287187a8efa88745ce237bf708e`.
- Liste des formes juridiques : OFS, concept I14Y « Rechtsform eines Unternehmens » v1.2.0
  (`89bc55cc-3858-4c13-a5c8-7dc935dff29b`). Le code 0101 est l'entreprise individuelle.

## Ce que disent les conditions, et ce que la collecte en fait

| Exigence | Où | Dans le code |
|---|---|---|
| Accepter les CG avant la première utilisation, puis tous les 90 jours | CG 1.2 al. 1 | `FOSC_TERMS_ACCEPTED_ON` (16.10.2026) ; au-delà de 90 jours, la collecte ne lit plus le portail et échoue visiblement. Nouvelle acceptation = geste de Claude-Alain. |
| S'informer de la version actuelle des CG | CG 1.1 al. 4 | Le PDF des CG est relu à chaque passage ; une empreinte différente arrête la collecte. |
| Protection des données ; art. 11 al. 3 OFOSC par analogie | CG 3.3 | Aucune donnée de personne : champs structurés des sociétés seulement ; entreprises individuelles, personnes physiques et successions dans des totaux. |
| Données d'entreprises dans la structure du registre IDE | CG 3.3 | IDE contrôlé (chiffre de contrôle) et écrit `CHE-xxx.xxx.xxx`. |
| Indiquer la source | CG 3.3 | `source` dans chaque document de totaux. |
| « Ceci n'est pas une publication officielle… » | CG 3.3 | `not_official_notice` (formules FR, DE, EN des CG). |
| Reprendre les indications de qualité du SECO | CG 3.3 | `source_quality_notice` (CG 2 al. 1 et avertissement de la documentation de l'API). |
| Respecter la durée de publication de chaque avis | Réponse du SECO du 12.10.2026 | Règle de conservation ci-dessous. |

Les CG ne fixent aucune limite chiffrée de requêtes. La collecte reste polie : une requête à la fois, 500 ms de pause,
attente qui double sur 429 ou 503 (jamais moins que `Retry-After`, arrêt au-delà de 300 s), 3 000 requêtes au plus
par passage (valeur par défaut, `--max-requests`), heure limite de 60 minutes.

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
société, si le bloc retenu (après, ou avant pour une radiation ; à défaut, l'unique bloc de l'autre côté) a un IDE
valide et une forme, si un canton est connu (celui de la commune du siège, sinon celui de l'avis), si aucun champ
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

## Faillites, concordats, liquidations et appels aux créanciers (sociétés seulement, 24.10.2026)

Décision de Claude-Alain du 24.10.2026 : étendre la collecte à ces rubriques **pour les sociétés seulement**. Code :
`etl/fosc/subrubrics.ts` (codes, intitulés, chemins des blocs société) et `etl/fosc/insolvency.ts` (lecture et classement).

| Rubrique | Sous-rubriques lues | Blocs société lus | Avis par jour ouvré (19 au 23.10.2026) |
|---|---|---|---|
| KK Faillites | KK01 à KK12 (KK10 « Autre avis » : compté sans lecture) | `content/debtor/companies/company` | 101 à 406 |
| NA Concordats | NA01 à NA12 (NA11 « Autre avis » : compté sans lecture) | `content/debtor/companies/company` | 3 à 12 |
| LS Appels aux créanciers suite à la liquidation | LS01 à LS08 | `content/dissolved/companies/company` | 37 à 41 |
| SR Autres appels aux créanciers du droit des sociétés | SR01 à SR06 | sociétés qui transfèrent, reprennent, réduisent leur capital… | 5 à 10 |

Ensemble : 154 à 464 avis par jour ouvré (moyenne 290), en plus des 1 046 à 1 319 avis HR. Les intitulés officiels FR,
DE et EN de chaque sous-rubrique sont repris du catalogue du portail. Les successions (rubrique ES), les poursuites (SB,
dont la commination de faillite SB07) et le marché financier (FM, dont FM10 « FINMA-Insolvabilité ») ne sont pas lus :
ils ne font pas partie de la décision.

**Une ligne n'est écrite que pour UNE société identifiée dans la structure XML**, toutes conditions réunies :
schéma reconnu (espace de noms de la racine `https://shab.ch/shab/<code>-export`, version 1.26) ; aucune personne
physique (aucun élément `person`, `prename`, `dateOfBirth`, `dateOfDeath` où que ce soit sous `content`, aucun débiteur
de type « person ») ; aucune succession ni succession répudiée (`addition` = `legacy`, `refusedLegacy`), aucun autre
avenant ; un seul bloc société, à un chemin connu, et aucun autre élément `company` ; IDE valide (chiffre de contrôle),
`noUID` jamais vrai ; forme juridique **lue dans le bloc** et dans la liste blanche de HR, sans l'élargir ; un canton
connu. La forme n'est jamais déduite : ni de l'intitulé de la sous-rubrique (LS01 « société anonyme » sert seulement de
contrôle : une forme lue contraire envoie l'avis dans les totaux), ni du nom.

**Totaux seulement** (comptes anonymes par jour, sous-rubrique, canton et forme ; jamais de nom, d'IDE, d'adresse ni de
date de naissance) : personne physique (code `personne`), succession et succession répudiée (code `succession`),
entreprise individuelle (0101), société sans forme juridique indiquée (code `inconnue`, cas de la plupart des faillites
de sociétés : 11 blocs société KK sur 13 regardés le 24.10.2026), sans IDE ou `noUID` vrai, SNC, commandite,
succursales et autres formes hors liste blanche, avis à plusieurs sociétés (SR01 à SR04 et SR06 en ont presque toujours
deux : fusion, scission, transformation, transfert à l'étranger), structure inattendue, version de schéma ou espace de
noms inconnus, et les « autres avis » KK10 et NA11, dont l'événement n'est décrit que dans le texte libre.

**Champs d'une ligne** : EXACTEMENT les neuf champs de HR (identifiant technique de l'avis, IDE, sous-rubrique, date de
publication, commune OFS, canton, forme juridique, jour de suppression, revérification). Jamais un texte libre, jamais
le nom d'un liquidateur, d'un commissaire ou d'un office (`meta/registrationOffice`, y compris son IDE, n'est jamais
lu). Les dates de la procédure (ouverture de la faillite, fin d'un délai…) ne sont PAS gardées depuis la relecture du
24.10.2026 : un champ de ligne en plus serait refusé par la version précédente de la collecte, qui ne pourrait alors
plus relire l'état ni purger après un retour arrière ; ailleurs dans l'état, rien ne garantissait leur effacement par
cette version ; un objet R2 distinct resterait orphelin. Les reprendre demanderait un objet distinct et une procédure
d'effacement manuelle (F6) : décision de Claude-Alain.

**Commune et canton** : ces schémas n'ont pas de siège. Le NPA et le lieu de l'adresse de la société sont lus en
mémoire et rapprochés exactement du répertoire des localités (NPA d'une seule commune, sinon lieu égal à une localité
de ce NPA qui ne désigne qu'une commune) ; ils ne sont jamais gardés. À défaut, ou si la commune n'est pas dans le
canton indiqué par le bloc société, la commune reste vide (mesuré le 24.10.2026 : 4 lignes sur 5 dans la simulation,
6 adresses sur 10 dans un échantillon d'appels aux créanciers ; un NPA ou une localité partagés entre plusieurs
communes sont fréquents). Canton : celui de la commune, sinon celui du bloc société, sinon celui de
l'office qui publie (canton de la liste), qui n'est pas retenu quand l'avis est listé dans deux cantons (62 avis sur
1 451, du 19 au 23.10.2026).

**Garde-fous propres** : une sous-rubrique inconnue de KK, NA, LS ou SR dans la liste (par exemple un futur KK13 au
schéma non relu) arrête le passage, comme un schéma HR changé (code 1, aucun jour enregistré, purge enregistrée) ;
plus de 5 % d'avis sans aucune partie reconnue (sur au moins 50 détails) arrêtent aussi le passage ; une version de
schéma ou un espace de noms inconnus n'arrêtent rien (les jours sont enregistrés, HR continue) mais envoient l'avis dans
les totaux, le compte apparaît dans le journal (« schéma inconnu ») et le passage sort en code 1 pour que l'alerte parte
(sinon, à la prochaine version des formulaires, plus aucune ligne ne serait écrite sans que personne le voie).
Conditions générales, plafond de requêtes, jour en échec et codes de sortie : les mêmes que HR. Le seuil du jour en
échec (au moins 3 détails illisibles et plus de 1 %) est calculé séparément pour HR (exactement comme avant) et pour les
nouvelles rubriques ; le jour échoue si l'un OU l'autre le dépasse : des détails sains d'une famille ne diluent jamais
les échecs de l'autre (relecture du 24.10.2026).

**Durées de publication** (catalogue du portail, champ `publicPeriod`, et `expirationDate` des avis) : 1 à 60 mois,
60 par défaut, pour KK et NA ; 60 mois pour LS ; 12 à 60 mois, 36 par défaut, pour SR. Quelques avis KK et NA échoient
après 31, 61 ou 182 jours. La règle de conservation ci-dessous (jour de suppression = min(échéance, J + 30)) s'applique
telle quelle.

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

Document `openswissdata.fosc-hr-monthly-totals` v2 (nom gardé, 24.10.2026) : par mois, totaux par type d'événement
(sous-rubrique) × canton × forme juridique, entreprises individuelles, personnes (`personne`) et successions
(`succession`) comprises, avec la source, la mention non officielle, les indications de qualité, la méthode et la
couverture (jours collectés, jours manquants), en tout et **par rubrique** : un jour calculé avec la seule rubrique HR
ne compte jamais comme couvert pour KK. Un jour de la fenêtre de rattrapage (7 jours) est recalculé en entier s'il
change ; ensuite il est figé, et un mois est figé quand tous ses jours ont quitté la fenêtre. Aucun nom, aucun IDE,
aucun classement d'entreprise.

**Ce qui resterait publiable après la durée de publication : à décider avant toute publication.** Une case de 1
dans un petit canton ou pour une forme rare désigne un seul avis, souvent une entreprise individuelle ; il faudra
choisir un seuil de petites cases, le niveau de détail (canton ou national) et la durée d'affichage.

## Stockage et circuit

- Passage réel : bucket R2 privé existant, objets `fosc/argent/hr-state-v1.json` (état) et
  `fosc/or/hr-monthly-totals-v1.json` (totaux), réécrits à chaque passage. Jamais dans le dépôt (public, historique
  permanent) ni dans un artefact GitHub. Depuis le lot du 24.10.2026, les lignes des nouvelles rubriques vivent dans
  le MÊME état, qui reste en version 1 (mêmes neuf champs de ligne ; champs facultatifs ajoutés aux jours et aux mois :
  `rubrics`, `persons`, `estates`, `days_collected_by_rubric`). Aucun état en version 2 n'a jamais été écrit dans R2 :
  la version 2 de la révision 35d0262 n'a existé que dans une simulation locale, effacée.
- Simulation : `FOSC_DRY_RUN=1 npm run sync:fosc -- --out <dossier hors du dépôt> [--days J1,J2] [--sample-details N]`.
  Elle lit l'API réelle, écrit seulement dans le dossier indiqué et n'affiche que des nombres.
- Passage réel : `npm run sync:fosc -- --write-r2` (workflow planifié ; sans identifiants R2, refus).
- Tests : `tests/etl/fosc-*.test.ts`, données synthétiques (`tests/helpers/fosc-portal.ts`,
  `tests/helpers/fosc-insolvency-portal.ts`) ; `tests/etl/fosc-faillites-fuite.test.ts` inspecte tout ce qui sort
  (objets R2 simulés, fichiers de `--out`, journal) et y cherche les noms, IDE, adresses et dates de naissance fictifs ;
  `tests/etl/fosc-faillites-relecture.test.ts` prouve le seuil séparé du jour en échec et le retour arrière.

## Retour arrière (vers la révision b5dc6fc, collecte HR seule)

- Aucun geste manuel n'est nécessaire, et la purge n'est jamais bloquée : le contrôle de b5dc6fc accepte l'état écrit
  par cette version (les champs ajoutés aux jours et aux mois sont ignorés, les lignes ont les neuf champs attendus).
  Prouvé par `tests/etl/fosc-faillites-relecture.test.ts`, qui contient une copie datée du contrôle et de la purge de
  b5dc6fc.
- Au premier passage de b5dc6fc, toutes les lignes des nouvelles rubriques partent : la revérification ne relit que la
  liste HR (un avis absent de la liste perd sa ligne) et les jours de la fenêtre sont recalculés sur HR seul ; à défaut,
  la purge à J + 30 et la purge des lignes non revérifiées depuis 3 jours les effacent de toute façon.
- Restent, anonymes : les totaux des nouvelles rubriques (codes `personne`, `succession`…) dans les jours anciens et les
  mois figés ; b5dc6fc les recopie dans ses totaux mensuels, sous leur code de sous-rubrique.
- Retour en avant ensuite : la version de ce lot relit l'état réécrit par b5dc6fc sans erreur (test « sens inverse ») ;
  un jour sans `rubrics` est recalculé avec toutes les rubriques ; un mois figé par b5dc6fc sans
  `days_collected_by_rubric` compte pour HR seul : la couverture des nouvelles rubriques est alors sous-estimée,
  jamais surestimée.
