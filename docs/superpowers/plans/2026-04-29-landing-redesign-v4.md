# Landing redesign V4 "Swiss Data Engineering" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter le mockup V4 (`.design-preview/index.html`) dans le code Astro réel — refonte totale de `web/src/pages/index.astro` avec design system Geist + animations smooth + 3 angles persona orchestrés sans saturer.

**Architecture:** Cohabitation CSS — on **ajoute** les nouveaux tokens et classes V4 à `web/src/styles/global.css` sans casser les anciennes classes utilisées par les pages dataset/legal/blog non refondues cette session. On crée 10 nouveaux composants Astro réutilisables. On remplace `Header.astro` (référencé dans `BaseLayout`) par `StatusBar.astro`, et on simplifie `Footer.astro`. JS d'animations V4 inline dans `index.astro`.

**Tech Stack:** Astro · Tailwind v4 · Geist + Geist Mono (Google Fonts) · IntersectionObserver · navigator.clipboard.

**Note TDD:** Cette plan touche uniquement du UI visuel. Aucun test unitaire pertinent — la QA est `npm run dev` + inspection navigateur, et `npm run build` pour valider la compilation Astro. Pas de "failing test first".

**Spec source:** `docs/superpowers/specs/2026-04-29-landing-redesign-v4-design.md`
**Mockup source de vérité:** `.design-preview/index.html` (gitignored, présent sur le disque)

---

## Phase 1 — Tokens & fonts (≈10 min)

### Task 1.1: Remplacer le link Google Fonts dans BaseLayout

**Files:**
- Modify: `web/src/layouts/BaseLayout.astro:24-29`

- [ ] **Step 1: Remplacer le link Google Fonts**

Dans `web/src/layouts/BaseLayout.astro`, remplacer les lignes 24-29 :

```astro
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
```

(Drop `Inter`, `Instrument Serif`, `JetBrains Mono`. Add `Geist`, `Geist Mono`.)

- [ ] **Step 2: Démarrer le dev server pour vérification visuelle continue**

```bash
cd web && npm run dev
```

Ouvrir http://localhost:4321 dans le navigateur. La page devrait charger en utilisant désormais Geist (mais l'ancien CSS référence encore `Inter` — c'est attendu, on fixe ça en Task 1.2).

---

### Task 1.2: Ajouter les tokens V4 à global.css (cohabitation, pas remplacement)

**Files:**
- Modify: `web/src/styles/global.css:4-25` (bloc `:root`)

- [ ] **Step 1: Mettre à jour le bloc `:root` de global.css**

Remplacer le bloc `:root` actuel (lignes 4-25) par celui-ci. **Important** : on garde les noms d'anciennes variables `--color-bg`, `--color-ink`, etc. (utilisés par les pages non refondues) MAIS on les pointe vers les nouvelles couleurs V4 + on ajoute les nouveaux tokens explicites :

```css
:root {
  /* === V4 tokens (canoniques) === */
  --bg:           #FBFBF8;
  --bg-soft:      #F4F4F0;
  --bg-card:      #FFFFFF;
  --ink:          #0A0A0C;
  --ink-soft:     #4A4D55;
  --ink-mute:     #8A8D95;
  --line:         rgba(10,10,12,.08);
  --line-strong:  rgba(10,10,12,.14);
  --accent:       #DC1F2D;
  --accent-soft:  rgba(220,31,45,.06);
  --green:        #15803D;
  --green-soft:   rgba(21,128,61,.08);
  --teal:         #0F766E;

  /* === Aliases legacy (compat pages non refondues) === */
  --color-bg:        var(--bg);
  --color-bg-alt:    var(--bg-soft);
  --color-bg-dark:   var(--ink);
  --color-ink:       var(--ink);
  --color-ink-soft:  var(--ink-soft);
  --color-ink-mute:  var(--ink-mute);
  --color-line:      var(--line);
  --color-line-soft: var(--line);
  --color-accent:    var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-gold:      #C8A05A;
  --color-teal:      var(--teal);

  /* === Typo === */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-serif: 'Geist', Georgia, serif; /* legacy compat — pages utilisant .serif rendront en Geist */
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* === Easing & timing === */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --t-fast: .2s;
  --t-med:  .4s;
  --t-slow: .8s;

  /* === Shadows (legacy compat) === */
  --shadow-sm: 0 1px 2px rgba(15,17,21,.04), 0 0 0 1px rgba(15,17,21,.04);
  --shadow-md: 0 4px 16px rgba(15,17,21,.06), 0 0 0 1px rgba(15,17,21,.04);
  --shadow-lg: 0 24px 48px -12px rgba(15,17,21,.18), 0 0 0 1px rgba(15,17,21,.06);
}
```

- [ ] **Step 2: Vérifier en dev que les pages legacy rendent toujours**

Ouvrir successivement et vérifier qu'aucune page ne casse visuellement (Geist au lieu de Inter, mais layout intact) :
- http://localhost:4321/ (l'ancien index, pour l'instant)
- http://localhost:4321/datasets/tares
- http://localhost:4321/legal/cgv

Attendu : les pages s'affichent, le rendu est légèrement différent (Geist remplace Inter / Instrument Serif / JetBrains Mono partout), mais aucune page n'est cassée.

- [ ] **Step 3: Commit Phase 1**

```bash
git add web/src/layouts/BaseLayout.astro web/src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(design): #15 Phase 1/4 V4 — switch fonts to Geist + add V4 tokens

Replace Inter/Instrument Serif/JetBrains Mono with Geist + Geist Mono.
Add V4 canonical tokens (paper, ink, accent, green, teal) and easings.
Keep legacy aliases (--color-bg, --color-ink, etc.) so existing pages
(datasets, legal, blog, account) continue to render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Composants Astro + classes V4 dans global.css (≈25 min)

### Task 2.1: Créer `StatusBar.astro` (sticky header V4)

**Files:**
- Create: `web/src/components/StatusBar.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
// Sticky top status bar V4
// - Logo Geist + mark rouge swisscross stylisée
// - Meta : ED · v · Berne
// - Nav links
// - Status dot live (pulse vert)
---
<div class="status" id="status">
  <div class="status-left">
    <a href="/" class="status-logo">
      <span class="status-logo-mark"></span>
      openswissdata
    </a>
    <div class="status-meta">
      <span>ED. <strong>2026.04</strong></span>
      <span>v<strong>1.0.0</strong></span>
      <span>Berne · CH</span>
    </div>
  </div>
  <div class="status-right">
    <nav class="status-nav">
      <a href="/#datasets">Datasets</a>
      <a href="/#how">Comment ça marche</a>
      <a href="/blog">Blog</a>
    </nav>
    <span><span class="status-dot"></span>3 datasets · live</span>
  </div>
</div>
```

---

### Task 2.2: Créer `DataRibbon.astro`

**Files:**
- Create: `web/src/components/DataRibbon.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface RibbonItem {
  label?: string;
  value: string;
  strong?: boolean;
}
interface Props {
  items: RibbonItem[];
  badge?: string;
}
const { items, badge } = Astro.props;
---
<div class="ribbon">
  {items.map((item, i) => (
    <>
      {i > 0 && <span class="ribbon-dot"></span>}
      <span>
        {item.label && <>{item.label} </>}
        {item.strong ? <strong>{item.value}</strong> : item.value}
      </span>
    </>
  ))}
  {badge && <span class="ribbon-badge">{badge}</span>}
</div>
```

---

### Task 2.3: Créer `Terminal.astro`

**Files:**
- Create: `web/src/components/Terminal.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  title?: string;
  height?: string;
}
const { title = "~/erp-integration — zsh", height = "320px" } = Astro.props;
---
<div class="term" data-autoplay="true">
  <div class="term-bar">
    <div class="term-bar-dots"><span></span><span></span><span></span></div>
    <span class="term-bar-title"><strong>{title}</strong></span>
    <span class="live">live</span>
  </div>
  <div class="term-body" id="termBody" style={`min-height:${height}`}></div>
