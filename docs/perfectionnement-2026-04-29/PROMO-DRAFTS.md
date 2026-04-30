# Drafts promo openswissdata — multi-plateformes

**⚠️ Statut : DRAFTS uniquement. Aucune publication sans validation explicite d'Alain.**

**À publier UNE FOIS la Phase 0 (quick wins) implémentée et testée live.** Ces drafts mentionnent des features (embeddings, MCP server, FINMA warnings, manifest signé) qui n'existent pas encore en prod.

---

## 1. LinkedIn — FR (data engineers + ERP integrators)

```
🇨🇭 Le tarif douanier suisse, normalisé. En une commande.

$ npx @osd/cli pull tares
✓ Verified DKIM signature
✓ Pulled tares.parquet (7 524 rows, 1.4 MB, v1.0.0)

Si tu intègres SAP, Odoo ou Sage en Suisse, tu connais le rituel :
→ scraper le BAZG XLSX multi-onglets
→ parser, normaliser UTF-8
→ refaire à chaque mise à jour
→ tester (et casser à chaque release)

5 jours-homme par release. Multipliés par tes années d'intégration.

J'ai construit openswissdata pour qu'on n'ait plus jamais à le faire.

✓ TARES (~7 500 codes douaniers, DE/FR/IT, taux + cross-walks HS6/CN8)
✓ NOGA / NACE / ISIC (~3 800 codes 5-way, EN labels officiels)
✓ FINMA Registry (~1 500 entités + warnings list + Zefix sync)

Format : Parquet · JSON · SQL · UTF-8 · SHA-256 signé.
Permission commerciale BAZG accordée.
SDK TypeScript + Python.
MCP server pour Claude Code & Cursor.

299 CHF par dataset. 999 CHF le bundle 3-en-1.
Refund 14 jours. Mises à jour mensuelles incluses.

→ openswissdata.com

#DataEngineering #Switzerland #SAP #ERP #BAZG #OpenData
```

---

## 2. LinkedIn — DE (compliance officers, Banken/Fintech)

```
🇨🇭 Wenn das Audit klopft, haben Sie die Belege.

Schweizer regulatorische Datasets — kuratiert, signiert, versioniert.

✓ FINMA-Register (autorisierte Institute + Warnliste, ~3 700 Einträge)
✓ TARES Zolltarif (~7 500 HS-Codes, DE/FR/IT/EN)
✓ NOGA / NACE / ISIC (Klassifikationen mit STATENT-Join)

Mit jeder Lieferung:
🔐 Manifest mit Ed25519-Signatur + RFC-3161-Zeitstempel
📜 BAZG-Genehmigung 2026-04-21 dokumentiert
⚖ Gerichtsstand Bern · Schweizer Recht
🛡 Datenrichtigkeitsgarantie + Haftungsklausel bis 10× Lizenzpreis

Anders als Scraping-Lösungen (LCD Art. 5 — Risiko bei kommerzieller Weiternutzung):
Bei openswissdata kaufen Sie nicht nur Daten. Sie kaufen die rechtliche Absicherung.

Compliance Bundle (FINMA Pro + Zefix Sync + SECO Sanctions): 2 990 CHF/Jahr.

→ openswissdata.com

#Compliance #FINMA #KYC #AML #Switzerland #RegTech #BankingData
```

---

## 3. LinkedIn — EN (international audience)

```
🇨🇭 Swiss federal data, MCP-ready.

Stop scraping the BAZG XLSX. Stop parsing 10 different FINMA HTML pages.
Get a clean Parquet with cryptographic provenance, hooked into Claude Code natively.

openswissdata ships:
✓ Swiss customs tariff (TARES, ~7 500 codes, multilingual)
✓ Economic classifications (NOGA / NACE / ISIC, 5-way crosswalks, ~3 800 codes)
✓ FINMA registry + warnings list (~3 700 entities)

Each pack includes:
• Pre-computed multilingual embeddings (BAAI/bge-m3) → semantic search out of the box
• Ed25519-signed manifest + RFC-3161 timestamp → audit-ready
• Quarterly diff feeds → MRR sync, no full re-imports
• MCP server endpoints → tariff_lookup, classify_text, kyc_check natively in Claude Code & Cursor

Backed by a written commercial permission from BAZG (Swiss customs authority) and a data accuracy warranty up to 10× license fee.

299-799 CHF per pack. From the indie devs to enterprise compliance, one ZIP at a time.

→ openswissdata.com

#SwissData #MCPServer #ClaudeCode #DataProducts #Compliance
```

---

## 4. X / Twitter thread (dev-focus)

