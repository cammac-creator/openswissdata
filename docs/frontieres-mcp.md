# Frontières d’authentification MCP

La révocation vérifie l’appartenance du jeton au client authentifié directement dans la mise à jour SQLite. Présenter le jeton d’un autre client ne révoque rien et rend la même réponse vide HTTP200 qu’un jeton inconnu. Le propriétaire peut révoquer sa paire par son accès ou son refresh. Le renouvellement utilise la même primitive, avec l’identifiant de son client.

Un en-tête Authorization présent doit contenir un Bearer valide. Le schéma accepte la casse indifféremment ; un en-tête vide, malformé, de schéma différent ou trop long est refusé401, avec un défi Bearer. Il ne consomme pas le quota anonyme. Seule l’absence d’en-tête peut prendre le chemin public. La limite locale de longueur est4096caractères ; les jetons générés par le service sont beaucoup plus courts. Les réponses MCP et de révocation sont sans cache.

Une panne pendant la recherche du jeton, du compte ou du quota donne une erreur générique500, sans détail de stockage. Une exception interne d’un outil renvoie seulement l’erreur JSON-RPC générique -32603. Les journaux correspondants sont bornés et ne contiennent ni secret ni identité. Un compte révoqué ou de type inconnu est refusé avant le quota. L’ancien jeton administrateur reste distinct : il doit lui aussi être présenté comme Bearer valide et conserve uniquement les outils déclarés avec une portée.

Le registre des outils utilise une Map, sans noms hérités du prototype JavaScript. Les noms inconnus sont rejetés avant exécution. Tout outil doit avoir une portée déclarée : une omission refuse l’appel, y compris pour l’administrateur. Les huit outils actuels conservent leurs règles.

Ces contrôles suivent les principes de [révocation RFC7009](https://www.rfc-editor.org/rfc/rfc7009) et de [présentation Bearer RFC6750](https://www.rfc-editor.org/rfc/rfc6750). Ils ne prouvent pas une conformité OAuth complète. Les formulaires d’autorisation, redirections enregistrées, identité des comptes, lien aux abonnements et limites publiques restent à traiter. Les nouvelles souscriptions restent fermées ; aucune clé client réelle n’est nécessaire pour les tests.
