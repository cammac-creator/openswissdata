# OpenSwissData — reprise autorisée

SaaS B2B de jeux de données fédéraux suisses normalisés : TARES, NOGA, FINMA.

## État

**Reprise autorisée le 25.09.2026 par Claude-Alain**, après un premier achat externe. Qualité FINMA et premier suivi remis en état. Ordre confirmé ensuite : CRM/dashboard, puis audits approfondis du projet. Le tableau de bord demandé ensuite doit réunir clients, mails, ventes, fréquentation, visibilité et automatisations dans une interface agréable et adaptée au téléphone. Les données de clientèle restent privées.

Le gel du 26.06.2026 est levé pour ce périmètre. Toute activité distincte passe d'abord par Radar
(`~/radar`), qui tient l'étal des projets vérifiés : c'est là qu'il choisit ce qui se construit.

## Où est le reste du contexte
- `CLAUDE.md` (à côté de ce fichier)
- Fiche mémoire : `~/.claude/projects/-Users-claude-alainmartin/memory/openswissdata-project.md`

- Règles générales de travail avec Claude-Alain : `~/.codex/AGENTS.md`

## Bureau privé (/admin)
- Connexion administrateur existante par lien email et cookie HttpOnly, réservée à `ADMIN_EMAILS`. Aucun secret dans une URL, du HTML statique ou un stockage navigateur.
- Les routes `/api/admin/crm/*` exigent cette session. Toute écriture exige l’origine canonique et l’en-tête CSRF de l’interface.
- Les ventes excluent le mode test, les remboursements et les adresses administrateur/comptes internes. `amount_chf` est historiquement stocké en centimes.
- Les visites de pages sont distinctes des appels API. Les visiteurs-jours ne sont pas des personnes uniques sur une période ; robots et outils connus sont séparés.
- Connexions existantes : Resend pour les envois, GSC en lecture seule pour la visibilité. Réception Infomaniak : boîte `contact@openswissdata.com` et messages OpenSwissData de la boîte personnelle autorisée par `CRM_PROJECT_MAILBOX`, connexion explicite depuis le bureau, mot de passe chiffré dans SQLite. Aucun envoi automatique par le CRM. La recherche dans la boîte personnelle est restreinte côté IMAP à l’objet/corps mentionnant OpenSwissData ou aux échanges avec son domaine ; ce filtre est revérifié avant la lecture du corps d’un message.
- Bronze de traitement des connecteurs : sous le volume, chiffré avec une clé dérivée de `OSD_BACKUP_KEY`, dédoublonné par empreinte et jour, purge après environ 30 jours par journée UTC, plafond 250 Mo. `runFullCleanup` traite les deux compartiments et conserve un témoin privé validé, avec échec explicite par catégorie. La tâche GitHub déclenche toutes les six heures ; la minuterie du serveur vérifie après 30 secondes puis tous les quarts d’heure si le dernier succès a six heures, et réessaie après une heure en cas d’échec. Elle démarre uniquement dans le point d’entrée réel, jamais dans `createApp()`. Une panne serveur suspend sa minuterie ; une désactivation GitHub ne l’arrête pas. La purge à la consultation demeure un complément. Ce sont des copies de traitement, pas une sauvegarde complète des boîtes. Ne pas modifier les fichiers ; les originaux restent chez leurs fournisseurs.
- Aucun cookie, corps de requête, paramètre de lien d’accès ni mot de passe dans Sentry. Les traces de requêtes sont exclues des rapports d’erreurs.

## Langues du CRM
- La valeur historique `customers.locale = fr` n’est pas une préférence confirmée. `crm_languages` garde séparément le choix CRM ou la langue de la page d’achat ; aucun remplissage rétroactif supposé. Le choix CRM prime sur les achats suivants.
- Détection locale indicative dans le nouveau texte, sans utiliser les citations pour deviner la langue du correspondant. Les objets de mails ne fournissent qu’une estimation. Les textes trop courts restent à confirmer.
- Traduction de lecture sur le serveur existant, modèles OPUS-MT anglais→français (Apache-2.0) et M2M100 418M pour les autres langues (MIT), poids ONNX publics à révision figée téléchargés à la construction. Aucun texte transmis à un fournisseur de traduction, aucun résultat persistant. Un seul processus séparé, délai maximal 180 s par lot, arrêt en fermant le message ; original toujours disponible.
- Les mails transactionnels existent en FR/EN/DE ; une préférence différente donne un repli anglais, annoncé dans la fiche. Le CRM n’envoie pas de réponse au client.

