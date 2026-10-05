---
paths:
  - "src/lib/order-*.ts"
  - "src/lib/delivery*.ts"
  - "src/lib/incident*.ts"
  - "src/lib/stripe*.ts"
  - "src/lib/checkout*.ts"
  - "src/routes/checkout.ts"
  - "src/routes/stripe-webhook.ts"
  - "src/routes/download.ts"
  - "src/legal/**"
  - "web/src/content/legal*.ts"
  - "web/src/pages/**/legal/**"
  - "web/src/components/CheckoutNotice.astro"
  - "web/src/lib/checkout-measures.ts"
  - "tests/routes/**"
  - "tests/lib/delivery*.ts"
  - "tests/lib/order-*.ts"
  - "tests/lib/checkout*.ts"
---

# Argent, livraisons et preuves d'achat (chemins F2 : toute modification est BOUTON, voir AGENTS.md)

Sections déplacées mot pour mot depuis AGENTS.md le 02.10.2026 (charte osd.N01).

## Livraisons des achats de fichiers
- Le webhook confirme le paiement, la devise CHF et le mode Stripe avant d'accorder les droits. Une remise totale validée par Stripe reste livrable. Les paiements différés attendent leur confirmation.
- Commande, droits et `order_deliveries` sont enregistrés ensemble. Le worker reprend les nouveaux achats chaque minute ; aucune ancienne commande n'est remise en file automatiquement.
- Le corps du mail est figé avant son premier envoi, avec une clé Resend fondée sur la session Stripe. Après 23 h d'incertitude : état `review`, contrôle humain dans le prestataire avant tout nouvel envoi. Les corps sont effacés après remise, annulation ou passage en vérification.
- Les liens des mails et nouveaux liens de partage passent par une confirmation GET, puis un téléchargement POST. Un double clic est toléré pendant 90 s à compter de la première utilisation, sans prolongation. Aucun jeton dans les événements d'audience.
- Retour arrière : consulter d'abord les livraisons en attente dans le CRM. L'ancien code ne traite pas cette file ; un retour arrière impose de conserver les lignes et de reprendre leur traitement avec une version compatible.
- Ce mécanisme concerne les achats de fichiers. La livraison des clés d'abonnement reste un chantier distinct.
- Présentation de /api/delivery/:token (29.09.2026) : HTML seulement dans `src/lib/delivery-page.ts`. Langue d'une page GET : `?lang=`, sinon navigateur, sinon français. `redeemDownload` et `/api/download/:token` (réponses texte) restent inchangés ; le POST recopie statut et en-têtes et ne remplace que le corps d'un refus, choisi par la table statut + texte (couple inconnu = erreur générique). Formulaire : même cible, aucun champ ; le jeton n'apparaît que dans cette cible. Ne pas élargir la CSP (ni police, ni image, ni script). Les refus suivent Accept-Language. `tests/routes/delivery-contract.test.ts` fige codes, en-têtes, redirection, formulaire et traces : le modifier est un changement de livraison, pas de présentation. Un nouveau refus texte doit entrer dans la table (`delivery-page.test.ts` le vérifie).

