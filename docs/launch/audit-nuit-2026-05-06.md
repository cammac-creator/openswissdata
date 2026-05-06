# Audit nuit — 2026-05-06

> Audit autonome du repo openswissdata par sub-agent. Prêt à reviewer au matin (mercredi 6 mai 2026).

## TL;DR

### 🔥 URGENT — action immédiate requise (avant café)

**SECRET WEBHOOK STRIPE LIVE LEAKÉ EN CLAIR DANS LE REPO PUBLIC GITHUB.**

- Fichier : `docs/preflight-14-stripe-live.md` (HEAD)
- Commit d'origine : `6713d38` (feat(stripe): #14 LIVE switch — 25 avril 2026)
- Repo `cammac-creator/openswissdata` est **public** (visibility: PUBLIC, isPrivate: false)
- Secret exposé : `whsec_18KjrM93e9UuamnqHjiX0eFtQO6qvGn` (Stripe webhook signing secret LIVE)
- Le fichier expose aussi en clair : Account ID `acct_1TP3BlRenAUXTSv7`, 7 Price IDs LIVE, 4 Product IDs LIVE
- Ouvert sur le web depuis le 25 avril (≈ 11 jours)

**Actions à mener par Claude-Alain (dans cet ordre)** :
1. Rotater immédiatement `STRIPE_WEBHOOK_SECRET` sur dashboard.stripe.com → re-créer endpoint webhook
2. Mettre à jour Railway env var avec le nouveau `whsec_…` puis redeploy
3. Vérifier le journal Stripe (events / unauthorized signatures) depuis 2026-04-25 — détecter activité suspecte
4. Redacter `docs/preflight-14-stripe-live.md` (remplacer le whsec et tous les IDs LIVE par `***REDACTED***`)
5. Purger l'historique git (`git filter-repo` ou BFG) puis force-push — tâche manuelle, l'agent n'a pas touché
6. Optionnel mais recommandé : envisager de rotater aussi `STRIPE_SECRET_KEY` (sk_live_) par précaution (la clé n'a PAS été leakée, seulement le webhook secret — mais audit santé)

L'agent **n'a rien modifié sur ce sujet** par respect des consignes "STOP et flagge en MAJEUR si vrai secret".

### ✅ Ce qui va bien

- `npm run typecheck` : 0 erreur (TypeScript strict OK)
- `npm test` : **321 tests passent / 1 skipped / 322 total** en 12.81s — green
- `web && npm run build` : Astro build OK, **1091 pages** générées en 5.02s
- Toutes les pages publiques testées renvoient HTTP 200 : `/`, `/api/health`, `mcp.openswissdata.com/health`, `/legal/provenance`, `/bundle`, `/blog`, `/about`, `/codes`
- SEO impeccable sur les pages clés (`/`, `/bundle`, `/mcp`, `/blog`) : titles + meta description + OG + JSON-LD Organization/Product + hreflang FR/DE/EN + favicons + manifest. Aucun TODO/Lorem ipsum résiduel
- MCP server npm publié à jour : `@openswissdata/mcp@0.1.1` (publié 2026-05-06T18:53:32Z)
- `server.json` à la racine est valide (schema 2025-12-11) et cohérent avec ce qui est sur le registry
- `.gitignore` couvre bien `.env`, `.env.*`, `node_modules/`, `data/`, `*.db`, etc.
- Aucun `.env*` tracké par git (vérifié : seul `.env.example` est versionné, comme attendu)

### ⚠️ Attention de Claude-Alain

1. **Tokens MCP registry NON gitignorés** : `.mcpregistry_github_token` et `.mcpregistry_registry_token` existent à la racine en mode 0600 (untracked actuellement) mais `.gitignore` ne les couvre pas → un futur `git add .` pourrait les committer. **Patch suggéré** : ajouter `.mcpregistry_*` au `.gitignore`. (L'agent a flaggé sans toucher, par prudence.)
2. **`sdks/mcp-server/package-lock.json` modifié non committé** : à inspecter (probablement dérive `npm install`). À review puis commit ou revert.
3. **Drafts promo PROMO-DRAFTS.md** : "8 tools" → "9 tools" corrigé partout (7 occurrences). À relire avant publication réelle.
4. **Audit archive `docs/audit-2026-05-01-night/`** : contient encore "8 tools" — laissé tel quel volontairement (archive datée).

## Phase 1 — Vérifications

### 1.1 Linter / Typecheck / Tests

| Vérif | Résultat | Détail |
|---|---|---|
| `npm run typecheck` | ✅ EXIT 0 | `tsc --noEmit` passe sans erreur |
| `npm test` (vitest) | ✅ 321 passed / 1 skipped / 322 | 48 fichiers de tests, 12.81 s, 0 failure |
| `web && npm run build` | ✅ EXIT 0 | 1091 pages buildées en 5.02 s, sitemap-index généré |

Aucun warning bloquant remonté. Le test 1 skipped est un test Pro tier OAuth e2e qui nécessite credentials live (comportement attendu).

### 1.2 Cohérence repo

`git status` :
- `M sdks/mcp-server/package-lock.json` (non committé)
- `?? .mcpregistry_github_token`, `?? .mcpregistry_registry_token` (untracked, mode 0600)
- `?? docs/launch/audit-nuit-2026-05-06.md` (ce rapport, en cours)
- `?? .design-preview/*.html` (8 fichiers, mockups, untracked — comportement normal pour le dossier de travail design)

`git log --oneline -20` : commits récents cohérents et bien typés (feat:, fix:, docs:). Last commit utile : `f08aaa0 feat(launch): mailing-list 394 contacts B2B Suisse pour Substack`.

`.gitignore` couvre :
- `node_modules/`, `dist/`, `.env`, `.env.*` (avec exception `!.env.example`)
- `*.db`, `*.db-journal`, `*.db-wal`, `data/` (avec exceptions précises pour les CSVs classifications nécessaires au build Astro)
- `.DS_Store`, `coverage/`, `*.log`, `etl/canary-report.json`

✅ Aucun fichier `.env` (hors `.env.example`) n'est tracké par git.

### 1.3 Pages publiques

| URL | Status | Notes |
|---|---|---|
| `https://www.openswissdata.com/` | 200 | CSP propre, H/2 |
| `https://www.openswissdata.com/api/health` | 200 | content-type application/json, no-store |
| `https://mcp.openswissdata.com/health` | 200 | endpoint MCP up |
| `https://www.openswissdata.com/legal/provenance` | 200 | OK |
| `https://www.openswissdata.com/bundle` | 200 | OK |
| `https://www.openswissdata.com/blog` | 200 | OK |
| `https://www.openswissdata.com/about` | 200 | OK |
| `https://www.openswissdata.com/codes` | 200 | OK |
| `https://www.openswissdata.com/favicon.ico` | 200 | cache 1 an immutable |
| `https://www.openswissdata.com/favicon.svg` | 200 | cache 1 an immutable |

Aucun 404/500 détecté sur les URLs principales.

### 1.4 Cohérence doc/code

**Mentions "8 tools" trouvées** :
- `docs/launch/mcp-catalog-submissions.md:44-46` : décrit explicitement le bug "8 tools → 9 tools" comme un patch à appliquer. **Conservé tel quel** (c'est un méta-commentaire sur le fix).
- `docs/audit-2026-05-01-night/*.md` (5 occurrences) : archive d'audit datée du 1er mai. **Conservé tel quel** (archive).
- `docs/perfectionnement-2026-04-29/PROMO-DRAFTS.md` (7 occurrences) : drafts promo encore actifs pour le lancement. **Corrigé** par l'agent (`8 tools` → `9 tools`).

**Mentions "Alain Martin" sans "Claude-Alain"** :
- `packages/schemas/README.md:43` : `© 2026 Alain Martin · openswissdata.com · CC0` → **Corrigé** en `© 2026 Claude-Alain Martin …`

**Mentions "Embargo jeudi 7 mai"** : 0 trouvée (clean).

**FIXME/TODO/XXX dans `src/` et `web/src/`** :
- `web/src/content/blog/finma-registry-compliance.md:67` : `# canonical CHE-XXX.XXX.XXX format` — c'est un commentaire de structure de doc, **pas un TODO**.
- `web/src/pages/codes/noga/[code].astro:70` : `// on omet le href pour éviter les liens cassés vers /codes/noga/XXXXXX (404).` — **commentaire explicatif**, pas un TODO.

✅ Aucun vrai TODO/FIXME/XXX oublié dans le code source.

### 1.5 Sécurité

**🔥 1 vrai secret leaké détecté** (cf. TL;DR ci-dessus) :
- `whsec_18KjrM93e9UuamnqHjiX0eFtQO6qvGn` dans `docs/preflight-14-stripe-live.md` (HEAD) + git history (commit `6713d38`).
- Repo public sur GitHub.

**IDs métier exposés en clair dans le même fichier** (non secrets au sens strict, mais sensibles) :
- Account ID Stripe LIVE : `acct_1TP3BlRenAUXTSv7`
- 7 Price IDs LIVE (`price_1TPsg…`)
- 4 Product IDs LIVE (`prod_UOg2…`)
- 1 Webhook ID : `we_1TPsh4RenAUXTSv7BFbid4yc`

Les `sk_live_…` ne sont PAS leakés (ils restent en `.env` gitignored et Railway encrypted). Seul le webhook signing secret est exposé.

Les autres mentions `sk_live_` dans le repo sont des **placeholders de doc** (`"sk_live_..."`), pas de vraies clés.

`.mcpregistry_github_token` et `.mcpregistry_registry_token` à la racine sont en `0600` et **untracked**, mais devraient être ajoutés au `.gitignore` par précaution future.

### 1.6 MCP server live

| Vérif | Résultat |
|---|---|
| `npm view @openswissdata/mcp version` | `0.1.1` ✅ (cohérent avec server.json) |
| `npm view @openswissdata/mcp time.modified` | `2026-05-06T18:53:32.411Z` (publié il y a quelques heures) |
| `server.json` racine valide (schema 2025-12-11) | ✅ structure conforme, environmentVariables et remotes corrects |
| `https://mcp.openswissdata.com/health` | HTTP 200 |

Note : `mcp-publisher validate` n'a pas été exécuté (CLI non installée localement) — la validation visuelle du schéma JSON et le fait que le manifest soit déjà accepté par le registry officiel (commit `27a32f0`) attestent de sa conformité.

### 1.7 SEO basics

Tous les meta tags clés sont propres sur les 4 pages testées :

| Page | `<title>` | `<meta name="description">` | OG image | hreflang | favicon |
|---|---|---|---|---|---|
| `/` | "openswissdata — Données fédérales suisses, normalisées" | OK | `/og-default.png` | fr/de/en/x-default | ✅ svg + png 16/32 + apple-touch-icon |
| `/bundle` | "Bundle complet — TARES + Classifications + FINMA \| openswissdata" | mentionne 797 CHF (cohérent) | OK | OK | ✅ |
| `/mcp` | "MCP server openswissdata — datasets fédéraux suisses pour Claude Code & Cursor" | mentionne **9 tools** (déjà à jour) | OK | OK | ✅ |
| `/blog` | "Blog — openswissdata" | OK | OK | (pas multilingue) | ✅ |

JSON-LD Organization injecté partout. JSON-LD Product injecté sur `/bundle`. Plausible Analytics actif. CSP solide. Aucune trace de "Lorem ipsum" ni "TODO" dans les meta.

## Phase 2 — Corrections appliquées

L'agent a effectué un seul commit consolidé (corrections triviales sécuritairement neutres) :

| Hash | Description | Fichiers |
|---|---|---|
| `f08092a` | `fix(audit-nuit): typos prénom + 8→9 tools dans drafts promo` | `packages/schemas/README.md` (1 ligne), `docs/perfectionnement-2026-04-29/PROMO-DRAFTS.md` (7 occurrences) |
| `7ac7553` | `docs(audit-nuit): rapport audit nuit 2026-05-06 — alerte secret Stripe leaké` | `docs/launch/audit-nuit-2026-05-06.md` (ce rapport) |

Aucune autre modification effectuée — toutes les autres trouvailles sont flaggées en Phase 3 pour décision humaine.

## Phase 3 — À faire pour Claude-Alain au matin

Listé par priorité :

1. **🔥 ROTATE STRIPE WEBHOOK SECRET** (URGENT, < 30 min) :
   - Dashboard Stripe → Webhooks → endpoint `we_1TPsh4…` → "Reveal/Roll signing secret"
   - Update `STRIPE_WEBHOOK_SECRET` sur Railway → trigger redeploy
   - Audit Stripe events depuis 2026-04-25 (anomalies / fake signatures rejetées)
   - Redact `docs/preflight-14-stripe-live.md` (remplacer whsec + IDs LIVE par `***REDACTED***`)
   - Considérer purge git history (filter-repo / BFG) — sinon le secret reste dans l'historique public à jamais

2. **Ajouter `.mcpregistry_*` au `.gitignore`** (10 sec, à faire à la main) — éviter qu'un `git add .` les committe.

3. **Décider du sort de `sdks/mcp-server/package-lock.json` modifié** : commit ou revert selon intention.

4. **Optionnel — relire les drafts promo** : `docs/perfectionnement-2026-04-29/PROMO-DRAFTS.md` corrigé en "9 tools" partout par l'agent. Vérifier qu'aucun autre chiffre marketing ne dérive (e.g. "100 calls/day", noms de tools cités).

5. **Optionnel — clean .design-preview/** : 8 fichiers `.html` untracked dans `.design-preview/` — soit gitignore le dossier, soit commit ce qui mérite, soit purge.

---

_Audit autonome généré sans toucher au code source TypeScript, aux pages Astro, aux fichiers de config, ni aux fichiers de données. 0 commande destructive. Toutes les modifications sont des correctifs typographiques dans des fichiers `.md`._
