# Pitch presse — startupticker.ch

**Destinataire** : formulaire `https://www.startupticker.ch/en/news/submit-news` ou `editor@startupticker.ch`
**Format** : communiqué de presse classique (startupticker accepte les annonces de launch)
**Angle** : startup suisse + datasets ouverts + SDK typé + premier MCP suisse

---

## Objet (formulaire)

`openswissdata launches: First Swiss MCP server for federal datasets, with BAZG permission`

## Catégories à cocher (sur le form)

- Sector: **FinTech / RegTech / Data**
- Stage: **Bootstrap / Solo Founder**
- Region: **Vaud / Romandie**
- Type: **Product Launch**

---

## Communiqué (à coller dans le form, 350 mots max)

**Lausanne / Ogens (VD)** — openswissdata.com est **le premier MCP server suisse** dédié aux datasets fédéraux (TARES douanes, classifications NOGA/NACE/ISIC, registre FINMA), avec deux différenciateurs uniques : permission commerciale écrite du BAZG et signatures cryptographiques Ed25519 niveau bancaire.

**Le besoin**

Les compliance officers, data engineers fintech et intégrateurs ERP suisses passent 5 jours-homme par release à scraper xtares.admin.ch, parser les XLSX inhomogènes du FINMA, et maintenir des cross-walks manuels NOGA → NACE → ISIC. Ce coût caché est estimé à 6 000 CHF par release maintenance, soit 36 000 CHF par an.

**La solution**

openswissdata extrait les données fédérales depuis les sources autoritaires (BAZG, OFS/BFS, FINMA), les normalise (schéma stable, formats CSV/JSON/Parquet/SQL), les signe Ed25519, les horodate RFC-3161 via TSA freetsa.org, et les expose via 9 outils MCP natifs Claude Desktop / Cursor.

**Pricing transparent** :
- TARES douanes : 299 CHF
- Classifications NOGA + NACE + ISIC : 399 CHF
- FINMA Registry unifié : 299 CHF
- Bundle complet : **797 CHF (économie 200 CHF)**
- MCP Standalone : 49 CHF/mois (récurrent)

**Le founder**

Claude-Alain Martin, builder vaudois (raison individuelle, Ogens), 7 ans dans la data B2B. openswissdata est bootstrappé, sans investisseurs externes. Le code source des workflows ETL est public sur GitHub (`cammac-creator/openswissdata`) — les acheteurs peuvent vérifier la pipeline avant achat.

**Permissions BAZG + FINMA**

Permission commerciale BAZG écrite acquise le 21 avril 2026 (référence `BAZG-PERMISSION-2026-04-21-MICHAEL-BEER`, M. Michael Beer, Tarifgrundlagen). Confirmation FINMA reçue le 6 mai 2026 (Mme Nadine Bucher, Communication, référence `FINMA-PERMISSION-2026-05-06-NADINE-BUCHER`) : aucune objection à l'usage commercial des données FINMA publiquement accessibles. Demande BFS pour NOGA en attente. Politique publique de takedown 24h sur demande d'autorité source.

**Disponibilité**

Site live : https://www.openswissdata.com
MCP discovery : https://www.openswissdata.com/mcp/discovery
Code : https://github.com/cammac-creator/openswissdata

**Contact**
Claude-Alain Martin
contact@openswissdata.com

---

## Suivi

Si pas de publication sous 5 jours, relancer en proposant une interview + photo HD du founder.
