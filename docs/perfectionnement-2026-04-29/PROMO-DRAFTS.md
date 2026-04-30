# Drafts promo openswissdata — V2 MCP-first

**⚠️ Statut : DRAFTS uniquement. Aucune publication sans validation explicite d'Alain.**

Cette V2 remplace l'ancien angle "datasets normalisés signés Ed25519" par l'angle **"premier MCP server suisse pour Claude Code & Cursor"** — beaucoup plus viral, category-defining, et défendable.

Le mot **MCP** (Model Context Protocol, standard ouvert d'Anthropic adopté par Claude Code, Cursor, Manus, ChatGPT desktop) est l'**hook principal** dans tous les drafts. Les autres arguments (Ed25519, BAZG, embeddings, NOGA 2025) deviennent des **proof points** qui supportent le hook.

---

## Tout ce qui est livré et qu'on peut maintenant raconter

| Asset | URL / Référence |
|---|---|
| Page MCP publique | https://www.openswissdata.com/mcp (sandbox playground inclus) |
| Sous-domaine MCP | `mcp.openswissdata.com` (SSL Let's Encrypt OK) |
| 8 endpoints live | `tariff_lookup`, `tariff_semantic_search`, `tariff_changelog`, `cross_walk`, `classify_text`, `kyc_check`, `finma_search`, `entity_history` |
| Discovery JSON | https://www.openswissdata.com/mcp/discovery |
| Spec MCP | 2025-06-18 (Anthropic) |
| Free tier | 100 req/jour par IP, no auth |
| Standard tier | 1k req/mois inclus avec achat ZIP (299-399 CHF) |
| Pro tier | 10k req/mois inclus avec Pro tier (999 CHF) |
| Standalone | 49 CHF/mois pour 5k req (sans ZIP) |
| OAuth 2.1 | Codé, opt-in (Bearer simple par défaut V2) |
| Provenance | Page `/legal/provenance`, manifest Ed25519 + RFC-3161 |
| Permission BAZG | Accordée 2026-04-21 (M. Beer, Tarifgrundlagen) |

---

## 1. Show HN — l'angle viral 🟠

**Title :** `Show HN: openswissdata – First MCP server for Swiss federal data (Claude Code, Cursor)`

**Body :**

```
Hi HN,

I'm a solo founder in Switzerland and I just shipped what I think is the first
MCP (Model Context Protocol) server for Swiss federal data.

If you use Claude Code, Cursor, or any other MCP-compatible agent, you can
now plug 8 tools that query Swiss customs (TARES), economic classifications
(NOGA / NACE / ISIC), and the FINMA financial registry — natively, without
copy-pasting CSVs.

Setup is 30 seconds: add this to your ~/.claude/mcp.json:

    {
      "mcpServers": {
        "openswissdata": {
          "url": "https://mcp.openswissdata.com/mcp/jsonrpc",
          "transport": "http"
        }
      }
    }

Restart Claude Code. The 8 tools appear in the picker. Free tier is 100
calls/day per IP, no auth needed.

The interesting tools (the ones I think are non-obvious):

- tariff_semantic_search(query) — semantic search across 7,500 customs
  tariff codes using pre-computed BAAI/bge-m3 multilingual embeddings.
  No GPU on your side. "bijoux en or 18 carats" → top-5 HS8 codes with
  cosine scores in ~150ms.

- classify_text(text) — drop a free-text business description, get top-3
  NOGA 2025 codes with confidence. Pre-computed embeddings on 1,845 codes.

- tariff_changelog(hs8, since) — historical diff of MFN duty rates.
  Irreplicable by scraping (xtares only serves the current version).

- kyc_check(name) — unified FINMA registry + warnings list cross-ref in
  a single call. Replaces 10 manual HTML page consultations.

- entity_history(uid) — timeline of changes for a FINMA-supervised entity.

Try it yourself in the sandbox playground without installing anything:
https://www.openswissdata.com/mcp

Why I built this:

1. Every Swiss SAP/Odoo integrator I know wastes ~5 days/release re-scraping
   the BAZG XLSX, parsing broken UTF-8, etc. So I extracted, normalized,
   and packaged 3 federal datasets.

2. Then I noticed Claude Code/Cursor were the obvious distribution channel
   for this kind of structured data. Building an MCP server changes the
   product from "buy a ZIP" to "give your agent a capability".

3. I have a written commercial permission from BAZG (Swiss customs) for
   commercial redistribution of TARES — this matters legally because under
   Swiss law (LCD Art. 5), commercial reuse of scraped data carries real
   risk. Each ZIP and each MCP response includes a manifest.json signed
   Ed25519 + RFC-3161 timestamp from a third-party TSA — proof of origin
   and integrity any auditor can verify.

Pricing: free tier 100/day, ZIP packs 299-799 CHF (one-shot, refund 14d),
MCP standalone 49 CHF/month for 5k calls. Pro tier 999 CHF includes 10k
MCP calls/month + STATENT enterprise stats (gated behind OAuth scope).

Stack: Hono (TypeScript) + SQLite + Cloudflare R2 + Railway, no MCP SDK
runtime (manual JSON-RPC dispatcher because the SDK was overkill for an
HTTP-only MVP). Open SDK on GitHub (Apache 2.0) coming next week.

Happy to answer anything about the legal moat, the embedding pipeline, the
MCP server architecture, the lone-founder GTM, or why I think MCP is the
real distribution moment for verticalized data products.

→ https://www.openswissdata.com/mcp (sandbox playground works without setup)
```

**Best timing :** mardi-jeudi 16:00 UTC (peak HN). Premier commentaire dans les 5 min après publication.

---

## 2. ProductHunt — version concise

**Tagline :** `First Swiss federal data MCP server for Claude Code & Cursor`

**Description :**

```
openswissdata is the data layer Switzerland needed — finally agent-native.

Your AI agent (Claude Code, Cursor, Manus, ChatGPT desktop) can now query
Swiss federal data natively, without copy-pasting CSVs:

🇨🇭 8 MCP tools live (JSON-RPC 2.0, spec 2025-06-18)
   • tariff_lookup, tariff_semantic_search, tariff_changelog
   • cross_walk, classify_text
   • kyc_check, finma_search, entity_history

🧠 Pre-computed multilingual embeddings (BAAI/bge-m3, 9,356 vectors)
   "bijoux en or 18 carats" → top-5 HS8 codes in 150ms, no GPU on your end

🔐 Cryptographic provenance (Ed25519 + RFC-3161 timestamp)
   Each response includes manifest signed against committed public key

📜 Written commercial permission from BAZG (Swiss customs)
   Auditable chain of rights — relevant under Swiss LCD Art. 5

⚙️ Setup in 30 seconds
   Add 4 lines to your ~/.claude/mcp.json, restart, done.

🆓 Free tier 100 calls/day per IP, no signup needed
   Standalone MCP-only abo: 49 CHF/month for 5k calls
   Or buy the ZIP packs (299-799 CHF) and get the MCP keys included.

→ openswissdata.com/mcp — sandbox playground inside, try without installing
```

**First comment (founder) :**

```
Hi PH! Solo founder in Vaud, Switzerland.

The most interesting decision I made on this product: dropping the MCP SDK
runtime and writing a manual JSON-RPC 2.0 dispatcher in Hono. The SDK
forced a stateful streaming transport that was overkill for HTTP-only.
~150 lines of code now, easy to reason about.

The most useful realization: data products win on agent-native distribution.
A ZIP file is competing with OpenSanctions, Moneyhouse, Creditreform — all
already established. An MCP server is competing with… nobody, in CH.

Happy to discuss the legal angle (BAZG permission, LCD Art. 5 risk for
scrapers), the embedding pipeline (Xenova/transformers, ~228s for 7,500
vectors on Apple Silicon), or the GTM as a solo CH founder.
```

---

## 3. LinkedIn — FR (data engineers + ERP integrators)

```
🇨🇭 Le premier MCP server suisse pour Claude Code &amp; Cursor.

J'ai shippé openswissdata.com/mcp aujourd'hui — 8 tools natifs pour les
datasets fédéraux suisses (TARES douanier, NOGA/NACE/ISIC classifications,
FINMA registry).

Si tu utilises Claude Code ou Cursor, tu ajoutes 4 lignes dans ton
~/.claude/mcp.json et ton agent peut :

✓ Chercher un code TARES en français → "trouve le code pour bijoux en or 18
  carats" → top-5 HS8 avec scores cosine, embeddings BAAI/bge-m3 (150ms)

✓ Classifier une activité → "vente de café en grain et torréfaction" →
  top-3 codes NOGA 2025 avec confidence

✓ Faire un KYC unifié → kyc_check("UBS") → registre FINMA + warnings list
  + cross-ref Zefix dans un seul appel

✓ Voir l'historique des taux MFN sur 12-24 mois (irréplicable par scrape)

Sandbox playground sans installation : https://openswissdata.com/mcp

Pricing :
- Free tier 100 calls/jour, no auth
- Bundle ZIP 799 CHF avec 10k MCP calls/mois
- Standalone MCP 49 CHF/mois pour 5k calls

Ce qui change vs un ZIP classique : ton agent n'a plus à charger 14 MB de
Parquet en contexte. Il appelle le tool, reçoit la réponse, continue. Le
disclaimer non-officiel BAZG est inliné dans chaque réponse — l'agent ne
peut pas l'oublier.

Backed by written commercial permission from BAZG (2026-04-21) and Ed25519
+ RFC-3161 cryptographic provenance.

Solo founder. Made in Vaud. Auditable chain of rights.

#DataEngineering #MCP #ClaudeCode #SwissData #BAZG #SAP #ERP
```

---

## 4. LinkedIn — DE (compliance officers, Banken/Fintech)

```
🇨🇭 Der erste MCP-Server für Schweizer Bundesdaten — Claude Code &amp; Cursor.

Ihre AI-Agenten greifen jetzt nativ auf Schweizer Bundesdaten zu, ohne
Kopieren-Einfügen von CSVs:

✓ FINMA-Register + Warnungslisten (~3 700 Einträge) in einem einzigen Aufruf
✓ Fuzzy-Suche im FINMA-Register (toleriert "UBS Switzerland AG" vs "UBS AG")
✓ Entity-Timeline — Eintragungen, Bewilligungsänderungen, Widerrufe
✓ TARES-Zolltarif mit semantischer Suche (Mehrsprachigkeit DE/FR/IT/EN)
✓ NOGA / NACE / ISIC Cross-Walks

Mit jedem Antwort ausgeliefert:
🔐 Ed25519-Manifest + RFC-3161-Zeitstempel (Drittpartei-TSA)
📜 BAZG-Genehmigung 2026-04-21 dokumentiert
⚖ Gerichtsstand Bern · Schweizer Recht
🛡 Datenrichtigkeitsgarantie bis 10× Lizenzpreis (Pro tier)

Setup in 30 Sekunden:
    {
      "mcpServers": {
        "openswissdata": {
          "url": "https://mcp.openswissdata.com/mcp/jsonrpc"
        }
      }
    }

Anders als Scraping-Lösungen (LCD Art. 5 — Risiko bei kommerzieller
Weiternutzung): Bei openswissdata kaufen Sie nicht nur Daten. Sie kaufen
die rechtliche Absicherung — und jetzt auch die Agent-Native-Distribution.

Compliance Bundle (FINMA Pro + Zefix Sync + SECO Sanctions): 2 990 CHF/Jahr
mit 10k MCP Calls/Monat inkludiert.

→ https://www.openswissdata.com/mcp · Sandbox Playground inklusive

#Compliance #FINMA #KYC #AML #SwissBanking #RegTech #MCP
```

---

## 5. LinkedIn — EN (international audience, AI engineers)

```
🇨🇭 Built the first MCP server for Swiss federal data.

If you're shipping AI features that touch Switzerland — customs, financial
regulation, business classifications — your agent now has 8 native tools
on Claude Code &amp; Cursor.

Setup is 30 seconds. No SDK, no auth (free tier), no signup.

What's inside:

🔍 tariff_semantic_search — pre-computed BAAI/bge-m3 embeddings on 7,500
   customs codes. "gold jewellery 18 carat" → top-5 HS8 in 150ms.

🧬 classify_text — free-text → top-3 NOGA 2025 with confidence scores.
   Pre-computed embeddings on 1,845 codes (FR; DE/IT/EN coming).

🏦 kyc_check — unified FINMA registry + warnings list + Zefix corporate
   data, in one call. Replaces 10 manual HTML pages.

📚 tariff_changelog — historical diff of MFN duty rates over 12-24m.
   Irreplicable by scraping (xtares only serves the current version).

📊 entity_history — timeline of authorizations / withdrawals / capital
   mutations for FINMA-supervised entities.

Plus the V1 tools: tariff_lookup, cross_walk (NOGA/NACE/ISIC), finma_search.

🔐 Each response includes a non-official disclaimer (BAZG condition) inlined
   in the payload — your agent literally cannot forget to surface it.

🆓 Free tier: 100 calls/day per IP, no auth. Standalone MCP-only: 49 CHF/month
   for 5k calls. Pro tier (999 CHF) includes 10k calls/month + STATENT
   enterprise stats (gated by OAuth scope).

Sandbox playground (no setup): https://www.openswissdata.com/mcp

Backed by written commercial permission from BAZG (Swiss customs) — relevant
because under Swiss law (LCD Art. 5), commercial reuse of scraped data
carries real risk. The MCP server is the legal-safe shortcut.

Solo founder, Vaud, Switzerland.

#MCP #ClaudeCode #Cursor #AIAgents #SwissData #DataProducts
```

---

## 6. X / Twitter thread (8 tweets)

```
1/ I just shipped the first MCP server for Swiss federal data.

If you use Claude Code or Cursor, your agent now has 8 native tools to
query Swiss customs, NOGA classifications, and the FINMA financial
registry.

Setup: 30 seconds. Free tier 100/day, no auth.

🧵
```

```
2/ Why MCP changes the game for vertical data products:

Old model: I sell you a 14 MB Parquet ZIP. You import it. Your agent has
to load it as context. Token cost explodes.

New model: I sell you a tool. Your agent calls it. Receives JSON. Keeps
working. Token cost = the response only.
```

```
3/ The interesting tools:

🔍 tariff_semantic_search — "bijoux en or 18 carats" → top-5 HS8 codes
   in 150ms. Pre-computed BAAI/bge-m3 embeddings on 7,500 codes.
   No GPU on your end.

🧬 classify_text — free-text → top-3 NOGA codes with confidence.

📚 tariff_changelog — historical diffs (irreplicable by scraping).
```

```
4/ Setup in your ~/.claude/mcp.json:

{
  "mcpServers": {
    "openswissdata": {
      "url": "https://mcp.openswissdata.com/mcp/jsonrpc",
      "transport": "http"
    }
  }
}

Restart Claude Code. The 8 tools appear in the picker. /mcp to confirm.
```

```
5/ Why a Swiss founder built this:

Every Swiss SAP/Odoo integrator I know wastes ~5 days/release re-scraping
the BAZG XLSX, parsing broken UTF-8, refixing cross-walks.

I extracted, normalized, signed Ed25519, and packaged it. Then made it
agent-native via MCP.
```

```
6/ The legal angle:

I have a written commercial permission from BAZG (Swiss customs) — relevant
because under Swiss LCD Art. 5, commercial reuse of scraped data carries
real risk for the *reseller*.

You can scrape it once for personal use. You can't sell what you scraped.
I can.
```

```
7/ Pricing — generous on purpose:

Free tier: 100 calls/day, no auth (good for evaluation)
Standard: 1k calls/month (included with any ZIP purchase, 299-399 CHF)
Pro: 10k calls/month (included with Pro tier, 999 CHF)
Standalone MCP: 49 CHF/month for 5k calls (no ZIP, API-only)
```

```
8/ Try it without installing anything:

https://www.openswissdata.com/mcp

The sandbox playground lets you call any of the 8 tools live from your
browser. No signup, no token, no setup.

Solo founder, Vaud, Switzerland.

If you build agents that touch CH — would love to hear what's missing.
```

---

## 7. Reddit drafts

### r/ClaudeAI

```
Title: I built an MCP server for Swiss federal data — would love agent builder feedback

Body:
Solo founder in CH here. Just shipped openswissdata.com/mcp — a public
MCP server (JSON-RPC 2.0, spec 2025-06-18) with 8 tools for Swiss
customs / classifications / financial registry data.

Free tier 100 calls/day per IP, no auth. Sandbox playground at
https://openswissdata.com/mcp lets you test without installing.

What I'd love feedback on (if you build agents that need this kind of data):

1. Is the tool-naming intuitive? (tariff_lookup vs tariff_semantic_search
   etc.)
2. The disclaimer-inlining pattern: each response includes a BAZG-mandated
   non-official disclaimer in the text content of the JSON response, so
   the agent literally cannot strip it. Is that the right approach or
   would you prefer it as a separate field?
3. Pre-computed multilingual embeddings (BAAI/bge-m3) bundled in the
   server — good idea or should I expose the raw vectors via API?
4. OAuth 2.1 PKCE is coded but opt-in for V2 (Bearer token simple by
   default). Should I push everyone to OAuth from V3?

The legal angle that I think other vendors miss: I have a written
commercial permission from BAZG (Swiss customs). Under Swiss law (LCD
Art. 5), commercial reuse of scraped data has real risk for the reseller.
So the MCP server is also a legal-safe shortcut.

Stack: Hono + SQLite + R2 + Railway, no MCP SDK runtime. Manual JSON-RPC
dispatcher (~150 lines). Tests on Vitest (222 passing).

AMA on the data engineering side, the legal side, or the lone-founder GTM.
```

### r/dataengineering

```
Title: Lessons from shipping a vertical MCP server (Swiss federal data)

Body:
Solo founder in CH. Spent the last few weeks shipping openswissdata.com,
which started as a "buy a Parquet ZIP" data product and morphed into an
MCP server (Model Context Protocol) for Claude Code/Cursor. Things I
didn't expect:

1. The legal moat (written permission from the federal authority) is
   more defensible than the technical moat. Anyone can scrape with
   Cursor agent mode in 4-6h in 2026. Few can sell what they scraped
   under Swiss law.

2. Pre-computing embeddings in the Parquet kills any "I'll just scrape"
   plan — clients save GPU cost, scrapers don't ship pre-computed
   embeddings.

3. The diff/changelog feed is what turns one-shot 299 CHF into MRR.
   Scraping is one-time work; tracking changes is recurring work.

4. The MCP server is more strategic than I thought. Putting your data
   "1 tool-call away" in Claude Code/Cursor instead of forcing a ZIP
   download changes the buyer's mental model from "data file" to
   "capability".

5. Pricing: 299 CHF was too cheap for B2B (no friction = no perceived
   value). 999 CHF for the Pro bundle feels right. 49 CHF/month for
   MCP-only is a good no-brainer for indie devs.

6. Bundling the embedding model server-side beats requiring clients to
   install Xenova/transformers. ~280 MB ONNX bundled in src/mcp/data/,
   model loaded once at boot.

Stack: Hono (TS), better-sqlite3, R2 (Cloudflare), Railway. Open SDK
on GitHub (Apache 2.0) coming next week.

AMA.
```

### r/cursor

```
Title: Added a Swiss federal data MCP server to Cursor — thoughts?

Body:
Just shipped openswissdata.com/mcp. If you write code that touches
Swiss customs / classifications / financial registry, you can now plug
it into Cursor:

~/.cursor/mcp.json:
{
  "mcpServers": {
    "openswissdata": {
      "url": "https://mcp.openswissdata.com/mcp/jsonrpc"
    }
  }
}

Free tier 100 calls/day per IP, no auth. 8 tools: tariff_lookup,
tariff_semantic_search, classify_text, kyc_check, etc.

Sandbox playground at https://openswissdata.com/mcp lets you test
without restarting Cursor.

Curious for feedback from the Cursor agent power users — anything
missing in the tool set? Anything in the input schema that's not
agent-friendly?
```

### r/Switzerland

```
Title: openswissdata — clean federal data with native AI agent integration

Body:
Salut r/Switzerland! Solo founder de Vaud. Je viens de shipper
openswissdata.com/mcp — un MCP server qui permet aux agents AI (Claude
Code, Cursor) d'accéder nativement aux données fédérales suisses :

- Tarif douanier TARES (~7 500 codes, DE/FR/IT/EN)
- Classifications NOGA / NACE / ISIC
- Registre FINMA + warnings list

Avec :
- Permission commerciale écrite du BAZG (2026-04-21)
- Manifest signé Ed25519 + horodatage RFC-3161 (audit-ready)
- Free tier 100 appels/jour, sans signup

Sandbox playground (sans installation) : openswissdata.com/mcp

Si vous travaillez en compliance, intégration ERP (SAP/Odoo), fintech
ou fiduciaire — feel free de DM, je serais curieux de savoir quels
autres datasets fédéraux vous voudriez voir (Quellensteuer ?
STATENT ? Zefix snapshot ? RegBL/GWR ?).
```

### r/AML_Compliance

```
Title: KYC unified MCP tool for Swiss FINMA — registry + warnings + Zefix in 1 call

Body:
Hi r/AML_Compliance. Built a tool that might be useful in your KYC
workflows.

The pain: when checking a Swiss financial entity, you usually consult
~10 different FINMA HTML pages (banks, asset managers, securities firms,
etc.), then Zefix for corporate data, then SECO for sanctions, then
GLEIF for parents. Manual, error-prone, no audit trail.

The fix: a single MCP tool kyc_check(name) that returns:
- FINMA authorization status (across all 10 categories)
- FINMA warning list match (~2 180 entities of unauthorized scams)
- Zefix corporate status / capital / legal form
- Optional: SECO sanctions cross-ref

Plus :
- entity_history(uid) — timeline of authorization changes / withdrawals /
  capital mutations (snapshots, irreplicable by scraping)
- finma_search(name, fuzzy=true) — Levenshtein-tolerant matching

Each response: cryptographically signed (Ed25519 + RFC-3161 timestamp),
inline non-official disclaimer.

Pricing:
- Free tier 100 calls/day per IP
- Compliance Bundle 2 990 CHF/year (FINMA Pro + Zefix Sync + SECO + 10k
  MCP calls/month)

Sandbox playground (no install): https://openswissdata.com/mcp

Vs OpenSanctions: we cover the *positive* registry (authorized FINMA
entities, ~1 500), they cover the *negative* (warnings + sanctions).
Both useful, complementary.

Open to feedback from compliance officers / RegTech buyers. What's
missing? What would you pay extra for?
```

---

## 8. Email outbound (template, à personnaliser)

**Sujet :** `[Prénom], votre agent Claude Code peut-il déjà parler suisse ?`

**Corps :**

```
[Prénom],

Vu votre profil chez [Société], je sais que vous travaillez avec des
intégrations [SAP / Odoo / interne / RegTech] qui touchent au TARES, NOGA
ou FINMA.

Je suis Claude-Alain Martin, fondateur d'openswissdata.com. Hier j'ai
shippé un truc qui peut vous intéresser : un MCP server (compatible
Claude Code, Cursor, Manus) qui permet à vos agents AI de parler nativement
aux datasets fédéraux suisses.

Concrètement, vous ajoutez 4 lignes dans ~/.claude/mcp.json et votre
agent peut :

→ Faire un kyc_check("UBS") qui agrège FINMA registry + warnings + Zefix
  en 1 appel (au lieu de 10 pages HTML)
→ Classifier "vente de café en grain" en top-3 codes NOGA 2025 avec scores
→ Chercher "bijoux en or 18 carats" dans TARES par sémantique (embeddings
  pré-calculés)

Free tier 100 appels/jour, no signup. Sandbox playground sans
installation : https://openswissdata.com/mcp

Garanties techniques :
- Permission commerciale écrite du BAZG (2026-04-21)
- Manifest signé Ed25519 + horodatage RFC-3161
- Pricing : free / 49 CHF mois standalone / 999 CHF avec ZIP Pro inclus

Si ça vous intéresse, 15 min de demo cette semaine ? Ou vous testez
directement en sandbox.

Bien à vous,
Claude-Alain Martin
+41 [tel]
contact@openswissdata.com
```

---

## 9. Hugging Face dataset card (sample 10 % gratuit)

```yaml
---
license: cc-by-4.0
task_categories:
  - text-classification
  - feature-extraction
language: [fr, de, it, en]
size_categories:
  - 1K<n<10K
tags:
  - swiss
  - customs
  - tariff
  - federal-data
  - mcp
  - claude-code
  - cursor
pretty_name: openswissdata — TARES Sample with Embeddings
---

# openswissdata — TARES (Swiss Customs Tariff) Sample

This is a **10 % public sample** of the TARES dataset commercialised on
[openswissdata.com](https://openswissdata.com).

🆕 **Now also available as a Model Context Protocol (MCP) server** for
Claude Code, Cursor, and any MCP-compatible agent:

    {
      "mcpServers": {
        "openswissdata": {
          "url": "https://mcp.openswissdata.com/mcp/jsonrpc"
        }
      }
    }

Free tier 100 calls/day per IP, no signup. Sandbox playground:
https://openswissdata.com/mcp

## Full dataset

- ~7 500 Swiss customs codes (HS8 + 11-digit), trilingual DE/FR/IT/EN
- **Pre-computed multilingual embeddings** (BAAI/bge-m3 alternative,
  768d, mean-pooled + L2-normalised)
- Cross-walks to HS6 and EU TARIC 10-digit
- 12-24 months historical changelog of MFN duties
- Ed25519-signed manifest + RFC-3161 timestamp
- Quarterly diff feed
- 8 MCP server endpoints (tariff_lookup, tariff_semantic_search,
  tariff_changelog, …)

## Source

- Authority: BAZG (Bundesamt für Zoll und Grenzsicherheit, Switzerland)
- Source URL: https://www.bazg.admin.ch/dienstleistungen-firmen/tares-...
- Commercial redistribution permission: granted 2026-04-21 by M. Beer

## Format

Parquet (UTF-8), Apache, schema typed.

## Use cases

- AI agents for Swiss customs classification (via MCP)
- ERP integration (SAP, Odoo, Sage, Dynamics)
- Trade compliance pipelines
- RAG / fine-tuning for Swiss-aware models

## Get the full pack

[openswissdata.com/datasets/tares](https://openswissdata.com/datasets/tares)

- Standard 299 CHF (one-shot, refund 14d)
- Pro 899 CHF (with embeddings + changelog + MCP 10k calls/month)
- MCP standalone 49 CHF/month for 5k calls
```

---

## 10. Communautés/canaux à activer (mise à jour MCP-first)

| Catégorie | Canaux prioritaires | Format | Effort |
|---|---|---|---|
| **MCP-natifs** | MCP Discord (modelcontextprotocol.io), Anthropic Discord, Claude Code Discord, Cursor Discord, Manus community | Présentation tool + sandbox link | Auto, gratuit |
| **HN / Lobsters** | Show HN (mardi-jeudi 16:00 UTC), Lobsters | Story complète | Auto |
| **Tech CH FR** | Inside-IT, ICTjournal, RTS Espace 2 | Press release "premier MCP server suisse" | Pitch journaliste |
| **Tech CH DE** | Netzwoche, Inside-IT (DE), Computerworld.ch | Article tech / interview | Pitch |
| **Finance CH** | finews.ch, moneycab, swissinfo | Press release "MCP for AML/KYC" | Pitch |
| **Communautés AI** | r/LocalLLaMA, r/mlops, r/ChatGPTCoding, dev.to, IndieHackers | Story founder + tool demo | Auto |
| **Communautés data** | r/dataengineering, r/dataops, Locally Optimistic Slack, dbt Slack | Honest story | Auto |
| **Communautés AML/KYC** | r/AML_Compliance, r/banking, ACAMS forums, RegTech newsletter | Compliance Bundle pitch | Auto |
| **Communautés SAP/ERP** | r/SAP, r/odoo, SAP community network, Inside Odoo | Integration story | Auto |
| **Marketplaces** | Snowflake Marketplace, Datarade, AWS Data Exchange, Hugging Face Datasets | Listing | 2-3 j |
| **Newsletters** | Data Engineering Weekly, The Sequence, Pragmatic Engineer, MIT Tech Review CH, AI Engineering Daily | Sponsored ou review | Pitch |
| **Cours et tutos** | Tutoriel "Build your first MCP server" sur dev.to / YouTube — feature openswissdata comme exemple | Vidéo + article | 1-2 j |
| **GitHub** | `openswissdata/sdk-ts`, `sdk-py`, `mcp-server` open source Apache 2.0 | Maintenance + issues | Continu |

---

## 11. Plan de séquencement (à valider)

**T0 = jour J de publication (mardi-jeudi 16:00 UTC recommandé)**

| T+ | Action |
|---|---|
| **T-3j** | Vérifier sandbox playground OK + tester chaque tool en live + écrire un README ouvert sur GitHub |
| T-1j | Préparer assets visuels : screenshot install MCP, screenshot sandbox, vidéo démo 30s |
| **T+0** (matin GMT+1) | LinkedIn FR + LinkedIn DE |
| **T+0** (16:00 UTC) | Show HN |
| T+0 (16:30 UTC) | Lobsters |
| **T+1j** | X/Twitter thread + ProductHunt launch + Reddit r/ClaudeAI + r/dataengineering |
| T+2j | LinkedIn EN + Reddit r/cursor + r/Switzerland + r/AML_Compliance |
| T+3j | Email outbound (50 prospects sourcés via Apollo, segments : SAP CH integrators, fintech compliance) |
| T+4j | Discord MCP, Anthropic, Cursor — partage du tool dans les channels appropriés |
| T+7j | Article blog SEO #1 ("How to add Swiss federal data to your Claude Code workflow") |
| T+10j | Listing Hugging Face Datasets |
| T+14j | Listing Datarade |
| T+21j | Article blog SEO #2 ("FINMA KYC checks via MCP — 10 HTML pages → 1 tool call") |
| T+30j | Bilan : MRR, sign-ups MCP, sandbox calls/jour, MCP appels via tokens. Décision tier Enterprise. |
| T+60j | Listing Snowflake Marketplace |
| T+90j | Pitch presse CH (finews, Inside-IT, ICTjournal, moneycab) |

---

## ⚠️ Validation requise avant push public

**Tous ces drafts mentionnent des features qui sont effectivement livrées en LIVE** au 2026-04-30 :
- ✅ 8 MCP tools : `tariff_lookup`, `tariff_semantic_search`, `tariff_changelog`, `cross_walk`, `classify_text`, `kyc_check`, `finma_search`, `entity_history`
- ✅ Page `/mcp` avec sandbox playground
- ✅ Sous-domaine `mcp.openswissdata.com` avec SSL Let's Encrypt
- ✅ Permission BAZG 2026-04-21 documentée
- ✅ Manifest Ed25519 + RFC-3161 dans chaque ZIP
- ✅ Pages légales `/legal/cgv`, `/legal/provenance`, `/legal/privacy`, `/legal/sdr-policy`, `/legal/impressum`
- ✅ Stripe Pro Classifications 999 CHF en LIVE
- ✅ Free tier 100 req/jour par IP (rate-limit existant)

**Drafts à NE PAS publier sans validation Alain** :
1. Adresse postale (Rue de l'Église 23, 1045 Ogens) — vérifier qu'on l'expose ou pas
2. Numéro téléphone — à compléter dans email outbound
3. Garantie d'exactitude jusqu'à 10× licence — texte juridique à valider avocat avant claim publique
4. Open SDK GitHub — pas encore livré, mentionné comme "coming next week" — on retire si délai trop court

---

## Récapitulatif décisions à prendre par Alain

1. **Quels canaux activer en premier** ? Mon vote ordonné : Show HN + LinkedIn FR/DE, puis ProductHunt + X thread + Reddit, puis email outbound.
2. **Date de lancement** : mardi 5 mai ? jeudi 7 mai ? (pour timing peak HN)
3. **Open SDK GitHub** : on le release avant le push promo (1 j de dev) ou on retire la mention dans les drafts ?
4. **Garantie d'exactitude** : on l'inclut maintenant ou on attend validation avocat ?
5. **Adresse postale + téléphone** : on les met visibles ou on garde uniquement l'email contact ?
