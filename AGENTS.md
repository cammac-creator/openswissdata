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
- NACE 2.1 se télécharge par l'adresse directe du document cellar (`publications.europa.eu/resource/cellar/…`) : depuis le 28.09.2026, le gestionnaire `op.europa.eu` répond 403 (pare-feu Azure) aux scripts. Mêmes octets vérifiés. Une notice de licence modifiée n'atteint les acheteurs qu'avec une nouvelle version publiée : `tests/etl/dataset-license.test.ts` vérifie la notice jointe à chaque archive.

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
- Journal technique et dossiers clos expirent à 180 jours ; dossiers ouverts conservés. Un dossier clos remis en file n’est pas purgé. Les nouvelles catégories delivery_incident_events/delivery_incidents portaient le nettoyage normal à 13 catégories avant l’ajout de Checkout ; un ancien témoin incomplet ne prouve pas leur purge. Garder cette conservation en cas de retour arrière de code.
- Clés étrangères actives vers les livraisons : aucun flux actuel ne supprime clients/commandes/livraisons. Une future suppression devra traiter explicitement le registre, sans cascade silencieuse des achats ou preuves.
- Une action interne peut être créée explicitement depuis un incident ouvert. delivery_incident_tasks impose une seule liaison par incident ; transaction tâche/liaison et créateur issu de la session. Rejeu = action existante, sans remplacement d’échéance ni réouverture implicite. Avant première création, relire l’état de livraison. La relève ne crée/ferme aucune tâche, et cocher une tâche ne ferme jamais un incident.
- Purger un incident technique détache la liaison mais conserve sa tâche. Aucun nouveau cycle d’expiration des tâches/notes introduit. Le profil de vérification des sauvegardes service-crm-2026-09-26 contrôle aussi les colonnes essentielles du suivi privé ; les anciens témoins sans ce profil restent explicitement historiques.

## Surveillance extérieure publique — 26.09.2026
- monitor-public.yml lit ready/freshness chaque heure à la minute 23 depuis GitHub, sans secret métier ni écriture sur le service. Deux lectures bornées, sans redirection, corps bruts dans le bronze temporaire du runner avant interprétation ; pas d’artefact brut public. La date FINMA doit être réelle, son âge est compté depuis minuit UTC de l’édition.
- Le CRM distingue passages manuels et schedule sur main ; un succès manuel ne prouve pas la cadence. Vert seulement avec un passage horaire récent et un dernier résultat réussi, dates cohérentes, tâche active. Fenêtre bornée à 100 exécutions et au plus trois compléments pour les tâches absentes ; cache dix minutes. Le numéro de tentative distingue une relance manuelle du premier passage schedule. Heure de référence reçue du serveur, pas du téléphone. Pas de suivi continu lorsque la page reste ouverte.
- GitHub peut retarder/omettre des passages et désactiver le workflow après 60 jours d’inactivité du dépôt public. Aucun nouvel envoi Telegram/mail configuré ; réception des notifications GitHub non prouvée. Surveillance privée des sauvegardes/livraisons encore liée au Mac. Voir docs/surveillance-exterieure.md.

- Déploiement du profil de sauvegarde : backup-db.yml exige service-crm-2026-09-26. Vérifier le serveur réellement servi avant de déclencher le workflow ; pendant une publication ou un retour arrière sur un ancien vérificateur, le job reste en échec prudent. Un retour arrière doit garder workflow et vérificateur compatibles, sans attribuer le nouveau profil à une ancienne preuve. Le créateur de delivery_incident_tasks est une clé étrangère restrictive : une future suppression de compte administrateur doit traiter explicitement cette trace, sans cascade des tâches.

