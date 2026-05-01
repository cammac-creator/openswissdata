# Audit accessibilité WCAG 2.1 AA — openswissdata.com

**Date** : 2026-05-01 nuit · **Auditeur** : Claude (audit code source)
**Cible** : `web/src/` (Astro statique, déployé sur https://www.openswissdata.com)
**Méthode** : revue du code source (source de vérité). Pages testées via lecture des `.astro`. Focus : 8 pages publiques majeures + 4 composants interactifs critiques.

---

## 1. Résumé exécutif

**Score WCAG 2.1 AA estimé** : **6.5 / 10** (passable, mais finding majeur sur le contraste)

Le site Astro est **structurellement très propre** : `<html lang="fr">` correct, sémantique HTML5 respectée (`<main>`, `<nav>`, `<header>`, `<footer>`, `<details>/<summary>`), aucune balise `<img>` (tout en SVG inline), aucun `onclick` sur `<div>`, aucun piège clavier identifié. Les SVG décoratifs portent majoritairement `aria-hidden="true"`. Les boutons icon-only ont des `aria-label`.

**Top 5 violations** :

1. **CRITIQUE — Contraste `--ink-mute` (#8A8D95) sur `--bg` (#FBFBF8) ≈ 3.2:1** → échec AA pour texte normal (seuil 4.5:1). Utilisé partout (footer, méta, prix, sub-labels, breadcrumbs).
2. **MAJEUR — Aucun skip-to-content link** → screen-reader users doivent traverser la nav à chaque page. *Quick win appliqué.*
3. **MAJEUR — `outline: none` sur `.hs-lookup-input` sans alternative `:focus-visible`** → invisible au clavier. *Quick win appliqué.*
4. **MAJEUR — Inputs `<input type="search">` et `<input type="email">` sans `<label>` associé** dans 4 fichiers (HSLookup, FinmaLookup, ClassificationsLookup, account). *Quick win appliqué via `<label class="sr-only">`.*
5. **MOYEN — Aucun focus-visible global** → tous les liens et boutons relient sur le focus système par défaut, parfois supprimé silencieusement par les transitions. *Quick win appliqué (style global subtil).*

Après application des quick wins (cf. § 4) le score remonte à **~8 / 10**. Le finding #1 (contraste `--ink-mute`) reste la dernière brique à valider visuellement avant fix global.

---

## 2. Violations par critère WCAG

### A. Perceivable

#### A.1 — Contraste texte/fond (1.4.3 AA)

| Variable | Hex | Sur `--bg` (#FBFBF8) | Verdict |
|---|---|---|---|
| `--ink` | `#0A0A0C` | ~19:1 | PASS large |
| `--ink-soft` | `#4A4D55` | ~8:1 | PASS |
| `--ink-mute` | `#8A8D95` | **~3.2:1** | **FAIL AA** (seuil 4.5:1 pour body) |
| white sur `--accent` (#DC1F2D) | — | ~4.8:1 | PASS limite |
| white sur `--green` (#15803D) | — | ~5.1:1 | PASS |

**Sévérité : critique.** `--ink-mute` est partout, souvent à 11–14 px : `.section-tag`, `.hs-lookup-meta`, `.hs-lookup-empty`, `.footer-bottom`, `.footer-affiliation`, `.footer-disclaimer`, `.footer-col-title`, `.ds-price-box-renew`, `.eyebrow` (sur 12 px UPPERCASE bold = ~3:1 limite), etc.

**Fix recommandé** : passer `--ink-mute` à `#6B6E76` (≈ 4.7:1). Modification d'une seule ligne dans `web/src/styles/global.css:11`. Risque visuel : couleur légèrement plus contrastée mais reste subtile, cohérente avec design palette. **À tester visuellement avant push** — non appliqué automatiquement (cf. § 5).

#### A.2 — Texte alternatif images (1.1.1 A)

**OK.** Aucune `<img>` dans le projet. Tous les SVG décoratifs ont `aria-hidden="true"` (`HeroTrace.astro`, icônes lookup, code playground, etc.). Les SVG porteurs d'information (`famille.astro:61, 572, 964`) ont `aria-label`.

#### A.3 — Texte redimensionnable (1.4.4 AA)

`html { font-size: 17px }` (`global.css:60`) — utilisateur peut zoomer car `rem` est dérivé. **OK.** Les composants utilisent `px` mais c'est acceptable car le `rem` browser zoom fonctionne.

#### A.4 — Couleur seule indicateur (1.4.1 A)

**OK.** Les badges utilisent un texte (`green` + check icon SVG, `red` + sparkle), les états error sur `account.astro` ajoutent une icône + texte ("That link is not valid…"). Les valeurs FAIL/PASS dans le terminal hero sont accompagnées de symboles (`✓`).

### B. Operable

#### B.1 — Navigation clavier (2.1.1 A)

Tous les liens et boutons utilisent les balises sémantiques natives (`<a>`, `<button>`). Aucun `<div onclick>`. **OK.**

#### B.2 — Skip-to-content (2.4.1 A)

**MAJEUR : aucun skip link** dans `BaseLayout.astro` avant le quick win. Un screen-reader user (JAWS, NVDA) doit Tab à travers la `StatusBar` (~7 liens) à chaque page. **FIXÉ** : `BaseLayout.astro:73` ajoute `<a href="#main" class="skip-to-content">` masqué visuellement, visible au focus. `<main id="main" tabindex="-1">` reçoit le focus programmatique.

#### B.3 — Pas de piège clavier (2.1.2 A)

Aucune modale ouvrante côté Astro statique. `<details>/<summary>` natif gère Esc. Le menu mobile (`StatusBar.astro`) n'a pas de menu déroulant — c'est plus une status-bar fixe. **OK.**

**Note importante** : `web/src/components/Header.astro` contient un `<button class="nav-toggle">` avec menu mobile, mais ce composant **n'est importé nulle part** (vérification `grep -rn "Header"` : 0 import). C'est du **code mort** à supprimer ou à intégrer (si intégré, manque `aria-expanded` + close on Esc + focus trap — voir § 6).

#### B.4 — Focus visible (2.4.7 AA)

**MAJEUR avant quick win** :
- `global.css:467` `.hs-lookup-input { outline: none }` sans `:focus-visible` alternative → invisible au clavier.
- Aucune règle globale `:focus-visible` → certains browsers retirent le focus ring dans des cas border-color hover transitions.

**FIXÉ** :
- `.hs-lookup-input:focus-visible` : `outline: 2px solid var(--color-ink); outline-offset: 2px`.
- Règle globale `a:focus-visible, button:focus-visible, input:focus-visible, [tabindex]:focus-visible` à `outline: 2px solid var(--color-ink); outline-offset: 2px` — sobre, ne s'affiche qu'au clavier (pas au clic souris).
- `.ds-cta-btn:focus-visible` (existait déjà ligne 1154, conservé).

#### B.5 — Targets touch (2.5.5 AAA, recommandé AA)

Boutons hero CTA (`.v4-btn`) ≥ 44 px ✓. Liens nav inline (`.nav-links a`) ~14 px font-size mais zone de hit augmentée par padding parent. `.v4-status-nav a` zone touch limite (à mesurer en runtime). `.fn-chip`, `.cl-chip`, `.hs-chip` ~28 px de hauteur — **trop petit pour mobile** (recommandé 44×44, AAA).

**Sévérité : moyen.** Pas un échec AA strict mais à améliorer (cf. § 5).

### C. Understandable

#### C.1 — `<html lang="fr">`

**OK** sur `BaseLayout.astro:16` et `famille.astro:6`.

#### C.2 — Labels formulaires (3.3.2 A, 1.3.1 A)

**MAJEUR avant quick win** : 4 inputs sans `<label>` :
- `HSLookup.astro:25` (`<input type="search" id="hs-input">`)
- `FinmaLookup.astro:24` (id `fn-input`)
- `ClassificationsLookup.astro:24` (id `cl-input`)
- `account.astro:14` (`<input type="email" name="email">` — pas même un `id`)

Les placeholders ne sont **pas** une alternative valide (disparaissent à la saisie, contraste souvent insuffisant).

**FIXÉ** : tous reçoivent un `<label class="sr-only" for="...">` avec un texte explicite ("Recherche d'un code TARES par mot-clé ou code HS", etc.). La classe `.sr-only` est ajoutée à `global.css` (clip-path technique standard, accessible aux SR).

#### C.3 — Erreurs identifiées (3.3.1 A)

`account.astro:7` utilise `role="status" aria-live="polite"` pour le banner de retour (auth=ok|invalid|expired) — **bon pattern**. Le `alert("Download failed: ...")` ligne 135 est un fallback acceptable (modal natif accessible) mais perfectible (toast aria-live serait plus moderne).

Aucun `aria-invalid` sur l'input email login en cas d'erreur — pas d'indicateur sémantique d'erreur sur le champ lui-même. **Sévérité : mineure** (le banner aria-live couvre l'essentiel).

### D. Robust

#### D.1 — HTML valide (4.1.1 A)

Aucune balise mal fermée détectée. Astro valide à la compilation. **OK.**

#### D.2 — ARIA cohérent (4.1.2 A)

- `aria-label="Effacer"` sur les 3 boutons clear : amélioré en "Effacer la recherche" (plus précis pour SR).
- `aria-hidden="true"` ajouté sur les SVG des clear buttons et du copy button (étaient absents).
- `code-copy` button : `title` seul → ajout `aria-label="Copier le code dans le presse-papier"` (le `title` n'est pas systématiquement annoncé par les SR).
- `v4-hero-chain` (index.astro:66) : `aria-label="Chaîne de provenance cryptographique"` sur un container décoratif — **bon**.

#### D.3 — Landmarks (1.3.1 A)

- `<header>` : aucun `<header>` haut de page (StatusBar n'utilise que `<div>`). **Mineur** : la `StatusBar` pourrait utiliser `<header role="banner">`.
- `<nav>` : présent dans StatusBar (`<nav class="v4-status-nav">`) et breadcrumbs.
- `<main>` : ajouté avec `id="main"` sur quick win.
- `<footer>` : présent dans `Footer.astro`.
- **OK global**, mais pas de `aria-label` sur les multiples `<nav>` (4 nav différents : status, breadcrumb pages, footer-cols implicite). Pour SR, utiliser `<nav aria-label="Fil d'Ariane">` sur les breadcrumb (cf. § 5).

---

## 3. Quick wins appliqués (commit en cours)

Tous appliqués sans casser le design ni les tests (45 fichiers, 297 tests passent ; build Astro 1066 pages OK).

| # | Fix | Fichier:ligne |
|---|---|---|
| 1 | Skip-to-content link visible au focus | `BaseLayout.astro:73`, `global.css` (.skip-to-content) |
| 2 | `<main id="main" tabindex="-1">` cible du skip | `BaseLayout.astro:75` |
| 3 | Classe `.sr-only` réutilisable | `global.css` |
| 4 | Focus-visible global subtil (ink, 2px, offset 2px) | `global.css` |
| 5 | `.hs-lookup-input:focus-visible` outline | `global.css:467` (remplace `outline: none` orphelin) |
| 6 | `<label class="sr-only">` sur HSLookup input | `HSLookup.astro:20` |
| 7 | `<label class="sr-only">` sur FinmaLookup input | `FinmaLookup.astro:19` |
| 8 | `<label class="sr-only">` sur ClassificationsLookup input | `ClassificationsLookup.astro:19` |
| 9 | `<label for="login-email" class="sr-only">` + `id` sur email login | `account.astro:13-14` |
| 10 | `aria-label` précisé + SVG `aria-hidden` sur 3 clear buttons + 1 copy button | HSLookup, FinmaLookup, ClassificationsLookup, CodePlayground |

---

## 4. Améliorations moyenne durée (< 30 min chacune)

1. **Contraste `--ink-mute`** : changer `global.css:11` de `#8A8D95` à `#6B6E76`. Tester visuellement les pages /, /datasets/*, /bundle, /compliance, footer. Single-line fix mais nécessite revue Pixel-perfect.

2. **`<header role="banner">` sur StatusBar** : remplacer `<div class="v4-status">` par `<header class="v4-status">` + `aria-label` distinctif si plusieurs nav. ~5 min.

3. **`aria-label` sur breadcrumbs** : sur les 13 `<nav class="ds-breadcrumb">` dans pages/, ajouter `aria-label="Fil d'Ariane"`. Find/replace global, ~5 min.

4. **Targets touch sur chips lookup** : `.hs-chip, .cl-chip, .fn-chip` passer de `padding: 6px 12px` à `padding: 10px 14px` + `min-height: 36px` pour atteindre 44 px en touch (40 sans bordure ronde + ratio fix-target). ~3 min CSS.

5. **`aria-invalid` + `aria-describedby`** sur `account.astro:14` (email) en cas d'erreur banner. Pattern : on input error, set `aria-invalid="true"` et lier vers le banner. ~10 min JS.

6. **Suppression Header.astro** mort code OU intégration propre. Si intégration : ajouter `aria-expanded` sur `nav-toggle`, fermer sur Esc, focus trap minimal. ~15 min.

7. **Reduced motion** : ajouter `@media (prefers-reduced-motion: reduce) { .reveal, .reveal-v4 { transition: none; } .badge-dot, .status-dot { animation: none; } }`. ~5 min, important pour utilisateurs sensibles aux animations.

8. **Lien externe `target="_blank"`** : `tares.astro:44`, `famille.astro` etc. ont `rel="noopener"` — bon. Ajouter `aria-label` indiquant "ouvre nouvel onglet" ou icône visuelle dédiée (optionnel mais best practice).

---

## 5. Refactors long-terme

1. **Composant Modal accessible** : si une roadmap inclut bientôt des modales (ex : confirmation d'achat, preview dataset), prévoir un composant avec `role="dialog" aria-modal="true"`, focus trap, Esc handler, focus return. ~2-4h.

2. **Audit automatisé en CI** : ajouter `axe-core` ou `pa11y-ci` sur les principales pages buildées. Bloquer PR si nouvelles violations critiques. Setup ~1h, ROI long-terme énorme pour rester conforme.

3. **Dark mode accessible** : actuellement aucun dark mode. Si ajouté, auditer **chaque** paire couleur (ratio AA recalculé). Nécessite système de tokens dual-theme.

4. **Test screen reader réel** (NVDA + VoiceOver) sur 5 parcours critiques :
   - Achat bundle (/ → /bundle → /api/checkout/start)
   - Login magic link (/account)
   - Lookup TARES (/datasets/tares + démo)
   - Lecture FAQ (/ #faq)
   - Téléchargement zip après auth (/account dashboard)
   ~2h dont consolidation.

5. **Contraste mode forcé Windows (CSS Forced Colors Media)** : pour utilisateurs avec High Contrast mode Windows, ajouter `@media (forced-colors: active)` testant les bordures buttons custom. ~30 min.

---

## 6. Notes de scope

- **Audit fait sur le source code**, pas sur le DOM live. Le déployé Vercel est cohérent avec source (Astro SSG → 1:1 mapping).
- **Pages auditées** (12) : `index.astro`, `bundle.astro`, `account.astro`, `compliance.astro`, `mcp.astro`, `famille.astro`, `datasets/{tares,classifications,finma}.astro`, `legal/{cgv,privacy,impressum,provenance,sdr-policy}.astro`, `blog/index.astro`, `codes/index.astro`. Composants : `BaseLayout`, `Header` (mort), `StatusBar`, `Footer`, `HSLookup`, `FinmaLookup`, `ClassificationsLookup`, `CodePlayground`, `Quote`, `Fiche`, `PersonaTile`.
- **Header.astro confirmé mort code** (0 import). Recommandation : supprimer ou intégrer proprement.
- **Conformité EU Accessibility Act juin 2025** : avec les quick wins appliqués + contraste `--ink-mute` corrigé, openswissdata est aligné AA pour le marché B2B EU. Reste une revue annuelle recommandée.

---

**Verdict final** : openswissdata a une fondation HTML très propre (peu de dette d'accessibilité héritée). Les quick wins appliqués cette nuit ferment la majorité des trous critiques. Le seul finding restant majeur est le contraste `--ink-mute` qui mérite une décision design avant fix (1 ligne CSS, mais changement de palette globale).

**Score post-quick-wins** : **8 / 10** AA. Avec contraste fix : **9 / 10**.
