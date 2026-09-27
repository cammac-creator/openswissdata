# Protection des demandes de paiement

Le formulaire `/api/checkout/start` et l’API `/api/checkout/session` acceptent au plus une demande toutes les six secondes par identité réseau. Le délai reste celui du service historique. Il s’applique aussi aux demandes mal formées ou aux erreurs Stripe ; un refus ne le prolonge pas. Les tarifs, paramètres Stripe, contrats, droits et réponses de succès restent inchangés.

## Identité et stockage

Sur Railway, seule l’adresse valide du champ `X-Real-IP` réécrit par le proxy est utilisée. Ailleurs, l’adresse de la connexion réelle est requise ; les en-têtes déclarés ne la remplacent pas. Le premier `X-Forwarded-For` n’est jamais une autorité. Les IPv4 mappées sont unifiées, les IPv6 regroupées par /64. Une adresse absente ou invalide partage l’identité `unknown`, ce qui peut limiter ensemble plusieurs appels mal identifiés.

SQLite conserve une clé HMAC-SHA256 dédiée à Checkout, distincte de la connexion, et les dates d’acceptation/expiration en millisecondes. Aucun email, adresse brute, panier ou identifiant Stripe n’entre dans cette table. Ce sont des pseudonymes, pas des données anonymes. `SESSION_SECRET` doit exister et compter au moins 16 caractères en production ou sur Railway ; une rotation change les identités et réinitialise de fait leurs limites. La clé de développement reste strictement locale.

La transaction `BEGIN IMMEDIATE` garantit le partage entre deux connexions à la même base. Une reprise de processus ne remet pas le délai à zéro. Ce n’est pas une limite distribuée entre bases indépendantes ni une défense complète contre une attaque provenant de nombreuses adresses. Plusieurs personnes derrière la même adresse partagent le délai.

## Refus et bornes

- HTTP 429 et `Retry-After` indiquent les secondes restantes arrondies au supérieur, entre une et six.
- Clé absente, horloge incohérente, capacité pleine ou base indisponible : HTTP 503 générique avant tout appel Stripe. Le diagnostic interne reste fermé et sans donnée de requête.
- Dix mille lignes au maximum, sans remplacer les protections actives. Jusqu’à 500 lignes expirées sont supprimées lors d’une nouvelle acceptation ; en cas d’échec de la transaction, ces suppressions sont annulées aussi.
- Les corps sont bornés à 4 096 octets avant décodage, avec ou sans longueur annoncée. Un dépassement retourne 413. Aucun appel Stripe pour les refus de protection.
- La protection ne patiente pas pour un verrou d’écriture SQLite, afin de ne pas immobiliser le serveur. Le délai SQLite antérieur est rétabli immédiatement après la transaction, y compris en cas d’erreur.
- Toutes les réponses Checkout portent `Cache-Control: no-store`. Pour un formulaire demandant du HTML, les refus 400/413/429/503 gardent leur statut et présentent un avis FR/DE/EN sans script, retour aux offres et contact support. La page locale d’origine détermine la langue, sinon la préférence du navigateur ; aucun corps surdimensionné n’est décodé pour choisir la langue. Les clients API continuent de recevoir du JSON.

Un refus temporaire du stockage privilégie l’absence de création Stripe dont le contrôle n’aurait pas pu être conservé. Il peut donc empêcher momentanément un achat légitime. Les erreurs après une création Stripe et l’incertitude réseau ne sont pas résolues par cette limite ; aucune relance automatique ni remboursement n’est ajouté.

## Conservation et reprise

Le compteur cesse d’être utile six secondes après l’acceptation. Sa suppression physique intervient lors d’une purge de requête ou du nettoyage périodique (normalement toutes les six heures, sous réserve de fonctionnement du service). Le témoin complet passe à 14 catégories ; un ancien témoin sans Checkout ne prouve pas cette nouvelle purge. Les sauvegardes chiffrées suivent leur propre cycle de conservation.

Le schéma ajoute `checkout_request_limits` sans modifier les achats ni les droits. Une sauvegarde validée doit précéder sa première publication, puis une restauration isolée et le témoin de nettoyage doivent être contrôlés. Le profil `service-crm-2026-09-26` reste celui des tables métier essentielles : il ne certifie pas la présence des compteurs temporaires de connexion ou de paiement. Une ancienne sauvegarde peut les recréer vides au démarrage ; elle réinitialise alors leur délai. Ce fait ne modifie pas les preuves d’achat conservées.

En retour arrière, préférer un code qui conserve cette protection et sa purge. Une ancienne version peut encore lire les tables métier mais ignore le compteur Checkout ; elle perd sa limite durable et son nettoyage. Ne pas restaurer une ancienne base pour revenir à une version de code.

Les tests utilisent uniquement des bases et réponses Stripe fictives, y compris pour les demandes concurrentes, pannes, dates, capacité et redémarrage. Aucun contournement global lié à `NODE_ENV=test` n’existe dans la protection Checkout.

## Limites et surveillance restantes

Le service web utilise une connexion SQLite singleton pour les requêtes, workers et nettoyages par HTTP. Les contrôles de restauration ouvrent une copie isolée en lecture seule. Une CLI de maintenance exécutée séparément sur la base réelle, ou un chevauchement de processus, peut toutefois occuper le verrou ; le refus 503 reste intentionnel et le journal distingue `busy`. Une horloge reculant avant la dernière acceptation bloque cette identité jusqu’au rattrapage.

Une attaque distribuée utilisant assez de réseaux peut saturer les dix mille places et provoquer des refus légitimes. La protection réseau globale, les alertes spécifiques de saturation et les autres routes publiques/MCP restent des travaux distincts. Les erreurs API déjà observables dans le bureau et le journal ne prouvent pas qu’une alerte externe sera reçue. La cadence du moniteur public reste à surveiller ; il ne crée jamais de session Stripe pour tester les achats.

Ne pas activer un proxy Cloudflare/CDN devant Railway sans revoir et revalider `trustedRequestIp` depuis deux réseaux distincts. Un double-clic peut remplacer la première navigation vers Stripe par le refus de la seconde ; l’avis permet de revenir aux offres, mais ne récupère pas une session déjà créée et ne prétend pas qu’un paiement a ou n’a pas eu lieu.