## Mesures après achat — 26.09.2026
- Le panneau Audience lit les commandes actuellement payées de la période suisse, réelles et hors comptes internes. Même règle que les ventes ; aucun ratio visites/commandes ou étape Checkout inventé. Une commande et un client distinct sont deux unités différentes.
- Tous les fichiers d’un bundle doivent avoir une acceptation datée cohérente pour compter la commande complète. Les preuves d’accès par mail sont dédupliquées par commande et limitées à 180 jours depuis la création de la trace. Les accès du compte ne sont pas attribués à un achat ; absence de trace, réception et téléchargement complet restent distincts. Voir docs/mesures-apres-achat.md.
- Agrégats dans la transaction de lecture Audience, aucune écriture de droit, paiement ou livraison. Index additif download_activity(order_id,created_at), compatible avec retour arrière ; tests et mesures de volume uniquement fictifs.

## Scripts du bureau — 26.09.2026
- La CSP du fichier admin/index.html est durcie après secureHeaders, sur le fichier réellement trouvé par serveStatic, pas sur un préfixe d’URL présumé. Scripts de même origine seulement (le build impose des modules), aucun script inline ou gestionnaire HTML, pas de base ni d’objet intégré. Les styles inline et les anciennes pages publiques/compte restent des sujets distincts.
- admin:csp:check fait partie de web:build ; il exige le module local produit par Astro et refuse toute réintroduction de script inline dans l’artefact. Ne pas rétablir unsafe-inline pour faire passer une interface cassée. Sources et limites : docs/securite-du-bureau.md.
- createApp({webRoot}) accepte un dossier explicite pour les tests statiques temporaires ; aucun paramètre HTTP et aucun démarrage de worker. Ne pas écrire une fausse page admin dans le build partagé pour tester ses en-têtes.


## Annuaire FINMA et parcours fichiers — 26.09.2026
- Les index FR/DE/EN conservent la recherche historique et proposent le véritable échantillon `/api/catalog/finma?format=csv` ainsi que la fiche produit localisée. Ne pas présenter la copie historique comme le produit quotidien, ni l’absence d’un résultat comme une sanction ou une absence dans le registre officiel.
- Les contenus essentiels et les liens restent visibles sans animation ni JavaScript. La fraîcheur du produit se lit sur sa fiche, pas dans une date figée au build de l’annuaire. Aucun gain SEO ne se déduit de la seule publication ; voir `docs/fiches-publiques.md`.

## Demandes d’échantillons — 26.09.2026
- `sample_served` observe seulement les réponses GET CSV 200 des trois produits ; nom réservé au serveur. Réutiliser les budgets de collecte et la purge à 180 jours, sans client, email ou URL dans la trace. Une panne de mesure ne doit jamais bloquer le fichier.
- Le CRM sépare demandes, navigateurs présumés et visiteurs-jours valides, dédupliqués entre produits. Ni HTTP 200 ni première trace conservée ne prouvent réception, présence humaine ou début de collecte. Aucun taux de conversion inventé ; règles et limites dans `docs/mesures-echantillons.md`.

## Créations Checkout — 26.09.2026
- `checkout_started` est observé uniquement après une réponse Stripe de création attestant URL, mode réel et paiement de fichiers. Le formulaire peut aussi retourner 303 en erreur : ne jamais assimiler le seul statut à une création. Aucun identifiant Stripe ou client dans cette mesure facultative.
- Ne pas modifier le parcours d’achat ni relancer Stripe lorsqu’une statistique échoue. Les preuves de vente restent transactionnelles et séparées. Les créations observées ne prouvent ni affichage de Checkout, ni abandon, ni paiement ; détails dans `docs/mesures-checkout.md`.

