# Sauvegarde vérifiée et reprise du service

La sauvegarde de la base et la reprise complète du service sont deux preuves distinctes. Ce document décrit ce qui est contrôlé automatiquement et le travail restant pour un exercice de reprise.

## Contrôle effectué à chaque sauvegarde

Le serveur crée un snapshot SQLite cohérent pendant l’activité, le compresse et le chiffre en AES-256-GCM avant son envoi dans le stockage R2 existant. Il récupère ensuite cet objet, le déchiffre et le décompresse dans un dossier temporaire isolé. La base active n’est jamais remplacée par ce contrôle.

Un processus séparé, sans variables de connexion, compare les octets du snapshot et du fichier restauré. Il ouvre uniquement la copie restaurée, en lecture seule et sans migration. Il exécute le contrôle complet d’intégrité SQLite, vérifie les clés étrangères, les colonnes essentielles du commerce listées dans `backup-inspection.ts` et la présence des versions courantes dans la table des archives. Aucun nom, achat ou contenu de message n’est extrait dans la preuve.

Le contrôle isolé dispose d’au plus une minute. Les phases réseau partagent un budget de huit minutes ; le client abandonne sa demande après neuf minutes. Le chiffrement sur tampon demeure un travail synchrone à améliorer pour les très grosses bases. Le dossier temporaire est retiré à la fin d’un passage normal ou en erreur ; un arrêt brutal peut laisser des fichiers temporaires à examiner sur le serveur.

## Retrouver une copie validée sans la base active

Après validation, le serveur écrit et relit un témoin écrit sans remplacement dans `backups/verified/`. Ce JSON contient le nom de l’objet chiffré, sa taille, son empreinte SHA-256 et les contrôles réussis. Il ne contient pas la clé de déchiffrement ni de données clients. Le bureau privé affiche aussi le nom de la dernière copie validée.

Un objet récent dans `backups/` peut provenir d’un passage refusé. Pour une reprise, chercher un témoin, vérifier que l’objet associé existe et correspond à sa taille et son empreinte, puis refaire le déchiffrement et les contrôles. Le témoin aide à choisir un candidat ; il ne remplace pas ces vérifications. Les copies et témoins suivent le cycle de conservation de trente jours ; les originaux et archives vendues suivent leurs règles propres.

Une erreur d’élagage est distincte d’une restauration valide : la copie et son témoin restent disponibles, mais la tâche demande une reprise de l’élagage. Une incohérence de la base source conserve également la copie chiffrée pour diagnostic, sans lui attribuer de nouveau témoin de validation. Le dernier succès reste conservé dans le bureau ; un essai ultérieur échoué, interrompu ou illisible n’est pas présenté comme un nouveau succès.

## Exercice complet encore à réaliser

L’exercice doit partir d’un espace privé vide, séparé de la production, avec le code compatible et les modèles publics vérifiés. Il doit démontrer ensemble : récupération de la clé par sa procédure prévue, restauration de la base, disponibilité des archives référencées, paramètres nécessaires, accès d’un compte de test et téléchargement d’un fichier dont l’empreinte et la signature sont valides. Relever la durée et le point de sauvegarde récupérable, sans inventer d’objectif contractuel de délai ou de perte admissible.

Un démarrage normal reprend automatiquement les files de livraison et le suivi financier. Avant de démarrer une base de clientèle restaurée, isoler ces actions et rapprocher les événements postérieurs au snapshot avec Stripe et le fournisseur de messagerie : un message peut avoir été envoyé après la sauvegarde. Les tests courants utilisent exclusivement des personnes, achats, clés et stockages fictifs. Ils ne prouvent pas encore la récupération des secrets réels ni la reprise de tous les objets distants.

Ne jamais importer une sauvegarde réelle dans Git, dans un test ou dans une copie de travail publique. Les étapes qui concernent les secrets et la récupération effective restent dans la passation privée, sans clé dans ce document.
