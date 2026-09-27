# Droits effectifs d’un jeton MCP

Chaque appel authentifié utilise l’intersection des droits enregistrés dans le jeton et des droits actuels du compte MCP. Un jeton limité à `finma:read` ne permet pas d’appeler les outils tarifaires ou l’historique, même si le compte possède un abonnement plus large.

Une baisse des droits du compte s’applique dès la requête suivante. Une montée en gamme n’élargit pas spontanément un jeton existant : un nouveau jeton doit être obtenu avec les droits voulus. Une portée vide, inconnue ou sans droit commun ne donne aucun accès aux outils exigeant une portée. Elle ne provoque pas de repli vers l’accès anonyme.

Au renouvellement, les droits conservés sont également bornés par la portée du jeton d’origine et les droits actuels du compte. Une demande explicite peut les réduire ; une portée vide, inconnue ou plus large est refusée avec `invalid_scope` avant révocation du jeton de renouvellement. Sans portée demandée, les droits encore communs sont conservés ; leur absence refuse le renouvellement. Le nouveau jeton porte cette portée réduite, qui ne remonte pas lors d’une augmentation ultérieure des droits du compte. La rotation n’a pas encore été rendue transactionnelle par ce lot.

Les quotas restent ceux du compte et une requête authentifiée continue de consommer une unité selon les règles existantes, y compris si un outil est ensuite refusé pour portée insuffisante. Les refus de jetons expirés/révoqués et de comptes révoqués sont conservés. Les trois outils anonymes restent accessibles selon leur limite propre. L’accès administrateur historique est un mécanisme distinct, à revoir séparément.

Aucune table, empreinte, clé, portée stockée ou droit d’achat n’est réécrit par ce changement. Les jetons historiques vides ou plus étroits que le compte cessent de recevoir implicitement tous les droits du compte. Les nouvelles souscriptions payantes restent fermées. Le catalogue public d’outils n’est pas une preuve d’autorisation : le contrôle s’effectue avant l’exécution.

Le principe suit la portée des jetons décrite dans [RFC 6749, section 3.3](https://www.rfc-editor.org/rfc/rfc6749#section-3.3) et la restriction des privilèges recommandée dans [RFC 9700, section 2.3](https://www.rfc-editor.org/rfc/rfc9700#section-2.3). Il ne constitue pas une validation de conformité de l’ensemble du serveur OAuth.

Les validations des formulaires d’autorisation, les redirections enregistrées, les garanties de consommation et rotation des codes/jetons, les limites publiques et le rapprochement de droits payants restent des contrôles distincts. Ne pas rouvrir les abonnements MCP avant leur traitement et une recette complète. Aucun appel avec une clé client réelle n’est nécessaire pour ces tests.
