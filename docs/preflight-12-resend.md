# Pré-flight #12 — Resend production check

Date : 2026-04-24
Statut : ✅ PASS — Resend prêt pour cold + transactionnel

## Résultats

| Check | Statut | Détail |
|---|---|---|
| Domaine `openswissdata.com` | ✅ verified | région eu-west-1 |
| Record DKIM | ✅ verified | TXT |
| Record SPF MX | ✅ verified | priority 10 |
| Record SPF TXT | ✅ verified | — |
| Click tracking | ✅ activé (FIX appliqué) | était `false`, passé à `true` |
| Open tracking | ✅ activé (FIX appliqué) | était `false`, passé à `true` |
| API key `openswissdata-backend` | ✅ valide | créée 2026-04-22 |
| Railway env `RESEND_API_KEY` | ✅ synchronisée | `re_23Z8guBR_...` |
| Railway env `RESEND_FROM_EMAIL` | ✅ synchronisée | `hello@openswissdata.com` |
| Railway env `RESEND_DOMAIN_ID` | ✅ synchronisée (FIX appliqué) | `c53d10b4-f552-4ad4-bbed-89670c59a14e` (était manquante) |
| Smoke test envoi avec `List-Unsubscribe` RFC 8058 | ✅ delivered | id `7a2cabed-92a4-...` à 19:34:32 UTC |
| Header `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | ✅ accepté par Resend API | RFC 8058 conforme |

## Historique récent (5 derniers emails)

| Date | To | Subject | Status |
|---|---|---|---|
| 2026-04-24 19:34 | claudealainmartin06@gmail.com | [#12 pre-flight] Test header List-Unsubscribe | delivered |
| 2026-04-23 19:42 | cam@ogens.ch | Your TARES — Swiss Customs Tariff download | delivered |
| 2026-04-23 19:10 | claudealainmartin06@gmail.com | Your TARES — Swiss Customs Tariff download | delivered |
| 2026-04-23 18:19 | e2e-test-2026-04-23@openswissdata.com | Your openswissdata login link | suppressed |
| 2026-04-23 18:19 | e2e-test-2026-04-23@openswissdata.com | Your TARES — Swiss Customs Tariff download | bounced |

## Fixes appliqués

1. **Click + Open tracking activés** via `PATCH /domains/{id}` — utile pour métriques outbound (sans, pas de stats sur les emails de prospection).
2. **Sync `RESEND_DOMAIN_ID` sur Railway** via `railway variables --set` — était manquante (seulement 2/3 vars Resend synced auparavant).

## Limites identifiées (non bloquantes Option C)

- **Inbound webhook Resend** non configuré : pour récupérer les replies aux cold emails de manière automatisée. **Pas bloquant pour Option C** (Smartlead gérera son propre inbound) ni pour l'usage transactionnel actuel. **À configurer pour OSDsdr v1** quand on construira le module reply handling (Module 7).
- **Free tier 3 000 emails/mois** : suffit pour Option C (200 envois × 1-3 séquences = max 600 emails) + transactionnel (50-100/mois prévus). Migration Pro $20 si volume dépasse.

## Conclusion

✅ Resend production-ready pour transactionnel ET pour cold email outbound léger (Option C).
Pas de fix bloquant restant.

**Prochaine étape débloquée** : #13 (audit pages légales).