## Livraisons des achats de fichiers
- Le webhook confirme le paiement, la devise CHF et le mode Stripe avant d'accorder les droits. Une remise totale validée par Stripe reste livrable. Les paiements différés attendent leur confirmation.
- Commande, droits et `order_deliveries` sont enregistrés ensemble. Le worker reprend les nouveaux achats chaque minute ; aucune ancienne commande n'est remise en file automatiquement.
- Le corps du mail est figé avant son premier envoi, avec une clé Resend fondée sur la session Stripe. Après 23 h d'incertitude : état `review`, contrôle humain dans le prestataire avant tout nouvel envoi. Les corps sont effacés après remise, annulation ou passage en vérification.
- Les liens des mails et nouveaux liens de partage passent par une confirmation GET, puis un téléchargement POST. Un double clic est toléré pendant 90 s à compter de la première utilisation, sans prolongation. Aucun jeton dans les événements d'audience.
- Retour arrière : consulter d'abord les livraisons en attente dans le CRM. L'ancien code ne traite pas cette file ; un retour arrière impose de conserver les lignes et de reprendre leur traitement avec une version compatible.
- Ce mécanisme concerne les achats de fichiers. La livraison des clés d'abonnement reste un chantier distinct.

## Remboursements et contestations des fichiers
- Notifications Stripe signées enregistrées en file, dédoublonnées ; relecture canonique du paiement, de toutes ses pages de remboursements et de contestations, via un compartiment bronze chiffré distinct des mails (30 jours, 64 Mo). Version API Stripe figée sur celle du SDK. Aucune opération de remboursement déclenchée par l'application. Reprise chaque minute, relecture de contrôle toutes les six heures ; incidents visibles dans Automatisations.
- Seuls les remboursements `succeeded` sont déduits. Remboursement partiel : droits conservés, montant net dans le CRM, examen commercial dans Stripe. Remboursement complet : droits de cet achat retirés. Contestation ouverte : suspension ; perdue : retrait ; gagnée : restauration des droits acquis. Une simple demande d'information bancaire ne suspend pas les droits.
- `order_grants` garde la période de chaque achat ; `entitlements` est sa vue des commandes payées. Une modification financière ne retire pas les droits d'un autre achat. Migration historique bornée par les accès présents et les 360 jours de l'ancien webhook ; aucune ancienne livraison n'est créée. Ne pas modifier directement la vue sans son historique. Les liens historiques vers une commande appartenant à un autre client ne sont pas importés ; la capture des droits manquants se refait au démarrage après un retour temporaire à une ancienne version.
- Une notification plus récente invalide toute lecture Stripe encore en vol. Erreurs, pages tronquées, mode ou montants incohérents ne sont jamais interprétés comme un remboursement nul. Les nouvelles commandes avec une notification en attente attendent son rapprochement avant leurs droits et leur livraison. Une simple relecture périodique en panne ne bloque pas une livraison déjà validée.
- Aucun renvoi automatique d'un mail déjà accepté. Après restauration des droits, une livraison dont le résultat était incertain passe en vérification manuelle ; une livraison jamais tentée peut reprendre. Un lien R2 déjà signé peut rester utilisable jusqu'à son expiration de cinq minutes ; aucun mécanisme ne rappelle un fichier déjà téléchargé.
- Les chiffres du CRM déduisent les remboursements confirmés à la date de l'achat et excluent les contestations ouvertes/perdues ; ce n'est pas un relevé bancaire. Les abonnements MCP ne sont pas couverts par ce rapprochement des commandes de fichiers.

## Présentation des offres
- Les nouvelles souscriptions Pro/Business sont explicitement fermées sur `/pricing` et les pages MCP FR/DE/EN ; prix conservés, formulaires retirés. Une réouverture nécessite de valider la livraison des abonnements, le contrôle `MCP_SUBSCRIPTIONS_OPEN` et ces quatre pages dans le même chantier.
- Sur mobile, les colonnes du héros doivent pouvoir rétrécir (`minmax(0,…)`, enfants `min-width:0`). Vérifier la géométrie réelle des textes et boutons : un `scrollWidth` correct peut masquer du contenu tronqué par `overflow:hidden`.

