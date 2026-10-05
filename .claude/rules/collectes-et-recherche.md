---
paths:
  - "etl/**"
  - "scripts/monitor-sources.ts"
  - "scripts/build-search-indexes.ts"
  - "scripts/evaluate-search.ts"
  - "scripts/search-eval/**"
  - "scripts/record-finma-quality.mjs"
  - "scripts/promesses/**"
  - "scripts/sync-*.ts"
  - "scripts/notify-finma-diff.ts"
  - "src/mcp/data/**"
  - "src/mcp/search-index.ts"
  - "src/mcp/lexical-index.ts"
  - "src/mcp/name-match.ts"
  - "src/mcp/embedder.ts"
  - "src/mcp/data-loader.ts"
  - "src/mcp/r2-refresh.ts"
  - "src/mcp/tools/**"
  - "src/lib/embedding-*.ts"
  - "src/lib/model-artifact.ts"
  - "src/lib/tares-archive.ts"
  - ".github/workflows/refresh-*.yml"
  - ".github/workflows/release-classifications.yml"
  - ".github/workflows/monitor-sources.yml"
  - ".github/workflows/search-bench.yml"
  - "tests/etl/**"
  - "tests/lba/**"
  - "docs/securite-dependances.md"
---

# Collectes, sources officielles et recherche

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

## Surveillance des sources
- Le contrôle compare vingt sources publiques à `etl/canary-baseline.json` : sept TARES, FINMA, NOGA (I14Y), depuis le 28.09.2026 les adresses mêmes de la publication des classifications (NACE 2.1 cellar, deux requêtes SPARQL Eurostat, ISIC en/fr/es, méthodologie OFS ; mode `document` pour un fichier non XLSX), et depuis le 30.09.2026 les trois classeurs FINMA vvtr/sro/ao en mode `xlsx-shape` (feuille et ligne d’en-tête : ils sont régénérés chaque nuit, un mode `raw` serait rouge tous les matins). Octets d’abord dans un bronze daté immuable, puis empreinte. Dans GitHub, ce bronze est temporaire ; seuls le rapport et la référence sont conservés 14 jours comme artefacts.
- Une source modifiée, absente ou illisible fait échouer la tâche. Aucun nouveau ticket GitHub ni message client automatique. La référence n’est jamais réinitialisée automatiquement : contrôler les sources avant de l’intégrer. La réussite du contrôle ne prouve pas la justesse métier de toutes les données.
- Nettoyage réactivé le 25.09.2026, passage réel 36159500858 réussi (HTTP 200). Les tables historiques `magic_links` et `request_log` n’existent pas dans cette base et sont ignorées ; les commandes, clients, droits et versions ne sont pas concernés.

## TARES — publication et service du schéma 2
- Collecte des sept XLSX dans un bronze daté immuable avant lecture. Une colonne imprévue, un taux vide, un volume inhabituel, des doublons ou une perte de lignes bloque la publication. Les pourcentages restent des pourcentages ; ne jamais les étiqueter CHF.
- `tares_rates.csv/json` conservent toutes les cellules des lignes de taux en vigueur, avec HS8 et dates normalisées ajoutés. Le résumé ne choisit jamais le minimum : MFN de base non ambigu seulement, préférences sans conditions divergentes et de même unité ; absence ≠ gratuité. `unit_stat` reste un alias historique de l'unité du droit. Les clés des pays connus viennent des codes LDG relus ; autres clés `ldg_<code>`.
- Simulation `TARES_DRY_RUN=1`, sans envoi R2 ni enregistrement. Fixtures interdites en publication. Date réelle, référence précédente vérifiée, comparaison, signature et fichiers contrôlés avant upload immuable ; archive distante relue avant enregistrement conditionné à la version précédente. Une collision ou concurrence impose un examen, jamais un écrasement.
- Le workflow manuel démarre en simulation ; le calendrier hebdomadaire dépend de `TARES_CRON_ENABLED`. Les vecteurs ne sont pas inclus dans cette actualisation, ce qui est annoncé sur la fiche. Rapport minimal GitHub 14 jours, aucun ZIP vendu en artefact public.
- Catalogue et échantillon proviennent de l'archive vendue. Le MCP recharge TARES au démarrage, après publication et toutes les douze heures ; garde la dernière version complète en cas de panne, avec fraîcheur visible. Les embeddings restent distincts et non actualisés par cette opération.
- Bronze de traitement TARES sur le volume : ZIP vérifié, 30 jours, plafond 200 Mo, réserve disque 300 Mo ; ce n'est pas une sauvegarde. Aucun changement de prix. Une évolution du schéma doit rester expliquée dans README et la fiche qualité.

