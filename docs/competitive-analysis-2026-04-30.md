# Analyse concurrentielle openswissdata.com

Date : 2026-04-30
Statut : recherche stratégique pour positionnement et roadmap distribution

## I — Contexte openswissdata

**Offre** : 3 datasets officiels CH normalisés (TARES douanes, NOGA/NACE/ISIC classifications, FINMA registry) à 299-799 CHF par dataset, plus abonnement updates 120-160 CHF/an.

**Cible** : data engineers, compliance officers fintech CH, fiduciaires, cabinets fiscaux/comptables, éditeurs SaaS B2B (paie, ERP).

**Positionnement** : self-serve, pricing transparent, data brute normalisée prête à l'emploi.

---

## II — Profils concurrents détaillés

### Concurrents directs (data CH structurée payante)

#### 1. Moneyhouse (NZZ Group) — moneyhouse.ch
- **Pricing** : opaque, sur devis. API tarifée selon nombre d'endpoints + frais de setup unique. Volume discount à partir de 5 comptes Premium. Pas de signup self-serve.
- **Couverture** : 630k+ entités CH (commercial register), personnes, données crédit, publications SOGC.
- **Format** : web app principalement, API REST tarifée, pas de bulk download.
- **Cible** : PME, cabinets, banques, recherche d'entreprises.
- **Force** : marque grand public CH, intégration NZZ, données fraîches quotidiennes.
- **Faiblesse** : pas de pricing transparent, ergonomie dev faible, API coûteuse, pas pensée pour intégration ERP.
- **Revenu / employés** : ~13,6 M USD ARR, 11-50 employés (LinkedIn 923 followers), filiale 100% NZZ depuis 2014.
- **Menace pour openswissdata** : 2/5. Cible différente (UI vs data brute), mais notoriété forte.

#### 2. Dun & Bradstreet Suisse (ex-Bisnode) — dnb.ch
- **Pricing** : opaque, sur devis enterprise uniquement. Contrats annuels lourds. Tarif estimé 5-50k CHF/an selon volume.
- **Couverture** : 420M entités globales, dont CH complet. Scoring crédit, KYC, marketing data, segmentation.
- **Format** : API REST, SFTP bulk, intégrations CRM (Salesforce, SAP).
- **Cible** : banques, grandes corporates, marketing B2B enterprise.
- **Force** : standard mondial KYC + scoring crédit, intégrations natives ERP majeurs.
- **Faiblesse** : très cher, contrat-lock, pas développeur-friendly, time-to-data très long (4-8 semaines onboarding).
- **Revenu / employés** : D&B a racheté Bisnode en 2021 pour 7,2 Mds SEK (~720M CHF). Bisnode CH = ~150-200 employés.
- **Menace pour openswissdata** : 3/5. Cible enterprise, mais peut presser segments mid-market si baisse les prix.

#### 3. CRIF AG Suisse — crif.ch
- **Pricing** : opaque, devis. Margo API et IDea API existent côté groupe.
- **Couverture** : 6M+ entités via Margo, KYC fraud check via IDea. >30 000 entreprises CH clientes.
- **Format** : API REST, intégrations existantes banques.
- **Cible** : banques, assurances, leasing, e-commerce, telco CH.
- **Force** : leader CH credit risk + fraud, ancrage banques.
- **Faiblesse** : pas self-serve, pas développeur-friendly, focus credit/scoring (pas dataset brut classifications).
- **Revenu / employés** : CRIF AG (entité CH) ~28 employés, 2,8M USD ARR. Groupe CRIF mondial : 896M USD, 6 600 employés, 37 pays.
- **Menace pour openswissdata** : 2/5. Verticale credit risk différente de classifications/customs.

#### 4. Creditreform Suisse — creditreform.ch
- **Pricing** : opaque, sur devis. Rapports unitaires + abonnements API.
- **Couverture** : tout le commercial register CH + 15 000 entités hors registre (sole traders, particuliers).
- **Format** : SOAP web service (CrediCONNECT), XML/PDF/CSV. Pas de REST moderne par défaut.
- **Cible** : créanciers, fiduciaires, PME, leasing.
- **Force** : seul à couvrir sole traders + particuliers, ancrage suisse historique.
- **Faiblesse** : stack technique vieillissante (SOAP), interface peu moderne, pas développeur-friendly.
- **Revenu / employés** : ~200 employés CH (40 pour Romandie GNT seul), ~4 350 globalement. Revenu groupe 50-100M USD selon sources.
- **Menace pour openswissdata** : 2/5. Verticale credit reporting, peu de chevauchement direct.

