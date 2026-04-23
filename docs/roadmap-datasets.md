# Roadmap datasets — openswissdata

Date : 2026-04-23
Statut : audit + scout, à valider avant exécution

## I — Enrichissements des 3 datasets actuels (priorité 1, mai-juin 2026)

### TARES — Tarif douanier suisse

| Code | Enrichissement | Source | Effort | Valeur | Risque légal |
|---|---|---|---|---|---|
| **T1** | Cross-walk HS6 ↔ EU TARIC (10 chiffres) avec droits CCT UE | EU TARIC (open data) | Medium | **High** | Aucun |
| **T2** | Statistiques Swiss-Impex par HS8 (volumes import/export 12-24 mois, top pays partenaires) | BAZG Swiss-Impex | Medium | **High** | À confirmer pour bulk commercial |
| T3 | WCO HS Nomenclature linkage (référence internationale 6-digit) | wcoomd.org | Low | Medium | Aucun pour HS6 |
| **T4** | Changelog historique des taux MFN (12-24 mois mobiles, JSON diff) | Snapshots xtares + RS 632 | Medium | **High** | Aucun |
| T5 | Mapping HS8 ↔ codes BFS (PRODCOM, NOGA) | BFS Ramon | Low (si permission) | Medium | Couvert par demande BFS |
| T6 | Restrictions non-tarifaires enrichies (LPTh, LChim, CITES, dual-use SECO) | Multi-sources admin.ch | High | High | Citer source |
| T7 | Images / icônes par chapitre HS | WCO | Low | Low | Aucun |
| ❌ T8 | Erläuterungen / notes explicatives BAZG | BAZG | — | High | **EXCLU** par permission BAZG |

**Priorité : T1 + T2 + T4** → repricing TARES 299 → **499 CHF** (standalone) ou tier "TARES Pro" à **899 CHF**.

### Classifications — NOGA / NACE / ISIC

| Code | Enrichissement | Source | Effort | Valeur | Risque |
|---|---|---|---|---|---|
| **C1** | Labels EN officiels NOGA 2025 (actuellement DE/FR/IT only) | KUBB BFS | Low | **High** | Inclus dans permission BFS |
| **C2** | STATENT — nb d'établissements & emplois par code NOGA × commune | opendata.swiss STATENT | Medium | **Very high** | Permission BFS à confirmer |
| C3 | Cross-walk NOGA ↔ NAICS (US) ↔ SIC | OECD + UN Stats | High | Medium | Open data |
| C4 | Cross-walk NACE Rev 2.1 ↔ ISIC Rev 5 (à venir) | Eurostat / UN | Medium | Medium | Open data |
| C5 | Codes NOGA exotiques par canton | Hétérogène | High | Low | Aucun |
| C6 | Mapping NOGA ↔ codes assurance accident SUVA (BU/MU) | SUVA | Medium | High pour HR-tech | Demander à SUVA |
| **C7** | Searchable embeddings (vector) sur description NOGA — classification automatique | Production interne | Low | **High** | Aucun |

**Priorité : C1 + C2 + C7** → repricing 399 → **599 CHF** ou tier "Classifications + STATENT" à **999 CHF**.

### FINMA Registry

| Code | Enrichissement | Source | Effort | Valeur | Risque |
|---|---|---|---|---|---|
| **F1** | Dates de retrait d'autorisation (historique révocations) | FINMA enforcement reporting | Medium | **Very high** | Open, citer FINMA |
| F2 | Décisions enforcement anonymisées | FINMA | Medium | High | Open |
| **F3** | Liste des warnings FINMA (entités non autorisées, scams) | finma.ch/warnings | **Low** | **High** | Open, attribution |
| **F4** | Lien vers Zefix complet via UID join (statut RC, organes, capital) | Zefix REST API | **Low** | **Very high** | Open data, attribution |
| F5 | Étendre LEI GLEIF avec relationships parent/ultimate parent | GLEIF Level 2 | Medium | High | CC0 |
| F6 | Cross-référence sanctions SECO | SECO XML | Medium | High | Open |
| F7 | Rapports financiers FINMA | Pas systématiquement publics | High | Medium | Risque légal |
| F8 | Historique trimestriel des évolutions (entries/exits diffs) | Snapshots FINMA | Low | High | Aucun |

**Priorité : F1 + F3 + F4 + F8** → repricing FINMA 299 → **699 CHF** ou tier "FINMA + Zefix Sync" à **1 290 CHF**.

---

## II — Nouveaux datasets candidats (roadmap 6-12 mois)

### Top 5 prioritaires (étoiles ★★★★★)

