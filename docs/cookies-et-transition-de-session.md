# Cookies et transition de session — lot51, 27.09.2026

## Ce qui change pour la connexion

En HTTPS, compte et bureau acceptent uniquement `__Host-osd_session` : valeur aléatoire de 43 caractères, HttpOnly, Secure, SameSite=Lax, Path=/, sans Domain. Le cookie temporaire de confirmation reste `__Host-osd_login`, cinq minutes au maximum. Aucun cookie de session n’est partagé avec le sous-domaine MCP.

L’ancien `osd_session` n’authentifie plus aucune route, même si sa valeur désigne une session encore présente en base. Aucun repli, aucune copie automatique de sa valeur vers le nouveau cookie : l’en-tête Cookie ne permet pas de distinguer un ancien cookie host-only d’un cookie Domain posé par un sous-domaine. Les navigateurs anciennement connectés doivent donc demander un nouveau lien email, une fois. Les achats, droits et coordonnées ne changent pas. Les anciens liens email encore valables restent utilisables après confirmation.

Une connexion ou déconnexion réussie expire aussi l’ancien cookie host-only connu à Path=/. Des variantes Domain ou avec un autre Path peuvent subsister dans le navigateur jusqu’à expiration ; elles sont ignorées, même en doublon, et ne bloquent pas le nouveau cookie valide. Un nouveau cookie absent, mal formé ou répété ne bénéficie jamais d’un repli vers l’ancien. Le plafond global de l’en-tête reste 16 Kio ; un navigateur saturé de cookies peut nécessiter un nettoyage manuel.

Les lignes historiques restent en base jusqu’à leur purge normale. Il ne s’agit pas d’une révocation globale de tous les anciens jetons : un porteur qui connaît déjà une valeur de session valide peut encore la présenter sous le nouveau nom depuis un client HTTP. Le préfixe protège la portée des cookies dans les navigateurs qui le prennent en charge ; il ne transforme pas un jeton volé en secret sûr. Les compteurs de sessions mesurent des jetons valables, pas la présence de personnes actuellement connectées.

HTTP de développement : nom distinct `osd_dev_session`, permis uniquement sur localhost, 127.0.0.1 ou ::1 avec NODE_ENV test/development. Il n’est jamais accepté sur l’origine HTTPS. Une configuration de production non HTTPS, un protocole inconnu ou une origine non canonique échoue sans ouvrir d’accès. La même configuration d’origine sert à la confirmation, aux cookies et à la déconnexion.

## Changement de compte et renouvellement

Après confirmation du lot50, la transaction immédiate vérifie de nouveau la session courante, consomme le lien, supprime la session exacte remplacée puis insère la nouvelle. Chaque suppression/insertion doit attester une ligne. La nouvelle session porte un nouvel aléa et sa propre durée de trente jours. Les autres sessions de la même personne et les autres comptes ne sont pas révoqués.

Même compte : le renouvellement ferme également l’ancienne session sur cet appareil. Autre compte : la case explicite reste obligatoire. Si la session a changé depuis l’affichage du formulaire, le POST refuse avec 409 sans consommer le lien. GET/HEAD, Annuler et les refus ne révoquent rien.

Une panne sur la suppression du lien, celle de l’ancienne session ou la dernière insertion donne 503 sans cookie ; toute la transaction est annulée. Le lien et l’ancienne session restent disponibles pour une reprise. Aucune attente de verrou ni appel réseau dans la transaction. Les attributs des cookies sont vérifiés avant commit ; les valeurs ne sont émises qu’après succès. Une réponse perdue après commit, y compris lors d’une double soumission qui interrompt la première navigation, peut toutefois laisser l’appareil déconnecté : la révocation, elle, a eu lieu. Revenir à son espace puis demander un nouveau lien si nécessaire.

## Déconnexion

POST `/api/auth/logout` exige l’hôte et l’Origin canoniques, et Fetch Metadata same-origin lorsqu’il est présent. Origine absente/null/tiers, hôte incohérent ou contexte same-site/cross-site : 403 avant écriture ou cookie. Le navigateur émet l’Origin du fetch déjà utilisé par les pages FR/DE/EN et le bureau.

La session désignée par le nouveau cookie est supprimée en transaction avant effacement du cookie. Panne : 503 sans effacement, reprise possible. Aucun nouveau cookie valide : la réponse peut nettoyer les cookies locaux, mais ne prétend pas identifier ou révoquer une ligne historique grâce à l’ancien nom. Ce n’est pas une commande de déconnexion de tous les appareils.

## Compatibilité et vérifications

Aucune migration de schéma, réécriture des lignes historiques, modification des droits d’achat ni envoi de mail de recette. Les fixtures des routes privées utilisent maintenant explicitement un contexte HTTPS et le nouveau nom. Tests : ancien nom refusé, doublons anciens ignorés, nouveau nom strict, développement local séparé, changement/renouvellement, autres appareils préservés, rollback à chaque écriture, origine de déconnexion.

Recette réalisée sur serveur HTTPS fictif en boucle locale : Chromium, Firefox et WebKit vérifient la reconnexion, le clic, les cookies réellement acceptés/refusés, les trois langues, la fermeture de la session remplacée, la déconnexion et les reprises. Le bureau est également vérifié dans les trois moteurs, avec refus de déconnexion sur panne puis reprise. Les contrôles natifs du préfixe utilisent des origines DNS fictives interceptées (www.osd.test et mcp.osd.test), sans requête externe ; ils prouvent le traitement des cookies par les moteurs, pas le DNS ou TLS de ces domaines. WebKit automatisé ne remplace pas Mail/Gmail sur un iPhone réel. La recette publique reste anonyme : aucun compte ou achat réel provoqué.

Les CGV datées restent immuables. Seule la notice des cookies FR/DE/EN est mise en accord avec les noms et durées réellement émis.

## Retour arrière et limites

Un formulaire ouvert avant la publication peut refuser avec 409 pendant sa fenêtre de cinq minutes : l’empreinte de l’ancien cookie n’est plus reconnue. Le lien reste intact ; rouvrir le mail. La même limite vaut lors d’un retour arrière.

Un retour au lot50 réintroduirait la lecture d’osd_session et la possibilité de connexion fixée par un sous-domaine. Les nouvelles connexions __Host ne seraient plus reconnues, et les sessions supprimées par une rotation resteraient supprimées. Privilégier un correctif compatible avec le nouveau cookie ; ne pas restaurer une ancienne base pour annuler une publication.

Le préfixe dépend du respect des règles par le navigateur. Il ne couvre pas XSS sur l’origine authentifiée, vol préalable de jeton, extensions privilégiées ou contrôle du navigateur. Les jetons restent stockés comme auparavant ; MFA, gestion d’appareils et révocation globale restent distincts. Le consentement OAuth lié au titulaire, la séparation du payeur, le cycle Stripe et la livraison durable doivent être terminés avant réouverture des abonnements MCP.

Références : [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Ces références ne constituent pas une certification de sécurité.