## Remboursements et contestations des fichiers
- Notifications Stripe signées enregistrées en file, dédoublonnées ; relecture canonique du paiement, de toutes ses pages de remboursements et de contestations, via un compartiment bronze chiffré distinct des mails (30 jours, 64 Mo). Version API Stripe figée sur celle du SDK. Aucune opération de remboursement déclenchée par l'application. Reprise chaque minute, relecture de contrôle toutes les six heures ; incidents visibles dans Automatisations.
- Seuls les remboursements `succeeded` sont déduits. Remboursement partiel : droits conservés, montant net dans le CRM, examen commercial dans Stripe. Remboursement complet : droits de cet achat retirés. Contestation ouverte : suspension ; perdue : retrait ; gagnée : restauration des droits acquis. Une simple demande d'information bancaire ne suspend pas les droits.
- `order_grants` garde la période de chaque achat ; `entitlements` est sa vue des commandes payées. Une modification financière ne retire pas les droits d'un autre achat. Migration historique bornée par les accès présents et les 360 jours de l'ancien webhook ; aucune ancienne livraison n'est créée. Ne pas modifier directement la vue sans son historique. Les liens historiques vers une commande appartenant à un autre client ne sont pas importés ; la capture des droits manquants se refait au démarrage après un retour temporaire à une ancienne version.
- Une notification plus récente invalide toute lecture Stripe encore en vol. Erreurs, pages tronquées, mode ou montants incohérents ne sont jamais interprétés comme un remboursement nul. Les nouvelles commandes avec une notification en attente attendent son rapprochement avant leurs droits et leur livraison. Une simple relecture périodique en panne ne bloque pas une livraison déjà validée.
- Aucun renvoi automatique d'un mail déjà accepté. Après restauration des droits, une livraison dont le résultat était incertain passe en vérification manuelle ; une livraison jamais tentée peut reprendre. Un lien R2 déjà signé peut rester utilisable jusqu'à son expiration de cinq minutes ; aucun mécanisme ne rappelle un fichier déjà téléchargé.
- Les chiffres du CRM déduisent les remboursements confirmés à la date de l'achat et excluent les contestations ouvertes/perdues ; ce n'est pas un relevé bancaire. Les abonnements MCP ne sont pas couverts par ce rapprochement des commandes de fichiers.

## Conditions de vente et preuve contractuelle — 26.09.2026
- Les achats de fichiers demandent l’acceptation des CGV chez Stripe, dans la langue du parcours (français par défaut). Le compte Stripe est partagé : ne pas modifier ses réglages juridiques globaux sans vérifier les autres projets. Les liens de CGV et confidentialité OpenSwissData sont fournis dans le texte spécifique de chaque session.
- Contrats figés dans `src/legal/terms-YYYY-MM-DD.ts`, répertoriés dans `src/legal/catalog.ts`. Ne jamais modifier un contrat publié : ajouter une version, ses trois pages datées et ses trois endpoints texte `.txt.ts`, et conserver les anciennes routes, fichiers texte et empreintes. Les tests verrouillent les empreintes acceptées. Les pages datées servent le même contenu que la pièce jointe.
- `order_legal` est écrit dans la transaction commande/droits/livraisons, à partir de l’événement Stripe signé. Version/langue/empreinte doivent être connues et `consent.terms_of_service` accepté. Sinon statut explicite `legacy` ou `unverified`, sans inventer une acceptation et sans priver l’achat payé de sa livraison. Aucun remplissage rétroactif des achats historiques.
- Les CGV acceptées sont jointes au mail, dans leur langue contractuelle même si la correspondance est dans une autre langue. Le corps et la pièce jointe sont figés ensemble avant le premier essai. Les liens sont visibles dans le compte du titulaire et le CRM autorisé.
- Les CGV 1.1 FR/DE sont archivées ; les anciennes archives de données signées ne sont pas réécrites. Les nouvelles licences des ZIP rappellent la priorité des conditions convenues lors de chaque achat et les droits propres aux sources.
- Les textes ne constituent pas une validation d’avocat. Le suivi privé A29 conserve les vérifications contractuelles des prestataires, des transferts et des droits de sources encore nécessaires. Ne pas déclarer un DPA signé ou une conformité générale sur la seule présence d’un document public chez un fournisseur.

## Chronologie du service — 26.09.2026
- `download_activity` conserve au plus 180 jours de traces minimales : compte, produit, version, origine et dates ; aucun lien secret, IP ou contenu de mail. Les liens email sont rattachés à leur commande ; les accès du compte ne sont pas attribués arbitrairement à un achat. Aucun remplissage rétroactif.
- Un HTTP 2xx Resend prouve l’acceptation de la demande, pas la livraison/lecture. Son identifiant est conservé dans `order_deliveries`, puis effacé après 180 jours. Un corps 2xx illisible ne déclenche jamais un second envoi.
- Une prévisualisation GET du nouveau lien ne produit pas de trace d’utilisation. Une autorisation réussie ne prouve ni identité du lecteur, ni téléchargement complet, ni ouverture du fichier. Les anciens liens GET peuvent être consultés par des robots.
- Le CRM expose uniquement les métadonnées nécessaires ; les liens de connexion/livraison sont masqués avant affichage. Les originaux des connecteurs restent bruts, chiffrés dans le bronze autorisé, avec purge distincte.
- Retour arrière : garder une version de nettoyage compatible avec `download_activity` et `provider_message_id`. Ne pas désactiver leur purge en restaurant l’ancien code. L’effacement de compte (dix ans sans commande) retire ces traces explicitement ; une commande n’est effacée que par sa propre règle de dix ans.

