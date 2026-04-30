# Audit complet & Roadmap — openswissdata.com

**Date :** 2026-04-30
**Méthode :** 7 agents spécialisés en parallèle (code, sécurité, ETL/datasets, légal, conversion, infra, concurrence) + checks live production
**Durée audit :** ~4h cumulées · ~1300 fichiers analysés
**Verdict global :** **🟡 Plateforme techniquement solide à 85%, mais 3 angles morts opérationnels et 2 bloqueurs légaux empêchent un lancement complet aujourd'hui.** Lancement TARES-only possible sous 5-7 jours.

---

## Score de santé par axe

| Axe | Note | Verdict | Bloqueurs |
|---|---|---|---|
| Code applicatif | 7.5/10 | 🟢 OK | Webhook fail-fast si dataset sans version, OAuth non testé, register.ts ternaire mort |
| Sécurité | 6.5/10 | 🟡 À fixer | OAUTH_SIGNING_SECRET non validé, download token rejouable, recheck entitlement absent, aucun header sécurité |
| ETL/Datasets | 7/10 | 🟡 À fixer | Désync DB TARES (vendrait fixture 5 lignes), STATENT non autorisé BFS |
| Légal/Compliance | 4/10 | 🔴 Bloquant | BFS et FINMA pas répondus, garantie 10× sans assurance, CGV référence LCD erronée, marque vs opendata.swiss |
| Landing/Conversion | 6/10 | 🟡 À fixer | Bandeaux "premier brouillon" CGV/Privacy, placeholder IDE Impressum, og-default.png absent, SKUs fantômes |
| Infra/E2E | 6.5/10 | 🟡 À fixer | Backup SQLite absent, health check superficiel, naked root cassé, SPF n'inclut pas Resend, pas de self-purchase LIVE testé |
| Concurrence/Position | 8/10 | 🟢 OK | Quadrant self-serve + CH normalisée vide, OpenSanctions = étoile polaire à imiter |

**Score moyen : 6.5/10** — projet à un palier critique : tout l'effort reste en finition/dérisque, pas en build.

---

## Top 10 bloqueurs ranged par priorité

| # | Bloqueur | Axe | Effort | Sévérité |
|---|----------|------|--------|----------|
| 1 | **Désync DB TARES** : `versions` table pointe sur fixture 5 lignes alors que `tares-2026.04.30.1.zip` (7511 lignes, 14.5 MB) attend en disque | ETL | 30 min | 🔴 Catastrophique : 1er acheteur reçoit fixture |
| 2 | **Backup SQLite absent** : si volume Railway corrompt = perte totale customers + entitlements + orders | Infra | 1-2h | 🔴 Catastrophique |
| 3 | **OAUTH_SIGNING_SECRET non validé au boot** : MCP/OAuth crashe en 500 silencieusement | Sécurité | 15 min | 🔴 MCP totalement cassé |
| 4 | **Garantie 10×/50k CHF dans provenance.astro sans assurance RC pro** | Légal | 5 min | 🔴 Patrimoine perso d'Alain en risque |
| 5 | **SKUs Classifications + FINMA actifs sans permission BFS/FINMA écrite** | Légal | 30 min | 🔴 Risque LCD art. 5 |
| 6 | **Download tokens rejouables 48h sans recheck entitlement** | Sécurité | 30 min | 🟡 Refund Stripe contournable, fuite Slack persistante |
| 7 | **Pas de self-purchase LIVE testé** (preflight-15 absent) | Infra | 1h | 🟡 Bug payment caché possible |
| 8 | **Naked root `openswissdata.com` cassé** (curl exit 6) | Infra | 30 min | 🟡 UX cassée, SEO split |
| 9 | **Bandeaux "premier brouillon" sur CGV et Privacy** | Conversion | 5 min | 🟡 Tue le trust B2B instantanément |
| 10 | **SPF Resend non configuré** (DMARC `p=reject` repose uniquement sur DKIM) | Infra | 10 min | 🟡 Inbox placement fragile |

---

## Roadmap argumentée — 6 semaines

### PHASE 0 — Kill Switch immédiat (J0–J1, 1-2 jours, ~6h focused)

**Pourquoi maintenant** : aujourd'hui n'importe quel acheteur sur les SKUs Classifications ou FINMA expose Alain à un risque LCD art. 5 (revente sans autorisation écrite des sources officielles). N'importe quel acheteur TARES télécharge un fixture de 5 lignes. Le site affiche des bandeaux "premier brouillon" sur CGV. **Lancement = impossible.**

