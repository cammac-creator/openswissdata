# Liste des sanctions du SECO (SESAM) : organisations et bateaux

> **État au 04.11.2026.** Décision de Claude-Alain du 04.11.2026 : organisations et bateaux seulement, aucune
> personne physique. Servi par `GET /api/v1/sanctions` et `GET /api/v1/sanctions/search`. Aucun fichier vendu, aucun
> outil MCP. En cas de doute, le code fait foi (`etl/sanctions/`, `src/lib/sanctions.ts`).

## Source et droits
- Éditeur : Secrétariat d'État à l'économie (SECO), secteur des sanctions. Fichier XML de la liste entière :
  `https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=fr&action=downloadXmlGesamtlisteAction`.
  Recherche officielle : `https://www.sesam.search.admin.ch/sesam-search-web/pages/search.xhtml`.
- Réponse écrite du SECO du 04.11.2026 : `docs/droits-des-sources.md`, ligne SESAM. Reprise autorisée dans un service
  d'interrogation, sous réserve des dispositions légales. Mise à jour à notre charge, format structuré officiel à
  privilégier, référence de version recommandée.

| Point signalé par le SECO | Dans le code |
|---|---|
| Mise à jour à la charge de l'utilisateur | Deux créneaux par jour ; sans relevé réussi depuis trois jours, la recherche répond 503 au lieu de répondre |
| Format structuré officiel | Le fichier XML, jamais un relevé de page |
| Référence à la version utilisée | Date de la liste, empreinte SHA-256 du fichier entier et date du dernier relevé dans chaque réponse |

## Lecture du fichier
- Le fichier entier reste **en mémoire** : ni bronze brut, ni artefact, ni commit, parce qu'il contient des personnes.
  Écart voulu à la règle « bronze d'abord », même motif que FOSC. Seul le document réduit est écrit, dans le bucket R2
  privé (`sanctions/or/current-v1.json.gz`, réécrit à chaque passage), sans copie datée : une organisation radiée
  disparaît à la version suivante. Le dépôt public n'en reçoit jamais : son historique la garderait à vie.
- **Liste blanche** de ce qui sort d'une entrée : numéro SESAM, genre (`organisation` ou `vessel`), noms (principal,
  alias, ancien, variantes d'écriture d'un nom à une seule partie), programme (clé anglaise, origine), date
  d'inscription, code pays des adresses (organisations), numéro IMO à 7 chiffres (bateaux).
- **Jamais lus** : justification, autres informations des organisations, relations, lignes d'adresse, `c/o`, dates de fondation,
  historique des modifications (`added`, `removed`, qui recopient des fiches entières). Le texte `other-information`
  d'un bateau n'est lu que pour en tirer le numéro IMO ; le reste est jeté.

## Qui est écarté, et la preuve
Le genre de l'entrée fait foi, jamais `name-part-type` : 65 organisations et 9 bateaux y sont étiquetés `family-name`.

| Écarté | Règle | Mesure du 04.11.2026 |
|---|---|---|
| Personnes physiques | Élément `individual` : aucun champ gardé, leurs noms servent seulement au contrôle ci-dessous, en mémoire | 4 709 sur 4 709 |
| Radiés | Une modification `de-listed`, quelle que soit sa position | 733 organisations, 23 bateaux |
| Organisation dont le nom principal porte une personne | Voir ci-dessous : fiche entière écartée | 6 |
| Autre nom d'une organisation qui porte une personne | Le nom seul est retiré | 8 |

- Résultat du 04.11.2026 : **2 866 organisations et 708 bateaux**. `exclusion_proof`, servi par `/api/v1/sanctions`,
  recompte sur le document écrit ; une valeur non nulle dans `*_served` arrête la collecte et fait refuser le document
  par le service.
- **Un nom d'organisation peut porter une personne** : des bureaux de change portent le nom de leur propriétaire,
  lui-même sur la liste. Une correspondance de trop retire un nom. La règle (`carriesPersonName`) prend, casse et
  ponctuation ignorées : un titre personnel (`haji`, `mullah`, `maulawi`, `sheikh`…) ; le nom entier d'une personne de
  la liste, seul ou à l'intérieur ; deux mots voisins d'un même nom de personne, sans particule, 8 caractères au moins ;
  un prénom suivi d'un nom de famille tous deux connus sur la liste. Même raison que les entreprises individuelles de la
  FOSC.
