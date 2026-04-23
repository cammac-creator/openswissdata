# Découvertes datasets — 6 explorations en parallèle

Date : 2026-04-23
Méthode : 6 agents Claude Code en parallèle, chacun spécialisé sur un angle.
Statut : tous les datasets ci-dessous ont une source officielle libre vérifiée ou inferrée (URL marquée `[V]` = HTTP 200 vérifié, `[I]` = inferré).

## TL;DR — Top 10 transverse classé par ROI

ROI = (ticket × marché potentiel) ÷ (effort × risque légal)

| # | Dataset | Prix CHF/an | Effort | Marché captif | Concurrence |
|---|---|---|---|---|---|
| 1 | **Bundle Sanctions+ (SECO+UN+OFAC+EU)** | 1200 | 2-3j | Toute banque/fintech CH | OpenSanctions 6k+, Dow Jones 30k+ |
| 2 | **Quellensteuertarife cantonales** | 600-1500 | 0.5j | Tout SaaS payroll CH | Aucun en JSON |
| 3 | **Cours change AFC/TVA** *(quick win)* | 400-1200 | 0.2j | Tout ERP/comptabilité CH | XE/Fixer (non officiels) |
| 4 | **SHAB Amtsblattportal flux** | 490-1500 | 1j | Recouvrement, M&A, presse éco | Creditreform (cher) |
| 5 | **RegBL/GWR (EGID bâtiments)** | 990-1490 | 1j | Banques hypothécaires | FPRE/IAZI/Wüest 5-50k |
| 6 | **Mix énergétique Pronovo (ESG Scope 2)** | 890-1490 | 1-2j | Conseils ESG, fintech climat | Aucun en CH |
| 7 | **Zefix snapshot via LINDAS** | 290-990 | 1j | Sales intel, KYC, M&A | Moneyhouse, D&B |
| 8 | **GLEIF LEI Switzerland enrichi** *(quick win)* | 99-290 | 0.25j | KYC, AML, banques | GLEIF gratuit brut |
| 9 | **STATENT commune × NOGA** | 290-790 | 1j | Retail siting, banques pro | Aucun packagé |
| 10 | **Jours fériés CH cantonaux + scolaires** *(long tail)* | 99-149 | 0.3j | Tout SaaS RH/payroll | Aucun en CH |

---

## Bundles stratégiques recommandés

### 🛡 « Swiss Compliance Pack » — 1990 CHF/an
- Bundle Sanctions+ (SECO + UN + OFAC + EU)
- GLEIF LEI Switzerland
- Zefix snapshot trimestriel
- FINMA Registry (déjà existant)

→ Cible : compliance officers banques/fintech CH. Concurrent direct OpenSanctions à 6k+, Dow Jones à 30k+. **No-brainer pour PME suisses qui veulent une facture en CHF + support FR/DE.**

### 💼 « Swiss Payroll Pack » — 2490 CHF/an
- Quellensteuertarife 26 cantons (refresh mensuel)
- Cours change AFC/TVA (API daily)
- Allocations familiales par canton
- Plafonds AVS/LPP historisés
- LSE salaires médians (refresh annuel)
- Jours fériés + calendrier scolaire 26 cantons

→ Cible : Bexio, Abacus, Lano, Deel, Remote, fiduciaires, ERP RH. **Marché captif annuel — chaque éditeur en a besoin.**

### 🏘 « CH Real Estate Atlas » — 3990 CHF/an
- RegBL/GWR (EGID + 2.3M bâtiments + 4.6M logements)
- swissTLM3D footprints bâtiments
- swissBOUNDARIES3D (communes/cantons/lacs)
- Cartes dangers naturels BAFU (crues, glissements, séismes)
- Zones d'aménagement ARE harmonisées

→ Cible : banques hypothécaires, assureurs immo, FPRE-killers. Wüest Partner facture l'équivalent 50k+. **Marge énorme, marché solvable.**

### 🏢 « Swiss Companies Intelligence » — 1490 CHF/an
- Zefix snapshot (~750k entités) via LINDAS
- NOGA codes (déjà existant — Classifications)
- GLEIF LEI Switzerland (~15k LEI actifs CH)
- STATENT établissements/emplois par commune × NOGA
- SHAB faillites + HR daily

→ Cible : sales intel, BD, M&A, recruteurs, fiduciaires.

---

## Détails par catégorie

