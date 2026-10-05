# OpenSwissData : consignes des agents

Données publiques suisses (TARES, NOGA/NACE/ISIC, FINMA) vendues en fichiers signés, et serveur MCP gratuit. Dépôt GitHub PUBLIC, production Railway.

<!-- charte:osd.N01 -->
Ce fichier reste sous 200 lignes et 20 Ko : une règle de détail va dans le fichier `.claude/rules/` de son thème (index plus bas), jamais ici. Chaque section ajoutée par la charte est entourée de marqueurs `charte:<id>`.

## Où est le reste
- `CLAUDE.md` (pile technique et conventions), `README.md` (commandes), `.claude/rules/*.md` (détails par thème). Claude charge une règle seul quand il LIT un fichier concerné, pas quand il en crée un nouveau : avant de créer un fichier, lire la règle indiquée par l'index. Codex lit le fichier indiqué par l'index avant de toucher ces chemins.
- État, décisions, journal : `~/.collaboration-agents/projets/openswissdata/` (ETAT.md, DECISIONS.md, JOURNAL.md). Fiche mémoire : `~/.claude/projects/-Users-claude-alainmartin/memory/openswissdata-project.md`. Règles générales : `~/.codex/AGENTS.md`.
- Preuves et rapports privés : `docs/internal/` (ignoré par Git, jamais publié, jamais cité dans un fichier public).

## Règles dures (rappel ; le détail est dans la section ou la règle citée)
- Ne jamais pousser une branche ou une copie créée avant le 29.09.2026 14 h 40 (section « Historique Git réécrit » ci-dessous).
- Les commandes `etl:*` publient pour de vrai : jamais comme test (README).
- La référence du canari n'est jamais réinitialisée automatiquement (`.claude/rules/collectes-et-recherche.md`).
- Rapprochement exact seulement ; ne jamais nommer ni lier une entrée de la liste d'alerte dans un texte public ; un OS (LEFin) n'est jamais une affiliation OAR (règles collectes et site public).
- Aucune donnée de client, preuve privée, domaine de client ni secret dans ce dépôt public.
- Toute nouvelle piste ou activité distincte passe d'abord par Radar (`~/radar`), qui tient l'étal des projets vérifiés.

