# Audit responsive mobile — openswissdata.com

**Date** : 2026-05-01 nuit
**Périmètre** : `/`, `/datasets/{tares,classifications,finma}`, `/bundle`, `/mcp`, `/compliance`, `/legal/{cgv,provenance}`, `/account`, `/codes/noga/[code]`
**Cibles** : iPhone SE 375px (priorité), iPad 768px, desktop 1440px+
**Tests** : 297/297 verts (Vitest), `astro build` OK 1066 pages
**Fixes appliqués** : 7 quick wins, commit `fix(responsive): ...`

---

## 1. Résumé exécutif — 5 ruptures critiques

1. **Pricing MCP en 4 colonnes** sur mobile (`/mcp` ligne 250) — sans breakpoint, les 4 cartes Free/Standard/Pro/Standalone se compressaient en bandes illisibles → **fixé**.
2. **StatusBar V4 globale sans breakpoint mobile** (`StatusBar.astro` + `global.css` ligne 1273) — la barre sticky logo + meta + nav + status débordait à 375px → **fixé** (cache `v4-status-meta` <881px, masque nav <541px).
3. **Hero `v4-spec-row` width: fit-content** (ligne 1394 `global.css`) — les 3 specs Datasets/Codes/Formats forcent ~450px et débordent à 375px → **fixé** (passage en colonne empilée <721px).
4. **Tables compliance.astro** (5 colonnes Tailwind sans wrapper scroll) — débordement horizontal sur mobile → **fixé** (wrapper `overflow-x:auto` + `min-width: 560px`).
5. **Pro-tier classifications 3-col** (`classifications.astro` ligne 141) — sans breakpoint, 3 cartes de 200px+ écrasaient le texte → **fixé**.

---

## 2. Par breakpoint

### iPhone SE — 375px (cible critique)

**Avant fix** (déductions code) :
- StatusBar : logo + 3 metas + nav 3 liens + status dot + texte → ≥ 540px largeur effective, scroll horizontal sur tout le site.
- Hero `v4-spec-row` : 3 cellules grid `grid-auto-flow: column` + `width: fit-content` → ~450px, dépasse.
- Hero v4-h1 `clamp(40px, 5.4vw, 64px)` → OK (40px sur 375px).
- mcp.astro pricing : `grid-template-columns: repeat(4, 1fr)` inline → cartes ~80px, illisibles.
- mcp.astro playground : `1fr 1fr` (Tool select + Args input) → 2 fields collés.
- compliance.astro tables : 5 colonnes en `<table>` brut sans wrapper.
- bundle.astro `.ds-saving-row.save` : `margin: 4px -24px -8px` collé au bord du conteneur 16px-padded.

**Après fix** :
- StatusBar : logo + status dot uniquement <541px (`v4-status-nav` masqué).
- v4-spec-row passe en colonne 1 (border-bottom au lieu de right).
- Pricing mcp passe en 1 colonne <641px, 2 colonnes <1024px.
- Tables compliance scrollables horizontalement avec indication tactile.
- bundle saving-row alignée sur padding réduit 16px.

**Restant à surveiller** :
- `v4-hero-chain` : 5 nodes + 4 links en flex `nowrap` avec `overflow: hidden`. Tronqué à droite sur 375px (par design — la chaîne déborde mais cachée). Visuellement acceptable mais on perd le node "Verified" final.
- `v4-trust-row` : `flex-wrap: wrap` est OK mais le texte est en `text-transform: uppercase` letter-spacing: .04em → `BAZG · OFS · FINMA · permission · …` peut occuper 2-3 lignes denses.
- Page `/account` : utilise des classes Tailwind brutes (`px-3 py-2`, `text-3xl`). Input email `class="px-3 py-2"` = 12px padding. Un peu serré sur 375px mais fonctionnel. CTA bouton `px-4 py-2 bg-indigo-600` largeur naturelle ~140px : tap target acceptable.
- `/codes/noga/[code]` : tables OK (utilisent `ds-table-wrap` partout — le composant global a `overflow-x: auto`).

### iPad portrait — 768px

