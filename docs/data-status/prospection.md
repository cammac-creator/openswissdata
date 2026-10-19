# Prospection de nouvelles sources publiques (opendata.swiss)

Généré le 2026-10-19 · tâche osd.prospection. Catalogue interrogé par l'API CKAN officielle d'opendata.swiss (`package_search`), jamais de données servies modifiées par ce rapport.

- Ce passage : 3 / 55 pages lues (à partir de la page 97 sur 162 au total), 300 jeux lus (100 jeux par page).
- Couverture cumulée : 67.9 % du catalogue (16116 jeux)
- Candidats cumulés (licence ouverte, aucun marqueur de personnes détecté dans le texte, aucune colonne de personne dans les en-têtes LUS — un en-tête jamais lu n'est jamais affirmé propre) : 9452 — 300 passent le filtre public (éditeur fédéral ou cantonal, au moins une clé de jointure, et au moins un en-tête CSV inspecté avec succès — décision de l'intégrateur du 07.10.2026) et sont conservés en détail dans `prospection.json` (plafond 300), 30 de chaque groupe (non-OFS, OFS) montrés dans les tableaux plus bas.
- Jeux écartés (cumulé) : 1485
- Jeux déjà au registre des sources (cumulé) : 3
- ⚠️ **Passage PARTIEL** (motif : page_failed) : arrêté avant la fin de la fenêtre visée.

## Écarts par motif

| Motif | Jeux écartés |
|---|---|
| colonne_personne | 239 |
| colonne_personne_probable | 5 |
| licence_absente | 31 |
| licence_cc_by_sa | 405 |
| licence_non_ouverte | 300 |
| personnes_detectees | 505 |

## Meilleurs candidats