## Index des règles par chemin
| Si tu touches | Lis d'abord |
|---|---|
| `src/lib/order-*.ts`, `src/lib/delivery*.ts`, `src/lib/incident*.ts`, `src/lib/stripe*.ts`, `src/lib/checkout*.ts`, `src/routes/checkout.ts`, `src/routes/stripe-webhook.ts`, `src/routes/download.ts`, `src/legal/**`, `web/src/content/legal*.ts`, `web/src/pages/**/legal/**`, `web/src/components/CheckoutNotice.astro`, `web/src/lib/checkout-measures.ts`, `tests/routes/**`, `tests/lib/delivery*.ts`, `tests/lib/order-*.ts`, `tests/lib/checkout*.ts` | `.claude/rules/argent-et-livraisons.md` |
| `src/routes/crm*.ts`, `src/routes/admin*.ts`, `src/routes/health.ts`, `src/lib/crm-*.ts`, `src/lib/admin-*.ts`, `src/lib/deep-health*.ts`, `src/lib/translation-*.ts`, `src/lib/customer-service.ts`, `src/lib/languages.ts`, `web/src/pages/admin.astro`, `web/src/admin/**`, `scripts/check-admin-csp*.mjs`, `tests/routes/crm*.ts` | `.claude/rules/bureau-et-crm.md` |
| `src/lib/retention-rules.ts`, `src/lib/service-retention.ts`, `src/lib/cleanup*.ts`, `src/lib/erasure-registry.ts`, `src/lib/bronze-retention.ts`, `src/lib/event-retention.ts`, `src/lib/backup-*.ts`, `src/lib/readiness.ts`, `src/lib/data-paths.ts`, `src/db/**`, `src/index.ts`, `scripts/cleanup-expired.ts`, `scripts/backup-db.ts`, `.github/workflows/backup-db.yml`, `.github/workflows/cleanup-expired.yml`, `docs/sauvegarde-et-reprise.md`, `docs/conservation-des-donnees.md`, `tests/lib/retention*.ts`, `tests/lib/bronze-retention.test.ts` | `.claude/rules/conservation-et-sauvegarde.md` |
| `etl/**`, `scripts/monitor-sources.ts`, `scripts/build-search-indexes.ts`, `scripts/evaluate-search.ts`, `scripts/search-eval/**`, `scripts/record-finma-quality.mjs`, `scripts/promesses/**`, `scripts/sync-*.ts`, `scripts/notify-finma-diff.ts`, `src/mcp/data/**`, `src/mcp/search-index.ts`, `src/mcp/lexical-index.ts`, `src/mcp/name-match.ts`, `src/mcp/embedder.ts`, `src/mcp/data-loader.ts`, `src/mcp/r2-refresh.ts`, `src/mcp/tools/**`, `src/lib/embedding-*.ts`, `src/lib/model-artifact.ts`, `src/lib/tares-archive.ts`, `.github/workflows/refresh-*.yml`, `.github/workflows/release-classifications.yml`, `.github/workflows/monitor-sources.yml`, `tests/etl/**`, `tests/lba/**`, `docs/securite-dependances.md` | `.claude/rules/collectes-et-recherche.md` |
| `src/mcp/oauth/**`, `src/mcp/server.ts`, `src/mcp/rate-limit.ts`, `src/mcp/body-limit.ts`, `src/mcp/caller-class.ts`, `src/mcp/track-mcp.ts`, `src/mcp/semantic-failure.ts`, `src/routes/mcp/**`, `src/routes/auth*.ts`, `src/routes/account.ts`, `src/lib/account-session.ts`, `src/lib/session-cookie.ts`, `src/lib/login-*.ts`, `src/lib/auth-*.ts`, `src/lib/tokens.ts`, `src/lib/request-ip.ts`, `src/lib/rate-limit.ts`, `server.json`, `glama.json`, `packages/**`, `sdks/**`, `tests/mcp/**`, `web/src/pages/**/mcp*.astro` | `.claude/rules/mcp-et-comptes.md` |
| `web/**`, `scripts/check-seo.mjs`, `scripts/check-fonts.mjs`, `scripts/generate-og-image.mjs`, `scripts/atlas/**`, `src/lib/delivery-page.ts`, `src/lib/sample-measures.ts`, `tests/web/**` | `.claude/rules/site-public.md` |
| `.github/workflows/**`, `scripts/monitor-public.mjs`, `scripts/alert-email.mjs`, `src/lib/mail-watch*.ts`, `src/lib/workflow-watch.ts`, `docs/surveillance-exterieure.md` | `.claude/rules/exploitation.md` |
<!-- /charte:osd.N01 -->

<!-- charte:osd.R01 -->
## Rôles et cadre des agents
Une seule personne valide : Claude-Alain. Les agents ne le sollicitent que pour les cas BOUTON de la carte des actions.

