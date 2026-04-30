# Landing redesign V4 — "Swiss Data Engineering" (modern, multi-persona, épuré)

**Date :** 2026-04-29
**Auteur :** brainstorming session avec Claude-Alain Martin
**Statut :** spec validée, prête pour planification d'implémentation
**Scope :** refonte design system + page d'accueil `web/src/pages/index.astro`
**Mockup de référence :** `.design-preview/index.html` (V4 finale validée)

---

## 1. Contexte et brief

### Problème
Le design actuel (Inter + Instrument Serif italique + grain noise + spotlight rouge gradient + eyebrow pulse) est devenu LE template SaaS générique des startups assistées par v0/Lovable/Cursor. Trois griefs explicites :

1. **A** — vocabulaire visuel "AI/SaaS template" (eyebrow pulse, spotlight, italique serif, grain).
2. **B** — manque de "suissitude" : rien dans la mise en page ne dit "données officielles suisses normalisées".
3. **C** — ton trop chaleureux/marketing pour une cible technique (data engineers, compliance officers, intégrateurs ERP).

### Cap demandé
- Garder/ajouter **plus de structure et de profondeur** dans le fond, pas moins.
- Garder/ajouter **plus d'animation**, mais smooth et moderne (pas SaaS générique, pas vieillotte).
- **Mixer les 3 personas** (data eng / compliance / ERP) sans saturer la page.
- Bien **épurer**.

### Itérations menées (mockup `.design-preview/`)
1. **V1 "Publication fédérale"** (papier ivoire + IBM Plex Serif + tampon + marginalia §) — rejetée : *vieillotte*.
2. **V2 "Swiss Data Engineering"** (Geist + paper froid + terminal preview) — validée comme baseline.
3. **3 variantes A/B/C** par persona (Data engineer / Compliance / ERP-ROI) — validation conceptuelle, mais saturation si toutes en même temps.
4. **V4 "unifiée"** — V2 baseline + animations smooth + 3 angles persona orchestrés en sections distinctes. **Validée.**

---

## 2. Direction visuelle retenue

### Identité
- **Outil suisse pro 2026**, pas startup SaaS, pas publication fédérale du XIXe.
- Référence : `Linear · Mercury · Stripe Press · Plain.com` croisé avec `opendata.swiss` mais en mieux.
- Une **seule** couleur d'accent (rouge confédéral `#DC1F2D`), utilisée avec parcimonie comme une encre — jamais en gradient mou.
- Vert `#15803D` pour les "vérifié / conformité" (badge BAZG, status live, install confirm).
- Teal `#0F766E` ultra ponctuel pour ROI.
- Beaucoup d'air, hiérarchie typographique forte, filets fins.

### Principes anti-saturation
- Une animation à la fois en focus (pas tout qui bouge ensemble).
- Une seule "feature visuelle ambiante" par section (terminal dans le hero, gradient subtil dans la bundle card, bordure rouge dans la quote section).
- Sections séparées par filets fins, pas par changements de fond agressifs.

---

## 3. Design tokens (à appliquer dans `web/src/styles/global.css`)

### Couleurs (remplacer le bloc `:root` actuel)
```css
:root {
  --bg:           #FBFBF8;                 /* paper froid, presque blanc */
  --bg-soft:      #F4F4F0;                 /* section alterne */
  --bg-card:      #FFFFFF;                 /* cards */
  --ink:          #0A0A0C;                 /* ink intense */
  --ink-soft:     #4A4D55;                 /* body text */
  --ink-mute:     #8A8D95;                 /* metadata, mono refs */
  --line:         rgba(10,10,12,.08);
  --line-strong:  rgba(10,10,12,.14);
  --accent:       #DC1F2D;                 /* rouge confédéral, accents critiques */
  --accent-soft:  rgba(220,31,45,.06);
  --green:        #15803D;                 /* conformité, vérifié */
  --green-soft:   rgba(21,128,61,.08);
  --teal:         #0F766E;                 /* ROI signal, ponctuel */
}
```

### Typographies (drop l'ancien set)
```css
:root {
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
}
```
- **Drop** : `Inter`, `Instrument Serif`, `JetBrains Mono`.
- **Add** : `Geist` + `Geist Mono` via Google Fonts (`weight 400;500;600;700;800;900` + mono `400;500;600`).
- Font-feature-settings : `'ss01', 'cv11'` pour Geist (active les ligatures techniques propres).

