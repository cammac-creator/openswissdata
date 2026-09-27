# Connexion par email et sessions — 27.09.2026

## Périmètre du lot49

Les liens de connexion de quinze minutes et les cookies de trente jours ont désormais des usages distincts, contrôlés par la même lecture pour le compte et le bureau administrateur. Une session ne peut plus être échangée comme un lien pour prolonger son accès. Un lien placé dans un cookie ne donne aucun accès.

La colonne `purpose` vaut `magic_link`, `session` ou `legacy`. Le retour d’un nouveau lien (`account` ou `admin`) est enregistré en base à sa création ; modifier la query ne change pas cette destination. Le compte revient dans sa langue FR/DE/EN. Aucun retour externe n’est accepté.

## Migration et compatibilité

Deux colonnes additives (`purpose`, `return_to`) sont ajoutées. Les anciennes lignes, propriétaires, jetons et dates restent inchangés. Seules les durées historiques exactes sont reconnues à la lecture : 900000 ms pour un lien, 2592000000 ms pour une session. Une autre durée est refusée et impose de demander un nouveau lien ; aucune attribution supposée n’est écrite en base.

L’inventaire agrégé avant publication a trouvé trois sessions actives, toutes de trente jours. Aucun jeton, email ou identifiant client n’a été extrait. La sauvegarde antérieure doit être confirmée avant publication, puis une nouvelle sauvegarde après migration.

Un retour à l’ancien code n’exige pas de retirer les colonnes et réintroduirait les anciennes confusions d’usage. Ne pas restaurer une ancienne base pour annuler ce changement : elle ferait perdre les achats intervenus depuis. Préférer un correctif compatible avec ce schéma.

## Écritures et refus

Émission, échange et déconnexion utilisent une transaction immédiate synchrone, sans réseau et sans attente de verrou ; le délai SQLite normal est restauré ensuite. L’échange lit et valide le lien, exige sa suppression effective, puis crée la session. Le cookie n’est envoyé qu’après commit. Échec d’écriture : 503 fixe, aucun cookie, aucune consommation partielle. La déconnexion d’une session reconnue exige également sa suppression effective avant d’effacer le cookie. Sans cookie reconnu (absent, ambigu ou lien), elle efface seulement le cookie local ; aucune révocation globale n’est promise. Le compte FR/DE/EN et le bureau affichent un message de déconnexion non confirmée sur erreur réseau ou réponse non réussie.

Les dates doivent être des entiers sûrs ; création future ou expiration atteinte donnent un refus. Un cookie `osd_session` doit être unique et contenir exactement les 43 caractères attendus, sans suffixe ou valeur alternative. Les cookies ambigus ne sont pas départagés par ordre. Les paramètres token et return_to répétés sont refusés avant effet.

Le cookie reste HttpOnly, SameSite=Lax et Secure en production. Les réponses de connexion et de données privées sont no-store ; les routes auth imposent no-referrer, y compris sur redirection. Aucune valeur de jeton ni diagnostic SQL brut n’est journalisé. Une adresse connue ou inconnue conserve la même réponse publique après une demande valide ; la remise du mail reste extérieure à la transaction.

Les statistiques administrateur comptent uniquement les sessions ouvertes reconnues, pas les liens en attente.

## Vérification

Tests sur bases temporaires fictives : échange et rejeu, deux appels simultanés, lien utilisé comme cookie, session utilisée comme lien, formats et doublons, bornes temporelles, retours linguistiques, migration idempotente, panne à la dernière écriture, suppression ignorée, rollback SQLite global, verrou concurrent, erreur de lecture et reprise après panne. Les fixtures des anciennes suites déclarent explicitement leur usage et adaptent leur création à l’horloge simulée. Recette navigateur sans compte réel ni mail envoyé.

## Limites et suite

Ce lot ne termine pas le consentement MCP et ne rouvre aucune offre. L’accès à un lien ou à un cookie prouve sa possession, pas une identité civile. Le GET de vérification consomme encore directement le lien : protection contre prévisualisations de mails, fixation de connexion par lien fourni par un tiers et confirmation explicite restent à traiter avant de s’appuyer sur cette session pour un consentement. Une confirmation POST liée au navigateur et protégée contre les requêtes tierces est la prochaine étape.

Les jetons de connexion restent stockés en clair comme auparavant ; un hachage et une migration dédiée restent à examiner. Aucun MFA, révocation globale ni gestion des appareils n’est ajouté. Un cookie historique détourné ne redevient pas sûr du seul fait de cette migration. La remise du mail de connexion n’est pas une file durable ; une réponse réseau perdue après commit ne permet pas de récupérer la nouvelle session avec le lien consommé. Le portail Stripe et l’identité du payeur restent un chantier distinct.

Références relues : [gestion des sessions OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) et [transactions better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function). Ces sources guident les contrôles ; elles ne constituent pas une certification de l’application.