**Actions** (toutes &lt; 30 min chacune) :

1. **Retirer ou marquer "Pré-vente" les SKUs `classifications_*` et `finma_*`** dans Stripe Live + frontend. Ne lancer commercialement que **TARES** (one-shot 299 CHF + updates 120 CHF/an). Les acheteurs Classifications/FINMA peuvent rejoindre une liste d'attente email. Argument commercial : "Permission BAZG acquise, autorisations BFS/FINMA en attente écrite — version pré-vente avec décote 50% au lancement".

2. **Re-sync DB TARES** : `BASE_URL=https://www.openswissdata.com npm run etl:tares` puis vérifier que `current_version` pointe sur `2026.04.30.1` et non `2026.04.22`. Si pas possible côté Railway, faire SQL direct : `UPDATE datasets SET current_version='2026.04.30.1' WHERE id='tares';` + INSERT INTO versions.

3. **Retirer la garantie 10× / 50k CHF** de `web/src/pages/legal/provenance.astro` section 5. Tant qu'aucune assurance RC pro n'est souscrite, cette clause = engagement contractuel ferme sans contrepartie financière, exposant le patrimoine personnel d'Alain. À réintroduire après souscription Generali/Helvetia (~300 CHF/an).

4. **Supprimer les bandeaux "premier brouillon"** sur CGV (`web/src/pages/legal/cgv.astro`) et Privacy (`web/src/pages/legal/privacy.astro`). Ces mentions tuent la confiance B2B en 2 secondes. Si Alain veut une mention de précaution, formuler en : "Document susceptible de mises à jour. Version archivée disponible sur demande."

5. **Compléter Impressum** : remplacer `[À compléter une fois inscrit IDE / UID si applicable...]` par `Non applicable — Raison individuelle non inscrite au RC (CA <100 000 CHF, art. 36 ORC). TVA : non assujetti (art. 10 LTVA).` Conformité LCD art. 3 al. 1 lit. s.

6. **Trademark check swissreg.ch + EUIPO** sur "openswissdata", "open swiss data", "opendata.swiss", "open-data-swiss". Si une marque proche existe, **rebrand stratégique nécessaire**. Si tout est libre, déposer marque verbale "openswissdata" classes 9 (logiciels), 35 (services data), 42 (services informatiques) : ~550 CHF.

7. **Disclaimer "non-affilié à opendata.swiss"** dans footer global + page index + Impressum. Risque LCD art. 3 al. 1 lit. d (confusion avec produit officiel) sinon.

8. **Sauvegarder l'email original BAZG** signé par Michael Beer en 3 exemplaires (Drive, GitHub privé, papier). Aujourd'hui la permission est référencée par identifiant `BAZG-PERMISSION-2026-04-21-MICHAEL-BEER` mais aucune copie immuable n'existe ailleurs que dans la boîte mail.

**Output Phase 0** : site légalement défendable, 1 SKU vendable (TARES), risque marque tracé.

---

### PHASE 1 — Sécurité hardening (J1–J3, 2-3 jours, ~12h focused)

**Pourquoi** : 12 vulnérabilités npm dont 4 critical (devDeps), aucun header de sécurité actif, OAUTH crash silencieux, download tokens rejouables. **Pas tous bloquants, mais exploitables après 1ère vente.**

**Actions** :

1. **Ajouter `OAUTH_SIGNING_SECRET` au schéma Zod** dans `src/env.ts` :
   ```ts
   OAUTH_SIGNING_SECRET: isProd ? z.string().min(32) : z.string().min(16).default("dev-oauth-signing-secret-change-me"),
   ```
   + `.env.example` + Railway env. Sinon, dès qu'un agent Claude Code essaie le MCP, il reçoit un 500.

2. **Single-use réel pour download_tokens** dans `src/routes/download.ts:62-74` : `WHERE token = ? AND used_at IS NULL` + assert `result.changes > 0` avant signature R2. Aujourd'hui le token reste rejouable 48h, fuite Slack/screenshot = exploitable.

3. **Recheck entitlement à chaque redeem download_token** : joindre `entitlements.updates_until > now()`. Couvre le cas refund Stripe : aujourd'hui un client refundé garde un lien actif 48h.