## Protection des demandes de paiement — 26.09.2026
- Ne pas ajouter un proxy Cloudflare/CDN devant Railway sans revoir et revalider trustedRequestIp sur deux réseaux distincts.
- Formulaire et API Checkout partagent six secondes par adresse validée (IPv6 /64), conservées dans SQLite après redémarrage. Réutiliser trustedRequestIp ; ne jamais revenir au premier X-Forwarded-For fourni librement. L’absence d’adresse valide partage une seule identité inconnue.
- checkout_request_limits conserve uniquement une clé HMAC dédiée et deux dates ; plafond de 10 000 lignes sans éviction des limites actives. Refus 429 sans prolongation et Retry-After ; clé, stockage, horloge ou capacité indisponibles donnent 503 avant Stripe. Aucune attente de verrou SQLite pour cette protection.
- Corps limité à 4 096 octets, réponses no-store. Tests de protection actifs même avec NODE_ENV=test ; les tests métier peuvent simuler explicitement le garde. Ne pas appeler Stripe réellement pour la recette.
- Table additive, sauvegarde avant publication ; purge périodique porte le témoin complet à 14 catégories. Le profil de restauration service-crm-2026-09-26 conserve sa définition métier ; les compteurs temporaires ne sont pas des preuves d’achat. Détails et limites : docs/protection-checkout.md.

## Portées MCP — 27.09.2026
- Les droits d’un jeton OAuth sont l’intersection de mcp_tokens.scope et des droits actuels de mcp_clients. Ne jamais attribuer automatiquement tous les droits du compte à un jeton plus étroit, vide ou inconnu. Pas de repli anonyme pour un jeton authentifié sans droit commun.
- Le renouvellement garde au plus la portée originale et les droits actuels ; une demande de scope peut réduire, pas élargir. Refuser une portée invalide avant révocation du jeton de renouvellement. La rotation suit la transaction décrite ci-dessous.
- Les quotas du compte, révocations, accès anonyme et chemin administrateur historique restent distincts. Aucun droit stocké ne doit être réécrit pour corriger une lecture. Ce correctif ne valide pas tout OAuth et ne rouvre pas les souscriptions ; voir docs/portees-mcp.md.

## Émission OAuth indivisible (27.09.2026)
- `/oauth/token` valide, consomme/révoque et émet dans une seule transaction immédiate, synchrone et sans réseau. Ne pas rendre les fonctions internes asynchrones. Un verrou ou une panne donne 503/no-store sans détail SQL, avec rollback et restauration du busy_timeout.
- Lire le code avant validation ; `consumeAuthCode` est conditionnel et doit rester dans la transaction qui insère la paire. Date exacte expirée, portée bornée aux droits actuels, ancien refresh inutilisable après succès. Voir `docs/cycle-jetons-mcp.md` pour les limites : aucune famille de jetons ni récupération de réponse perdue, abonnements toujours fermés.

## Frontières MCP (27.09.2026)
- Toute révocation exige le client propriétaire dans le WHERE SQL ; aucun appel sans clientId. Une réponse 200 ne révèle pas si un jeton tiers existe.
- Authorization présent mais invalide donne 401, jamais de repli anonyme. Bearer accepte la casse indifféremment. Les pannes de lecture/quota ne renvoient aucun détail brut.
- Registre des outils par Map et portée obligatoire, y compris pour administrateur. Ne pas réintroduire la lecture des propriétés héritées. Voir docs/frontieres-mcp.md et les réserves OAuth restantes.

## Entrées OAuth (27.09.2026)
- Le routeur compte les octets réels des POST avant tout parseur, plafond 16 Kio et annulation du flux trop long. Ne pas revenir à la seule valeur Content-Length. En-têtes no-store/no-cache sur les deux montages OAuth, inscription et autorisation comprises.
- Utiliser readOAuthForm pour refuser un formulaire illisible sans diagnostic brut. Les deux outils sémantiques rendent un message fixe si index/modèle indisponible ; aucun message fournisseur ou chemin interne. Voir docs/entrees-oauth.md ; les limites de fréquence, durée de réception et redirections restent distinctes.

## Authentification des clients OAuth (27.09.2026)
- Jeton et révocation utilisent parseClientCredentials : Basic ou formulaire, jamais un assemblage ni un repli après en-tête invalide. Défi Basic sur401 ; ambiguïté400. Respecter encodage de formulaire par composant, Base64 canonique et UTF-8 strict.
- readOAuthForm refuse paramètres répétés, tableaux et fichiers avant effet. Garder les deux formats de formulaire valides. Aucun test ne doit utiliser un client réel ; vérifier code et jetons inchangés après refus. Voir docs/authentification-client-oauth.md et les réserves d’identité/redirection/abonnement encore ouvertes.

