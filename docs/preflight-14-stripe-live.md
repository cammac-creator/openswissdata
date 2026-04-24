# Pré-flight #14 — Stripe LIVE switch

Date : 2026-04-25
Statut : ✅ Stripe LIVE actif en production

## Compte Stripe LIVE

- **Account ID** : `acct_1TP3BlRenAUXTSv7`
- **Country** : CH
- **Email** : cam@ogens.ch
- **Default currency** : CHF
- **Charges enabled** : ✅ true
- **Payouts enabled** : ✅ true

## Produits + prix créés en LIVE

| Produit | Prix | Type | Stripe Price ID |
|---|---|---|---|
| TARES — Swiss Customs Tariff | **299 CHF** | one-shot | `price_1TPsgkRenAUXTSv71LJTvGFn` |
| TARES updates | **120 CHF/an** | annuel récurrent | `price_1TPsglRenAUXTSv7s7nzqTeX` |
| Classifications — NOGA NACE ISIC | **399 CHF** | one-shot | `price_1TPsgnRenAUXTSv7rX8NlOUV` |
| Classifications updates | **160 CHF/an** | annuel récurrent | `price_1TPsgnRenAUXTSv7EDAZPr2E` |
| FINMA Registry | **299 CHF** | one-shot | `price_1TPsgoRenAUXTSv7jicgiBW2` |
| FINMA updates | **120 CHF/an** | annuel récurrent | `price_1TPsgpRenAUXTSv7HWH7WKiB` |
| Bundle complet (TARES + Classifications + FINMA) | **799 CHF** | one-shot | `price_1TPsgqRenAUXTSv7XU8ZdYzq` |

**Product IDs** :
- TARES : `prod_UOg21wzmJpMR6D`
- Classifications : `prod_UOg2HYIDH06mD0`
- FINMA : `prod_UOg24y3llgFzs5`
- Bundle : `prod_UOg2JMg97UdK34`

## Webhook LIVE

- **ID** : `we_1TPsh4RenAUXTSv7BFbid4yc`
- **URL** : `https://www.openswissdata.com/api/webhook/stripe`
- **Status** : enabled
- **Events** : `checkout.session.completed`, `invoice.payment_succeeded`
- **Webhook secret** : `whsec_18KjrM93e9UuamnqHjiX0eFtQO6qvGn` (synced Railway)

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
