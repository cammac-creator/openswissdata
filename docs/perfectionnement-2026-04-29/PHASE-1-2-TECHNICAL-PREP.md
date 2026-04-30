# Phase 1 & 2 — préparation technique d'implémentation

**But :** dès que la Phase 0 est livrée, attaquer Phase 1 (enrichissements) puis Phase 2 (MCP server) sans temps mort. Ce doc cadre les choix techniques pour chaque chantier majeur, pour qu'un agent ou un dev puisse attaquer directement sans recherche.

---

## Phase 1 / T1 — Embeddings TARES multilingues

### Objectif
Pré-calculer pour chaque ligne TARES (~7 500) un vecteur d'embedding 768d par langue (DE/FR/IT/EN), à partir de la description du code HS. Livrer les embeddings dans le pack (Parquet) et fournir un index FAISS optionnel.

### Choix de modèle
**`BAAI/bge-m3`** (Hugging Face, MIT) — multilingue 100+ langues, 1024d (réductible 768d).
- Alternative : `intfloat/multilingual-e5-large` (1024d, MIT) — qualité comparable
- Alternative légère : `paraphrase-multilingual-mpnet-base-v2` (768d, Apache 2.0)
- Décision recommandée : **`BAAI/bge-m3`** car le plus récent, le plus polyvalent (dense + sparse + multi-vector)

### Stack technique
- **Local sans GPU** : `@xenova/transformers` (port WASM de transformers.js) — fonctionne dans Node mais lent (~2-3s par embedding)
- **Local avec GPU** : `@huggingface/transformers` Python avec onnxruntime-gpu — ~50ms par embedding
- **API distante** : Hugging Face Inference Endpoints ($0.06/1k tokens, ~30k tokens pour 7500×4 = 1.80 USD/run)
- **Décision recommandée** : **API HF Inference** pour la première génération (coût négligeable, pas de dépendance lourde), puis cron mensuel via GitHub Actions (gratuit) qui regénère.

### Format de sortie
```
data/tares/tares_embeddings.parquet
columns:
  - hs_code (string)        # référence à tares.parquet
  - lang (string)            # 'de' | 'fr' | 'it' | 'en'
  - description (string)     # le texte d'entrée
  - embedding (list<float>)  # vecteur 768 ou 1024 floats
  - model (string)           # 'BAAI/bge-m3'
  - model_version (string)   # checksum du modèle
```
+ Optionnel : `tares_index.faiss` (binaire FAISS, plat, cosine)

### Intégration ETL
1. Nouveau fichier `etl/tares/embeddings.ts` avec :
   ```ts
   export async function generateTaresEmbeddings(rows: TaresRow[]): Promise<TaresEmbedding[]>
   ```
2. Appelé dans `etl/tares/release.ts` après `buildTaresRows()`, avant `buildBundle()`
3. Embeddings ajoutés au ZIP bundle dans `tares_embeddings.parquet`

### Coût estimé
- Premier run : ~1.80 USD (HF API)
- Runs mensuels : ~1.80 USD × 12 = ~22 USD/an
- Calcul si on passait au self-hosted GPU (Modal/Replicate) : ~5 USD/run sur A100, donc équivalent à 60 USD/an mais avec contrôle total

---

## Phase 1 / C2 — STATENT join (Classifications Pro)

### Objectif
Joindre le pack Classifications avec les chiffres STATENT (établissements + FTE × NOGA × commune × année). Permet aux clients de répondre instantanément "combien de boulangers à Lausanne en 2024 ?".

### Source
- Dataset OFS opendata.swiss : https://opendata.swiss/fr/dataset/betriebszahlung-unternehmensstatistik-arbeitsstatten
- Format : CSV (souvent compressé), encodage UTF-8 ou Latin-1 selon les versions
- Volume : ~6 millions de lignes (3 cantons × 2 145 communes × 8 années × ~400 codes NOGA × 2 mesures)
- Mise à jour : annuelle (données année N publiées en juillet année N+2)
- Licence : ouverte (CH-Statistik), attribution OFS recommandée

### Pipeline
```
data/classifications/raw/statent_<year>.csv     # téléchargement
            ↓ parse + filter + aggregate
data/classifications/statent_join.parquet
columns:
  - noga_code (string)
  - commune_bfs_id (int)       # ID FOG/BFS de la commune
  - year (int)
  - establishments (int)
  - fte (float)
  - employment (int)
```

