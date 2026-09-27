# Entrées OAuth et erreurs sémantiques

Tous les POST du routeur OAuth sont lus dans une enveloppe de **16 384 octets** avant les parseurs et les opérations métier. La taille est comptée sur les octets réellement reçus, y compris un flux morcelé, une longueur absente ou une déclaration Content-Length erronée. Une requête trop grande est refusée **413 request_too_large** ; un flux interrompu ou un formulaire illisible donne **400 invalid_request**. Une longueur annoncée trop grande est refusée avant lecture ; un flux qui franchit la limite est annulé. La limite exacte reste acceptée si le contenu métier est valide. Un proxy peut aussi rejeter ou interrompre la requête avant cette réponse applicative.

Les formats déjà pris en charge sont conservés : JSON pour l’inscription, formulaires pour les autres POST. Ce lot n’ajoute pas un mode JSON au point d’émission des jetons. Les réponses du routeur, y compris l’inscription et l’autorisation, portent no-store et no-cache sur les deux montages (`/mcp/oauth` et `/oauth` sur le domaine MCP). Elles ne doivent pas être conservées par un cache partagé.

Les outils de classification et de recherche tarifaire par similarité gardent une erreur métier explicite si leur index ou leur modèle est indisponible. Le contenu est fixe et ne contient aucun message brut du moteur, chemin de fichier ou URL fournisseur. Un journal fermé identifie seulement l’un de ces deux outils, au plus une fois par minute et par outil. Cela complète le contrôle des exceptions du dispatcher ; cela ne prouve ni disponibilité des index ni fraîcheur de leur contenu.

Les tests n’utilisent que des comptes fictifs et des moteurs simulés, sans téléchargement de modèle. Aucun compte ni droit existant n’est modifié par le déploiement.

Cette limite concerne les corps OAuth, pas la fréquence globale des demandes ni leur durée de réception. La validation des autorisations, les redirections enregistrées, l’identité des comptes, les limites IP durables et le lien aux abonnements restent ouverts. Une protection de taille n’est pas une protection complète contre le déni de service. Les nouvelles souscriptions restent fermées.
