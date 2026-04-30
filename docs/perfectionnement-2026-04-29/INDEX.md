# Perfectionnement openswissdata — index 2026-04-29

Session menée par 6 agents Claude Code en parallèle pour auditer les 3 packs OSD, analyser la concurrence, identifier la différenciation face aux AI agents qui scrapent, et préparer une roadmap de perfectionnement + drafts promo multi-plateformes.

## Documents

| Fichier | Contenu |
|---|---|
| **[ROADMAP.md](ROADMAP.md)** | **Synthèse exécutive et roadmap d'exécution.** TL;DR, scoring actuel, repricing, 4 phases (quick wins → enrichissement → MCP → tiers Pro/Enterprise → distribution), métriques succès, risques. **À lire en premier.** |
| **[PROMO-DRAFTS.md](PROMO-DRAFTS.md)** | 11 drafts par plateforme (LinkedIn FR/DE/EN, X thread, Show HN, Reddit, ProductHunt, email outbound, Hugging Face). À publier UNIQUEMENT après Phase 0+1 livrées et validation Alain. |

## TL;DR du TL;DR

Trois leviers pour passer de produits "commodité scrapable" à produits "indispensables" :

1. **MCP server** `mcp.openswissdata.com` (Q3 2026) — endpoints `tariff_lookup`, `classify_text`, `kyc_check` natifs dans Claude Code/Cursor. Canalise le risque AI vers OSD au lieu de le subir.

2. **Embeddings multilingues pré-calculés** dans chaque pack — zéro AI agent ne le fait en session (besoin GPU). Killer feature dropable directement dans un index FAISS client.

3. **Warranty contractuelle + manifest signé Ed25519 + permission BAZG** — *le* moat juridique (LCD Art. 5). Aucun scraper ne peut signer une garantie d'indemnisation jusqu'à 10× le prix de la licence.

**Repricing immédiat (Phase 0, ~4-5 j de dev) :** TARES 299→499, Classifications 399→499, FINMA 299→399, Bundle 799→999. Compliance Bundle nouveau à 2 990 CHF/an. Tier Enterprise à 1 990-4 990 CHF/an.

**Quick wins critiques (à faire AVANT toute promo) :**
- Remplir NOGA 2025 + NACE 2.1 (aujourd'hui = 0 lignes en prod, **bug critique**)
- Ajouter FINMA Warnings list (~2 180 entités)
- Manifest légal Ed25519 + RFC-3161 dans chaque ZIP
- Page `/legal/provenance` qui explique le moat juridique

**Concurrent le plus dangereux :** OpenSanctions (pourrait ajouter "Swiss FINMA Authorised" en 3-6 mois et tuer notre moat sur FINMA). Vitesse d'exécution = critique.

## Décisions à prendre par Alain

1. ✅ Valider la roadmap (ou ajuster les phases)
2. ✅ Confirmer le repricing immédiat
3. ✅ Décider du calendrier (par défaut : mai quick wins → juin/juillet enrichissements → juillet/août MCP → septembre push promo)
4. ✅ Choisir les canaux promo prioritaires (recommandé : LinkedIn FR/DE + Show HN + ProductHunt + Datarade en premier)
5. ✅ Décider du timing de publication (ne PAS publier avant Phase 0 + Phase 1 livrées et testées live — sinon refunds, perte crédibilité, risque légal)