#### 5. Intrum Suisse — intrum.ch
- **Pricing** : opaque, sur devis. Modèle dépendant du volume et durée de contrat.
- **Couverture** : credit info CH, recouvrement, scoring.
- **Format** : REST API moderne pour intégrations onboarding.
- **Cible** : finance, e-commerce, recouvrement.
- **Force** : un des deux leaders credit scoring CH avec CRIF, présence européenne.
- **Faiblesse** : focus debt collection > data pure, peu pertinent pour data engineers cherchant classifications.
- **Revenu / employés** : groupe Intrum 1,73 Mds USD ARR, 8 381 employés mondiaux. Suisse : entité Lausanne.
- **Menace pour openswissdata** : 1/5. Verticale recouvrement, pas en concurrence frontale.

#### 6. OpenSanctions — opensanctions.org
- **Pricing** : **transparent** ! Bulk data license 595 EUR/mois (~580 CHF), API pay-as-you-go avec volume discount à partir de 20k req/mois. Free non-commercial. Trial 30 jours business email.
- **Couverture** : 4M+ entités, 286 sources sanctions/PEP/criminels globaux. Pas de couverture commercial register CH.
- **Format** : API REST, dump JSON/CSV/Excel, on-prem matching service open-source.
- **Cible** : compliance, fintech, banques, RegTech.
- **Force** : standard de fait, pricing dev-friendly, open-core, zéro investisseur externe (sain financièrement).
- **Faiblesse** : couverture sanctions/PEP, pas data CH structurée (NOGA/TARES/FINMA absent).
- **Revenu / employés** : 14 employés (estimation Berlin GmbH), centaines de clients commerciaux, 90 pays.
- **Menace pour openswissdata** : 3/5. **Modèle business le plus inspirant**. Concurrence indirecte mais référence à imiter pour pricing transparent et open-core.

#### 7. KYC Spider — kyc.ch
- **Pricing** : opaque, sur devis. Plateforme d'abonnement.
- **Couverture** : KYC due diligence, AML screening, vidéo-ID, media screening. Pas de dataset pur.
- **Format** : SaaS web app + API.
- **Cible** : banques CH, intermédiaires financiers, fintechs, blockchain/PSAN.
- **Force** : Swiss-hosted, conformité FINMA, joint-venture MME (cabinet compliance).
- **Faiblesse** : ne vend pas de data brute, vend une plateforme. Pas de chevauchement direct.
- **Revenu / employés** : ~11 employés, taille TPE.
- **Menace pour openswissdata** : 1/5. Solution complète vs data brute = segments différents.

#### 8. FPRE / Novalytica — fpre.ch / novalytica.com
- **Pricing** : opaque, custom enterprise. FPRE propose 40 méthodes API location/valuation.
- **Couverture** : real estate CH (transactions, hedonic models, location ratings, construction costs).
- **Format** : API REST, Excel add-in, MarketAnalyzer web app.
- **Cible** : banques hypothécaires, assureurs, gestionnaires immo.
- **Force** : standards de fait pour real estate analytics CH, profondeur de modèles.
- **Faiblesse** : focus immo uniquement, pas de classifications NOGA/TARES/FINMA.
- **Revenu / employés** : FPRE 14,8M USD ARR, 50-100 employés estimés. Novalytica plus petit (~10-20 employés).
- **Menace pour openswissdata** : 1/5. Verticale immo distincte du catalogue actuel openswissdata.

### Concurrents adjacents / alternatives

