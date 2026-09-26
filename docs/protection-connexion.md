# Protection des demandes de connexion

Le lien reçu par mail reste valable quinze minutes. Une limitation des nouvelles demandes ne révoque ni ce lien ni une session active. La vérification du lien et les téléchargements ne consomment pas le compteur d’envoi.

## Limites persistantes

La route `/api/auth/magic-link` utilise deux compteurs indépendants dans le volume SQLite : une demande acceptée au plus toutes les dix secondes pour une origine ; pour une adresse, au moins une minute entre demandes, avec une réserve de cinq demandes et la récupération d’une demande toutes les douze minutes. Un refus ne reporte pas l’échéance. Les compteurs sont partagés entre connexions à la même base et conservés lors d’un redémarrage du processus.

Les adresses connues et inconnues suivent les mêmes règles de comptage et les mêmes réponses générales. La réserve ne représente pas un nombre de mails livrés : elle est consommée avant l’appel au prestataire. Un échec d’envoi ne crée donc pas une boucle de tentatives gratuites. Le traitement du mail existant attend encore le prestataire ; ce lot ne prétend pas supprimer toutes les différences de durée des réponses.

Un refus renvoie `429` et une indication grossière `Retry-After: 60`. Cette indication invite à espacer les essais ; elle ne garantit pas qu’une réserve épuisée soit de nouveau disponible après une minute. Une indisponibilité du compteur renvoie `503`, sans contourner la protection. Une cause générique est journalisée au plus une fois par minute par processus, sans adresse ni erreur technique brute. Les corps de demande sont limités à 4 Kio. Les réponses de connexion, y compris les redirections, portent `Cache-Control: no-store`.

## Origine et confiance dans le proxy

Dans l’environnement Railway identifié par `RAILWAY_ENVIRONMENT_ID`, la route utilise exclusivement une valeur IP valide de `X-Real-IP`, champ fourni par son entrée HTTP selon la [documentation Railway](https://docs.railway.com/networking/public-networking/specs-and-limits). Une liste, une valeur absente ou invalide rejoint un compteur commun `unknown`. Aucun préfixe fourni dans `X-Forwarded-For` n’est considéré comme fiable.

Hors de cet environnement, la route lit l’adresse de la connexion Node ; si elle n’est pas disponible, elle utilise également `unknown`. Une nouvelle infrastructure ou un proxy placé devant Railway impose de revoir cette hypothèse. Les IPv6 sont normalisées et groupées par préfixe /64 ; une IPv4 mappée en IPv6 rejoint son IPv4. Un accès direct depuis le réseau privé Railway ne bénéficie pas de la garantie d’un en-tête réécrit à l’entrée publique. Une IP n’est jamais une preuve d’identité : le compteur par adresse conserve une défense distincte. Ces limites applicatives ne remplacent pas une protection réseau contre un déni de service.

## Données et conservation

La table `auth_request_limits` ne contient ni email ni IP en clair : la clé est un HMAC SHA-256 avec `SESSION_SECRET` et un domaine distinct par usage. Les timestamps et le budget restant accompagnent cet identifiant pseudonyme. Les variantes de casse d’un email partagent la même limite ; cela ne change pas l’identification des comptes existants.

Chaque ligne expire dès que son budget serait de nouveau entier : dix secondes pour une origine, douze minutes après une demande isolée par adresse, et au maximum une heure après épuisement de sa réserve. Les entrées expirées sont retirées par lots de 500 au plus lors des demandes, ou au prochain nettoyage périodique. Les lignes expirées restant à retirer ne consomment plus la capacité active. En l’absence de trafic ou pendant une panne, l’effacement attend donc le prochain passage. Les capacités sont séparées : 10 000 origines et 200 000 adresses actives. Leur saturation ferme les nouvelles demandes de la dimension concernée avec un 503 ; ce risque résiduel sous attaque distribuée relève aussi de la protection réseau. Une saturation des adresses ne consomme pas la capacité des origines ; une ligne active n’est pas évincée pour accepter un nouvel identifiant. Les sauvegardes chiffrées gardent leur propre durée de conservation.

La clé doit rester stable entre redémarrages. Sa rotation réinitialise de fait le rattachement aux anciens compteurs ; les anciennes lignes restent soumises à leur expiration. Sur Railway, en production et hors des modes explicites test/développement, une clé absente ou trop courte ferme cette fonction. La valeur de développement ne convient pas à des données réelles.

## Validation et limites restantes

Les tests utilisent uniquement des identités fictives et un prestataire de mail simulé. Ils vérifient la persistance, les deux dimensions indépendantes, les refus sans prolongation, la récupération du budget à la frontière exacte, la saturation, la purge et l’usage d’un lien déjà reçu après un refus.

Ce lot porte sur la demande de connexion du compte et du bureau. Les autres limites de l’API/MCP et la séparation des secrets techniques restent des chantiers distincts. Une personne peut encore déclencher des envois bornés vers une adresse qu’elle connaît et épuiser temporairement sa réserve de nouvelles demandes ; les liens reçus et les sessions actives restent utilisables, sans être révoqués par la demande suivante. Le lien peut mener à l’espace client si cette personne n’a pas choisi le retour au bureau. Il n’ajoute ni verrouillage des liens existants ni CAPTCHA, et n’annonce pas une protection complète contre les attaques distribuées.

Références de conception : [OWASP — demandes de récupération](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [OWASP — protection contre l’automatisation](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html). Les seuils ci-dessus sont un choix d’exploitation OpenSwissData, pas des valeurs imposées par ces références.