### Easing & timing
```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --t-fast:  .2s;
  --t-med:   .4s;
  --t-slow:  .8s;
}
```

### Filets et radius
- `border-radius` : 8px boutons, 12px cards, 14px fiches premium. **Plus de 20px**.
- Border standard : `1px solid var(--line)`.
- Box-shadow doux, jamais coloré : `0 12-24px 24-60px -8 to -24 rgba(10,10,12, .14-.35)`.

---

## 4. Architecture de la page (top → bottom)

| Section | Composant principal | Rôle persona | Notes |
|---|---|---|---|
| 1. Status bar | `StatusBar` | universel | sticky, blur, scroll-detect, status dot live |
| 2. Hero | grid 2 cols + `Terminal` | **A** dev (terminal) + univ (titre/lede) | reveal stagger, count-up "~12 800", install bar copy, trace SVG |
| 3. Trust strip | `TrustStrip` | univ | 1 ligne mono : sources + 3 badges (Permission BAZG, DKIM, SHA-256) |
| 4. Personas | 3× `PersonaTile` | A + B + C explicites | un slot par persona, ultra court, hover smooth |
| 5. Datasets | 3× `Fiche` (default) + 1× `Fiche` (bundle) | univ + ROI | grille 4 cols, bundle noir avec gradient rouge subtil |
| 6. How it works | 4× `Step` | univ | étapes numérotées, ligne dashed connectante |
| 7. Quote BAZG | `Quote` | **B** compliance | full bleed noir, top gradient rouge, citation modeste |
| 8. CTA final | bloc centré | univ | 1 primary + 1 secondary + 1 mono |
| 9. Footer | `Footer` simplifié | univ | "Édité à Ogens, VD, Suisse" + nav légale mono |

---

## 5. Composants Astro

### Nouveaux composants (à créer dans `web/src/components/`)

| Fichier | Props | Rôle |
|---|---|---|
| `StatusBar.astro` | — | Header sticky avec logo+mark, meta ED/v/Berne, nav, status dot |
| `DataRibbon.astro` | `{ items: Array<{label, value, strong?}>, badge?: string }` | Section header style data-ribbon (mono small) |
| `Terminal.astro` | `{ title: string, lines: TermLine[], autoplay?: boolean }` | Terminal preview animé typewriter |
| `InstallBar.astro` | `{ command: string }` | CTA copy-to-clipboard noir mono |
| `PersonaTile.astro` | `{ letter: 'A'\|'B'\|'C', tag, title, description, proof: { text, variant: 'mono'\|'green'\|'teal' }, link, href }` | Tile persona |
| `Fiche.astro` | `{ slug, ribbon, title, sub, desc, formats[], price, currency, theme: 'default'\|'bundle', roi?: string }` | Fiche dataset (premium = bundle theme) |
| `TrustStrip.astro` | `{ sources: string[], badges: Array<{label, variant}> }` | Bandeau confiance |
| `Step.astro` | `{ num: string, tag, title, text }` | Étape "comment ça marche" |
| `Quote.astro` | `{ source, date, text, author, role, ctas: Array<{label, href}> }` | Citation autorité full-bleed noire |
| `HeroTrace.astro` | — | SVG décoratif animé bottom-left du hero |

### Composant à refondre
- `Header.astro` actuel → **remplacé** par `StatusBar.astro`.
- `Footer.astro` → simplifier en suivant pattern V4 minimal (1 ligne mono).

### Composants à NE PAS toucher cette session
- `HSLookup.astro`, `ClassificationsLookup.astro`, `FinmaLookup.astro` — ils sont sur les pages dataset détail, refonte session 2.
- `CodePlayground.astro` — idem.

---

## 6. Animations à implémenter

