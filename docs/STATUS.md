# État du chantier infra — openswissdata.com

Dernière mise à jour : **2026-04-22** (pause utilisateur, reprise prévue ~6h plus tard)

## ✅ Terminé

| Étape | Détails |
|---|---|
| Permissions commerciales | 3 mails envoyés 2026-04-17 (BFS, FINMA, BAZG) — voir `docs/legal-correspondence.md` |
| BAZG TARES | **GO conditionnel reçu 2026-04-21** (7 conditions à implémenter — voir doc legal) |
| Cloudflare R2 | Bucket `openswissdata` EU/Frankfurt, S3 credentials dans `.env`, test E2E validé (`node scripts/test-r2.mjs`) |
| Railway | Projet créé, service `api`, volume `/data` 1GB, 10 vars set, deploy live |
| DNS + SSL | `https://www.openswissdata.com/api/health` répond `{"status":"ok","version":"0.1.0"}` |

## ⏳ À faire à la reprise

### ÉTAPE 4 — Stripe (prochaine action)

1. **Vérifier compte Stripe Alain** : a-t-il déjà un compte ? Sinon créer en mode TEST sur https://dashboard.stripe.com/register (10 min KYC initial).
2. **Vérifier Stripe CLI** : `which stripe` (sinon `brew install stripe/stripe-cli/stripe`).
3. **`stripe login`** (1 clic browser).
4. **Créer 4 produits + 7 prix via CLI** :
   - TARES Dataset : one-shot 299 CHF + updates yearly 120 CHF
   - Swiss Economic Classifications Bundle : one-shot 399 CHF + updates yearly 160 CHF
   - FINMA Registry Unified : one-shot 299 CHF + updates yearly 120 CHF
   - Dataset Bundle (3 datasets) : one-shot 799 CHF
5. **Récupérer `STRIPE_SECRET_KEY`** + créer **webhook endpoint** sur `https://www.openswissdata.com/api/webhook/stripe` (events `checkout.session.completed` + `invoice.payment_succeeded`).
6. **Sync vars vers Railway** (`STRIPE_PRICE_TARES`, `STRIPE_PRICE_TARES_UPDATES`, etc., `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
7. **Redeploy** + vérifier que l'app prend bien les nouvelles vars.

### ÉTAPE 5 — Validation finale

- `curl https://www.openswissdata.com/api/health` → 200
- `railway variable list` → toutes les vars Stripe + R2 set
- `stripe webhook_endpoints list` → endpoint actif

### Décisions différées

- **Root nu `openswissdata.com`** : abandonné côté Railway (suppression à confirmer dans l'UI). Pour le restaurer, migrer DNS vers Cloudflare (~20 min). Pas urgent, `www.` suffit.
- **Relance BFS + FINMA** : prévue **2026-04-24** si pas de réponse.
- **Implémentation conditions BAZG** : 7 actions listées dans `docs/legal-correspondence.md` (disclaimers DE/FR/EN, exclusion `Erläuterungen`, for Berne, etc.) — à traiter dans le sprint TARES.

## URLs et IDs utiles

- **Prod** : https://www.openswissdata.com/api/health
- **Railway dashboard** : https://railway.com/project/461857ea-e61e-407f-b0c6-38d94b62d7e6
- **Cloudflare R2 tokens** : https://dash.cloudflare.com/7d7d5b8193bb985ef0b3ea12995fbfe0/r2/api-tokens
- **Infomaniak DNS** : https://manager.infomaniak.com → openswissdata.com → Zone DNS

## Bugs / pièges connus

- `railway domain <name>` CLI retourne `Unauthorized` même quand `whoami` est OK → toujours passer par l'UI Railway pour custom domains.
- Infomaniak ne supporte pas ALIAS/ANAME → CNAME impossible sur root.
- Wrangler global install échoue (sudo) → utiliser `npx wrangler@latest` à la place.
- Le `.env` local et Railway ne sont **pas** auto-synchronisés → toute modif d'une variable côté Railway doit être répliquée dans `.env` (et inversement) si on veut cohérence local/prod.