| Rôle | Qui | Peut | Doit | Ne peut pas (mécanisme) | Ne doit pas (consigne) |
|---|---|---|---|---|---|
| rédacteur | une seule session à la fois (Claude ou Codex), dans une copie de travail `/Users/claude-alainmartin/openswissdata-<sujet>` partie de la main actuelle | lire le dépôt et la production en GET, écrire dans sa copie, lancer tests, build et simulations, ouvrir une PR en brouillon, fusionner ce qui est RELU une fois tout vert | une petite PR par sujet, le test qui prouve, la preuve en ligne collée, sa fiche de chantier à jour | lire une clé Stripe (absente du Mac), réécrire ou supprimer main (règle GitHub), toucher un chemin F2 ou F7 en exécution non surveillée (hook) | changer un prix, une CGV ou une promesse publique ; écrire à un tiers ; rouvrir Pro, MCP payant ou STATENT ; lancer `etl:*` en local ; dire « fini » sans preuve |
| relecteur | `.claude/agents/relecteur.md`, contexte neuf, lecture seule | lire le diff, rejouer tests et jeux de référence | verdict « accepté » ou « refusé », raison et ligne fautive | écrire par Write ou Edit (retirés de sa définition) | écrire quoi que ce soit par Bash, qui ne sert qu'à rejouer ; corriger lui-même, fusionner, relever du style sans conséquence |
| explorateur | `.claude/agents/explorateur.md`, lecture seule | chercher, inventorier, mesurer | citer chaque source | écrire | conclure au-delà de ce qu'il a lu |
| veilleur | scripts sans IA : veille courrier et veille des tâches (serveur), moniteur public et canari (GitHub), contrôle horaire du Mac | lire métriques, catalogue, journaux, état des tâches, contact@ en lecture seule | un message Telegram par changement d'état, un témoin minimal | écrire en production ou chez Stripe | réveiller un modèle ; envoyer une donnée personnelle d'un client vers Telegram |
| courtier | non construit (moins de cinq actions F1 à F8 attendues d'ici fin 2026) | - | - | - | - |

- Action BOUTON : la préparer par écrit dans la fiche de chantier (ce qui change, montant ou destinataire, avis), attendre la réponse écrite de Claude-Alain, puis l'exécuter et coller la preuve. Un remboursement se fait à la main dans Stripe par lui.
- Sortie « je ne sais pas » : au lieu de deviner, écrire la question dans la fiche de chantier et passer à la tâche suivante.
- Mémoire courte : en fin de session, une ligne « tenté / échoué / pourquoi » dans sa fiche de chantier. L'intégrateur, seul à modifier la fiche ETAT, la reporte dans sa section « Pièges actifs » (à créer ; dix lignes au plus ; la plus ancienne part dans JOURNAL.md).
- Modèles : par rôle, selon `~/.claude/projects/-Users-claude-alainmartin/memory/reference_modeles_par_role.md`. Aucun modèle nommé ici.
<!-- /charte:osd.R01 -->

<!-- charte:osd.A01 -->
## Carte des actions et frontière de l'argent
Les cas « ça dépend » sont ceux de la ligne BOUTON. Hors de cette ligne, l'agent avance seul et prouve.

| Niveau | Actions d'OpenSwissData |
|---|---|
| AUTO (fait et prouvé, sans attendre) | lire le dépôt, la production en GET, GitHub, contact@ en lecture seule par le CRM ; tests, build, `evaluate-search`, simulations (`TARES_DRY_RUN=1`, workflows manuels en simulation) ; PR en brouillon dans ce dépôt ; fiche de chantier ; page privée de rapport ; retirer une tâche locale (launchd) qui ne sert plus, après preuve qu'aucun autre projet n'en dépend |
| RELU (relecteur, tests et jeux de référence verts avant la mise en ligne) | fusion sur main et publication Railway après CI verte ; texte public qui ne promet rien (guides, page de test sans prix) ; adoption d'une nouvelle empreinte du canari avec la comparaison collée ; migration additive avec sauvegarde préalable ; ajouter un cas, une promesse, une source au canari, une règle qui resserre |
| BOUTON (proposition écrite, Claude-Alain décide) | F1 toute écriture vers Stripe · F2 tout diff sur un chemin financier (liste ci-dessous) · F3 variable, plan ou service Railway, domaine, création de clé · F4 message à un client, prospect, OAR, association, autorité ou annuaire ; publication npm ou registre MCP, nouvelle version d'un paquet déjà publié comprise ; texte public qui promet un prix, un délai ou une conformité · F5 toute exécution sur clé API payante (budget du projet : 0) · F6 restauration, effacement manuel, réécriture d'historique, `etl:*` réel lancé à la main · F7 retirer ou assouplir un garde-fou (workflows, `.claude/`, hook, règle GitHub, jeux de référence, référence du canari, tests qui gardent l'argent) · F8 inscription payante, acceptation de conditions, partenariat |

- Chemins F2 : `web/src/lib/offers.ts`, `src/db/seed.ts`, `web/src/components/PricingPage.astro`, `web/src/scripts/pricing.ts`, `web/src/pages/**/pricing.astro`, `src/mcp/oauth/quota.ts`, `src/mcp/oauth/scopes.ts`, `src/legal/**`, `web/src/content/legal*.ts`, `web/src/components/LegalPage.astro`, `web/src/pages/**/legal/**`, `web/src/lib/customer-care.ts`, `src/routes/checkout.ts`, `src/lib/checkout-*.ts`, `web/src/components/CheckoutNotice.astro`, `src/routes/stripe-webhook.ts`, `src/lib/stripe.ts`, `src/lib/stripe-financial.ts`, `src/lib/order-rights.ts`, `src/lib/order-legal.ts`, `src/lib/order-delivery.ts`, `src/lib/retention-rules.ts`.
- Tests qui gardent l'argent (F7) : `tests/routes/stripe-*`, `tests/routes/checkout*`, `tests/routes/delivery-contract.test.ts`, `tests/web/fiches-atlas.test.ts`, `tests/web/service-atlas.test.ts`, `tests/web/order-journey.test.ts`, `tests/lib/order-legal-version.test.ts`, `tests/etl/finma-coverage-promises.test.ts`, `tests/mcp/token-scope*`.
- Aucune clé Stripe sur le Mac. Tests, typage et build n'en ont pas besoin. Un essai local de paiement passe une clé de test éphémère à la commande, jamais écrite dans `.env`. L'application ne déclenche jamais de remboursement.
- Interprétation de F7 : ajouter un garde-fou qui resserre est RELU ; le retirer ou l'assouplir est BOUTON.
- Seule exception à F2 : supprimer `scripts/create-mcp-business-price.mjs` (osd.F01) est RELU, car cela retire un pouvoir sans rien changer à la vente.
<!-- /charte:osd.A01 -->

## Sections gardées telles quelles

## Présentation des offres
- Les nouvelles souscriptions Pro/Business sont explicitement fermées sur `/pricing` et les pages MCP FR/DE/EN ; prix conservés, formulaires retirés. Une réouverture nécessite de valider la livraison des abonnements, le contrôle `MCP_SUBSCRIPTIONS_OPEN`, `/pricing` FR/DE/EN (`PricingPage.astro`, constante `MCP_CLOSED`) et les trois pages MCP dans le même chantier.
- Sur mobile, les colonnes du héros doivent pouvoir rétrécir (`minmax(0,…)`, enfants `min-width:0`). Vérifier la géométrie réelle des textes et boutons : un `scrollWidth` correct peut masquer du contenu tronqué par `overflow:hidden`.

## Promesses publiques et droits des sources
- Les versions de l'accueil viennent du catalogue distribué à la consultation ; une panne affiche l'impossibilité de vérifier, jamais une ancienne date présentée comme actuelle. Les FAQ FR/DE/EN partagent les mêmes règles : paiement confirmé, collecte FINMA quotidienne planifiée, TARES hebdomadaire, classifications après contrôle.
- Le bundle livre les trois fichiers. Aucun accès MCP payant n'est créé par l'achat de fichiers : ne pas l'annoncer comme inclus. Les outils anonymes sont `tariff_lookup`, `kyc_check` et `cross_walk`, plus les trois outils de recherche dans la limite de l'essai ; l'historique demande des droits. Les souscriptions payantes restent fermées.
- `statent_lookup` et son CSV ont été retirés du service le 25.09.2026 faute de preuve de droits de redistribution dans le dossier. Les scopes historiques restent lisibles pour compatibilité, mais ne donnent accès à aucun outil STATENT. Ne pas remettre la source au seul motif qu'un client possède ce scope. Voir `docs/droits-des-sources.md` pour les preuves et vérifications restantes.

## Environnement et tests isolés — 26.09.2026
- Node >=22.12 ; CI/Railway sur Node 22. `README.md` décrit les commandes actuelles et les frontières entre application, ETL, données distribuées et fiches publiques.
- Les clés de test sont éphémères et passées explicitement à la signature. Aucun remplacement, même temporaire, de `packages/schemas/openswissdata.pubkey.ed25519`. Ne pas injecter une clé de test dans l’environnement global d’une collecte.
- `db:migrate` appelle le schéma et les migrations idempotentes de `getDb` ; l’ancienne migration Business manuelle n’est pas incluse. Base fictive et chemin distinct obligatoires pour les essais.
- Ne pas lancer les tests racine en même temps que `npm run build` : le build réinstalle les dépendances Astro et peut faire disparaître temporairement son tsconfig. Terminer les tests avant le build, ou utiliser deux copies distinctes.
- La CI exige des fichiers suivis inchangés après les tests. Les secrets et bases réels ne sont pas nécessaires au typage, aux tests ou au build.

## Historique Git réécrit — 29.09.2026
- Sur décision de Claude-Alain, l'historique public a été réécrit (`git filter-repo`) pour retirer cinq fichiers de contacts de prospection (394 adresses) et l'ancien secret de webhook Stripe, déjà inutile. Le code courant est resté identique (même arbre). Toutes les révisions antérieures ont changé de numéro : main d2e43c7 est devenue e304381.
- **Ne jamais pousser une branche ou une copie de travail créée avant le 29.09.2026 14 h 40** : elle réintroduirait les contacts. Repartir de la nouvelle main (`git fetch origin` puis `git reset --hard origin/main` sur un dossier sans travail en cours, ou nouvelle copie). Les branches `codex/*` locales antérieures sont concernées.
- GitHub sert encore un temps les anciennes révisions à qui connaît leur numéro ; seule son assistance peut purger ces vues. Ne citer aucun ancien numéro de ces révisions dans un fichier public.