</div>
```

(Le contenu des lignes est injecté par le JS inline du `index.astro` au scroll. Pas de slot statique.)

---

### Task 2.4: Créer `InstallBar.astro`

**Files:**
- Create: `web/src/components/InstallBar.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  command: string;
}
const { command } = Astro.props;
---
<div class="install-bar" data-cmd={command}>
  <span class="install-bar-prompt">$</span>
  <span class="install-bar-cmd">{command}</span>
  <span class="install-bar-copy">copy</span>
</div>
```

---

### Task 2.5: Créer `PersonaTile.astro`

**Files:**
- Create: `web/src/components/PersonaTile.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  letter: 'A' | 'B' | 'C';
  tag: string;
  title: string;
  description: string;
  proof: { text: string; variant?: 'mono' | 'green' | 'teal'; prompt?: string };
  link: string;
  href: string;
}
const { letter, tag, title, description, proof, link, href } = Astro.props;
const proofClass = proof.variant === 'green' ? 'persona-proof green'
                 : proof.variant === 'teal'  ? 'persona-proof teal'
                 : 'persona-proof';
---
<a href={href} class="persona reveal">
  <div class="persona-tag"><span class="letter">{letter}</span>{tag}</div>
  <h3>{title}</h3>
  <p>{description}</p>
  <div class={proofClass}>
    {proof.prompt && <span class="pp-prompt">{proof.prompt}</span>}
    {proof.variant === 'green' && <span class="pp-icon">✓</span>}
    <span>{proof.text}</span>
  </div>
  <span class="persona-link">{link}</span>
</a>
```

---

### Task 2.6: Créer `Fiche.astro`

**Files:**
- Create: `web/src/components/Fiche.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  ribbonLabel: string;
  ribbonSource: string;
  pillText: string;
  title: string;
  sub: string;
  desc: string;
  formats: string[];
  price: string;
  currency?: string;
  href: string;
  ctaLabel?: string;
  theme?: 'default' | 'bundle';
  roiText?: string;
  strikePrice?: string;
}
const {
  ribbonLabel, ribbonSource, pillText, title, sub, desc, formats,
  price, currency = "CHF", href, ctaLabel = "Détails",
  theme = 'default', roiText, strikePrice
} = Astro.props;
---
<a href={href} class={`fiche ${theme === 'bundle' ? 'bundle' : ''} reveal`}>
  <div class="fiche-ribbon">
    <span><strong>{ribbonLabel}</strong></span>
    <span style="opacity:.4">·</span>
    <span>{ribbonSource}</span>
    <span class="pill">{pillText}</span>
  </div>
  <div class="fiche-body">
    <h3 class="fiche-h3">{title}</h3>
    <p class="fiche-sub">{sub}</p>
    <p class="fiche-desc">{desc}</p>
    {roiText && (
      <div class="fiche-roi">
        <span class="icon">⏱</span>
        <span set:html={roiText}></span>
      </div>
    )}
    <div class="fiche-formats">
      {formats.map((f, i) => (
        <span class={`fmt-chip ${i === 0 ? 'primary' : ''}`}>{f}</span>
      ))}
    </div>
  </div>
  <div class="fiche-buy">
    <div class="fiche-price">
      <span class="amt">{price}</span>
      <span class="unit">{currency}</span>
      {strikePrice && <span class="fiche-strike" style="margin-left:8px">{strikePrice}</span>}
    </div>
    <span class="fiche-cta">{ctaLabel}</span>
  </div>
</a>
```

---

### Task 2.7: Créer `TrustStrip.astro`

**Files:**
- Create: `web/src/components/TrustStrip.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  sources: string[];
  badges: string[];
}
const { sources, badges } = Astro.props;
---
<div class="trust">
  <div class="container">
    <div class="trust-row">
      <span class="trust-label">Sources autoritaires</span>
      {sources.map(s => <span class="src">{s}</span>)}
      <span class="sep">/</span>
      {badges.map((b, i) => (
        <>
          <span class="badge">{b}</span>
          {i < badges.length - 1 && <span class="sep">/</span>}
        </>
      ))}
    </div>
  </div>
</div>
```

---

### Task 2.8: Créer `Step.astro`

**Files:**
- Create: `web/src/components/Step.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface Props {
  num: string;
  tag: string;
  title: string;
  text: string;
  delay?: number;
}
const { num, tag, title, text, delay = 1 } = Astro.props;
---
<div class="step reveal" data-delay={delay}>
  <div class="step-num">{num}</div>
  <div class="step-tag">{tag}</div>
  <h4 class="step-title">{title}</h4>
  <p class="step-text">{text}</p>
</div>
```

---

### Task 2.9: Créer `Quote.astro`

**Files:**
- Create: `web/src/components/Quote.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
interface QuoteCta {
  label: string;
  href: string;
}
interface Props {
  source: string;
  date: string;
  text: string;
  author: string;
  role: string;
  affiliation: string;
  ctas: QuoteCta[];
}
const { source, date, text, author, role, affiliation, ctas } = Astro.props;
---
<section class="quote-section">
  <div class="container">
    <div class="quote-eyebrow reveal">
      <span>Permission commerciale</span>
      <span style="opacity:.4">·</span>
      <span class="src">{source}</span>
      <span style="opacity:.4">·</span>
      <span>{date}</span>
    </div>
    <p class="quote-text reveal" data-delay="1">{text}</p>
    <div class="quote-author reveal" data-delay="2">
      <strong>{author}</strong>
      <span style="opacity:.5">·</span>
      <span>{role}</span>
      <span style="opacity:.5">·</span>
      <span>{affiliation}</span>
    </div>
    <div class="quote-cta reveal" data-delay="3">
      {ctas.map(c => <a href={c.href}>{c.label}</a>)}
    </div>
  </div>
</section>
```

---

### Task 2.10: Créer `HeroTrace.astro`

**Files:**
- Create: `web/src/components/HeroTrace.astro`

- [ ] **Step 1: Créer le composant**

```astro
---
// SVG décoratif animé : trace rouge bottom-left du hero
---
<svg class="hero-trace" viewBox="0 0 320 64" aria-hidden="true">
  <path d="M 10 44 Q 70 10, 130 32 T 250 22 L 310 22"/>
  <circle cx="310" cy="22" r="3.5"/>
</svg>
```

---

### Task 2.11: Ajouter les classes V4 à global.css

**Files:**
- Modify: `web/src/styles/global.css` (append à la fin)

- [ ] **Step 1: Append les classes V4 à la fin de global.css**

Ouvrir `web/src/styles/global.css` et **ajouter à la fin du fichier** (ne rien supprimer) le bloc CSS V4 ci-dessous. Source de vérité : `.design-preview/index.html` (le mockup validé), section `<style>` lignes ≈10-690 (toutes les classes commençant par `.bg-grid`, `.reveal`, `.status`, `.eyebrow`, `.h1`, `.lede`, `.spec*`, `.cta-row`, `.btn*`, `.permission-line`, `.hero-trace`, `.term*`, `.cursor`, `.trust*`, `.personas`, `.section-*`, `.persona*`, `.datasets`, `.dataset-grid`, `.fiche*`, `.fmt-chip`, `.how`, `.steps`, `.step*`, `.quote-section`, `.quote-*`, `.cta-final*`, `.install-bar*`, `footer`, `.foot*`).

Le bloc complet à ajouter (~680 lignes) :

```css
/* ============================================================ */
/* === V4 LANDING — Swiss Data Engineering === */
/* ============================================================ */