### 🛡 1. Compliance / AML / Sanctions / KYC

| Dataset | Source officielle | Format | Volume | Prix CHF/an | Effort |
|---|---|---|---|---|---|
| **SECO sanctions consolidées CH** | sesam.search.admin.ch [V] | XML XSD documenté | ~37 Mo, ~16.5k entités | 250-800 | 0.5j |
| **UN consolidated sanctions** | scsanctions.un.org/resources/xml/en/consolidated.xml [V] | XML | ~15 Mo, ~1k entrées | bundle | 0.5j |
| **OFAC SDN** | sanctionslistservice.ofac.treas.gov [V] | XML/CSV/JSON | ~30 Mo, ~10k entrées | bundle | 0.5j |
| **EU CFSP financial sanctions** | webgate.ec.europa.eu/fsd/fsf [V] | XML 1.1 | >10 Mo | bundle | 0.5j |
| **AIPS Swissmedic** | download.swissmedicinfo.ch [V] | XML (login partenaire) | ~10k produits | 800-2000 | 1j |
| **Refdata GTIN pharma** | refdata.ch [I] | XML quotidien | ~120k articles | 500-1500 | 0.5j |
| **Refdata Partner GLN** | refdata.ch [I] | XML quotidien | ~80k GLN | 400-1200 | 0.5j |
| **MedReg médecins/dentistes** | i14y.admin.ch/MedRegPerson [I] | API I14Y | ~40k pros | 300-800 | 1j |
| **Zefix REST + LINDAS** | zefix.admin.ch [V] | JSON/RDF | ~750k entités | 600-2000 | 1j |

