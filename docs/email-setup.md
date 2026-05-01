# Email setup — openswissdata.com

Last updated: 2026-05-01

## Architecture

```
                                 ┌─────────────────────────────────┐
                                 │  Infomaniak Service Mail        │
                                 │  (réception)                    │
                                 │                                 │
  Outgoing transactional         │  contact@openswissdata.com ◄──┐ │
  ───────────────────────        │                               │ │
  Resend SaaS                    │  Aliases (forward → contact@):│ │
  noreply@openswissdata.com  ────┘                               │ │
  Reply-To: contact@                  takedown@   ───────────────┤ │
                                      hello@      ───────────────┤ │
                                      legal@      ───────────────┤ │
                                      dpo@        ───────────────┤ │
                                      support@    ───────────────┤ │
                                      noreply@    ───────────────┘ │
                                                                   │
                                  Incoming reply / takedown ───────┘
```

**One mailbox, six aliases.** Coût Infomaniak : déjà inclus dans l'offre Service Mail (5 boîtes / 100 redirections, valide jusqu'au 2027-05-01).

## Adresses

| Adresse | Type | Usage |
|---|---|---|
| `contact@openswissdata.com` | Boîte mail réelle | Support client, commercial, contact public, point d'entrée unique |
| `takedown@openswissdata.com` | Alias → contact@ | Procédure publique de retrait <24h sur demande BAZG/BFS/FINMA. **Bouclier juridique** documenté dans `/compliance` |
| `hello@openswissdata.com` | Alias → contact@ | Backward-compat (anciens emails sortants Resend) |
| `legal@openswissdata.com` | Alias → contact@ | Notifications LCD, mises en demeure, correspondance autorités |
| `dpo@openswissdata.com` | Alias → contact@ | Délégué à la protection des données (nLPD / RGPD) |
| `support@openswissdata.com` | Alias → contact@ | Support technique futur |
| `noreply@openswissdata.com` | Alias → contact@ | Expédition transactionnelle Resend (Reply-To = contact@) |

## DNS

Enregistrement TXT racine `openswissdata.com` :

```
v=spf1 include:spf.infomaniak.ch include:_spf.resend.com -all
```

- **SPF** : autorise Infomaniak (réception + relay) **et** Resend (envoi transactionnel)
- **DMARC** `p=reject` : déjà actif (politique stricte anti-spoofing)
- **DKIM** : 2 clés Resend installées (`2026047._domainkey` + `resend._domainkey`)
- **MX** : pointe vers `mta-gw.infomaniak.ch` (priorité 5)

Sous-domaine `send.openswissdata.com` (Resend bounce handling) :
- MX → `feedback-smtp.eu-west-1.amazonses.com`
- SPF → `v=spf1 include:_spf.resend.com -all`

## Configuration backend

`.env` / Railway env vars :

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@openswissdata.com
RESEND_REPLY_TO=contact@openswissdata.com
```

Defaults dans `src/lib/email.ts` si les vars ne sont pas set :
- `from` → `noreply@openswissdata.com`
- `reply_to` → `contact@openswissdata.com`

## Tests deliverability

### Test interne (réception)

```bash
# Envoyer depuis n'importe quel compte externe
echo "test" | mail -s "Test takedown" takedown@openswissdata.com

# Vérifier réception sur https://mail.infomaniak.com (boîte contact@)
```

### Test outbound (envoi Resend)

```bash
# Récupérer une adresse jetable sur https://www.mail-tester.com
TEST_ADDR="test-abc123@srv1.mail-tester.com"

curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"from\": \"noreply@openswissdata.com\",
    \"to\": [\"$TEST_ADDR\"],
    \"reply_to\": \"contact@openswissdata.com\",
    \"subject\": \"Test deliverability openswissdata\",
    \"html\": \"<p>Test depuis Resend.</p>\"
  }"

# Puis "Then check your score" sur mail-tester.com — cible ≥9/10
```

### Test SPF

```bash
dig TXT openswissdata.com +short | grep spf1
# Doit afficher : v=spf1 include:spf.infomaniak.ch include:_spf.resend.com -all
```

Ou via https://mxtoolbox.com/SuperTool.aspx → "SPF Record Lookup".

## Procédure takedown (rappel SLA public)

Engagement public dans `/compliance` :

1. **H+0** : email reçu sur `takedown@openswissdata.com` (forwardé à `contact@`)
2. **H+2** : accusé de réception envoyé depuis `contact@`
3. **H+24** : retrait du dataset concerné côté Stripe + frontend + R2 (signed URLs invalidées)
4. **H+48** : refund prorata aux acquéreurs concernés

Filtre Infomaniak recommandé sur la boîte `contact@` : règle qui détecte les emails à `takedown@` (champ "Delivered-To") → tag rouge urgent + notification mobile push.

## Migration legacy

Les anciennes versions du backend utilisaient `RESEND_FROM_EMAIL=hello@openswissdata.com`. La migration vers `noreply@` :

1. Code : commit `xxxx` ajoute `RESEND_REPLY_TO` + change le default à `noreply@`
2. Railway env : changer `RESEND_FROM_EMAIL=hello@…` → `noreply@…` + ajouter `RESEND_REPLY_TO=contact@…`
3. `hello@` reste actif comme alias (backward-compat) pour ne pas casser les correspondances en cours