4. **Headers de sécurité globaux** dans `src/index.ts` :
   ```ts
   import { secureHeaders } from "hono/secure-headers";
   app.use("*", secureHeaders({
     contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
     strictTransportSecurity: "max-age=15552000; includeSubDomains",
     referrerPolicy: "strict-origin-when-cross-origin",
   }));
   ```
   Couvre clickjacking sur la page `/oauth/authorize`, downgrade attacks, leakage referrer.

5. **Rate-limit `/api/checkout/start`, `/oauth/register`, `/api/admin/*`** (10 req/min/IP via Hono middleware in-memory ou upstash). Empêche : flood checkout = bruit Stripe Dashboard, spam OAuth register = explosion table mcp_clients.

6. **Webhook fail-safe** : modifier `src/routes/stripe-webhook.ts:78-94` pour livrer ce qui peut l'être et alerter sur le manquant, plutôt que retourner 500 et bloquer toute la commande. Sinon Stripe retry 24h+, client paye sans entitlement.

7. **Cleanup TTL cron** : ajouter un setInterval (ou cron Railway) qui purge `sessions`, `magic_links`, `download_tokens`, `mcp_oauth_codes` expirés. Sans ça, fichier SQLite grossit indéfiniment.

8. **Retry email Resend** : wrapper `sendDownloadEmail` avec backoff exponentiel (3 tentatives, 1s/3s/9s). Si Resend tombe au moment du webhook, le client paye sans email.

9. **`npm audit fix`** sur `fast-xml-parser` (XML CDATA injection). Pour `xlsx` ReDoS : pas de fix dispo, mitigation = ne jamais parser un XLSX uploadé par user (déjà le cas, pipeline interne).

10. **`register.ts:70`** code mort `tier: Tier = isValidTier(requestedTier) ? "free" : "free"` → réécrire `const tier: Tier = "free"; // free tier seulement, see roadmap.md tiering` pour éviter qu'un futur dev casse l'intention.

**Output Phase 1** : niveau de sécurité = production-ready B2B sérieux. Reste à faire un pen-test externe avant scale &gt; 50 clients.

---

### PHASE 2 — Infra production (J3–J5, 2 jours, ~10h focused)

**Pourquoi** : aujourd'hui une corruption volume Railway = perte totale customers/entitlements. Un secret R2 expiré = downloads silencieusement cassés (health check répond OK). Naked root cassé. SPF sans Resend = inbox placement fragile chez compliance officers de banques.

**Actions** :

1. **Backup SQLite quotidien vers R2** : script `scripts/backup-db.ts` lancé par cron Railway 03:00 UTC :
   ```ts
   const backup = await db.backup(`/tmp/db-${date}.sqlite`);
   await s3.putObject({ Bucket, Key: `backups/db-${date}.sqlite`, Body: backup });
   // Retention 30 jours
   ```
   **Bloqueur absolu** sans ça.

2. **Health check profond** `/api/health/deep` :
   ```ts
   const checks = await Promise.allSettled([
     db.prepare("SELECT 1").get(),
     s3.send(new HeadBucketCommand({ Bucket })),
     stripe.balance.retrieve(),
   ]);
   return c.json({ db: ok, r2: ok, stripe: ok });
   ```
   UptimeRobot / BetterStack ping toutes les 5 min sur cet endpoint avec alerte email/Slack.

3. **Sentry SDK** + DSN Railway env. Capture les `console.error` actuels (webhook fail, stripe error, email fail, OAuth error). Tier gratuit 5k errors/mois suffit pour le démarrage.

4. **Stripe Dashboard alerts** : activer "Notify on failed webhook deliveries" + email pour `payment_intent.payment_failed`. Aujourd'hui une signature webhook fail = silence.

5. **DNS naked root** : Infomaniak ne supporte pas CNAME-on-root. Deux options :
   - Migrer DNS vers Cloudflare (~20 min) + CNAME flat → www.
   - Garder Infomaniak + créer A record pointant vers IP Railway + redirect 301 dans `src/index.ts`.

6. **SPF Resend** : ajouter `include:_spf.resend.com` au TXT SPF zone Infomaniak :
   `v=spf1 include:spf.infomaniak.ch include:_spf.resend.com -all`
   Sinon, `p=reject` actuel rejette les emails Resend chez les destinataires stricts.

