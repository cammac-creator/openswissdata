# Authentification des clients OAuth

Les routes de jeton (code ou renouvellement) et de révocation partagent le même lecteur d’identifiants. Une demande fournit soit un en-tête Basic, soit les deux champs `client_id` et `client_secret` du formulaire. Un en-tête présent, même vide ou invalide, ne se replie jamais sur le formulaire. Présenter un en-tête avec l’un de ces deux champs est refusé `400 invalid_request`, y compris si les valeurs coïncident.

Basic accepte la casse indifféremment et un ou plusieurs espaces après le schéma. Il exige un Base64 canonique avec son remplissage, un UTF-8 valide et un séparateur. Chaque composant est décodé une seule fois selon l’encodage de formulaire OAuth. Les contrôles, valeurs vides et identifiants de plus de 2 048 caractères sont refusés ; l’en-tête est limité à 4 096 caractères. Les identifiants générés par OpenSwissData sont nettement plus courts. Aucun secret dans l’URL n’est utilisé pour s’authentifier.

Une erreur d’authentification donne `401 invalid_client` avec un défi Basic ; une ambiguïté de méthode ou un formulaire répété donne `400 invalid_request`. Les réponses restent sans cache et ne recopient pas la valeur reçue. Les formulaires URL-encoded et multipart à valeurs uniques restent acceptés. Un paramètre répété, même identique, un champ de type tableau ou un fichier multipart est refusé avant effet, sur les trois routes qui lisent un formulaire OAuth.

Les preuves couvrent émission, rotation et révocation sur SQLite fictif : les refus ne consomment ni code ni jeton ; Basic et formulaire valides restent utilisables. Un marqueur de révocation égal à zéro reste une révocation. Aucun schéma, secret existant ou droit client n’est réécrit.

Références : [RFC 6749, sections 2.3 et 2.3.1](https://www.rfc-editor.org/rfc/rfc6749#section-2.3.1), [RFC 7617, section 2](https://www.rfc-editor.org/rfc/rfc7617#section-2). Un client ne doit pas combiner plusieurs méthodes ; l’encodage OAuth des composants précède leur assemblage en Basic. Le refus des paramètres répétés évite de choisir silencieusement une valeur.

Ce lot ne clôt pas le chantier OAuth : identité de l’utilisateur, redirections enregistrées, formulaires d’autorisation, lien aux abonnements, fréquence/durée des requêtes et familles de jetons restent distincts. Les abonnements restent fermés. Une intégration qui mélangeait Basic et champs du formulaire doit choisir une seule méthode ; ce comportement ambigu n’est pas conservé.
