# Correspondance légale — openswissdata.com

## Demandes de permission commerciale

| Destinataire | Sujet | Envoyé le | Réponse | Statut |
|--------------|-------|-----------|---------|--------|
| info@bfs.admin.ch | NOGA 2025 + cross-walks | 2026-04-17 | — | en attente (relance 2026-04-24) |
| info@finma.ch | FINMA Registry compilation | 2026-04-17 | 2026-05-06 | **✅ GO sans condition particulière** (sous réserve droits d'auteur + intégrité documents) |
| info@bazg.admin.ch | TARES dérivé normalisé | 2026-04-17 | 2026-04-21 | **✅ GO avec conditions** |

## Réponse BAZG (TARES) — 2026-04-21

Répondu par Michael Beer, Chef Tarifgrundlagen, BAZG Zolltarif und Tarifgrundlagen (michael.beer@bazg.admin.ch).

**Conditions strictes à respecter :**

1. **Données non modifiables dans leur contenu** : la normalisation de forme (UTF-8, formats multiples, hiérarchie) est autorisée, mais les valeurs (codes HS8, désignations, droits, régimes) ne doivent pas être altérées.
2. **Mention obligatoire DE à inclure dans chaque livrable** : *« Dies ist keine offizielle Veröffentlichung. Massgebend sind allein die Veröffentlichungen durch die Bundeskanzlei und das Bundesamt für Zoll- und Grenzsicherheit BAZG. »*
   - Traductions FR/EN équivalentes à produire et à placer dans : README du ZIP, footer page `/datasets/tares`, disclaimer CGV, LICENSE.txt.
3. **Interdictions absolues** :
   - Pas d'utilisation de la dénomination « Gebrauchszolltarif », « Tares » ou équivalents d'une manière qui suggère un produit officiel BAZG.
   - Pas de logo BAZG, pas de copie conforme de la page (header/logo) hors intégration officielle via lien.
   - **Les « Erläuterungen und Entscheide » (notes explicatives et décisions de classification) NE DOIVENT PAS être redistribués.** Seules les données tarifaires brutes (code HS8, désignation, droit MFN, régimes préférentiels, restrictions codifiées) peuvent l'être.
4. **Mises à jour à notre charge** : déjà prévu (release hebdomadaire versionnée). Indiquer « Dernière mise à jour : YYYY-MM-DD HH:MM » visible sur la page produit et dans le ZIP.
5. **Aucune garantie BAZG sur l'interprétation**. Disclaimer déjà dans LICENSE.txt — à renforcer avec la clause explicite du mail.
6. **For juridique pour tout litige TARES = Berne.**
7. Respect strict des Nutzungsbedingungen de la page d'accueil Tares.

**Actions de mise en conformité à planifier :**

- [x] Ajouter la mention DE/FR/EN « Non-officiel » dans le README du bundle TARES (modifier `etl/tares/bundle.ts` : constantes `DATASET_LICENSE` et `readme`). *(fait 2026-04-16)*
- [x] Ajouter un bandeau visuel « Non-officiel · Source autoritative : xtares.admin.ch » en haut de `web/src/pages/datasets/tares.astro`. *(fait 2026-04-16)*
- [x] Mettre à jour `LICENSE.txt` spécifiquement pour TARES avec la clause de non-officialité + for juridique Berne (distinct des autres datasets dont le for reste canton d'Alain). *(fait 2026-04-16 — `DATASET_LICENSE` dans `etl/tares/bundle.ts` remplacé par version TARES-spécifique avec for Berne)*
- [x] Fixtures actuelles vérifiées : `sample-5-rows.json` ne contient que code/désignation/droit/régime/restrictions, pas de notes explicatives → ✅ conforme.
- [x] Pour le scraping réel futur (Task 2.4), **exclure explicitement** les colonnes notes explicatives (« Erläuterungen ») et décisions de classification (« Entscheide ») de l'ingestion. *(fait 2026-04-16 — guard `assertNoForbiddenFields()` dans `etl/tares/normalize.ts` + commentaire FORBIDDEN dans `etl/tares/types.ts`)*
- [ ] Ajouter dans CGV une section spécifique TARES avec for Berne. *(pending — Task 2.5)*
- [ ] Vérifier que `source_url` pointe sur la fiche HS8 spécifique (ex. `https://xtares.admin.ch/tares/control/searchSimpleTarifNumber?number=84820010`) et pas sur la racine du site. *(pending — Task 2.4 scraping)*

## Réponse FINMA (Registry) — 2026-05-06

Répondu par Nadine Bucher, Communication, Eidgenössische Finanzmarktaufsicht FINMA, Laupenstrasse 27, CH-3003 Bern (info@finma.ch).

**Texte intégral de l'autorisation :**

> Monsieur,
>
> Nous nous référons à votre courriel du 17 avril 2026 et vous remercions pour vos coordonnées.
>
> La FINMA publie ses données sur son site Internet (www.finma.ch), où elles peuvent être consultées. Nous vous renvoyons aux conditions d'utilisation qui y sont énoncées (Conditions d'utilisation | FINMA).
>
> D'un point de vue juridique, nous n'avons aucune objection à ce que vous utilisiez des données de la FINMA accessibles au public comme source de données pour votre produit, sous réserve du respect des droits d'auteur de la FINMA et de l'intégrité des documents sources, comme indiqué dans votre courriel.
>
> Avec nos meilleures salutations.
>
> Nadine Bucher · Communication · FINMA

**Conditions implicites à respecter :**

1. **Respect des droits d'auteur FINMA** — copyright revendiqué sur les contenus éditoriaux du site FINMA. La LDA art. 5 exclut toutefois les actes officiels (décisions, listes d'autorisation publiques) de la protection. Les listes du registre des entités sous surveillance entrent dans cette catégorie.
2. **Intégrité des documents sources** — ne pas altérer le contenu des données (noms d'entités, statuts d'autorisation, dates, références FINMA). La normalisation de forme (schéma unifié sur 10 listes, enrichissement UID/LEI) est compatible avec l'intégrité par enregistrement.
3. **Logo FINMA strictement interdit** (cf. CGU FINMA : « Using and reproducing the FINMA logo is not permitted »). Texte « FINMA » seul autorisé.
4. **Disclaimer FINMA répercuté** : aucune garantie d'exactitude / fiabilité / exhaustivité ; aucune affiliation FINMA. Disclaimer déjà dans `LICENSE.txt` du bundle FINMA et dans `web/src/pages/compliance.astro` section 5.

**Référence interne :** `FINMA-PERMISSION-2026-05-06-NADINE-BUCHER`. Email original archivé.

**Actions de mise en conformité :**

- [x] Mettre à jour `web/src/pages/datasets/finma.astro` (FR/DE/EN) — passer de « demandée » à « accordée 2026-05-06 ». *(fait 2026-05-06)*
- [x] Mettre à jour `web/src/pages/compliance.astro` (FR/DE/EN) — tableau des permissions. *(fait 2026-05-06)*
- [x] Mettre à jour `web/src/pages/legal/provenance.astro` (FR/DE) — ajouter texte intégral de l'autorisation FINMA + lien CGU FINMA. *(fait 2026-05-06)*
- [x] Mettre à jour FAQ home (FR/DE/EN). *(fait 2026-05-06)*
- [ ] Vérifier que `etl/finma/release.ts` n'altère aucune valeur source (noms d'entités, statuts, dates) — audit à planifier.
- [ ] S'assurer qu'aucun logo FINMA n'apparaît dans le repo / sur le site (texte seul autorisé).

## Réponse BFS — en attente

Relance prévue 2026-04-24.

## Réponse BFS — en attente

Relance prévue 2026-04-24.