Tri par éditeur (fédéral puis cantonal), nombre de clés de jointure détectées, fréquence de mise à jour — aucune note ni score. Seuls les jeux avec au moins une clé de jointure, d'un éditeur fédéral ou cantonal, ET dont au moins un en-tête CSV a été inspecté avec succès (décision de l'intégrateur du 07.10.2026) apparaissent dans ce rapport (voir `prospection.json` pour le détail cumulé complet — jamais le détail intégral du catalogue, qui n'est pas publié). « Déjà collecté » signale un jeu déjà présent au registre des sources du projet — toujours affiché, jamais filtré.

| Titre | Éditeur | Niveau | Licence | Clés de jointure | Fréquence | Déjà collecté | Statut | Fiche |
|---|---|---|---|---|---|---|---|---|
| Primes de l’assurance-maladie | Office fédéral de la santé publique OFSP | confederation | terms_open | canton, tarif | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/13345431-7cd8-4427-85b6-daf52f3be2ea) |
| Données de prévisions locales - Données ponctuelles | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | npa | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/13114d60-c1ae-423f-ade2-8bf6580a4973) |
| Scénarios climatiques CH2025 par station - DAILY-LOCAL | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/c643b746-0402-4f1e-b9bb-a75e86e6460b) |
| Emissions de CO2 moyennes par type de carburant (VT) | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/2a877ca1-f9ff-4c4d-87ad-31a4dedd7173) |
| Chiffres clés des VUL à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/4d7c825b-d73e-4d4b-a5db-e0752fad4cde) |
| Chiffres clés des VT à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/98596bd4-f5f8-42db-9c19-a47cef76a634) |
| Rétributions uniques pour installations photovoltaïques | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | oui | — | [lien](https://opendata.swiss/dataset/2628a6a6-1ec8-42b2-afd5-17327f569fb5) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures indirectes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/272919d6-3b92-4918-bdae-a78fb1691f6a) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures directes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/670c72a6-bfda-438a-b7bc-8cdda2208931) |
| Potentiel d'énergie solaire des communes suisses | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/8c5bed3e-4020-4fc2-8377-6ea009323464) |
| État de la politique énergétique dans les cantons | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/cb3656ae-178e-4447-97d2-6b4987ae1f94) |
| Etudes de potentiel et publications sur l'utilisation de la chaleur des lacs et des eaux de surface | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/0ea4bf46-f546-4cdc-9dbc-253eed4791e7) |
| Notfalltreffpunkte Kanton Zug | Canton de Zoug | canton | terms_by | canton, commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/8bfd652d-f013-48e4-a72d-a66091585bff) |
| Treibhausgas-Emissionen nach Gemeinden ab 1990 | Canton de Thurgovie | canton | attribution | canton, commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/dae51783-9f30-47cf-a5e6-844c2501cc0a) |
| Bilanz der Wohnbevölkerung nach Gemeinde und Quartal (seit 2003) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/QUARTERLY | non | — | [lien](https://opendata.swiss/dataset/dcd9e1bf-b9ca-44fc-a6c5-00822428c7dd) |
| Energieverbrauch und erneuerbare Stromproduktion: Anzahl Hauptheizsysteme nach Gemeinden | Canton de Thurgovie | canton | terms_open | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/09e3ba66-c783-4d92-b164-8113f571c1c7) |
| Durchschnittlicher Quadratmeterpreis von Wohnbauland nach Gemeinde und Jahr (seit 1979) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/32903b0f-92d3-45a9-9e51-86a8b80c2161) |
| Finanzausgleich nach Gemeinde und Jahr (seit 2010) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/38b5030c-f4b5-42d2-a21b-f496d1ae9536) |
| Bilanz der Wohnbevölkerung nach Gemeinde und Jahr (seit 1980) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/4fe0c6e1-5235-4e03-884f-8125b7f5ecd6) |
| Verteilung des Haushaltseinkommens nach Gemeinde | Canton de Bâle-Ville | canton | attribution | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/7584a071-bc17-4b9c-8847-84e65af87a9c) |
| Steuerfüsse und Steuersätze nach Gemeinde und Jahr (seit 1975) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/9278b149-9565-4f8c-a323-617ce6bd8107) |
| Neu erstellte Wohnungen nach Gemeinde und Jahr (seit 1994) | Canton de Bâle-Campagne | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/e2a1b018-5a95-4b46-9ad2-3c6aa330c0cf) |
| Strassen und Wege: Kantonsstrassen Riehen und Bettingen | Canton de Bâle-Ville | canton | terms_by | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/a9c5cfb5-ee2a-4620-a1aa-1bc9baeb92f1) |
| Kinder- und Jugendangebote | Canton de Bâle-Ville | canton | terms_by | canton, npa | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/e4b71a17-3eb9-4023-9c9b-4b318bf96473) |
| Trinkwasserqualität im Kanton Zürich nach Gemeinden und Verteilzonen | Gesundheitsdirektion Kanton Zürich | canton | terms_by | commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/07c8b310-adfa-46da-9c68-7b116b852842) |
| Schulergänzende Kinderbetreuung Kanton Thurgau (Stand 31.12) | Canton de Thurgovie | canton | public_domain | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/17df8193-560c-4cec-a590-47c01bafdc9e) |
| Schulergänzende Kinderbetreuung Kanton Thurgau (Stand August 2020) | Canton de Thurgovie | canton | terms_by | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/18523a9b-25ad-4e50-9b9a-a70f4e464549) |
| Resultate der kantonalen Abstimmungen im Kanton Thurgau ab 2004 nach Gemeinden | Canton de Thurgovie | canton | terms_open | commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/21a3621e-03e8-4642-814e-b3983dbe777e) |
| Kindertagesstätten im Kanton Thurgau (Stand August 2020) | Canton de Thurgovie | canton | public_domain | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/2d921b57-43b6-416e-8e97-1636cf9cf540) |
| Siedlungsverzeichnis des Kantons Thurgau 2022 | Canton de Thurgovie | canton | public_domain | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/36e83e91-829f-40d4-9662-c36e4a87e768) |

## Jeux de l'OFS — droits à confirmer

Décision de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste un candidat à part entière, jamais caché pour ce seul motif — mais toujours présenté ICI, après tous les autres, jusqu'à ce que la clarification écrite du 06.10.2026 aboutisse (« droits à confirmer »).

*Aucun candidat OFS dans ce rapport cumulé pour l'instant.*

Chaque jeu, qu'il soit retenu ou non ici, reste « à vérifier » pour toute donnée personnelle (jamais affirmé « sans données personnelles »).