7. **Cron ETL hebdo** : `.github/workflows/refresh.yml` avec `schedule: '0 3 * * 1'` qui run `etl:tares` et POST `/api/admin/release`. Sans ça, abonnements `updates` ne livrent rien = refund garanti à 12 mois. Ajouter envoi email Resend aux entitlements actifs ("Nouvelle version 2026.05.07 disponible").

8. **CI GitHub Actions** : `.github/workflows/test.yml` avec vitest + tsc --noEmit + astro build sur PR + main. Bloquant si red.

9. **Self-purchase LIVE test** (preflight-15) : Alain achète chacun des 4 SKUs en LIVE avec sa propre carte. Vérifie débit, signature webhook LIVE, email Resend reçu, entitlement DB, magic link, download R2. Documenter dans `docs/preflight-15-stripe-live-self-purchase.md`. **À faire avant de partager le moindre lien commercial.**

10. **Self-refund test** : refund chaque achat self-purchase pour valider que les entitlements sont bien révoqués (cf. fix sécurité 3).

**Output Phase 2** : prod observable, alertée, backupée. Première vente externe possible.

---

### PHASE 3 — Conversion & Trust (J5–J10, 5 jours, ~25h focused)

**Pourquoi** : le code est solide, l'infra l'est aussi après Phase 2. Mais le site ne convertit pas un compliance officer sceptique. Pas de logo client, pas de témoignage, hero générique, og-default.png absent (preview LinkedIn cassée), SKUs fantômes, anglais résiduel sur /account et /blog.

**Actions principales** :

1. **Hero index refondu** :
   - Eyebrow : `PERMISSION BAZG · DONNÉES FÉDÉRALES SUISSES · ÉDITION 2026.04`
   - H1 : "Les données réglementaires suisses, **branchables en 15 minutes.**"
   - Sous-titre : "TARES douanier, classifications NOGA/NACE/ISIC, registre FINMA — extraits des sources fédérales, normalisés, signés Ed25519. Pour les équipes data, compliance et intégrateurs ERP qui n'ont pas le budget d'un mois de scraping."
   - CTA primaire : `Télécharger l'échantillon gratuit →`
   - CTA secondaire : `Voir les datasets`
   - CTA mono : `npx @osd/cli pull tares`

2. **3 sections "Pour qui"** (data engineer fintech / compliance officer / fondateur SaaS paie) avec verbatims concrets, cf. brief copywriting agent landing.

3. **Section "Pourquoi pas DIY ?"** avec 4 arguments (format change sans prévenir, normalisation prend 5j-homme, LCD art. 5, ROI 1ère release).

4. **FAQ 8 questions** : sources, légalité, fréquence, format change, vérification provenance, intégration ERP, refund, sur-mesure.

5. **Bloc échantillon gratuit** au-dessus du pricing (CTA primaire) : `tares-sample.csv (100 lignes) — sans inscription`.

6. **Cohérences chiffrées** :
   - Pill `−25%` sur bundle → `−20%` (ou ajuster prix bundle à 749 CHF).
   - "Mises à jour mensuelles" CTA final → cadence réelle (hebdo TARES/FINMA, annuel Classifications).
   - Retirer références Pro fantômes (TARES Pro 899, FINMA Pro 699) de provenance.astro tant que les SKUs n'existent pas dans Stripe.

7. **Permission line corrigée** : `Sources — BAZG (permission acquise 2026-04-21) · OFS & FINMA (autorisations en cours)` (au lieu de laisser sous-entendre que BFS et FINMA ont aussi répondu).

8. **og-default.png 1200×630** dans `web/public/`. Sans ça, toutes les previews LinkedIn/Twitter/Slack du site sont cassées. Outil rapide : Figma ou ogimage.org.

9. **JSON-LD Schema.org** dans `BaseLayout.astro` : Organization + Product + Offer + FAQPage. Permet rich snippets Google sur "TARES API", "registre FINMA". Trafic organique gratuit.

10. **Traduire `/account` et `/blog/index`** en français (Sign in → Connexion, Send magic link → Envoyer le lien, Home → Accueil, Published → Publié). Site `lang="fr"` ne doit pas avoir d'anglais funnel.

11. **Refund 14j sans condition** : remplacer "si non téléchargé" par "14j sans condition" dans CGV §6. Standard B2B + meilleur trust signal.

