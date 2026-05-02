# Pipeline de refresh des datasets

Ce document décrit les 3 workflows GitHub Actions qui maintiennent les datasets openswissdata à jour vis-à-vis des sources fédérales suisses, et le canary qui détecte les ruptures de format avant qu'elles n'impactent les clients.

---

## 1. `refresh-finma.yml` — quotidien (production)

**Fréquence** : tous les jours à `03:00 UTC` (`05:00 CEST`)
**Source** : `https://www.finma.ch/.../uid.csv` (CSV consolidé FINMA, mis à jour quotidiennement par FINMA)
**Action** :

1. `npm run etl:finma` — télécharge le CSV, normalise les 10 entity_types, génère le bundle (CSV/JSON/Parquet/SQL)
2. Upload sur Cloudflare R2 (`r2://openswissdata/finma/<version>/finma.zip`)
3. Manifest signé Ed25519 + horodatage RFC-3161 + checksums SHA-256
4. Enregistrement dans la DB (`/api/admin/release`)
5. `notify-finma-diff.ts` envoie un email aux clients impactés si des entités ont disparu

**Lancer manuellement** : `gh workflow run refresh-finma.yml`

---

## 2. `refresh-tares.yml` — hebdomadaire (en validation)

**État au 2026-05-02** : workflow déployé mais **cron désactivé** par défaut. Pour activer :

```bash
gh variable set TARES_CRON_ENABLED --body "true"
```

**Fréquence (une fois activé)** : tous les lundis à `04:00 UTC` (`06:00 CEST`)
**Source** : 7 fichiers XLSX BAZG (`https://www.bazg.admin.ch/dam/de/sd-web/...`)
**Action** :

1. `npm run etl:tares` — télécharge les 7 XLSX, parse, normalise, build bundle (rows + embeddings skippés en CI)
2. Upload sur R2 (`r2://openswissdata/tares/<version>/tares.zip`)
3. Manifest signé Ed25519 + RFC-3161
4. Enregistrement dans la DB

**Différence avec FINMA** : les embeddings TARES (~7 500 vecteurs 768d) ne sont pas regénérés en CI (trop lent sur CPU runner). Ils sont produits localement avant chaque release majeure et réutilisés tant que le modèle n'a pas changé.

**Lancer manuellement (dry-run recommandé avant d'activer le cron)** :
```bash
gh workflow run refresh-tares.yml
gh run watch  # observer en direct
```

**Activer le cron une fois validé** :
```bash
gh variable set TARES_CRON_ENABLED --body "true"
```

---

## 3. `monitor-sources.yml` — canary quotidien

**Fréquence** : tous les jours à `07:00 UTC` (`09:00 CEST`)
**But** : détecter une rupture *structurelle* sur une source amont (URL morte, schéma JSON modifié, fichier XLSX déplacé) **avant** qu'elle ne fasse exploser un refresh planifié.

**Sources surveillées** (10 au total) :

| ID | Source | Mode |
|---|---|---|
| `tares.tariff_8_digit` | BAZG XLSX (HS8 numbers) | hash brut |
| `tares.tarifstruktur` | BAZG XLSX (hiérarchie multilingue) | hash brut |
| `tares.duty_rates_*` | BAZG XLSX × 4 (chapitres 01-30, 31-63, 64-83, 84-97) | hash brut |
| `tares.customs_facilities` | BAZG XLSX (codes ZCO) | hash brut |
| `finma.uid_csv` | FINMA CSV consolidé | hash brut |
| `bfs.noga_2025` | BFS via i14y JSON API | hash de structure JSON |
| `bfs.noga_2008` | BFS via i14y JSON API | hash de structure JSON |

**Mode `raw`** : SHA-256 des bytes téléchargés. Détecte tout changement, même un octet de métadonnée XLSX. Plus sensible.

**Mode `json-shape`** : SHA-256 d'une signature structurelle (clés JSON triées, longueurs des arrays jusqu'à profondeur 1). Insensible aux ajouts/suppressions de codes individuels — alerte uniquement si les noms de champs ou la structure changent. Évite le bruit quand BFS publie une mise à jour normale.

**Baseline** : `etl/canary-baseline.json` (commitée dans le repo). Le rapport éphémère de chaque run va dans `etl/canary-report.json` (gitignoré).

**Comportement en cas d'écart** :

- `drift > 0` (rupture détectée) → ouvre une **issue GitHub** label `canary,priority:high` avec le diff. Pas d'email pour l'instant (phase de tuning).
- `error > 0` (timeout/4xx) → issue séparée label `canary,priority:medium`. Peut être transitoire.
- `0 drift, 0 error` → exit 0, aucune issue.

**Mettre à jour la baseline après un changement amont volontaire** :
```bash
gh workflow run monitor-sources.yml -f update_baseline=true
```

**Tester localement** :
```bash
# Run + write baseline si premier run
npx tsx scripts/monitor-sources.ts

# Forcer la mise à jour de la baseline locale
npx tsx scripts/monitor-sources.ts --update
```

---

## Procédure en cas de drift détecté

1. **Lire l'issue GitHub** ouverte automatiquement.
2. **Examiner manuellement** la nouvelle version de la source — télécharger le fichier, l'ouvrir, comparer aux fixtures dans `etl/<dataset>/fixtures/`.
3. **Catégoriser** :
   - **Mise à jour normale** (nouvelles lignes, valeurs modifiées, header inchangé) → mettre à jour la baseline (`-f update_baseline=true`), pas d'action client.
   - **Rupture de schéma** (colonne renommée, nouveau format de fichier, URL définitivement morte) → adapter le parser ETL, prévenir les clients impactés via email + changelog dataset.
4. **Notifier les clients** si une release est requise. Inclure date d'effet et impact.
5. **Mettre à jour la baseline** une fois le pipeline reaté avec succès.

---

## Pipeline de release manuel (référence)

Pour une release ad-hoc en local :

```bash
# TARES
BASE_URL=https://www.openswissdata.com \
ADMIN_SECRET=$ADMIN_SECRET \
R2_ACCOUNT_ID=$R2_ACCOUNT_ID R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY R2_BUCKET=$R2_BUCKET \
OSD_SIGNING_KEY_ED25519=$OSD_SIGNING_KEY_ED25519 \
npm run etl:tares

# FINMA
BASE_URL=https://www.openswissdata.com \
ADMIN_SECRET=$ADMIN_SECRET \
R2_ACCOUNT_ID=$R2_ACCOUNT_ID ... \
npm run etl:finma
```

Variables d'env requises : voir `src/lib/env.ts` pour la liste complète.