#### 9. Apify scrapers (Zefix, Moneyhouse, search.ch)
- **Pricing** : self-serve marketplace, ~5-50 USD/mois selon volume scrappé.
- **Couverture** : Zefix 600k+ entités, search.ch 2M+ listings, Moneyhouse 630k+.
- **Format** : scrapers actor-based, output JSON/CSV.
- **Cible** : développeurs bricoleurs, data engineers cheap.
- **Force** : pricing super accessible, self-serve total.
- **Faiblesse** : zone grise légale (TOS Moneyhouse interdisent scraping), fragile (cassent quand le site change), pas normalisé.
- **Menace pour openswissdata** : **4/5**. C'est l'alternative gratuite/quasi-gratuite que les devs utilisent par défaut. Preuve qu'il y a une demande non satisfaite par les officiels.

#### 10. Vatstack / vatify.eu / vatapp.net (UID/MWST cross-border)
- **Pricing** : Vatstack freemium, Developer plan free for life, métré au-delà. Vatify free 30 req/mois.
- **Couverture** : VAT EU + CH + UK + Norvège + Australie + Singapour + Thaïlande.
- **Format** : API REST simple.
- **Cible** : fintech, billing software, e-commerce cross-border.
- **Force** : pricing dev-first, signup self-serve immédiat, focus produit clair.
- **Faiblesse** : CH traité "second-class", pas de cross-ref UID + commercial register CH, pas de webhook statut.
- **Menace pour openswissdata** : 3/5 sur l'angle Swiss VAT API+ identifié dans le market-demand. Templates à imiter techniquement.

#### 11. SwissParliament data — parlement.ch
- **Pricing** : gratuit (open data).
- **Couverture** : OData officielle + OpenParlData.ch (78 parlements CH harmonisés).
- **Format** : OData XML legacy + REST API moderne (OpenParlData).
- **Cible** : journalistes, ONG, chercheurs.
- **Force** : gratuit et complet sur son scope.
- **Faiblesse** : scope étroit (parlementaire), aucun chevauchement business commercial.
- **Menace pour openswissdata** : 0/5.

#### 12. opendata.swiss — portail officiel CH
- **Pricing** : 100% gratuit.
- **Couverture** : 10 000+ datasets CH (BFS, cantons, communes, OFEN, etc).
- **Format** : CKAN API metadata, datasets en CSV/JSON/XLSX bruts.
- **Cible** : tout public.
- **Force** : exhaustif, gratuit, légitime.
- **Faiblesse** : **données brutes non normalisées**, formats hétérogènes, pas de SLA, aucun support, aucune fraîcheur garantie. C'est exactement le **problème** que résout openswissdata.
- **Menace pour openswissdata** : **4/5 mais c'est aussi LA matière première**. Risque qu'un client dise "je peux le faire moi-même gratuit" — argument à neutraliser sur la landing.

#### 13. Bundesamt für Statistik (BFS) — bfs.admin.ch
- **Pricing** : la plupart gratuit via opendata.swiss et data.bfs.admin.ch. Vente directe parfois pour datasets agrégés/personnalisés (devis).
- **Couverture** : statistiques CH exhaustives (NOGA, démographie, économie, immo).
- **Format** : Web (Px-Web), API STAT-TAB, CSV/JSON.
- **Cible** : tous secteurs.
- **Force** : source officielle de référence.
- **Faiblesse** : ergonomie data engineer faible, pas de format API moderne unifié, multi-fichiers à joindre.
- **Menace pour openswissdata** : 2/5. Source amont, pas concurrent direct.

#### 14. AFC / BAZG / FINMA publications officielles
- **Pricing** : gratuit (publications légales).
- **Couverture** : registre intermédiaires assurances FINMA, instituts autorisés FINMA, TARES BAZG, listes UID AFC.
- **Format** : web search forms, PDF, parfois CSV exportables, parfois API limitée.
- **Cible** : grand public régulé.
- **Force** : source officielle.
- **Faiblesse** : ergonomie 2010, pas d'API standard, pas de webhook diff, pas de versioning.
- **Menace pour openswissdata** : 1/5. **Source amont**. Le travail d'openswissdata = transformer ces sources en datasets normalisés.

---

## III — Matrice positionnement