12. **Newsletter sign-up** dans footer + bloc dédié. Aujourd'hui aucun moyen de capter un visiteur intéressé qui n'achète pas immédiatement.

13. **CGV corrections juridiques** :
    - Référence LCD art. 1 erronée → `Droit de rétractation B2B inapplicable (art. 40a CO ne s'applique qu'aux consommateurs)`.
    - Section 7 ajout : `Cette limitation ne s'applique pas en cas de dol ou de faute grave (art. 100 al. 1 CO)`.
    - Section 2bis : `Sublicensing strictement interdit`.
    - Section 12bis : clause force majeure (Stripe down, Resend down, sources officielles indisponibles).

**Output Phase 3** : taux de conversion attendu × 2-3 (basé sur retours OpenSanctions sur leur landing).

---

### PHASE 4 — Distribution (J10–J30, 3 semaines, ~50h cumulées)

**Pourquoi** : le moat openswissdata n'est pas la data (sources publiques, copiables). C'est la distribution + DX. Quatre canaux à activer en parallèle, faible coût, compatibles 10-15h/sem.

**Canaux** :

1. **SEO programmatique** : 200+ pages générées Astro statiques `/codes/noga/XX-XX` avec libellés FR+DE+IT+EN, cross-walks NACE/ISIC, exemples d'entreprises. Mots-clés long-tail "code NOGA 62.01 → activité française" capturent des compliance officers en train de coder. Sitemap injecte 200+ URLs, indexation 4-8 semaines.

