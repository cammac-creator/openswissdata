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

## Registre des effacements après une restauration

Une sauvegarde restaurée ramène les données effacées depuis sa création, et son propre registre interne s’arrête à cette date. Chaque effacement de conservation (`docs/conservation-des-donnees.md`) est donc inscrit deux fois : dans la table `retention_erasures`, dans la transaction même de l’effacement, puis dans la copie `retention/erasures.json`, à côté du fichier SQLite sur le volume. Cette copie est écrite entièrement dans un fichier temporaire synchronisé, puis renommée ; elle ne contient qu’une catégorie, un identifiant interne et une date.

Au démarrage réel, avant l’ouverture du port et des files de livraison et financière, puis à chaque nettoyage périodique, le serveur réapplique **seulement les entrées de la copie absentes de la table** : une entrée déjà en table a été appliquée dans cette même base, dans la transaction de l’effacement. Ces entrées sont traitées dans l’ordre chronologique (achats, suivi, compte), chacune bornée par sa date : une ligne postérieure à l’effacement, ou un identifiant réattribué après la restauration, reste intacte. Une entrée datée dans le futur (horloge en avance lors du passage) est ignorée et signalée. Pour un compte que la sauvegarde restaurée rattache encore à un suivi retiré hors registre (une langue effacée à la main, par exemple), le suivi antérieur à la date est d’abord effacé ; si le compte garde un achat, un rôle d’auteur ou une application MCP, l’entrée est **reportée** : elle reste dans la copie et sera retentée au nettoyage suivant.

Le rejeu n’empêche jamais l’ouverture du service. Une copie illisible, vide ou remplacée par un lien (laissée intacte, jamais réécrite), une copie impossible à écrire, une entrée reportée ou datée dans le futur rendent le témoin `operation_checks/erasure_replay` rouge et la catégorie `erasure_registry` du nettoyage en erreur ; le journal de démarrage ne donne que des codes, des catégories et des identifiants internes. Le panneau Automatisations du bureau affiche ce témoin. La synchronisation du dossier après l’écriture de la copie est faite au mieux : un montage qui la refuse (`EINVAL`, `ENOTSUP`, `EISDIR`) ne compte pas comme un échec.

Le registre rend un effacement définitif, même face à une restauration. **Annuler un effacement erroné sur Railway** (le volume n’est accessible que depuis un conteneur du service en marche) :

1. Dans les variables du service, ajouter `OSD_SKIP_ERASURE_REPLAY=1`, puis redéployer : le rejeu est suspendu au démarrage comme au nettoyage, la copie n’est ni lue ni réécrite, et le bureau l’affiche en rouge (« suspendue »).
2. Restaurer la sauvegarde voulue selon la procédure de reprise.
3. Depuis un terminal du conteneur (`railway ssh`), retirer de `retention/erasures.json` les seules entrées concernées (catégorie, identifiant interne, date), sans toucher aux autres ; si la sauvegarde restaurée les contient aussi dans `retention_erasures`, les y retirer.
4. Retirer `OSD_SKIP_ERASURE_REPLAY`, redéployer, puis vérifier le journal de démarrage et le témoin : état `ok`, rien en attente.
5. Consigner l’intervention dans la passation privée, sans donnée personnelle.

Pendant la suspension, le nettoyage continue d’appliquer les durées et d’inscrire ses effacements dans la table ; la copie les reçoit au premier passage après le retrait de l’interrupteur.

Limite : une restauration sur un volume neuf ne retrouve pas la copie. Le registre de la sauvegarde restaurée couvre alors seulement les effacements antérieurs à sa création ; les effacements plus récents doivent être réappliqués à partir d’une copie de `retention/erasures.json` conservée ailleurs, ou attendre le prochain passage du nettoyage, qui efface de nouveau ce qui a dépassé sa durée (sauf si une action ou un incident a été rouvert par la restauration). Le profil de vérification `service-retention-2026-09-29` contrôle la présence de la table dans chaque sauvegarde.

## Exercice complet encore à réaliser

L’exercice doit partir d’un espace privé vide, séparé de la production, avec le code compatible et les modèles publics vérifiés. Il doit démontrer ensemble : récupération de la clé par sa procédure prévue, restauration de la base, disponibilité des archives référencées, paramètres nécessaires, accès d’un compte de test et téléchargement d’un fichier dont l’empreinte et la signature sont valides. Relever la durée et le point de sauvegarde récupérable, sans inventer d’objectif contractuel de délai ou de perte admissible.

Un démarrage normal reprend automatiquement les files de livraison et le suivi financier. Avant de démarrer une base de clientèle restaurée, isoler ces actions et rapprocher les événements postérieurs au snapshot avec Stripe et le fournisseur de messagerie : un message peut avoir été envoyé après la sauvegarde. Les tests courants utilisent exclusivement des personnes, achats, clés et stockages fictifs. Ils ne prouvent pas encore la récupération des secrets réels ni la reprise de tous les objets distants.

Ne jamais importer une sauvegarde réelle dans Git, dans un test ou dans une copie de travail publique. Les étapes qui concernent les secrets et la récupération effective restent dans la passation privée, sans clé dans ce document.
