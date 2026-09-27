# Confirmation de connexion — lot50, 27.09.2026

## Parcours

Le lien envoyé par email reste valable quinze minutes. GET et HEAD sur `/api/auth/verify` ne le consomment plus et n’ouvrent aucune session. Ils affichent une page FR/DE/EN avec l’adresse complète du compte à ouvrir. La page ne charge aucun script, police, outil de mesure ou service extérieur. La confirmation demande un clic explicite. Si un autre compte est déjà ouvert, la page montre aussi son adresse complète et exige une case de changement de compte, contrôlée côté serveur.

POST `/api/auth/confirm` valide la preuve et ouvre la session dans la transaction du lot49. Le succès revient par 303 vers le compte localisé ou le bureau. Annuler quitte la page sans consommer le lien ni fermer le compte courant. La page de confirmation et ses erreurs fonctionnent sans JavaScript.

## Preuve temporaire sans table supplémentaire

Un cookie aléatoire indépendant de la session lie le formulaire au navigateur. En HTTPS : `__Host-osd_login`, Secure, HttpOnly, Path=/, sans Domain, SameSite=Lax, durée cinq minutes. Le développement HTTP est permis uniquement sur une boucle locale avec NODE_ENV test/development et le nom `osd_login` ; aucun repli HTTP en production.

Le champ caché est une enveloppe AES-256-GCM : IV 96 bits aléatoire, tag 128 bits, clé dérivée de SESSION_SECRET par HMAC-SHA256 avec un domaine propre à la confirmation. L’origine canonique fait partie des données authentifiées. Le contenu comprend le lien, sa cible, l’empreinte du cookie temporaire, celle de la session courante, le compte attendu, la nécessité de changer de compte, la langue et les bornes temporelles. Ni jeton du mail ni identifiant client en clair dans le formulaire ; aucune adresse n’est ajoutée au formulaire ou à une nouvelle URL. Les adresses complètes sont affichées seulement dans cette page privée, accessible avec le lien, pour distinguer des comptes dont les adresses masquées pourraient être identiques. Le cookie contient seulement l’aléa.

La preuve dure au plus cinq minutes et jamais au-delà de l’expiration originale du lien. Elle ne crée aucune ligne persistante ; les consultations répétées ne font donc pas grossir la base. Un cookie temporaire valide peut être réutilisé pour plusieurs onglets, sans prolonger leurs preuves déjà émises. Une réponse réussie supprime ce cookie. L’usage unique découle de la consommation atomique du lien sous-jacent : une copie du formulaire ne permet pas de réémettre la session.

Configuration requise : BASE_URL canonique et SESSION_SECRET d’au moins 32 caractères, sans secret de secours. Configuration absente : 503 fixe et aucune connexion. Une rotation du secret invalide les confirmations en cours, pas les liens email : les rouvrir. Les autres usages de ce secret gardent leurs propres règles.

## Vérifications avant effet

- Hôte de requête et Host éventuel égaux à l’hôte canonique configuré. Le sous-domaine MCP ne devient pas une origine de connexion ; aucun élargissement Domain.
- Origin obligatoire et exactement canonique sur POST. Fetch Metadata, lorsqu’il est présent, doit être same-origin. Ni origine null, ni Referer substitué, ni hôte redirigé choisi par un tiers.
- Corps réellement limité à 4 096 octets, formulaire URL-encodé et UTF-8 valide ; paramètres uniques et liste fermée, décision connect obligatoire. Pas de jeton fourni directement au POST, query ajoutée, JSON ou multipart.
- Enveloppe authentifiée et canonique, cookie exact unique, empreinte correspondante, création non future et expiration exclusive. Le changement de compte exige la case attendue, et n’accepte pas une case ajoutée à une demande qui ne la prévoyait pas.
- Dans la même transaction immédiate : vérifier de nouveau la session courante, l’expiration et le compte/cible du lien, exiger sa suppression et la création effective de la session. La session courante ouverte, fermée, remplacée ou expirée entre affichage et clic rend la page obsolète (409), sans consommer le lien.

