# Roadmap perfectionnement openswissdata — synthèse 6-agents

**Date :** 2026-04-29
**Méthode :** 6 agents Claude Code en parallèle (audit technique, concurrence, threat AI agents, audit TARES, audit Classifications, audit FINMA)
**Objectif :** rendre les 3 packs (TARES, Classifications, FINMA + bundle) **indispensables** face à des AI agents qui peuvent scraper eux-mêmes — et capturer la vraie valeur via repricing + tiers Pro/Enterprise + MCP server + distribution multi-canal.

---

## TL;DR exécutif

### Constat sans concession
- **Score actuel des 3 packs** : 5/10 en moyenne. Bons sur le juridique (BAZG permission ✓), faibles sur l'agent-proof (un AI agent reproduit 60-80 % du contenu en 4-6 h).
- **Pricing 299-799 CHF** : sous-évalué pour le segment B2B sérieux (banques/fintech/legaltech paieraient 3-10k CHF/an sans broncher), juste pour le segment indie/dev/SMB.
- **Concurrence directe** : aucune sur le bundle exact. Mais **OpenSanctions** est le plus dangereux (pourrait ajouter "Swiss FINMA Authorised" en 3-6 mois → fin du moat sur FINMA).
- **Bug critique** : NOGA 2025 et NACE 2.1 sont des **fixtures vides en prod**. Les clients qui achètent Classifications reçoivent des fichiers à zéro ligne sur les nomenclatures les plus récentes.

### Les 3 leviers pour multiplier la valeur perçue × 3-5
1. **MCP server `mcp.openswissdata.com`** (Q3 2026) avec endpoints agent-natifs : `tariff_lookup`, `tariff_semantic_search`, `classify_text`, `kyc_check`, `entity_history`. Canalise le risque AI vers OSD au lieu de le subir.
2. **Embeddings multilingues pré-calculés** dans chaque pack (Parquet) + index FAISS — **zéro AI agent ne fera ça en session** parce qu'il faut un GPU. Killer feature.
3. **Warranty contractuelle + manifest légal signé** (Ed25519 + horodatage RFC-3161) — c'est **le** moat juridique : seul OSD peut vendre une garantie indemnisée car seul OSD a la permission BAZG nominative. Aucun agent qui scrape ne peut le faire.

### Repricing recommandé
| Dataset | Aujourd'hui | Standard recommandé | Pro | Enterprise |
|---|---|---|---|---|
| TARES | 299 CHF | **499 CHF** (+ embeddings + cross-walks) | **899 CHF** (+ changelog 24m + MCP 1 instance) | **1 990 CHF/an** (multi-seat + SLA + updates hebdo) |
| Classifications | 399 CHF | **499 CHF** (+ NOGA 2025 EN + bridges officiels) | **999 CHF** (+ STATENT + embeddings + MCP) | sur devis |
| FINMA | 299 CHF | **399 CHF Basic** (+ warnings) | **699 CHF Pro** (+ révocations + delta + signé) | **1 290 CHF FINMA + Zefix Sync** + MCP |
| Bundle | 799 CHF | **999 CHF** (rebrand "Crosswalk Pack") | **2 990 CHF Compliance Bundle** | **4 990 CHF** Enterprise multi-seat + MCP + warranty |

**Impact projeté :** ARPU × 2-5 sur les acheteurs B2B sérieux, MRR via abonnements updates, défensibilité face aux AI agents.

---

## Phase 0 — Quick wins critiques (mai 2026, ≤ 1 semaine)

À faire avant tout autre chantier — ce sont des **trous** dans le produit actuel qui peuvent générer des refunds.