- v4-dataset-grid : passe en `1fr 1fr` (`<= 1100px`) → 2 cartes côte-à-côte. OK.
- v4-persona-grid : passe en 1 colonne `<= 1000px` → empilé. OK mais peut-être trop tôt (3 cartes pourraient tenir 2-2 à 768px). Acceptable.
- StatusBar : `v4-status-meta` masqué `<881px` → simplifié. OK.
- Header mort code (`Header.astro` non importé) — non utilisé.
- mcp.astro pricing : passe en 2 colonnes (nouveau breakpoint 1024px). OK.

### Desktop large — 1440px+

- `.container-v4 max-width: 1320px` + padding 36px → contenu max ~1248px. Bonne marge sur 1440 et 1920 ; pas de problème d'étirement.
- Sur 4K (>2000px) le contenu reste centré, pas de souci.
- `.container-tight max-width: 760px` + `.container-wide max-width: 1180px` : cohérent.
- Pas de fix nécessaire pour cette gamme.

---

## 3. Par page

| Page | Statut | Notes |
|---|---|---|
| `/` (index) | OK fixé | Hero spec-row fixé via global.css. Reste : v4-hero-chain tronqué à droite (acceptable). |
| `/datasets/tares` | OK | Utilise déjà `ds-table-wrap` ligne 66. `ds-meta-grid` `<=720px` empilé. `ds-hero` empilé `<=720px`. |
| `/datasets/classifications` | OK fixé | Pro-tier 3-col avait `repeat(3,1fr)` inline → fixé via classe `cls-pro-grid` + `<=880px` 1col. |
| `/datasets/finma` | OK | Identique à tares.astro, tables wrappées. |
| `/bundle` | OK fixé | `ds-bundle-grid` déjà responsive (`<=880px`). `ds-saving-row.save` margin négatif fixé pour mobile <541px. |
| `/mcp` | OK fixé | Pricing 4-col + playground 2-col fixés. Tools list utilise déjà `1fr` (1 col native). |
| `/compliance` | OK fixé | 2 tables 5-col wrappées dans `<div overflow-x:auto>` + `min-width: 560px`. |
| `/legal/cgv` | OK | Pas de tables. Utilise `max-w-3xl mx-auto px-6` Tailwind = 24px padding latéral, OK iPhone SE. Pas de pre/code longs. |
| `/legal/provenance` | OK | `<pre overflow-x:auto>` déjà présent. Pas de tables. |
| `/account` | OK | Tailwind utility-first. Input email full-width par flexbox. Magic-link button OK. |
| `/codes/noga/[code]` | OK | 4 tables wrappées via `ds-table-wrap`. Footer hierarchy `display:flex flex-direction:column`. |

---

## 4. Composants

### Header.astro — code mort
**Non utilisé** : aucun import. La nav active est `StatusBar.astro` (importé dans `BaseLayout`). Recommandation long-terme : supprimer Header.astro ou le ré-intégrer + supprimer StatusBar pour avoir UN seul header sitewide.

### StatusBar.astro — sticky top, fixé
- Avant : pas de breakpoint, débordement à 375px assuré.
- Après : meta cachée <881px, nav masquée <541px. Logo + status dot toujours visibles.

### Footer.astro — déjà responsive
Breakpoints `<=880px` (passe en 2 colonnes) et `<=540px` (1 colonne). Bon.

### Fiche.astro / `.v4-fiche` — déjà responsive
Grid datasets `repeat(3, 1fr) 1.2fr` → `1fr 1fr` <=1100px → `1fr` <=720px. Buy bar avec `flex-wrap: wrap`. Bon.

### CodePlayground.astro — responsive
Media `<=640px` réduit padding et font-size des tabs. `<pre overflow-x:auto>` natif. OK.

### Lookups (HSLookup, ClassificationsLookup, FinmaLookup)
Breakpoints `<=600px` et `<=640px` pour grilles `cl-result-walks` et `fn-result-grid`. Inputs `width: 100%`. OK.

### Terminal.astro
Body `min-height: 320px` + `font-size: 12.5px` mono. Sur 375px : la ligne `Pulled tares.parquet (1.8 MB · 7 511 rows · v2026.04.30)` peut déborder (white-space: pre + overflow: hidden sur `.v4-term-line`). Comportement attendu (tronqué silencieusement). Acceptable.

