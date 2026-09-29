# Durées de conservation et effacements

Décision de Claude-Alain du 29.09.2026. Les trois règles sont appliquées par le nettoyage périodique existant (`runCleanup`, toutes les six heures par la minuterie du serveur et la tâche GitHub), chacune dans sa propre transaction, sans réseau. Code : `src/lib/retention-rules.ts` ; registre : `src/lib/erasure-registry.ts` ; tests : `tests/lib/retention.test.ts`. Aucune donnée n’atteint ces durées en 2026 : rien n’est effacé avant 2036 pour les achats.

## Règle 1 : commandes et preuves (`purchase_records`)

- Durée : dix ans après la fin de l’année civile suisse de l’achat. Une commande est effacée à partir du 1er janvier, 00 h 00 heure suisse, de l’année d’achat plus onze. Exemple : un achat du 31.12.2025 à 23 h 59 est conservé jusqu’au 31.12.2035 à 23 h 59 min 59,999 s, et effacé au passage suivant. Cet ancrage couvre l’art. 958f CO (dix ans depuis la fin de l’exercice, ici supposé calqué sur l’année civile) et l’art. 127 CO (dix ans depuis l’achat).
- Seulement une commande réglée : statut `paid`, `refunded` ou `dispute_lost`, aucune contestation ouverte, toutes ses livraisons `sent` ou `cancelled`, aucun incident de livraison `open`, aucune action ouverte reliée à un de ses incidents, aucun rapprochement financier en attente pour son paiement.
- Effacement explicite, dans cet ordre : preuves de clôture et liaisons d’actions de ses incidents, journal et dossiers d’incidents, liens et traces de téléchargement de la commande, livraisons, preuve des CGV (`order_legal`), historique des droits, droits, états et notifications Stripe de son paiement (si aucune autre commande ne partage ce paiement), puis la commande. Les droits restants du client sont recalculés à partir de ses autres achats.
- Jamais le compte, ni les notes, fiches ou actions (règle 2). Les textes des CGV publiés sont des fichiers de code archivés : ils ne sont jamais effacés.
- Conséquence : l’accès du compte aux versions de cet achat prend fin. Les CGV le prévoient (« une licence perpétuelle n’est pas une promesse d’hébergement perpétuel ») ; la licence sur les fichiers déjà téléchargés n’est pas touchée.
- Hors périmètre : les reçus d’abonnement MCP (`mcp_subscription_checkouts`). Aucune souscription n’est ouverte ; leur durée est à décider avant la réouverture des abonnements.

## Règle 2 : suivi client (`crm_records`)

- Durée : trois ans, au même instant de l’horloge UTC (un 29 février devient le 28), après le dernier contact connu de la base. Un contact exactement à la limite garde les données ; une milliseconde plus tôt, elles sont effacées.
- « Dernier achat ou dernier échange » : la date la plus récente parmi la création du compte, ses commandes, ses mails de livraison acceptés par le prestataire (`order_deliveries.sent_at`), les clôtures manuelles d’incidents de ses livraisons, ses notes, la création ou la fin de ses actions, la dernière modification de sa fiche ou de sa langue, et ses demandes de lien de connexion encore enregistrées (30 jours au plus).
- La base ne garde pas les courriels : la boîte est lue en direct et ses copies techniques expirent après 30 jours. Un mail qui n’a pas été consigné dans une note ne prolonge pas le délai. Les téléchargements ne sont pas des échanges.
- Jamais pendant : une action ouverte du client ; un incident de livraison `open`, y compris un dossier clos à la main que la machine garde ouvert ; une action ouverte reliée à ses incidents ; une commande `disputed` ou `financial_pending` ou une contestation ouverte ; une fiche interne (`internal=1`) ; une adresse de `ADMIN_EMAILS` ou `CRM_INTERNAL_EMAILS` ; un compte relié à une application MCP, même révoquée.
- Effacement : liaisons d’actions aux incidents, actions, notes, fiche et langue du client (`crm_languages` suit la fiche). Jamais ses achats, preuves, livraisons ni incidents.

## Règle 3 : compte client (`customer_accounts`)

- Condition : compte créé il y a plus de dix ans (même calcul d’années que la règle 2), sans aucune commande, droit ni suivi restants, sans rôle d’auteur (note, preuve de clôture, action d’incident), sans application MCP reliée, hors `ADMIN_EMAILS` et `CRM_INTERNAL_EMAILS`, et sans session encore valide. Comme la règle 1 garde toute commande des dix dernières années, « aucune commande restante » implique « aucune commande depuis dix ans ». Le compte attend donc la fin de la règle 1 et de la règle 2, sans jamais les devancer.
- Effacement : sessions, liens de téléchargement, traces de téléchargement, rattachement des statistiques (`events.customer_id` remis à NULL), puis la ligne du client. Un compte qui garde un achat provoque une erreur, jamais une cascade.

## Registre des effacements

- `retention_erasures` : catégorie (`purchase_order`, `crm_records`, `customer_account`), identifiant interne, date de l’effacement. Aucune adresse, empreinte d’adresse ni contenu ; aucune clé étrangère ; jamais purgé. Écrit dans la transaction de l’effacement.
- Copie hors base `retention/erasures.json`, à côté du fichier SQLite, synchronisée à chaque passage (catégorie `erasure_registry` du témoin). Rejouée au démarrage réel avant l’ouverture du service : voir `docs/sauvegarde-et-reprise.md`.
- Le rejeu est borné par la date : une ligne postérieure à l’effacement, ou un identifiant réattribué après une restauration, n’est pas touchée. Limite : un recul important de l’horloge du serveur après un effacement pourrait faire traiter comme antérieure une ligne créée ensuite.

## Témoin et erreurs

- Quatre catégories rejoignent le témoin `operation_checks/cleanup` : `purchase_records` (unité commandes), `crm_records` et `customer_accounts` (unité clients), `erasure_registry`. Un ancien témoin à 14 catégories n’est plus reconnu : la minuterie refait un passage 30 secondes après le démarrage.
- Précontrôle des dates avant chaque règle : toute date non vide doit être un entier en millisecondes. Sinon `timestamp_format`, rien n’est effacé dans la catégorie. Une erreur SQL annule toute la règle (`database_error`), sans message brut ; les autres catégories continuent. Une copie du registre impossible à écrire donne `storage_error`.

## Publication, sauvegarde et retour arrière

- Avant la première publication : sauvegarde vérifiée. La table est additive ; aucune ligne existante n’est modifiée par la publication elle-même.
- Deux workflows figent encore l’ancien état : `cleanup-expired.yml` (14 catégories exactes) et `backup-db.yml` (profil `service-crm-2026-09-29`). Les faire accepter l’ancien et le nouvel état avant de publier le serveur, puis seulement le nouveau une fois le SHA servi vérifié.
- Retour arrière : l’ancien code ignore la table et la copie, sans erreur, mais n’applique plus les durées ; ne supprimer ni la table ni `retention/erasures.json`. Une donnée effacée ne revient pas par un retour de code ; elle ne revient que par une restauration, que le rejeu corrige au démarrage suivant d’une version compatible.
