# MCP Server E2E Audit — 2026-05-01

**Cible** : `https://mcp.openswissdata.com/jsonrpc` (alias : `https://www.openswissdata.com/mcp/jsonrpc`)
**Version** : 0.2.0 — protocol 2025-06-18
**Auditeur** : Claude Opus 4.7 (1M ctx)
**Périmètre** : 8 tools MCP exposés en production (anonymous + invalid token)

---

## 1. Résumé exécutif

| Métrique | Valeur |
|---|---|
| Tools exposés (`tools/list`) | **8 / 8** |
| Tools testables sans OAuth (V1) | **3 / 8** : `tariff_lookup`, `kyc_check`, `cross_walk` |
| Tools verrouillés par scope (V2) | **5 / 8** : `tariff_semantic_search`, `classify_text`, `tariff_changelog`, `entity_history`, `finma_search` |
| V1 fonctionnels en prod | **3 / 3** ✅ |
| V2 fonctionnels (handler exécuté) | **0 / 5 — NON VÉRIFIÉ** : gate scope active, handlers inatteignables sans flow OAuth complet (hors périmètre audit) |
| Latence moyenne (V1, after warm) | **~90 ms** (87 / 88 / 92 sur trois tools) |
| Cold start observé | **475 ms** sur le premier `tariff_lookup` (chargement data CSV en mémoire) |
| Endpoint discovery | OK sur les deux URLs (mcp.* et www.*/mcp/) |
| Codes d'erreur JSON-RPC | **Conformes** (-32600 / -32601 / -32602) |
| Bugs bloquants launch | **0** — DX warts uniquement |
| DX warts à fixer avant launch | **3** (cf. §5) |

**Verdict launch jeudi 7 mai : OUI conditionnel** — la surface publique (3 V1) est solide. Les 5 tools Pro (V2) ne sont pas vérifiés par cet audit ; un test OAuth E2E (~30 min) est recommandé avant la promo "premier MCP suisse".

---

## 2. Tool-by-tool

Latences ci-dessous = `time_total` curl, mesuré depuis Lausanne sur Railway europe-west4. Trois appels par tool (sauf indication contraire). Codes HTTP renvoyés : tous **200** sauf Bearer invalide (401).

### 2.1 `tariff_lookup` ✅ V1 anonymous OK

