# Audit UX du funnel d'achat — openswissdata.com
**Date** : 2026-05-01 (nuit) · **Cible** : compliance officer / data engineer / fiduciaire CH B2B
**Cible launch** : jeudi 7 mai 2026 · **Auditeur** : code-only, prod live testée via curl

---

## 1. Résumé exécutif (5 trouvailles majeures, par impact)

1. **Math du bundle inexacte partout** : 299+399+299 = 997, 997−799 = **198 CHF**, mais le site affiche "−200 CHF" et "Économisez 200 CHF" sur 6 fichiers. Un compliance officer qui sait additionner perd confiance en 5 secondes. 🔴
2. **Post-paiement = trou noir** : Stripe redirige vers `/account?checkout=success`, mais cette route n'affiche aucun message de succès — le client voit le formulaire "Sign in" sans feedback, et il est en anglais alors que tout le reste est en français. 🔴
3. **Page `/account` entièrement en anglais** ("Sign in", "Your datasets", "Download", "Send magic link") sur un site B2B 100% francophone — friction grave pour la cible compliance suisse. 🔴
4. **Packages npm inexistants** : `@osd/cli`, `@openswissdata/sdk`, `@osd/sdk` cités dans le hero, la FAQ, la doc provenance — registry npm répond 404. Un dev qui copie-colle la commande casse en 2 secondes, le hero terminal ment. 🔴
5. **Clé publique Ed25519 référencée mais 404** : `/openswissdata.pubkey.ed25519` est cité dans `provenance.astro:95` comme preuve technique principale, retourne 404 en prod. La promesse "Manifest signé Ed25519" devient invérifiable. 🔴

---

## 2. Frictions par étape

