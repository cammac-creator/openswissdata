---
paths:
  - "src/routes/crm*.ts"
  - "src/routes/admin*.ts"
  - "src/routes/health.ts"
  - "src/lib/crm-*.ts"
  - "src/lib/admin-*.ts"
  - "src/lib/deep-health*.ts"
  - "src/lib/translation-*.ts"
  - "src/lib/customer-service.ts"
  - "src/lib/languages.ts"
  - "web/src/pages/admin.astro"
  - "web/src/admin/**"
  - "scripts/check-admin-csp*.mjs"
  - "tests/routes/crm*.ts"
---

# Bureau privé, CRM et diagnostic

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

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

## Diagnostic des dépendances — 26.09.2026
- `/api/health/deep` est privé, exige la session administrateur et ne retourne aucun message fournisseur brut. Le bouton de l’espace Automatisations le déclenche à la demande ; aucun appel profond au chargement du CRM.
- Une seule vérification simultanée par processus, cache de 60 secondes y compris les échecs, délai de 3 secondes par dépendance. Stripe : délai SDK 2,5 secondes et aucune relance ; R2 : une tentative, signal d’annulation et client détruit.
- Les moniteurs publics utilisent `/ready` (base et site) et `/freshness` (FINMA), sans appel à un fournisseur. Une vérification de connexion réussie ne prouve ni livraison, ni droits, ni téléchargement complet. Le cache n’est pas partagé entre réplicas ; réévaluer avant de multiplier les instances.

## Scripts du bureau — 26.09.2026
- La CSP du fichier admin/index.html est durcie après secureHeaders, sur le fichier réellement trouvé par serveStatic, pas sur un préfixe d’URL présumé. Scripts de même origine seulement (le build impose des modules), aucun script inline ou gestionnaire HTML, pas de base ni d’objet intégré. Les styles inline et les anciennes pages publiques/compte restent des sujets distincts.
- admin:csp:check fait partie de web:build ; il exige le module local produit par Astro et refuse toute réintroduction de script inline dans l’artefact. Ne pas rétablir unsafe-inline pour faire passer une interface cassée. Sources et limites : docs/securite-du-bureau.md.
- createApp({webRoot}) accepte un dossier explicite pour les tests statiques temporaires ; aucun paramètre HTTP et aucun démarrage de worker. Ne pas écrire une fausse page admin dans le build partagé pour tester ses en-têtes.
