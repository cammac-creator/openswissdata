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
