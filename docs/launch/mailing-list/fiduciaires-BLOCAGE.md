# Extraction fiduciaires — blocage signalé 2026-05-06

## Décision : extraction NON livrée. Décision utilisateur requise.

### Blocage 1 — Treuhandsuisse : restriction d'usage explicite

L'annuaire affiche : « Les informations dans cet annuaire ne peuvent être utilisées à des fins publicitaires. »

Un cold email pour promouvoir openswissdata.com tombe dans la catégorie publicité (LCD Art. 3 al. 1 let. o — mass mailing B2B sans opt-in = publicité déloyale en droit suisse). La `base_legale = "interet_legitime_B2B_email_public"` ne s'applique PAS à une source qui interdit explicitement l'usage commercial.

**Conséquence** : exclure Treuhandsuisse comme source, OU obtenir confirmation utilisateur explicite que l'on procède malgré la restriction (risque réputationnel + juridique).

### Blocage 2 — EXPERTsuisse : annuaire JS-rendered

Le directory `chercher-un-membre` est rendu côté client (ListeGrille dynamique). WebFetch ne voit que le shell HTML. Les pages des sections régionales (genevois, vaudois, etc.) ne contiennent pas non plus la liste des membres en statique — uniquement le président et le nombre de membres.

**Tentatives** : 4 WebFetch sur expertsuisse.ch → 0 cabinet extrait avec données utilisables.

### Blocage 3 — Budget WebFetch incompatible avec règle d'extraction

La règle « email UNIQUEMENT si trouvé sur site officiel ou pattern email standard du domaine » implique 1 WebFetch par site cabinet pour récupérer le contact.

Avec 15 WebFetch restants : 15-30 contacts max, loin de la cible 140-270.

## Sources alternatives recommandées (à valider avec utilisateur)

1. **Zefix** (registre commerce fédéral) — registre public sans restriction d'usage, mais **n'expose pas les emails**, uniquement adresse + raison sociale.
2. **Moneyhouse** — agrège Zefix + sites publics ; emails parfois exposés ; usage commercial autorisé sous conditions.
3. **EXPERTsuisse — accès membre** : si Alain a un compte / contact section, demander l'export.
4. **Annuaire local.ch / search.ch** — emails publics + rubrique « fiduciaires » par canton ; ToS plus permissifs.
5. **LinkedIn Sales Navigator** — segmentation par secteur + canton, opt-in via InMail (pas email cold).

## Action recommandée

Avant relance d'extraction, l'utilisateur doit choisir :
- (a) accepter restriction Treuhandsuisse et procéder (risque assumé),
- (b) basculer sur Moneyhouse/Zefix + sites cabinets directs,
- (c) demander à Alain s'il a un accès membre EXPERTsuisse pour export propre,
- (d) augmenter budget WebFetch (cible 140-270 nécessite ~50-80 fetch sites cabinets).

## Fichiers créés

- `fiduciaires-contacts.csv` : en-têtes uniquement, aucune donnée (header présent).
- `fiduciaires-BLOCAGE.md` : ce document.
