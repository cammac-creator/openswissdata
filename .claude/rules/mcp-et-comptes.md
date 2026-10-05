---
paths:
  - "src/mcp/oauth/**"
  - "src/mcp/server.ts"
  - "src/mcp/rate-limit.ts"
  - "src/mcp/body-limit.ts"
  - "src/mcp/caller-class.ts"
  - "src/mcp/track-mcp.ts"
  - "src/mcp/semantic-failure.ts"
  - "src/routes/mcp/**"
  - "src/routes/auth*.ts"
  - "src/routes/account.ts"
  - "src/lib/account-session.ts"
  - "src/lib/session-cookie.ts"
  - "src/lib/login-*.ts"
  - "src/lib/auth-*.ts"
  - "src/lib/tokens.ts"
  - "src/lib/request-ip.ts"
  - "src/lib/rate-limit.ts"
  - "server.json"
  - "glama.json"
  - "packages/**"
  - "sdks/**"
  - "tests/mcp/**"
  - "web/src/pages/**/mcp*.astro"
---

# Serveur MCP, OAuth, comptes et sessions (abonnements fermés : aucun travail sans demande payante prouvée)

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

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

## Accès des agents IA au serveur MCP — 28.09.2026
- Négocier la version du protocole : renvoyer celle du client si elle est servie (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05). Du 14.06 au 28.09, imposer 2025-11-25 a fermé la porte aux clients sur SDK ≤ 1.17. Toute évolution se teste aussi avec un ancien SDK (`tests/mcp/acces-agents.test.ts`).
- Streamable HTTP en réponses JSON : notification = 202 sans corps ; GET ou ouverture SSE sur une adresse d'entrée = 405 `Allow: POST` ; POST accepté sur `/mcp/jsonrpc`, `/mcp`, `/mcp/` et la racine du sous-domaine. Jamais la suite « data » + deux-points dans les réponses `initialize` et `tools/list` : des sondes y voient un flux SSE et échouent (awesome-remote-mcp-servers, 28.09).
- Anonyme : 100 appels par heure et par réseau (`trustedRequestIp` + `abuseIp`), chaque message d'un lot compte, corps ≤ 64 Kio compté en octets réels, `tools/list` limité aux outils appelables, outil d'historique refusé, ou essai épuisé, par un résultat lisible (le -32001 reste pour les jetons). CORS ouvert sans cookies sur les seules adresses d'entrée et `/discovery`, jamais sur `/oauth/*`.
- Mesures `mcp_initialize` (nom déclaré, vide s'il contient une arobase ou cinq chiffres) et `mcp_rate_limited` (premier refus de chaque fenêtre). La classe « scanner » regroupe les bibliothèques HTTP génériques : un agent Python y tombe aussi.
- `robots.txt` ouvre `/api/catalog/` et `llms.txt` cite les échantillons : les lecteurs des IA gonflent les « demandes » de `sample_served` ; lire les « navigateurs présumés ».
- Registre MCP : incrémenter `version` de `server.json`, puis lancer `publish-mcp-registry.yml` (OIDC, aucune connexion manuelle). IndexNow : `indexnow.yml` chaque lundi ; juste après la mise en ligne d'une nouvelle clé, un premier envoi peut répondre 403, relancer une minute plus tard.
- Outils Pro de recherche reconstruits et mesurés le 28.09.2026 (`docs/recherche-semantique.md`).

## Essai des outils de recherche — 29.09.2026
- Décision de Claude-Alain : `tariff_semantic_search`, `classify_text` et `finma_search` sont appelables sans jeton dans un essai de 20 appels pour les trois ensemble, par 24 heures ouvertes au premier appel d'essai et par réseau (même clé que la limite anonyme). Compteur en mémoire distinct, borné à 50 000 fenêtres, remis à zéro à chaque redémarrage ; chaque appel d'essai reste aussi un message pour les 100 par heure. Chaque message d'un lot compte, décompté avant l'exécution dans l'ordre du lot. Une entrée invalide coûte un appel.
- Chaque réponse d'essai porte, dans `content[0].text` et le champ `trial`, les appels restants et la source officielle où vérifier le résultat (xtares.admin.ch, registre FINMA, page NOGA de l'OFS). Au-delà : résultat lisible `isError`, délai de reprise, piste gratuite, aucun lien d'achat ; en-têtes `X-Trial-*` exposés en CORS, `Retry-After` pour un appel isolé.
- Jetons et administrateur : aucun essai, portées et `-32001` inchangés. `tools/list` anonyme signale l'essai dans le titre et la description ; jamais « data » + deux-points.
- Mesure `mcp_trial` (appel servi, premier refus de la fenêtre), sans argument ni adresse ; nom réservé. Lire l'usage avant toute décision sur l'offre Pro, qui reste fermée (aucun formulaire, prix ni promesse d'accès permanent).
- Le modèle sémantique tourne dans un processus à part (`src/lib/embedding-worker.ts`), lancé au premier appel et arrêté après dix minutes sans recherche. Pourquoi : `dispose()` dans le processus principal ne rendait pas la mémoire (environ 750 Mo gardés après six cycles, mesure du 29.09.2026 sur le Mac) ; un processus arrêté rend tout. Le processus principal ne charge jamais le modèle. Voir `tests/mcp/embedder-worker.test.ts` et `tests/mcp/essai-recherche.test.ts`.

## Consentement lié au titulaire — 29.09.2026
- Application payante (tier ≠ `free`) ou portée payante : session `__Host-osd_session` du titulaire (`mcp_clients.customer_id`) exigée sur www ; renvoi 302 depuis le sous-domaine avec la même demande ; décision POST de même origine, origine et session revérifiées dans la transaction. Ne jamais déclencher la porte sur la seule portée demandée : le secret seul ouvrait sinon le quota payé.
- Parcours gratuit identique à l'octet près (vérifier corps et en-têtes sur les deux hôtes à chaque modification). La page du titulaire pose `holderConsent` pour garder `Referrer-Policy: strict-origin` ; sans cela `Origin: null` fait échouer l'accord.
- Inventaire agrégé en lecture seule avant publication (29.09 : quatre applications gratuites, aucun jeton actif). Réserves ouvertes et détails : `docs/autorisations-mcp.md`. Souscriptions toujours fermées.
