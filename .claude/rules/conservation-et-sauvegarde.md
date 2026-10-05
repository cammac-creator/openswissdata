---
paths:
  - "src/lib/retention-rules.ts"
  - "src/lib/service-retention.ts"
  - "src/lib/cleanup*.ts"
  - "src/lib/erasure-registry.ts"
  - "src/lib/bronze-retention.ts"
  - "src/lib/event-retention.ts"
  - "src/lib/backup-*.ts"
  - "src/lib/readiness.ts"
  - "src/lib/data-paths.ts"
  - "src/db/**"
  - "src/index.ts"
  - "scripts/cleanup-expired.ts"
  - "scripts/backup-db.ts"
  - ".github/workflows/backup-db.yml"
  - ".github/workflows/cleanup-expired.yml"
  - "docs/sauvegarde-et-reprise.md"
  - "docs/conservation-des-donnees.md"
  - "tests/lib/retention*.ts"
  - "tests/lib/bronze-retention.test.ts"
---

# Démarrage, conservation, effacements et sauvegardes (F6 : restauration et effacement manuel sont BOUTON)

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

## Disponibilité au démarrage
- Railway attend `/api/health/ready` (180 s) : trois versions enregistrées, schéma financier disponible, pages essentielles et leurs ressources présentes. Aucun appel externe dans ce contrôle ; `/api/health/deep` et `/freshness` restent distincts.
- `/api/health` prouve seulement que le processus répond. Railway ne surveille plus `/ready` après le démarrage : conserver le contrôle extérieur.
- Le volume SQLite impose une courte interruption lors du remplacement ; ce contrôle n'est pas une promesse de zéro interruption ni un mécanisme de restauration des données.
- Retour arrière : version de code compatible avec `order_deliveries`, `order_grants` et rapprochement financier obligatoire ; sauvegarde avant migration et relecture des droits après restauration. Ne jamais restaurer une ancienne base par simple rollback de code.
- Sauvegarde : snapshot cohérent → chiffrement → R2 → relecture → comparaison des octets et contrôles SQLite complets dans un processus isolé sans secrets (60 s maximum). Témoin écrit sans remplacement relu dans `backups/verified/`, lié au SHA de l’objet chiffré. `operation_checks.backup` conserve le succès, `backup_attempt` l’essai récent ; un échec d’élagage garde la copie validée et apparaît séparément. Le workflow exige ces preuves et ne publie pas la réponse privée. Les modèles et règles de reprise complète restent dans `docs/sauvegarde-et-reprise.md` ; ne pas démarrer aveuglément les files automatiques d’une base restaurée.

## Conservation périodique et preuve — 26.09.2026
- Le nettoyage toutes les six heures traite SQLite et les deux bronzes techniques dashboard/financial, même sans consultation du CRM. Commandes, preuves, droits, notes, fiches, actions et comptes n’y sont effacés qu’aux durées du 29.09.2026 ; boîtes d’origine et sauvegardes jamais.
- Seules magic_links et request_log sont des tables historiques facultatives (les liens actuels résident dans sessions). Toute erreur SQL réelle, même dans une table facultative présente, rend le passage incomplet. Les catégories indépendantes continuent ; HTTP503 et code CLI1 signalent l’échec, sans message SQL brut.
- Bronze : même frontière de trente jours calendaires UTC que la purge à la consultation ; seuls les répertoires datés reconnus sont concernés, aucun lien symbolique suivi. Les fichiers conservés ne sont ni lus ni réécrits.
- operation_checks/cleanup garde le dernier témoin minimal (dates, catégories, quantités, résultat). Le CRM expose uniquement un témoin validé ; un passage ancien ou incomplet demande vérification. Un échec d’enregistrement fait échouer la tâche.
- Courriers originaux et sauvegardes restent hors de ce nettoyage ; les notes suivent la règle des trois ans.