## Registre privé des incidents de livraison — 26.09.2026
- Un dossier par order_delivery, observations minimales sans adresse, corps, jeton, lien signé, référence fournisseur ni erreur brute. Lecture CRM administrateur, pages de 20 ; historique à curseur par 50. Une relecture identique ne crée pas d’échec supplémentaire.
- Le worker de livraison observe son résultat après écriture ; une panne de registre ne remet pas un mail accepté en file. Aucun hook dans la transaction financière : la relève lit les états après commit. Si un observateur imbriqué subit un rollback de toute la transaction, l’erreur doit être propagée, jamais avalée avant des écritures en autocommit.
- Acceptation du prestataire ≠ réception ou ouverture. Annulation/suspension financière ≠ envoi réussi. Une acceptation après perte du bail ou changement d’état ouvre une alerte persistante de contrôle humain ; aucun rétablissement de droits ni renvoi. Voir « Clôture manuelle des incidents — 29.09.2026 ».
- Relève après 30 secondes, puis chaque minute, au plus 200 candidats par passage ; elle n’appelle aucun service externe. createApp et les processus de tests/restauration ne la démarrent pas. Le témoin delivery_incident_scan conserve date, limite et erreurs ; l’absence ou l’ancienneté reste visible. Des transitions brèves manquées ne sont pas reconstituées.
- Journal technique et dossiers clos expirent à 180 jours ; dossiers ouverts conservés. Un dossier clos remis en file n’est pas purgé. Les nouvelles catégories delivery_incident_events/delivery_incidents portaient le nettoyage normal à 13 catégories avant l’ajout de Checkout ; un ancien témoin incomplet ne prouve pas leur purge. Garder cette conservation en cas de retour arrière de code.
- Seule la règle des dix ans supprime commandes et livraisons, en traitant explicitement le registre, ses preuves et liaisons, sans cascade.
- Une action interne peut être créée explicitement depuis un incident ouvert. delivery_incident_tasks impose une seule liaison par incident ; transaction tâche/liaison et créateur issu de la session. Rejeu = action existante, sans remplacement d’échéance ni réouverture implicite. Avant première création, relire l’état de livraison. La relève ne crée/ferme aucune tâche, et cocher une tâche ne ferme jamais un incident.
- Purger un incident technique détache la liaison mais conserve sa tâche. Tâches et notes suivent la règle des trois ans. Le profil de vérification des sauvegardes service-crm-2026-09-26 contrôle aussi les colonnes essentielles du suivi privé ; les anciens témoins sans ce profil restent explicitement historiques.

