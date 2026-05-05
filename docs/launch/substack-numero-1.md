# Substack inaugural · ETL Fédéral Suisse #1

**Envoyé jeudi 7 mai 8h00 CEST**
**Destinataires** : mailing-list pré-construite (~200-400 contacts collectés via réseau perso, GitHub stars, formulaires waitlist)
**De** : `etl-federal@send.openswissdata.com` (sous-domaine dédié, pas le perso)

---

## Objet email

`#1 — Le numéro inaugural · 5 changements fédéraux que vous avez raté cette semaine`

---

## Pré-header (50 caractères max)

`5 changements officiels CH · sans jargon · au format scannable`

---

## Corps

# Le numéro inaugural

Bonjour 👋

Cette newsletter recense les **changements concrets** aux référentiels fédéraux suisses (douanes, classifications économiques, surveillance financière) — sans jargon, sans pub, au format scannable. Un numéro chaque jeudi à 8h, 5 changements maximum, jamais plus.

Si vous travaillez en compliance, data engineering, conformité douanière ou intégration ERP suisse, vous avez probablement raté ces 5 changements. C'est exactement ce que cette newsletter va corriger pour vous semaine après semaine.

---

## 🛃 BAZG — Tarif douanier (TARES)

**Cette semaine** : 12 nouveaux codes HS8 ajoutés (chapitres 84 et 90 — machines, instruments). 3 codes retirés en chapitre 84.

**Pourquoi ça compte** : si votre ERP roule encore sur la version `tariff_8_digit.xlsx` du mois dernier, votre prochaine déclaration douanière peut bloquer. Le diff complet est versionné dans nos releases hebdomadaires.

[Vérifier sur xtares.admin.ch](https://xtares.admin.ch/) → search le code

---

## 🏦 FINMA — Registre des assujettis

**Cette semaine** : 1 nouvelle entité PSP autorisée (Sygnum Cards SA), 2 entités retirées du registre, 1 changement de statut "active → withdrawn" sur une banque cantonale.

**Pourquoi ça compte** : pour vos onboardings KYC, ces 4 changements peuvent bloquer ou débloquer un partenariat fournisseur. Le registre FINMA officiel publie au format XLSX morcelé en 10 listes — chez nous, c'est unifié et signé.

[FINMA registry officiel](https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/)

---

## 🏛 BFS / OFS — NOGA 2025

**Cette semaine** : 12 sous-classes du secteur 62 (informatique) renommées pour aligner sur NACE 2.1. Aucun code ajouté ou retiré, juste des labels qui changent.

**Pourquoi ça compte** : si votre customer master classe les clients en NOGA 2025, votre reporting ESG / risque sectoriel doit potentiellement être ré-étiqueté. Les libellés FR/DE/IT changent, pas les codes.

[NOGA 2025 i14y.admin.ch](https://www.i14y.admin.ch/)

---

## 🇪🇺 Eurostat — NACE Rev 2.1

**Cette semaine** : transition NACE Rev 2 → Rev 2.1 effective au 1er janvier 2026. Si vos rapports consolidés UE roulent encore sur Rev 2, c'est le moment de migrer (refus possible côté maison-mère DE/FR).

**Notre cross-walk** : les 5 nomenclatures (NOGA 2008/2025, NACE 2.0/2.1, ISIC 4) sont alignées dans une table canonique unique. Une JOIN, pas 25.

---

## ⚖️ Et un peu de méta : pourquoi cette newsletter

Je m'appelle **Alain Martin**. Solo founder bootstrappé en Suisse romande. Je viens de lancer **openswissdata.com** : un service qui livre les données fédérales suisses normalisées, signées Ed25519, branchées MCP pour Claude/Cursor.

Cette newsletter n'est PAS un canal de vente déguisé. C'est une promesse simple : 5 changements / jeudi / 5 minutes de lecture. Si vous voulez aussi le dataset complet (signé, à jour, prêt à brancher), [c'est là](https://www.openswissdata.com/bundle).

À jeudi prochain.

— Alain
[contact@openswissdata.com](mailto:contact@openswissdata.com)

---

**Vous recevez cet email parce que vous vous êtes inscrit volontairement sur openswissdata.com ou parce que je vous ai écrit en pré-launch. Annulation 1-clic en bas de chaque numéro. Conforme nLPD + RGPD. SDR Policy : openswissdata.com/legal/sdr-policy**

[Annuler l'inscription en 1 clic]
