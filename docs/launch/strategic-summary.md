# Executive summary — strategy 2026-2028
Synthèse des 2 docs stratégiques produits par l'autre terminal (2026-04-23).
Lecture : 3 minutes.

## Le marché en 1 paragraphe

Le segment "Swiss company data + risk + compliance" est déjà mûr et monétisé (D&B a racheté Bisnode pour ~720M CHF en 2021 ; AML software global passe de 4,1 à 9,4 Mds USD entre 2025 et 2030, CAGR 17,8%), mais il manque une offre self-serve à pricing transparent ciblant développeurs et PME tech. La fenêtre 2026-2028 est structurée par trois catalyseurs réglementaires convergents : **LETA/UBO** (mi-2026, 600k entités suisses), **Pillar Two GIR** (1er dépôt 30 juin 2026), et **DAC8/CARF** (en vigueur janv. 2026) — chacun créant un marché captif de compliance urgente avant commoditisation attendue à partir de 2028.

---

## 3 segments clients prioritaires (par ordre de ROI)

### 1. KYC & Compliance — fintechs, PSANs, banques CH
- **Taille estimée** : ~200-500 entités régulées CH (banques, néobanques, PSAN, brokers, fiduciaires agréées)
- **Point de douleur** : ils paient D&B/Bisnode (cher, opaque) ou bricolent en interne avec scrapers Zefix + OpenSanctions + Excel — personne ne fait le join propre Zefix + UBO + sanctions
- **Prix psychologique** : CHF 1 000-5 000/an (jusqu'à 50 000 pour gros acteurs régulés)
- **Canal d'acquisition** : outreach direct compliance officers + partenariats cabinets KYC Spider/Creditreform + contenu LinkedIn réglementaire
- **Cycle de vente** : 4-12 semaines (procurement + validation légale interne)

### 2. Éditeurs SaaS paie & HR-tech (Bexio, Abacus, Lano, Deel CH)
- **Taille estimée** : ~50-200 éditeurs SaaS ciblant le marché CH + boîtes étrangères embauchant en Suisse
- **Point de douleur** : chaque éditeur maintient ses propres tables d'impôt à la source (AFC ne publie pas de format machine-readable unifié), mise à jour manuelle chaque janvier
- **Prix psychologique** : CHF 500-2 000/an (API récurrente, voire licence par éditeur CHF 5 000-20 000)
- **Canal d'acquisition** : developer-first (doc + API key libre) + partenariats intégrateurs comptables (Treuhand)
- **Cycle de vente** : 2-6 semaines (décision produit, pas procurement)

### 3. Équipes finance/AR de sociétés B2B cross-border + ERP/billing
- **Taille estimée** : marché de volume énorme (toute boîte CH faisant du B2B cross-border), clients ERP comme Stripe Tax, Lexware, Bexio
- **Point de douleur** : Vatstack, vatify, APIstax traitent la Suisse en "second-class" — pas de join UID/MWST + VIES, pas d'historique, pas de webhooks de changement de statut TVA
- **Prix psychologique** : freemium (gateway d'acquisition) + CHF 50-300/mois pour volume/webhooks
- **Canal d'acquisition** : SEO développeur ("Swiss VAT API", "UID validation CH") + Product Hunt + intégrations ERP
- **Cycle de vente** : 1-3 semaines (self-serve)

---

## 3 datasets v2 à construire après launch (par ordre de priorité)

### 1. Zefix Snapshot Pro + SECO Sanctions Live (bundle KYC)
- **Problème résolu** : agrégation en un seul dataset de Zefix normalisé (750k entités, organes, journal SOGC) + sanctions consolidées (SECO/UN/EU/OFAC) + diffs quotidiens — aucun concurrent CH-spécifique ne l'offre packagé
- **Prix visé** : Zefix 999 CHF + SECO Sanctions 499 CHF standalone ; bundle "Compliance & KYC Suisse" (Zefix + SECO + FINMA Pro) à ~2 990 CHF
- **Effort d'ingestion** : Zefix REST API Medium (permission FOJ à confirmer) ; SECO XML Low (open data)
- **Acheteurs cibles** : KYC/fintechs, banques, exportateurs, avocats compliance
- **ARR projeté 24m** : estimation subagent CHF 50 000-200 000 (20-70 clients bundle à 2 990 CHF)

### 2. Swiss-Impex Standalone (commerce extérieur HS8 × pays × 2010-2025)
- **Problème résolu** : ~30M lignes de statistiques import/export CH par code douanier, pays partenaires et année — indispensable pour études marché, sourcing, M&A et compléter TARES
- **Prix visé** : 799 CHF one-shot + abonnement mises à jour annuelles (estimation subagent : 299 CHF/an)
- **Effort d'ingestion** : Medium (permission BAZG bulk commercial à confirmer — démarche en cours)
- **Acheteurs cibles** : traders, équipes sourcing, consultants M&A, douaniers
- **ARR projeté 24m** : estimation subagent CHF 20 000-80 000 (updates récurrentes + bundle TARES Pro)

### 3. Fiscalité cantonale unifiée (taux IFD + ICC × commune, déductions)
- **Problème résolu** : agrégation des taux d'impôt IFD + ICC par commune, cantons, déductions — indispensable pour payroll, conseils expatriés, planification fiscale ; ESTV publie mais pas en format unifié exploitable
- **Prix visé** : 899 CHF one-shot + mise à jour annuelle (estimation subagent : 399 CHF/an)
- **Effort d'ingestion** : High (permissions cantonales multiples à obtenir)
- **Acheteurs cibles** : fiduciaires, éditeurs paie, conseillers expats, HR-tech
- **ARR projeté 24m** : estimation subagent CHF 30 000-100 000 (synergies bundle Market Intelligence à 2 490 CHF)

---

## 3 risques majeurs (par ordre de gravité)

### 1. Blocage de permissions (BAZG, BFS, cantons)
- **Probabilité** : élevée (plusieurs demandes en attente ou à initier)
- **Impact** : retarde Swiss-Impex, STATENT, Fiscalité cantonale — datasets clés du bundle Market Intelligence bloqués 3-12 mois
- **Mitigation** : grouper les demandes BFS en attente (NOGA + STATPOP + STATENT) dans une seule démarche ; lancer la demande BAZG pour Swiss-Impex bulk dès maintenant ; identifier un interlocuteur dédié

### 2. Fenêtre LETA/UBO manquée (mi-2026)
- **Probabilité** : moyenne (registre central non-public, accès restreint aux intermédiaires régulés)
- **Impact** : si le registre UBO reste fermé aux acteurs non-régulés, le dataset "CH Entity Graph" perd son différenciateur le plus fort sur 18-24 mois ; CAC manqué sur le segment KYC le plus rentable
- **Mitigation** : construire dès maintenant le pipeline Zefix+SECO+FINMA sans UBO, pour être en position dès que l'accès s'ouvre ; surveiller les décrets d'application LETA

### 3. Concurrence D&B / Moneyhouse sur self-serve
- **Probabilité** : moyenne (ils ont la data mais pricing opaque et peu developer-friendly aujourd'hui)
- **Impact** : si Moneyhouse lance une API self-serve transparente, le différenciateur "facilité + pricing clair" s'érode ; CHF 100k-500k ARR potentiellement contestés
- **Mitigation** : s'ancrer sur les joins multi-sources (FINMA + Zefix + SECO) et les enrichissements structurés que les plateformes mono-source ne feront pas ; moat pipeline > data brute

---

## 3 actions concrètes recommandées dans les 30 prochains jours

1. **Grouper et envoyer la demande BFS consolidée** (NOGA labels EN + STATPOP + STATENT + votations) — owner Alain, délai : avant fin avril 2026
2. **Compléter la demande BAZG pour Swiss-Impex bulk commercial** (en plus de TARES déjà accordé) et vérifier conditions Zefix/FOJ pour usage commercial — owner Alain, délai : 1ère semaine mai 2026
3. **Lancer les enrichissements quick-win V1** sur les 3 datasets actuels : F3+F4+F8 sur FINMA, C1+C7 sur Classifications, T1+T4 sur TARES — repricing immédiat vers 499/599/699 CHF avant mi-mai — owner subagent ETL, délai : 2 semaines

---

## KPIs à surveiller (Plausible + Stripe Dashboard)

| Métrique | Seuil vert | Seuil rouge | Source |
|---|---|---|---|
| Visites uniques / semaine | ≥ 300 | < 100 | Plausible |
| Samples DL / semaine | ≥ 20 | < 5 | Plausible event |
| Checkout session créés / semaine | ≥ 5 | < 1 | Stripe |
| Achats réels / semaine (post Stripe Live) | ≥ 2 | 0 pendant 2 sem. | Stripe |
| Churn renewal dataset | < 20% | > 40% | DB /admin/stats |

---

## Ce que les 2 docs source OMETTENT (à creuser ultérieurement)

- **Aucune estimation de CAC ni de budget marketing** : les docs identifient bien les segments et les canaux d'acquisition, mais ne chiffrent pas ce que coûte réellement d'acquérir un client KYC (outreach, événements fintech, contenu) — à modéliser avant de décider de l'allocation de temps d'Alain
- **Le positionnement "open" vs "premium" n'est pas tranché** : openswissdata joue sur l'open data mais vend des datasets enrichis ; la ligne entre ce qui est gratuit (samples, demo) et ce qui est payant méritera une politique claire pour éviter la dévalorisation du catalogue par les scrapers concurrents
- **Absence de plan de distribution via marketplaces / intégrateurs** : les deux docs ne mentionnent pas de stratégie de distribution via RapidAPI, AWS Data Exchange, Salesforce AppExchange ou partenariats revendeurs — ce canal pourrait accélérer l'acquisition B2B sans effort commercial d'Alain

---

*Source : `docs/market-demand-analysis.md` + `docs/roadmap-datasets.md`. Résumé condensé par un subagent le 2026-04-16.*
