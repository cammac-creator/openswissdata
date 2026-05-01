# Audit performance — openswissdata.com

**Date :** 2026-05-01 (nuit)
**Auditeur :** Claude (agent perf)
**Méthodologie :** mesures cURL temps réel sur prod + analyse code/build + test local pré-déploiement.
**Note PSI :** API PageSpeed Insights a renvoyé HTTP 429 (quota dépassé). Scores Lighthouse estimés à partir des signaux mesurés.

---

## 1. Résumé exécutif

### Top 5 problèmes performance avant correction

1. **Aucune compression gzip/brotli** — toutes les pages HTML sont envoyées en clair (~30 KB pour `/`, 19 KB pour `/codes/noga/6210/`). Coût ×3 sur la bande passante mobile et le LCP des connexions lentes.
2. **Aucun `Cache-Control`** — Fastly tourne devant Railway mais reçoit `x-cache: MISS` sur toutes les requêtes faute de directive de cachabilité. Tout le trafic frappe l'origine eu-west.
3. **9 fichiers de fonts Google Fonts chargés** — Geist 6 poids (400→900) + Geist Mono 3 poids (400/500/600), alors que seuls 4 + 2 sont réellement utilisés. ~140 KB inutiles bloquent le rendering.
4. **Pas d'`ETag`/`Last-Modified`** — pas de revalidation conditionnelle ; le navigateur retélécharge tout à chaque visite.
5. **Page `/codes/index.html` à 392 KB** (1’047 codes NOGA inlinés dans un `<script>` JSON pour la recherche client). Hors-scope du quick win, à refactorer (Astro Islands ou route Hono dédiée).

### Scores Lighthouse estimés (avant correction)

| Métrique | Mobile estimé | Desktop estimé |
|----------|--------------|----------------|
| Performance | 65–75 | 85–92 |
| LCP | 2.4–3.0 s | 1.2–1.5 s |
| FCP | 1.8–2.2 s | 0.9–1.1 s |
| CLS | <0.05 (très bon, statique) | <0.05 |
| TBT | 50–100 ms | <30 ms |
| TTFB | 90–180 ms (origin) | 90–180 ms |

### Scores estimés après quick wins appliqués (gzip + cache + fonts)

| Métrique | Mobile | Desktop |
|----------|--------|---------|
| Performance | **85–92** | **95–99** |
| LCP | 1.4–1.8 s | 0.7–0.9 s |
| FCP | 1.0–1.3 s | 0.5–0.7 s |
| TTFB (cache hit Fastly) | 20–40 ms | 20–40 ms |

---

## 2. Mesures par page

Mesures cURL prod (3 runs, médiane). Réponses **avant** corrections (compression absente, cache MISS Fastly).

| Page | TTFB médian | Total | Taille HTML | x-cache |
|------|-------------|-------|-------------|---------|
| `/` | 158 ms | 192 ms | 30’888 B | MISS |
| `/datasets/tares` | 94 ms | 121 ms | 25’721 B | MISS |
| `/mcp` | 91 ms | 105 ms | 37’500 B | MISS |
| `/compliance` | 84 ms | 105 ms | 19’478 B | MISS |
| `/codes/noga/6210/` | 89 ms | 96 ms | 19’670 B | MISS |

### Observations par page

**`/` (landing)** : 30 KB de HTML — JSON-LD Schema.org, CSP via `<script>`, beaucoup de markup inline. Le poids vient du contenu rich (sections datasets, FAQ, métriques). Acceptable une fois gzippé (~9 KB).

**`/datasets/tares`** : 25 KB. CodePlayground et HSLookup composants Astro génèrent du JS inline supplémentaire. À auditer plus tard pour code-split.

**`/mcp`** : 37 KB — la page la plus lourde des 5 critiques. Probablement à cause d'exemples curl/JSON inlinés dans le markup. Acceptable gzip → ~10 KB.

**`/compliance`** : 19 KB. Page la plus légère. Bien.

**`/codes/noga/6210/`** : 19 KB. SSG Astro depuis `[code].astro` génère 1’047 pages de ce gabarit. Lecteur SEO programmatique parfait — la fingerprint cache + gzip vont tout changer.

### Requêtes par page (estimées via inspection HTML)

