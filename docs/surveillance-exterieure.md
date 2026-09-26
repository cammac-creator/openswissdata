# Surveillance extérieure publique

Le workflow `monitor-public.yml` contrôle le service à la minute 23 de chaque heure UTC, depuis GitHub Actions. Il peut aussi être déclenché manuellement. Il continue lorsque le Mac est éteint et n’utilise aucune clé métier. Permissions GitHub : lecture du dépôt, identifiants non conservés par le checkout. Aucun appel à Stripe, Resend ou R2 ; aucune commande, livraison, purge ou sauvegarde déclenchée.

## Ce qui est mesuré

- `/api/health/ready` doit répondre HTTP 200, confirmer la base et les pages construites, et fournir une révision Git de 40 caractères hexadécimaux. Ce n’est pas une comparaison avec main : une publication peut être en cours.
- `/api/health/freshness` doit répondre HTTP 200 et annoncer une édition FINMA datée réellement existante. La sonde recalcule son âge depuis minuit UTC, exige moins de 72 heures et recoupe l’âge annoncé. Elle refuse une date future, impossible ou assortie d’un suffixe. Cette date d’édition ne mesure pas l’heure réelle de collecte ni la qualité du contenu.
- Deux lectures indépendantes, au plus 15 secondes et 32 Kio chacune, sans redirection. Une panne n’empêche pas le contrôle de l’autre point. Un résultat manquant, illisible, trop volumineux ou incohérent fait échouer le job. Le job entier est limité à trois minutes.

Les octets reçus sont conservés avant interprétation dans un bronze éphémère du runner, avec empreinte, taille, statut HTTP et indication de copie tronquée. Les fichiers sont créés sans écrasement, en accès restreint, et ne sont pas publiés comme artefacts. Une erreur de conservation invalide le contrôle. Le résumé public ne reprend que des codes fermés, dates, version de données et révision Git vérifiées, ainsi que taille et empreinte de la réponse dans le journal JSON ; aucun corps ou message d’erreur tiers brut.

## Lecture dans le bureau

Le panneau Automatisations distingue tâche suspendue, premier passage attendu, contrôle manuel, résultat en attente, échec et passage horaire ancien. Un contrôle manuel réussi ne remplace pas l’observation d’un passage horaire. Le vert exige un dernier contrôle réussi et une exécution `schedule` réussie à sa première tentative (`run_attempt = 1`), sur main, lancée depuis moins de 2 h 30, avec dates cohérentes. Une relance manuelle conserve parfois le type schedule chez GitHub : son numéro de tentative la distingue. Une lecture GitHub de plus de vingt minutes demande actualisation.

Les lectures GitHub sont mises en cache dix minutes. Cent passages de main sont consultés, puis au plus trois recherches complémentaires (un passage par tâche active absente), avec priorité au moniteur. Les collectes moins fréquentes peuvent ainsi être retrouvées lorsque le contrôle horaire occupe la fenêtre principale. Le total est borné à cinq appels par lecture, avec un renouvellement après dix minutes par processus ; les échecs sont également mis en cache. Une invalidation explicite du cache peut avancer ce renouvellement. Le quota GitHub non authentifié peut être partagé avec d’autres services sur la même IP ; une panne ou limitation reste une absence de preuve, jamais un succès. Si plus de trois tâches manquent, les autres ne sont pas consultées individuellement. La liste des workflows elle-même est limitée à cent.

L’absence de passage consulté n’est pas l’absence d’exécution dans tout l’historique. Le panneau est une lecture ponctuelle datée : il utilise l’heure reçue du serveur, pas l’horloge du téléphone, pour éviter les fausses alertes dues à un appareil décalé. Utiliser Actualiser pour renouveler les données disponibles. Un passage en cours affiche « Contrôle en attente », distinct d’un échec ; cet état peut rester affiché pendant les dix minutes du cache.

## Limites et conduite à tenir

GitHub peut retarder ou omettre une exécution planifiée sous forte charge, et désactive les tâches d’un dépôt public après 60 jours sans activité. Le choix de la minute 23 évite le début d’heure mais ne garantit pas la cadence. Ne pas créer de faux commits pour simuler de l’activité. Examiner l’état du workflow et le réactiver explicitement après diagnostic.

Les échecs sont inscrits dans GitHub. La réception d’une notification par le propriétaire n’a pas été établie et aucun nouveau canal de message n’est configuré. Un job rouge indique qu’au moins un contrôle n’est pas vérifié : ouvrir son résumé, distinguer panne réseau, indisponibilité du site et ancienne édition FINMA ; vérifier de nouveau après résolution. Un contrôle manuel confirme seulement l’instant du test. Observer ensuite une exécution horaire réelle.

La surveillance privée des sauvegardes, livraisons et autres opérations dépend encore du Mac. Ce lot ne la migre pas et n’accorde aucun accès administrateur à GitHub. Une mesure de disponibilité continue, une alerte reçue de bout en bout et un observateur de GitHub lui-même restent nécessaires pour une surveillance complète.

Sources officielles consultées le 26.09.2026 : [déclenchements planifiés GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [action checkout](https://github.com/actions/checkout). Checkout v7.0.1 est figé à sa révision observée `3d3c42e5aac5ba805825da76410c181273ba90b1` pour ce workflow, vérifiée avec `git ls-remote https://github.com/actions/checkout.git 'refs/tags/v7*'` (tags légers v7 et v7.0.1, pas d’objet annoté à résoudre) ; aucune mise à jour générale des autres actions dans ce lot.
