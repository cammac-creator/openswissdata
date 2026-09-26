# Créations de sessions de paiement

Le panneau Audience compte les réponses de création de sessions Stripe observées par l’application pour les achats de fichiers. Il distingue ces créations de l’affichage de la page de paiement, d’un paiement confirmé et d’une commande. Il ne calcule ni abandon, ni taux de conversion, ni rapprochement avec les échantillons ou une personne.

## Ce qui déclenche la mesure

Après `checkout.sessions.create`, l’observation exige une URL HTTPS, un identifiant `cs_live_` non vide, `livemode=true` et `mode=payment` dans la réponse Stripe. Les produits et la langue viennent des paramètres déjà validés par l’application. Un bundle compte une création ; plusieurs fichiers à l’unité constituent un panier « mixte ». Les répétitions d’un même produit ne modifient pas ce classement et le suivi ne change pas les quantités envoyées à Stripe.

L’événement réservé `checkout_started` est écrit sur la branche réussie de `/api/checkout/session` ou `/api/checkout/start`, jamais sur un simple HTTP 303 d’erreur. La voie API est marquée 200, le formulaire 303. La trace décrit la réponse que l’application prépare, sans attester que le navigateur l’a reçue.

Les prix, contrats, remises, langues, limites existantes, paramètres Stripe et réponses publiques restent inchangés. Les abonnements restent fermés dans la configuration actuelle. Aucun achat, remboursement ou email n’est déclenché par la mesure.

## Portée et confidentialité

La métadonnée fermée contient uniquement schéma 1, mode réel, type de panier, langue et voie API/formulaire. Aucun email, compte, identifiant de session Stripe, URL, contenu de formulaire, adresse IP ou agent utilisateur brut n’est ajouté à cette trace. Le pseudonyme HMAC quotidien et la classe d’agent réutilisent les règles d’audience existantes. La langue française par défaut n’est pas une préférence exprimée par un client.

Ces traces sont pseudonymes, pas anonymes. Le pseudonyme commun aux visites et l’heure précise rendent techniquement possible un rapprochement en base, notamment quand peu de ventes ont lieu : une comparaison avec les dates de sessions Stripe et de commandes pourrait identifier un acheteur et ses visites du même jour. Le pseudonyme change chaque jour suisse. Le CRM ne réalise pas ce rapprochement et n’expose pas les identifiants individuels. Les accès à la base et les 180 jours de conservation restent donc pertinents pour la protection des données ; ne pas qualifier cette collecte d’anonyme.

Les statistiques passent par la file facultative bornée, conservée 180 jours. Les preuves de paiement et de service résident dans les tables métier, hors de cette file. Une erreur de préparation ou d’écriture de mesure laisse le succès commercial intact et ne relance pas Stripe. Une interruption avant stockage, un redémarrage, une réponse Stripe perdue ou une saturation peuvent perdre une mesure.

Chaque appel réussi observé compte une création. Plusieurs demandes peuvent créer plusieurs sessions pour la même personne ; les identifiants Stripe ne sont pas conservés ici pour les dédupliquer. Le suivi n’est donc pas un registre exhaustif ou une source comptable. Les refus avant création, les sessions test, les réponses sans attestation du mode réel et les abonnements sont exclus.

## Lecture privée

Session administrateur obligatoire, `private, no-store`, agrégats uniquement. Calendrier suisse, période jusqu’au relevé, maximum 180 jours depuis ce relevé. Les origines externes, mauvais schémas, incohérences de statut/voie, dates futures ou métadonnées corrompues sont exclues. La première trace conservée n’est pas la date d’activation. L’historique n’est pas rempli rétroactivement.

Les identifiants `v2:` valides servent uniquement aux visiteurs-jours de navigateurs présumés ; les traces non identifiées restent explicites et les robots/outils/inconnus séparés. Ils ne sont pas des personnes uniques. Les paniers, langues et points d’entrée sont chacun des répartitions du même total, sans les additionner entre eux.

## Validation et retour arrière

Archives, bases, réponses Stripe et cookies de recette sont fictifs ; aucun appel de création réel n’est nécessaire pour valider le code. Vérifier aussi les conditions de vente et les redirections existantes. Aucun schéma ajouté : un retour arrière conserve et purge les traces comme les autres événements.

Références officielles relues le 26 septembre 2026 : [objet Checkout Session](https://docs.stripe.com/api/checkout/sessions/object), [création de session](https://docs.stripe.com/api/checkout/sessions/create). Les champs de création, mode réel, mode de paiement et URL y sont distincts du statut de paiement. Le SDK et sa version d’API ne sont pas modifiés par ce chantier.