Pour la home `/` :
- 1 HTML
- 1 CSS (`/_astro/BaseLayout.*.css`, 80 KB → ~14 KB gzip)
- 1 favicon SVG (749 B)
- 1 CSS Google Fonts (~3 KB)
- **9 fichiers .woff2** Geist (~12-18 KB chacun) ≈ 130 KB **avant correction**, ≈ 90 KB après réduction des poids
- 1 script Plausible (`defer`, ~1 KB) — bon point existant
- **Total avant correction : ~245 KB / 14 requêtes**
- **Total après correction : ~125 KB / 12 requêtes** (≈ 50% économie)

---

## 3. Caching

### Avant correction (constaté en prod)

```
HTTP/2 200
content-type: text/html; charset=utf-8
[AUCUN Cache-Control]
[AUCUN ETag, Last-Modified]
strict-transport-security: ...
x-cache: MISS
```

Fastly tente de cacher (présent comme CDN devant Railway via `x-railway-cdn-edge: fastly/...`) mais sans `Cache-Control` il ne peut pas ; il proxie vers l'origine eu-west à chaque hit.

### Après correction (validé en local et déployé)

Middleware ajouté dans `src/index.ts` (entre `secureHeaders` et les routes) qui définit :

| Pattern | Cache-Control |
|---------|---------------|
| `/_astro/*` (CSS/JS hashés Astro) | `public, max-age=31536000, immutable` |
| `/samples/*` | `public, max-age=31536000, immutable` |
| `/favicon.svg`, `/favicon.ico`, `/og-default.png`, `/og-image.png` | `public, max-age=31536000, immutable` |
| `/api/*`, `/mcp*` | `no-store` |
| Tout le reste (HTML pages) | `public, max-age=300, s-maxage=600, stale-while-revalidate=86400` |

Le middleware ne définit la valeur que si la route handler n’a pas déjà set un `Cache-Control` (les handlers API qui veulent du cache custom ne sont pas écrasés).

### Recommandation Fastly / Railway CDN

Avec ces directives, Fastly cachera désormais les pages HTML 10 min côté CDN avec stale-while-revalidate 24h. TTFB perçu : **20-40 ms partout dans le monde au lieu de 90-180 ms**. Les assets `_astro/*` sont éternels grâce au fingerprint.

### ETag

Hono fournit `hono/etag`. Non ajouté dans cette passe — la combinaison `max-age=300 + SWR` couvre déjà la fraîcheur des HTML, et l'ajout d'ETag impose un hash sur chaque réponse côté origine (CPU mineur mais inutile vu que les pages sont statiques et fingerprintées par fichier dans `web/dist/`). À considérer plus tard si on veut optimiser les revalidations 304.

---

## 4. JS / CSS bundle

### Build Astro actuel (`web/dist/_astro/`)

```
80 KB  BaseLayout.*.css     (≈14 KB gzip)  ← le gros morceau
20 KB  famille@_@astro.css  (≈4 KB gzip)   ← page /famille seule
4 KB   index@_@astro.css    (≈1 KB gzip)   ← page / seule
```

**Aucun fichier JS hashé** — Astro est en SSG pur, tout le JS interactif (IntersectionObserver pour reveal, smooth scroll, nav scroll state, lookups) est inline dans chaque page. Pas de bundle séparé à charger, ce qui est une **bonne propriété** pour les pages courtes mais devient mauvais quand le markup grossit (cas `/codes/index.html` à 392 KB).

### Recommandations

- **CSS** : 80 KB pour le BaseLayout est élevé. Tailwind v4 génère une seule feuille avec toutes les utilities utilisées. Un audit de purge agressif (peu de pages utilisent toutes les classes) peut probablement la ramener à 50 KB. À la main d'Alain (refactor bundling).
- **JS** : aucun. Bonne situation pour un site statique.
- **Inline scripts** dans BaseLayout : ~2 KB d'IntersectionObserver, smooth scroll, scroll state. Acceptable, ne pas externaliser (ferait une nouvelle requête réseau).

---

## 5. Images

### Inventaire `/web/public/`

| Fichier | Taille | Statut |
|---------|--------|--------|
| `og-default.png` | 23 KB | OK (ouverture sociale, 1200×630) |
| `favicon.svg` | 749 B | OK |
| `favicon.ico` | 655 B | OK |
| `samples/*` | (à vérifier, dans `web/public/samples/`) | OK probable (extraits téléchargeables) |

