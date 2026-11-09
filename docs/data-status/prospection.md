# Prospection de nouvelles sources publiques (opendata.swiss)

Généré le 2026-11-09 · tâche osd.prospection. Catalogue interrogé par l'API CKAN officielle d'opendata.swiss (`package_search`), jamais de données servies modifiées par ce rapport.

- Ce passage : 0 / 55 pages lues (à partir de la page 100 sur 162 au total), 0 jeux lus (100 jeux par page).
- Couverture cumulée : 95.4 % du catalogue (16196 jeux)
- Candidats cumulés (licence ouverte, aucun marqueur de personnes détecté dans le texte, aucune colonne de personne dans les en-têtes LUS — un en-tête jamais lu n'est jamais affirmé propre) : 13433 — 300 passent le filtre public (éditeur fédéral ou cantonal, au moins une clé de jointure, et au moins un en-tête CSV inspecté avec succès — décision de l'intégrateur du 07.10.2026) et sont conservés en détail dans `prospection.json` (plafond 300), 30 de chaque groupe (non-OFS, OFS) montrés dans les tableaux plus bas.
- Jeux écartés (cumulé) : 2010
- Jeux déjà au registre des sources (cumulé) : 4
- ⚠️ **Passage PARTIEL** (motif : page_failed) : arrêté avant la fin de la fenêtre visée.

## Écarts par motif

| Motif | Jeux écartés |
|---|---|
| colonne_personne | 294 |
| colonne_personne_probable | 6 |
| licence_absente | 49 |
| licence_cc_by_sa | 497 |
| licence_non_ouverte | 336 |
| personnes_detectees | 828 |

## Meilleurs candidats

Tri par éditeur (fédéral puis cantonal), nombre de clés de jointure détectées, fréquence de mise à jour — aucune note ni score. Seuls les jeux avec au moins une clé de jointure, d'un éditeur fédéral ou cantonal, ET dont au moins un en-tête CSV a été inspecté avec succès (décision de l'intégrateur du 07.10.2026) apparaissent dans ce rapport (voir `prospection.json` pour le détail cumulé complet — jamais le détail intégral du catalogue, qui n'est pas publié). « Déjà collecté » signale un jeu déjà présent au registre des sources du projet — toujours affiché, jamais filtré.

| Titre | Éditeur | Niveau | Licence | Clés de jointure | Fréquence | Déjà collecté | Statut | Fiche |
|---|---|---|---|---|---|---|---|---|
| Primes de l’assurance-maladie | Office fédéral de la santé publique OFSP | confederation | terms_open | canton, tarif | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/13345431-7cd8-4427-85b6-daf52f3be2ea) |
| Bildersammlung Annemarie Schwarzenbach | Bibliothèque nationale suisse BN | confederation | terms_open | canton, npa | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/933300d6-1ccd-476f-8027-07093c5a08c1) |
| Données de prévisions locales - Données ponctuelles | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | npa | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/13114d60-c1ae-423f-ade2-8bf6580a4973) |
| Stations pluviométriques manuelles - Valeurs mesurées | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/2223a5de-ae3b-4a3a-ae62-5336a23e53b0) |
| Stations météorologiques automatiques - Valeurs mesurées | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/367f76c4-05f7-43df-bab2-0ff3cd9596bb) |
| Stations pluviométriques automatiques - Valeurs mesurées | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/44003ba6-ebc3-4aaa-97d4-6473c5d31893) |
| Stations climatologiques pluviométriques - Séries de mesures homogènes | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/71375013-ae65-459b-bcd1-b11a5576e1b4) |
| Observations visuelles météorologiques - Données | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/a9cb6655-b86f-4a6b-b271-b021ce99ef81) |
| Stations de tour automatiques - Valeurs mesurées | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/bcf5be38-41d2-4664-abc0-4a5a0bf54177) |
| Scénarios climatiques CH2025 par station - DAILY-LOCAL | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/c643b746-0402-4f1e-b9bb-a75e86e6460b) |
| Stations pluviométriques totalisateur - Valeurs mesurées | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/c95352a1-b31e-4a32-b3dc-96661c4fd23e) |
| Observations phénologiques - Données | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/d43d1db0-4168-438b-af24-e81630c37328) |
| Stations climatologiques - Séries de mesures homogènes | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/ec8f632c-3e0e-476c-982e-a704dcbf5601) |
| Surveillance de l'influenza aviaire (IA) chez les oiseaux sauvages | Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/WEEKLY | non | — | [lien](https://opendata.swiss/dataset/2d8d8642-9e4c-4df0-92d4-a05b09336b27) |
| Lutte à l’échelle nationale contre le piétin chez les moutons | Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/WEEKLY | non | — | [lien](https://opendata.swiss/dataset/6683dc5c-5237-4bd5-96f6-331565b85d89) |
| Emissions de CO2 moyennes par type de carburant (VT) | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/2a877ca1-f9ff-4c4d-87ad-31a4dedd7173) |
| Chiffres clés des VUL à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/4d7c825b-d73e-4d4b-a5db-e0752fad4cde) |
| Chiffres clés des VT à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/98596bd4-f5f8-42db-9c19-a47cef76a634) |
| Rétributions uniques pour installations photovoltaïques | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | oui | — | [lien](https://opendata.swiss/dataset/2628a6a6-1ec8-42b2-afd5-17327f569fb5) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures indirectes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/272919d6-3b92-4918-bdae-a78fb1691f6a) |
| Expérimentation animale: Statistique sur l’expérimentation animale | Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/57204340-4423-4c37-9a14-d75d7882ae95) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures directes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/670c72a6-bfda-438a-b7bc-8cdda2208931) |
| Potentiel d'énergie solaire des communes suisses | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/8c5bed3e-4020-4fc2-8377-6ea009323464) |
| Statistique de la santé animale | Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/932e6b1f-8db7-45de-bcac-b5b2df0b226a) |
| Expérimentation animale: Autorisations | Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/bea1b24d-a548-42ad-a89b-29f08b443e40) |
| État de la politique énergétique dans les cantons | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/cb3656ae-178e-4447-97d2-6b4987ae1f94) |
| Etudes de potentiel et publications sur l'utilisation de la chaleur des lacs et des eaux de surface | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/0ea4bf46-f546-4cdc-9dbc-253eed4791e7) |
| Collection Gugelmann (petits-maîtres suisses) | Bibliothèque nationale suisse BN | confederation | terms_open | canton | http://publications.europa.eu/resource/authority/frequency/IRREG | non | — | [lien](https://opendata.swiss/dataset/4431e4e4-caac-4ccc-bc23-3f2c6a4e122f) |
| Kantonsblatt | Canton de Bâle-Ville | canton | attribution | canton, commune, npa | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/47fe2e83-7fe1-4340-b6fa-a53da019dad3) |
| Notfalltreffpunkte Kanton Zug | Canton de Zoug | canton | terms_by | canton, commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/8bfd652d-f013-48e4-a72d-a66091585bff) |

## Jeux de l'OFS — droits à confirmer

Décision de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste un candidat à part entière, jamais caché pour ce seul motif — mais toujours présenté ICI, après tous les autres, jusqu'à ce que la clarification écrite du 06.10.2026 aboutisse (« droits à confirmer »).

*Aucun candidat OFS dans ce rapport cumulé pour l'instant.*

Chaque jeu, qu'il soit retenu ou non ici, reste « à vérifier » pour toute donnée personnelle (jamais affirmé « sans données personnelles »).