```
1/ Built openswissdata.com — a stripe-checkout for Swiss federal data.

TARES customs codes. NOGA/NACE/ISIC. FINMA registry.

ZIP it. Sign it. Diff it. Serve it via MCP.

299 CHF, refund 14 days. 🇨🇭

🧵
```

```
2/ Why this exists:

Every SAP/Odoo integrator in CH redoes the same scrape pipeline 5 times a year.

Multi-tab XLSX from BAZG. Broken UTF-8 from BFS. 10 different FINMA HTML pages.

5 days × 1200 CHF/day = 6 000 CHF per release. Per integrator. Forever.
```

```
3/ What's in the box:

✓ ~7 500 customs codes (TARES) trilingual + cross-walks HS6/CN8
✓ ~3 800 classification codes 5-way (NOGA 2008/2025 ↔ NACE 2.0/2.1 ↔ ISIC 4)
✓ ~3 700 FINMA entities (authorized + warnings list)

Format: Parquet · JSON · SQL · UTF-8 · SHA-256 + Ed25519 signed manifest.
```

```
4/ The fun part: pre-computed multilingual embeddings.

Each pack ships with BAAI/bge-m3 embeddings (768d, 4 langs).

You don't burn GPU cycles to vectorize HS codes — they're already in the Parquet.

Drop into your FAISS index, ship semantic search in 10 minutes.
```

```
5/ MCP server (Q3 2026):

mcp.openswissdata.com exposes:
• tariff_lookup(hs8, lang)
• tariff_semantic_search(query, top_k)
• classify_text(free_text) → top-3 NOGA codes
• kyc_check(name) → {finma, sanctions, zefix, lei}

Claude Code & Cursor users: just claim your MCP token after purchase.
```

```
6/ The moat against AI agents that "just scrape":

→ Written permission from BAZG (LCD Art. 5 risk for commercial scrapers)
→ Data accuracy warranty up to 10× license fee
→ Quarterly diff feeds (no agent re-builds historical changelog)
→ Cryptographic provenance (Ed25519 + RFC-3161)

You can scrape it once. You can't sell what you scraped.
```

```
7/ Pricing:

• TARES — 499 CHF
• Classifications — 499 CHF
• FINMA — 399 CHF (Basic) / 699 CHF (Pro) / 1290 CHF (+Zefix Sync)
• Bundle "Crosswalk Pack" — 999 CHF
• Compliance Bundle (FINMA Pro + Zefix + SECO) — 2 990 CHF/year

Refund 14 days. Open SDK. CC0 samples on Hugging Face.

→ openswissdata.com
```

---

## 5. Show HN draft

**Titre :** `Show HN: openswissdata.com – Swiss federal data with cryptographic warranty + MCP server`

**Body :**

```
Hi HN,

I'm a solo founder in Switzerland and I built openswissdata.com because every SAP/Odoo integrator I know wastes 5 days per release re-scraping the BAZG (Swiss customs), BFS (statistics), and FINMA (financial supervisor) websites. Federal data here is officially open, but in practice you get a 2400-page PDF, a multi-tab XLSX with broken UTF-8, and 10 different HTML pages that change schema every quarter.

So I extracted, normalized, and packaged 3 datasets that any Swiss-related backend needs:

- **TARES** — Swiss customs tariff (~7,500 codes, DE/FR/IT/EN, with HS6/CN8 cross-walks)
- **NOGA / NACE / ISIC** — economic classifications (5-way crosswalks, ~3,800 codes)
- **FINMA Registry** — authorized financial entities + warnings list (~3,700 entities)

Each pack ships:
- Parquet + JSON + SQL + CSV
- Pre-computed multilingual embeddings (BAAI/bge-m3, 768d) → drop into your vector store, save the GPU cost
- Ed25519-signed manifest + RFC-3161 timestamp + SHA-256 checksums → audit-ready
- A quarterly diff feed (the part nobody else sells)
- An MCP server (mcp.openswissdata.com, freemium 10 lookups/day) — exposes `tariff_lookup`, `classify_text`, `kyc_check` natively in Claude Code, Cursor, etc.

I have a **written commercial permission from BAZG** (the Swiss customs authority, granted 2026-04-21). This matters because under Swiss law (LCD Art. 5), commercial reuse of scraped data carries real risk for the *reseller*. So you can scrape it once for personal use, but you can't sell what you scraped. I can.

Pricing is 299-2990 CHF per pack/bundle, refund 14 days. The "Compliance Bundle" (FINMA Pro + Zefix Sync + SECO Sanctions) is 2990 CHF/year and undercuts OpenSanctions Reseller licensing significantly while staying CH-sovereign (data hosted in Frankfurt R2, billing CHF, French/German support).

Open SDK on GitHub (Apache 2.0): TypeScript + Python.

Happy to answer any question about the legal moat (it's the most interesting part), the embeddings approach, the MCP server architecture, or just the lone-founder go-to-market.

→ openswissdata.com
```