| Dataset | Source | Public B2B | Permission | Difficulté | Prix indicatif |
|---|---|---|---|---|---|
| **Zefix Snapshot Pro** (registre commerce + organes + journal SOGC + indexé, 750k entités) | Zefix REST + LINDAS | KYC, sales intel, B2B prospection | Open avec attribution | Medium | **999 CHF** + abo updates |
| **Swiss-Impex Standalone** (commerce extérieur HS8 × pays × année 2010-2025, ~30M lignes) | BAZG | Études marché, sourcing, M&A | À confirmer pour bulk | Medium | **799 CHF** |
| **SECO Sanctions Live** (liste consolidée + diffs quotidiens + mapping UN/EU/OFAC) | SECO XML | Banques, fintech, exporters, AML | Open | Low | **499 CHF** |
| **Fiscalité cantonale unifiée** (taux IFD + ICC × commune, déductions) | ESTV + cantons | Fiduciaires, payroll, expat advisors | À confirmer cantons | **High** | **899 CHF** |
| **Swissmedic Drug Registry Pro** (médicaments + GTIN + AIPS structurées) | Swissmedic + Refdata | Pharma, hôpitaux, assurances santé | Refdata OK avec mention | Medium | **599 CHF** |

### Très bons candidats (★★★★)

| Dataset | Prix |
|---|---|
| swissBOUNDARIES Pro (communes + districts + cantons + historique fusions) | 399 CHF |
| STATPOP Communal Time-Series (population par commune, 2010-2025) | 499 CHF |
| MedReg Pro (médecins + dentistes + chiros + vétos CH + GLN) | 499 CHF |
| simap.ch Tenders Archive (marchés publics consolidés) | 699 CHF |

### Candidats moyens / spéculatifs (★★ à ★★★)

| Dataset | Pourquoi pas prioritaire |
|---|---|
| SwissPRTR (rejets polluants) | Volume modeste, niche ESG |
| Pronovo Power Plants | Permission incertaine |
| Votations & Élections par commune | Faible willingness-to-pay (médias = budget faible) |
| CFF GTFS | Trop ouvert déjà, peu de marge |
| AHV/OFAS pensions anonymisées | Trop agrégé |
| Registres immobiliers cantonaux | Hétérogène, juridique incertain — écarter |

---

## III — Bundles stratégiques recommandés

### Bundle "Compliance & KYC Suisse" — ~2 990 CHF
- FINMA Registry Pro (avec F1+F3+F4+F8)
- Zefix Snapshot Pro
- SECO Sanctions Live
- MedReg Pro

→ Aucun concurrent CH-spécifique ne l'offre packagé.

### Bundle "Swiss Market Intelligence" — ~2 490 CHF
- STATPOP + STATENT
- Classifications Pro (avec C1+C2+C7)
- swissBOUNDARIES Pro
- Fiscalité cantonale unifiée

→ Cible BD/consulting/real estate, ne cannibalise pas le bundle KYC.

---

## IV — Actions légales prioritaires

1. **Grouper dans demande BFS en attente** : NOGA, STATPOP, STATENT, votations historiques.
2. **Compléter demande BAZG** : Swiss-Impex pour bulk commercial (en plus de TARES déjà OK).
3. **Nouvelle demande OFSP** : MedReg.
4. **Nouvelle demande Refdata** (SAI/AIPS) pour Swissmedic Pro.
5. **Vérifier conditions Zefix** pour usage commercial bulk (attribuer FOJ).

---

## V — Observations stratégiques

1. **Le moat n'est pas la donnée brute mais le pipeline.** Les enrichissements (cross-walks inter-datasets, joins UID/HS/BFS-NOGA, format propre, SLA updates) multiplient la valeur perçue.
2. **Le bundle "Compliance & KYC Suisse"** est probablement le futur produit star — segment B2B serré, willingness-to-pay élevée.
3. **Le bundle "Market Intelligence"** ouvre un nouveau segment (BD/consulting) sans cannibaliser le 1er.
4. **Vague 1 (mai-juin)** : enrichissements quick-wins → repricing immédiat des 3 datasets actuels.
5. **Vague 2 (juillet-août)** : Zefix + SECO Sanctions = 1er produit phare nouveau.
6. **Vague 3 (sept-oct)** : Fiscalité cantonale + bundle Market Intel.

## VI — Sources vérifiées

Voir agent run pour la liste complète. Principales :
- opendata.swiss STATENT, STATPOP, votations, Zefix
- BFS Ramon, KUBB NOGA 2025
- BAZG Swiss-Impex, EU TARIC
- FINMA enforcement, warnings
- Zefix REST API, LINDAS
- SECO sanctions XML, OpenSanctions
- Swissmedic, Refdata AIPS/SAI
- swisstopo swissBOUNDARIES3D 2026
- BAFU SwissPRTR
- BAG MedReg, I14Y
- Pronovo Garanties d'origine
- ESTV statistiques fiscales
- SBB data.sbb.ch, simap.ch
- github.com/rnckp/awesome-ogd-switzerland
