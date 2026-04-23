# Analyse marché B2B data Suisse — demande & problèmes

Date : 2026-04-23
Statut : recherche pour orientation roadmap

## I — Où il y a DÉJÀ de la demande (preuves concrètes)

### Acteurs commerciaux établis = preuve qu'on paie pour de la data CH

| Acteur | Positionnement | Couverture | Signaux marché |
|---|---|---|---|
| **Moneyhouse (NZZ Group)** | Commercial register + crédit + personnes | ~600k entités CH | Pricing opaque, filiale 100% NZZ depuis 2014 |
| **Dun & Bradstreet (ex-Bisnode)** | KYC, scoring, marketing | 420M global | D&B a racheté Bisnode pour **7,2 Mds SEK (~720M CHF)** en 2021 |
| **CRIF / Intrum / Creditreform** | Credit scoring CH | 100% CH | Standard banques CH |
| **OpenSanctions** | Sanctions/PEP global open-core | 4M+ entités | Devenu standard de fait |
| **FPRE / Novalytica** | Real estate analytics CH | Tout parc CH | Standards banques + assureurs immo |
| **KYC Spider** | KYC banques CH | CH-focus | Clients = banques + intermédiaires financiers |
| **Apify scrapers Zefix/Moneyhouse** | Scrapers tiers | — | L'existence prouve la demande non satisfaite par API officielle |

→ **Lecture** : segment "Swiss company data + risk + compliance" est mûr et monétisé. Trou pour du **self-serve à pricing transparent ciblant développeurs / PME tech**.

### Marché AML/sanctions = inflation rapide
- **AML software global : 4,13 Mds USD en 2025 → 9,38 Mds en 2030** (CAGR 17,8%)
- Sanctions + PEP screening = 15-20% de ce marché
- FINMA a infligé **>100M CHF d'amendes** récemment, CEO parle publiquement du risque ML/sanctions croissant
- La Suisse durcit AML 2026 (LETA + AMLA révisée)

### Demande en compétences internes = signal fort
- **919 jobs "data engineer" en CH** sur Glassdoor (fév. 2026), 478 rien que pour Zürich
- Salaires CHF 120-180k pour "build, automate data infrastructure for regulatory reporting" → coût-opportunité énorme

### Frustrations UID/MWST cross-border
- 3 douleurs récurrentes documentées (suffixes fragiles, registered ≠ active, CH pas dans VIES)
- Plusieurs SaaS étrangers payants (Vatstack, vatify.eu, vatapp.net) existent uniquement parce que mal résolu côté officiel CH

---

## II — Où il VA y avoir de la demande (2026-2028)

| Tendance | Horizon | Volume clients | ARPU potentiel | Datasets clés |
|---|---|---|---|---|
| **LETA / UBO Register** | **mi-2026** | 600k+ entités | CHF 50-500/an petit, 5-50k/an gros | Zefix + UBO chains + sanctions |
| **OECD Pillar Two GIR** | **30 juin 2026** | ~250 MNE CH | CHF 20-100k/an | Group structures + tax jurisdictions |
| **CSRD-CH (en attente)** | Q1/Q2 2026 décision | ~100 grandes + supply chain | CHF 10-50k/an | NOGA + emissions + CECB + supply |
| **DAC8 / CARF** | **1er janv. 2026** collecte | ~50 VASPs CH | CHF 30-100k/an | KYC enrichi crypto + résidences fiscales |
| **e-ID Suisse** | **déc. 2026** | écosystème entier | nouveau marché | Verifiable credentials registries |
| **Décarbo immo (CECB)** | continu | banques + assureurs | CHF 50-200k/an | CECB + Grundbuch + cadastre |

### Détails clés

**LETA / UBO** (le plus gros) :
- Loi adoptée 26 sept. 2025, en vigueur **mi-2026**
- ~600 000 entités CH doivent identifier leurs UBOs sous 1 mois
- Fines jusqu'à **CHF 500 000** par non-conformité
- Registre central non-public, accès limité aux autorités + intermédiaires financiers régulés
- **Marché captif sur 18-24 mois**

**Pillar Two** :
- GIR (GloBE Information Return) premier dépôt **30 juin 2026** via portail OMTax
- Tous groupes >750M EUR consolidés
- Petit volume mais ARPU très élevé (cabinets PwC/KPMG/EY/Deloitte CH, Tax tech)

**DAC8/CARF** :
- Crypto-asset providers CH/LI affectés s'ils servent résidents UE (extraterritorial)
- Clients : Bitcoin Suisse, Sygnum, SEBA/AMINA, Taurus, Crypto.com Genève

---

## III — 5 problèmes mal résolus

### Problème 1 : KYC "all-in-one CH" pour onboarding fintech/PSAN
- **Qui souffre** : compliance officers de fintechs CH (néobanques, PSAN, brokers), avocats KYC, fiduciaires
- **Aujourd'hui** : ils paient D&B/Bisnode (cher, opaque) ou bricolent en interne avec scrapers Zefix + appels manuels OpenSanctions + Excel pour UBO
- **Mal résolu car** : D&B = cher pas développeur-friendly ; Moneyhouse = pas d'agrégation sanctions ; OpenSanctions = pas de couverture commercial register CH ; **personne ne fait le join propre**
- **Solution openswissdata** : dataset "**CH Entity Graph**" — Zefix normalisé + UBO LETA dès activation + cross-ref sanctions/PEP + adresses normalisées. Vente snapshot mensuel + diff API.

