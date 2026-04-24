# Pré-flight #13 — Audit pages légales

Date : 2026-04-25
Statut : ✅ PASS avec 1 action requise par Alain (adresse postale)

## Inventaire

| Page | URL | Statut | Notes |
|---|---|---|---|
| CGV | `/legal/cgv` | ✅ Existante (12 sections) | Section 8 BAZG complète : disclaimer DE, for Berne, Erläuterungen exclues |
| Impressum | `/legal/impressum` | ⚠️ Existante mais incomplète | Adresse postale et IDE manquants → placeholders ajoutés |
| Privacy | `/legal/privacy` | ✅ Existante (9 sections) | nLPD + RGPD couverts, 5 sous-traitants listés, droits art 25/15-22 |
| SDR Policy | `/legal/sdr-policy` | ✅ **Créée** | nFADP + RGPD + LCD art 3 lit o, opt-out 1-clic, 12 sections |

## 7 conditions BAZG (TARES)

| # | Condition | Statut | Emplacement |
|---|---|---|---|
| 1 | Données non modifiables (forme OK, contenu non) | ✅ | LICENSE.txt + CGV §2 |
| 2 | Disclaimer DE/FR/EN obligatoire | ✅ | LICENSE.txt + README.md du ZIP + page TARES + CGV §8 + Footer |
| 3 | Pas d'utilisation suggérant produit officiel BAZG | ✅ | LICENSE.txt explicite |
| 4 | Mises à jour à notre charge + horodatage | ✅ | README.md "Last updated" |
| 5 | Aucune garantie BAZG | ✅ | LICENSE.txt + CGV §7 + footer |
| 6 | For juridique Berne pour litiges TARES | ✅ | CGV §8 + §11 + Footer disclaimer |
| 7 | Erläuterungen + Entscheide exclus | ✅ | LICENSE.txt + types.ts + assertNoForbiddenFields() automatique |

## Modifications appliquées

1. **Création `/legal/sdr-policy.astro`** (12 sections, 200+ lignes) :
   - Pourquoi vous avez reçu un email
   - Comment on a obtenu l'adresse (4 sources légitimes listées)
   - Base légale (nLPD art 31, RGPD 6.1.f, LCD art 3 lit o)
   - Données traitées + données NON traitées
   - Désinscription 1-clic (RFC 8058)
   - Vos droits + procédure
   - Durée conservation (12 mois auto-purge si pas de réponse)
   - Outils (Resend, Smartlead, Apollo, Bouncer, Claude API)
   - Contact PFPDT
   - Engagement éthique (4 promesses : pas plus de 4 emails, pas de tactiques trompeuses, pas de revente, opt-out immédiat)

2. **Footer** (`web/src/components/Footer.astro`) :
   - Ajout du lien vers `/legal/sdr-policy` dans la colonne « Légal »

3. **Impressum** (`web/src/pages/legal/impressum.astro`) :
   - Placeholder explicite pour adresse postale (`[Adresse postale à compléter...]`)
   - Section IDE/UID ajoutée avec placeholder

## Action requise par Alain

⚠️ **Adresse postale réelle dans Impressum** :
- LCD art 3 demande qu'on puisse identifier physiquement l'expéditeur d'un email commercial
- Pour les emails transactionnels (achat) : peu importe en pratique
- Pour les emails outbound (Option C cold email) : **bloquant** si on cible des prospects CH
- Solution rapide : utiliser ton adresse personnelle ou une boîte postale (CHF 50/an chez La Poste Suisse)
- Édite `web/src/pages/legal/impressum.astro` ligne 18 et remplace `[Adresse postale à compléter : rue, NPA, ville, Suisse]` par ton adresse réelle

## Build & déploiement

✅ Build Astro réussi : 14 pages générées (1 nouvelle ajoutée).
Prochaine étape : commit + push + redéploiement Railway.

## Conclusion

Les pages légales sont maintenant complètes et conformes nLPD + RGPD + LCD pour :
- ✅ Vente directe (4 SKUs)
- ✅ Cold email B2B UE/US
- ⚠️ Cold email B2B CH (bloquant : adresse postale Impressum requise)

**Prochaine étape** débloquée : #14 (Stripe LIVE switch).