| # | Action | Impact | Effort |
|---|---|---|---|
| Q1 | **Remplir NOGA 2025 + NACE 2.1** depuis sources officielles (Eurostat ShowVoc + BFS KUBB PDF) | Élimine bug critique : aujourd'hui 0 lignes en prod | 1 j |
| Q2 | **Ajouter EN labels NOGA 2025** (déjà mentionné dans roadmap C1) | Permet positionnement international | 0.5 j |
| Q3 | **Ajouter FINMA Warnings list** (~2 180 entités) au pack FINMA via [finma.ch/api/search/getresult](https://www.finma.ch/en/finma-public/warnungen/warning-list/) | Différenciation immédiate vs OpenSanctions, +flag `is_warning_listed` | 1 j |
| Q4 | **Manifest légal signé** dans chaque ZIP : `provenance.json` Ed25519 + n° permission BAZG + hash source + timestamp RFC-3161 | Le moat juridique en 1 jour | 0.5 j |
| Q5 | **Repricing immédiat** : TARES 299→499, Classifications 399→499, FINMA 299→399 (Basic), Bundle 799→999 | Capture valeur sans nouveau dev | 1 h (Stripe) |
| Q6 | **Page `/legal/provenance`** qui explique le moat juridique : permission BAZG + LCD art. 5 + audit trail signé | Argumentaire vente compliance | 0.5 j |

**Total Phase 0 :** ~4-5 jours de dev, repricing immédiat.

---

## Phase 1 — Enrichissement Top 5 par dataset (mai-juin 2026, 4 semaines)

### TARES (effort total ~5 j)
| Code | Enrichissement | Effort | Valeur |
|---|---|---|---|
| **T1** | Pre-computed embeddings multilingues 768d/1024d × 4 langues (Parquet) — `BAAI/bge-m3` ou `paraphrase-multilingual-mpnet-base-v2` | 0.5 j | ★★★★★ |
| **T2** | Changelog historique 12-24m MFN + préférentiels (snapshots `data/tares/raw/` + RS 632, JSON diff) | 2 j | ★★★★★ |
| **T3** | Cross-walk HS6 ↔ EU TARIC 10-digit + droits CCT UE (DG TAXUD open data) | 1.5 j | ★★★★ |
| **T4** | Cross-walk HS ↔ WCO HS 2022 multilingue (EN/FR/ES, sections + chapter notes structurels — pas Explanatory Notes exclus par BAZG) | 1 j | ★★★★ |
| **T5** | Manifest légal signé Ed25519 (déjà fait en Phase 0) | — | (fait) |

### Classifications (effort total ~6 j)
| Code | Enrichissement | Effort | Valeur |
|---|---|---|---|
| **C1** | NOGA 2025 complet + EN labels + 5/6-digit CH (KUBB BFS PDF + Ramon) | 1.5 j | ★★★★★ |
| **C2** | STATENT join : nb établissements & FTE × NOGA × commune × année 2011-2024 (opendata.swiss STATENT) | 2 j | ★★★★★ |
| **C3** | Embeddings pré-calculés (NOGA descriptions, 768d, 4 langues) + classifier free-text → top-3 codes (`BAAI/bge-m3`) | 1 j (1 nuit GPU) | ★★★★★ |
| **C4** | Cross-walk NACE 2.1 ↔ NACE 2.0 (Eurostat ShowVoc) + NOGA 2008↔2025 (BFS) | 1 j | ★★★★ |
| **C5** | NAICS 2022 + ISIC Rev 5 cross-walk via pivot ISIC (BLS + Census) | 0.5 j | ★★★★ |

### FINMA (effort total ~10 j)
| Code | Enrichissement | Effort | Valeur |
|---|---|---|---|
| **F1** | Warnings list (~2 180) — déjà fait en Phase 0 | — | (fait) |
| **F2** | Zefix sync via UID (organes, capital, statut RC) — REST API + LINDAS SPARQL bulk | 4 j | ★★★★★ |
| **F3** | GLEIF LEI Level 1+2 join sur UID/nom (parents, ultimate parents, CC0) | 2 j | ★★★★ |
| **F4** | Historique révocations / FINMA Final Rulings + delta trimestriel sur licences `withdrawn` | 3 j | ★★★★★ |
| **F5** | SECO Sanctions cross-réf (XML format, fuzzy match UID/nom) | 1 j | ★★★ |

**Demande de permission FINMA + BFS** : à relancer en parallèle (les datasets eux-mêmes sont accessibles, mais pour la commercialisation explicite, valoir mieux avoir l'écrit).

---

## Phase 2 — MCP server `mcp.openswissdata.com` (juin-juillet 2026, 2 semaines)

### Architecture
- **Stack** : Hono (déjà utilisé) + Anthropic MCP TypeScript SDK + endpoint SSE remote + auth OAuth 2.1
- **Hébergement** : Railway (déjà en place)
- **Modèle commercial** : freemium 10 lookups/jour gratuits, OAuth permission-token *lié à la licence ZIP achetée* (sinon cannibalisation)

### Endpoints prioritaires (par dataset)

**TARES**
- `tariff_lookup(hs8: string, lang?: 'fr'|'de'|'it'|'en')` → row complet + parents hiérarchiques + disclaimer non-officiel intégré (l'agent ne peut pas l'oublier)
- `tariff_semantic_search(query: string, top_k=5, lang)` → utilise les embeddings pre-computed (killer feature)
- `tariff_changelog(hs8, since: ISODate)` → diff historique 12-24m

**Classifications**
- `classify_text(free_text, lang?, top_k=3) → [{code, label, confidence, parent_section}]` (killer feature)
- `cross_walk(code, source_scheme, target_scheme)` (toutes permutations 5-way + NAICS Pro)
- `statent_lookup(noga_code, geo_level="commune", commune_bfs_id?) → {establishments, fte, year}` (Pro tier seulement)

**FINMA**
- `kyc_check(name) → {finma_authorised, finma_warning, seco_sanctions, zefix_status, lei}` (the killer killer feature — vendable en abo seul à 49 CHF/mois)
- `entity_history(uid)` → timeline complète
- `finma_search(name, fuzzy=true)` → recherche tolérante

### Pricing MCP
- Inclus dans tier Pro/Enterprise du dataset correspondant
- Standalone : 49 CHF/mois (FINMA KYC), 79 CHF/mois (Classifications), 39 CHF/mois (TARES)
- Bundle MCP : 99 CHF/mois (les 3 servers)

---

## Phase 3 — Tiers Pro/Enterprise + warranty contractuelle (juillet 2026, 2 semaines)

### Warranty + indemnification clause
**LE moat le plus défendable** (cf. [Aaron Hall — Data Source Representation Clauses](https://aaronhall.com/data-source-representation-clauses-with-warranties/)) :

> *"OSD garantit l'exactitude et la fraîcheur des données livrées sous réserve des conditions usuelles. En cas d'amende douanière BAZG, sanction de l'autorité fédérale ou perte vérifiable directement causée par une erreur de notre dataset, OSD indemnise le client jusqu'à 10× le prix de la licence annuelle (plafond 50 000 CHF)."*

- Mettre en page comme PDF signé + lien dans CGV §X
- Badge `Backed by data warranty` en hero de la landing V4
- Aucun AI agent qui scrape ne peut signer ça (pas de KMU avec une raison sociale + IDE + responsabilité civile dédiée)

### Tier Enterprise (multi-seat + SLA)
- Licence redistribution interne (jusqu'à 50 sièges / domaine)
- Updates poussées hebdomadaires (au lieu de mensuelles)
- Support email + Slack shared channel
- SLA 24h response
- Hébergement MCP dédié (sub-domain client.mcp.openswissdata.com)
- Pricing : TARES Enterprise 1 990 CHF/an, Bundle Enterprise 4 990 CHF/an

### Bundle "Compliance Pack" — 2 990 CHF
- FINMA Pro + Zefix Sync + SECO Sanctions Live + MedReg Pro
- Cible : compliance officers banques privées CH, fintechs AML
- Aucun concurrent CH-spécifique ne le fait packagé

---

## Phase 4 — Distribution multi-canal (août-septembre 2026)

Aujourd'hui, OSD vend uniquement via openswissdata.com. C'est insuffisant. Plan d'attaque :

### Marketplaces B2B
- **Snowflake Marketplace** : datasets agentic-ready, audience banques/fintech tier-1, comm 25-30 % mais visibilité énorme
- **Datarade.ai** : marketplace data B2B avec catégorie "Customs Data" / "Compliance Data" — placement direct
- **Hugging Face Datasets** : versions sample (10 % gratuit, watermark) + lien vers pack complet — capte les data engineers AI
- **AWS Data Exchange** : marketplace vers cible enterprise US/EU
- **Google Cloud Marketplace** + **Azure Marketplace** : clients enterprise

### Communautés et forums
- **Hacker News** (Show HN avec angle "We sell Swiss federal data with cryptographic warranty — and an MCP server")
- **Reddit** : r/dataengineering, r/Switzerland, r/AML_Compliance, r/SAP, r/dataops
- **ProductHunt** (launch coordonné jour J)
- **IndieHackers** (story du solo founder + chiffres)

### Communautés métier
- **DataIQ** (compliance data UK/EU) — newsletter + LinkedIn group
- **Swiss FinTech Innovations** (Zürich based, banques/fintechs)
- **Treuhandkammer / Expert Suisse** (fiduciaires CH)
- **CH-Open** (open data CH community)
- **AI Switzerland** / **GenSwiss** (devs IA en CH)

### Newsletters et veille
- **Data Engineering Weekly**
- **The Sequence** (AI data products)
- **Inside-IT** (presse tech CH FR)
- **Netzwoche / ICTjournal** (presse tech CH DE)
- **moneycab** (finance CH)

### Réseaux sociaux
- **LinkedIn** FR + DE + EN (1 post par lancement majeur, ciblé compliance/data eng/SAP integrators)
- **X / Twitter** : thread devs + thread compliance officers
- **Bluesky / Mastodon** : audience tech open source (CC0 datasets samples, MCP server demo)
- **YouTube** : 1 démo de 3 min "MCP server in Claude Code" + 1 démo "Calculate ROI ERP integrator"

### SEO / contenu
- **Blog OSD** : articles ciblés ("How to integrate Swiss customs data into SAP", "FINMA KYC checks via MCP", "NACE 2.1 transition guide for fiduciaires")
- **GitHub `openswissdata/sdk-ts` + `sdk-py` + `mcp-server` open source** (Apache 2.0) → backlinks + crédibilité dev

---

## Métriques de succès (à 6 mois post-lancement)

| Métrique | Baseline | Cible Q3 2026 | Cible Q1 2027 |
|---|---|---|---|
| Revenu mensuel | ~0 CHF | **3 000 CHF MRR** | **10 000 CHF MRR** |
| Acheteurs uniques | 0 | 30 | 100 |
| MCP appels/jour | 0 | 1 000 | 10 000 |
| Stars GitHub `openswissdata` | 0 | 200 | 1 000 |
| Backlinks DR > 30 | <5 | 30 | 80 |
| Mentions "openswissdata" | 0 | 50 | 200 |

---

## Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| OpenSanctions ajoute "Swiss FINMA Authorised" | Moyenne | Élevé | Vitesse d'exécution F2+F3+F4+MCP avant 2026-07 |
| BAZG/OFS lance son propre MCP officiel | Faible | Élevé | Se positionner sur le crosswalk inter-sources (axe 4) que l'État ne fera jamais (silos) |
| Agent type Manus avec budget illimité scrape et republie en open-source | Faible | Élevé | Seuls la warranty + permission BAZG résistent. Vendre la *responsabilité*, pas la donnée |
| Compression tarifaire si Cursor/Claude Code intègrent un crawler natif "zero-shot federal data" | Moyenne | Moyen | Pricing seat enterprise (1 990 CHF/an/équipe) au lieu de one-shot consumer |
| Refus de permission BFS / FINMA après commercialisation | Faible | Moyen | Permission BAZG TARES carrée. Pour les autres, classifications elles-mêmes sont publiques et réutilisables |
| Mauvaise traction marketplaces (commissions élevées vs volume) | Moyenne | Faible | Tester Datarade et Hugging Face en premier (faible coût d'entrée), Snowflake en Q4 si validé |

---

## Plan d'exécution chronologique

| Semaine | Phase | Livrables |
|---|---|---|
| **S1 (mai 2026)** | Phase 0 quick wins | NOGA 2025 + NACE 2.1 réels, EN labels, FINMA Warnings, manifest signé Ed25519, repricing Stripe |
| **S2-S3** | Phase 1 TARES | T1 embeddings + T2 changelog + T3 TARIC + T4 WCO |
| **S4** | Phase 1 Classifications | C1 NOGA 2025 + C2 STATENT + C3 embeddings |
| **S5** | Phase 1 Classifications + Phase 1 FINMA | C4 cross-walks + F2 Zefix sync (start) |
| **S6** | Phase 1 FINMA | F2 Zefix sync (finish) + F3 GLEIF + F4 historique révocations |
| **S7-S8** | Phase 2 MCP server | Stack Hono + MCP SDK + 9 endpoints + freemium auth + déploiement |
| **S9** | Phase 3 Pro/Enterprise | Warranty contractuelle + tier multi-seat + Compliance Bundle + bundle Crosswalk Pack |
| **S10-S13** | Phase 4 distribution | Datarade + HF Datasets + ProductHunt + Show HN + LinkedIn FR/DE/EN + 3 articles blog SEO |

**Total :** ~13 semaines pour atteindre Q3 2026 avec roadmap exécutée à 80 %.

---

## Annexes

- [Audit technique complet (Agent 1)](AUDIT-TECHNIQUE.md)
- [Analyse concurrence (Agent 2)](COMPETITORS.md)
- [Différenciation vs AI agents (Agent 3)](THREAT-AI-AGENTS.md)
- [Drafts promo multi-plateformes](promo-drafts/)