## Autorisations et destinations OAuth (27.09.2026)
- `mcp_client_redirect_uris` conserve 1 à 10 URL exactes par application. L’inscription les exige ; les anciens clients configurent leur liste via `/oauth/redirect-uris` avec leur secret. Ne jamais déduire une destination d’un email, d’un code ancien ou d’un premier appel anonyme. Table additive, sauvegarde et inventaire agrégé des usages avant publication.
- GET et décision POST valident client actif, destination enregistrée, S256 explicite/canonique et portée autorisée. Même contrôle avant un refus redirigé ; conserver les octets de la query et distinguer state absent de state vide. Recontrôler la destination à l’échange avant consommation du code.
- Une application reste distincte d’un titulaire humain et d’un payeur. Le POST ne prouve pas un consentement authentifié ; aucun rattachement d’abonnement ne doit reposer sur le seul email déclaré. Souscriptions fermées tant que ce parcours reste incomplet.
- CSP d’autorisation : aucun script, formulaire local et seule origine de retour validée. Réappliquer après secureHeaders ; Chrome contrôle aussi la redirection finale du POST. IPv6 littérale et clients publics/natifs hors périmètre, pas d’élargissement par joker. Vérifier le clic réel vers une autre origine sur les deux montages. Voir `docs/autorisations-mcp.md`.
- Les écritures de configuration/autorisation refusent rapidement un verrou SQLite ; vérifier les erreurs sans effet et la reprise. La limitation durable de fréquence et de croissance des codes reste distincte ; leur purge périodique existante ne prouve pas un plafond.

## Rattachement des abonnements MCP (27.09.2026)
- Ne jamais promouvoir une application par comparaison de son email déclaré avec celui d’un paiement. Un nouvel abonnement validé crée une application et un secret distincts ; l’inscription publique reste gratuite. La connexion humaine, le consentement et la preuve de contrôle du compte sont encore à terminer.
- Client, compte et reçu `mcp_subscription_checkouts` sont écrits dans une transaction immédiate sans réseau. Le reçu garde le lien abonnement/session/application après résiliation ou révocation et empêche sa recréation au rejeu. Ne pas purger ce reçu comme un jeton temporaire ; aucun secret n’y est stocké. Une panne avant commit donne 503, jamais un faux succès. Première attribution sans lien conservé : marqueur serveur `mcp_provisioning_version=2026-09-27` exigé ; ancien achat sans ce marqueur : 409 pour examen, sans recréation de droits.
- Exiger le mode abonnement, un unique SKU reconnu et les références Stripe valides. Coordonnées finales Checkout prioritaires ; aucun champ `client_id` fourni par un formulaire ou une métadonnée ne permet de récupérer une application existante. Les achats des autres projets et les fichiers restent séparés.
- La livraison du secret reste non durable : échec, arrêt après commit ou résultat incertain nécessitent une reprise contrôlée. Cycle financier désordonné, remboursements et consentement restent ouverts ; offres fermées. Voir `docs/rattachement-abonnements-mcp.md` avant toute réouverture ou retour arrière.

## Connexion et sessions (27.09.2026)
- Réutiliser `account-session` pour les accès compte et administrateur. `purpose` sépare lien reçu et session ouverte ; seuls les anciens jetons des durées exactes 15 min / 30 jours sont reconnus, sans réécriture historique. Cookie unique de forme exacte, création non future, expiration exclusive.
- Échange et déconnexion sont transactionnels, sans réseau ni attente de verrou. Exiger la suppression effective ; aucun cookie avant commit, 503 fixe et reprise en cas de panne. Nouveau retour account/admin enregistré à l’émission, jamais choisi par une query ultérieure. Routes auth no-store/no-referrer.
- Le lot50 décrit ci-dessous remplace la consommation directe par GET. Les souscriptions restent fermées. Voir `docs/connexion-et-sessions.md` pour le socle historique et ses limites.

