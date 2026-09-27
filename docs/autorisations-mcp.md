# Autorisations MCP et destinations de retour

## Périmètre du 27 septembre 2026

L’application OAuth enregistrée, le titulaire humain et le compte payeur sont trois notions distinctes. Ce lot valide les paramètres et la destination d’une connexion d’application confidentielle. Il ne fournit pas encore une authentification du titulaire ni une preuve de consentement liée à sa session. Le POST de décision reste appelable directement ; il ne suffit pas à obtenir un jeton, qui exige le secret de l’application et le vérificateur PKCE. Ne pas présenter cette étape comme une autorisation personnelle authentifiée ni rouvrir les abonnements sur cette seule base.

## Inscription et compatibilité

`POST /oauth/register` exige désormais `redirect_uris`, liste de 1 à 10 URL distinctes, en plus de `name` et `email`. Les URL sont persistées dans `mcp_client_redirect_uris` dans la même transaction que le client. Les erreurs ne renvoient aucune valeur fournie dans un diagnostic Zod. L’offre reste gratuite quelle que soit la valeur `tier` demandée.

Chaque URL est absolue, canonique, sans fragment, identifiants intégrés, espace, antislash ou contrôle. HTTPS est permis ; HTTP seulement sur `localhost` ou `127.0.0.1`. La comparaison porte sur la chaîne entière, port et query compris. Aucun joker, sous-domaine implicite, changement de chemin ou variation de port n’est accepté. Les paramètres de réponse OAuth réservés sont refusés dans l’URL enregistrée. Le serveur ne visite jamais ces destinations.

Les adresses IPv6 littérales sont refusées dans ce lot, car elles ne sont pas des sources CSP interopérables pour une redirection de formulaire. Les clients publics/natifs sans secret, leurs schémas privés et l’exception de port dynamique de boucle locale ne sont pas pris en charge par ce service confidentiel. Une extension devra traiter leur enregistrement et leur preuve d’identité ensemble ; ne pas généraliser la comparaison de préfixes pour les accepter.

La table est additive et initialement vide sur une ancienne base. Aucune adresse n’est déduite d’un email, d’un ancien code ou d’une requête non authentifiée. Les jetons déjà émis et leur renouvellement gardent leurs droits ; un nouveau code exige une liste configurée. Les anciens codes `plain` ne sont plus échangeables. Relever les usages actifs avant publication et sauvegarder la base.

Une application existante configure sa liste par `POST /oauth/redirect-uris`, formulaire avec `redirect_uris` contenant un tableau JSON. Authentification par Basic **ou** `client_id` + `client_secret` dans le formulaire, selon les mêmes règles exclusives que `/token`. Le client doit être non révoqué. La liste est remplacée intégralement et atomiquement ; les droits, tarifs, emails et jetons ne sont pas modifiés. Un code lié à une destination retirée devient non échangeable. Cette route ne repose jamais sur l’email déclaré ni sur un cookie du navigateur.

Les routes existent aussi sous `/mcp/oauth` sur le domaine principal. Exemple de corps d’inscription fictif :

```json
{"name":"Application de démonstration","email":"demo@example.test","redirect_uris":["https://client.example.test/callback?source=demo"]}
```

## Affichage, décision et échange

GET et POST utilisent le même validateur : `response_type=code`, client actif, destination enregistrée, méthode explicitement `S256`, challenge SHA-256 canonique de 43 caractères. Portée absente : droits actuels du client ; portée explicite : valeurs connues et autorisées, séparées par une espace. Une portée vide, inconnue ou supérieure aux droits est refusée, sans correction silencieuse. Query et formulaire répétés sont refusés ; les valeurs et longueurs sont bornées. `state` reste opaque, conservé sans nouvelle interprétation ; les contrôles et valeurs excessives sont refusés.

La décision accepte uniquement `allow` ou `deny`. Dans les deux cas, le client et la destination sont revérifiés avant toute redirection. Validation et insertion du code sont dans une transaction immédiate sans réseau ni attente asynchrone. La query enregistrée est conservée et ses octets sont préservés ; seuls les nouveaux paramètres de réponse sont encodés avec `URLSearchParams`. Une destination invalide produit une erreur locale sans `Location`, y compris pour un refus.

L’échange du code recontrôle la destination toujours enregistrée, le client, la méthode S256, le secret et le vérificateur, puis consomme le code dans la transaction d’émission existante. Un refus ne le consomme pas. Les formulaires pointent vers leur montage réel ; la page présente l’adresse de retour. Réponses sans cache, politique de référent `no-referrer`, scripts interdits sur l’autorisation, formulaires de même origine avec la seule origine de retour validée permise pour la redirection, et intégration en cadre interdite. Les en-têtes spécifiques sont réappliqués après ceux du serveur général.

## Retour arrière et réserves

Ne pas restaurer une ancienne base pour revenir au code précédent. La table additive peut être conservée ; l’ancien code l’ignore, donc un retour arrière réintroduirait les défauts de validation. La sauvegarde complète conserve ses lignes ; l’intégrité SQLite et les clés étrangères sont vérifiées globalement. Le profil historique de restauration ne constitue pas à lui seul une recette de ce parcours : un essai fictif dédié vérifie la persistance des destinations.

À terminer en priorité : identité humaine et session de consentement, séparation du payeur (le rapprochement historique par email déclaré ne vaut pas une identité prouvée), limitation durable de fréquence et de durée, protection contre les rejeux de familles de jetons, clients publics/natifs et compatibilité externe. Aucun achat de fichier ne vaut abonnement MCP. Les nouvelles offres restent fermées.

## Références

- [RFC 9700, sections 2.1 et 4.1.3 : comparaison des destinations et protection du parcours](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1).
- [RFC 7591, section 2 : métadonnées et destinations déclarées à l’inscription](https://www.rfc-editor.org/rfc/rfc7591.html#section-2).
- [RFC 8252, section 7.3 : cas distinct des applications natives et ports de boucle locale](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3).
- [RFC 7636, section 4 : challenge et vérificateur PKCE](https://www.rfc-editor.org/rfc/rfc7636.html#section-4).

Ces contrôles ciblés ne constituent pas une certification complète de conformité OAuth ou MCP.