### Problème 2 : Calcul charges sociales × canton × commune × situation familiale
- **Qui souffre** : éditeurs SaaS paie (Bexio, Abacus, Lano, Deel, Remote.com côté CH), HR-tech, comptables
- **Aujourd'hui** : chaque éditeur maintient sa propre table interne, mise à jour manuelle chaque janvier (impôt à la source change tout le temps cantonalement)
- **Mal résolu car** : AFC ne publie pas de format machine-readable unifié ; les calculateurs (swisstaxmap, netsalaire, icalculator) sont user-facing sans API commerciale
- **Solution openswissdata** : dataset "**Swiss Payroll Parameters**" versionné — JSON par canton/commune/année + fonctions de calcul. Mise à jour 2x/an. Cible aussi boîtes étrangères qui veulent embaucher en CH.

### Problème 3 : Real estate due diligence "10 minutes" multi-cantonale
- **Qui souffre** : courtiers immo, banques hypothécaires, avocats notariaux, investisseurs immo institutionnels
- **Aujourd'hui** : ils paient FPRE/Novalytica pour macro-data, mais la **micro-DD parcellaire reste manuelle** ou sous-traitée à des géomètres
- **Mal résolu car** : Grundbuch = cantonal (26 systèmes différents) ; CECB = pas d'API commerciale ; cadastre national fragmenté
- **Solution openswissdata** : dataset "**Parcel-level CH Real Estate**" — agrégation cadastre + zonage + CECB + dangers naturels par parcelle. Premier client logique = banques et fintech immo.

### Problème 4 : Validation UID/MWST CH+EU dans un seul appel
- **Qui souffre** : équipes finance/AR de toute boîte CH faisant du B2B cross-border, éditeurs ERP/billing (Stripe Tax, Bexio, Lexware)
- **Aujourd'hui** : Vatstack, vatify, APIstax — services payants étrangers, focus VIES, traitent CH "as second-class"
- **Mal résolu car** : AFC fournit UID mais pas un join propre avec VIES + pas de cache historique + pas de webhooks de changement de statut
- **Solution openswissdata** : "**Swiss VAT API+**" — UID/MWST avec statut TVA actif, historique 5 ans, webhook sur changement de statut, batch CSV. Pricing freemium. Volume potentiel énorme.

### Problème 5 : Étude de marché PME par commune
- **Qui souffre** : PME en phase d'expansion (~600k SARL/SA en CH), consultants stratégie, sociétés de franchise, fiduciaires conseil
- **Aujourd'hui** : Excel + scraping manuel + budget consultant CHF 5-15k pour étude one-shot
- **Mal résolu car** : OFS publie par commune en CSV brut multi-fichiers, sans join NOGA-commune ; Moneyhouse fait company-level ; FPRE c'est immo
- **Solution openswissdata** : dataset "**Swiss Local Market Intelligence**" — par commune × NOGA : nb d'entreprises, densité, démographie, revenus, accessibilité.

---

## IV — Top 3 priorisé pour roadmap 12 mois

Si on ne devait en garder que 3 (vu deadlines réglementaires + signaux de paiement existants) :

### 1. **CH Entity Graph + UBO/LETA**
- Deadline mi-2026, 600k entités
- Pricing range énorme, joue sur catalogue existant (FINMA + élargissement Zefix/UBO)
- **Marché captif et urgent**

### 2. **Swiss Payroll Parameters API**
- Douleur permanente, marché B2B SaaS clair
- Peu de concurrence native, ARPU récurrent
- Cible aussi boîtes étrangères qui embauchent en CH

### 3. **Swiss VAT API+**
- Volume gigantesque, ticket bas mais récurrent
- Gateway pour upsell vers le reste du catalogue
- Réputation développeur

→ **LETA + Pillar Two + CSRD-CH convergent en 2026 = c'est la fenêtre.** Si on a déjà NOGA/FINMA, on est positionné pour capter la vague compliance.

## V — Sources clés

- [LETA Transparency Register (Lenz Stähelin)](https://www.lenzstaehelin.com/news-and-insights/browse-thought-leadership-insights/insights-detail/introduction-of-a-federal-register-of-beneficial-owners/)
- [Switzerland AML 2026 (SIGTAX)](https://sigtax.com/Switzerland-AML-2026-New-Beneficial-Ownership-Rules)
- [Pillar Two Switzerland (KPMG)](https://kpmg.com/ch/en/insights/taxes/beps-2.html)
- [CSRD Switzerland (ESG Today)](https://www.esgtoday.com/switzerland-proposes-broader-stricter-sustainability-reporting-requirements-for-companies/)
- [Swiss e-ID Dec 2026 (Biometric Update)](https://www.biometricupdate.com/202603/swiss-e-id-delayed-to-december-renewed-focus-on-security-and-trustworthiness)
- [DAC8 / CARF (BankingHub)](https://www.bankinghub.eu/innovation-digital/carf-dac-8-reporting-crypto-asset-service-providers)
- [Moneyhouse Enterprise](https://www.moneyhouse.ch/en/enterprise)
- [D&B acquires Bisnode](https://www.research-live.com/article/news/dun--bradstreetbuys-bisnode/id/5079242)
- [OpenSanctions pricing](https://www.opensanctions.org/faq/29/pricing-tier/)
- [data-jobs.ch](https://data-jobs.ch/jobs)
