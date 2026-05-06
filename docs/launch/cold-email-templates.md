# Cold email templates · openswissdata launch

**De** : `Claude-Alain Martin <cold@send.openswissdata.com>` (sous-domaine warmé séparé)
**Outil envoi** : Instantly.ai ou Smartlead.ai (PAS Resend qui est transactionnel)
**Volume safe** : 30-50 emails/jour pendant 14 jours après warm-up
**Follow-ups** : 3 max (J+3, J+7, J+14)

---

## Template A — Compliance Officer banque cantonale / privée

**Objet** : `Vérification FINMA en 30 secondes vs 3 heures`

```
Bonjour [Prénom],

Vos analystes croisent encore manuellement la TARES et le registre FINMA
pour vos audits trimestriels ?

Chez openswissdata, nous fournissons les données fédérales suisses
(BAZG, FINMA, OFS) déjà nettoyées, schémas-stables, signées Ed25519,
livrées via API ou MCP (Claude / Cursor / Copilot).

→ Bundle Compliance 797 CHF/an · 360 jours d'updates inclus
→ Permission BAZG écrite (référence vérifiable)
→ Refund 14 jours sans condition

15 min jeudi pour un démo ?

— Claude-Alain Martin, openswissdata.com
```

**Signature obligatoire (nLPD)**

```
—
Claude-Alain Martin · openswissdata · raison individuelle CH
Désinscription 1-clic : reply STOP
Données traitées selon nLPD + RGPD · openswissdata.com/legal/sdr-policy
For juridique : Berne (TARES) / Ogens VD (autres) · CHE-XXX
```

---

## Template B — Data Engineer fintech / asset manager

**Objet** : `MCP server datasets CH — 9 tools natifs Claude/Cursor`

```
Hi [Prénom],

Tu codes encore des parsers ad-hoc pour les CSV NOGA et les XLSX FINMA
inhomogènes ?

Notre MCP server expose 9 datasets fédéraux suisses comme tools natifs
Claude / Cursor / Copilot. Schéma stable, signature Ed25519, SLA
publique.

→ MCP Standalone 49 CHF/mois · annulable
→ ou Bundle complet 797 CHF (one-shot, 9 tools inclus 12 mois)

Test gratuit possible : openswissdata.com/mcp/discovery
Code source des ETL : github.com/cammac-creator/openswissdata

Curieux d'avoir ton feedback technique. 15 min ?

— Alain
```

---

## Template C — Intégrateur ERP indépendant (SAP GTS / Odoo / Abacus)

**Objet** : `TARES propre pour vos clients exportateurs · revente 30%`

```
Bonjour [Prénom],

Vos clients PME ont des soucis avec les codes TARES dans leur ERP
(SAP GTS, Abacus, Odoo) ?

Nous livrons la TARES en JSON / CSV / Parquet propre, mise à jour
hebdomadaire BAZG, schéma stable. Permission BAZG écrite (référence
vérifiable auprès de M. Beer).

→ TARES 299 CHF/client (refacturable)
→ Programme partenaire : 30 % commission récurrente
→ Vous gardez la relation client, on gère l'ETL

Si ça vous parle, je peux préparer un kit revendeur (logo, sample
client, contrat partenaire) en 48h.

— Alain, openswissdata.com
```

---

## Sourcing 200 contacts ICP (sans LinkedIn perso)

### Listes gratuites prioritaires

1. **Registre FINMA** : finma.ch/fr/finma-public/etablissements-autorises/
   → compliance officers nommés publiquement par chaque banque
   → exporter 60 contacts banques cantonales + privées + néobanques

2. **Zefix.ch** : zefix.ch/fr/search/entity/list
   → raisons sociales + adresses + codes NOGA
   → filtre PME exportatrices (NOGA 46-47 commerce + 25-32 industrie)
   → exporter 30 contacts douane PME

3. **Annuaires sectoriels gratuits** :
   - alliancefinance.ch (compliance)
   - swissbanking.ch (banques)
   - fintech.ch (membres)
   - ordreavocats-vd.ch / sav-fsa.ch (avocats financiers)
   - swissmem.ch (industrie)

### Outils SAFE (sans toucher LinkedIn perso)

- **Hunter.io** 49 USD/mois · 500 emails · pattern + verify · zéro extension Chrome
- **Apollo.io** dashboard web SEULEMENT · ne jamais activer extension
- **Dropcontact** alternative GDPR-native FR · enrichit prénom + nom + entreprise

### Recherche Google manuelle (gratuit)

```
site:bcv.ch "compliance" email
site:zkb.ch "compliance officer"
"compliance officer" "banque cantonale" filetype:pdf
"data engineer" site:fr.ch OR site:vd.ch OR site:ge.ch
"customs manager" PME suisse export
```

---

## Tunnel B2B CH — funnel réaliste 100 cold emails

| Étape | Volume | Taux |
|---|---|---|
| Cold emails envoyés | 100 | — |
| Ouvertures | 35-45 | 35-45 % |
| Réponses | 8-12 | 8-12 % |
| Meetings | 3-5 | 3-5 % |
| **Ventes** | **0.5-1.5** | **0.5-1.5 %** |

→ 200 cold emails sur 30 jours = **1-3 ventes médian** (797-2 200 CHF revenu).

---

## Plan 30 jours

| Jour | Action |
|---|---|
| J1-7 | Sourcing 200 contacts (60 compliance + 50 data eng + 40 ERP + 30 avocats + 20 douane) |
| J8-14 | Batch 1 (50 emails/jour lun-jeu) + follow J+3 et J+7 (auto via Instantly) |
| J15-21 | Batch 2 (50 nouveaux contacts) + 20 appels téléphone aux non-répondeurs prioritaires |
| J22-30 | Closing : devis, signatures, onboarding · nurturing "pas maintenant" (J+30, J+60) |

---

## Outil cold email — choix

**Recommandé : Instantly.ai** (37 USD/mois)
- Warm-up automatique
- Multi-inbox (rotation pour ne pas cramer la délivrabilité)
- A/B testing natif
- Reply detection
- Integration Hunter / Apollo

**Alternative : Smartlead.ai** (39 USD/mois) — équivalent fonctionnel.

**Setup obligatoire avant envoi** :
1. Acheter sous-domaine `send.openswissdata.com` (DNS)
2. Configurer SPF + DKIM + DMARC sur ce sous-domaine
3. Warmer pendant 14 jours (5 → 10 → 20 → 40 emails/jour progressif)
4. Démarrer batch 1 jour 15

---

## Ce qu'il NE FAUT PAS faire

- ❌ Envoyer cold depuis `contact@openswissdata.com` (cramerait l'inbox transactionnelle Stripe/Resend)
- ❌ Activer l'extension Chrome Apollo / RocketReach (lit ton LinkedIn perso → signal possible employeur)
- ❌ Inclure ton employeur actuel dans la liste (un collègue qui reçoit = catastrophe)
- ❌ Plus de 50 emails/jour avant warm-up complet (= spam folder garanti)
- ❌ Plus de 3 follow-ups (= harcèlement perçu)
