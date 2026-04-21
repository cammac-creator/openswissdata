# Correspondance légale — openswissdata.com

## Demandes de permission commerciale

| Destinataire | Sujet | Envoyé le | Réponse | Statut |
|--------------|-------|-----------|---------|--------|
| info@bfs.admin.ch | NOGA 2025 + cross-walks | 2026-04-17 | — | en attente (relance 2026-04-24) |
| info@finma.ch | FINMA Registry compilation | 2026-04-17 | — | en attente (relance 2026-04-24) |
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

- [ ] Ajouter la mention DE/FR/EN « Non-officiel » dans le README du bundle TARES (modifier `etl/tares/bundle.ts` : constantes `DATASET_LICENSE` et `readme`).
- [ ] Ajouter un bandeau visuel « Non-officiel · Source autoritative : xtares.admin.ch » en haut de `web/src/pages/datasets/tares.astro`.
- [ ] Mettre à jour `LICENSE.txt` spécifiquement pour TARES avec la clause de non-officialité + for juridique Berne (distinct des autres datasets dont le for reste canton d'Alain).
- [ ] Fixtures actuelles vérifiées : `sample-5-rows.json` ne contient que code/désignation/droit/régime/restrictions, pas de notes explicatives → ✅ conforme.
- [ ] Pour le scraping réel futur (Task 2.4), **exclure explicitement** les colonnes notes explicatives (« Erläuterungen ») et décisions de classification (« Entscheide ») de l'ingestion.
- [ ] Ajouter dans CGV une section spécifique TARES avec for Berne.
- [ ] Vérifier que `source_url` pointe sur la fiche HS8 spécifique (ex. `https://xtares.admin.ch/tares/control/searchSimpleTarifNumber?number=84820010`) et pas sur la racine du site.

## Réponse FINMA — en attente

Relance prévue 2026-04-24 (7 jours après envoi initial).

## Réponse BFS — en attente

Relance prévue 2026-04-24.