## Confirmation de connexion (27.09.2026)
- GET/HEAD verify ne consomment jamais le lien ni n’ouvrent de session. POST confirm exige origine canonique, enveloppe authentifiée courte, cookie navigateur unique et contexte de session inchangé. Compte différent : case explicite contrôlée côté serveur. Réutiliser confirmMagicLink, jamais rétablir un échange direct par GET.
- Enveloppe AES-GCM liée à l’origine et clé dérivée séparément de SESSION_SECRET de 32 caractères minimum ; aucun secret de secours. Cookie __Host-osd_login HTTPS, aucun Domain ; repli HTTP seulement sur boucle locale test/development. Aucun jeton brut dans un champ caché, URL de confirmation, trace ou stockage navigateur lisible. Cible et identité attendue restent figées.
- Page autonome FR/DE/EN sans script/service tiers, styles par empreinte CSP appliquée après secureHeaders, no-store ; strict-origin sur le formulaire GET/HEAD réussi (aucun chemin/jeton dans Referer), no-referrer ailleurs. Ne pas accepter Origin:null pour contourner un formulaire cassé. La base ne reçoit aucune demande temporaire. Une panne garde le lien, une réponse perdue après commit ne permet pas sa récupération. Limites humaines/robots et retour arrière : docs/confirmation-de-connexion.md. Consentement MCP encore distinct, souscriptions fermées.

## Cookie et transition de session (27.09.2026)
- Compte et bureau acceptent seulement __Host-osd_session en HTTPS, Secure/HttpOnly/SameSite=Lax/Path=/, sans Domain. L’ancien osd_session est ignoré, jamais promu automatiquement : une reconnexion email est nécessaire pour les anciens navigateurs. Les lignes restent compatibles, sans révocation globale ; le préfixe n’invalide pas un jeton déjà connu d’un porteur. Cookie HTTP distinct osd_dev_session, uniquement sur boucle locale test/development.
- Confirmation réussie : consommer le lien, révoquer la session exacte remplacée et insérer la nouvelle dans la même transaction, en exigeant chaque écriture. Même compte compris ; autres appareils conservés. GET/HEAD, annulation, origine refusée ou panne ne révoquent rien. Réponse perdue après commit : pas de récupération garantie.
- Logout exige origine/hôte canoniques et contexte same-origin lorsqu’il est fourni. Aucun cookie effacé avant commit ; pas de suppression de ligne par l’ancien cookie. Notice des cookies FR/DE/EN actualisée, CGV figées inchangées. Voir docs/cookies-et-transition-de-session.md avant tout retour arrière ; le lot50 réintroduirait la lecture de l’ancien cookie.


## Illustration publique fixe — 28.09.2026
- Claude-Alain a retiré la manipulation de la carte pour privilégier la ressemblance avec l’illustration. Il a choisi ensuite la piste pixels sur le fond clair existant. `AtlasArtwork` utilise `swiss-atlas-pixels-v1.png` sur l’accueil et FINMA FR/DE/EN, sans parallaxe, flottement ni import de modèle/Three.js. Ne pas réactiver automatiquement l’ancien mode 3D.
- La provenance visible décrit une illustration ChatGPT : pixels évocateurs de données, sans couverture réseau mesurée, géologie ni altitudes exactes. L’attribution swisstopo concerne les modèles historiques, pas cette image. Le fond papier du site reste #f4f3ed ; la légère luminosité et la multiplication CSS servent au raccord, sans l’ancienne sursaturation. Ne pas isoler `.atlas-artwork` : cela coupe le mélange avec le fond de page et fait réapparaître un rectangle. La pause et le mouvement réduit restent applicables aux autres animations. Voir `docs/site-public-atlas.md`.

