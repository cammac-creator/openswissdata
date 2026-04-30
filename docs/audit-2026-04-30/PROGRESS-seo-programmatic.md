# SEO programmatique — pages NOGA 2025

**Date :** 2026-04-30
**Cible :** capter le trafic organique long-tail « code NOGA XX.XX → activité française » (compliance officers, fiduciaires, data engineers Suisse).

## Périmètre généré

Une page Astro statique par code NOGA aux niveaux **section + division + groupe + classe** :

- **22 sections** (A à V)
- **87 divisions** (XX)
- **287 groupes** (XX.X)
- **651 classes** (XX.XX)
- **Total : 1 047 pages NOGA**

Les sous-classes (798 codes en `XX.XX.XX`) sont volontairement exclues : leur trafic SEO marginal ne justifie pas la pollution sitemap (les compliance officers tapent rarement « code NOGA 62.10.00 »).

> **Divergence assumée par rapport au cahier des charges :** la fourchette « 200-400 codes principaux » mentionnée dans la spec sous-estimait la réalité — div+group+class donne effectivement 1 025 codes. Garder ces niveaux est nécessaire pour capter les requêtes long-tail comme « code NOGA 62.10 » (classe), exemple cité dans la spec elle-même. 1 047 URLs reste très en dessous de la limite Google de 50 000 URLs par sitemap.

## Architecture technique

- **Source données :** lecture directe au build time des CSV de `data/classifications/classifications-2026.04.29-test-work/` (pas via SQLite : la table `classifications` n'existe pas dans `data/openswissdata.sqlite`, seul le schéma commerce y vit).
- **Helper :** `web/src/lib/noga-helpers.ts` charge les CSV en mémoire une seule fois (cache via let module-level), parse RFC 4180 sans dépendance externe (`csv-parse` n'est pas installé dans `web/`).
- **Page dynamique :** `web/src/pages/codes/noga/[code].astro` avec `getStaticPaths()` qui génère 1 047 routes.
- **Page index :** `web/src/pages/codes/index.astro` — 22 sections dépliables (`<details>`), arbre complet, recherche client-side JS sur 1 047 codes.

## Sections de chaque page

1. Hero (H1 + niveau + code brut)
2. Description multilingue FR/DE/IT/EN (table)
3. Hiérarchie NOGA (breadcrumb section → division → groupe → classe, lien interne pour le SEO)
4. Sous-niveaux directs (limité à 30 par page pour éviter l'explosion HTML)
5. Cross-walks officiels NACE 2.1 / NACE 2.0 / ISIC Rev 4 / NOGA 2008 (issus de `crosswalks.csv`)
6. Codes voisins (8 codes proches, fratrie + cousins triés par proximité numérique)
7. Exemples d'activités (4 phrases générées par patterns de mots-clés)
8. « Comment ce code est utilisé » (OFS, AVS, AFC, RC, SUVA, SECO)
9. Source officielle (lien BFS)
10. CTA bundle Classifications
11. Footer disclaimer

## SEO

- `<title>` : `Code NOGA {dotted} — {label_fr_court} | openswissdata.com`
- `<meta description>` : description ciblée
- OG tags depuis `BaseLayout`
- Canonical URL
- **JSON-LD `DefinedTerm`** Schema.org (rich snippet) avec `inDefinedTermSet` pointant sur le standard NOGA 2025
- URL slug raw (`/codes/noga/6210/`) pour éviter la duplication ; affichage dotted (`62.10`) pour l'humain
- Sitemap auto-inclus par `@astrojs/sitemap` (filter actuel n'exclut que `/account` et `/famille`)
- robots.txt OK (déjà `Allow: /`)

## Métriques de build

- **1 066 pages** statiques générées au total (1 047 NOGA + 19 pages existantes)
- **Sitemap :** 176 KB, 1 064 URLs
- **Build time :** 2,6 secondes
- **Exemple URL :** `https://www.openswissdata.com/codes/noga/6210/` (Activités de programmation informatique)

## Recommandation Google Search Console

1. Soumettre `https://www.openswissdata.com/sitemap-index.xml` après déploiement.
2. Vérifier l'indexation progressive (Google indexera 50-200 pages/jour selon l'autorité du domaine).
3. Surveiller les requêtes « code NOGA » dans le rapport Performance (12 semaines de patience minimum pour voir l'effet).
4. Optimisation future : ajouter pages `/codes/nace/[code]` (~600 codes) et `/codes/isic/[code]` (~419 codes) si le trafic NOGA décolle.

## TODO suivants

- **hreflang DE/IT/EN** : ajouter `<link rel="alternate" hreflang="de|it|en">` dans `BaseLayout.astro` quand les versions DE/IT/EN seront disponibles. Aujourd'hui `lang="fr"` only. Voir audit landing page recommandation.
- **Sous-classes (level subclass, 798 codes)** : actuellement non générées (URL aurait été `/codes/noga/621000/`). Affichées en `<span>` non-cliquable dans les listes "sous-niveaux directs" pour éviter les 404. À évaluer si volume SEO le justifie.

## Fichiers créés / modifiés

- `web/src/lib/noga-helpers.ts` (nouveau, 290 lignes TS)
- `web/src/pages/codes/noga/[code].astro` (nouveau)
- `web/src/pages/codes/index.astro` (nouveau)
- `web/src/styles/global.css` (3 classes ajoutées : `current-hierarchy-row`, `ds-section-overflow`, `ds-section-note`)