```
                  SOLUTION COMPLÈTE (UI / scoring / alertes)
                                  ▲
                                  │
                Moneyhouse  ●     │     ● D&B / Bisnode
                                  │
                KYC Spider ●      │     ● CRIF
                                  │     ● Creditreform
                                  │     ● Intrum
                FPRE / Novalytica ●    
                                  │
   SELF-SERVE  ◀──────────────────┼──────────────────▶  SALES-LED
   (pricing                       │                       (devis,
   transparent)                   │                       contrat)
                                  │
       Vatstack / vatify ●        │
                                  │
       OpenSanctions ●            │
                                  │
       Apify scrapers ●           │
                                  │
   ★ openswissdata ★              │
                                  │
       opendata.swiss ●           │
       SwissParliament ●          │     ● BFS / AFC / BAZG / FINMA
                                  │       (officiel, gratuit, brut)
                                  ▼
                       DATA BRUTE NORMALISÉE
```

**Lecture** : openswissdata occupe la zone **self-serve + data brute normalisée**, où il n'y a aujourd'hui que des scrapers fragiles (Apify) et de la data officielle non normalisée (opendata.swiss, BFS). C'est exactement la même position qu'OpenSanctions sur le segment sanctions/PEP — preuve que le modèle marche.

---

## IV — 5 trous de marché réels

### 1. Self-serve + pricing transparent + data CH = quadrant vide
Tous les concurrents directs (Moneyhouse, D&B, CRIF, Creditreform, Intrum) sont sales-led avec pricing opaque. Aucun ne propose signup → paiement Stripe → download ZIP en 60 secondes. C'est le coeur du positionnement openswissdata et le delta clair vs incumbents.

### 2. NOGA/NACE/ISIC normalisé avec joins prêts
Aucun concurrent ne vend NOGA propre avec join NACE/ISIC + cross-walks stables versionnés. BFS publie en CSV brut multi-fichiers. C'est de la valeur pure pour data engineers SaaS B2B.

### 3. TARES douanes en JSON/API moderne
BAZG publie TARES via interface web 2010. Personne ne vend l'export JSON normalisé avec versioning. Niche petit volume mais ARPU élevé (équipes douanes internes corporates, fiduciaires conseil import/export).

### 4. FINMA registry diffé / webhook
FINMA publie listes statiques. Personne ne vend "FINMA registry diff API" qui notifie quand un acteur entre/sort des listes. Cible clé : compliance officers fintechs, banques, family offices.

### 5. Bridge entre opendata.swiss et le monde dev / API
opendata.swiss est riche mais inutilisable directement. Trou pour un acteur "Stripe-grade DX" qui transforme datasets officiels en API REST + SDK + webhooks + SLA. Modèle = Algolia vs Solr, ou Stripe vs PSP traditionnels.

---

## V — 3 menaces existentielles 12 mois

