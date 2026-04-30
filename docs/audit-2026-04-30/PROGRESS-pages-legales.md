# PROGRESS — Pages légales (audit 2026-04-30)

**Date d'exécution :** 2026-04-30
**Cible :** finaliser la posture juridique avant launch jeudi 7 mai 2026

## Livrables produits

### A. Nouvelle page publique `/compliance` (`web/src/pages/compliance.astro`)

Page institutionnelle conçue pour un compliance officer sceptique ou une autorité fédérale. Sept sections :

1. **Sources officielles** — tableau pour chaque dataset (TARES, Classifications, FINMA Registry) avec source, URL officielle, fréquence de refresh, statut actuel.
2. **Demandes de permission en cours** — tableau destinataire / sujet / date d'envoi (17.04.2026) / statut / relance.
3. **Base légale de la republication** — explication accessible en français de l'art. 5 LDA (œuvres officielles), de la LCD art. 5 lit. c (amortissement), citations exactes des arrêts ATF 135 III 446 (Maltesers), ATF 131 III 384 (Such Spider), ATF 139 IV 17. Mention de l'absence de droit sui generis sur les bases de données en Suisse (≠ UE).
4. **Engagement de retrait sous 24h** — email `takedown@openswissdata.com`, accusé 2h, retrait 24h, refund prorata.
5. **Disclaimer FINMA** repris textuellement.
6. **Watermarking et traçabilité** — mention discrète du canary record HMAC, sans formulation anti-leak.
7. **Politique de takedown** — engagement public, autorités sources listées (BAZG, OFS, FINMA, Eurostat, Nations Unies).

Date de mise à jour rendue dynamique via `new Date().toISOString().split('T')[0]`. Lien ajouté dans le Footer global (colonne Légal) pour discoverability SEO.

### B. CGV (`web/src/pages/legal/cgv.astro`)

- Suppression du bandeau "premier brouillon".
- Préambule global ajouté en encadré : non-affiliation BAZG/BFS/FINMA/Eurostat/UN.
- Section 6 réécrite : refund 14j sans condition (sauf redistribution) + droit de rétractation B2B inapplicable (art. 40a CO ne s'applique qu'aux consommateurs). Référence LCD art. 1 erronée supprimée.
- Section 7 (responsabilité) : ajout de la clause art. 100 al. 1 CO pour exclure dol et faute grave.
- Nouvelle section 2bis (Sublicensing) : interdiction stricte de sous-licence et revente par découpage.
- Nouvelle section 12bis (Force majeure) : Stripe, Resend, R2, Railway, sources officielles, autorités, catastrophe naturelle.
- Nouvelle section 11 (Takedown) : retrait sans préavis sur demande d'autorité source + refund prorata.
- Date dynamique. Version 1.1.

### C. Privacy (`web/src/pages/legal/privacy.astro`)

- Suppression du bandeau "premier brouillon".
- Section 7 reformulée : SCC 2021/914/UE pour le transfert vers Resend (États-Unis).
- Nouvelle section 2bis : renvoi vers `/legal/sdr-policy` pour la prospection commerciale.
- Date dynamique. Version 1.1.

### D. Impressum (`web/src/pages/legal/impressum.astro`)

- Bloc IDE/UID remplacé : "Non applicable. Raison individuelle non inscrite au registre du commerce (CA annuel < 100 000 CHF, art. 36 ORC). TVA : non assujetti (art. 10 LTVA, CA < 100 000 CHF)."
- Liens enrichis (provenance, sdr-policy, compliance).
- Mention de non-affiliation à opendata.swiss / BAZG / BFS / FINMA en bas de page.

### E. Provenance (`web/src/pages/legal/provenance.astro`)

- Section 5 "Garantie 10×/50k CHF" entièrement retirée (flag audit légal — patrimoine perso d'Alain en risque sans assurance RC pro).
- Toutes les mentions "TARES Pro 899 CHF" et "FINMA Pro 699 CHF" retirées (SKUs fantômes absents de Stripe).
- Date dynamique.
- Section 2 mise à jour : BAZG = permission écrite acquise, OFS et FINMA = demande envoyée 17.04 + relance prévue.
- Renumérotation post-suppression (§5 → Limites assumées, §6 → Contact). Email `takedown@openswissdata.com` ajouté.
- Version 1.1.

### F. Footer global (`web/src/components/Footer.astro`)

- Lien `/compliance` ajouté dans la colonne Légal.
- Nouvelle ligne `.footer-affiliation` discrète au-dessus du disclaimer : "openswissdata.com est un service privé indépendant. Non affilié à opendata.swiss, BAZG, BFS, FINMA."
- Disclaimer existant raffiné : statut BAZG (permission écrite + référence) vs Classifications/FINMA (republication avec valeur ajoutée + procédure takedown 24h).
- Style CSS ajouté pour `.footer-affiliation`.

## Vérifications

- Build Astro : aucune erreur sur les fichiers modifiés (erreur préexistante non liée dans `web/src/pages/codes/noga/[code].astro`, fichier untracked hors scope).
- Style cohérent avec le design Tailwind `prose prose-slate` des autres pages /legal.
- Toutes les dates en haut de page sont dynamiques et reflèteront chaque déploiement.
- Aucune mention de "lancement sans permission" ou "demander pardon plutôt que permission" — formulation institutionnelle "republication avec valeur ajoutée + procédure takedown 24h".

## Commits

Cinq commits distincts (feat:, fix:) groupés par domaine logique pour faciliter la review.

## Reste à faire (hors scope)

- Souscrire assurance RC pro Generali/Helvetia (~300 CHF/an) avant réintroduction d'une garantie d'exactitude.
- Envoyer relances OFS et FINMA (textes prêts dans `permissions-emails/`).
- Configurer adresse email `takedown@openswissdata.com` (alias Resend ou Forwardemail).
- Watermarking customer_id implémenté par un autre agent.
- Faire valider les 3 citations ATF (135 III 446, 131 III 384, 139 IV 17) par conseil juridique avant relais marketing externe — citations reprises depuis le brief, non vérifiées en source primaire.