### A. Découverte (page `/`)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🟢 | `index.astro:30-31` | Hero clair : "Données fédérales suisses, normalisées." + lede TARES/NOGA/FINMA + Ed25519. Persona compliance trouve son angle en <5s. | RAS, à conserver. |
| 🟡 | `index.astro:54` | CTA primaire `Voir les datasets` ancre `#datasets` — ok mais pas de second CTA "Bundle direct" en hero (le bundle est l'offre la plus rentable). | Ajouter un sous-CTA secondaire `→ Bundle 799 CHF` à côté du primaire. |
| 🟡 | `index.astro:38-50` | Specs ("Datasets / Codes / Formats") sans prix. | Remplacer "Formats" par "À partir de 299 CHF". |
| 🟢 | `index.astro:66-76` | Chaîne de provenance visuelle BAZG→SHA-256→Ed25519→RFC-3161 : trust signal premium fort. | Conserver. |
| 🔴 | `index.astro:55, 366` | `npx @osd/cli pull tares@latest` — package npm inexistant (registry npm 404). Hero terminal et InstallBar exécutent une commande qui plante. | Publier le package ou remplacer par `curl -O https://...` ou disclaimer "preview". |
| 🟢 | `index.astro:230-242` | Quote BAZG avec nom Michael Beer + date 21.04.2026 + CTAs : trust authentique. | Conserver. |
| 🟡 | `index.astro:253-274` | "Pourquoi pas DIY" : 4 angles excellents (format change / 5 j-h / LCD art. 5 / 6 000 CHF). Pas de visuel. | Ajouter icônes simples. |
| 🟢 | `index.astro:284-317` | FAQ couvre 8 objections compliance : sources, légalité, refresh, format, vérification, ERP, refund, sur-mesure. | Conserver. |
| 🟡 | `StatusBar.astro:13` | `v1.0.0` en haut vs `v2026.04.30` dans Fiches. Incohérence version technique vs éditoriale. | Standardiser sur v2026.04.30 partout. |
| 🟡 | `index:59 vs 287, cgv:79, compliance:42-44` | Mélange OFS / BFS pour la même institution. compliance.astro mixe label "OFS" et URL `bfs.admin.ch`. | Standardiser sur OFS (français site-wide). |

### B. Évaluation (pages `/datasets/*`)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🟢 | `tares.astro:66-85`, etc. | Schémas tabulaires champ/type/exemple : excellent. | Conserver. |
| 🟢 | `tares.astro:21-24, 40-47` | Disclaimer non-officiel multilingue + badge BAZG vert : bien dosé. | Conserver. |
| 🔴 | `tares.astro:97-101`, `finma:115-118`, `classifications:106-109` | Échantillons CSV sous-dimensionnés : promesse "100 lignes TARES" → réel **11** ; "200 entités FINMA" → **16** ; "50 + 20 cross-walks" → **41**. Vérifié `wc -l` sur prod. | Régénérer les samples ou aligner copy ("aperçu express, ~15 lignes"). |
| 🟡 | `tares.astro:33-37`, etc. | Box pricing 299 CHF + "+120 CHF/an mises à jour (optionnel)" peu clair — risque d'interprétation "120 + 299 = 419 dès maintenant". | Reformuler : "Mise à jour 360 jours **incluses**. Renouvellement optionnel ensuite (120 CHF/an)." |
| 🟢 | `classifications.astro:74-94` | Cross-walks 5-way avec exemple NOGA 64.11 : pédagogique. | Conserver. |
| 🟡 | `classifications.astro:135-163` | Tier Pro 999 CHF placé après le CTA Standard, en bas. Un acheteur peut louper le Pro. | Picker comparatif Standard vs Pro en haut. |
| 🟡 | `finma.astro:21-24`, `classifications:21-24` | Badge ambré "permission demandée 2026-04-17" se lit "pas accordée" → doute compliance. | Reformuler "Demande en cours · republication LDA art. 5" + lien `/compliance#3`. |
| 🟢 | `tares.astro:88-92`, etc. | Composants `HSLookup`/`ClassificationsLookup`/`FinmaLookup` : trust signal premium. | Conserver. |
| 🟡 | `tares.astro:125-135` | Sub-text "Téléchargement immédiat par email" pas exact (5 min via webhook). | Reformuler "Lien par email sous 5 minutes". |

### C. Décision (page `/bundle`)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🔴 | `bundle.astro:34, 88-91, 20`, `tares:134`, `classifications:174`, `finma:152`, `index.astro:194` | **Math fausse** : 299+399+299=997 ; 997−799=**198 CHF (19.85%)**, pas 200 CHF (20%). Le pill `−20%` du Fiche bundle a été corrigé selon brief, mais 6 autres endroits affichent encore "200 CHF" et "20%". | Soit bundle → **797 CHF** (math propre, recommandé pour ne rien toucher d'autre) ; soit "200 CHF / 20%" → "**198 CHF / 19.9%**" partout. |
| 🟢 | `bundle.astro:65-92` | Tableau d'économie ligne par ligne : transparent (mais chiffres mentent, cf. ci-dessus). | Conserver structure, corriger total. |
| 🟢 | `bundle.astro:104-124` | "Pour qui est le bundle" : 4 angles ciblés. | Conserver. |
| 🟡 | `bundle.astro:126-135` | Sub-text "3 téléchargements immédiats" : 5 min via webhook. | Aligner : "3 liens par email sous 5 minutes". |
| 🟡 | bundle.astro | Pas de FAQ sur `/bundle` (uniquement sur `/`). Un acheteur direct (Google Ads) la rate. | Dupliquer/linker la FAQ. |
| 🟡 | bundle.astro | Pas de mention refund 14 jours sous le CTA (les pages individuelles l'ont). | Ajouter. |

### D. Achat (Stripe Checkout)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🟡 | `tares:126-127`, `classifications:166-167`, `finma:144-145`, `bundle:127-128` | Forms POST n'envoient que `dataset_ids`, jamais `email`. `checkout.ts:80` ne pré-remplit Stripe que si fourni. → friction retape mobile. | Input email optionnel sur les CTAs (un seul champ). |
| 🟢 | `checkout.ts:72-79` | Externalisation propre vers `checkout.stripe.com` (vérifié 303 → URL Stripe live). | Conserver. |
| 🔴 | `checkout.ts:75` | `success_url=/account?checkout=success&session_id=...`, mais `account.astro:50-65` ne gère QUE `?auth=ok|invalid|expired`. Acheteur frais voit le form "Sign in" en anglais, aucun feedback. | Gérer `?checkout=success` dans `account.astro` : banner verte "Paiement reçu · Email envoyé sous 5 min" + auto-trigger envoi magic link sur l'email Stripe. |
| 🟡 | `checkout.ts:76` | `cancel_url=/bundle?checkout=cancelled` non géré dans `bundle.astro`. | Toast "Achat annulé — tu peux réessayer". |

### E. Livraison (email + magic link)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🔴 | `email.ts:104` | Sujet `"Your ${datasetName} download"` — anglais avec body français. Signal "amateur". | `"Votre dataset openswissdata · ${datasetName}"`. |
| 🔴 | `email.ts:119` | Sujet `"Your openswissdata login link"` — idem. | `"Votre lien de connexion openswissdata"`. |
| 🟡 | `email.ts:97-103` | HTML brut sans logo/branding/instructions verify-provenance. | Mini-template HTML : header logo, CTA stylisé, footer provenance. |
| 🟡 | `email.ts:100` | Bouton `#4f46e5` (indigo) ≠ palette site. | Utiliser `--color-accent`. |
| 🟡 | `email.ts:101, 115` | Tutoiement "ton espace client" — tone B2B compliance = vouvoiement. | Vouvoyer + bouton stylisé. |
| 🟡 | `account.astro:13` | Magic link 15 min, aucune indication temps restant côté UI. | Banner "Lien valide jusqu'à HH:MM". |
| 🟢 | `auth.ts:84` | Cookie HttpOnly + Secure + SameSite=Lax + 30j : sécurisé. | Conserver. |
| 🟢 | `auth.ts:63-64` | Toujours 200 sur magic-link (anti-enumeration) : bonne pratique. | Conserver. |

### F. Téléchargement (R2 signed URL)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🟢 | `download.ts:42-49` | Token download 48h + URL signée R2 5 min : architecture propre. | Conserver. |
| 🟢 | `download.ts:79-88` | Recheck entitlement à redeem time (refund/expiration race) : excellent. | Conserver. |
| 🟢 | `download.ts:91-96` | Single-use atomique `UPDATE ... WHERE used_at IS NULL` : prévient replay leak. | Conserver. |
| 🔴 | `web/public/openswissdata.pubkey.ed25519` 404 | Référencé dans `provenance.astro:95` et "dans chaque ZIP" — 404 en prod. Promesse Ed25519 invérifiable. | Publier le fichier dans `web/public/`. |
| 🟡 | non audité | Contenu réel du ZIP (README, manifest) inauditable sans achat. | Publier un ZIP-sample factice public (`/samples/`). |
| 🟡 | `account.astro:114, 135` | UI en anglais ("Download", "Preparing", "Retry", "Download failed"). | Traduire en français. |

### G. Post-vente (réutilisation, support)

| Sév | Fichier:ligne | Description | Fix recommandé |
|---|---|---|---|
| 🟢 | `account.astro` | Re-download 360 jours via `/account` : bonne UX. | Conserver. |
| 🔴 | `account.astro` (tout) | Page 100% en anglais : "Sign in" / "Your datasets" / "you@company.com" / "Send magic link" / "Download" / "Log out" / "You don't have any dataset purchases yet" / "Signed in successfully" / "That link is not valid" / "That link has expired". Bug cohérence majeur sur site B2B francophone CH. | Tout traduire FR. |
| 🟢 | `cgv.astro:48` | Refund 14 jours sans condition documenté + exception redistribution. | Conserver. |
| 🟡 | tous | Support uniquement email `contact@`. Acceptable launch. | Post-launch : widget Crisp ou page `/support`. |
| 🟡 | `Footer.astro:33` | Lien "Journal" → `/blog` (200 mais probablement vide). | Retirer ou publier 1-2 articles. |
| 🟢 | `compliance.astro:128-139` | Engagement takedown 24h + email dédié + refund prorata : très professionnel. | Conserver. |

---

## 3. Top 10 quick wins (< 30 min chacun) AVANT launch

1. **Corriger la math du bundle** : choisir 797 CHF (option simple) ou éditer "200 CHF / 20%" → "198 CHF / 19.9%" sur 6 fichiers (`bundle.astro:34, 88-91, 20`, `tares:134`, `classifications:174`, `finma:152`, `index.astro:194` strikePrice 997).
2. **Traduire `account.astro` en français** : 30 chaînes UI à remplacer.
3. **Traduire les sujets emails** dans `email.ts:104, 119`.
4. **Gérer `?checkout=success` dans `account.astro`** : ajouter banner verte "Paiement reçu, lien envoyé sous 5 min". 5 lignes à ajouter dans le `if/else` ligne 50-65.
5. **Publier `/openswissdata.pubkey.ed25519`** dans `web/public/` (1 fichier statique).
6. **Régénérer les samples CSV** ou aligner copy sur la réalité (10/16/41 lignes au lieu de 100/200/50+20).
7. **Standardiser OFS partout** (sauf disclaimer-allemand) — 5 occurrences.
8. **Choisir une seule version** : v2026.04.30 partout, retirer le `v1.0.0` du StatusBar.
9. **Ajouter "Remboursement 14 jours sans condition" sous le CTA bundle**.
10. **Désamorcer "permission demandée"** : reformuler les badges ambrés en "Republication LDA art. 5 + takedown engagé" avec lien vers `/compliance#3`.

---

## 4. Top 5 améliorations long-terme (post-launch)

1. **Publier les packages npm** `@osd/cli` et `@openswissdata/sdk` (ou rebrand : `@openswissdata/cli`). Sans ça, le hero terminal et la commande verify-provenance mentent.
2. **Brander les emails transactionnels** : template HTML avec logo, CTAs, footer cohérent (probablement via React Email ou Maizzle).
3. **Ajouter une FAQ sur `/bundle`** + sur les 3 pages dataset (actuellement uniquement sur `/`).
4. **Page `/support` ou widget chat** : pour rassurer la cible enterprise (>5000 CHF/an mentionnée FAQ).
5. **Publier un ZIP-sample téléchargeable sans achat** (1 dataset light avec vrai `provenance.json`, vraie signature) pour permettre aux compliance officers de vérifier la chaîne crypto avant de payer.

---

## 5. Verdict final : prêt pour le launch jeudi 7 mai ?

**Non, pas en l'état.** 5 bloquants 🔴 — math du bundle inexacte, page /account 100% en anglais, post-paiement sans feedback, packages npm fantômes, clé publique 404 — sont chacun une raison crédible pour qu'un compliance officer suisse ferme l'onglet ou demande un refund avant download. Pris séparément, chacun est trivial à corriger (les 5 sont dans le Top 10 quick wins, total ≈ 2-3 h de travail).

**Avec les 10 quick wins appliqués**, le funnel est propre, cohérent et honnête. La fondation est solide : permission BAZG réelle, architecture cryptographique soignée, copy compliance-aware, refund 14 jours clair, FAQ qui anticipe les objections. Le reste (templates email premium, packages npm publiés, FAQ dupliquée) peut attendre les semaines suivant le launch sans casser l'expérience initiale.

**Recommandation** : bloquer 3 h mercredi 6 mai pour les 10 quick wins, retester le funnel end-to-end avec un achat test (Stripe test mode), puis launch jeudi avec confiance.
