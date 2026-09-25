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
- Bronze de traitement des connecteurs : sous le volume, chiffré avec une clé dérivée de `OSD_BACKUP_KEY`, dédoublonné par empreinte et jour, purge des éléments de plus de 30 jours lors de la prochaine consultation, plafond 250 Mo. Ce sont des copies de traitement, pas une sauvegarde complète des boîtes. Ne pas modifier les fichiers ; les originaux restent chez leurs fournisseurs.
- Aucun cookie, corps de requête, paramètre de lien d’accès ni mot de passe dans Sentry. Les traces de requêtes sont exclues des rapports d’erreurs.
