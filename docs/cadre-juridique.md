# Cadre juridique — 26 septembre 2026

## Périmètre et limites

Audit documentaire et technique du site, de l’achat de fichiers et des informations données aux clients. Ce travail ne constitue ni une consultation d’avocat, ni une certification de conformité, ni une garantie contre les réclamations. Les droits spécifiques de certaines sources et les accords effectivement conclus avec les prestataires demandent une vérification distincte ; leur suivi détaillé reste dans la roadmap privée A29.

## Changements

- Centre juridique et sept documents en français, allemand et anglais : ventes/licence, confidentialité, mentions, utilisation, provenance, communications, qualité/recours.
- Conditions du 26.09.2026 conservées à une adresse datée et en texte téléchargeable. Anciennes CGV 1.1 FR/DE archivées, sans acceptation rétroactive. Les versions contractuelles sont immuables ; les empreintes des trois traductions sont verrouillées dans les tests.
- Achat professionnel, description produit et corrections avant paiement, paiement unique, livraison réaliste, licence de compilation distincte des droits des sources, 360 jours de mises à jour, garantie commerciale existante de 14 jours et exceptions impératives aux limitations de responsabilité.
- Case Stripe obligatoire, métadonnées produites par le serveur ; preuve version/langue/empreinte/événement enregistrée avec la commande après signature du webhook. Le compte Stripe étant partagé, les liens spécifiques à OpenSwissData sont portés par chaque session ; aucun réglage global des autres activités n’est modifié.
- Contrat joint au mail dans la langue acceptée. Copie figée avec le message avant premier envoi ; reprise identique. L’absence de preuve dans un ancien achat ne bloque pas les droits payés et n’est jamais transformée en consentement supposé.
- Preuve consultable dans le compte du titulaire et le CRM. Les nouvelles licences des archives rappellent les engagements du contrat d’achat ; les anciennes archives signées ne sont pas réécrites.
- Notice de confidentialité alignée sur CRM, messagerie, traduction locale, événements pseudonymisés, fournisseurs et hébergement principal à Amsterdam. Aucun DPA n’est déclaré signé sans preuve. Identité conservée dans les documents nécessaires, retirée du pied de page systématique et adresse retirée du balisage global.

## Références primaires consultées

- [SECO — commerce électronique](https://www.seco.admin.ch/fr/commerce-electronique) : identité, contact, étapes, correction et confirmation électronique.
- [Portail PME — CGV](https://www.kmu.admin.ch/fr/conditions-generales-de-vente) et [révocation](https://www.kmu.admin.ch/fr/quest-ce-quun-droit-de-revocation) : information contractuelle et distinction entre droit légal et garantie volontaire.
- [SECO — clauses abusives](https://www.seco.admin.ch/fr/conditions-generales-abusives), [Code des obligations](https://www.fedlex.admin.ch/eli/cc/27/317_321_377/fr) : ne pas exclure la faute grave ou d’autres droits impératifs.
- [PFPDT — information](https://www.edoeb.admin.ch/fr/devoir-dinformer), [sous-traitance](https://www.edoeb.admin.ch/fr/externalisation-sous-traitance), [transferts](https://www.edoeb.admin.ch/fr/communication-de-donnees-a-letranger) : décrire les traitements réels et documenter les garanties.
- [Union européenne — vente à distance](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_fr.htm) : les règles impératives des consommateurs ne disparaissent pas par une déclaration professionnelle. Pas de parcours B2C ou de renonciation au retrait ajouté.
- [Stripe — personnalisation et conditions](https://docs.stripe.com/payments/checkout/custom-components) : case obligatoire, texte spécifique, état de consentement retourné.
- [Railway — régions](https://docs.railway.com/deployments/regions) : région Amsterdam contrôlée dans la configuration réelle. [DPA Railway](https://railway.com/legal/dpa) : distinguer document public et accord exécuté.

## Procédure de prochaine version

1. Créer un nouveau fichier de contrat sans modifier celui déjà publié ; conserver toutes les versions dans `src/legal/catalog.ts`.
2. Ajouter les pages datées et `.txt` des trois langues, servir leur document explicite, puis changer la version courante et le texte Stripe. Conserver les anciens liens et pièces jointes.
3. Tester une session Stripe sans paiement et l’expirer ; vérifier visuellement les liens propres au projet. Ne pas créer de faux achat accepté dans la base.
4. Vérifier les engagements des fiches produit, la compatibilité avec les anciens achats et les contrats de source.
5. Faire relire, tester, publier et relire les empreintes réellement servies. Toute validation juridique professionnelle doit être qualifiée séparément d’une revue de code.