- **Relecture** (`reviewed.ts`, empreintes seulement, jamais un nom : le dépôt est public). Sur la liste du 04.11.2026,
  la règle prend 39 noms ; 10 relus comme n'étant pas une personne restent (mots courants, sigle, groupe ou institution
  portant le nom d'un défunt). 3 noms que la règle ne voit pas, relus comme portant le nom entier d'une personne, sortent. Un
  nouveau nom pris par la règle sort sans relecture. Les qualificatifs de cette relecture (« défunt », « sigle ») sont
  notre lecture, le fichier ne les prouve pas.
- **La preuve ne prouve pas tout.** `organisation_names_caught_and_not_reviewed_served` compte les noms servis pris par
  la règle et non gardés après relecture (0, sinon la collecte s'arrête) ; les 10 gardés sont dans
  `organisation_names_kept_after_review`. Une personne absente de la liste, un nom de famille seul, une translittération
  ou une forme fléchie (cyrillique) ne se détectent pas : un nom de personne peut donc encore figurer dans un nom
  d'organisation, jamais une entrée de personne. La notice publique de l'API le dit.
  Restent aussi, comptés : les noms d'institutions qui honorent un personnage (`organisation_names_honouring_a_person_kept`,
  « named after », « имени ») et les réseaux connus sous un nom de famille. 37 bateaux portent un nom égal à celui d'une
  entrée « personne » : gardés, le genre fait foi (`vessels_name_equals_person_entry`) ; la source classe en « personne »
  quelques entrées dont le texte décrit un navire.
- **Écart au plan du 04.11.2026** : pas de canari, la collecte contrôle elle-même la forme à chaque passage (précédent
  FOSC, swisstopo, OFEN).
- **Couverture suisse** (mesure promise le 04.11.2026) : 0 organisation servie avec une adresse en Suisse, 0 nom
  identique à un nom du registre FINMA. Cette liste touche presque uniquement des entités étrangères.

## Radiés : ce qui a été vérifié
Le 04.11.2026, sur la recherche officielle, un cas toutes les six secondes, en regardant le numéro d'entrée dans la
page de résultats (le nom y figure toujours, la page recopie la saisie) : 11 entrées portant `de-listed` absentes, dont
3 où `amended` précède `de-listed` dans le fichier ; 5 entrées actives présentes. Aucune entrée radiée ne porte de
modification plus tardive : si cela arrive, la collecte s'arrête.

## Arrêts de la collecte (rien n'est écrit, la version servie reste)
Téléchargement repris deux fois (30 s, puis 2 min) sur une panne réseau, un 429 ou un 5xx ; le journal donne l'étape et le
code technique, jamais un contenu.
Racine, `list-type`, genre d'entrée, genre d'objet, type de modification, type de nom ou programme inconnu ; balises
déséquilibrées, DOCTYPE, élément à l'intérieur d'un champ lu ; date de liste qui recule, dans le futur ou de plus de 400
jours ; sous 2 000 organisations ou 400 bateaux ; plus de 5 %
de bateaux sans IMO ; baisse de plus de 15 % sur une catégorie. Une baisse examinée s'adopte par l'entrée
`accepter_baisse` du déclenchement manuel, qui est un passage réel lancé à la main (F6).

## Date du fichier
Elle ne suit pas le calendrier : le 05.11.2026 après minuit, même empreinte et même date que la veille. Une liste qui ne
change pas reste juste, donc l'âge se compte depuis le dernier relevé réussi (`collected_at`), jamais depuis cette date.

## Recherche
Rapprochement exact seulement (règle du projet) : NFC et espaces, casse et ponctuation conservées. Une réponse vide ne
vaut jamais absence de sanction : elle le dit, dit que les personnes ne sont pas couvertes et renvoie à la recherche
officielle. Le nom cherché n'entre ni dans les mesures (`trackApiRequest` ne garde que le chemin) ni dans un cache.