| # | Animation | Trigger | Implémentation |
|---|---|---|---|
| 1 | Reveal on scroll | `.reveal` éléments entrent en viewport | `IntersectionObserver` (threshold 0.12, rootMargin '0px 0px -60px 0px'), classe `.in` ajoutée, stagger via `data-delay="1..5"` (transition-delay incrémentaux .08s) |
| 2 | Status bar shadow | scroll Y > 8px | listener scroll passive, classe `.scrolled` |
| 3 | Terminal typewriter | terminal entre en viewport | `IntersectionObserver` threshold 0.3, append ligne par ligne avec délais variables (200-700ms), cursor blink final |
| 4 | Count-up | `[data-count="N"]` entre en viewport | rAF avec ease cubic `1 - (1-t)³`, format `Intl.NumberFormat('fr-CH')` |
| 5 | SVG path trace | au load | `stroke-dasharray + stroke-dashoffset` animation 2.6s ease-out |
| 6 | H1 underline accent | au load | pseudo `::after` scaleX 0→1, animation 1s delay 0.6s |
| 7 | Status dot pulse | continu | box-shadow expansion 2.2s ease-out infinite |
| 8 | Hover cards | hover | `translateY(-3 to -4px)` + shadow + border-color smooth, transition `--t-med` |
| 9 | Install bar copy | click | navigator.clipboard, flash green ✓ copied 1.6s |
| 10 | Logo mark hover | hover | rotate 45deg sur la croix suisse stylisée |

### Helpers JS
- Tout dans un seul script inline (`<script is:inline>`) en bas de `index.astro`, ou dans `web/src/scripts/landing.ts` importé via `<script>` Astro (Astro fait le bundling).
- Recommandation : **inline** car court (~80 lignes JS) et évite un fetch séparé.

---

## 7. Contenu (validé)

### Hero
- Eyebrow : "Données officielles suisses · Permission BAZG ✓"
- H1 : "Données fédérales suisses, **normalisées.**"
- Lede : "TARES, NOGA·NACE·ISIC, FINMA Registry — extraits des sources autoritaires fédérales, livrés **normalisés, versionnés et signés**. Pour vos pipelines, vos audits, et vos intégrations ERP."
- Spec row : 3 specs (Datasets · Codes · Formats)
- CTAs : `Voir les datasets →` (primary noir) + Install bar `npx @osd/cli pull tares` (copy)
- Permission line : Sources / ✓ Permission accordée 2026-04-21 / For Berne

### 3 mini-personas
- **A · Data engineers** : "Une vraie donnée. Une vraie API." Proof mono `$ npm i @osd/sdk`. Link : `SDK & docs →`
- **B · Conformité** : "Quand l'audit frappe, vous avez les pièces." Proof verte `✓ BAZG · permission 2026-04-21`. Link : `Voir les preuves →`
- **C · Intégrateurs ERP** : "~5 jours-homme économisés par release." Proof teal `~5 j-h × release · = ~6 000 CHF`. Link : `Calculer le ROI →`

### Datasets
- TARES (BAZG, 299 CHF, ~7 500 codes DE/FR/IT)
- Classifications (OFS, 399 CHF, ~3 800 codes 4 langues, NOGA/NACE/ISIC + cross-walks)
- FINMA (FINMA, 299 CHF, ~1 500 entités CH)
- Bundle (799 CHF, prix barré 997, ROI box "~15 j-h économisés / an · ~18 000 CHF en interne", −37%)

### Quote BAZG
- "Permission accordée pour la diffusion commerciale des données TARES sous votre offre, sous réserve des conditions usuelles d'attribution et d'exclusion."
- Auteur : Michael Beer, Chef Tarifgrundlagen, BAZG · 2026-04-21
- CTAs : "Voir les conditions BAZG complètes →" + "Voir l'audit log →"

### How it works
- 01 Stripe Checkout → 02 Magic-link → 03 Signed URL R2 → 04 SDK ou raw

### CTA final
- H2 : "Prêt à brancher la donnée suisse ?"
- Sub : "299 CHF par dataset, 799 CHF le bundle. Mises à jour mensuelles incluses. Pas d'engagement, refund 14 jours."

### Footer
- Une ligne : "openswissdata · Édité à Ogens, VD, Suisse · 2026 · IDE en cours" + nav légale (CGV / Privacy / Impressum / SDR Policy / contact@)

---

## 8. Périmètre de la session 1h (priorisation)

### Phase 1 — Tokens & fonts (10 min)
- Update `web/src/layouts/BaseLayout.astro` : remplacer le link Google Fonts par Geist + Geist Mono.
- Update `web/src/styles/global.css` :
  - Remplacer le bloc `:root` couleurs/fonts.
  - Ajouter les easings et timings.
  - **GARDER** les anciennes classes `.ds-*`, `.hs-lookup-*`, `.faq-*`, `.before-*`, etc. utilisées par les pages dataset/legal/blog non refondues cette session — pour ne pas tout casser.
  - Ajouter les nouvelles classes V4 (`.bg-grid`, `.reveal`, `.status`, `.hero`, `.persona`, `.fiche`, `.term`, etc.) en bas du fichier.