- Les chemins de base et bronze sont partagés dans data-paths.ts ; les connecteurs suivent la base réellement ouverte, même avec un chemin explicite différent de DATABASE_PATH. La CLI de nettoyage exige un fichier de base existant ; elle ne crée pas de base vierge.
- Précontrôle des dates avant suppression : entiers en millisecondes, cohérents avec les écritures de l’application depuis 2025. Un format historique en secondes/texte demande examen et laisse la catégorie intacte.
- Le workflow public n’affiche que les noms de catégories et statuts ; les quantités restent privées. Sa réponse brute est temporaire dans le runner, pas une sauvegarde durable. La minuterie serveur assure la relève de ce nettoyage ; un secret à portée réduite et la surveillance extérieure des pannes restent à traiter séparément.

## Durées de conservation et registre des effacements — 29.09.2026
- Décision de Claude-Alain : commandes et preuves effacées dix ans après la fin de l'année civile suisse du dernier mouvement de paiement de la commande (achat, remboursement, contestation ; réponse du 30.09.2026 ; exercice supposé calqué sur l'année civile, hypothèse retenue le 30.09.2026 faute de document contraire : si un document dit autre chose, seule `purchaseBoundary` change) ; notes, fiche, actions et langue trois ans après le dernier achat ou échange connu de la base ; compte après dix ans sans commande, une fois achats et suivi effacés. Règles : `src/lib/retention-rules.ts` (catégories `purchase_records`, `crm_records`, `customer_accounts` du nettoyage) ; frontières et limites : `docs/conservation-des-donnees.md`.
- Ancrage de la règle 1 : `MAX(orders.created_at, stripe_financial_events.created_at)` des paiements de la commande (ceux dont l'effacement retire les traces, rattachés par `stripe_charge_states`/`stripe_financial_jobs`). Date de réception de la notification : la date Stripe n'est pas gardée, la réception ne raccourcit jamais la durée. **Jamais** `orders.financial_checked_at` ni les `checked_at` du rapprochement, renouvelés toutes les six heures : plus rien ne serait effacé. Même calcul dans la règle, l'inventaire et le rejeu (`eraseOrder` : notification après la borne → commande gardée ; date sous le plancher → entrée reportée).
- « Dernier échange » = seulement ce que la base connaît (commandes, mails de livraison acceptés, clôtures d'incidents, notes, actions créées ou terminées, fiche, langue, demandes de lien ≤ 30 jours). Les courriels ne sont pas en base : n'ajouter aucune source supposée. Gardes : action ou incident ouvert (y compris clos à la main), commande non réglée (statut manuel, vérification financière, litige, livraison en cours), fiche interne, `ADMIN_EMAILS`/`CRM_INTERNAL_EMAILS`, application MCP reliée.
- Jamais de cascade : effacements explicites table par table. Un compte qui garde un achat, un suivi, un rôle d'auteur, une application MCP ou une session valide n'est pas effacé. Garder `ADMIN_EMAILS` renseigné : c'est la protection principale du compte du bureau.
- Registre `retention_erasures` (catégorie, identifiant interne, date ; ni adresse ni clé étrangère ; jamais purgé) et copie `retention/erasures.json` à côté de la base, écrite atomiquement. Au démarrage réel (avant `serve()` et les files) et à chaque nettoyage, seules les entrées de la copie absentes de la table sont réappliquées, bornées par leur date ; entrée future ignorée et signalée, compte bloqué reporté. **Jamais bloquant** (revue adversariale du 29.09) : une anomalie rend `erasure_replay` et `erasure_registry` rouges (Automatisations), le service reste ouvert. `OSD_SKIP_ERASURE_REPLAY=1` suspend la réapplication pour une intervention. Ne supprimer ni la table ni la copie, même lors d'un retour arrière ; une restauration sur volume neuf perd la copie (`docs/sauvegarde-et-reprise.md`).
- Dates antérieures au 1er janvier 2025 refusées (`timestamp_format`, rien effacé) : ne pas abaisser ce plancher. Inventaire en lecture seule : `node dist/scripts/retention-preview.js` (nombres seulement).
- Témoin à 18 catégories ; profil de sauvegarde `service-retention-2026-09-29`. Transition close le 29.09 : f34fabc servi, témoin 18/18 (nettoyage 36581136203), sauvegarde au nouveau profil (36581189776), puis workflows resserrés au seul nouveau format. Reçus d'abonnement MCP et comptes reliés à MCP hors de ces règles : à décider avant toute réouverture des abonnements. Rapport et revue : `docs/internal/audit-global-20260925/conservation-20260929/`.
