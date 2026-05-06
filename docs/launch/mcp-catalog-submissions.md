# Submissions catalogues MCP — copier-coller prêt

> Source unique pour soumettre `@openswissdata/mcp` aux 5 catalogues MCP (T3 plan acquisition).
> Préparé le 2026-05-06.

---

## 0. Prérequis — à régler AVANT toute soumission

Deux blockers découverts pendant la prep — sans ça, tous les liens des soumissions sont cassés et les forms sont rejetés.

### 0.1 Publier le package npm `@openswissdata/mcp`

État actuel : **`npm view @openswissdata/mcp` retourne 404** — le package n'est pas publié sur le registry public.

```bash
cd sdks/mcp-server
# Login npm si pas déjà fait
npm login

# Le package est scoped (@openswissdata/...) → flag --access public obligatoire pour la 1ère publication
npm publish --access public
```

Vérifier ensuite : `npm view @openswissdata/mcp version` doit retourner `0.1.0`.

> Note : la team `@openswissdata` doit exister sur npmjs.com (créer org gratuite si besoin avant `npm publish`).

### 0.2 Rendre le repo GitHub public

État actuel : `cammac-creator/openswissdata` est **PRIVATE**. mcp.so / Smithery / Glama refusent les repos privés (auto-scan impossible).

```bash
gh repo edit cammac-creator/openswissdata --visibility public --accept-visibility-change-consequences
```

À considérer avant de toggle public :
- Vérifier qu'aucun secret ne traîne dans l'historique git (`git log -p | grep -iE "key|token|secret"` rapide check)
- Le `.gitignore` exclut bien `data/` et `.env*` (à reconfirmer)
- Les ETL scripts ne contiennent pas de creds en dur

### 0.3 Bonus — corriger le compte de tools dans le README du SDK

Le README `sdks/mcp-server/README.md` ligne 16 dit "8 tools" — c'est faux. Le serveur HTTP en expose **9** (`statent_lookup` a été ajouté). Comme le standalone proxy fait `tools/list` au remote, il expose les 9 quoi qu'il arrive — mais le marketing texte est désynchro.

Patch : remplacer `8 tools` par `9 tools` dans :
- `sdks/mcp-server/README.md` (ligne 16)
- `sdks/mcp-server/src/server.ts` commentaire ligne 10

---

## 1. Métadonnées canoniques (à recopier dans tous les forms)

| Champ | Valeur |
|---|---|
| **Name (slug machine)** | `openswissdata-mcp` |
| **Reverse-DNS name (registry MCP officielle)** | `com.openswissdata/mcp` |
| **Title (affiché)** | OpenSwissData |
| **Tagline (≤ 60 chars)** | Swiss federal datasets for AI agents (TARES + FINMA + NOGA) |
| **Short description (≤ 120 chars)** | Lookup Swiss customs tariffs, FINMA-supervised entities and NOGA codes from Claude/Cursor/Cline via 9 MCP tools. |
| **Long description (~200 mots)** | Voir bloc ci-dessous |
| **Repo URL (public)** | `https://github.com/cammac-creator/openswissdata` (sous-dossier `sdks/mcp-server/`) |
| **npm package** | `@openswissdata/mcp` |
| **Install command** | `npx -y @openswissdata/mcp` |
| **Homepage** | `https://www.openswissdata.com` |
| **Docs** | `https://www.openswissdata.com/mcp` (à confirmer — la page existe-t-elle ?) |
| **Remote endpoint (HTTP)** | `https://www.openswissdata.com/mcp/jsonrpc` (sous-domaine `mcp.openswissdata.com` réservé, DNS pending) |
| **Author** | Claude-Alain Martin |
| **Author email (public)** | `contact@openswissdata.com` |
| **License** | Apache-2.0 |
| **Tags / Keywords** | `swiss`, `federal`, `datasets`, `customs`, `compliance`, `tares`, `finma`, `noga`, `nace`, `kyc`, `tariff`, `regulatory` |
| **Logo / OG image** | À fournir (vérifier `/public/og-image.png` ou équivalent) |
| **Categories** | Government Data, Compliance, Finance, Search |
| **Transport(s)** | STDIO (via npm) + HTTP/JSON-RPC (remote) |
| **Auth** | Anonymous (~100 req/jour/IP) ou Bearer `OPENSWISSDATA_API_KEY` |
| **Node version** | `>=18` |