---

## 6. Reddit drafts

### r/dataengineering

```
Title: I built a Swiss customs data product because everyone re-scrapes it. Here's what I learned about pricing data products vs raw scraping.

Body:
Solo founder in CH here. Built a small data product (openswissdata.com) selling 3 normalized federal datasets (customs tariff, NACE/NOGA classifications, financial registry). Pricing 299-2990 CHF.

Things I didn't expect:
1. The legal moat (written permission from the federal authority) is more defensible than the technical moat (anyone can re-scrape in 6h with Cursor agent mode in 2026).
2. Pre-computing embeddings in the Parquet is the cheapest "agent-proof" feature — clients save GPU cost, scrapers don't ship them.
3. The diff/changelog feed is what turns one-shot 299 CHF into MRR. Scraping is one-time work; tracking what changed every month is recurring work.
4. MCP server is more strategic than I thought — it puts your data 1 tool-call away in Claude Code/Cursor instead of forcing the user to download a ZIP.
5. Pricing is tricky. 299 CHF was too cheap for B2B. 999 CHF feels right for the bundle. 2990 CHF for the compliance bundle is a no-brainer for any Swiss bank's RegTech budget.

AMA on the data engineering side, the legal side, or the lonely-founder GTM side.
```

### r/Switzerland

```
Title: I built openswissdata — clean federal data for SAP/Odoo integrators (CH-only, BAZG permission)

Body:
Hi r/Switzerland! Solo founder here from Vaud. I built openswissdata.com because I was tired of every Swiss developer / fiduciary integrator wasting days scraping the same BAZG XLSX, BFS PDF and FINMA HTML.

What it is:
- The Swiss customs tariff (TARES), normalized, in clean Parquet/JSON/SQL formats
- NOGA economic classifications + cross-walks to NACE/ISIC
- The FINMA register of authorized entities + warnings list

Why it matters:
- BAZG gave me written permission for commercial redistribution (2026-04-21)
- All deliverables are signed Ed25519 + RFC-3161 timestamp → audit-ready
- Pricing in CHF, billed to your Swiss raison sociale (SAP/Odoo OK for expense)

If you work in compliance, ERP integration, fintech, fiduciary services — feel free to DM, I'd love to know what other federal datasets you'd want next (Quellensteuer? STATENT? Zefix snapshot?).

→ openswissdata.com
```

### r/AML_Compliance / r/banking

```
Title: openswissdata — Swiss FINMA registry + warnings + Zefix sync, audit-ready, with cryptographic provenance

Body:
Hi! Sharing a tool I built that solves a specific Swiss compliance pain.

Problem: when you do KYC checks against Swiss financial entities, you need to consult ~10 different FINMA HTML pages, plus Zefix for the corporate body, plus SECO for sanctions, plus GLEIF for parent relationships. It's slow, error-prone, and you have no audit trail.

Solution: openswissdata.com Compliance Bundle (2990 CHF/year):
- FINMA registry unified (~3700 entities: authorized + warnings)
- Zefix sync via UID (organes, capital, status)
- SECO sanctions cross-reference
- GLEIF LEI Level 1+2 (parent / ultimate parent)
- Ed25519-signed manifest + RFC-3161 timestamp on every snapshot
- MCP server: `kyc_check(name) → {finma, sanctions, zefix, lei}` in 200ms
- 30-day delta feed

Vs OpenSanctions: we cover the *positive* registry (authorized FINMA entities, ~1500), they cover the *negative* (warnings + sanctions). Both useful, complementary.
Vs Moneyhouse / Creditreform: we focus on regulatory data, not credit/scoring.
Vs internal scraping: written BAZG permission + warranty + signed manifest = real audit trail.

Open to feedback from compliance officers / RegTech buyers. What's missing? What would you pay extra for?
```

---

## 7. ProductHunt launch

**Tagline :** `Swiss federal data with cryptographic warranty + MCP server`

**Description :**