**Aucune image dans le contenu des pages auditées** — design 100% texte/CSS. Pas de candidat pour `loading="lazy"`, pas de PNG/JPG à convertir en WebP. Bonne situation.

Si Alain ajoute plus tard des screenshots produit ou photos d'équipe, prévoir un `<picture>` avec WebP fallback PNG, et `loading="lazy"` pour tout ce qui est below-the-fold.

---

## 6. Quick wins — APPLIQUÉS dans ce commit

| # | Optimisation | Impact estimé | Fichier |
|---|--------------|---------------|---------|
| 1 | **Activer compression gzip Hono** sur tout (`compress()` middleware) | -70% bytes wire HTML/CSS/JSON | `src/index.ts` |
| 2 | **`Cache-Control: public, max-age=31536000, immutable`** sur `/_astro/*`, favicons, og | TTFB ~0 ms après 1ère visite | `src/index.ts` |
| 3 | **`Cache-Control: max-age=300, s-maxage=600, stale-while-revalidate=86400`** sur HTML | Fastly cache 10 min, SWR 24h, TTFB global ~30 ms | `src/index.ts` |
| 4 | **`Cache-Control: no-store`** sur `/api/*` et `/mcp*` | Sécurité (pas de cache de données users) | `src/index.ts` |
| 5 | **Réduction Geist** : 6 poids → 4 (400/500/600/700) | -2 fichiers .woff2 (~30 KB) | `web/src/layouts/BaseLayout.astro` |
| 6 | **Réduction Geist Mono** : 3 poids → 2 (400/500) | -1 fichier .woff2 (~15 KB) | `web/src/layouts/BaseLayout.astro` |

`font-display: swap` était déjà présent dans l'URL Google Fonts. ✓
`preconnect` vers `fonts.googleapis.com` et `fonts.gstatic.com` déjà présents. ✓
Plausible script avec `defer`. ✓

### Quick wins NON appliqués (recommandés pour une autre session)

| # | Optimisation | Raison non appliqué |
|---|--------------|---------------------|
| 7 | Ajouter `<link rel="preload" as="font">` pour Geist 400/500 | Risque de double-fetch si l'URL change après reduction. À faire en local après mesure des fichiers .woff2 individuels (devtools Chrome). |
| 8 | Audit purge Tailwind agressif sur BaseLayout.css | Configuration Tailwind v4 + Astro, à valider sans casser des classes dynamiques. |
| 9 | Ajouter middleware `etag()` Hono | Marginal après Cache-Control 304 SWR ; 5 lignes mais coût CPU origine. |
| 10 | Convertir og-default.png en WebP (8 KB au lieu de 23 KB) | Compatibilité réseaux sociaux à tester (Twitter/X, LinkedIn préfèrent PNG). |

---

## 7. Long-terme (refactors, hors quick win)

### A. Refactor `/codes/index.html` (392 KB)

La page index NOGA inline les 1’047 codes en JSON pour la recherche client. Trois options :

1. **Astro Island avec fetch JSON** : extraire l'index dans `/api/noga/index.json` (servi par Hono avec cache 1h) et le charger en JS côté client. Page passe de 392 KB → ~25 KB. JSON séparé en cache CDN longue durée.
2. **Recherche serveur via Hono** : POST `/api/noga/search?q=...` retourne top 50 résultats. Plus complexe mais permet recherche fuzzy + scoring.
3. **Pagination + filtres SSG** : générer 22 pages section par section. Moins user-friendly que la recherche full-text.

Recommandation : **option 1** (Astro Island JSON), 1-2h de dev.

### B. Hono SSR pour `/codes/noga/[code]/`

Actuellement 1’047 pages sont générées en SSG. À chaque ajout de code NOGA officiel, rebuild complet. Alternative : route Hono `app.get('/codes/noga/:code/', ...)` qui rend depuis `loadNoga2025()` avec cache `s-maxage=86400`. Build plus rapide, pages toujours à jour. Rebuild seulement quand `loadNoga2025()` change. À envisager si le besoin évolue (NACE 2.1 add-on, etc.).

### C. Service Worker / PWA