Une panne d’écriture donne 503 sans cookie de session, avec rollback et reprise en rouvrant le lien ou en resoumettant le formulaire encore valide. La page conseille cette reprise, sans présenter un faux succès. Le délai de verrou reste nul pendant l’écriture et revient ensuite à 5 000 ms. Le cookie de session n’est préparé qu’après commit. Une erreur réseau après commit reste une réponse perdue, pas un rollback de l’opération.

CSP finale après les en-têtes généraux : aucun chargement par défaut, style autorisé par empreinte SHA-256, formulaire same-origin, aucun cadre/base/script. no-store partout. La page GET/HEAD de confirmation réussie utilise strict-origin (en-tête et meta) : le vrai formulaire garde Origin, mais Referer ne contient que l’origine, jamais le chemin ni le jeton. no-referrer reste appliqué aux erreurs, au POST et aux redirections ; aucune valeur d’enveloppe, cookie, URL complète ou diagnostic brut dans les journaux de la route. Les pages ne changent pas la CSP des autres espaces.

## Compatibilité et retour arrière

Aucun schéma ou tableau nouveau. Les anciens liens de quinze minutes reconnus par le lot49 passent désormais par la confirmation ; leur retour interne historique est figé dans l’enveloppe. Les nouvelles destinations restent celles enregistrées lors de l’émission. Les trois sessions existantes du contrôle précédent restent compatibles ; aucune réattribution ni révocation globale.

Revenir au lot49 ferait de nouveau consommer le lien par GET ; ne pas restaurer une ancienne base pour annuler ce changement. Les anciennes confirmations ouvertes peuvent échouer après un déploiement ou une rotation : rouvrir le mail prépare la page courante.

## Preuves et limites

Recette sur comptes fictifs uniquement : GET/HEAD répétables, aucune session temporaire prise pour un compte, FR/DE/EN, changement explicite, pages périmées, refus d’origine/cookie/enveloppe/corps ambigus, expiration exacte, pannes SQLite et reprise. Clic réel sur serveur HTTPS fictif dans Chrome, puis Chromium 153, Firefox 155 et WebKit 26.6 via Playwright : FR/DE/EN, annulation, changement de compte, contexte périmé et panne/reprise. Origin canonique et Referer limité à l’origine vérifiés dans les trois moteurs. WebKit automatisé ne vaut pas une recette Safari/iPhone réelle. La version publique est ensuite contrôlée anonymement, sans envoyer de mail ni ouvrir un compte réel. Le détail des commandes et sorties reste dans la roadmap privée.

Ce parcours empêche la connexion silencieuse par GET et les POST tiers sans preuve du navigateur. Il ne prouve pas l’identité civile, ne fournit pas de MFA et ne protège pas d’une personne qui confirme volontairement un lien transmis par un fraudeur malgré l’adresse et l’avertissement. Un robot qui conserve les cookies, extrait la preuve et soumet réellement le formulaire peut imiter un clic ; la garantie de prévisualisation concerne GET/HEAD, pas toute automatisation possible.

Depuis le lot51, le cookie de session est __Host-osd_session en HTTPS, sans repli vers l’ancien osd_session. La reconnexion ferme la session exacte remplacée, sans révoquer les autres appareils. Les anciens navigateurs doivent demander un nouveau lien. Voir [cookies et transition de session](cookies-et-transition-de-session.md) pour la migration et ses limites.

Le lien demeure présent dans l’URL originale du mail et les jetons restent stockés comme auparavant dans sessions. Hachage en base, gestion des appareils, révocation globale, file durable des mails et récupération d’une réponse perdue restent distincts. Les protections de connexion ne remplacent pas le consentement MCP : application, titulaire et payeur restent à relier avec une demande OAuth immuable et authentifiée. Les abonnements restent fermés.

Références : [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), notamment session préalable, origine et interaction explicite ; [attributs et préfixes de cookies MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). Pas de certification de conformité déduite de ces références.

Le comportement du formulaire et de son en-tête Origin est décrit dans [MDN Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin) et [Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy). La recette navigateur vérifie aussi l’absence du jeton dans Referer.