## Clôture manuelle des incidents — 29.09.2026
- Table additive delivery_incident_resolutions, en ajout seul : type fermé (provider_delivery_verified, customer_contacted, manual_resend, no_action), note de 1 à 280 caractères sans adresse, lien ni identifiant (refus serveur note_*), heure du serveur, auteur issu de la session, instantané raison/observations/tentative/états. delivery_incidents garde son état machine ; ne pas ajouter d'état CHECK pour cela.
- « Clos manuellement » = dossier open dont la dernière clôture a mêmes observations, raison, last_delivery_state et last_order_state (INCIDENT_STATUS_SQL, prédicat unique pour résumé, sélections, action et écriture). Toute nouvelle observation ou tout changement d'état enregistré le remet « à vérifier » sans effacer la preuve. La relève n'écrit jamais dans cette table ; aucune action de suivi n'est créée sur un dossier clos (409 incident_resolved).
- POST /api/admin/crm/incidents/:id/resolution : garde CRM habituelle, état attendu complet, relecture de la livraison dans une transaction immédiate sans attente de verrou (503 incident_busy, Retry-After, rien d'écrit), 409 incident_changed/incident_closed/incident_clock_pending, rejeu = clôture existante. « Nouvel envoi manuel » est une déclaration : aucune écriture sur livraison, commande, droits ou tâche.
- Un dossier clos manuellement n'est pas purgé tant que la livraison garde l'état signalé (la relève le recréerait) ; son journal technique expire à 180 jours. Après une clôture machine, la purge existante détache la preuve (incident_id NULL, delivery_id conservé) sans la supprimer. cleanup.ts et ses catégories sont inchangés. L’effacement d’une commande supprime explicitement ces preuves ; un compte auteur n’est jamais effacé.
- Profil de restauration service-crm-2026-09-29 (29.09) : ajoute la table des preuves de clôture ; passage réel réussi le 29.09 (36554194088), backup-db.yml n'accepte plus que ce profil. Retour arrière : garder la table ; l'ancien code l'ignore sans erreur. Voir docs/incidents-de-livraison.md.
- Bureau : sur Safari et iPhone, un bouton touché ne prend pas le focus (il passe à main#content) ; un ancêtre du panneau compte comme son contexte pour rendre le focus après une relecture.

## Mesures après achat — 26.09.2026
- Le panneau Audience lit les commandes actuellement payées de la période suisse, réelles et hors comptes internes. Même règle que les ventes ; aucun ratio visites/commandes ou étape Checkout inventé. Une commande et un client distinct sont deux unités différentes.
- Tous les fichiers d’un bundle doivent avoir une acceptation datée cohérente pour compter la commande complète. Les preuves d’accès par mail sont dédupliquées par commande et limitées à 180 jours depuis la création de la trace. Les accès du compte ne sont pas attribués à un achat ; absence de trace, réception et téléchargement complet restent distincts. Voir docs/mesures-apres-achat.md.
- Agrégats dans la transaction de lecture Audience, aucune écriture de droit, paiement ou livraison. Index additif download_activity(order_id,created_at), compatible avec retour arrière ; tests et mesures de volume uniquement fictifs.

## Créations Checkout — 26.09.2026
- `checkout_started` est observé uniquement après une réponse Stripe de création attestant URL, mode réel et paiement de fichiers. Le formulaire peut aussi retourner 303 en erreur : ne jamais assimiler le seul statut à une création. Aucun identifiant Stripe ou client dans cette mesure facultative.
- Ne pas modifier le parcours d’achat ni relancer Stripe lorsqu’une statistique échoue. Les preuves de vente restent transactionnelles et séparées. Les créations observées ne prouvent ni affichage de Checkout, ni abandon, ni paiement ; détails dans `docs/mesures-checkout.md`.

## Protection des demandes de paiement — 26.09.2026
- Ne pas ajouter un proxy Cloudflare/CDN devant Railway sans revoir et revalider trustedRequestIp sur deux réseaux distincts.
- Formulaire et API Checkout partagent six secondes par adresse validée (IPv6 /64), conservées dans SQLite après redémarrage. Réutiliser trustedRequestIp ; ne jamais revenir au premier X-Forwarded-For fourni librement. L’absence d’adresse valide partage une seule identité inconnue.
- checkout_request_limits conserve uniquement une clé HMAC dédiée et deux dates ; plafond de 10 000 lignes sans éviction des limites actives. Refus 429 sans prolongation et Retry-After ; clé, stockage, horloge ou capacité indisponibles donnent 503 avant Stripe. Aucune attente de verrou SQLite pour cette protection.
- Corps limité à 4 096 octets, réponses no-store. Tests de protection actifs même avec NODE_ENV=test ; les tests métier peuvent simuler explicitement le garde. Ne pas appeler Stripe réellement pour la recette.
- Table additive, sauvegarde avant publication ; purge périodique porte le témoin complet à 14 catégories. Le profil de restauration service-crm-2026-09-26 conserve sa définition métier ; les compteurs temporaires ne sont pas des preuves d’achat. Détails et limites : docs/protection-checkout.md.
