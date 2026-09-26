# Demandes d’échantillons

Le panneau Audience distingue les réponses CSV préparées par le serveur, les demandes de navigateurs présumés et les visiteurs-jours estimés. Il ne les rattache à aucun client ou achat. Les demandes répétées sont comptées plusieurs fois ; les consultations JSON des fiches produit, les requêtes HEAD et les réponses en erreur sont exclues.

## Enregistrement

- Les trois routes `/api/catalog/finma`, `/api/catalog/tares` et `/api/catalog/classifications` produisent `sample_served` après un GET `format=csv` réussi en HTTP 200 et `text/csv`. Une réponse issue du cache applicatif reste une nouvelle demande.
- Origine `server`, type `conversion`, schéma 1 et identifiant fermé du produit. Ce type technique d’événement ne signifie pas qu’un paiement a eu lieu. Le point d’entrée des événements publics refuse ce nom, y compris avec une casse différente.
- Aucun identifiant client, email, référence Stripe, URL, référent, adresse IP ou agent utilisateur brut n’est ajouté à cette trace. Les paramètres supplémentaires de l’URL ne sont pas conservés dans l’événement. Les mesures API existantes restent distinctes.
- Le pseudonyme quotidien HMAC et la classe d’agent réutilisent les règles existantes. Un navigateur déclaré peut être un robot. Les requêtes techniques peuvent apparaître parmi les outils automatisés.
- File facultative, budgets existants et conservation de 180 jours. Aucune nouvelle table ni politique de conservation. Une panne d’écriture ne bloque pas l’échantillon ; les pertes connues apparaissent dans l’état de collecte général, sans ventilation par produit.
- Ces statistiques partagent le budget des autres mesures facultatives. Les preuves financières et de service restent dans leurs tables transactionnelles (`orders`, `order_legal`, `order_deliveries`, `download_activity`) et ne passent pas par cette file. Les noms financiers réservés ne sont actuellement pas utilisés pour écrire des événements. Une rafale peut perdre des statistiques, jamais une preuve d’achat par épuisement de ce budget.

## Lecture

Les agrégats sont accessibles uniquement à la session administrateur, sans cache public. La période suit le calendrier suisse et s’arrête à l’instant du relevé. La conservation est calculée à cet instant, même pour une période antérieure. Les traces futures, mal datées, de schéma inconnu, corrompues, déclarées par un client ou sans origine serveur sont exclues.

Seuls les pseudonymes `v2:` valides de navigateurs présumés participent aux visiteurs-jours. Leur total est dédupliqué entre produits ; la somme des lignes peut donc être supérieure. Les demandes sans identifiant restent visibles. Si aucune des demandes de navigateurs ne possède un identifiant exploitable, l’estimation vaut `null`, affichée « — ».

La première trace encore conservée n’est pas une date d’activation et ne prouve pas une collecte complète depuis cette date. Zéro trace ne signifie pas zéro demande historique. Un HTTP 200 ne prouve ni réception du fichier, ni ouverture, ni identité du lecteur. Aucun taux de conversion ou abandon de paiement n’est calculé à partir de ces chiffres.

La route CSV impose actuellement `Cache-Control: no-store`. Seules les réponses de l’origine sont observées : un futur cache intermédiaire qui servirait directement les fichiers, ou une réponse conditionnelle 304, n’apparaîtrait pas dans ce compteur. L’interface ne propose que des périodes glissantes se terminant au moment du relevé.

## Exploitation

Les lectures utilisent l’index existant sur nom et date. Le panneau isole ses erreurs et laisse les autres mesures disponibles. Les tests utilisent des archives et bases entièrement fictives. Une vérification sur le site réel doit se déclarer comme outil automatisé ; ne pas fabriquer une visite humaine ou une vente pour valider le compteur.

Un retour arrière laisse seulement des événements supplémentaires que les anciennes versions savent conserver et purger. Les anciens compteurs ne doivent pas être remplis rétroactivement. Le suivi du début de paiement reste un chantier séparé.