### Long description (~200 mots)

```
OpenSwissData is a Model Context Protocol (MCP) server that exposes the Swiss
federal open-data ecosystem — TARES customs tariffs (BAZG), the FINMA registry
of supervised financial entities and the FINMA warnings list, NOGA 2008/2025
industry classifications, and the NACE 2.0/2.1 ↔ ISIC 4 cross-walks — as
agent-callable tools.

Drop it into Claude Desktop, Cursor, Cline or any MCP-aware client and your
agent gains 9 typed tools: tariff_lookup, tariff_semantic_search,
tariff_changelog, classify_text, cross_walk, kyc_check, finma_search,
entity_history, statent_lookup. No scraping, no copy/paste, no broken
xtares.admin.ch HTML — just JSON results with mandatory non-official
disclaimers preserved verbatim in the text content (so the agent surfaces them
to the end user before any customs or KYC decision).

Anonymous tier (~100 req/day/IP) works out of the box. Bring an
OPENSWISSDATA_API_KEY for higher quotas, semantic search and historical
changelog tools (Pro tier). Built on the MCP 2025-06-18 spec, Apache-2.0
licensed, runs as a 4 MB STDIO bridge to the openswissdata.com remote — no
backend deployment needed on the user side.

Non-official mirror of public Swiss government datasets. Final decisions
always go back to xtares.admin.ch / finma.ch.
```

### Short install snippet (Claude Desktop)

```json
{
  "mcpServers": {
    "openswissdata": {
      "command": "npx",
      "args": ["-y", "@openswissdata/mcp"],
      "env": {
        "OPENSWISSDATA_API_KEY": "sk_live_..."
      }
    }
  }
}
```

---

## 2. Liste des 9 tools (descriptions one-liner pour les forms)

Source : `src/mcp/tools/*.ts` (descriptions extraites verbatim, langue : EN).

| # | Tool name | Tier | Description (verbatim from code) |
|---|---|---|---|
| 1 | `tariff_lookup` | Free | Lookup a Swiss customs tariff (HS8) and return the full TARES row including MFN duty, preferential regimes, restrictions and customs relief codes. Always returns a non-official disclaimer that the agent must surface to the end user. |
| 2 | `kyc_check` | Free | Search the FINMA registry of supervised entities and the FINMA warnings list by name. Returns up to top_k authorised entities + any matching warning entries. Use this for basic counterparty KYC screening. |
| 3 | `cross_walk` | Free | Translate an industry classification code between schemes (NOGA 2008/2025, NACE 2.0/2.1, ISIC 4). Returns all mappings with their type (exact, partial, aggregated, derived) and notes. |
| 4 | `tariff_semantic_search` | Pro | Semantic search across Swiss customs tariff (TARES) descriptions in French. Uses pre-computed Xenova/paraphrase-multilingual-mpnet-base-v2 embeddings (768d, FR) shipped with the TARES Pro bundle. Returns top-K HS8 codes by cosine similarity. Always inlines a non-official disclaimer. |
| 5 | `classify_text` | Pro | Classify a free-text business description into top-K NOGA 2025 codes with confidence scores. Uses pre-computed Xenova/paraphrase-multilingual-mpnet-base-v2 embeddings (768d, FR). NACE 2.1 mode falls back to NOGA 2025 in v1 — combine with cross_walk for translation. |
| 6 | `finma_search` | Free | Fuzzy search the FINMA registry by name (tolerates typos and legal-suffix variants like 'UBS Switzerland AG' vs 'UBS AG'). Returns top-K matches with confidence score, including LEI/UID where available. Set include_warnings=true to also surface entries from the FINMA warnings list. |
| 7 | `tariff_changelog` | Pro | Returns the historical changelog of MFN duty rates (and adjacent fields) for a Swiss customs tariff (HS8) code. Window: rolling 12-24 months. Irreplicable by scraping — xtares.admin.ch only serves the current version. |
| 8 | `entity_history` | Pro | Returns the timeline of changes for a FINMA-supervised entity (registration, authorisation type changes, status mutations, address moves, warning-list flag transitions). Keyed by Swiss UID (CHE-xxx.xxx.xxx). Irreplicable by scraping — finma.ch only publishes the current state. |
| 9 | `statent_lookup` | Pro | Swiss enterprise statistics (STATENT, BFS) for a NOGA 2-digit division and optional canton. Returns count of establishments, jobs, and full-time equivalents (FTE). 2023 data. Always inlines a BFS attribution disclaimer. |