## Classifications — schéma 2
- NACE 2 vient directement d'Eurostat, pas du paquet npm qui expose la révision 2.1. Volumes validés : NOGA 2008 1 790, NOGA 2025 1 845, NACE 2 996, NACE 2.1 1 047, ISIC 4 766. Un changement de ces volumes demande un examen des sources.
- Relations directes sourcées et typées, aucune égalité de code présumée ; seule l'identité OFS aux niveaux 1 à 4 est exacte. Ne pas chaîner deux relations non exactes. Les genres suisses à six chiffres nécessitent une table dédiée pour migrer entre révisions.
- Le format historique crosswalks contient désormais des paires ; README et fiche produit préviennent de cette évolution. Sources, qualité, provenance signée et empreintes sont dans chaque archive. Catalogue et MCP rechargent la version distribuée.
- Publication manuelle par `release-classifications.yml`, simulation par défaut, Standard uniquement. Fixtures et Pro refusés avant publication. Lien Stripe Pro désactivé le 25.09.2026 : ne rouvrir qu'après validation complète des compléments et de leur livraison.
- NACE 2.1 se télécharge par l'adresse directe du document cellar (`publications.europa.eu/resource/cellar/…`) : depuis le 28.09.2026, le gestionnaire `op.europa.eu` répond 403 (pare-feu Azure) aux scripts. Mêmes octets vérifiés. Une notice de licence modifiée n'atteint les acheteurs qu'avec une nouvelle version publiée : `tests/etl/dataset-license.test.ts` vérifie la notice jointe à chaque archive.

## Dépendances et modèle de recherche
- Référence de contrôle : `docs/securite-dependances.md`. Application et site ont des lockfiles distincts ; les SDK également. Ne pas confondre audit npm sans avis et audit de sécurité complet.
- SheetJS vient de sa distribution officielle 0.20.3, intégrité verrouillée ; imports par `etl/shared/xlsx.ts` (CommonJS Node avec fichiers/encodages).
- Recherche et collectes vectorielles utilisent le même moteur Transformers.js 3.8.1. Modèle mpnet à révision figée, tailles/SHA dans `embedding-model.ts`, préchargé au build ; aucun téléchargement pendant une requête. Pour une collecte vectorielle seule : `npm run models:prepare:embedding`.
- Les caches de reprise exigent modèle, révision/moteur et dimension courants. Index de recherche régénérés le 28.09.2026, même modèle, même révision et même moteur : voir « Recherche TARES, NOGA et FINMA ».
- Le démonstrateur navigateur appelle `/mcp/jsonrpc` sur la même origine, compatible avec la CSP ; une URL de sous-domaine nécessite CORS et CSP et ne doit pas être utilisée ici.

## Recherche TARES, NOGA et FINMA — 28.09.2026
- Index livrés : `src/mcp/data/embeddings/{tares,noga_2025}_index.{json,bin}` (format `src/mcp/search-index.ts`) : source officielle, version, modèle et révision, date de construction, empreinte des vecteurs. Chargement refusé (message fixe) si taille, SHA-256, modèle ou nombre d'entrées diffèrent. Un vecteur int8 par entrée, moyenne renormalisée des textes FR/DE/IT/EN. Construction : `scripts/build-search-indexes.ts` (bronze de `Tarifstruktur.xlsx`, `noga_2025.csv`).
- TARES : chemin officiel de chaque ligne (position › textes intermédiaires VT6/TN6/VT8 › ligne), lu par `etl/tares/hierarchy.ts`. `parseTarifstruktur` écarte les textes sans numéro : ne pas l'utiliser pour la hiérarchie. Classement par mots officiels d'abord (BM25 trigrammes, `lexical-index.ts`), sens en appoint (0,3), numéro tarifaire reconnu. L'index ne suit pas la publication hebdomadaire : `in_current_tares` signale une ligne absente des données servies. Reconstruire quand le contrôle des sources adopte une nouvelle `tares.tarifstruktur` ; un test compare les empreintes.
- NOGA : une entrée par genre (798), libellé seul vectorisé (les parents dans le texte faisaient perdre environ 20 points de top-1), niveaux supérieurs rendus dans `path`, `class_code` = classe NACE 2.1. Reconstruire si `noga_2025.csv` change (test).
- FINMA : `finma_search` réutilise le classement de `kyc_check` (`src/mcp/name-match.ts`), puis les suppositions de frappe. Formes juridiques et ae/oe/ue normalisées ; entrée de 200 caractères et 8 mots au plus ; `match_type` sur chaque résultat ; réponse vide plutôt qu'un nom sans rapport. `kyc_check` est figé par `tests/mcp/kyc-check-classement.test.ts` : ne pas modifier `nameMatcher` sans ce test.
- Chaque réponse porte la version des données servies (`data_version` TARES/FINMA, `reference_version` classifications ; `null` = copie embarquée) et la provenance de l'index.
- Mesure sans réseau : `npx tsx scripts/evaluate-search.ts [--structure <Tarifstruktur>] [--holdout]`, jeu `scripts/search-eval/cases.json`. Ne mesurer le jeu de contrôle qu'une fois la méthode figée. Chiffres et limites : `docs/recherche-semantique.md`.
- L'archive TARES vendue garde ses vecteurs historiques (français, ligne seule) : sujet distinct de l'index du serveur.