### Menace 1 : Un éditeur officiel pivote vers le dev-friendly
Le BFS (ou plus probablement un cantonal innovant comme l'OFS Vaud ou ETH) lance une API REST moderne unifiée avec authentification + métering. Si gratuit, openswissdata devient redondant pour 80% des datasets simples. **Mitigation** : se positionner sur la **valeur ajoutée normalisation + diff + SLA** plutôt que data brute, et signer rapidement des early adopters payants pour stack long-term contracts.

### Menace 2 : OpenSanctions étend sa couverture Swiss
OpenSanctions a déjà un excellent modèle (open-core, pricing transparent, dev-first). S'ils lancent un dataset "Swiss Companies" en miroir de Zefix avec leur infra existante, ils peuvent capter le marché en 6 mois. Ils ont les compétences et la distribution. **Mitigation** : aller plus profond sur des datasets **non-entité** où OpenSanctions n'irait pas (TARES, NOGA, paie, immo parcellaire, charges sociales). Catalogue spécialisé CH.

### Menace 3 : Concurrent local CH bien financé (CrunchBase signal)
Un concurrent CH avec budget et équipe pourrait lancer un produit similaire en 3-6 mois. Indices à surveiller : levées seed pour startups data CH, side-projects de data engineers ETHZ, ouverture de positions "data product manager" chez fintechs CH. **Mitigation** : créer un **moat de distribution** (SEO long-tail "NOGA codes API", "TARES JSON", "FINMA list webhook"), un MCP server installé chez les utilisateurs Claude Code (lock-in léger), partenariats fiduciaires/cabinets pour referrals.

---

## VI — 3 conseils stratégiques pour Alain

### Conseil 1 : Prendre OpenSanctions comme étoile polaire — pricing transparent, open-core partiel, MCP-first
OpenSanctions a démontré qu'un produit data B2B niche peut passer 0 → centaines de clients commerciaux dans 90 pays avec 14 personnes et zéro investisseur. Leur recette : pricing public (595 EUR/mois bulk + pay-as-you-go API), trial 30 jours self-serve, schémas open-source (FollowTheMoney), contenu technique régulier. **Action concrète** : publier le schéma OSDSDR en open-source sur GitHub, écrire un changelog hebdomadaire en public, packager un MCP server openswissdata pour Claude Code (touche directement la cible data engineers + LLM-native dev qui est ta tribu).

### Conseil 2 : Choisir UN dataset qui résout UN cauchemar récurrent et le packager parfaitement avant d'élargir
Avec 10-15h/semaine et 5k CHF de budget, étaler sur 3 datasets dilue tout. Le market-demand-analysis identifie déjà le "Swiss VAT API+" comme gateway idéal : volume gigantesque, ticket bas récurrent, douleur claire et documentée, concurrents étrangers traitent CH "second-class". **Action concrète** : packager UN dataset (par exemple "Swiss VAT API+" ou "FINMA Registry Diff") avec démo cliquable + curl one-liner + Postman collection + MCP server. Convertir 10 acheteurs payants à 299-799 CHF (modèle dataset actuel) ou — si tu introduis une gamme récurrente API en complément — 99-199 CHF/mois en 90 jours, puis utiliser leur usage et témoignages comme preuve sociale pour vendre les autres datasets.

### Conseil 3 : Construire le moat distribution avant le moat data
Tes datasets seront copiables (sources publiques). Ton moat n'est pas la data, c'est la distribution + DX. Quatre canaux à activer en parallèle, faible coût : (a) **SEO programmatique** sur 200+ pages "code NOGA XX.XX → activité française+allemande+italienne", (b) **MCP marketplace** (Smithery, MCP.so) pour capter les développeurs LLM-native — early window 2026, (c) **PR open-source awesome-lists** (awesome-swiss, awesome-fintech-ch, awesome-mcp-servers), (d) **partenariats de bouche-à-oreille** avec 5 fiduciaires/cabinets CH qui te referral en échange d'un dataset gratuit + commission. Ces canaux sont compatibles avec 10-15h/sem et budget ≤5k CHF, et créent de la rétention organique que les concurrents établis (sales-led B2B) ne peuvent pas répliquer rapidement.

---

## Sources

- [Moneyhouse Enterprise & API](https://www.moneyhouse.ch/en/enterprise) — pricing devis, 11-50 employés, 13,6M USD ARR
- [D&B Switzerland](https://www.dnb.com/en-ch/) — ex-Bisnode 720M CHF acquisition 2021
- [CRIF Swiss API](https://developer.crif.com/apis) — 28 employés CH, 2,8M USD CH, groupe 896M USD
- [Creditreform Switzerland](https://www.creditreform.ch/en) — 200 employés CH
- [Intrum AB](https://www.intrum.com/) — groupe 1,73 Mds USD, 8 381 employés
- [OpenSanctions Pricing](https://www.opensanctions.org/faq/29/pricing-tier/) — 595 EUR/mois bulk, 14 employés Berlin
- [KYC Spider](https://www.kyc.ch/) — 11 employés Zurich, joint-venture MME
- [FPRE](https://en.fpre.ch/marktdaten/api/) — 14,8M USD ARR, API 40 méthodes
- [Novalytica](https://novalytica.com/) — Bern, custom pricing
- [Apify Zefix Scraper](https://apify.com/santamaria-automations/zefix-ch-scraper)
- [Vatstack pricing](https://vatstack.com/pricing) — freemium, Developer plan free for life
- [SwissParliament Open Data](https://www.parlament.ch/en/services/open-data-webservices) — gratuit
- [opendata.swiss](https://opendata.swiss/de) — gratuit, CKAN API
- [BFS open data](https://www.bfs.admin.ch/bfs/en/home/services/ogd.html)
- [FINMA registers](https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/)
