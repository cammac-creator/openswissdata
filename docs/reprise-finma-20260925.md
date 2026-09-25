# Reprise FINMA du 25 septembre 2026

## Changements

La collecte utilise le CSV UID officiel FINMA, sa liste d’avertissements séparée et GLEIF. Les réponses brutes datées sont conservées avant parsing. Un LEI est attribué uniquement sur un UID exact avec un résultat unique. Le statut LEI ne devient jamais un statut FINMA. Les rapprochements de noms ne produisent plus de signalement d’une institution.

Le ZIP inclut Excel, un rapport de qualité et l’historique reconstitué à partir des archives signées disponibles. Le rapport expose les champs absents et les intervalles sans collecte. Les archives déjà publiées ne sont jamais écrasées. L’API de publication vérifie la version précédente et inscrit les métadonnées dans une transaction.

La page FINMA française, allemande et anglaise lit les volumes, la date et l’échantillon depuis l’archive réellement distribuée. Le parcours conserve la langue choisie ; l’espace client donne accès au reçu Stripe et aux versions acquises même après l’expiration des mises à jour. La facture au nom d’une entreprise reste traitée sur demande avec ses informations exactes.

Les sauvegardes utilisent AES-256-GCM avec une clé dédiée conservée séparément. Chaque sauvegarde est téléchargée depuis R2, déchiffrée en mémoire et ouverte avec SQLite pour un `quick_check` avant validation. L’ancien script CLI délègue à cette voie unique.

## Exploitation

- `GET /api/health` expose la révision Railway servie.
- `GET /api/health/freshness` répond 503 si FINMA dépasse 72 heures.
- `GET /api/catalog/finma` expose uniquement des données publiques du produit.
- `GET /api/admin/operations` expose les témoins de sauvegarde, sous authentification administrateur.
- La collecte GitHub quotidienne écrit un témoin public de qualité dans `docs/data-status/finma.json`. Cette activité quotidienne évite de laisser le dépôt inactif. Les chemins surveillés par Railway excluent ce témoin pour éviter un redéploiement inutile.
- Les anciennes notifications depuis une base vide du runner ont été retirées. Un suivi client personnalisé accompagne la reprise ; un véritable historique des envois devra précéder les prochains emails de mise à jour automatiques.

## Points à poursuivre dans l’audit général

1. Actualisation et couverture des fiches FINMA statiques et des articles anciens ; les pages produit utilisent déjà les données courantes.
2. Revalidation TARES et classifications avant réactivation de leurs collectes et avant de promouvoir le bundle.
3. Recherche IA : premier chargement du modèle plus long que 30 secondes ; les abonnements MCP restent fermés à l’achat.
4. Mesure des téléchargements : les anciens liens R2 envoyés directement par email ne prouvent pas une ouverture du fichier. Ne pas présenter leur absence dans le journal comme une absence de téléchargement.
5. Tableau de bord privé : mails, clients, ventes et remboursements, audience humaine distincte des robots, visibilité et acquisition, qualité des sources, automatisations et actions prioritaires. Il doit afficher les inconnues, dates et erreurs, sans simuler des chiffres manquants.

Aucune donnée client ne figure dans cette note. Le suivi nominatif reste dans le dossier privé exclu de Git.
