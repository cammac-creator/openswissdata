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
| Mise à jour à la charge de l'utilisateur | Deux créneaux par jour ; au-delà de trois jours, la recherche répond 503 au lieu de répondre |
| Format structuré officiel | Le fichier XML, jamais un relevé de page |
| Référence à la version utilisée | Date de la liste et empreinte SHA-256 du fichier entier dans chaque réponse |

## Lecture du fichier
- Le fichier entier reste **en mémoire** : ni bronze brut, ni artefact, ni commit, parce qu'il contient des personnes.
  Écart voulu à la règle « bronze d'abord », même motif que FOSC. Sont écrits dans le bucket R2 privé le document
  réduit (`sanctions/or/current-v1.json.gz`, réécrit) et sa copie datée (`sanctions/argent/AAAA-MM-JJ-v1.json.gz`).
  Le dépôt public n'en reçoit jamais : son historique garderait à vie une organisation radiée ensuite.
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
| Organisation dont le nom principal porte une personne | Voir ci-dessous : fiche entière écartée | 4 |
| Autre nom d'une organisation qui porte une personne | Le nom seul est retiré | 5 |

- Résultat du 04.11.2026 : **2 868 organisations et 708 bateaux**. `exclusion_proof`, servi par `/api/v1/sanctions`,
  recompte sur le document écrit ; une valeur non nulle dans `*_served` arrête la collecte et fait refuser le document
  par le service.
- **Un nom d'organisation peut porter une personne** : des bureaux de change portent le nom de leur propriétaire,
  lui-même sur la liste. Sont retirés : nom entier identique au nom d'une personne de la liste, suite d'au moins deux
  mots égale à un tel nom (8 caractères au moins, casse et ponctuation ignorées), titre personnel (`haji`, `mullah`,
  `maulawi`, `sheikh`…). Même raison que les entreprises individuelles de la FOSC.
- **Limites connues** : un nom de personne absente de la liste, sans titre, ne se détecte pas ; 116 noms d'institutions
  « named after » un personnage restent (ce sont des organisations, comptés dans
  `organisation_names_honouring_a_person_kept`). 37 bateaux portent un nom égal à celui d'une entrée « personne » :
  gardés, le genre fait foi, comptés dans `vessels_name_equals_person_entry`.
- **Couverture suisse** (mesure promise le 04.11.2026) : 0 organisation servie avec une adresse en Suisse, 0 nom
  identique à un nom du registre FINMA. Cette liste touche presque uniquement des entités étrangères.

## Radiés : ce qui a été vérifié
Le 04.11.2026, sur la recherche officielle, un cas toutes les six secondes, en regardant le numéro d'entrée dans la
page de résultats (le nom y figure toujours, la page recopie la saisie) : 11 entrées portant `de-listed` absentes, dont
3 où `amended` précède `de-listed` dans le fichier ; 5 entrées actives présentes. Aucune entrée radiée ne porte de
modification plus tardive : si cela arrive, la collecte s'arrête.

## Arrêts de la collecte (rien n'est écrit, la version servie reste)
Racine, `list-type`, genre d'entrée, genre d'objet, type de modification, type de nom ou programme inconnu ; balises
déséquilibrées, DOCTYPE ; date de liste de plus de trois jours ; sous 2 000 organisations ou 400 bateaux ; plus de 5 %
de bateaux sans IMO ; baisse de plus de 15 % sur une catégorie. Une baisse examinée s'adopte par l'entrée
`accepter_baisse` du déclenchement manuel, qui est un passage réel lancé à la main (F6).

## Recherche
Rapprochement exact seulement (règle du projet) : NFC et espaces, casse et ponctuation conservées. Une réponse vide ne
vaut jamais absence de sanction : elle le dit, dit que les personnes ne sont pas couvertes et renvoie à la recherche
officielle. Le nom cherché n'entre ni dans les mesures (`trackApiRequest` ne garde que le chemin) ni dans un cache.
