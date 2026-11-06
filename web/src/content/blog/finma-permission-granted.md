---
title: "Réponse de la FINMA : aucune objection pour notre produit, sous conditions"
description: "La FINMA a répondu par écrit ne pas avoir d'objection à ce qu'openswissdata utilise ses données publiques comme source de données pour son produit, sous réserve du respect de ses droits d'auteur, de l'intégrité des documents sources et de ses conditions d'utilisation."
publishedAt: 2026-05-06
updatedAt: 2026-11-06
keywords: ["FINMA", "permission", "compliance", "republication", "openswissdata", "annonce"]
dataset: "finma"
tldr: "Le 6 mai 2026, la FINMA (Communication, Nadine Bucher) a répondu à notre demande du 17 avril : aucune objection juridique à l'utilisation de ses données publiques comme source de données pour notre produit, sous réserve du respect de ses droits d'auteur et de l'intégrité des documents sources, avec un renvoi à ses conditions d'utilisation. Ce n'est ni une autorisation générale de redistribution, ni une approbation du produit."
---

Le **6 mai 2026**, openswissdata a reçu une réponse écrite de la **Communication FINMA** (Eidgenössische Finanzmarktaufsicht, signée Nadine Bucher) à la demande envoyée le 17 avril 2026.

## Le texte intégral de la réponse

> Nous nous référons à votre courriel du 17 avril 2026 et vous remercions pour vos coordonnées.
>
> La FINMA publie ses données sur son site Internet (www.finma.ch), où elles peuvent être consultées. Nous vous renvoyons aux conditions d'utilisation qui y sont énoncées.
>
> **D'un point de vue juridique, nous n'avons aucune objection à ce que vous utilisiez des données de la FINMA accessibles au public comme source de données pour votre produit, sous réserve du respect des droits d'auteur de la FINMA et de l'intégrité des documents sources, comme indiqué dans votre courriel.**
>
> Avec nos meilleures salutations.
>
> *Nadine Bucher · Communication · Eidgenössische Finanzmarktaufsicht FINMA · Laupenstrasse 27, CH-3003 Bern*

## Ce que cela change concrètement

Avant le 6 mai, le dataset FINMA Registry était publié sous la base de l'article 5 de la Loi fédérale sur le droit d'auteur (LDA) — qui exclut les œuvres officielles de la protection — et de la valeur ajoutée de normalisation. C'est un fondement juridique solide pour des registres publics suisses, et il reste valable.

Avec l'écrit du 6 mai, on ajoute un deuxième élément : **la réponse écrite de l'autorité émettrice elle-même**, qui n'a aucune objection à l'utilisation de ses données publiques comme source de données pour notre produit, sous réserve de ses conditions. Ce n'est pas une autorisation générale de redistribution. Concrètement, pour un acheteur du dataset FINMA Registry :

- La réponse est conservée dans notre correspondance avec les sources et peut être communiquée sur demande
- La page [/legal/provenance](/legal/provenance) précise sa portée : ni certification du produit, ni autorisation pour toute utilisation
- Le fichier livré mentionne cette réponse et ses conditions dans `LICENSE.txt` et dans le README

## Conditions à respecter

La réponse pose deux conditions : « *respect des droits d'auteur de la FINMA et intégrité des documents sources* ». En pratique cela signifie pour openswissdata :

1. **Respect des droits d'auteur FINMA** — le copyright revendiqué par la FINMA porte sur les contenus éditoriaux du site (articles, communiqués). Les **listes du registre des entités sous surveillance** sont des actes officiels au sens de l'art. 5 LDA et ne sont pas couvertes par le droit d'auteur ; elles peuvent donc être normalisées et redistribuées librement.
2. **Intégrité des documents sources** — ne pas altérer le contenu des données source (noms d'entités, statuts d'autorisation, dates, références FINMA). La normalisation de forme (schéma unifié sur les 10 listes, enrichissement UID/LEI, formats CSV/JSON/Parquet) reste compatible avec l'intégrité par enregistrement.
3. **Logo FINMA strictement interdit** — selon les [conditions d'utilisation FINMA](https://www.finma.ch/en/terms-and-conditions/), « *Using and reproducing the FINMA logo is not permitted* ». Le nom « FINMA » lui-même reste autorisé en attribution écrite. Aucun logo FINMA n'apparaît dans le repo openswissdata ni sur le site.
4. **Disclaimer répercuté** — la FINMA décline toute responsabilité quant à l'exactitude, la fiabilité et l'actualité des données ; openswissdata ne peut pas garantir mieux que la source. Le `LICENSE.txt` de chaque livraison du dataset FINMA Registry rappelle que la compilation ne remplace pas la consultation du registre officiel à jour.

## État des demandes au 6 mai 2026

| Source | Dataset | Statut | Date |
|---|---|---|---|
| **BAZG** (Bundesamt für Zoll und Grenzsicherheit) | TARES | ✅ Permission écrite acquise | 2026-04-21 |
| **FINMA** (Eidgenössische Finanzmarktaufsicht) | FINMA Registry | ✅ Aucune objection écrite, sous conditions | **2026-05-06** |
| **OFS / BFS** (Office fédéral de la statistique) | NOGA / Classifications | ⏳ Demande envoyée, en attente | 2026-04-17 |

Les datasets dérivés de l'OFS (NOGA, NACE, ISIC) restent publiés sous le seul fondement LDA art. 5 + valeur ajoutée — toute restriction qui découlerait d'une réponse écrite serait communiquée aux acquéreurs avec option de remboursement et procédure de takedown sous 24 heures (voir [/compliance](/compliance)).

## Pour aller plus loin

- [Datasets FINMA Registry](/datasets/finma) — 299 CHF one-shot, 360 jours de mises à jour incluses
- [Page Provenance](/legal/provenance) : sources et portée de cette réponse
- [Page Compliance](/compliance) — tableau des sources, fondements juridiques, takedown 24h
- [Guide : automatiser le contrôle FINMA de vos contreparties](/guides/finma-screening-automation/) — méthode sourcée, avec exemples CSV, JSON et SQL

L'archivage de la correspondance est disponible sur demande à [contact@openswissdata.com](mailto:contact@openswissdata.com).
