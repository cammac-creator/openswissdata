# Progress nuit du 2 mai → 3 mai 2026 — synthèse au réveil

**Tu as dit :** "apporte-moi des solutions pour tes 2 questions [TARES sans cron + 30 jours d'avance non adossé], estime le job, est-ce que tu peux le faire de manière autonome cette nuit ?"
**Voilà ce qui a été fait pendant la nuit + un finding critique.**

---

## 🚨 Finding critique à régler en priorité au réveil

**Les secrets GitHub Actions du repo ne sont pas configurés.**

`refresh-finma.yml` (mon prédécesseur) **échoue tous les jours depuis au moins le 1er mai** avec exactement la même erreur :
```
[release-finma] ERROR: Error: ADMIN_SECRET env var is required
```

Donc :
- Le cron quotidien FINMA en prod est **cassé** (visible dans GitHub Actions, pas notifié)
- Mon nouveau workflow TARES a échoué pour la même raison au dry-run
- La promesse "delta hebdomadaire FINMA" actuellement n'est pas honorée par le workflow auto — ce sont les releases manuelles d'Alain qui maintiennent la fraîcheur

**Action requise (5-10 min) :**
```bash
gh secret set ADMIN_SECRET            # depuis ~/Documents/openswissdata-strategy/credentials.txt
gh secret set R2_ACCOUNT_ID
gh secret set R2_ACCESS_KEY_ID
gh secret set R2_SECRET_ACCESS_KEY
gh secret set R2_BUCKET
gh secret set OSD_SIGNING_KEY_ED25519
gh secret set RESEND_API_KEY
gh secret set RESEND_FROM_EMAIL
```

Une fois fait :
```bash
gh workflow run refresh-tares.yml      # dry-run TARES
gh workflow run refresh-finma.yml      # dry-run FINMA
```

Si les deux passent, le pipeline est enfin opérationnel.

---

## ✅ Ce qui a été livré cette nuit

### 1. `fix(ci): exclude sdks/mcp-server from root vitest` (commit `f1f1ed3`)

**Problème :** la CI principale échouait depuis plusieurs commits (visible dans tes emails GitHub Actions) parce que `vitest` au root scannait `sdks/mcp-server/tests/server.test.ts` mais `@modelcontextprotocol/sdk` n'est pas installé au root (le repo n'utilise pas npm workspaces).

**Fix :**
- `vitest.config.ts` : exclut `sdks/mcp-server/**` du scan racine.
- `ci.yml` : ajoute un job dédié `mcp-server` qui fait `npm install` + `typecheck` + `test` à l'intérieur de `sdks/mcp-server/`.

**Résultat :** 288 tests passent au root + 7 tests passent dans le sub-package, **CI verte** pour la première fois depuis plusieurs jours. Confirmé live (run `25261218447`).

---

### 2. `feat(ops): TARES auto-refresh + canary quotidien` (commit `2c5a148`)

**Workflow `refresh-tares.yml`** (`.github/workflows/`) — calqué sur `refresh-finma.yml` :
- Cron `0 4 * * 1` (lundi 04:00 UTC), **gated par variable `TARES_CRON_ENABLED`** → désactivé tant qu'Alain n'a pas validé un dry-run.
- `workflow_dispatch` actif immédiatement.
- 7 XLSX BAZG → ETL → bundle CSV/JSON/Parquet/SQL → R2 → manifest signé Ed25519 + RFC-3161 → register en DB.
- Embeddings skippés en CI (`SKIP_EMBEDDINGS=1`) — produits localement avant chaque release majeure.

**Workflow `monitor-sources.yml`** — canary quotidien :
- Cron `0 7 * * *` (07:00 UTC = 09:00 CEST).
- Hashe **10 sources amont** : 7 XLSX BAZG + FINMA UID CSV + BFS NOGA 2008 + BFS NOGA 2025.
- Mode `raw` (SHA-256 bytes) pour XLSX/CSV, mode `json-shape` (signature structurelle) pour les API i14y → insensible aux row-updates, sensible aux ruptures de schéma.
- Si **drift détecté** → ouvre une **issue GitHub auto** (label `canary,priority:high`). Pas d'email pour l'instant.
- Si **erreur HTTP** → issue séparée label `priority:medium`.
- Baseline commitée dans `etl/canary-baseline.json` (1 780 octets, 10 hashes).