## Surveillance des sources
- Le contrôle compare dix sources publiques à `etl/canary-baseline.json`. Octets d’abord dans un bronze daté immuable, puis empreinte. Dans GitHub, ce bronze est temporaire ; seuls le rapport et la référence sont conservés 14 jours comme artefacts.
- Une source modifiée, absente ou illisible fait échouer la tâche. Aucun nouveau ticket GitHub ni message client automatique. La référence n’est jamais réinitialisée automatiquement : contrôler les sources avant de l’intégrer. La réussite du contrôle ne prouve pas la justesse métier de toutes les données.
- Nettoyage réactivé le 25.09.2026, passage réel 36159500858 réussi (HTTP 200). Les tables historiques `magic_links` et `request_log` n’existent pas dans cette base et sont ignorées ; les commandes, clients, droits et versions ne sont pas concernés.

## TARES — publication et service du schéma 2
- Collecte des sept XLSX dans un bronze daté immuable avant lecture. Une colonne imprévue, un taux vide, un volume inhabituel, des doublons ou une perte de lignes bloque la publication. Les pourcentages restent des pourcentages ; ne jamais les étiqueter CHF.
- `tares_rates.csv/json` conservent toutes les cellules des lignes de taux en vigueur, avec HS8 et dates normalisées ajoutés. Le résumé ne choisit jamais le minimum : MFN de base non ambigu seulement, préférences sans conditions divergentes et de même unité ; absence ≠ gratuité. `unit_stat` reste un alias historique de l'unité du droit. Les clés des pays connus viennent des codes LDG relus ; autres clés `ldg_<code>`.
- Simulation `TARES_DRY_RUN=1`, sans envoi R2 ni enregistrement. Fixtures interdites en publication. Date réelle, référence précédente vérifiée, comparaison, signature et fichiers contrôlés avant upload immuable ; archive distante relue avant enregistrement conditionné à la version précédente. Une collision ou concurrence impose un examen, jamais un écrasement.
- Le workflow manuel démarre en simulation ; le calendrier hebdomadaire dépend de `TARES_CRON_ENABLED`. Les vecteurs ne sont pas inclus dans cette actualisation, ce qui est annoncé sur la fiche. Rapport minimal GitHub 14 jours, aucun ZIP vendu en artefact public.
- Catalogue et échantillon proviennent de l'archive vendue. Le MCP recharge TARES au démarrage, après publication et toutes les douze heures ; garde la dernière version complète en cas de panne, avec fraîcheur visible. Les embeddings restent distincts et non actualisés par cette opération.
- Bronze de traitement TARES sur le volume : ZIP vérifié, 30 jours, plafond 200 Mo, réserve disque 300 Mo ; ce n'est pas une sauvegarde. Aucun changement de prix. Une évolution du schéma doit rester expliquée dans README et la fiche qualité.

## Classifications — schéma 2
- NACE 2 vient directement d'Eurostat, pas du paquet npm qui expose la révision 2.1. Volumes validés : NOGA 2008 1 790, NOGA 2025 1 845, NACE 2 996, NACE 2.1 1 047, ISIC 4 766. Un changement de ces volumes demande un examen des sources.
- Relations directes sourcées et typées, aucune égalité de code présumée ; seule l'identité OFS aux niveaux 1 à 4 est exacte. Ne pas chaîner deux relations non exactes. Les genres suisses à six chiffres nécessitent une table dédiée pour migrer entre révisions.
- Le format historique crosswalks contient désormais des paires ; README et fiche produit préviennent de cette évolution. Sources, qualité, provenance signée et empreintes sont dans chaque archive. Catalogue et MCP rechargent la version distribuée.
- Publication manuelle par `release-classifications.yml`, simulation par défaut, Standard uniquement. Fixtures et Pro refusés avant publication. Lien Stripe Pro désactivé le 25.09.2026 : ne rouvrir qu'après validation complète des compléments et de leur livraison.