- **Inputs testés** :
  - `{ hs8: "09011100" }` (café non décaféiné, lang FR par défaut) → résultat complet, disclaimer FR inline, `structured.preferential_regimes` riche
  - `{ hs8: "84621100", lang: "en" }` (closed die forging machines) → traduction EN OK, disclaimer EN inline
  - `{ hs8: "INVALID" }` → erreur Zod regex bien formatée, `isError: true`
  - `{ hs8: "09011000" }` (code _proche_ d'un vrai mais inexistant) → `"No TARES row found for HS8 code…"` avec `isError: true`
- **Latences** : 475 ms (cold) / 166 ms / 165 ms ; ensuite 85 / 91 / 89 ms en steady state
- **Format** : conforme MCP — `content[0].text` contient le disclaimer + résumé humain ; `structured` contient l'objet typé `TariffLookupResult` complet
- **Observations** : excellente UX agent (disclaimer dans `text` ET dans `structured.disclaimer` — un agent qui forwarde `text` ne peut pas le perdre)

### 2.2 `kyc_check` ✅ V1 anonymous OK

- **Inputs testés** :
  - `{ name: "UBS Switzerland AG" }` → 2 hits (Bank + Custodian bank, même UID `CHE-412.669.376`)
  - `{ name: "Mobiliar", top_k: 3 }` → 3 hits ordonnés (Lebensversicherungs / Versicherungsgesellschaft / Holding)
  - `{ name: "X" }` → erreur Zod `String must contain at least 2 character(s)` (la doc demande `minLength: 2`, OK)
- **Latence** : 329 ms / 88 ms / 96 ms (la première inclut le chargement du CSV `finma_registry.csv`)
- **Format** : conforme — message humain + `structured` riche ; warning_count / match_count présents
- **Observations** : substring-only — le test "name=Cred Suisse" (typo) a été basculé sur `finma_search` (cf. 2.6)

### 2.3 `cross_walk` ✅ V1 anonymous OK

- **Inputs testés** :
  - `{ code: "62", source: "NOGA_2025", target: "NACE_2.1" }` → 1 mapping `[exact]`
  - `{ code: "6201", source: "ISIC_4", target: "NOGA_2025" }` → **0 mappings** (data gap, pas un bug — cf. §4)
  - `{ code: "INVALID", source: "NOGA_2025", target: "NACE_2.1" }` → 0 mappings, message clair, **pas** d'`isError` (graceful)
  - `{ from, code, to }` legacy field names → erreur Zod `expected 'NOGA_2008'|...|'ISIC_4'`
- **Latence** : 82 / 92 / 83 ms
- **Format** : conforme — `structured.mappings` array, `structured.count`, message humain avec note de source
- **Observation importante** : la signature attend `source` / `target` (pas `from` / `to` comme dans le brief de l'audit) — la doc agent doit refléter ça

### 2.4 `tariff_semantic_search` ⚠️ V2 — gate active, handler non vérifié

- **Inputs testés** : 1 appel ; tous bloqués au scope check
- **Réponse** : `{ error: { code: -32001, message: "Insufficient scope for tool 'tariff_semantic_search' (requires 'tariff:semantic')" } }`
- **HTTP** : 200 (erreur dans le body JSON-RPC, pas dans le statut)
- **Latence** : 123 ms (court-circuit avant chargement embeddings — normal)
- **Verdict** : **non vérifié** — le pipeline d'embeddings (chargement Parquet + Xenova/mpnet 768d) reste à valider en prod. Risque potentiel : 5-10 s sur premier call selon la doc inline du tool.

### 2.5 `classify_text` ⚠️ V2 — gate active, handler non vérifié

- **Réponse** : `-32001 Insufficient scope … 'classifications:semantic'` — court-circuit identique à 2.4
- **Latence** : 90 ms
- **Verdict** : non vérifié

### 2.6 `finma_search` ⚠️ V2 — gate active, handler non vérifié

- **Réponse** : `-32001 Insufficient scope … 'finma:read'`
- **Latence** : 87 / 91 / 87 ms
- **Verdict** : non vérifié
- **Note de cohérence** : `finma_search` requiert `finma:read` mais `kyc_check` (qui requiert le **même scope** par `TOOL_SCOPE`) passe en anonyme. Cause : `verify.ts L192` hardcode `PUBLIC_TOOLS = {tariff_lookup, kyc_check, cross_walk}` qui prime sur `TOOL_SCOPE`. Conséquence : deux sources de vérité, une seule effective. Voir §4 bug B-3.

### 2.7 `tariff_changelog` ⚠️ V2 — gate active, handler non vérifié

- **Réponse** : `-32001 Insufficient scope … 'tariff:semantic'` (scope inhabituel : un changelog pourrait logiquement être `tariff:read` ; le code mappe `tariff_changelog → tariff:semantic` dans `scopes.ts L48`)
- **Latence** : 97 ms
- **Verdict** : non vérifié + scope mapping potentiellement à revoir

### 2.8 `entity_history` ⚠️ V2 — gate active, handler non vérifié

- **Réponse** : `-32001 Insufficient scope … 'finma:history'`
- **Latence** : 97 ms
- **Verdict** : non vérifié — le tool dépend de la table SQLite `dataset_snapshots` (cf. `entity-history.ts L165-174`) qui n'a pas pu être interrogée. La doc inline indique que sans snapshots, la timeline est vide mais le `current` doit fonctionner.

---

## 3. Tests transverses

### 3.1 Discovery

```
GET https://mcp.openswissdata.com/discovery
GET https://www.openswissdata.com/mcp/discovery
```

→ Les deux endpoints renvoient **200** + payload identique :

```json
{
  "protocol_version": "2025-06-18",
  "server_info": { "name": "openswissdata-mcp", "version": "0.2.0" },
  "capabilities": { "tools": { "list_changed": false } },
  "tools": ["tariff_lookup", "kyc_check", "cross_walk", "tariff_semantic_search",
            "classify_text", "finma_search", "tariff_changelog", "entity_history"]
}
```

**Cohérence discovery ↔ tools/list** : ✅ — les 8 noms correspondent exactement. **Réserve** : `tools/list` retourne les 8 même à un appelant anonyme alors que 5 sont gated → DX wart (cf. §5 quick win 1).

### 3.2 JSON-RPC compliance

| Cas | Attendu | Reçu | OK ? |
|---|---|---|---|
| `initialize` | `result` avec protocolVersion + serverInfo | `2025-06-18` + `openswissdata-mcp 0.2.0` | ✅ |
| `ping` | `result: {}` | `{}` | ✅ |
| `tools/list` | array de 8 | 8 | ✅ |
| Manque `jsonrpc:"2.0"` | -32600 | `-32600 jsonrpc must equal '2.0'` | ✅ |
| `method: "unknown_method"` | -32601 | `-32601 Unknown method: unknown_method` | ✅ |
| `tools/call` sans `params.name` | -32602 | `-32602 params.name (string) is required` | ✅ |
| `tools/call` tool inconnu | -32601 ou -32602 | `-32601 Unknown tool: non_existing_tool` | ✅ |
| `Authorization: Bearer invalid_xyz` | 401 + `{error}` | `401 invalid_token` | ✅ |
| Pas d'header → fallback IP rate limit | 200 + headers `X-RateLimit-*` | 200 + `X-RateLimit-Limit: 100`, decrement OK | ✅ |

Tous les codes JSON-RPC standards sont conformes. **Pas de 500 silencieux observé**.

### 3.3 Rate limit anonymous (free tier)

Cinq appels rapides successifs : `X-RateLimit-Remaining` décrémente proprement (70 → 69 → 68 → 67 → 66). Limite **100/jour par IP**. Pas de comportement aberrant. Reset Unix timestamp présent dans le header `X-RateLimit-Reset`. Pour info : ~30 req déjà consommées par les tests précédents avant ces 5 mesures, donc **bucket sain**.

---

## 4. Bugs identifiés

### B-1 (sévérité MOYENNE) — `tools/list` ne filtre pas par scope effectif

- **Repro** : `curl -X POST mcp.openswissdata.com/jsonrpc -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` (sans Bearer)
- **Observé** : 8 tools renvoyés
- **Attendu (best practice MCP)** : 3 tools (les V1 anonymes) — ou les 8 mais avec un champ indiquant l'inaccessibilité
- **Impact** : un agent qui itère `tools/call` sur tous les tools listés va avoir 5 échecs `-32001`. Mauvaise première impression, surtout pour la promo "premier MCP suisse".
- **Fix suggéré** : dans `server.ts listTools()` accepter `ctx: MCPAuthContext | null`, filtrer via `isToolAllowed(t.name, TOOL_SCOPE[t.name] ?? null, ctx)`.

### B-2 (sévérité FAIBLE — data gap, pas un bug logique) — ISIC_4 6201 absent de crosswalks

- **Repro** : `cross_walk { code: "6201", source: "ISIC_4", target: "NOGA_2025" }` → 0 mappings
- **Vérification** : `awk -F, 'NR>1 && $5=="6201"' src/mcp/data/crosswalks.csv` → aucune ligne
- **Cause** : le CSV ne contient que la ligne agrégée ISIC_4=62 (division). Les sous-classes 6201/6202 n'ont pas été ajoutées au crosswalk.
- **Impact** : un buyer qui veut traduire "ISIC 6201 (Computer programming)" → NOGA aura 0 résultats alors que la mapping existe trivialement (NOGA 62.01 / NACE 62.01).
- **Fix** : enrichir `crosswalks.csv` au niveau classe ISIC (4 chiffres) — peut être généré depuis NACE 2.1 puisque NACE et ISIC sont alignés à ce niveau.

### B-3 (sévérité FAIBLE — dette technique) — Deux sources de vérité pour les tools publics

- **Symptôme** : `kyc_check` est listé dans `TOOL_SCOPE` avec scope `finma:read` (`scopes.ts L42`) mais accessible en anonymous via le hardcoded `PUBLIC_TOOLS = ["tariff_lookup", "kyc_check", "cross_walk"]` dans `verify.ts L192`. Si demain un dev change `PUBLIC_TOOLS` sans toucher `TOOL_SCOPE`, comportement silencieusement incohérent.
- **Fix suggéré** : dériver `PUBLIC_TOOLS` de `scopes.ts` via une constante (par ex. ajouter `"public": true` à un mapping centralisé), ou loguer un warning au démarrage si `PUBLIC_TOOLS` ne reflète pas un sous-ensemble cohérent.

### B-4 (sévérité OBSERVATION) — Cold start ~475 ms sur premier `tariff_lookup`

- **Mesure** : 475 ms (premier call) vs 85-95 ms ensuite. Charge probable du CSV `tares.csv` en mémoire.
- **Impact** : un agent qui fait son tout premier call attend ~0.5 s. Acceptable mais notable pour la perception "API rapide".
- **Fix suggéré** : warm-up au démarrage du process (appeler `getTares()` / `getCrosswalks()` / `getFinmaRegistry()` une fois en bootstrap). Très peu de coût, supprime le cold start visible.

### B-5 (sévérité FAIBLE — DX) — `tariff_changelog` requiert le scope `tariff:semantic`

- **Constat** : `scopes.ts L48` mappe `tariff_changelog → tariff:semantic`. Sémantiquement, un changelog n'a rien de sémantique — c'est une lecture historique. Un client `standard` (avec `tariff:read`) ne pourra pas appeler `tariff_changelog`.
- **Fix suggéré** : envisager un nouveau scope `tariff:history` (parallèle à `finma:history`), ou bien faire passer le changelog sous `tariff:read`.

---

## 5. Quick wins DX (5 améliorations courtes)

1. **Filter `tools/list` par scope effectif** (B-1) — implémentation : ~10 LOC, impact agent immédiat
2. **Warm-up au boot** (B-4) — appeler `getTares()` / `getCrosswalks()` / `getFinmaRegistry()` au démarrage du process Hono. Élimine le cold start visible
3. **Endpoint `GET /jsonrpc` info** — actuellement 404. Renvoyer un mini "use POST + voir /discovery" éviterait la confusion d'un développeur qui teste l'URL dans un browser
4. **Documenter dans `/discovery` quels tools sont anonymous** — ajouter `tools_public: ["tariff_lookup", "kyc_check", "cross_walk"]` ou `tools_requires_auth: [...]` pour qu'un client puisse pré-filtrer
5. **Header `Allow: POST` sur `OPTIONS /jsonrpc`** — bonne pratique CORS-friendly et standard HTTP. Pas vérifié si déjà fait, à ajouter si manquant

---

## 6. Verdict launch jeudi 7 mai 2026

### Surface publique (3 V1 tools anonymous) → **PRÊT** ✅

- JSON-RPC 2.0 conforme, codes d'erreur corrects
- Latence ~90 ms après warm-up (excellent pour Railway shared CPU)
- Discovery + tools/list cohérents
- Disclaimers BAZG/FINMA bien inlined dans les payloads texte (couverture juridique solide)
- Rate limiting anonymous fonctionnel (100/jour/IP)

### Surface Pro (5 V2 tools) → **NON VÉRIFIÉ par cet audit** ⚠️

Le scope check est actif (-32001 propre). Mais je n'ai pas pu valider que :
- Les embeddings Parquet (TARES + NOGA) chargent bien en prod (cold start 5-10 s annoncé dans les commentaires du code)
- Le pipeline Xenova/mpnet télécharge ses poids correctement sur Railway
- La table SQLite `dataset_snapshots` est peuplée pour `tariff_changelog` et `entity_history`

**Recommandation forte avant le launch jeudi** :

1. Tester le flow `POST /oauth/register` → `POST /oauth/token` → 5 × `tools/call` (un par V2 tool) en prod — environ **30 minutes** de boulot
2. Si KO sur un tool : choix entre patch rapide ou positionner le launch sur "3 tools gratuits + 5 Pro arrivent semaine prochaine"

### Fix recommandé avant launch (priorité)

| Priorité | Item | Effort |
|---|---|---|
| **P0** | Test E2E OAuth des 5 V2 tools en prod | 30 min |
| P1 | Quick win 1 — filter `tools/list` par scope | 15 min |
| P1 | Quick win 2 — warm-up au boot (B-4) | 10 min |
| P2 | B-5 — revoir mapping scope de `tariff_changelog` | 5 min |
| P3 | B-2 — enrichir crosswalks ISIC 4 chiffres | 1-2 h |

### TL;DR pour la promo "premier MCP suisse"

La promo est **défendable** : protocol_version 2025-06-18, 8 tools déclarés (3 free + 5 Pro), discovery en place, JSON-RPC bien implémenté, disclaimers juridiques corrects. **Mais** la phrase "8 tools" doit être étayée par un test OAuth E2E avant le tweet/post lancement — sinon premier early adopter qui essaie un tool Pro tombe sur `-32001` sans flow auto-onboarding et la première impression coule.

---

## Annexe — Fichiers MCP consultés

- `/Users/claude-alainmartin/openswissdata/src/mcp/server.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/oauth/scopes.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/oauth/verify.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/oauth/register.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/oauth/index.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/tariff-lookup.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/kyc-check.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/cross-walk.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/tariff-semantic-search.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/classify-text.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/finma-search.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/tariff-changelog.ts`
- `/Users/claude-alainmartin/openswissdata/src/mcp/tools/entity-history.ts`

Word count : ~2 250 mots.