### v4-hero-chain (provenance chain)
5 nodes "BAZG → SHA-256 → Ed25519 → RFC-3161 → Verified" en `flex-wrap: nowrap; overflow: hidden`. Sur 375px le node "Verified" est probablement coupé. Comportement non-bloquant (animation décorative).

---

## 5. Quick wins CSS appliqués (commit `fix(responsive): ...`)

1. `web/src/styles/global.css` — StatusBar mobile media queries (`<=880px` cache meta, `<=540px` cache nav).
2. `web/src/styles/global.css` — `.v4-spec-row` empilé en colonne <=720px (fix débordement hero).
3. `web/src/pages/mcp.astro` — pricing grid `repeat(4)` → 2 col <=1024px → 1 col <=640px (classe `mcp-pricing-grid`).
4. `web/src/pages/mcp.astro` — playground `1fr 1fr` → 1col <=640px (classe `mcp-playground-row`).
5. `web/src/pages/datasets/classifications.astro` — pro-tier `repeat(3,1fr)` → 1col <=880px (classe `cls-pro-grid`).
6. `web/src/pages/compliance.astro` — table 1 (Sources) wrappée `<div overflow-x:auto>` + `min-width: 560px`.
7. `web/src/pages/compliance.astro` — table 2 (Permissions) idem.
8. `web/src/pages/bundle.astro` — `.ds-saving-row.save` margin/padding adapté mobile <=540px.

Tous testés : `npx vitest run` 297/297 verts, `astro build` 1066 pages.

---

## 6. Suggestions long-terme (non appliquées, > 30 min chacune)

### Refactor breakpoints (cohérence)
Le projet utilise actuellement 6 breakpoints différents :
- `540px / 600px / 640px / 720px / 880px / 1000px / 1024px / 1100px`

**Recommandation** : standardiser sur 4 breakpoints :
- `--bp-sm: 480px` (smartphone portrait)
- `--bp-md: 768px` (tablette portrait)
- `--bp-lg: 1024px` (tablette landscape / petit desktop)
- `--bp-xl: 1280px` (desktop large)

Refactor : ~30-60 min, mais réduit la dette CSS futurs.

### Supprimer Header.astro (code mort)
Confirmer non-usage ailleurs, supprimer le composant. ~5 min mais nécessite revue.

### Container queries pour Fiche/Persona
Au lieu de breakpoints viewport, utiliser `container-type: inline-size` sur `.v4-dataset-grid` et `.v4-persona-grid`. Permet de re-utiliser ces composants dans des contextes plus étroits sans casser la grille. ~1h.

### Mobile menu pour StatusBar
Actuellement <541px on cache complètement la nav. Mieux : ajouter un bouton burger qui ouvre un drawer avec liens Datasets / Comment ça marche / Blog. ~45 min.

### Tap target audit Apple-compliance (44×44px)
Plusieurs liens monospace mini (10px) dans v4-trust-row, v4-status-nav et v4-quote-cta sont en dessous de la cible Apple 44×44. Audit complet + augmentation des padding cliquables : ~30-45 min.

### Pages `/legal/*` Tailwind raw → migrer vers classes maison
Les 3 pages CGV / privacy / provenance / impressum / sdr-policy mélangent `prose` Tailwind et classes brutes (`text-3xl`, `mb-3`). Meilleur : créer un layout `LegalLayout.astro` avec une classe `.legal-prose` partagée. ~1-2h.

### Tester réellement sur device
Le présent audit est statique (lecture code). Recommandation : ouvrir Chrome DevTools en mode iPhone SE et iPad Pro, naviguer chaque page, screenshoter les ruptures restantes éventuelles. ~30 min.

---

## 7. Build & tests post-fix

```
$ npx vitest run --reporter=basic
Test Files  45 passed (45)
Tests       297 passed (297)
Duration    ~4s

$ cd web && npx astro build
1066 page(s) built in 2.83s
[build] Complete!
```

Aucune régression introduite.

---

**Auteur** : Claude (audit automatisé pour Alain)
**Limite** : audit statique sur code source, pas de test réel devicelab. Les ruptures listées sont déduites par lecture des breakpoints + grids ; un test visual réel sur iPhone SE pourrait révéler des micro-ajustements supplémentaires (line-height, baseline alignment).