### Phase 2 — Composants (20 min)
- Créer les 10 composants Astro listés en section 5.
- Inline le JS d'animations à la fin du `index.astro` (ou `BaseLayout` si réutilisable).

### Phase 3 — Refonte `index.astro` (20 min)
- Sauvegarder l'ancienne version : `git mv index.astro index-old.astro` ou simplement écraser (versionné par git).
- Composer la nouvelle landing à partir des composants.
- Le contenu est exactement celui validé en mockup `.design-preview/`.

### Phase 4 — QA + déploiement (10 min)
- `cd web && npm run dev` → vérifier en localhost que :
  - Animations smooth, pas de jank
  - Terminal joue automatiquement
  - Count-up correct
  - Install bar copy fonctionne
  - Hover cards smooth
  - Pages dataset/legal/blog non cassées (elles utilisent encore les classes héritées)
- Build prod : `npm run build` (tout le repo, pas juste web)
- Commit + push + redeploy Railway (`railway up --detach` car pas de git remote auto)
- Vérifier en live sur https://www.openswissdata.com

---

## 9. Hors scope cette session (à planifier session 2+)

- Pages détail dataset (`/datasets/tares`, `/datasets/classifications`, `/datasets/finma`)
- Page bundle (`/bundle`)
- Page account (`/account`)
- Pages légales (`/legal/*`) — visuel cohérent à refaire
- Pages blog (`/blog/*` + `/blog/[slug]`)
- Lookups widgets (HSLookup, ClassificationsLookup, FinmaLookup) — refondre pour matcher V4
- Mobile responsive fine-tuning (les breakpoints sont en place mais polish à faire)
- Footer V4 plus riche (peut-être une vraie nav multi-cols si besoin)
- Suppression définitive des classes héritées du global.css une fois toutes les pages migrées

---

## 10. Risques et mitigations

| Risque | Mitigation |
|---|---|
| Geist via Google Fonts indisponible | Fallback `system-ui, sans-serif` cohérent côté CSS. Tester `<link>` au build. |
| Pages dataset/legal/blog cassent visuellement | Garder l'ancien CSS scoped en parallèle dans global.css (cohabitation, pas remplacement). Les `.ds-*` classes restent valides. |
| Terminal typewriter lourd sur mobile | Le terminal est en `display:none` < 1100px (déjà géré par grid template columns). |
| Animation reveal jank au scroll rapide | IntersectionObserver est natif et perf-friendly. Utiliser `will-change: transform, opacity` sur `.reveal` si jank constaté. |
| Régression checkout / API / lookups | Aucun changement back-end. Aucun changement aux pages dataset détail (qui contiennent les lookups). Risque nul côté logique. |

---

## 11. Acceptance criteria

- [ ] La page d'accueil charge en moins de 2s (LCP ≤ 2.5s, sinon dégrader le terminal autoplay).
- [ ] Le terminal joue automatiquement quand il entre en viewport.
- [ ] Reveal animations stagger smooth, pas de jank visible sur MacBook M-series.
- [ ] Bouton "copy" copie bien `npx @osd/cli pull tares` et flash vert.
- [ ] Compteur "~12 800" s'incrémente avec ease cubic.
- [ ] Layout responsive : desktop 1100px+ (terminal visible), tablet/mobile < 1100px (terminal hidden, persona-grid stack, dataset-grid stack).
- [ ] Pas de régression sur pages existantes : `/datasets/*`, `/legal/*`, `/blog/*`, `/account`, `/bundle` rendent comme avant.
- [ ] Build Astro passe sans warning.
- [ ] Live sur https://www.openswissdata.com après push + `railway up --detach`.

---

## 12. Mockup de référence

Le mockup HTML autonome final est dans `.design-preview/index.html` (gitignored via `.gitignore.local`). Il contient :
- Le code CSS V4 complet (à porter dans `global.css`)
- Le markup HTML de chaque section (à porter dans les composants Astro)
- Le JS d'animations (à porter inline dans `index.astro`)

C'est la **source de vérité visuelle** pour l'implémentation. Toute divergence doit être consciente et justifiée.