## Disponibilité au démarrage
- Railway attend `/api/health/ready` (180 s) : trois versions enregistrées, schéma financier disponible, pages essentielles et leurs ressources présentes. Aucun appel externe dans ce contrôle ; `/api/health/deep` et `/freshness` restent distincts.
- `/api/health` prouve seulement que le processus répond. Railway ne surveille plus `/ready` après le démarrage : conserver le contrôle extérieur.
- Le volume SQLite impose une courte interruption lors du remplacement ; ce contrôle n'est pas une promesse de zéro interruption ni un mécanisme de restauration des données.
- Retour arrière : version de code compatible avec `order_deliveries`, `order_grants` et rapprochement financier obligatoire ; sauvegarde avant migration et relecture des droits après restauration. Ne jamais restaurer une ancienne base par simple rollback de code.
- Sauvegarde : snapshot cohérent → chiffrement → R2 → relecture → comparaison des octets et contrôles SQLite complets dans un processus isolé sans secrets (60 s maximum). Témoin écrit sans remplacement relu dans `backups/verified/`, lié au SHA de l’objet chiffré. `operation_checks.backup` conserve le succès, `backup_attempt` l’essai récent ; un échec d’élagage garde la copie validée et apparaît séparément. Le workflow exige ces preuves et ne publie pas la réponse privée. Les modèles et règles de reprise complète restent dans `docs/sauvegarde-et-reprise.md` ; ne pas démarrer aveuglément les files automatiques d’une base restaurée.

## Promesses publiques et droits des sources
- Les versions de l'accueil viennent du catalogue distribué à la consultation ; une panne affiche l'impossibilité de vérifier, jamais une ancienne date présentée comme actuelle. Les FAQ FR/DE/EN partagent les mêmes règles : paiement confirmé, collecte FINMA quotidienne planifiée, TARES hebdomadaire, classifications après contrôle.
- Le bundle livre les trois fichiers. Aucun accès MCP payant n'est créé par l'achat de fichiers : ne pas l'annoncer comme inclus. Les outils anonymes sont `tariff_lookup`, `kyc_check` et `cross_walk` ; les autres demandent des droits. Les souscriptions payantes restent fermées.
- `statent_lookup` et son CSV ont été retirés du service le 25.09.2026 faute de preuve de droits de redistribution dans le dossier. Les scopes historiques restent lisibles pour compatibilité, mais ne donnent accès à aucun outil STATENT. Ne pas remettre la source au seul motif qu'un client possède ce scope. Voir `docs/droits-des-sources.md` pour les preuves et vérifications restantes.

## Dépendances et modèle de recherche
- Référence de contrôle : `docs/securite-dependances.md`. Application et site ont des lockfiles distincts ; les SDK également. Ne pas confondre audit npm sans avis et audit de sécurité complet.
- SheetJS vient de sa distribution officielle 0.20.3, intégrité verrouillée ; imports par `etl/shared/xlsx.ts` (CommonJS Node avec fichiers/encodages).
- Recherche et collectes vectorielles utilisent le même moteur Transformers.js 3.8.1. Modèle mpnet à révision figée, tailles/SHA dans `embedding-model.ts`, préchargé au build ; aucun téléchargement pendant une requête. Pour une collecte vectorielle seule : `npm run models:prepare:embedding`.
- Les caches de reprise exigent modèle, révision/moteur et dimension courants. Les index livrés restent ceux des collectes historiques tant qu’une régénération distincte n’a pas été validée.
- Le démonstrateur navigateur appelle `/mcp/jsonrpc` sur la même origine, compatible avec la CSP ; une URL de sous-domaine nécessite CORS et CSP et ne doit pas être utilisée ici.

## Contrôles de publication et pages publiques
- Railway attend les suites GitHub (`source.checkSuites=true`, relu le 25.09.2026). Ne pas désactiver pour contourner un test en échec. Ce réglage porte sur les publications automatiques GitHub ; une intervention manuelle demande toujours une vérification explicite de la CI et du SHA servi. Référence : https://docs.railway.com/deployments/github-autodeploys.
- Les tests racine importent aussi des utilitaires du site. Installer `npm --prefix web ci` avant ces tests dans un environnement vierge : le tsconfig Astro est nécessaire. La CI le fait explicitement depuis le 25.09.2026.
- Après chaque build du site, `npm run seo:check` contrôle les liens internes, canonical, hreflang réciproques et sitemap. Ne pas remettre une date `lastmod` fabriquée à la construction.
- Les fiches FINMA publiques sont une copie historique distincte du produit quotidien. Les correspondances des fiches NOGA viennent des mêmes références sourcées que le MCP. Voir `docs/fiches-publiques.md`.
- Recherche et traduction vérifient leurs fichiers de modèle par taille et SHA-256 au build. Les modèles figés et les index vectoriels historiques restent deux sujets distincts ; aucun téléchargement ni envoi de texte à un fournisseur pendant la traduction.

