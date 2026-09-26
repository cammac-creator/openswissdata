# Lire les mesures du bureau

## Une période explicite

Les sélections de 7, 30, 90 et 365 jours désignent des **jours calendaires suisses, aujourd’hui compris**. Le premier jour commence à minuit dans `Europe/Zurich` ; le dernier s’arrête à l’heure du relevé, affichée dans le bureau. Les journées de changement d’heure durent 23 ou 25 heures. Le calcul ne soustrait pas des tranches fixes de vingt-quatre heures à l’instant présent.

Le serveur fournit les dates et les bornes ; le navigateur ne reconstruit pas sa propre période avec son horloge. Un instant égal à la première borne est inclus, un instant postérieur au relevé est exclu. Les totaux et les jours d’une même réponse sont lus dans une transaction SQLite. La vue Audience possède son propre relevé et ses propres indicateurs, sans mélanger un nouveau graphique avec un ancien total de la vue d’ensemble.

## Ventes et visiteurs

La somme des montants quotidiens correspond au total de la période. Les remboursements confirmés sont déduits de la commande d’origine ; les contestations ouvertes ou perdues, commandes de test et comptes internes sont exclus selon les règles existantes. Ce total n’est ni un bénéfice ni un rapprochement des versements bancaires. Les barres annuelles peuvent regrouper plusieurs jours ; leur survol donne les deux dates, et le tableau conserve chaque journée.

Les visiteurs-jours sont la **somme des estimations de chaque journée suisse**, pas des personnes uniques sur toute la période. Les identifiants enregistrés tournent à minuit UTC : cela peut compter plusieurs identifiants pour une personne au cours d’un jour suisse. La catégorie d’un navigateur est déclarative et ne prouve pas une présence humaine. Les données anciennes ne sont pas reclassées.

## Origine des traces

Chaque nouvelle trace porte une origine distincte : mesure enregistrée par l’application (`server`) ou déclaration au point d’entrée public (`client`). L’ajout de cette colonne laisse les lignes préexistantes en `legacy` : leur origine n’avait pas été enregistrée, elle ne peut pas être prouvée après coup. Leur quantité est indiquée dans la vue Audience. Un retour à une ancienne version qui ne renseigne pas la colonne produit également des lignes historiques non vérifiées.

Les nouvelles déclarations publiques ne participent pas aux pages enregistrées, même si une ligne porte ce nom en base. Le point d’entrée refuse aussi les noms réservés aux mesures internes, notamment pages, appels MCP, paiement, livraison et le préfixe `server.`. Il impose l’origine externe ; un champ JSON ou des métadonnées ne peuvent pas la transformer en mesure interne. Une origine serveur atteste une observation de l’application, pas une présence humaine, un paiement ou une livraison sans examen de l’événement concerné.

Les agents inconnus et les chaînes excessives restent non classés. Une signature de navigateur reconnue donne seulement une présomption ; robots connus et outils automatiques gardent des catégories distinctes. Une personne peut modifier cette signature. Ce changement ne prouve pas que tous les robots soient exclus et ne rend pas les anciennes catégories plus certaines.

Le corps d’une déclaration est limité à 4 Kio et ses métadonnées à 2 Kio UTF-8. Les pays déclarés doivent être deux lettres ; les référents acceptés sont des origines HTTP(S) de 255 octets au plus, sans identifiant, chemin ni paramètres. Ce format ne garantit pas leur véracité. À la lecture, un ancien pays mal formé apparaît comme inconnu ; sa trace conservée n’est pas réécrite. La limite de 60 déclarations par minute utilise l’origine du proxy Railway validée pour la connexion, sans préfixe `X-Forwarded-For` fourni librement. Elle reste locale au processus, avec une capacité de 10 000 origines et éviction de la plus ancienne ; elle ne remplace ni une limite persistante ni une défense distribuée. Le journal des échecs de mesure est générique et borné à un signal par minute, sans contenu brut.

L’ancienne API statistique conserve ses champs et ses périodes de compatibilité ; elle distingue maintenant les origines des événements personnalisés, exclut les déclarations des compteurs API/MCP et fournit une note sur les limites historiques. Les nouvelles écritures applicatives doivent choisir explicitement leur origine dans le type `TrackArgs`.

## Ce qui manque reste visible

Les événements techniques sont conservés au plus 180 jours dans les vues, même si une purge est retardée. Les commandes gardent leur conservation distincte. Le sélecteur annuel reste utile pour les ventes, sans inventer une année d’audience.

La première trace de page encore conservée est un repère de couverture, **pas la date certaine de mise en service du suivi**. Avant ce repère ou avant la limite de conservation, les jours sont « non mesurés » : le graphique ne les transforme pas en zéros. Le premier jour couvert et aujourd’hui peuvent être partiels. Une période sans trace après ce repère vaut zéro enregistrements ; elle ne prouve ni l’absence de visiteurs réels ni la disponibilité continue du site.

Google Search Console garde ses propres dates finales, décalées de trois jours et indiquées explicitement. Ses clics ne sont pas un nombre de visiteurs ou de clients. Le tableau n’en déduit pas de taux de conversion. Les événements déclarés au point d’entrée public ne sont pas des preuves d’achat ou de livraison ; les commandes restent la référence pour les achats vérifiés.

## Contrôles et suite

Les tests portent sur minuit suisse, les deux changements d’heure, les bornes exactes, les remboursements, les dates futures, la réconciliation des sommes, la conservation et l’absence de données. Les lectures quotidiennes utilisent des intervalles indexés ; aucune adresse ou ligne client n’est copiée pour les essais.

Restent à traiter séparément : origine réseau des identifiants de visite et des pays déclarés, harmonisation de leur rotation avec le calendrier, limites durables, mesure sobre des étapes commerciales et déduplication. Une source déclarative ne devient pas fiable par sa seule présence dans un graphique.