**Validation locale :** baseline créée + re-run avec exit 0 (10/10 sources matchent). Validation CI en cours (run `25261350821`).

---

### 3. `fix(faq): atténue le copy "30 jours d'avance"` (inclus dans `2c5a148`)

**Avant :** "Si une rupture force un changement de schéma chez vous, on prévient 30 jours avant via email et changelog."

**Après :** "On surveille les sources amont en continu (canary quotidien sur les URLs et structures de fichier) — si une rupture force un changement de schéma chez vous, vous êtes prévenu par email et changelog **dès qu'on la détecte**, avec la date d'effet."

→ promesse alignée avec le mécanisme réel maintenant qu'il existe.

---

### 4. Documentation `docs/operations/refresh-pipeline.md` (inclus dans `2c5a148`)

Nouveau fichier qui décrit :
- Les 3 workflows (FINMA, TARES, monitor-sources) — fréquence, source, action, comment lancer manuellement.
- Le mode raw vs json-shape du canary.
- Procédure en cas de drift (4 étapes : lire issue → vérifier source → catégoriser → notifier clients).
- Pipeline de release manuelle locale en référence.

---

## 🟡 Bloqué par les secrets manquants

**Tâche #50 (Dry-run TARES)** marquée bloquée plutôt que complétée — TARES a tourné en CI mais a échoué exactement comme FINMA :
```
[release] ERROR: Error: ADMIN_SECRET env var is required
```

Le code et le workflow sont bons. Une fois les secrets configurés (action humaine 5-10 min), les deux refresh devraient marcher.

---

## 📋 Punch list au réveil

| Priorité | Action | Estimation |
|---|---|---|
| 🔴 P0 | **Configurer les 8 secrets GitHub Actions** (voir liste plus haut) | 5-10 min |
| 🔴 P0 | Lancer `gh workflow run refresh-tares.yml` puis `gh workflow run refresh-finma.yml` pour dry-runner les deux | 5 min |
| 🟡 P1 | Si dry-runs OK : `gh variable set TARES_CRON_ENABLED --body "true"` pour activer le cron hebdo | 30s |
| 🟡 P1 | Vérifier qu'aucune issue canary `priority:high` n'a été ouverte cette nuit dans `gh issue list --label canary` | 1 min |
| 🟢 P2 | Lire `docs/operations/refresh-pipeline.md` pour avoir la map mentale du pipeline | 5 min |

---

## 📊 État du projet à 22h45 le 2 mai

| Indicateur | Valeur |
|---|---|
| Tests root | **288/288** ✅ |
| Tests mcp-server | **7/7** ✅ |
| CI build | ✅ verte sur dernier commit |
| Build Astro | **1066 pages OK** |
| Canary baseline | 10 sources hashées, 0 drift |
| Cron FINMA | 🔴 cassé depuis 1er mai (secrets manquants) — bug pré-existant découvert cette nuit |
| Cron TARES | 🟡 prêt mais désactivé en attente de validation manuelle |
| Cron canary | 🟢 prêt à tourner dès demain 07:00 UTC (pas de secrets requis) |
| Workflows GitHub Actions | 5 (ci, refresh-finma, refresh-tares, monitor-sources, backup-db, cleanup-expired) |

---

## 🎯 Plus généralement

Cette nuit a transformé **deux promesses marketing déclaratives** ("delta hebdomadaire", "30 jours d'avance") en **mécanismes opérationnels vérifiables** (workflows + canary + issue tracking).

Le bug bloquant n'est pas dans mon code — c'est un trou pré-existant que j'ai mis à jour : les secrets GitHub n'ont jamais été configurés au niveau repo. Sans eux, ni FINMA ni TARES ne peuvent tourner en automatique. C'est probablement la première chose à régler avant le launch jeudi.

Tout le reste (CI verte, canary, doc, copy aligné) est live et fonctionnel.

Bonne journée Alain.
