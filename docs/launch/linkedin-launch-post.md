# LinkedIn launch posts — openswissdata.com

Prêt à copier-coller. Dernière mise à jour : 2026-04-22.

## Version courte (teaser < 300 caractères, pour annoncer avant le long post)

🇨🇭 Je viens de lancer openswissdata.com — 3 datasets officiels suisses normalisés (TARES douane, NOGA/NACE/ISIC, FINMA registry) en CSV/Parquet/SQL, vendus au forfait. Fait après IBANforge, même philosophie : DX-first, vertical CH. Détails → ⬇️

---

## Version longue (FR — ~1000 mots, post principal)

**Aujourd'hui je lance openswissdata.com — mon deuxième projet solo après IBANforge.**

Trois datasets officiels suisses, normalisés et versionnés, vendus sous forme de licences numériques.

---

🗂️ **Ce que ça résout**

J'ai passé des années à intégrer des données gouvernementales suisses dans des ERP et des plateformes B2B. Chaque fois, le même rituel :
- Téléchargement d'un XLSX avec des colonnes multi-lignes
- Parsing manuel des codes avec points, espaces, et accents cassés
- Mapping ad-hoc entre NOGA/NACE/ISIC pour le reporting groupe
- Scraping patient de xtares.admin.ch parce qu'il n'y a pas d'API
- Et 6 mois plus tard, tout ce travail est obsolète parce qu'une nouvelle version est sortie

À chaque fois, entre 20 et 80 heures d'ETL par projet. À 120 CHF/h de salaire d'ingénieur, ça fait entre 2 400 et 9 600 CHF de travail réutilisable presque jamais partagé.

J'ai fini par construire un moteur d'ingestion propre, et je le commercialise.

---

📦 **Les 3 datasets (tous sur openswissdata.com)**

**1. TARES — Swiss Customs Tariff** · CHF 299
Environ 6 000 codes HS8 avec désignations FR/DE/IT/EN, droits MFN, régimes préférentiels (UE, AELE, UK, CN, TR, ISR, …), et cross-walk vers HS6 international. Mises à jour hebdo. BAZG a donné son accord commercial le 21 avril 2026 avec 7 conditions strictes (disclaimer « non officiel » trilingue, for juridique Berne, exclusion des Erläuterungen/Entscheide). Toutes appliquées.

**2. Swiss Economic Classifications Bundle** · CHF 399
NOGA 2008 + NOGA 2025 + NACE Rev 2 + NACE Rev 2.1 + ISIC Rev 4, avec les cross-walks 5-voies anchored sur NOGA 2025. Labels FR/DE/IT/EN. Cible : les filiales suisses de groupes européens qui doivent produire des rapports sectoriels à la fois en NOGA (Suisse) et NACE/ISIC (groupe).

**3. FINMA Registry unifié** · CHF 299
Les 10 listes FINMA (banques, assurances, PSP, asset managers, SRO members, etc.) unifiées sous un seul schéma, avec UID canonicalisé et enrichissement LEI. Plus un changelog 90 jours pour suivre les additions/retraits/changements de statut. Timing : PSD3 + FinSA 2026-2027 poussent fort sur la due-diligence programmatique.

**Bundle complet** (les 3) · CHF 799 — économie 200 CHF.

Chaque dataset est livré en 5 formats dans un ZIP : CSV, JSON, Parquet, SQL, plus JSON Schema + README + checksums + licence. 360 jours d'updates inclus.

---

🛠️ **Stack technique**

- **Backend** : Hono (TypeScript) + better-sqlite3 sur Railway, 141 tests unitaires et d'intégration
- **Frontend** : Astro + Tailwind v4 servi par le même Hono (serveStatic)
- **Storage** : Cloudflare R2 (Frankfurt) pour les ZIP
- **Paiement** : Stripe Checkout + webhook avec idempotence
- **Auth** : magic-link (pas de mot de passe), sessions 30j
- **Email** : Resend, avec dégradation gracieuse si la clé manque
- **SDK open-source** : TypeScript et Python publiés sous Apache 2.0 (GitHub bientôt)

Je suis un solo founder développeur, je ne code que depuis fin 2025, et j'ai bâti tout ça en ~2 semaines avec l'aide d'agents IA (Claude Code principalement). **Les datasets eux-mêmes — la vraie valeur — restent construits par moi**, avec les autorisations commerciales écrites demandées directement aux administrations suisses. BAZG a déjà validé TARES. FINMA et BFS en cours.

---

🙋 **Qui est le client ?**

Concrètement :
- Data engineers en banque/assurance qui intègrent NOGA dans Power BI
- Équipes compliance/KYC chez les fintechs qui cross-vérifient des contreparties contre FINMA
- Intégrateurs SAP GTS qui ont besoin de HS8 suisse à jour
- Filiales suisses de multinationales européennes qui doivent consolider en NACE
- Cabinets avocats compliance qui servent des clients fintech

Si ça te concerne — ou si tu connais quelqu'un que ça concernerait — un échantillon gratuit de 100 lignes par dataset est disponible sur chaque page produit.

