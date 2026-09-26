# Mesures après achat dans le bureau

Le panneau « Après l’achat » de l’espace Audience lit les commandes créées pendant la période suisse sélectionnée et actuellement `paid`, dont la session commence exactement par `cs_live_`. Il exclut les comptes internes déclarés dans le CRM, `ADMIN_EMAILS` et `CRM_INTERNAL_EMAILS`, selon les mêmes règles que les ventes. Les clients sont distincts sur cette sélection. Remboursements complets, contestations et vérifications financières en attente sont exclus ; un remboursement partiel dont l’état reste payé conserve la commande.

Ce n’est pas un historique du chiffre d’affaires ni un taux de conversion. Une modification ultérieure de l’état financier modifie la sélection. Les visites, débuts de paiement, paiements échoués et liens utilisés depuis le compte ne sont pas attribués artificiellement à un achat.

## Preuves et déduplication

- Les fichiers détaillés de l’achat viennent de `order_grants`. Les trois fichiers d’un bundle comptent trois fichiers et une seule commande. Un achat sans droits détaillés est affiché dans une catégorie distincte. Une livraison pour un fichier absent des droits de cet achat est ignorée dans ces agrégats.
- Une acceptation de mail exige une livraison du même achat et fichier, état `sent`, dates entières en millisecondes et cohérentes : commande ≤ création de livraison ≤ acceptation ≤ relevé. Un état `sent` sans date fiable est écarté et signalé. Une date cohérente postérieure au relevé est distinguée : elle attend une relecture, sans être qualifiée d’incohérente. Les autres états ne deviennent pas des succès par présence d’une ancienne date.
- Les cinq catégories de commande sont exclusives et se réconcilient au total : tous les fichiers acceptés, une partie, suivi sans acceptation confirmée, aucun suivi de livraison, aucun détail des fichiers. Elles décrivent les traces présentes ; les anciennes commandes ne sont pas remises en file.
- Une autorisation par lien mail exige `download_activity.source=email`, le même achat, client et fichier acquis, création de trace postérieure à la commande, autorisation postérieure à la trace et non future. Plusieurs traces et versions ne comptent qu’une fois par commande. L’acceptation du mail et l’autorisation d’un lien restent des mesures indépendantes.
- Les traces d’accès sont retenues selon leur création, jusqu’à 180 jours. La lecture applique la même limite même si le nettoyage n’a pas encore tourné. Les anciennes commandes sont signalées ; l’absence de preuve ne prouve pas une absence d’accès. Les accès `account` restent dans la fiche client, sans affectation arbitraire à une commande.

Un mail accepté ne prouve pas sa réception. Une autorisation ne prouve pas le téléchargement complet, l’ouverture du fichier ou l’identité de la personne. Aucun envoi, paiement, remboursement, droit ou conservation n’est modifié par cette lecture.

## Exploitation

Réponse agrégée réservée à la session administrateur, `private, no-store`, sans email, identifiant individuel, référence Stripe ni lien signé. La lecture utilise le même instant et la même transaction que le reste de l’audience. Une panne de ces preuves affiche leur indisponibilité, sans rapport à zéro et sans masquer les autres chiffres Audience. La limite de conservation est partagée avec le nettoyage via `service-retention.ts`. Index additif `download_activity(order_id,created_at)` ; il n’ajoute aucune collecte et reste compatible avec un retour arrière du code. Sa création au démarrage prend brièvement un verrou d’écriture.

La sélection porte sur toute la période, sans plafond silencieux de 100 ou 1 000 commandes. Les essais de volume doivent utiliser une base entièrement fictive. Les débuts de paiement, l’attribution de visite et les marges restent des travaux distincts de la roadmap.