**A éviter** : FINMA warning list (pas d'export structuré, scraping fragile, ToS ambigu).

### 💼 2. Fiscalité / Payroll / RH

| Dataset | Source officielle | Format | Prix CHF/an | Effort |
|---|---|---|---|---|
| **Quellensteuertarife cantonaux** | estv.admin.ch/qst-tarife-loehne [V] | TXT/ZIP Swissdec | 600-1500 | 0.5j |
| **Cours change AFC/TVA** | backend-rates.bazg.admin.ch/api/xmlavgmonth [V] | **API XML** | 400-1200 | **0.2j** |
| **AVS/AI/APG/AC taux + plafonds** | bsv.admin.ch [I] | PDF→JSON | 100-300 | 0.3j |
| **LPP seuils** | bsv.admin.ch BVG [I] | PDF | 150-400 | 0.3j |
| **AANP/AAP SUVA** | suva.ch/taux-de-base [V] | HTML/PDF | 400-800 | 1j |
| **Allocations familiales** | bsv.admin.ch FamZ [I] | PDF cantonaux | 300-700 | 0.5j |
| **Indices BFS (LIK/IPC)** | pxweb.bfs.admin.ch [V] | API PxWeb JSON | 300-900 | 0.5j |
| **CCT étendues sectorielles** | seco.admin.ch [I] | PDF (extraction structurée) | 800-2000 | 2-3j |
| **LSE salaires médians** | bfs.admin.ch/lse [V] | PxWeb JSON | 500-1500 | 0.5j |

### 🏘 3. Immobilier / Géo / Cadastre

| Dataset | Source officielle | Format | Volume | Prix CHF/an | Effort |
|---|---|---|---|---|---|
| **RegBL/GWR (EGID)** | housing-stat.ch [V] | CSV | 2.3M bâtiments + 4.6M logements | 990-1490 | 1j |
| **swissTLM3D footprints** | data.geo.admin.ch [V] | GeoPackage | ~3 Go | 1490-1990 | 2j |
| **swissBOUNDARIES3D** | data.geo.admin.ch [V] | GeoPackage/Shapefile | ~150 Mo | 290 | 0.5j |
| **swissNAMES3D** | data.geo.admin.ch [V] | GeoPackage | ~200 Mo, 400k+ points | 390 | 1j |
| **Cartes dangers naturels BAFU** | data.geo.admin.ch/ch.bafu.* [I] | WMS/Shapefile | ~500 Mo | 1490 | 2j |
| **Zones d'aménagement ARE** | data.geo.admin.ch/ch.are.bauzonen [I] | GeoPackage | ~50 Mo | 990 | 1.5j |
| **Cadastre RDPPF (OEREB)** | api.geo.admin.ch [I] | GeoJSON par parcelle | fragmenté cantonal | 1490 | 3j |
| **STATPOP par hectare** | bfs.admin.ch [V] | CSV ~600 Mo | ~2.7M lignes | 690 | 1j |
| **Liste communes + fusions** | agvchapp.bfs.admin.ch [I] | XML/CSV/JSON API | 2130 communes + 6000 mutations | 190 | 0.5j |
| **OFL prix loyers** | bwo.admin.ch [I] | XLSX | par commune/typologie | 590 | 0.5j |

**A éviter** : CECB (risque légal flou), swissALTI3D (volume To, niche), PLR communaux (fragmentation extrême).

### ⚡ 4. Transport / Énergie / Utilities

| Dataset | Source officielle | Format | Volume | Prix CHF/an | Effort |
|---|---|---|---|---|---|
| **Mix énergétique Pronovo (ESG)** | stromkennzeichnung.ch [V] | HTML/PDF + scraping | ~700 fournisseurs | 890-1490 | 1-2j |
| **OFCOM antennes mobiles** | bakom + opendata.swiss [I] | dataset géospatial | ~25k antennes 2/3/4/5G | 690-990 | 1-2j |
| **OFEV émissions par commune** | bafu.admin.ch/EMIS [I] | CSV | national + communes | 590-990 | 2-3j |
| **OFROU accidents géocodés** | astra.admin.ch [I] | CSV via STAT-TAB | ~17k/an | 490-790 | 1j |
| **MétéoSuisse historique** | opendatadocs.meteoswiss.ch [V] | CSV (API 2026) | ~160 stations 30 ans | 390-690 | 2j |
| **OFSP hôpitaux + médecins/canton** | bfs.admin.ch [I] | CSV | ~280 hôpitaux + densité | 490-790 | 1-2j |
| **NAQUA qualité eau** | bafu.admin.ch [I] | sur commande email + API hydro | ~600 stations | 490-790 | 2j |
| **ASTRA péages/zones env.** | astra.admin.ch [I] | CSV/GeoJSON | restreint | 390-590 | 1-2j |

**A éviter** : GTFS CFF (réciprocité opentransportdata = obligation reversement), prix carburants (TCS propriétaire), SIX bourse (paywall lourd).

### 🏢 5. Entreprises / Commerce / IP

| Dataset | Source officielle | Format | Volume | Prix CHF/an | Effort |
|---|---|---|---|---|---|
| **SHAB / Amtsblattportal API** | amtsblattportal.ch/api/v1 [I, doc 200] | XML/CSV | ~300k publications/an | 490-1500 | 1j |
| **Zefix snapshot LINDAS** | register.ld.admin.ch [V] | RDF/SPARQL | ~750k actives | 290-990 | 1j |
| **opendata.swiss Zefix+NOGA enrichi** | opendata.swiss [I] | CSV | ~400k+ NOGA-tagged | 190-490 | 0.5j |
| **GLEIF LEI Switzerland** | api.gleif.org filtre CH [V] | JSON/CSV | ~15k LEI actifs CH | 99-290 | 0.25j |
| **Swissreg trademarks (IPI)** | swissreg.ch/api [V] | XML+ZIP | ~600k marques actives | 390-1200 | 1j |
| **Swissreg patents** | swissreg.ch/api [V] | XML | ~50k actifs CH + EP | 290-790 | 1j |
| **Swissreg designs** | swissreg.ch/api [V] | XML | ~25k designs | 99-290 | 0.5j |
| **simap.ch tenders alertes** | simap.ch/api [I] | JSON/XML eForms | ~25k avis/an | 490-1900 | 1j |
| **STATENT commune × NOGA** | bfs.admin.ch/statent [I] | CSV/PX | granularité commune | 290-790 | 1j |
| **STATPOP commune historisé** | bfs.admin.ch/statpop [I] | CSV | 2200 communes × 30 ans | 99-190 | 0.5j |

**A éviter** : annuaire avocats cantonaux (26 sources fragmentées), licences alcool (pas fédéral), patronymes (B2C plutôt que B2B).

### 🎯 6. Long-tail niche (50-300 CHF)

| Dataset | Source officielle | Format | Volume | Prix CHF | Effort |
|---|---|---|---|---|---|
| **Jours fériés cantonaux + scolaires** | data.bs.ch + 26 cantons [V] | CSV/JSON | 26 cantons × 365j × 10 ans | 99-149 | 0.3j |
| **Calendrier scolaire 26 cantons** | daten.stadt.sg.ch + autres [V] | CSV | ~3000 lignes/an | 79-129 | 0.3j |
| **Ortschaften CH (NPA + commune + canton + langue)** | swisstopo via opendata.swiss [V] | CSV/GPKG | ~5000 localités | 149-249 | 0.4j |
| **Caisses-maladie LAMal officielles** | bag.admin.ch [V partial] | PDF→CSV | ~50 caisses | 99-149 | 0.4j |
| **Pharmacies CH 26 cantons** | data.bl.ch + autres [V] | CSV | ~1800 pharmacies | 149-199 | 0.5j |
| **Bornes recharge VE** | opendata.swiss [V] | CSV/GeoJSON | ~10k points | 99-179 | 0.4j |
| **Arrêts transport CH (didok)** | opentransportdata.swiss [V] | CSV | ~28k arrêts | 99-149 | 0.3j |
| **Taux change BNS historiques** | data.snb.ch [V] | CSV/JSON API | 30+ devises × 25 ans | 99-179 | 0.4j |
| **Bibliothèques publiques CH** | opendata.swiss [V] | CSV/GeoJSON | ~2000 bibliothèques | 49-99 | 0.3j |
| **Crèches/Kitas CH** | opendata.swiss ZH+TG [V] | CSV | ~3500 structures | 79-129 | 0.3j |
| **Musées CH avec NOGA + finances** | opendata.swiss BFS [V] | XLSX | ~1100 musées | 79-129 | 0.3j |
| **Inventaires bâtiments protégés** | opendata.swiss [V] | CSV/GeoJSON | ~80k objets | 149-249 | 0.5j |
| **Comptages trafic routier** | opendata.swiss 39 datasets [V] | CSV | TB séries temps | 199-299 | 0.5j |
| **Lehrbetriebe (entreprises formatrices)** | opendata.swiss + SBFI [V] | CSV | ~60k entreprises | 149-249 | 0.4j |
| **Réseau gares CFF + accessibilité PMR** | data.sbb.ch [V] | CSV/JSON API | ~1800 gares | 99-149 | 0.3j |
| **Hôtellerie HESTA mensuel** | opendata.fr.ch + BFS [V] | CSV | 30 ans × régions | 99-179 | 0.4j |
| **Sportanlagen CH** | opendata.swiss [V] | GeoJSON | ~30k installations | 79-129 | 0.4j |

---

## Roadmap recommandée 8-12 semaines

### Semaine 1-2 : Quick wins (3 datasets)
1. **Cours change AFC/TVA** — 0.2j ingest, lance la catégorie "Payroll/Finance" (400-1200 CHF/an)
2. **GLEIF LEI Switzerland** — 0.25j, complément immédiat de FINMA dans bundle Compliance
3. **Jours fériés cantonaux + scolaires** — 0.3j, lance la catégorie "HR" avec un produit à 99 CHF

### Semaine 3-4 : Premiers piliers payants
4. **SHAB Amtsblattportal flux** — 1j, premier add-on TARES (490-1500 CHF)
5. **Quellensteuertarife cantonales** — 0.5j, marché captif payroll (600-1500 CHF)
6. **Bundle Sanctions+** — 2-3j, **probable best-seller** (1200 CHF)

### Semaine 5-8 : Premium & stratégique
7. **RegBL/GWR EGID** — 1j, lance "CH Real Estate Atlas"
8. **Zefix LINDAS snapshot** — 1j, mère de toutes les bases B2B
9. **Mix énergétique Pronovo** — 1-2j, surf sur la vague ESG
10. **STATENT commune × NOGA** — 1j, complément naturel NOGA

### Semaine 9-12 : Bundles structurés
- Lancer les 4 bundles (Compliance, Payroll, Real Estate, Companies)
- Mettre 5-10 datasets long-tail à 99 CHF en self-serve

---

## Sources vérifiées

Endpoints HTTP 200 confirmés ce jour : SECO sesam, UN sanctions, OFAC SDN, EU CFSP, swissNAMES3D, housing-stat (RegBL), CECB (registre), Pronovo cockpit, ElCom prix élec, MétéoSuisse opendatadocs, ich-tanke-strom, ESTV Quellensteuer, BAZG cours change XML, BFS PxWeb, BFS LSE, Zefix REST, Swissreg API doc, GLEIF API, opendata.swiss CKAN API.