```
openswissdata is the data product layer Switzerland needed.

Drop-in datasets for SAP/Odoo integrators, compliance officers, and AI engineers building Swiss-aware agents.

🇨🇭 3 federal datasets: TARES (customs), NOGA/NACE/ISIC (classifications), FINMA Registry
📦 Format: Parquet · JSON · SQL · CSV
🧠 Pre-computed multilingual embeddings (BAAI/bge-m3)
🔐 Ed25519-signed manifest + RFC-3161 timestamp + SHA-256
📜 Written commercial permission from BAZG (Swiss customs)
🔌 MCP server: `tariff_lookup`, `classify_text`, `kyc_check` in Claude Code & Cursor
💰 Pricing: 299-2990 CHF, refund 14 days
🛡 Backed by a data accuracy warranty up to 10× license fee

The first data product in Switzerland that combines:
- Cryptographic provenance
- Legal moat (LCD Art. 5)
- Agent-native distribution (MCP)
- Indie-friendly pricing

→ openswissdata.com
```

**First comment (founder) :**
```
Hi PH! Solo founder in Vaud, CH. Built this because I'm tired of seeing every Swiss-focused dev waste days on the same data pipeline.

The interesting parts (happy to discuss):
- The MCP server angle (Q3 2026): turning data products into agent capabilities
- The legal moat: BAZG permission + LCD Art. 5 means scrapers can't legally resell
- The pricing: 299-2990 CHF feels right for the indie/dev/SMB segment, leaves room for Enterprise (1990-4990) above

Coming soon: Quellensteuer (cantonal tax tariffs), STATENT join, Zefix Snapshot Pro, swissBOUNDARIES Pro.

Feedback welcome from anyone in CH compliance/data eng/ERP integration. AMA.
```

---

## 8. Email outbound (template, à personnaliser par cible)

**Sujet :** `[Prénom], 5 jours-homme par release ERP — économisés en CHF`

**Corps :**

