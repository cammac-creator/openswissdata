# Pré-flight #14 — Stripe LIVE switch

Date : 2026-04-25
Statut : ✅ Stripe LIVE actif en production

## Compte Stripe LIVE

- **Account ID** : `***REDACTED — see Stripe dashboard***`
- **Country** : CH
- **Email** : cam@ogens.ch
- **Default currency** : CHF
- **Charges enabled** : ✅ true
- **Payouts enabled** : ✅ true

## Produits + prix créés en LIVE

| Produit | Prix | Type | Stripe Price ID |
|---|---|---|---|
| TARES — Swiss Customs Tariff | **299 CHF** | one-shot | `***REDACTED***` |
| TARES updates | **120 CHF/an** | annuel récurrent | `***REDACTED***` |
| Classifications — NOGA NACE ISIC | **399 CHF** | one-shot | `***REDACTED***` |
| Classifications updates | **160 CHF/an** | annuel récurrent | `***REDACTED***` |
| FINMA Registry | **299 CHF** | one-shot | `***REDACTED***` |
| FINMA updates | **120 CHF/an** | annuel récurrent | `***REDACTED***` |
| Bundle complet (TARES + Classifications + FINMA) | **799 CHF** | one-shot | `***REDACTED***` |

**Product IDs** : `***REDACTED — see Stripe dashboard***`

## Webhook LIVE

- **ID** : `***REDACTED — see Stripe dashboard***`
- **URL** : `https://www.openswissdata.com/api/webhook/stripe`
- **Status** : enabled
- **Events** : `checkout.session.completed`, `invoice.payment_succeeded`
- **Webhook secret** : `***REDACTED — rotated 2026-05-07, see Railway env STRIPE_WEBHOOK_SECRET***`

> ⚠️ **Note 2026-05-07** : Le secret webhook initial avait été leaké en clair dans ce fichier sur le repo public GitHub pendant ~11 jours (entre le commit du 25 avril et la rotation du 7 mai). Action prise : rotation immédiate du webhook secret sur Stripe + redact de ce fichier. Le secret leaké est désormais inactif. Pour effacer aussi de l'historique git : `git filter-repo` (action manuelle, optionnelle).

## Env vars synced

`.env` local mis à jour. Railway sync vérifié pour 9 vars :
- `STRIPE_SECRET_KEY` (sk_live_...)
- `STRIPE_WEBHOOK_SECRET` (whsec_18Kj...)
- `STRIPE_PRICE_TARES` + `STRIPE_PRICE_TARES_UPDATES`
- `STRIPE_PRICE_CLASSIFICATIONS` + `STRIPE_PRICE_CLASSIFICATIONS_UPDATES`
- `STRIPE_PRICE_FINMA` + `STRIPE_PRICE_FINMA_UPDATES`
- `STRIPE_PRICE_BUNDLE`

Ancien Stripe TEST conservé en commentaire dans `.env` pour rollback éventuel.

## Sécurité

- Clé `sk_live_...` stockée uniquement dans `.env` (gitignored) et Railway env (encrypted at rest).
- Webhook signature verification en place (`stripe.webhooks.constructEventAsync` dans `src/routes/stripe-webhook.ts`).
- Rotation de la clé possible à tout moment via `dashboard.stripe.com/apikeys` → Roll.

## Prochaine étape

Pour valider le tunnel LIVE end-to-end, passage à #15 : self-purchase test avec vraie carte sur les 4 SKUs (refundable depuis dashboard).

## Mise à jour 2026-04-30 — refonte du contenu Classifications Pro

⚠️ **Le Stripe Price LIVE existant pour Classifications Pro reste inchangé** (`price_1TRsIN…`, 999 CHF) — pas de modification côté Stripe.

Mais **le contenu livré dans le ZIP Pro a changé** :

### Avant 2026-04-30 (composition initiale)

- Standard (399 CHF) : NOGA 2008/2025 + NACE 2.0/2.1 + ISIC Rev 4 + cross-walks 5-way
- Pro (999 CHF) : Standard + STATENT (978 614 lignes établissements × commune × année) + embeddings NOGA 2025 FR

### Depuis 2026-04-30 (refonte sans STATENT)

- Standard (399 CHF) : **inchangé**
- Pro (999 CHF) : Standard + **3 nouvelles valeurs ajoutées** :
  1. Embeddings multilingues NOGA 2025 (FR + DE + IT + EN, 4 × 1 845 = 7 380 vecteurs 768d) — Apache 2.0
  2. Cross-walks NAICS 2022 ↔ ISIC ↔ NACE/NOGA (US Census Bureau, Public Domain — ~2 100 mappings)
  3. NACE Rev 2.1 EN labels officiels (Eurostat re-use policy, 1 047 lignes stand-alone)

### Raison du retrait STATENT

License `terms_by_ask` de l'OFS exige une autorisation écrite pour utilisation commerciale, qui n'a pas été obtenue. Le code historique (`ingest-statent.ts`, `bundle.ts` STATENT branch, `ingestStatent` test) est conservé dormant pour reproduire bit-identiquement les bundles déjà émis, mais `release.ts` n'instancie plus STATENT pour le tier Pro.

### Action côté Stripe

**Aucune** — le Price ID `price_1TRsIN…` continue de pointer vers le produit `prod_UOg2HYIDH06mD0` Classifications Pro. Le client reçoit le nouveau ZIP avec les 3 valeurs ajoutées au lieu de STATENT.

### Documentation client

- README dans le ZIP Pro mis à jour automatiquement (`bundle.ts` génère le README à partir des artéfacts présents).
- Page produit `/datasets/classifications` (Astro) reformatée pour refléter les 3 nouvelles valeurs ajoutées (cards 01/02/03).
- `etl/classifications/SOURCES.md` mis à jour : sections v3 STATENT marquées "RETIRÉ", nouvelles sections v5 NAICS + v6 NACE EN labels.