---

🔗 **Liens**
- Page d'accueil : https://www.openswissdata.com
- Bundle complet 799 CHF : https://www.openswissdata.com/bundle
- TARES : https://www.openswissdata.com/datasets/tares
- Classifications : https://www.openswissdata.com/datasets/classifications
- FINMA : https://www.openswissdata.com/datasets/finma
- Blog (3 articles techniques d'intégration) : https://www.openswissdata.com/blog

---

Happy to answer questions in DM ou en commentaires. Si l'un des datasets t'épargne un sprint d'ETL cette semaine, tu sais où me trouver.

— Claude-Alain

#SwissTech #OpenData #DataEngineering #Compliance #Fintech #SAP #NOGA #FINMA #TARES

---

## Version DE (~500 mots, pour audience alémanique séparée)

**Heute veröffentliche ich openswissdata.com — mein zweites Solo-Projekt nach IBANforge.**

Drei offizielle Schweizer Datensätze, normalisiert und versioniert, als digitale Lizenzen verkauft.

🗂️ **Das Problem**

Ich habe jahrelang mit Schweizer Verwaltungsdaten gearbeitet. Jedes Mal dieselbe Prozedur: XLSX mit mehrzeiligen Kopfzeilen herunterladen, UTF-8-Encoding korrigieren, Codes mit Punkten und Umlauten normalisieren, NOGA/NACE/ISIC manuell kreuzverknüpfen. Zwischen 20 und 80 Stunden ETL pro Projekt. Mit einem Ingenieurslohn von 120 CHF/Std. entspricht das 2 400 bis 9 600 CHF Arbeitsaufwand, der kaum jemals wiederverwendet wird.

Ich habe einen sauberen Ingestions-Pipeline aufgebaut und vermarkte ihn jetzt.

📦 **Die 3 Datensätze**

- **TARES** (Schweizer Zolltarif HS8) · CHF 299 — BAZG hat am 21.04.2026 schriftlich zugestimmt, mit 7 Bedingungen (trilinguales « nicht-offizielle Veröffentlichung »-Etikett, Gerichtsstand Bern, Ausschluss der Erläuterungen). Alle erfüllt.
- **Klassifikationen** (NOGA 2008/2025 + NACE Rev 2/2.1 + ISIC Rev 4 mit 5-Wege-Cross-Walks) · CHF 399 — unentbehrlich für Schweizer Tochtergesellschaften europäischer Gruppen.
- **FINMA-Register** (alle 10 Listen unifiziert + 90-Tage-Changelog) · CHF 299 — Rückenwind durch PSD3 und FinSA 2026-2027.
- **Bundle** (alle drei) · CHF 799 — 200 CHF Ersparnis.

Jeder Datensatz wird als ZIP in 5 Formaten geliefert: CSV, JSON, Parquet, SQL, plus JSON Schema und Checksums. 360 Tage Updates inklusive.

🛠️ **Technik**

Hono + Astro + SQLite auf Railway, Storage auf Cloudflare R2 Frankfurt, Stripe Checkout, passwortloser Magic-Link-Login. 141 Tests. Open-Source-SDKs (TypeScript, Python) bald auf GitHub unter Apache 2.0.

🙋 **Kunde**

Data Engineers in Banken/Versicherungen, Compliance-Teams bei Fintechs, SAP-GTS-Integratoren, Schweizer Tochtergesellschaften europäischer Konzerne, regulatorische Anwaltskanzleien.

Kostenlose 100-Zeilen-Samples auf jeder Produktseite.

🔗 **https://www.openswissdata.com**

Fragen gerne per DM. Wenn einer der Datensätze dir diese Woche einen ETL-Sprint erspart, weisst du, wo du mich findest.

— Claude-Alain

#SwissTech #OpenData #DataEngineering #Compliance #FINMA #NOGA

---

## Conseils de publication (pour Alain)

1. **Post principal** en FR → ton réseau CH francophone (majeur). Pinner le post sur le profil pour 7 jours.
2. **24h plus tard**, re-post la version DE pour le réseau alémanique. Adapter les hashtags (#schweiz, #digitalschweiz).
3. Dans les **commentaires du post FR**, mettre un commentaire en anglais court pointant vers les mêmes liens — ça capture les expatriés anglophones sans diluer la portée FR.
4. Ne pas poster **tous les liens d'un coup** — le lien principal dans le post (openswissdata.com), les liens datasets en commentaire pour augmenter la rétention.
5. **Hashtags** : LinkedIn limite l'efficacité à 3-5 hashtags. Garder les 3 plus spécifiques (#SwissTech #OpenData #FINMA) et diluer les autres.
6. Timing idéal : **mardi ou mercredi 09:00-10:00 heure suisse**, quand les décideurs parcourent LinkedIn pendant leur café. Éviter lundi (overload inbox) et vendredi (distraction week-end).
7. Mentionner le BAZG (@FOCBS sur LinkedIn si présent) dans le post pour amplifier la crédibilité du « GO conditionnel ».