---

## 3. `server.json` — registry MCP officielle (à publier en priorité)

**Le plus important des 5 livrables.** Le registry officiel `registry.modelcontextprotocol.io` est aujourd'hui la source de vérité pour les clients MCP (Claude Code, Cursor, Cline lisent depuis l'API `https://api.anthropic.com/mcp-registry/v0/servers`). Schema : https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json

Créer un fichier `server.json` à la racine du repo (ou dans `sdks/mcp-server/`) :

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
  "name": "com.openswissdata/mcp",
  "title": "OpenSwissData",
  "description": "Lookup Swiss customs tariffs (TARES), FINMA-supervised entities, and NOGA/NACE/ISIC industry codes from any MCP client. 9 tools, non-official mirror of Swiss federal open data.",
  "version": "0.1.0",
  "websiteUrl": "https://www.openswissdata.com",
  "repository": {
    "url": "https://github.com/cammac-creator/openswissdata",
    "source": "github",
    "subfolder": "sdks/mcp-server"
  },
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "@openswissdata/mcp",
      "version": "0.1.0",
      "transport": "stdio",
      "runtimeHint": "npx",
      "environmentVariables": [
        {
          "name": "OPENSWISSDATA_API_KEY",
          "description": "Optional Bearer token for higher quotas / Pro tools. Anonymous tier works without it (~100 req/day/IP).",
          "required": false,
          "secret": true
        },
        {
          "name": "OPENSWISSDATA_BASE_URL",
          "description": "Override the remote MCP endpoint (default: https://mcp.openswissdata.com). Useful for staging or self-hosting.",
          "required": false,
          "default": "https://mcp.openswissdata.com"
        },
        {
          "name": "OPENSWISSDATA_TIMEOUT_MS",
          "description": "Per-request timeout in milliseconds.",
          "required": false,
          "default": "30000"
        }
      ]
    }
  ],
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://www.openswissdata.com/mcp/jsonrpc"
    }
  ],
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "tags": ["swiss", "federal", "tares", "finma", "noga", "compliance", "tariff", "kyc"],
      "categories": ["government", "compliance", "finance"]
    }
  }
}
```

### Publier sur le registry officiel

```bash
# 1. Cloner et builder le publisher CLI (one-time)
git clone https://github.com/modelcontextprotocol/registry.git /tmp/mcp-registry
cd /tmp/mcp-registry
make publisher

# 2. Authentification — DNS verification recommandée pour un namespace custom (com.openswissdata)
# DNS verification = ajouter un TXT record sur openswissdata.com
./bin/mcp-publisher login --method dns --domain openswissdata.com
# Suivre les instructions (TXT record à ajouter via Vercel DNS)

# 3. Publier
cd /Users/claude-alainmartin/openswissdata
./bin/mcp-publisher publish --file ./server.json
```

> Alternative auth : `--method github-oauth` si tu veux publier sous le namespace `io.github.cammac-creator/openswissdata` (plus simple, pas de DNS à toucher) — mais le namespace `com.openswissdata` est plus pro pour le marketing.

**À vérifier avec Claude-Alain :** GitHub OAuth ou DNS verification ? Si DNS, vérifier accès au DNS de openswissdata.com (Vercel ?).

---

## 4. Form-by-form

### 4.1 Anthropic / registry MCP officielle ⭐ PRIORITÉ 1

- **URL** : https://registry.modelcontextprotocol.io
- **Pas de form web** — submission via CLI `mcp-publisher` (voir section 3 ci-dessus)
- **API d'enregistrement client** : `https://api.anthropic.com/mcp-registry/v0/servers` (lecture seule pour les clients)
- **Prérequis techniques** :
  - npm package publié (cf §0.1) ✅ blocker
  - Repo GitHub public (cf §0.2) ✅ blocker
  - `server.json` valide à la racine (fourni §3)
  - DNS verification ou GitHub OAuth pour le namespace