### Intégration ETL
1. Nouveau fichier `etl/classifications/ingest-statent.ts`
2. Appelé dans `release.ts` mais **uniquement pour le tier Pro/Enterprise** (configurable par variable d'env `CLASSIFICATIONS_TIER=pro`)
3. Ajouté au bundle Pro mais pas au bundle standard

### Risque permission
Les données STATENT sont publiques mais le bulk commercial est conditionné à attribution. Texte standard : `Source: Office fédéral de la statistique (BFS) — Statistique de l'emploi (STATENT) [année]`. Inclure dans LICENSE.txt + page produit.

---

## Phase 1 / C3 — Classifier free-text → top-3 NOGA

### Objectif
Endpoint qui prend du texte libre (`"vente de café en grain et torréfaction"`) et retourne les 3 codes NOGA les plus probables avec score de confiance. Killer feature pour les CRM/sales/RAG agents.

### Stack
1. Reprendre les embeddings NOGA pré-calculés (cf. C3 du roadmap, similaire au T1 mais pour NOGA descriptions)
2. À la query : embedder le texte d'entrée (même modèle, BAAI/bge-m3)
3. Cosine similarity sur les embeddings NOGA (FAISS index in-memory ou ANN)
4. Retourner top-K avec score

### Intégration
- Endpoint serveur : exposé seulement via MCP server (Phase 2), pas en API REST publique
- Batch local : SDK `@osd/sdk-py` fournit un script `classify_text(text, top_k=3)` qui charge l'index FAISS local

### Performance cible
- p50 : 50 ms (embeddings NOGA en RAM, FAISS flat)
- p99 : 200 ms

---

## Phase 1 / F2 — Zefix Sync (FINMA + Zefix)

### Objectif
Enrichir chaque entité FINMA avec son extrait Zefix complet : organes (administrateurs), capital, statut au registre du commerce, mutations, journal SOGC, signature électronique au RC.

### Sources
- **Zefix REST API** : https://www.zefix.admin.ch/ZefixPublicREST/swagger-ui/index.html
  - Auth : email à `zefix@bj.admin.ch` pour obtenir une clé d'accès
  - Rate limit : ~600 req/min en pratique
- **LINDAS SPARQL** : https://register.ld.admin.ch/.well-known/dataset/foj-zefix
  - Public, pas de rate limit annoncé
  - Bulk-friendly via SPARQL CONSTRUCT

### Stratégie hybride
1. **Initial bulk** : SPARQL CONSTRUCT sur LINDAS pour récupérer toutes les ~750k entités CH avec organes (1 fichier Turtle ~500MB, parser local)
2. **Incremental updates** : Zefix REST API par UID, daily, sur les ~1500 entités FINMA seulement (1500 req/jour, dans le rate limit)

### Pipeline
```
data/finma/zefix-cache.sqlite                  # cache local SQLite
            ↓ join sur uid
data/finma/finma_with_zefix.parquet
columns:
  - uid (CHE-xxx.xxx.xxx)
  - finma_* (champs existants)
  - zefix_status (string)            # 'active' | 'inactive' | 'liquidation'
  - zefix_capital (float, CHF)
  - zefix_capital_currency (string)
  - zefix_legal_form (string)        # 'SA' | 'SARL' | 'Coop' | etc.
  - zefix_organes (jsonb)            # [{role, name, signature_type}]
  - zefix_purpose (string)           # objet social
  - zefix_last_update (date)
```

### Coût
- Bulk LINDAS : gratuit, ~30 minutes (Turtle parsing)
- Daily incremental Zefix : gratuit dans rate limit (1500 req/jour < 600/min × 24h)

---

## Phase 2 — MCP server `mcp.openswissdata.com`

### Architecture
```
                    ┌──────────────────────────┐
                    │  Claude Code / Cursor    │
                    │  (MCP client stdio/SSE)  │
                    └────────────┬─────────────┘
                                 │ HTTPS + SSE
                    ┌────────────▼─────────────┐
                    │  mcp.openswissdata.com   │
                    │  (Hono on Railway)       │
                    │                          │
                    │  - OAuth 2.1 server      │
                    │  - Token-licensed quota  │
                    │  - Tool registry         │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  Internal handlers       │
                    │                          │
                    │  - tariff_lookup         │
                    │  - tariff_semantic_      │
                    │      search (FAISS)      │
                    │  - tariff_changelog      │
                    │  - classify_text         │
                    │  - cross_walk            │
                    │  - statent_lookup (Pro)  │
                    │  - kyc_check             │
                    │  - entity_history        │
                    │  - finma_search          │
                    └──────────────────────────┘
```

### Stack
- Backend : **Hono** (déjà utilisé pour openswissdata.com/api)
- MCP SDK : **`@modelcontextprotocol/sdk`** (TypeScript officiel)
- Auth : **OAuth 2.1** (PKCE, refresh tokens). Implémentation via `@panva/oauth-rs`
- Vector store : **FAISS** in-memory (chargé au boot depuis Parquet)
- DB : **SQLite** existant (table `mcp_tokens`, `mcp_quotas`)

### Modèle commercial
- **Freemium** : 10 lookups/jour gratuits par compte (suffisant pour évaluation)
- **Lié à licence ZIP** : si tu achètes le pack TARES Pro (899 CHF), ton MCP token est inclus avec quota 10k req/mois pour les endpoints TARES
- **Standalone abonnement** :
  - 39 CHF/mois — TARES MCP seul (1k req/jour)
  - 49 CHF/mois — FINMA KYC MCP seul
  - 79 CHF/mois — Classifications + classify_text MCP
  - **99 CHF/mois — Bundle MCP** (les 3 servers ensemble)

### Endpoints détaillés

```ts
// TARES
{
  name: 'tariff_lookup',
  description: 'Lookup a Swiss customs tariff (HS8) and return full row with hierarchy. Includes mandatory non-official disclaimer that the agent cannot strip.',
  inputSchema: {
    type: 'object',
    properties: {
      hs8: { type: 'string', pattern: '^\\d{8}$' },
      lang: { type: 'string', enum: ['fr', 'de', 'it', 'en'] }
    },
    required: ['hs8']
  }
}

{
  name: 'tariff_semantic_search',
  description: 'Semantic search across TARES descriptions in 4 languages. Uses pre-computed BAAI/bge-m3 embeddings.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      top_k: { type: 'integer', default: 5, maximum: 20 },
      lang: { type: 'string', enum: ['fr', 'de', 'it', 'en'] }
    },
    required: ['query']
  }
}

{
  name: 'tariff_changelog',
  description: 'Returns the historical changelog of MFN duty rates and preferential rates for a given HS8 code, over a 12-24 month rolling window.',
  inputSchema: {
    type: 'object',
    properties: {
      hs8: { type: 'string' },
      since: { type: 'string', format: 'date' }
    },
    required: ['hs8']
  }
}

// Classifications
{
  name: 'classify_text',
  description: 'Classify a free-text business description into top-K NOGA codes with confidence scores. Uses pre-computed embeddings.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      lang: { type: 'string', enum: ['fr', 'de', 'it', 'en'], default: 'fr' },
      top_k: { type: 'integer', default: 3, maximum: 10 },
      scheme: { type: 'string', enum: ['NOGA_2025', 'NACE_2.1'], default: 'NOGA_2025' }
    },
    required: ['text']
  }
}

{
  name: 'cross_walk',
  description: 'Translate a code from one classification scheme to another (NOGA 2008/2025, NACE 2.0/2.1, ISIC 4, NAICS 2022).',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      source: { type: 'string', enum: ['NOGA_2008', 'NOGA_2025', 'NACE_2.0', 'NACE_2.1', 'ISIC_4', 'NAICS_2022'] },
      target: { type: 'string', enum: ['NOGA_2008', 'NOGA_2025', 'NACE_2.0', 'NACE_2.1', 'ISIC_4', 'NAICS_2022'] }
    },
    required: ['code', 'source', 'target']
  }
}

{
  name: 'statent_lookup',  // Pro tier only
  description: 'Returns the number of establishments and FTE for a given NOGA code in a given commune (or canton). Source: STATENT BFS.',
  inputSchema: {
    type: 'object',
    properties: {
      noga_code: { type: 'string' },
      geo_level: { type: 'string', enum: ['commune', 'canton', 'national'], default: 'commune' },
      commune_bfs_id: { type: 'integer' },
      canton: { type: 'string', maxLength: 2 },
      year: { type: 'integer', minimum: 2011 }
    },
    required: ['noga_code']
  }
}

// FINMA
{
  name: 'kyc_check',
  description: 'Unified KYC check: returns FINMA authorisation status, warnings, SECO sanctions, Zefix corporate status, and GLEIF LEI for a given entity.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      uid: { type: 'string', pattern: '^CHE-' },
      lei: { type: 'string', pattern: '^[A-Z0-9]{20}$' }
    },
    oneOf: [{ required: ['name'] }, { required: ['uid'] }, { required: ['lei'] }]
  }
}

{
  name: 'entity_history',
  description: 'Returns the timeline of changes for a FINMA-supervised entity: registration, authorization changes, withdrawals, capital mutations, SOGC events.',
  inputSchema: {
    type: 'object',
    properties: {
      uid: { type: 'string' }
    },
    required: ['uid']
  }
}

{
  name: 'finma_search',
  description: 'Fuzzy search FINMA registry by name (tolerates typos and variants). Returns top-K matches with confidence score.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      top_k: { type: 'integer', default: 5 },
      include_warnings: { type: 'boolean', default: false }
    },
    required: ['name']
  }
}
```

### Infrastructure de déploiement
- Sous-domaine `mcp.openswissdata.com` → Railway (nouveau service `mcp` ou même service `api` avec route `/mcp/*`)
- Cert SSL via Let's Encrypt (déjà géré par Railway)
- DNS : ajouter CNAME `mcp` → Railway target

### Effort estimé
- OAuth 2.1 server : 2 j
- 9 endpoints + tests : 4 j
- Quota & licensing : 1 j
- Doc + page d'inscription dev : 1 j
- Total : **~8 jours de dev pour MVP**

---

## Phase 3 — Warranty contractuelle

### Texte juridique (à finaliser avec un avocat suisse avant publication)

> **Article X — Garantie d'exactitude (Pro & Enterprise)**
>
> Pour les licences Pro et Enterprise des Datasets, l'Éditeur garantit l'exactitude et la fraîcheur des données livrées dans la limite des conditions usuelles de prudence et de revue éditoriale.
>
> En cas de **dommage matériel direct, vérifiable et chiffrable** subi par l'Acheteur du fait d'une **erreur de notre Dataset** (et non d'une erreur de la source officielle, qui est explicitement déclinée), l'Éditeur indemnise l'Acheteur jusqu'à concurrence de **dix (10) fois le prix de la licence annuelle correspondante**, avec un plafond global de **CHF 50 000 par incident** et **CHF 150 000 par année civile**.
>
> Sont couverts notamment :
> - Une amende douanière BAZG résultant directement d'une erreur de classification HS8 dans notre dataset TARES
> - Une sanction d'autorité fédérale résultant directement d'une erreur de notre pack Classifications
> - Une perte vérifiable directement causée par un flag `is_warning_listed` erroné de notre pack FINMA
>
> **Sont exclus** :
> - Les dommages indirects, consécutifs, perte de profit, perte de chance
> - Les erreurs présentes dans la source officielle elle-même
> - Les erreurs résultant d'une utilisation non documentée du Dataset
> - Tout sinistre déclaré au-delà de 90 jours après la date de l'incident
>
> Pour activer la garantie, l'Acheteur doit fournir le `provenance.json` du ZIP utilisé au moment de l'incident, prouvant la version exacte du Dataset.

### Implémentation
- Mettre à jour `web/src/pages/legal/cgv.astro` pour ajouter la nouvelle section
- Mettre à jour `web/src/pages/legal/provenance.astro` (déjà mention faite, à enrichir)
- Page produit Pro : ajouter badge "Backed by data warranty" en hero
- Souscrire une **assurance RC professionnelle** (CHF 5 000 / an typique en CH pour un solo founder data) pour absorber les sinistres réels

### Risque actuariel
- Probabilité d'un sinistre BAZG en première année : ~5% (peu d'acheteurs Pro pour l'instant)
- Coût moyen attendu : ~5% × 50 000 CHF / nb d'acheteurs Pro
- Si 10 acheteurs Pro × 899 CHF = 8 990 CHF revenu, sinistre attendu = 250 CHF/acheteur → **assurable**

---

## Recommandation enchaînement

1. **Attendre Phase 0** (agents en cours pour Q1, Q3, Q4 ; Q5 reporté ; Q6 fait)
2. **Build & deploy consolidé** `railway up` une fois Q1+Q3+Q4 livrés
3. **Vérifier en live** que les 3 packs livrent les enrichissements
4. **Démarrer Phase 1** : T1 embeddings TARES (1 j), C2 STATENT (2 j), C3 classifier (1 j sur les NOGA embeddings), F2 Zefix Sync (4 j en hybride). Total ~8 j.
5. **Lancer relances OFS et FINMA** (templates v2 prêts dans `permissions-emails/`) en parallèle de Phase 1
6. **Démarrer Phase 2** MCP server (8 j) pendant que Phase 1 tourne en CI
7. **Phase 3** warranty + repricing **après** Phase 1 vérifiée live (Q5 débloqué)
8. **Phase 4** push promo coordonné (LinkedIn FR/DE/EN, Show HN, ProductHunt, Reddit, Datarade, HF)

Total estimé du chantier : **~13 semaines** comme planifié dans `ROADMAP.md`.