Pas urgent. Vu que TTFB après correction sera ~30 ms via Fastly, le gain d'un SW serait marginal pour un SaaS B2B.

### D. HTTP/3 + early hints

Railway/Fastly ne supportent pas encore early hints (103 Early Hints) sur le path Hono. À surveiller dans 6 mois.

---

## 8. Validation locale (pré-déploiement)

Test effectué sur `localhost:3457` après TS compile :

```
GET /                       Content-Encoding: gzip ✓
                            Cache-Control: public, max-age=300, s-maxage=600, swr=86400 ✓
                            Body: 30971 → 8932 bytes (71% économie)

GET /codes/noga/6210/       Content-Encoding: gzip ✓
                            Cache-Control: public, max-age=300, s-maxage=600, swr=86400 ✓
                            Body: 19753 → 5775 bytes (71% économie)

GET /_astro/BaseLayout.*.css  Cache-Control: public, max-age=31536000, immutable ✓

Headers de sécurité préservés :
  strict-transport-security: max-age=15552000; includeSubDomains ✓
  content-security-policy: default-src 'self'; ... ✓
  x-frame-options: DENY ✓
  permissions-policy: camera=(), microphone=(), geolocation=(), ... ✓
```

Tests Vitest : **297/297 passed**. Build Astro : **1066 pages, 2.89s**.

---

## 9. Validation post-déploiement (vérifié 2026-05-02 00:05 CEST)

Vérifications effectuées sur prod après les 2 commits push :

| Page | content-encoding | cache-control |
|------|------------------|---------------|
| `/` | gzip ✓ | `max-age=300, s-maxage=600, stale-while-revalidate=86400` ✓ |
| `/datasets/tares` | gzip ✓ | `max-age=300, s-maxage=600, stale-while-revalidate=86400` ✓ |
| `/mcp` (page docs) | gzip ✓ | `max-age=300, s-maxage=600, stale-while-revalidate=86400` ✓ |
| `/compliance` | gzip ✓ | `max-age=300, s-maxage=600, stale-while-revalidate=86400` ✓ |
| `/codes/noga/6210/` | gzip ✓ | `max-age=300, s-maxage=600, stale-while-revalidate=86400` ✓ |
| `/_astro/BaseLayout.*.css` | gzip ✓ | `max-age=31536000, immutable` ✓ |

Headers de sécurité préservés :
- `strict-transport-security: max-age=15552000; includeSubDomains` ✓
- `content-security-policy: default-src 'self'; ...` ✓ (CSP complète intacte)

Mesure réelle : page `/` passe de 30’971 bytes plain à **8’919 bytes** sur le wire après gzip = -71%.

À vérifier dans 24h :
- [ ] PSI Lighthouse Mobile sur les 5 pages (quota Google reset)
- [ ] `x-cache: HIT` Fastly après quelques hits successifs depuis le même PoP

### Nouvelles modifications appliquées (commit 2)

Le premier commit appliquait `no-store` à tout `/mcp*`, ce qui rendait la page de docs publique non-cacheable. Commit 2 (`perf: scope no-store cache to actual MCP API paths only`) restreint `no-store` aux endpoints API explicites : `/mcp/jsonrpc`, `/mcp/discovery`, `/mcp/health`, `/mcp/oauth/*`. La page `/mcp` HTML retrouve son cache normal. Vérifié sur prod ✓.

---

## 10. Synthèse

L'origine Hono+Railway eu-west est rapide (TTFB 90 ms médian, c'est bien). **Le bottleneck unique de la perception utilisateur** était l'absence de compression et de cache : chaque visiteur récupérait du HTML non gzippé depuis l'origine, et chaque visite re-téléchargeait tous les assets faute de cache.

Les 4 changements appliqués (compress + Cache-Control + réduction fonts) sont sans risque architectural et représentent ~50 lignes de code total. Gain estimé Lighthouse Mobile : **+15 à +25 points**. Pour le SEO programmatique (1’000+ pages NOGA), ces optimisations vont aussi améliorer le Crawl Budget Google et l'indexation.

**Reste hors-scope :** la page `/codes/` à 392 KB qui mérite un refactor d'Island Astro (1-2h dev), et l'audit Tailwind purge potentiel sur le CSS BaseLayout 80 KB (gain ~30 KB).