## Conditions de vente et preuve contractuelle — 26.09.2026
- Les achats de fichiers demandent l’acceptation des CGV chez Stripe, dans la langue du parcours (français par défaut). Le compte Stripe est partagé : ne pas modifier ses réglages juridiques globaux sans vérifier les autres projets. Les liens de CGV et confidentialité OpenSwissData sont fournis dans le texte spécifique de chaque session.
- Contrats figés dans `src/legal/terms-YYYY-MM-DD.ts`, répertoriés dans `src/legal/catalog.ts`. Ne jamais modifier un contrat publié : ajouter une version, ses trois pages datées et ses trois endpoints texte `.txt.ts`, et conserver les anciennes routes, fichiers texte et empreintes. Les tests verrouillent les empreintes acceptées. Les pages datées servent le même contenu que la pièce jointe.
- `order_legal` est écrit dans la transaction commande/droits/livraisons, à partir de l’événement Stripe signé. Version/langue/empreinte doivent être connues et `consent.terms_of_service` accepté. Sinon statut explicite `legacy` ou `unverified`, sans inventer une acceptation et sans priver l’achat payé de sa livraison. Aucun remplissage rétroactif des achats historiques.
- Les CGV acceptées sont jointes au mail, dans leur langue contractuelle même si la correspondance est dans une autre langue. Le corps et la pièce jointe sont figés ensemble avant le premier essai. Les liens sont visibles dans le compte du titulaire et le CRM autorisé.
- Les CGV 1.1 FR/DE sont archivées ; les anciennes archives de données signées ne sont pas réécrites. Les nouvelles licences des ZIP rappellent la priorité des conditions convenues lors de chaque achat et les droits propres aux sources.
- Les textes ne constituent pas une validation d’avocat. Le suivi privé A29 conserve les vérifications contractuelles des prestataires, des transferts et des droits de sources encore nécessaires. Ne pas déclarer un DPA signé ou une conformité générale sur la seule présence d’un document public chez un fournisseur.

## Environnement et tests isolés — 26.09.2026
- Node >=22.12 ; CI/Railway sur Node 22. `README.md` décrit les commandes actuelles et les frontières entre application, ETL, données distribuées et fiches publiques.
- Les clés de test sont éphémères et passées explicitement à la signature. Aucun remplacement, même temporaire, de `packages/schemas/openswissdata.pubkey.ed25519`. Ne pas injecter une clé de test dans l’environnement global d’une collecte.
- `db:migrate` appelle le schéma et les migrations idempotentes de `getDb` ; l’ancienne migration Business manuelle n’est pas incluse. Base fictive et chemin distinct obligatoires pour les essais.
- Ne pas lancer les tests racine en même temps que `npm run build` : le build réinstalle les dépendances Astro et peut faire disparaître temporairement son tsconfig. Terminer les tests avant le build, ou utiliser deux copies distinctes.
- La CI exige des fichiers suivis inchangés après les tests. Les secrets et bases réels ne sont pas nécessaires au typage, aux tests ou au build.

## Chronologie du service — 26.09.2026
- `download_activity` conserve au plus 180 jours de traces minimales : compte, produit, version, origine et dates ; aucun lien secret, IP ou contenu de mail. Les liens email sont rattachés à leur commande ; les accès du compte ne sont pas attribués arbitrairement à un achat. Aucun remplissage rétroactif.
- Un HTTP 2xx Resend prouve l’acceptation de la demande, pas la livraison/lecture. Son identifiant est conservé dans `order_deliveries`, puis effacé après 180 jours. Un corps 2xx illisible ne déclenche jamais un second envoi.
- Une prévisualisation GET du nouveau lien ne produit pas de trace d’utilisation. Une autorisation réussie ne prouve ni identité du lecteur, ni téléchargement complet, ni ouverture du fichier. Les anciens liens GET peuvent être consultés par des robots.
- Le CRM expose uniquement les métadonnées nécessaires ; les liens de connexion/livraison sont masqués avant affichage. Les originaux des connecteurs restent bruts, chiffrés dans le bronze autorisé, avec purge distincte.
- Retour arrière : garder une version de nettoyage compatible avec `download_activity` et `provider_message_id`. Ne pas désactiver leur purge en restaurant l’ancien code. Un futur effacement de compte doit traiter ces traces avec les autres clés étrangères ; aucun effacement de compte/commande automatique n’existe actuellement.