/* Universal grid background (very subtle) */
.bg-grid {
  position: fixed; inset: 0;
  pointer-events: none;
  background-image: linear-gradient(to right, rgba(10,10,12,.025) 1px, transparent 1px);
  background-size: calc(100% / 12) 100%;
  z-index: 0;
  mask-image: linear-gradient(to bottom, black 0%, black 30%, transparent 70%);
}

/* Reveal animation V4 (utilise .visible pour matcher le JS existant de BaseLayout) */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity var(--t-slow) var(--ease-out), transform var(--t-slow) var(--ease-out);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
.reveal[data-delay="1"] { transition-delay: .08s; }
.reveal[data-delay="2"] { transition-delay: .16s; }
.reveal[data-delay="3"] { transition-delay: .24s; }
.reveal[data-delay="4"] { transition-delay: .32s; }
.reveal[data-delay="5"] { transition-delay: .4s; }

/* Status bar */
.status {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 36px;
  background: rgba(251,251,248,.85);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-mute);
  transition: border-color var(--t-med) var(--ease-out);
}
.status.scrolled { border-bottom-color: var(--line); }
.status-left { display: flex; align-items: center; gap: 18px; }
.status-logo {
  font-family: var(--font-sans);
  font-weight: 700; letter-spacing: -.02em;
  font-size: 14px; color: var(--ink);
  display: inline-flex; align-items: center; gap: 8px;
  text-decoration: none;
}
.status-logo-mark {
  display: inline-block;
  width: 14px; height: 14px;
  background: var(--accent);
  clip-path: polygon(40% 10%, 60% 10%, 60% 40%, 90% 40%, 90% 60%, 60% 60%, 60% 90%, 40% 90%, 40% 60%, 10% 60%, 10% 40%, 40% 40%);
  transition: transform var(--t-med) var(--ease-out);
}
.status-logo:hover .status-logo-mark { transform: rotate(45deg); }
.status-meta { display: flex; gap: 16px; }
.status-meta span strong { color: var(--ink); font-weight: 500; }
.status-right { display: flex; gap: 16px; align-items: center; }
.status-dot {
  display: inline-block;
  width: 6px; height: 6px;
  background: var(--green);
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
  box-shadow: 0 0 0 0 rgba(21,128,61,.4);
  animation: livepulse 2.2s var(--ease-out) infinite;
}
@keyframes livepulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(21,128,61,.45); }
  50% { box-shadow: 0 0 0 5px rgba(21,128,61,0); }
}
.status-nav { display: flex; gap: 18px; }
.status-nav a {
  color: var(--ink-mute);
  letter-spacing: .04em;
  text-decoration: none;
  transition: color var(--t-fast) var(--ease-out);
}
.status-nav a:hover { color: var(--ink); }

/* Container */
.container { max-width: 1320px; margin: 0 auto; padding: 0 36px; position: relative; z-index: 2; }
@media (max-width: 720px) { .container { padding: 0 20px; } }

/* Hero */
.hero {
  position: relative;
  padding: 64px 0 80px;
  overflow: hidden;
}
.hero-grid {
  display: grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 52px;
  align-items: start;
}
@media (max-width: 1100px) { .hero-grid { grid-template-columns: 1fr; gap: 40px; } }

/* Eyebrow */
.eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--ink-mute);
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  width: fit-content;
}
.eyebrow .check {
  color: var(--green); font-weight: 500;
  display: inline-flex; align-items: center; gap: 5px;
}
.eyebrow .check::before {
  content: ''; width: 6px; height: 6px;
  background: var(--green); border-radius: 50%;
}

/* H1 V4 */
.h1 {
  font-weight: 700;
  font-size: clamp(40px, 5.4vw, 64px);
  line-height: 1.02;
  letter-spacing: -.035em;
  margin-bottom: 22px;
  max-width: 17ch;
}
.h1 .accent { color: var(--accent); position: relative; display: inline-block; }
.h1 .accent::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -2px; height: 2px;
  background: var(--accent);
  transform: scaleX(0); transform-origin: left;
  animation: underline 1s .6s var(--ease-out) forwards;
}
@keyframes underline { to { transform: scaleX(1); } }

/* Lede */
.lede {
  font-size: 18px; line-height: 1.55;
  color: var(--ink-soft);
  max-width: 56ch;
  margin-bottom: 28px;
}
.lede strong { color: var(--ink); font-weight: 600; }