2. **MCP marketplace** : packager `@openswissdata/mcp` avec 4-5 tools (`tares_lookup`, `noga_classify`, `finma_lookup`, `noga_to_nace`, `tares_search`). Soumettre à Smithery, MCP.so, awesome-mcp-servers. **Early window 2026** : peu de concurrents data CH sur MCP. Touche directement la cible data engineer LLM-native (la tribu d'Alain via IBANforge).

3. **Awesome-lists PRs** : `awesome-swiss-open-data`, `awesome-fintech-ch`, `awesome-mcp-servers`, `awesome-public-apis`. Effort 1h par PR, ROI long-tail organique.

4. **Outbound LinkedIn** : 10 personnes/jour × 5 jours = 50 messages personnalisés. Template prêt dans `docs/launch/launch-log.md`. Cibles : Data Engineer / BI Lead / Head of Compliance / Customs Manager / SAP GTS Consultant dans banques privées CH, fintechs, groupes industriels exportateurs UE, cabinets conseil. Échantillon 100 lignes en porte d'entrée.

5. **Partenariats fiduciaires** : 5 fiduciaires/cabinets CH qui te referral en échange d'un dataset gratuit + commission 10-20%. Trouver 5 noms via LinkedIn (Vaud, Genève, Zurich), envoyer email court avec accès demo.

6. **Show HN / Product Hunt / Indie Hackers** : préparer texte, attendre fenêtre. Show HN demande karma (Alain peut emprunter compte ou bâtir).

7. **Reddit** : r/dataengineering ("I built a commercial data cleaning layer for Swiss gov data"), r/switzerland, r/OpenData. Samedi seulement.

8. **Newsletter contenu** : changelog hebdomadaire en public sur openswissdata.com/blog. Modèle OpenSanctions. Effort 30 min/sem, fait grossir SEO + email list.

**Output Phase 4** : 5-10 ventes TARES first wave (1500-3000 CHF revenu) + 50-100 emails newsletter + 200+ pages indexées Google.

---

### PHASE 5 — Réponses BFS/FINMA + Catalogue extension (M2–M3, vagues 2026-Q2/Q3)

**Pourquoi** : les SKUs Classifications + FINMA dorment depuis Phase 0. Les débloquer après obtention écrite des autorisations.

**Actions** :

1. **Relances v2 BFS et FINMA** envoyées immédiatement (textes prêts dans `permissions-emails/`). Si pas de réponse à J+30, **téléphone direct** : OFS 058 463 60 11, FINMA 031 327 91 00. Demander un nom de référent.

2. **À réception réponse écrite OFS** : réactiver SKU `classifications_oneshot` Standard (sans STATENT). STATENT reste dans le tier Pro, à attendre une autorisation explicite distincte.

3. **À réception réponse écrite FINMA** : réactiver SKU `finma_oneshot` Standard (registre autorisés uniquement). Warnings list = pré-vente / wait-list jusqu'à autorisation supplémentaire (risque civil entités listées).

4. **Tier Pro Compliance Pack 1990 CHF** : FINMA + Sanctions SECO/OFAC/EU + Zefix Sync. Cible direct compliance officers fintechs CH. Marge brute &gt; 95%.

5. **Reprice TARES** après 5 ventes : 299 → 499 standard / 899 Pro (avec changelog historique 12-24 mois, embeddings DE/IT/EN multilingue, cross-walk HS6 → TARIC EU).

6. **Datasets vague 2026-Q3** par ordre de TAM (cf. market-demand-analysis.md) :
   - **LETA / UBO Register** (mi-2026) — TAM 600k entités CH × 50-500 CHF/an petit, 5-50k/an gros. ARR théorique potentiel 50-200k CHF.
   - **OECD Pillar Two GIR** (30 juin 2026) — ~250 MNE CH × 20-100k CHF/an. ARPU élevé, peu de clients, vente sales-led.
   - **DAC8 / CARF** (1er janv 2027) — ~50 VASPs CH × 30-100k CHF/an.
   - **Charges sociales × canton × commune × situation familiale** — éditeurs SaaS paie (Bexio, Abacus, Lano, Deel, Remote.com) — ARPU 5-50k CHF/an.

**Output Phase 5** : 3 SKUs actifs + 1 tier Pro Compliance, ARR cible mois 6 = 5-10k CHF MRR.

---

### PHASE 6 — Scale & Hardening (M3–M6)

1. **Migration Postgres Railway** si DB &gt; 500 MB ou &gt; 100 clients. better-sqlite3 → pg via Drizzle. Effort ~2 jours.
2. **Pen-test externe** par solo security researcher CH (~2k CHF) avant 1ère vente Pro Compliance.
3. **Souscrire assurance RC pro** Generali/Helvetia (~300 CHF/an, 1M CHF couverture). Indispensable avant la garantie 10× revienne sur la page.
4. **Trademark deposit "openswissdata"** classes 9, 35, 42 via swissreg.ch (~550 CHF) si check Phase 0 dit que c'est libre.
5. **Plan B juridique** : 1-2 avocats droit numérique CH identifiés, retainer mensuel 200 CHF ou simple contact pré-établi.
6. **Webhooks customer** : notification API quand FINMA registry diff change (ARPU élevé, sticky integration).
7. **Bundles régionaux** : "Pack VD" (TARES + cantonal Vaud), "Pack ZH" (FINMA + cantonal ZH).

---

## Stratégie de pricing — révision recommandée

| SKU actuel | Prix | Statut Phase 0 | Statut M3 | ARPU annuel |
|------------|------|----------------|-----------|-------------|
| TARES one-shot | 299 CHF | ✅ Actif | 499 standard / 899 Pro | 299 (oneshot) |
| TARES updates | 120 CHF/an | ✅ Actif | 199 standard / 399 Pro | 120-399 |
| Classifications one-shot | 399 CHF | 🔒 Pré-vente | 399 standard / 999 Pro (avec STATENT si autorisé) | 399 |
| Classifications updates | 160 CHF/an | 🔒 Pré-vente | 160-499 | 160-499 |
| FINMA one-shot | 299 CHF | 🔒 Pré-vente | 299 / 1290 Zefix Sync | 299 |
| FINMA updates | 120 CHF/an | 🔒 Pré-vente | 120-499 | 120-499 |
| Bundle one-shot | 799 CHF | ⚠️ Aligner pill -25%/-20% | 1490 (3 datasets + cross-walks + 1 an updates) | 799-1490 |
| **NEW** Compliance Pack | — | — | 1990 CHF/an | 1990 |
| **NEW** LETA UBO | — | — | M6 — 590 CHF/an | 590 |

**Cible** : 5 ventes TARES @299 = 1495 CHF dans 30 jours = preuve marché. Puis débloquer Compliance Pack et viser 10 clients @1990 CHF = 19900 CHF ARR à M3.

---

## Positionnement vs concurrence

**Quadrant cible** : self-serve + data brute normalisée. **Aujourd'hui personne n'occupe ce quadrant pour la donnée CH structurée payante.** Tous les incumbents (Moneyhouse, D&B, CRIF, Creditreform, Intrum) sont sales-led avec pricing opaque.

**Étoile polaire** : OpenSanctions (Berlin GmbH, 14 employés, centaines de clients commerciaux, 90 pays, zéro investisseur, 595 EUR/mois bulk + pay-as-you-go API). Modèle exact à imiter : **pricing public transparent, schémas open-source, MCP-first, contenu technique régulier**.

**Menace #1 12 mois** : un éditeur officiel pivote vers le dev-friendly (BFS lance API REST moderne unifiée). Mitigation : positionner sur la **valeur ajoutée normalisation + diff + SLA**, signer rapidement des early adopters payants pour stack long-term contracts.

**Menace #2 12 mois** : OpenSanctions étend sa couverture vers Swiss Companies (mirror Zefix) avec leur infra. Mitigation : aller plus profond sur des datasets non-entité où ils n'iraient pas (TARES, NOGA, charges sociales, immo parcellaire).

**Menace #3 12 mois** : un concurrent CH bien financé. Mitigation : moat distribution (SEO programmatique + MCP marketplace + awesome-lists + partenariats fiduciaires) en place avant qu'ils émergent.

---

## Estimation effort total — du plan d'aujourd'hui à 5 ventes TARES

| Phase | Durée | Effort | Output |
|-------|-------|--------|--------|
| Phase 0 — Kill Switch | 1-2j | ~6h | Site défendable, TARES vendable |
| Phase 1 — Sécurité | 2-3j | ~12h | Production-ready B2B |
| Phase 2 — Infra | 2j | ~10h | Backupé, monitoré, alerté |
| Phase 3 — Conversion | 5j | ~25h | Landing convertit + cohérences |
| Phase 4 — Distribution | 20j | ~50h cumulés | 5-10 ventes TARES, 50-100 emails newsletter |
| **Total Phase 0→4** | **~30j calendaires** | **~103h focused** | **5-10 ventes TARES, ARR 1.5-3k CHF** |
| Phase 5 — Catalogue | 60j | ~80h | 3 SKUs + 1 tier Pro, ARR M3 5-10k CHF MRR |
| Phase 6 — Scale | 90j | ~100h | Postgres, RC pro, trademark, plan B |

**Sur 10-15h/sem** (contrainte Alain UIKER) : Phase 0→2 = 2 semaines, Phase 3 = 1.5 semaine, Phase 4 = 4 semaines en parallèle. Prévoir **6-7 semaines calendaires pour atteindre 5 ventes TARES.**

---

## Verdict consolidé

openswissdata est **plus avancé que la moitié des SaaS solo founder qui annoncent un MVP**. Code 232/234 tests passants, latence 88ms p50, Stripe LIVE actif, infra R2/Resend/Railway opérationnelle, design propre, copywriting convaincant à 75%. Le projet n'a pas un problème de build — il a un problème de **finition + dérisque**.

**3 décisions structurantes** à prendre maintenant :

1. **Lancer en TARES-only** plutôt qu'attendre les 3 datasets. Un signal de marché à 5 ventes vaut mille planifications. Même à 1495 CHF de revenu, c'est la preuve qui débloquera la suite.

2. **Souscrire l'assurance RC pro avant ta première vente Pro** (300 CHF/an). C'est la condition pour réactiver la garantie 10× et vendre du tier Compliance à 1990 CHF.

3. **MCP server openswissdata est ton meilleur canal de distribution gratuit en 2026**. Tu as déjà l'expertise IBANforge. Packager `@openswissdata/mcp` en 1 jour = canal de distribution unique sur 6-12 mois (early window).

Le calendrier réglementaire LETA/UBO mi-2026 et Pillar Two 30 juin 2026 fait le travail commercial pour toi. **Si Phase 0→4 est tenue en 6-7 semaines, openswissdata atteint son premier palier (5-10 ventes) avant que la fenêtre LETA s'ouvre.** Et là, tout change.

---

## Annexes

- `docs/audit-2026-04-30/index.html` — version visuelle illustrée
- `docs/competitive-analysis-2026-04-30.md` — analyse concurrence détaillée 14 acteurs
- `docs/legal-correspondence.md` — état BAZG/BFS/FINMA
- `docs/preflight-13-legal.md` — checklist conformité
- `docs/preflight-14-stripe-live.md` — état Stripe
- `docs/launch/e2e-test-report.md` — test E2E TEST mode (à rejouer en LIVE)