## Polices et confidentialité — 26.09.2026
- Les cinq familles sont servies localement, fichiers WOFF2 officiels inchangés et empreintes produites par Astro. Aucun téléchargement de police au build ni connexion du navigateur à Google Fonts.
- Les provenances et SHA sont dans `web/src/assets/fonts/provenance.json`, les licences OFL sont distribuées dans `/fonts/licenses/`. Le contrôle `fonts:check`, obligatoire après le build, vérifie les octets, les licences, les liens CSS et l’absence d’appels Google Fonts.
- Importer `fonts-geist.css` dans les nouveaux gabarits qui utilisent Geist. Ne pas rétablir de domaine tiers dans `style-src` ou `font-src` pour charger une police.

## Diagnostic des dépendances — 26.09.2026
- `/api/health/deep` est privé, exige la session administrateur et ne retourne aucun message fournisseur brut. Le bouton de l’espace Automatisations le déclenche à la demande ; aucun appel profond au chargement du CRM.
- Une seule vérification simultanée par processus, cache de 60 secondes y compris les échecs, délai de 3 secondes par dépendance. Stripe : délai SDK 2,5 secondes et aucune relance ; R2 : une tentative, signal d’annulation et client détruit.
- Les moniteurs publics utilisent `/ready` (base et site) et `/freshness` (FINMA), sans appel à un fournisseur. Une vérification de connexion réussie ne prouve ni livraison, ni droits, ni téléchargement complet. Le cache n’est pas partagé entre réplicas ; réévaluer avant de multiplier les instances.

## Conservation périodique et preuve — 26.09.2026
- Le nettoyage toutes les six heures traite SQLite et les deux bronzes techniques dashboard/financial, même sans consultation du CRM. Aucune commande, preuve contractuelle, note, droit acquis, boîte d’origine ou sauvegarde n’est supprimée par cette tâche.
- Seules magic_links et request_log sont des tables historiques facultatives (les liens actuels résident dans sessions). Toute erreur SQL réelle, même dans une table facultative présente, rend le passage incomplet. Les catégories indépendantes continuent ; HTTP503 et code CLI1 signalent l’échec, sans message SQL brut.
- Bronze : même frontière de trente jours calendaires UTC que la purge à la consultation ; seuls les répertoires datés reconnus sont concernés, aucun lien symbolique suivi. Les fichiers conservés ne sont ni lus ni réécrits.
- operation_checks/cleanup garde le dernier témoin minimal (dates, catégories, quantités, résultat). Le CRM expose uniquement un témoin validé ; un passage ancien ou incomplet demande vérification. Un échec d’enregistrement fait échouer la tâche.
- Aucun élargissement de la rétention aux notes ou courriers originaux : ces durées et les sauvegardes restent des sujets distincts de la roadmap.

- Les chemins de base et bronze sont partagés dans data-paths.ts ; les connecteurs suivent la base réellement ouverte, même avec un chemin explicite différent de DATABASE_PATH. La CLI de nettoyage exige un fichier de base existant ; elle ne crée pas de base vierge.
- Précontrôle des dates avant suppression : entiers en millisecondes, cohérents avec les écritures de l’application depuis 2025. Un format historique en secondes/texte demande examen et laisse la catégorie intacte.
- Le workflow public n’affiche que les noms de catégories et statuts ; les quantités restent privées. Sa réponse brute est temporaire dans le runner, pas une sauvegarde durable. La minuterie serveur assure la relève de ce nettoyage ; un secret à portée réduite et la surveillance extérieure des pannes restent à traiter séparément.