## Accès des agents IA au serveur MCP — 28.09.2026
- Négocier la version du protocole : renvoyer celle du client si elle est servie (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05). Du 14.06 au 28.09, imposer 2025-11-25 a fermé la porte aux clients sur SDK ≤ 1.17. Toute évolution se teste aussi avec un ancien SDK (`tests/mcp/acces-agents.test.ts`).
- Streamable HTTP en réponses JSON : notification = 202 sans corps ; GET ou ouverture SSE sur une adresse d'entrée = 405 `Allow: POST` ; POST accepté sur `/mcp/jsonrpc`, `/mcp`, `/mcp/` et la racine du sous-domaine. Jamais la suite « data » + deux-points dans les réponses `initialize` et `tools/list` : des sondes y voient un flux SSE et échouent (awesome-remote-mcp-servers, 28.09).
- Anonyme : 100 appels par heure et par réseau (`trustedRequestIp` + `abuseIp`), chaque message d'un lot compte, corps ≤ 64 Kio compté en octets réels, `tools/list` limité aux outils appelables, outil Pro refusé par un résultat lisible (le -32001 reste pour les jetons). CORS ouvert sans cookies sur les seules adresses d'entrée et `/discovery`, jamais sur `/oauth/*`.
- Mesures `mcp_initialize` (nom déclaré, vide s'il contient une arobase ou cinq chiffres) et `mcp_rate_limited` (premier refus de chaque fenêtre). La classe « scanner » regroupe les bibliothèques HTTP génériques : un agent Python y tombe aussi.
- `robots.txt` ouvre `/api/catalog/` et `llms.txt` cite les échantillons : les lecteurs des IA gonflent les « demandes » de `sample_served` ; lire les « navigateurs présumés ».
- Registre MCP : incrémenter `version` de `server.json`, puis lancer `publish-mcp-registry.yml` (OIDC, aucune connexion manuelle). IndexNow : `indexnow.yml` chaque lundi ; juste après la mise en ligne d'une nouvelle clé, un premier envoi peut répondre 403, relancer une minute plus tard.
- Outils Pro sémantiques : réponses souvent fausses (index TARES sans contexte des positions, recherche FINMA floue). Pas d'essai gratuit avant reconstruction. Rapport : https://claude.ai/artifact/CrtG42ucqho8qpabJ5xAFf.

## Surveillance et tâches planifiées — 28.09.2026
- GitHub retarde ou omet beaucoup de passages planifiés : 9 passages horaires sur 42 heures pour le moniteur, tâches quotidiennes lancées de 2 à 11 heures après leur créneau. Le moniteur a deux créneaux par heure. Un passage manuel ne prouve jamais la cadence. Chiffres et limites : `docs/surveillance-exterieure.md`.
- Alerte par mail (`scripts/alert-email.mjs`) sur la surveillance publique, la sauvegarde, FINMA et TARES : un message à la première panne et un au retour à la normale, via Resend, vers `contact@openswissdata.com` ou le secret `ALERT_EMAIL`. Jamais d'adresse, de clé ni de réponse brute du prestataire dans le journal public. L'éprouver uniquement par `simuler_panne` (déclenchement manuel du moniteur), jamais en dégradant la production. Les notifications GitHub seules restaient non lues.
- TARES : les nouveaux taux prennent souvent effet le 1er du mois (6 341 lignes au 01.10.2026). `refresh-tares.yml` publie aussi le 1er, sauf un lundi où le passage hebdomadaire s'en charge (la version porte la date du jour et n'écrase jamais).
- Contrôle des sources en échec après une mise à jour de l'OFDF : télécharger dans un bronze daté, reconstruire les lignes TARES avec `buildTaresRows` et comparer à la référence précédente (codes, taux en vigueur, doublons, désignations) avant d'adopter les nouvelles empreintes dans `etl/canary-baseline.json`. Le 28.09 : quatre fichiers de taux modifiés, 7 511 codes et 244 588 lignes en vigueur identiques, 6 248 lignes nettes ajoutées pour des dates futures.