## FINMA : organisme de surveillance et tables des OAR et des OS — 30.09.2026
- Option B1 du rapport `docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md`. La collecte quotidienne lit aussi `vvtr.xlsx`, `sro.xlsx` et `ao.xlsx` (`etl/finma/ingest-supervision.ts`, appelé par `release.ts`, adresses dans `sources.ts`). Registre : colonne `supervisory_organisation` (+ `_source_url`, `_observed_on`) sur les seules lignes « Portfolio manager » et « Trustee ». Archive : `finma_reference_sros.*` (OAR reconnus) et `finma_reference_supervisory_organisations.*` (OS autorisés), raison sociale, adresse et site seulement ; préfixe `reference_` car `finma_supervisory_org.csv` est déjà un fichier de catégorie. Détails : `etl/finma/SOURCES.md`.
- **Un OS (LEFin) n’est jamais une affiliation OAR (LBA)** : ne pas le présenter ainsi (fiche, README, schéma, mails). La phrase « ne contient pas les affiliations aux OAR » et le lien vers la recherche officielle restent. Le registre des affiliés OAR n’est pas collecté (lettre à la FINMA du 30.09.2026), ni les listes de membres des OAR.
- Rapprochement exact seulement (`exactMatchKey` : NFC et espaces ; casse, ponctuation et forme juridique conservées ; jamais `normalizeNameForMatch`, qui retire les formes juridiques) : clé unique dans vvtr, un seul UID, type coché. Sinon vide. Mesure du 30.09 : 1 508/1 508 lignes vvtr, 1 519/1 608 lignes du registre.
- Publication annulée (alerte du workflow) si un classeur n’est pas un XLSX, si l’en-tête ou la ligne « Total …: N » ne correspond pas, si un OS de vvtr manque dans ao, sous 1 000 gestionnaires / 5 OAR / 2 OS, sous 95 % de lignes vvtr rattachées, ou si une table promise est vide (`buildBundle`). Les colonnes e-mail et téléphone ne sont jamais lues (e-mails nominatifs dans sro.xlsx). Tests : `tests/etl/finma-supervision.test.ts` (fixtures fictives `etl/finma/fixtures/finma-{vvtr,sro,ao}-sample.xlsx`, générateur à côté).
- `quality.json` porte un bloc `supervisory_organisation` séparé (source, date, SHA-256, compteurs) : ne pas l’ajouter à `populated_fields` ni au tableau de couverture de la fiche, où 52 % des lignes se liraient comme un trou. `FINMA_SNAPSHOT_FIELDS`, `kyc_check` et les outils MCP ne lisent pas ce champ.
- Fiche FINMA FR/DE/EN : une phrase dans « Comprendre la couverture », avant celle des OAR (« lorsque la correspondance est exacte », « n’est pas une affiliation à un OAR »), sans volume ni mot-clé ajouté au titre, à la description ou aux données structurées. Test C4 étendu. **Ordre de publication** : le site se déploie tout de suite, les données seulement à la collecte suivante ; publier la fiche seulement quand la version en vente contient déjà le champ et les deux tables (sinon on rejoue l’incident du 22.09).