/* Spec row */
.spec-row {
  display: grid;
  grid-auto-flow: column;
  gap: 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: 28px;
  width: fit-content;
}
.spec {
  padding: 12px 22px 12px 0;
  border-right: 1px solid var(--line);
}
.spec:last-child { border-right: none; padding-right: 0; }
.spec:not(:first-child) { padding-left: 22px; }
.spec-label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-mute);
  margin-bottom: 4px;
}
.spec-value {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* CTA row + buttons V4 */
.cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.btn {
  padding: 14px 22px;
  border-radius: 8px;
  font-family: var(--font-sans);
  font-weight: 500; font-size: 14px;
  display: inline-flex; align-items: center; gap: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  text-decoration: none;
  transition: transform var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
}
.btn .arrow {
  font-family: var(--font-mono); font-weight: 400;
  display: inline-block;
  transition: transform var(--t-fast) var(--ease-out);
}
.btn:hover .arrow { transform: translateX(3px); }
.btn-primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.btn-primary:hover { transform: translateY(-1px); background: #1a1a1d; box-shadow: 0 12px 24px -8px rgba(10,10,12,.25); }
.btn-secondary { background: var(--bg-card); color: var(--ink); border-color: var(--line-strong); }
.btn-secondary:hover { background: var(--bg-soft); transform: translateY(-1px); }
.btn-mono {
  font-family: var(--font-mono); font-size: 11px;
  letter-spacing: .04em; text-transform: uppercase;
  color: var(--ink-mute);
  padding: 14px 8px;
  display: inline-flex; align-items: center; gap: 6px;
  text-decoration: none;
  transition: color var(--t-fast) var(--ease-out);
}
.btn-mono:hover { color: var(--ink); }
.btn-mono::after { content: '→'; transition: transform var(--t-fast) var(--ease-out); }
.btn-mono:hover::after { transform: translateX(3px); }

/* Permission line */
.permission-line {
  margin-top: 32px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-mute);
  display: flex; gap: 12px; flex-wrap: wrap;
  border-top: 1px dashed var(--line-strong);
  padding-top: 14px;
}
.permission-line strong { color: var(--ink); font-weight: 500; }
.permission-line .ok { color: var(--green); font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
.permission-line .ok::before { content: '✓'; }

/* Hero trace SVG */
.hero-trace {
  position: absolute;
  bottom: 24px; left: 36px;
  width: 320px; height: 64px;
  z-index: 1;
  pointer-events: none;
  opacity: .45;
}
.hero-trace path {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.2;
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
  animation: traceIn 2.6s 0.5s var(--ease-out) forwards;
}
@keyframes traceIn { to { stroke-dashoffset: 0; } }
.hero-trace circle {
  fill: var(--accent); opacity: 0;
  animation: dotIn .3s 2.6s forwards;
}
@keyframes dotIn { to { opacity: 1; } }

/* Terminal */
.term {
  background: #0A0A0C;
  border: 1px solid #2a2a2f;
  border-radius: 12px;
  overflow: hidden;
  font-family: var(--font-mono);
  color: #e4e4e7;
  box-shadow:
    0 1px 0 rgba(255,255,255,.04) inset,
    0 24px 60px -24px rgba(10,10,12,.35),
    0 8px 16px -8px rgba(10,10,12,.18);
  position: relative;
  transition: transform var(--t-med) var(--ease-out), box-shadow var(--t-med) var(--ease-out);
}
.term:hover { transform: translateY(-3px); }
.term-bar { background: #14141a; padding: 10px 14px; border-bottom: 1px solid #2a2a2f; display: flex; align-items: center; gap: 12px; font-size: 11px; color: #8a8d95; }
.term-bar-dots { display: flex; gap: 5px; }
.term-bar-dots span { width: 9px; height: 9px; border-radius: 50%; background: #3a3a40; }
.term-bar-title { flex: 1; text-align: center; font-weight: 500; color: #c7c7cc; }
.term-bar-title strong { color: #fff; font-weight: 500; }
.term-bar .live { display: inline-flex; align-items: center; gap: 5px; color: #22c55e; font-size: 10px; }
.term-bar .live::before {
  content: ''; width: 6px; height: 6px; background: #22c55e; border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(34,197,94,.4);
  animation: livepulse 2s var(--ease-out) infinite;
}
.term-body { padding: 16px 18px; font-size: 12.5px; line-height: 1.65; min-height: 320px; position: relative; }
.term-line { display: block; white-space: pre; overflow: hidden; opacity: 0; animation: typein .15s var(--ease-out) forwards; }
.term-line.dim { color: #8a8d95; }
.term-line .prompt { color: #ec4899; user-select: none; }
.term-line .cmd { color: #fafafa; }
.term-line .ok { color: #22c55e; }
.term-line .key { color: #c7c7cc; }
.term-line .val { color: #fafafa; font-weight: 500; }
.term-line .red { color: #f87171; }
.term-line .blue { color: #60a5fa; }
.term-line .yellow { color: #fbbf24; }
.term-line .green { color: #4ade80; }
@keyframes typein { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
.cursor { display: inline-block; width: 7px; height: 14px; background: #fafafa; vertical-align: -2px; margin-left: 2px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Trust strip */
.trust { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 22px 0; background: var(--bg-soft); position: relative; z-index: 2; }
.trust-row { display: flex; align-items: center; gap: 32px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-mute); letter-spacing: .04em; text-transform: uppercase; flex-wrap: wrap; }
.trust-label { font-weight: 600; color: var(--ink); }
.trust-row .src { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); font-weight: 500; }
.trust-row .src::before { content: ''; width: 5px; height: 5px; background: var(--accent); border-radius: 50%; }
.trust-row .sep { color: var(--line-strong); }
.trust-row .badge { background: var(--green-soft); color: var(--green); border: 1px solid rgba(21,128,61,.18); padding: 3px 10px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
.trust-row .badge::before { content: '✓'; }

/* Personas */
.personas { padding: 100px 0 80px; position: relative; z-index: 2; }
.section-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 14px; display: flex; gap: 12px; align-items: center; }
.section-eyebrow strong { color: var(--ink); font-weight: 500; }
.section-eyebrow .sep { color: var(--line-strong); }
.section-h2 { font-weight: 700; font-size: clamp(30px, 3.4vw, 42px); line-height: 1.06; letter-spacing: -.025em; margin-bottom: 16px; max-width: 24ch; }
.section-intro { font-size: 17px; color: var(--ink-soft); max-width: 60ch; margin-bottom: 48px; line-height: 1.55; }
.persona-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
@media (max-width: 1000px) { .persona-grid { grid-template-columns: 1fr; } }
.persona { background: var(--bg-card); border: 1px solid var(--line); border-radius: 12px; padding: 28px 28px 24px; display: flex; flex-direction: column; transition: transform var(--t-med) var(--ease-out), border-color var(--t-med) var(--ease-out), box-shadow var(--t-med) var(--ease-out); position: relative; overflow: hidden; text-decoration: none; color: inherit; }
.persona:hover { transform: translateY(-4px); border-color: var(--line-strong); box-shadow: 0 18px 40px -20px rgba(10,10,12,.18); }
.persona-tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 16px; display: flex; gap: 10px; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.persona-tag .letter { width: 22px; height: 22px; background: var(--ink); color: var(--bg); border-radius: 4px; display: grid; place-items: center; font-family: var(--font-sans); font-weight: 700; font-size: 11px; letter-spacing: 0; }
.persona h3 { font-size: 19px; font-weight: 600; letter-spacing: -.018em; margin-bottom: 8px; line-height: 1.2; }
.persona p { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 18px; flex: 1; }
.persona-proof { font-family: var(--font-mono); font-size: 11px; color: var(--ink); background: var(--bg-soft); border: 1px solid var(--line); padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.persona-proof .pp-prompt { color: var(--ink-mute); }
.persona-proof.green { background: var(--green-soft); border-color: rgba(21,128,61,.18); color: var(--green); }
.persona-proof.green .pp-icon { color: var(--green); font-weight: 600; }
.persona-proof.teal { background: rgba(15,118,110,.06); border-color: rgba(15,118,110,.18); color: var(--teal); font-weight: 500; }
.persona-link { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink); font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
.persona-link::after { content: '→'; transition: transform var(--t-fast) var(--ease-out); }
.persona:hover .persona-link::after { transform: translateX(4px); }

/* Datasets */
.datasets { padding: 80px 0 100px; background: var(--bg-soft); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); position: relative; z-index: 2; }
.dataset-grid { display: grid; grid-template-columns: repeat(3, 1fr) 1.2fr; gap: 16px; }
@media (max-width: 1100px) { .dataset-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 720px) { .dataset-grid { grid-template-columns: 1fr; } }
.fiche { background: var(--bg-card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; transition: transform var(--t-med) var(--ease-out), border-color var(--t-med) var(--ease-out), box-shadow var(--t-med) var(--ease-out); text-decoration: none; color: inherit; }
.fiche:hover { transform: translateY(-3px); border-color: var(--line-strong); box-shadow: 0 16px 36px -18px rgba(10,10,12,.18); }
.fiche-ribbon { background: var(--bg-soft); padding: 9px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-mute); }
.fiche-ribbon strong { color: var(--ink); font-weight: 500; }
.fiche-ribbon .pill { margin-left: auto; background: var(--bg-card); border: 1px solid var(--line); padding: 2px 7px; border-radius: 3px; color: var(--ink); font-weight: 500; }
.fiche-body { padding: 22px; flex: 1; display: flex; flex-direction: column; }
.fiche-h3 { font-weight: 600; font-size: 18px; letter-spacing: -.015em; margin-bottom: 4px; }
.fiche-sub { font-family: var(--font-mono); font-size: 11px; color: var(--ink-mute); letter-spacing: .02em; margin-bottom: 16px; }
.fiche-desc { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 16px; flex: 1; }
.fiche-formats { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 18px; }
.fmt-chip { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .04em; background: var(--bg-soft); border: 1px solid var(--line); color: var(--ink-soft); padding: 2px 7px; border-radius: 3px; font-weight: 500; }
.fmt-chip.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.fiche-buy { border-top: 1px solid var(--line); margin: 0 -22px; padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; background: var(--bg); }
.fiche-price { display: flex; align-items: baseline; gap: 5px; }
.fiche-price .amt { font-weight: 700; font-size: 22px; letter-spacing: -.015em; font-variant-numeric: tabular-nums; }
.fiche-price .unit { font-family: var(--font-mono); font-size: 10px; color: var(--ink-mute); }
.fiche-cta { font-family: var(--font-mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
.fiche-cta::after { content: '→'; transition: transform var(--t-fast) var(--ease-out); }
.fiche:hover .fiche-cta::after { transform: translateX(3px); }

/* Bundle card */
.fiche.bundle { background: var(--ink); color: var(--bg); border-color: var(--ink); position: relative; }
.fiche.bundle::before { content: ''; position: absolute; inset: 0; background: radial-gradient(600px circle at 100% 0%, rgba(220,31,45,.18), transparent 50%); pointer-events: none; opacity: .8; }
.fiche.bundle .fiche-ribbon { background: rgba(255,255,255,.05); border-bottom-color: rgba(255,255,255,.08); color: rgba(255,255,255,.6); }
.fiche.bundle .fiche-ribbon strong { color: #fff; }
.fiche.bundle .fiche-ribbon .pill { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; }
.fiche.bundle .fiche-h3 { color: #fff; position: relative; }
.fiche.bundle .fiche-sub { color: rgba(255,255,255,.5); }
.fiche.bundle .fiche-desc { color: rgba(255,255,255,.7); position: relative; }
.fiche.bundle .fmt-chip { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.08); color: rgba(255,255,255,.85); }
.fiche.bundle .fmt-chip.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.fiche.bundle .fiche-buy { background: rgba(0,0,0,.35); border-top-color: rgba(255,255,255,.08); position: relative; }
.fiche.bundle .fiche-price .amt { color: #fff; }
.fiche.bundle .fiche-price .unit { color: rgba(255,255,255,.5); }
.fiche.bundle .fiche-cta { color: #fff; }
.fiche.bundle .fiche-roi { font-family: var(--font-mono); font-size: 11px; color: #fff; background: rgba(220,31,45,.18); border: 1px solid rgba(220,31,45,.28); padding: 7px 10px; border-radius: 5px; margin-bottom: 16px; position: relative; display: flex; align-items: center; gap: 8px; }
.fiche.bundle .fiche-roi strong { color: #fff; font-weight: 600; }
.fiche.bundle .fiche-roi .icon { color: var(--accent); }
.fiche.bundle .fiche-strike { font-family: var(--font-mono); font-size: 10px; color: rgba(255,255,255,.4); text-decoration: line-through; letter-spacing: .04em; }

/* How it works */
.how { padding: 100px 0; position: relative; z-index: 2; }
.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; position: relative; margin-top: 48px; }
@media (max-width: 880px) { .steps { grid-template-columns: 1fr; } }
.step { position: relative; padding: 0 24px 0 0; }
.step + .step::before { content: ''; position: absolute; top: 16px; left: -24px; right: 50%; height: 1px; border-top: 1px dashed var(--line-strong); }
@media (max-width: 880px) {
  .step + .step::before { top: -24px; left: 16px; right: auto; bottom: 50%; width: 1px; height: auto; border-top: none; border-left: 1px dashed var(--line-strong); }
  .step { padding: 24px 0 0 0; }
}
.step-num { width: 36px; height: 36px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--line-strong); color: var(--ink); font-family: var(--font-sans); font-weight: 600; font-size: 13px; display: grid; place-items: center; margin-bottom: 18px; box-shadow: 0 0 0 6px var(--bg); position: relative; z-index: 1; transition: all var(--t-med) var(--ease-out); font-variant-numeric: tabular-nums; }
.step:hover .step-num { background: var(--ink); color: var(--bg); transform: scale(1.06); }
.step-tag { display: inline-block; font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
.step-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; letter-spacing: -.012em; }
.step-text { font-size: 13.5px; color: var(--ink-soft); line-height: 1.55; }

/* Quote section */
.quote-section { padding: 100px 0; background: var(--ink); color: #fff; border-top: 1px solid var(--line); position: relative; z-index: 2; overflow: hidden; }
.quote-section::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(to right, transparent, rgba(220,31,45,.6), transparent); }
.quote-section .container { position: relative; z-index: 2; }
.quote-eyebrow { font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,.5); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 28px; display: flex; gap: 10px; align-items: center; }
.quote-eyebrow .src { color: #fff; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.quote-eyebrow .src::before { content: ''; width: 5px; height: 5px; background: var(--accent); border-radius: 50%; }
.quote-text { font-size: clamp(22px, 2.6vw, 32px); font-weight: 400; line-height: 1.4; letter-spacing: -.012em; max-width: 32ch; margin-bottom: 28px; color: #fff; }
.quote-text::before { content: '"'; font-family: var(--font-sans); font-weight: 700; font-size: 1.4em; color: var(--accent); line-height: 0; vertical-align: -0.18em; margin-right: 6px; }
.quote-author { font-family: var(--font-mono); font-size: 12px; color: rgba(255,255,255,.6); letter-spacing: .04em; display: flex; gap: 8px; flex-wrap: wrap; }
.quote-author strong { color: #fff; font-weight: 500; }
.quote-cta { margin-top: 36px; display: flex; gap: 16px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.quote-cta a { color: rgba(255,255,255,.7); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: color var(--t-fast) var(--ease-out); }
.quote-cta a::after { content: '→'; transition: transform var(--t-fast) var(--ease-out); }
.quote-cta a:hover { color: #fff; }
.quote-cta a:hover::after { transform: translateX(3px); }

/* CTA final */
.cta-final { padding: 100px 0 120px; text-align: center; position: relative; z-index: 2; border-top: 1px solid var(--line); }
.cta-final h2 { font-weight: 700; font-size: clamp(32px, 3.8vw, 48px); letter-spacing: -.03em; line-height: 1.05; margin-bottom: 20px; max-width: 22ch; margin-left: auto; margin-right: auto; }
.cta-final p { font-size: 17px; color: var(--ink-soft); margin-bottom: 36px; max-width: 50ch; margin-left: auto; margin-right: auto; line-height: 1.55; }
.cta-final-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

/* Install bar */
.install-bar { display: inline-flex; align-items: stretch; background: var(--ink); border-radius: 8px; overflow: hidden; font-family: var(--font-mono); font-size: 13px; border: 1px solid var(--ink); cursor: pointer; transition: transform var(--t-fast) var(--ease-out), box-shadow var(--t-med) var(--ease-out); height: 46px; }
.install-bar:hover { transform: translateY(-1px); box-shadow: 0 12px 24px -8px rgba(10,10,12,.25); }
.install-bar-prompt { color: rgba(255,255,255,.4); padding: 0 6px 0 14px; font-weight: 500; display: flex; align-items: center; }
.install-bar-cmd { color: #fafafa; padding: 0 12px 0 0; font-weight: 500; display: flex; align-items: center; }
.install-bar-copy { background: rgba(255,255,255,.08); color: rgba(255,255,255,.7); padding: 0 14px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; border-left: 1px solid rgba(255,255,255,.1); display: flex; align-items: center; gap: 6px; transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out); }
.install-bar-copy:hover { background: rgba(255,255,255,.14); color: #fff; }
.install-bar-copy.copied { background: var(--green); color: #fff; border-left-color: var(--green); }

/* Footer V4 */
.foot-v4 { padding: 40px 0 56px; border-top: 1px solid var(--line); background: var(--bg); position: relative; z-index: 2; font-family: var(--font-mono); font-size: 11px; color: var(--ink-mute); letter-spacing: .02em; }
.foot-v4 .foot-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
.foot-v4 strong { color: var(--ink); font-weight: 500; }
.foot-v4 .foot-nav { display: flex; gap: 18px; flex-wrap: wrap; }
.foot-v4 .foot-nav a { color: inherit; text-decoration: none; transition: color var(--t-fast) var(--ease-out); }
.foot-v4 .foot-nav a:hover { color: var(--ink); }
```

- [ ] **Step 2: Vérifier en dev qu'il n'y a pas d'erreur CSS**

Recharger http://localhost:4321/. La page (encore l'ancien index.astro) doit toujours rendre. Vérifier la console pour erreurs. La nouvelle CSS V4 ne devrait pas affecter les anciennes pages.

- [ ] **Step 3: Commit Phase 2**

```bash
git add web/src/components/StatusBar.astro web/src/components/DataRibbon.astro web/src/components/Terminal.astro web/src/components/InstallBar.astro web/src/components/PersonaTile.astro web/src/components/Fiche.astro web/src/components/TrustStrip.astro web/src/components/Step.astro web/src/components/Quote.astro web/src/components/HeroTrace.astro web/src/styles/global.css
git commit -m "$(cat <<'EOF'
feat(design): #15 Phase 2/4 V4 — 10 composants Astro + classes CSS

10 nouveaux composants : StatusBar, DataRibbon, Terminal, InstallBar,
PersonaTile, Fiche, TrustStrip, Step, Quote, HeroTrace.
Classes V4 ajoutées en bas de global.css (cohabitent avec legacy).
Encore aucun changement aux pages — l'ancien index.astro reste actif.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Refonte index.astro + remplacer Header par StatusBar (≈20 min)

### Task 3.1: Remplacer Header par StatusBar dans BaseLayout

**Files:**
- Modify: `web/src/layouts/BaseLayout.astro:3,45`

- [ ] **Step 1: Mettre à jour les imports et le markup BaseLayout**

Dans `web/src/layouts/BaseLayout.astro` :

Ligne 3 : remplacer
```astro
import Header from "../components/Header.astro";
```
par
```astro
import StatusBar from "../components/StatusBar.astro";
```

Ligne 45 : remplacer
```astro
    <Header />
```
par
```astro
    <StatusBar />
```

- [ ] **Step 2: Vérifier en dev sur plusieurs pages**

- http://localhost:4321/ → StatusBar V4 affichée
- http://localhost:4321/datasets/tares → StatusBar V4 affichée (ancienne page mais nouveau header)
- http://localhost:4321/legal/cgv → StatusBar V4 affichée

Toutes les pages doivent afficher le nouveau StatusBar sans casser le contenu.

---

### Task 3.2: Refondre `index.astro` complètement

**Files:**
- Replace: `web/src/pages/index.astro`

- [ ] **Step 1: Remplacer intégralement le contenu de `web/src/pages/index.astro`**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import HeroTrace from "../components/HeroTrace.astro";
import Terminal from "../components/Terminal.astro";
import InstallBar from "../components/InstallBar.astro";
import TrustStrip from "../components/TrustStrip.astro";
import PersonaTile from "../components/PersonaTile.astro";
import Fiche from "../components/Fiche.astro";
import Step from "../components/Step.astro";
import Quote from "../components/Quote.astro";
---
<BaseLayout
  title="openswissdata — Données fédérales suisses, normalisées"
  description="Datasets officiels suisses normalisés (TARES, NOGA/NACE/ISIC, FINMA Registry) en JSON, Parquet et SQL. Permission BAZG accordée. Versionnés, signés, prêts à brancher."
>

<div class="bg-grid"></div>

<!-- ============ HERO ============ -->
<section class="hero">
  <div class="container">
    <div class="hero-grid">
      <div>
        <div class="eyebrow reveal">
          <span>Données officielles suisses</span>
          <span style="opacity:.4">·</span>
          <span class="check">Permission BAZG</span>
        </div>

        <h1 class="h1 reveal" data-delay="1">
          Données fédérales suisses,<br>
          <span class="accent">normalisées.</span>
        </h1>

        <p class="lede reveal" data-delay="2">
          TARES, NOGA·NACE·ISIC, FINMA Registry — extraits des sources autoritaires fédérales, livrés <strong>normalisés, versionnés et signés</strong>. Pour vos pipelines, vos audits, et vos intégrations ERP.
        </p>

        <div class="spec-row reveal" data-delay="3">
          <div class="spec">
            <div class="spec-label">Datasets</div>
            <div class="spec-value">3 + bundle</div>
          </div>
          <div class="spec">
            <div class="spec-label">Codes</div>
            <div class="spec-value" data-count="12800">~12 800</div>
          </div>
          <div class="spec">
            <div class="spec-label">Formats</div>
            <div class="spec-value">Parquet · JSON · SQL</div>
          </div>
        </div>

        <div class="cta-row reveal" data-delay="4">
          <a href="#datasets" class="btn btn-primary">Voir les datasets <span class="arrow">→</span></a>
          <InstallBar command="npx @osd/cli pull tares" />
        </div>

        <div class="permission-line reveal" data-delay="5">
          <span><strong>Sources :</strong> BAZG · OFS · FINMA</span>
          <span style="opacity:.4">·</span>
          <span class="ok">Permission accordée 2026-04-21</span>
          <span style="opacity:.4">·</span>
          <span><strong>For :</strong> Berne</span>
        </div>
      </div>

      <div class="reveal" data-delay="2">
        <Terminal title="~/erp-integration — zsh" />
      </div>
    </div>

    <HeroTrace />
  </div>
</section>

<TrustStrip
  sources={["BAZG", "OFS", "FINMA"]}
  badges={["Permission BAZG · 2026-04-21", "DKIM-signed", "SHA-256 manifest"]}
/>

<!-- ============ PERSONAS ============ -->
<section class="personas">
  <div class="container">
    <div class="section-eyebrow reveal">
      <strong>Trois manières d'utiliser openswissdata</strong>
      <span class="sep">/</span>
      <span>1 stack, 3 angles</span>
    </div>
    <h2 class="section-h2 reveal" data-delay="1">Une donnée. Trois équipes qui en sortent gagnantes.</h2>
    <p class="section-intro reveal" data-delay="2">
      Que vous branchiez l'API dans votre ERP, défendiez un audit ou écriviez du code — la même fondation s'aligne avec votre besoin.
    </p>

    <div class="persona-grid">
      <PersonaTile
        letter="A"
        tag="Pour les data engineers"
        title="Une vraie donnée. Une vraie API."
        description="Parquet propre, SDK TypeScript et Python, signature SHA-256 et changelog versionné. Branchez en une ligne, oubliez le scrape XLSX."
        proof={{ text: "npm i @osd/sdk", prompt: "$" }}
        link="SDK & docs"
        href="#"
      />
      <PersonaTile
        letter="B"
        tag="Pour la conformité"
        title="Quand l'audit frappe, vous avez les pièces."
        description="Permission commerciale écrite du BAZG. For juridique Berne. Manifest SHA-256, versionnage sémantique, audit log public — tout est traçable."
        proof={{ text: "BAZG · permission 2026-04-21", variant: "green" }}
        link="Voir les preuves"
        href="/legal/cgv"
      />
      <PersonaTile
        letter="C"
        tag="Pour les intégrateurs ERP"
        title="~5 jours-homme économisés par release."
        description="Compatible SAP, Odoo, Sage, Dynamics et ERPNext. Mises à jour mensuelles automatiques. Le bundle 3-en-1 paie sa première année dès la première release."
        proof={{ text: "~5 j-h × release · = ~6 000 CHF", variant: "teal" }}
        link="Calculer le ROI"
        href="/bundle"
      />
    </div>
  </div>
</section>

<!-- ============ DATASETS ============ -->
<section class="datasets" id="datasets">
  <div class="container">
    <div class="section-eyebrow reveal">
      <strong>Datasets disponibles</strong>
      <span class="sep">/</span>
      <span>ED. 2026.04</span>
      <span class="sep">/</span>
      <span>3 + 1 bundle</span>
    </div>
    <h2 class="section-h2 reveal" data-delay="1">Tout ce qu'un ERP suisse devrait déjà avoir.</h2>
    <p class="section-intro reveal" data-delay="2">
      Trois datasets fédéraux indépendants, ou le bundle complet à prix réduit. Tous livrés en Parquet, JSON et SQL, signés et versionnés.
    </p>

    <div class="dataset-grid">
      <Fiche
        ribbonLabel="TARES"
        ribbonSource="BAZG"
        pillText="v1.0.0"
        title="Tarif douanier"
        sub="~7 500 codes · DE/FR/IT"
        desc="Le tarif douanier suisse, descriptions trilingues, taux de droits, hiérarchie HS. Cross-walks HS6 et CN8."
        formats={["PARQUET", "JSON", "SQL"]}
        price="299"
        href="/datasets/tares"
      />
      <Fiche
        ribbonLabel="CLASSIFICATIONS"
        ribbonSource="OFS"
        pillText="v1.0.0"
        title="NOGA · NACE · ISIC"
        sub="~3 800 codes · 4 langues"
        desc="Les classifications économiques suisses et internationales avec cross-walks complets entre standards."
        formats={["PARQUET", "JSON", "SQL"]}
        price="399"
        href="/datasets/classifications"
      />
      <Fiche
        ribbonLabel="FINMA"
        ribbonSource="FINMA"
        pillText="v1.0.0"
        title="Registre FINMA"
        sub="~1 500 entités · CH"
        desc="Les entités sous surveillance FINMA, unifiées : banques, assureurs, gestionnaires, IDE inclus."
        formats={["PARQUET", "JSON", "SQL"]}
        price="299"
        href="/datasets/finma"
      />
      <Fiche
        ribbonLabel="BUNDLE 3-EN-1"
        ribbonSource="Tous les datasets"
        pillText="−37 %"
        title="Bundle complet"
        sub="TARES + Classifications + FINMA"
        desc="Une licence, une facture, mises à jour mensuelles incluses. ~15 jours-homme économisés par an."
        formats={["PARQUET", "JSON", "SQL", "SDK"]}
        price="799"
        href="/bundle"
        ctaLabel="Acheter"
        theme="bundle"
        roiText="<strong>~15 j-h économisés / an</strong> · ~18 000 CHF en interne"
        strikePrice="997"
      />
    </div>
  </div>
</section>

<!-- ============ HOW IT WORKS ============ -->
<section class="how" id="how">
  <div class="container">
    <div class="section-eyebrow reveal">
      <strong>Comment ça marche</strong>
      <span class="sep">/</span>
      <span>15 minutes du paiement à la prod</span>
    </div>
    <h2 class="section-h2 reveal" data-delay="1">Quatre étapes. Pas de support à appeler.</h2>

    <div class="steps">
      <Step num="01" tag="Achat" title="Stripe Checkout" text="Achat en CHF, facturé à votre raison sociale. SAP/Odoo OK pour expense." delay={1} />
      <Step num="02" tag="Accès" title="Magic-link" text="Lien d'accès par email. Pas de mot de passe, pas de compte à créer." delay={2} />
      <Step num="03" tag="Téléchargement" title="Signed URL" text="ZIP signé en SHA-256, livré depuis Cloudflare R2 (Frankfurt)." delay={3} />
      <Step num="04" tag="Intégration" title="SDK ou raw" text="Importez le Parquet, ou utilisez le SDK TypeScript / Python." delay={4} />
    </div>
  </div>
</section>

<!-- ============ QUOTE BAZG ============ -->
<Quote
  source="BAZG"
  date="2026-04-21"
  text="Permission accordée pour la diffusion commerciale des données TARES sous votre offre, sous réserve des conditions usuelles d'attribution et d'exclusion."
  author="Michael Beer"
  role="Chef Tarifgrundlagen, BAZG"
  affiliation="Bundesamt für Zoll und Grenzsicherheit"
  ctas={[
    { label: "Voir les conditions BAZG complètes", href: "/legal/cgv#bazg" },
    { label: "Voir l'audit log", href: "#" }
  ]}
/>

<!-- ============ CTA FINAL ============ -->
<section class="cta-final">
  <div class="container">
    <h2 class="reveal">Prêt à brancher la donnée suisse ?</h2>
    <p class="reveal" data-delay="1">
      299 CHF par dataset, 799 CHF le bundle. Mises à jour mensuelles incluses. Pas d'engagement, refund 14 jours.
    </p>
    <div class="cta-final-row reveal" data-delay="2">
      <a href="#datasets" class="btn btn-primary">Voir les datasets <span class="arrow">→</span></a>
      <a href="#" class="btn btn-secondary">Documentation</a>
      <a href="mailto:contact@openswissdata.com" class="btn-mono">Contact commercial</a>
    </div>
  </div>
</section>

<script is:inline>
  // ===== Count-up =====
  function osdCountUp(el) {
    const target = +el.dataset.count;
    const dur = 1400; const start = performance.now();
    const fmt = new Intl.NumberFormat('fr-CH');
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = '~' + fmt.format(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if ('IntersectionObserver' in window) {
    const countObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          osdCountUp(e.target);
          countObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-count]').forEach(el => countObs.observe(el));
  }

  // ===== Terminal typewriter =====
  const termLines = [
    { text: '$ npx @osd/cli pull tares@latest', cls: 'cmd', prompt: true, delay: 600 },
    { text: '✓ Verified DKIM signature openswissdata.com', cls: 'ok', delay: 400 },
    { text: '✓ Pulled tares.parquet (1.4 MB · 7 524 rows · v1.0.0)', cls: 'ok', delay: 350 },
    { text: '✓ Cross-walks: HS6, CN8', cls: 'ok', delay: 300 },
    { text: '✓ Manifest SHA-256: a3f9e2…b81c', cls: 'ok', delay: 350 },
    { text: '', cls: '', delay: 250 },
    { text: '$ npx @osd/cli query tares "0901.10"', cls: 'cmd', prompt: true, delay: 700 },
    { text: 'hs_code      "0901.10.10"', cls: 'json-red', delay: 250 },
    { text: 'description  {', cls: 'dim', delay: 200 },
    { text: '  de  "Kaffee, nicht geröstet"', cls: 'json-str', delay: 250 },
    { text: '  fr  "Café non torréfié"', cls: 'json-str', delay: 250 },
    { text: '  it  "Caffè non torrefatto"', cls: 'json-str', delay: 250 },
    { text: '}', cls: 'dim', delay: 200 },
    { text: 'duty_chf     0.00', cls: 'json-yellow', delay: 250 },
    { text: 'source       "BAZG · 2026-04"', cls: 'json-blue', delay: 300 },
  ];
  const termBody = document.getElementById('termBody');
  function osdRenderTermLine(line) {
    const span = document.createElement('span');
    span.className = 'term-line';
    if (line.text === '') {
      span.innerHTML = '&nbsp;';
    } else if (line.prompt) {
      span.innerHTML = '<span class="prompt">$ </span><span class="cmd">' + line.text.replace(/^\$\s*/, '') + '</span>';
    } else if (line.cls === 'ok') {
      span.innerHTML = line.text.replace(/^✓/, '<span class="ok">✓</span>')
        .replace(/(tares\.parquet|HS6, CN8|openswissdata\.com|a3f9e2…b81c)/, '<span class="val">$1</span>');
    } else if (line.cls === 'json-red') {
      const m = line.text.match(/^(\S+)\s+(.*)$/);
      if (m) span.innerHTML = '<span class="key">' + m[1] + '</span>      <span class="red">' + m[2] + '</span>';
    } else if (line.cls === 'json-str') {
      const m = line.text.match(/^(\s*)(\S+)\s+(.*)$/);
      if (m) span.innerHTML = m[1] + '<span class="key">' + m[2] + '</span>  <span class="green">' + m[3] + '</span>';
    } else if (line.cls === 'json-yellow') {
      const m = line.text.match(/^(\S+)\s+(.*)$/);
      if (m) span.innerHTML = '<span class="key">' + m[1] + '</span>     <span class="yellow">' + m[2] + '</span>';
    } else if (line.cls === 'json-blue') {
      const m = line.text.match(/^(\S+)\s+(.*)$/);
      if (m) span.innerHTML = '<span class="key">' + m[1] + '</span>       <span class="blue">' + m[2] + '</span>';
    } else if (line.cls === 'dim') {
      span.innerHTML = '<span class="dim">' + line.text + '</span>';
    } else {
      span.textContent = line.text;
    }
    termBody.appendChild(span);
  }
  async function osdRunTerminal() {
    if (!termBody) return;
    for (const line of termLines) {
      osdRenderTermLine(line);
      termBody.scrollTop = termBody.scrollHeight;
      await new Promise(r => setTimeout(r, line.delay));
    }
    const cur = document.createElement('span');
    cur.className = 'term-line';
    cur.innerHTML = '<span class="prompt">$ </span><span class="cursor"></span>';
    termBody.appendChild(cur);
  }
  if (termBody && 'IntersectionObserver' in window) {
    const termObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          setTimeout(osdRunTerminal, 400);
          termObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });
    termObs.observe(termBody);
  }

  // ===== Install bar copy =====
  document.querySelectorAll('.install-bar').forEach(bar => {
    bar.addEventListener('click', async () => {
      const cmd = bar.dataset.cmd;
      const copyEl = bar.querySelector('.install-bar-copy');
      try {
        await navigator.clipboard.writeText(cmd);
        copyEl.textContent = '✓ copied';
        copyEl.classList.add('copied');
        setTimeout(() => {
          copyEl.textContent = 'copy';
          copyEl.classList.remove('copied');
        }, 1600);
      } catch {}
    });
  });
</script>

</BaseLayout>
```

- [ ] **Step 2: Vérifier en dev**

Ouvrir http://localhost:4321/ et vérifier visuellement :

- [ ] StatusBar sticky en haut, blur, status dot pulse vert
- [ ] Hero : eyebrow → H1 (avec souligné rouge sur "normalisées." après ~600ms) → lede → spec row → CTA + install bar → permission line, en cascade smooth
- [ ] Compteur "~12 800" qui s'incrémente au load
- [ ] Terminal à droite : se met à taper TOUT SEUL, ligne par ligne, avec cursor blink final
- [ ] SVG trace rouge qui se dessine en bas du hero
- [ ] Trust strip : Sources + 3 badges verts
- [ ] 3 personas : hover qui translateY(-4px) + shadow doux
- [ ] 3 fiches datasets + 1 bundle noir avec gradient rouge
- [ ] 4 étapes "comment ça marche" avec lignes pointillées
- [ ] Quote section noire avec accent rouge
- [ ] CTA final centré
- [ ] Install bar copy → flash green "✓ copied" pendant 1.6s

Si quelque chose ne fonctionne pas : ouvrir DevTools console et chercher l'erreur. Vérifier que `termBody` existe (`document.getElementById('termBody')` doit retourner l'élément).

- [ ] **Step 3: Vérifier que les autres pages marchent toujours**

- http://localhost:4321/datasets/tares
- http://localhost:4321/datasets/classifications
- http://localhost:4321/datasets/finma
- http://localhost:4321/bundle
- http://localhost:4321/legal/cgv
- http://localhost:4321/account
- http://localhost:4321/blog

Aucune page ne doit être visuellement cassée. Le StatusBar V4 remplace l'ancien Header partout, c'est attendu.

- [ ] **Step 4: Commit Phase 3**

```bash
git add web/src/layouts/BaseLayout.astro web/src/pages/index.astro
git commit -m "$(cat <<'EOF'
feat(design): #15 Phase 3/4 V4 — refonte index.astro + StatusBar global

Remplace l'ancien Header par StatusBar V4 dans BaseLayout.
Refonte complète de la page d'accueil :
- Hero V4 avec terminal typewriter animé + count-up + install bar copy
- Trust strip (BAZG · OFS · FINMA + 3 badges)
- 3 mini-personas (data eng / compliance / ERP)
- 3 fiches datasets + 1 bundle premium noir
- 4 étapes how-it-works
- Quote BAZG section noire pleine largeur
- CTA final centré

Pages dataset/legal/blog/account inchangées (cohabitation CSS).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Build & déploiement live (≈10 min)

### Task 4.1: Build Astro (validation compilation)

**Files:** N/A (validation build)

- [ ] **Step 1: Stop le dev server, lancer le build**

```bash
# Dans le terminal du dev server : Ctrl+C
cd /Users/claude-alainmartin/openswissdata
npm run build
```

Attendu : build qui réussit sans erreur ni warning. Astro doit générer toutes les pages (index, datasets/*, legal/*, blog/*, bundle, account).

Si erreur : lire le message, fixer dans les composants ou dans `index.astro`, recommencer.

---

### Task 4.2: Déploiement Railway

**Files:** N/A (déploiement)

- [ ] **Step 1: Push Railway**

⚠️ Important : ce projet n'a **pas** de git remote, Railway upload via CLI :

```bash
cd /Users/claude-alainmartin/openswissdata
railway up --detach
```

Attendu : upload du build, Railway redéploie le service `api` (qui sert l'Astro build).

- [ ] **Step 2: Vérifier en live**

Attendre ~30s puis ouvrir https://www.openswissdata.com/ dans un navigateur (incognito de préférence pour éviter le cache).

Vérifier :
- [ ] La nouvelle landing V4 est servie
- [ ] StatusBar avec mark rouge OK
- [ ] Terminal qui se joue à droite
- [ ] Compteur "~12 800" qui s'incrémente
- [ ] Hover personas/fiches smooth
- [ ] Install bar copy fonctionne
- [ ] Pages /datasets/tares, /legal/cgv toujours fonctionnelles

Vérifier le health endpoint :
```bash
curl -s https://www.openswissdata.com/api/health
```
Attendu : `{"status":"ok","version":"0.1.0"}`

---

## Acceptance criteria (à valider après Phase 4)

- [ ] Page d'accueil charge en < 2s (LCP ≤ 2.5s sur connexion fibre)
- [ ] Terminal joue automatiquement à l'arrivée en viewport
- [ ] Animations reveal stagger smooth, pas de jank visible
- [ ] Bouton "copy" copie bien `npx @osd/cli pull tares` et flash vert
- [ ] Compteur "~12 800" s'incrémente avec ease cubic
- [ ] Layout responsive : ≥ 1100px (terminal visible) / < 1100px (terminal masqué, persona-grid stack, dataset-grid 2 cols puis 1 col)
- [ ] Pages legacy (`/datasets/*`, `/legal/*`, `/blog/*`, `/account`, `/bundle`) rendent comme avant côté contenu, avec le nouveau StatusBar V4
- [ ] Build Astro passe sans warning
- [ ] Live sur https://www.openswissdata.com après `railway up --detach`

---

## Rollback plan (en cas de catastrophe)

Si la prod casse complètement après le déploiement :

```bash
# Revert au commit précédent et redéployer
git log --oneline | head -10            # repérer le hash avant les commits Phase 1-3
git revert <hash-phase-1>..HEAD          # ou git reset --hard <hash-pre-V4> si pas commité
railway up --detach
```

Le mockup `.design-preview/index.html` reste sur le disque pour reprendre le travail.

---

## Hors scope (à planifier en sessions suivantes)

- Refonte des pages `/datasets/tares`, `/datasets/classifications`, `/datasets/finma` au style V4 (fiche pleine + lookups)
- Refonte de `/bundle`, `/account`
- Refonte des pages légales `/legal/*`
- Refonte des pages `/blog/*`
- Suppression progressive des classes CSS legacy de global.css une fois toutes les pages migrées
- Mobile responsive fine-tuning sur la V4 (les breakpoints sont en place)
- Tests Playwright e2e visuels (si désiré plus tard)