- **Champs requis** : déjà tous dans le `server.json` ci-dessus — c'est le moteur de la soumission.

### 4.2 Smithery.ai

- **URL submit** : https://smithery.ai/new
- **Type de submission** : URL-based (HTTPS publique) OU local MCPB bundle
- **Champs probables** (auto-scannés depuis l'URL) :
  - **URL serveur HTTPS** : `https://www.openswissdata.com/mcp/jsonrpc` ← à coller
  - Le reste (name, description, tools list) est extrait par auto-scan
- **Optionnel — server-card.json** : si l'auto-scan échoue, exposer un fichier statique à `/.well-known/mcp/server-card.json` :
  ```json
  {
    "serverInfo": {
      "name": "openswissdata-mcp",
      "version": "0.2.0"
    },
    "authentication": {
      "schemes": [
        { "type": "bearer", "description": "OPENSWISSDATA_API_KEY for Pro tier" }
      ]
    }
  }
  ```
- **À vérifier avec Claude-Alain :** **risque #1 — compatibilité transport.** Smithery dit "Streamable HTTP transport" (spec MCP avec headers `Mcp-Session-Id`, SSE optionnel). Le serveur HTTP openswissdata est documenté (`docs/mcp/README.md` ligne 142) comme un simple `POST /mcp/jsonrpc` sans SSE ni session resumption. Si l'auto-scan Smithery teste la conformité Streamable HTTP, il échouera. Plan B : utiliser le path "Local Publishing (MCPB Bundle)" en uploadant le tarball `@openswissdata/mcp` 0.1.0.
- **Plan B (MCPB bundle)** : `npm pack` dans `sdks/mcp-server/` → upload du `.tgz` via UI Smithery.
- **Whitelist WAF** : si tu utilises Cloudflare/Vercel WAF, autoriser le User-Agent `SmitheryBot/1.0` pour l'auto-scan.

### 4.3 mcp.so

- **URL** : https://mcp.so (front du repo `chatmcp/mcp-directory`)
- **URL submission** : `https://mcp.so/submit` retourne **403 Forbidden** au moment de la prep (06/05). Le repo GitHub `chatmcp/mcp-directory` n'expose pas de issue template ni de PR flow documenté.
- **Voies de submission identifiées** :
  1. UI bouton "Submit" sur https://mcp.so (à essayer après login GitHub)
  2. Telegram du mainteneur idoubi : https://t.me/+N0gv4O9SXio2YWU1
  3. Discord : https://discord.gg/RsYPRrnyqg
  4. Twitter/X : @chatmcp ou @idoubicv
- **Champs probables** (à confirmer une fois le form ouvert) — coller depuis §1 :
  - Name : `OpenSwissData`
  - GitHub repo : `cammac-creator/openswissdata`
  - npm : `@openswissdata/mcp`
  - Description courte / longue : §1
  - Tags : `swiss, federal, tares, finma, noga, compliance`
  - Logo : à fournir (PNG carré ≥ 256×256)
- **À vérifier avec Claude-Alain :** ouvrir https://mcp.so en navigateur loggué GitHub pour découvrir le form réel, ou contacter idoubi via Discord.

### 4.4 Cursor directory

- **URL** : https://cursor.directory (community, pas officielle Cursor)
- **État** : **incertain qu'il y ait une section MCP servers dédiée** au moment de la prep — le site héberge surtout des `.cursorrules`. Cursor lit nativement les MCP servers depuis `~/.cursor/mcp.json` côté client, donc il n'y a pas forcément de "directory officiel Cursor".
- **À vérifier avec Claude-Alain :** ouvrir https://cursor.directory et confirmer qu'une section MCP existe + URL exacte du form. Si pas de section MCP → skip ce catalogue, l'install snippet pour Cursor est déjà dans le README.
- **Si une section MCP existe**, coller :
  - Name + tagline + short description (§1)
  - Install snippet (Cursor format, déjà documenté dans `sdks/mcp-server/examples/cursor-mcp.json`) :
    ```json
    {
      "mcpServers": {
        "openswissdata": {
          "command": "npx",
          "args": ["-y", "@openswissdata/mcp"],
          "env": {
            "OPENSWISSDATA_API_KEY": "sk_live_..."
          }
        }
      }
    }
    ```

### 4.5 Glama.ai

- **URL** : https://glama.ai/mcp/servers (bouton "Add Server" en haut)
- **Process** : auto-indexing depuis GitHub repo public — Glama scanne le repo pour extraire metadata, tools, README. Ils ont 22 902 servers indexés.
- **Prérequis** :
  - Repo GitHub public (cf §0.2) ✅ blocker
  - README à la racine du sous-dossier `sdks/mcp-server/` (déjà OK ✅)
  - Dockerfile recommandé (déjà présent ✅ — `sdks/mcp-server/Dockerfile`)
- **Champs (form web "Add Server")** — coller depuis §1 :
  - GitHub URL : `https://github.com/cammac-creator/openswissdata` (Glama acceptera-t-il le sous-dossier ? À tester — sinon, soumettre l'URL `https://github.com/cammac-creator/openswissdata/tree/main/sdks/mcp-server`)
  - Name : `OpenSwissData MCP`
  - Short description : §1 short description
  - Long description : §1 long description
  - Tags : §1 tags
- **À vérifier avec Claude-Alain :** Glama supporte-t-il les monorepos avec MCP server en sous-dossier ? Si oui, fournir l'URL `tree/main/sdks/mcp-server`. Sinon, créer un repo GitHub miroir dédié `openswissdata-mcp` qui ne contient que `sdks/mcp-server/`.

---

## 5. Récap "À vérifier avec Claude-Alain"

Liste consolidée de tout ce que je n'ai pas pu confirmer depuis le code seul :

1. **PUBLIER npm `@openswissdata/mcp` (blocker)** — la org `@openswissdata` existe-t-elle sur npmjs.com ? `npm publish --access public` depuis `sdks/mcp-server/`.
2. **PUBLIC `cammac-creator/openswissdata` (blocker)** — audit secrets dans l'historique git avant le toggle.
3. **Auth registry MCP officielle** — GitHub OAuth (namespace `io.github.cammac-creator/openswissdata`) ou DNS verification (namespace `com.openswissdata/mcp`, plus pro) ?
4. **Page docs MCP** — `https://www.openswissdata.com/mcp` existe-t-elle déjà ? À mettre dans le champ `homepage`/`docs` des forms.
5. **Logo OpenSwissData** — fichier carré ≥ 256×256 PNG dispo ? Plusieurs forms le demanderont.
6. **Compatibilité Smithery Streamable HTTP** — l'endpoint `mcp.openswissdata.com/jsonrpc` passe-t-il l'auto-scan Smithery ? Si non, plan B : MCPB bundle.
7. **mcp.so submission flow** — ouvrir https://mcp.so en GitHub login pour découvrir le form réel, ou DM idoubi via Discord/Telegram.
8. **Cursor directory MCP section** — existe ou pas ? Si non, skip.
9. **Glama monorepo support** — GitHub URL avec `tree/main/sdks/mcp-server` accepté ?
10. **Sous-domaine `mcp.openswissdata.com`** — DNS pending d'après le README ; pour l'instant utiliser `www.openswissdata.com/mcp/jsonrpc` partout.
11. **README desync 8 vs 9 tools** — patcher `sdks/mcp-server/README.md` ligne 16 et `sdks/mcp-server/src/server.ts` ligne 10 avant de publier le repo public.
12. **Email de contact** — `contact@openswissdata.com` est-il routé vers une boîte qu'Alain check ? Plusieurs catalogues envoient des notifications.

---

## 6. Ordre de soumission recommandé

Une fois §0 réglé (npm publish + repo public) :

1. **Registry MCP officiel** — le plus stratégique (alimente Claude Code/Desktop directement). 30 min.
2. **Glama.ai** — auto-scan instantané dès que le repo est public. 5 min.
3. **Smithery.ai** — tester URL-based d'abord, plan B MCPB si échec. 15 min.
4. **mcp.so** — DM idoubi si pas de form public. Variable.
5. **Cursor directory** — confirmer existence avant. 10 min ou skip.

Total estimé hors blockers : **~1h-1h30**.

---

*Fichier généré 2026-05-06 par exploration du code (`sdks/mcp-server/`, `src/mcp/`, `docs/mcp/`) + WebFetch des pages publiques. Toute info marquée "À vérifier" n'a pas pu être confirmée depuis le code seul.*
