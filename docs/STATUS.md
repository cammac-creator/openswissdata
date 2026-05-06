# État du chantier infra — openswissdata.com

Dernière mise à jour : **2026-04-22** (chantier infra TERMINÉ ✅)

## ✅ Terminé

| Étape | Détails |
|---|---|
| Permissions commerciales | 3 mails envoyés 2026-04-17 (BFS, FINMA, BAZG) — voir `docs/legal-correspondence.md` |
| BAZG TARES | **GO conditionnel reçu 2026-04-21** (7 conditions à implémenter — voir doc legal) |
| FINMA Registry | **GO reçu 2026-05-06** (Nadine Bucher, Communication FINMA — pas de conditions explicites, sous réserve droits d'auteur + intégrité documents source) |
| Cloudflare R2 | Bucket `openswissdata` EU/Frankfurt, S3 credentials dans `.env`, test E2E validé (`node scripts/test-r2.mjs`) |
| Railway | Projet créé, service `api`, volume `/data` 1GB, 18 vars set, deploy live |
| DNS + SSL | `https://www.openswissdata.com/api/health` répond `{"status":"ok","version":"0.1.0"}` |
| Stripe | 4 produits + 7 prix créés en mode TEST, webhook `we_1TP409Rj...` actif sur prod, 9 vars sur Railway |
| Resend | Domaine `openswissdata.com` vérifié 2026-04-22 (DKIM + SPF + MX), API key + FROM email dans `.env` ET Railway, smoke test reçu ✅ |
| Validation finale | Health 200 ✅, webhook enabled ✅, **35 vars Railway**, Resend smoke test reçu ✅ |

## 📦 Stripe — IDs créés (test mode, 2026-04-22)

### Produits
- TARES Dataset : `prod_UNpfXYfXJEaING`
- Swiss Economic Classifications Bundle : `prod_UNpfsuQOOxHdRA`
- FINMA Registry Unified : `prod_UNpfwsjWWOUBcv`
- Dataset Bundle (3 datasets) : `prod_UNpfoQ6gZBeTPB`

### Prix (7 total)
| Slug | ID | Type | Prix |
|---|---|---|---|
| `tares_oneshot` | `price_1TP3zyRjI7CCvCPSP4vxgOsw` | one-shot | 299 CHF |
| `tares_updates` | `price_1TP3zzRjI7CCvCPSwmK8LwK5` | yearly | 120 CHF/an |
| `classifications_oneshot` | `price_1TP400RjI7CCvCPSLN9r9aKn` | one-shot | 399 CHF |
| `classifications_updates` | `price_1TP400RjI7CCvCPSKkjmXcae` | yearly | 160 CHF/an |
| `finma_oneshot` | `price_1TP401RjI7CCvCPSqHU2fj5K` | one-shot | 299 CHF |
| `finma_updates` | `price_1TP402RjI7CCvCPSbF0oqjIn` | yearly | 120 CHF/an |
| `bundle_oneshot` | `price_1TP402RjI7CCvCPSXqqdO81Q` | one-shot | 799 CHF |

### Webhook
- **Endpoint** : `we_1TP409RjI7CCvCPSk3BC0LYv`
- **URL** : `https://www.openswissdata.com/api/webhook/stripe`
- **Events** : `checkout.session.completed`, `invoice.payment_succeeded`
- **Secret** : dans `.env` et Railway (`STRIPE_WEBHOOK_SECRET`)

## ⏳ Prochaines étapes

### Sprint applicatif (à venir)
1. **Implémenter `/api/webhook/stripe`** — handler Hono qui valide signature + provisionne accès dataset après `checkout.session.completed`.
2. **Implémenter Checkout Sessions** — endpoint `/api/checkout/:slug` qui crée une session Stripe pour un price ID.
3. **Implémenter envois transactionnels** — receipt après paiement, lien de téléchargement, etc. (via Resend, FROM `hello@openswissdata.com`).
4. **Landing Astro** : page d'accueil + pages produits (3 datasets + bundle).
5. **TARES sprint** : implémenter les 7 conditions BAZG (disclaimers DE/FR/EN, exclusion `Erläuterungen`, for Berne, etc.) — détails dans `docs/legal-correspondence.md`. (**Note** : commit `a4e290e` indique que ces conditions ont déjà été appliquées par un agent background — à valider).

### Décisions différées
- **Root nu `openswissdata.com`** : abandonné (Infomaniak ne supporte pas CNAME-on-root). Pour le restaurer, migrer DNS vers Cloudflare (~20 min). Pas urgent, `www.` suffit.
- **Relance BFS** : 1 fichier texte prêt dans `permissions-emails/bfs-relance.txt`. Mis de côté pour le moment, à envoyer manuellement quand prêt. (FINMA : GO reçu 2026-05-06, plus besoin de relancer.)
- **Activation Stripe Live mode** : à faire avant le premier vrai paiement (nécessite probablement landing complète + politique de remboursement publiée).

## URLs et IDs utiles

- **Prod** : https://www.openswissdata.com/api/health
- **Railway dashboard** : https://railway.com/project/461857ea-e61e-407f-b0c6-38d94b62d7e6
- **Stripe dashboard test** : https://dashboard.stripe.com/test/dashboard
- **Stripe webhook logs** : https://dashboard.stripe.com/test/webhooks/we_1TP409RjI7CCvCPSk3BC0LYv
- **Cloudflare R2 tokens** : https://dash.cloudflare.com/7d7d5b8193bb985ef0b3ea12995fbfe0/r2/api-tokens
- **Resend dashboard** : https://resend.com/domains/c53d10b4-f552-4ad4-bbed-89670c59a14e
- **Infomaniak DNS** : https://manager.infomaniak.com → openswissdata.com → Zone DNS

## Bugs / pièges connus

- `railway domain <name>` CLI retourne `Unauthorized` même quand `whoami` est OK → toujours passer par l'UI Railway pour custom domains.
- Infomaniak ne supporte pas ALIAS/ANAME → CNAME impossible sur root.
- Wrangler global install échoue (sudo) → utiliser `npx wrangler@latest` à la place.
- Le `.env` local et Railway ne sont **pas** auto-synchronisés → toute modif d'une variable côté Railway doit être répliquée dans `.env` (et inversement) si on veut cohérence local/prod.
- Stripe CLI : `stripe login` se fait par utilisateur (browser auth). Pour scripts non-interactifs, utiliser `STRIPE_API_KEY=$(grep ... .env | cut -d= -f2) stripe ...` ou `--api-key`.