## Registre privé des incidents de livraison — 26.09.2026
- Un dossier par order_delivery, observations minimales sans adresse, corps, jeton, lien signé, référence fournisseur ni erreur brute. Lecture CRM administrateur, pages de 20 ; historique à curseur par 50. Une relecture identique ne crée pas d’échec supplémentaire.
- Le worker de livraison observe son résultat après écriture ; une panne de registre ne remet pas un mail accepté en file. Aucun hook dans la transaction financière : la relève lit les états après commit. Si un observateur imbriqué subit un rollback de toute la transaction, l’erreur doit être propagée, jamais avalée avant des écritures en autocommit.
- Acceptation du prestataire ≠ réception ou ouverture. Annulation/suspension financière ≠ envoi réussi. Une acceptation après perte du bail ou changement d’état ouvre une alerte persistante de contrôle humain ; aucun rétablissement de droits ni renvoi. La fermeture manuelle avec preuve reste à réaliser.
- Relève après 30 secondes, puis chaque minute, au plus 200 candidats par passage ; elle n’appelle aucun service externe. createApp et les processus de tests/restauration ne la démarrent pas. Le témoin delivery_incident_scan conserve date, limite et erreurs ; l’absence ou l’ancienneté reste visible. Des transitions brèves manquées ne sont pas reconstituées.
- Journal technique et dossiers clos expirent à 180 jours ; dossiers ouverts conservés. Un dossier clos remis en file n’est pas purgé. Les nouvelles catégories delivery_incident_events/delivery_incidents portent le nettoyage normal à 13 catégories ; un ancien témoin incomplet ne prouve pas leur purge. Garder cette conservation en cas de retour arrière de code.
- Clés étrangères actives vers les livraisons : aucun flux actuel ne supprime clients/commandes/livraisons. Une future suppression devra traiter explicitement le registre, sans cascade silencieuse des achats ou preuves.
- Une action interne peut être créée explicitement depuis un incident ouvert. delivery_incident_tasks impose une seule liaison par incident ; transaction tâche/liaison et créateur issu de la session. Rejeu = action existante, sans remplacement d’échéance ni réouverture implicite. Avant première création, relire l’état de livraison. La relève ne crée/ferme aucune tâche, et cocher une tâche ne ferme jamais un incident.
- Purger un incident technique détache la liaison mais conserve sa tâche. Aucun nouveau cycle d’expiration des tâches/notes introduit. Le profil de vérification des sauvegardes service-crm-2026-09-26 contrôle aussi les colonnes essentielles du suivi privé ; les anciens témoins sans ce profil restent explicitement historiques.

## Surveillance extérieure publique — 26.09.2026
- monitor-public.yml lit ready/freshness chaque heure à la minute 23 depuis GitHub, sans secret métier ni écriture sur le service. Deux lectures bornées, sans redirection, corps bruts dans le bronze temporaire du runner avant interprétation ; pas d’artefact brut public. La date FINMA doit être réelle, son âge est compté depuis minuit UTC de l’édition.
- Le CRM distingue passages manuels et schedule sur main ; un succès manuel ne prouve pas la cadence. Vert seulement avec un passage horaire récent et un dernier résultat réussi, dates cohérentes, tâche active. Fenêtre bornée à 100 exécutions et au plus trois compléments pour les tâches absentes ; cache dix minutes. Le numéro de tentative distingue une relance manuelle du premier passage schedule. Heure de référence reçue du serveur, pas du téléphone. Pas de suivi continu lorsque la page reste ouverte.
- GitHub peut retarder/omettre des passages et désactiver le workflow après 60 jours d’inactivité du dépôt public. Aucun nouvel envoi Telegram/mail configuré ; réception des notifications GitHub non prouvée. Surveillance privée des sauvegardes/livraisons encore liée au Mac. Voir docs/surveillance-exterieure.md.

- Déploiement du profil de sauvegarde : backup-db.yml exige service-crm-2026-09-26. Vérifier le serveur réellement servi avant de déclencher le workflow ; pendant une publication ou un retour arrière sur un ancien vérificateur, le job reste en échec prudent. Un retour arrière doit garder workflow et vérificateur compatibles, sans attribuer le nouveau profil à une ancienne preuve. Le créateur de delivery_incident_tasks est une clé étrangère restrictive : une future suppression de compte administrateur doit traiter explicitement cette trace, sans cascade des tâches.
