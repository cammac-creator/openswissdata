# Rattachement des abonnements MCP

## Limite de confiance

Une application peut être inscrite avec une adresse email qu’elle ne contrôle pas. Cette valeur ne permet jamais de récupérer les droits d’un futur achat. Le webhook ne recherche plus d’application par email et ne transforme plus une inscription gratuite en application payante.

Pour chaque nouvel abonnement reconnu, le serveur génère une application et un secret neufs. Le secret est envoyé aux coordonnées finales du Checkout signé, avec repli sur son email de préremplissage si les coordonnées finales sont absentes. Ce destinataire doit encore recevoir et contrôler la boîte ; le paiement seul ne prouve pas son identité humaine. Le compte de consultation conserve le parcours de connexion existant. Aucun `client_id` fourni dans une requête d’achat ou les métadonnées ne sert à sélectionner une application.

Ce lot ne construit pas le consentement authentifié OAuth. Il retire un chemin d’attribution dangereux pendant que les offres restent fermées. Une future association à une application existante devra prouver séparément le contrôle du compte et de cette application.

## Écriture et rejeu

Après les contrôles existants de signature, mode Stripe, règlement confirmé et devise CHF, la branche abonnement exige le mode `subscription`, un seul SKU MCP connu et des références de session, d’abonnement et de client Stripe valides. Les références développées sont réduites à leur identifiant. Un abonnement non reconnu, notamment d’un autre projet du compte Stripe partagé, ne reçoit aucun droit.

La transaction immédiate crée ou retrouve le compte, crée l’application distincte et enregistre `mcp_subscription_checkouts`. Elle ne fait aucun appel réseau. Un verrou ou une erreur annule l’ensemble et renvoie 503 avec Retry-After. Le délai SQLite est restauré. Le contrôle `inTransaction` arrête aussi une annulation globale absorbée par le suivi facultatif de langue. Retry-After ne fixe pas la cadence de Stripe, qui décide de ses reprises. La langue CRM conserve sa priorité manuelle selon le comportement existant.

Le reçu contient seulement abonnement, session Checkout, application et date. Abonnement et session sont uniques. La clé étrangère empêche de supprimer l’application en laissant une trace pendante. La table n’est pas une file de livraison et ne contient aucun secret. Elle reste après résiliation, même lorsque l’identifiant d’abonnement actif a été retiré du client : le rejeu renvoie l’application actuelle, sans nouveau droit ni mail. Une application révoquée reste révoquée.

Compatibilité : un abonnement déjà explicitement lié à une application avant ce changement est reconnu par son identifiant Stripe et reçoit un reçu à la première notification correspondante. Aucun rapprochement historique par email ni propriétaire supposé n’est ajouté. Le démarrage crée une table vide et ne modifie aucun client. Pour une première attribution sans lien conservé, la session doit porter `mcp_provisioning_version=2026-09-27`, ajouté côté serveur par ce nouveau Checkout. Une ancienne session ou une version inconnue renvoie 409 `subscription_requires_review`, sans créer compte, application ni reçu. Ce marqueur distingue les parcours, il ne prouve pas l'identité humaine. Les refus permanents demandent une vérification dans Stripe ; un rejeu ne les répare pas.

## Limites avant réouverture

- Le secret reste envoyé directement après commit. L’arrêt entre commit et envoi, le refus du prestataire ou une réponse perdue nécessitent une vérification et une réémission contrôlée. Les journaux de panne contiennent seulement la référence de session et, pour la livraison, celle de l’application, sans email, secret ni diagnostic fournisseur. Un rejeu n’envoie pas aveuglément un second secret. Il reste à créer une livraison durable et observable, avec récupération du titulaire.
- Le reçu protège un achat **déjà traité** après résiliation. Il ne règle pas une résiliation reçue avant la première notification d’achat. Un abonnement traité puis résilié avant cette migration, sans reçu et sans identifiant actif conservé, est arrêté par l’absence du marqueur du nouveau parcours. Il demande un examen et ne recrée aucun droit automatiquement. Les changements de plan désordonnés, paiements récurrents, impayés, remboursements et contestations d’abonnement demandent une lecture canonique Stripe et un suivi durable.
- L’email du compte, le titulaire authentifié et l’application sont des notions distinctes. Session, consentement CSRF, reprise des anciennes inscriptions et interface de gestion sont encore à terminer. Aucun propriétaire historique n’est déclaré vérifié.
- Le choix du niveau reste dérivé du SKU de la session signée ; la relecture canonique du prix et de l’abonnement reste requise avant réouverture. La signature seule ne démontre pas la justesse commerciale d’une session créée ailleurs sur le compte partagé.

Les fichiers vendus suivent leur propre livraison durable et leur rapprochement financier. Ce lot ne change ni ce parcours, ni les tarifs, ni `MCP_SUBSCRIPTIONS_OPEN`.

## Publication et retour arrière

Sauvegarder et vérifier la restauration avant publication, puis contrôler le nouveau schéma et une nouvelle sauvegarde. Inventaire de production uniquement agrégé, sans extraction de clientèle. Tests sur bases fictives : préinscription tierce, doublons, résiliation, révocation, verrou concurrent, panne au dernier INSERT, migration répétée et maintien des achats de fichiers.

Ne pas effacer les reçus ni restaurer une ancienne base lors d’un retour de code. L’ancien code ignore la table et réintroduit l’attribution par email ainsi que la recréation possible après résiliation. Les souscriptions doivent rester fermées jusqu’à validation complète du service ; une réouverture n’est pas la conséquence automatique de ce correctif.

## Sources techniques

La documentation Stripe décrit les [notifications en double, les reprises et l’ordre non garanti](https://docs.stripe.com/webhooks#event-ordering). Les tests de ce lot vérifient les cas explicitement décrits ci-dessus, sans assimiler le reçu à un traitement complet du cycle d’abonnement.