```
[Prénom],

Vu votre profil chez [Société], je sais que vous gérez probablement l'intégration douanière / classification NOGA / compliance FINMA dans votre stack [SAP / Odoo / interne].

Je suis Claude-Alain Martin, fondateur d'openswissdata.com. Je vends 3 datasets fédéraux suisses normalisés (TARES, NOGA/NACE/ISIC, FINMA Registry) avec :

- Permission commerciale BAZG accordée le 2026-04-21
- Manifest signé Ed25519 + horodatage RFC-3161 (audit-ready)
- Updates mensuelles + diff feed (pas de re-scrape)
- SDK TypeScript + Python + MCP server pour Claude Code

Le bundle 3-en-1 est à 999 CHF. Le pack Compliance complet (FINMA + Zefix Sync + SECO) à 2 990 CHF/an.

Quelques chiffres :
- Économie typique : ~5 jours-homme par release ERP × 1 200 CHF/j = 6 000 CHF
- Refund 14 jours, paiement Stripe en CHF
- Facturation à votre raison sociale, OK pour expense SAP/Odoo

Si ça vous intéresse, 15 min de demo cette semaine ? Ou vous testez directement sur openswissdata.com.

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
language:
  - fr
  - de
  - it
  - en
size_categories:
  - 1K<n<10K
tags:
  - swiss
  - customs
  - tariff
  - federal-data
  - tares
  - bazg
  - finance
  - compliance
pretty_name: openswissdata — TARES Sample
---

# openswissdata — TARES (Swiss Customs Tariff) Sample

This is a **10 % public sample** of the full TARES dataset sold on [openswissdata.com](https://openswissdata.com).

The full dataset includes:
- ~7 500 Swiss customs codes (HS8 + 11-digit) trilingual DE/FR/IT/EN
- Pre-computed multilingual embeddings (`BAAI/bge-m3`, 768d)
- Cross-walks to HS6 and EU TARIC 10-digit
- 12-24 months historical changelog of MFN duties
- Ed25519-signed manifest + RFC-3161 timestamp
- Quarterly diff feed
- MCP server endpoints for Claude Code / Cursor

## Source
- Authority: BAZG (Bundesamt für Zoll und Grenzsicherheit, Switzerland)
- Source URL: https://www.bazg.admin.ch/dienstleistungen-firmen/tares-kostenlose-datenlieferungen-aufgrund-von-kundenwuenschen
- Commercial redistribution permission: granted 2026-04-21 by M. Beer, Chef Tarifgrundlagen

## Format
Parquet (UTF-8), Apache, schema typed.

## Use cases
- AI agents for Swiss customs classification
- ERP integration (SAP, Odoo, Sage, Dynamics)
- Trade compliance pipelines
- RAG / fine-tuning for Swiss-aware models

## Get the full pack
[openswissdata.com/datasets/tares](https://openswissdata.com/datasets/tares) — 499 CHF (Standard) / 899 CHF (Pro)

## Citation

If you use this sample in academic work, please cite:
```
@dataset{openswissdata_tares_sample_2026,
  author = {Martin, Claude-Alain},
  title = {openswissdata — TARES (Swiss Customs Tariff) Sample},
  year = {2026},
  publisher = {openswissdata},
  url = {https://huggingface.co/datasets/openswissdata/tares-sample}
}
```
```

---

## 10. Liste des communautés/canaux à activer (au-delà des drafts ci-dessus)

| Catégorie | Canaux | Format | Effort post-launch |
|---|---|---|---|
| **Marketplaces B2B** | Snowflake Marketplace, Datarade, AWS Data Exchange, Hugging Face Datasets | Listing + sample | 2-3 j |
| **Tech CH FR** | Inside-IT, ICTjournal, RTS Espace 2 | Article tech / interview | Pitch journaliste |
| **Tech CH DE** | Netzwoche, Inside-IT (DE), digitec/galaxus blog | Article tech | Pitch |
| **Finance CH** | moneycab, finews.ch, swissinfo finance | Press release | Pitch |
| **Communautés DEV** | Hacker News (Show HN), Lobsters, dev.to, IndieHackers | Story du founder | Auto |
| **Communautés data** | r/dataengineering, r/dataops, Locally Optimistic Slack, dbt Slack | Honest story | Auto |
| **Communautés AML/KYC** | r/AML_Compliance, r/banking, ACAMS forums, RegTech newsletter | Compliance Bundle pitch | Auto |
| **Communautés SAP/ERP** | r/SAP, r/odoo, SAP community network, Inside Odoo | Integration story | Auto |
| **Communautés AI** | r/LocalLLaMA, r/mlops, MCP Discord, Claude Code Discord, Cursor Discord | MCP server demo | Auto |
| **Newsletters** | Data Engineering Weekly, The Sequence, Pragmatic Engineer (paid), MIT Tech Review CH | Sponsored ou review | Pitch |
| **YouTube** | Démo MCP server (3 min), démo ROI ERP (2 min), interview founder (15 min) | Vidéos | 1-2 j |
| **Podcasts** | Suisse : Heyhey-Lab, Tagestechniker, Switzerland Data Podcast (à créer) | Interview | Pitch |
| **GitHub** | `openswissdata/sdk-ts`, `sdk-py`, `mcp-server` open source Apache 2.0 | Maintenance + issues | Continu |

---

## 11. Plan de séquencement (à valider)

**T0 = jour de fin Phase 1 (~ 4 semaines après mai 2026)**

| T+ | Action |
|---|---|
| T-3j | Préparer landing V4 finale + annexer Hugging Face sample + GitHub repos open source publiés |
| T-1j | Vérifier que les 3 packs livrent réellement les enrichissements promis |
| **T+0** | LinkedIn FR (matin) + LinkedIn DE (après-midi) + Show HN (16:00 GMT, peak HN) |
| T+1j | X/Twitter thread + Reddit r/dataengineering + ProductHunt launch |
| T+2j | Reddit r/Switzerland + r/AML_Compliance + r/SAP |
| T+3j | LinkedIn EN (international) + Email outbound (50 prospects sourcés) |
| T+7j | Article blog SEO #1 ("How to integrate Swiss customs data into SAP") |
| T+14j | Listing Hugging Face + Datarade |
| T+21j | Article blog SEO #2 ("FINMA KYC checks via MCP server") |
| T+30j | Bilan : MRR, sign-ups, MCP appels. Décision tier Enterprise. |
| T+60j | Listing Snowflake Marketplace |
| T+90j | Pitch presse CH (Inside-IT, moneycab, ICTjournal) |

---

## ⚠️ Validation requise avant push public

**Aucun de ces drafts ne doit être publié avant :**
1. Phase 0 quick wins exécutée (NOGA 2025/NACE 2.1 réels, FINMA warnings, manifest signé, repricing Stripe)
2. Phase 1 enrichissements TARES/Classifications/FINMA partiellement livrés
3. Validation par Alain de chaque draft (formulation, claims, prix mentionnés)

Toute publication anticipée risque :
- Refunds (claims non livrés)
- Perte de crédibilité ("le mec annonce mais n'a pas livré")
- Risque légal (prétendre une warranty qu'on n'a pas encore mise en place)

**Décision Alain à prendre maintenant :**
1. ✅ Valider la roadmap (ROADMAP.md)
2. ✅ Décider quel canal de promo activer en priorité (par défaut : LinkedIn FR + Show HN + ProductHunt)
3. ✅ Confirmer le repricing immédiat (Phase 0)
4. ✅ Décider du calendrier (mai 2026 quick wins + juin/juillet enrichissements + juillet/août MCP + septembre push promo)
