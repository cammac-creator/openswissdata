# Prospection de nouvelles sources publiques (opendata.swiss)

Généré le 2026-10-07 · tâche osd.prospection. Catalogue interrogé par l'API CKAN officielle d'opendata.swiss (`package_search`), jamais de données servies modifiées par ce rapport.

- Ce passage : 55 / 55 pages lues (à partir de la page 97 sur 166 au total), 5500 jeux lus (100 jeux par page).
- Couverture cumulée : 33.2 % du catalogue (16547 jeux)
- Candidats cumulés (licence ouverte, aucun marqueur de personnes détecté dans le texte, aucune colonne de personne dans les en-têtes LUS — un en-tête jamais lu n'est jamais affirmé propre) : 4584 — 98 passent le filtre public (éditeur fédéral ou cantonal, au moins une clé de jointure, et au moins un en-tête CSV inspecté avec succès — décision de l'intégrateur du 07.10.2026) et sont conservés en détail dans `prospection.json` (plafond 300), 30 de chaque groupe (non-OFS, OFS) montrés dans les tableaux plus bas.
- Jeux écartés (cumulé) : 916
- Jeux déjà au registre des sources (cumulé) : 0
- Passage mené jusqu'au bout de la fenêtre visée, sans échec.

## Écarts par motif

| Motif | Jeux écartés |
|---|---|
| colonne_personne | 76 |
| colonne_personne_probable | 5 |
| licence_absente | 28 |
| licence_cc_by_sa | 398 |
| licence_non_ouverte | 265 |
| personnes_detectees | 144 |

## Meilleurs candidats

Tri par éditeur (fédéral puis cantonal), nombre de clés de jointure détectées, fréquence de mise à jour — aucune note ni score. Seuls les jeux avec au moins une clé de jointure, d'un éditeur fédéral ou cantonal, ET dont au moins un en-tête CSV a été inspecté avec succès (décision de l'intégrateur du 07.10.2026) apparaissent dans ce rapport (voir `prospection.json` pour le détail cumulé complet — jamais le détail intégral du catalogue, qui n'est pas publié). « Déjà collecté » signale un jeu déjà présent au registre des sources du projet — toujours affiché, jamais filtré.

| Titre | Éditeur | Niveau | Licence | Clés de jointure | Fréquence | Déjà collecté | Statut | Fiche |
|---|---|---|---|---|---|---|---|---|
| Données de prévisions locales - Données ponctuelles | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | npa | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/13114d60-c1ae-423f-ade2-8bf6580a4973) |
| Scénarios climatiques CH2025 par station - DAILY-LOCAL | Office fédéral de météorologie et de climatologie MétéoSuisse | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/CONT | non | — | [lien](https://opendata.swiss/dataset/c643b746-0402-4f1e-b9bb-a75e86e6460b) |
| Emissions de CO2 moyennes par type de carburant (VT) | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/2a877ca1-f9ff-4c4d-87ad-31a4dedd7173) |
| Chiffres clés des VUL à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/4d7c825b-d73e-4d4b-a5db-e0752fad4cde) |
| Chiffres clés des VT à propulsion alternative | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/MONTHLY | non | — | [lien](https://opendata.swiss/dataset/98596bd4-f5f8-42db-9c19-a47cef76a634) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures indirectes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/272919d6-3b92-4918-bdae-a78fb1691f6a) |
| Le Programme Bâtiments - Données sources des cantons pour les mesures directes | Office fédéral de l'énergie OFEN | confederation | terms_by | canton | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/670c72a6-bfda-438a-b7bc-8cdda2208931) |
| Notfalltreffpunkte Kanton Zug | Canton de Zoug | canton | terms_by | canton, commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/8bfd652d-f013-48e4-a72d-a66091585bff) |
| Treibhausgas-Emissionen nach Gemeinden ab 1990 | Canton de Thurgovie | canton | attribution | canton, commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/dae51783-9f30-47cf-a5e6-844c2501cc0a) |
| Verteilung des Haushaltseinkommens nach Gemeinde | Canton de Bâle-Ville | canton | attribution | commune, commune (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | — | [lien](https://opendata.swiss/dataset/7584a071-bc17-4b9c-8847-84e65af87a9c) |
| Siedlungsverzeichnis des Kantons Thurgau 2022 | Canton de Thurgovie | canton | public_domain | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/36e83e91-829f-40d4-9662-c36e4a87e768) |
| Nationalratswahlen Kanton Thurgau: Parteistärken nach Gemeinden | Canton de Thurgovie | canton | public_domain | commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/44e62fc0-c876-495d-a2b6-2daabb1eaa9b) |
| Schulanlagen nach Standort | Canton de Bâle-Campagne | canton | terms_by | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/4ffc39f0-8c35-4cdd-98bd-3ad5690a8d2f) |
| Ortschaftenverzeichnis Kanton Thurgau 2023 | Canton de Thurgovie | canton | public_domain | commune, npa (titre) | — | non | — | [lien](https://opendata.swiss/dataset/50f5011e-089e-4cf8-8819-8e945e1caf7a) |
| Ortschaftenverzeichnis Kanton Thurgau 2026 | Canton de Thurgovie | canton | public_domain | commune, npa (titre) | — | non | — | [lien](https://opendata.swiss/dataset/538a4c3d-c127-4a6c-a670-c2e5008a9b73) |
| Nationalratswahlen Kanton Thurgau: Wahlberechtigte und Wahlbeteiligung nach Gemeinden | Canton de Thurgovie | canton | public_domain | commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/7c7e62d0-2020-438c-a6ca-2847e82e7d48) |
| Ortschaftenverzeichnis Kanton Thurgau 2025 | Canton de Thurgovie | canton | public_domain | commune, npa (titre) | — | non | — | [lien](https://opendata.swiss/dataset/b6ead37b-2d8f-4864-ab17-d06d084f4fcb) |
| Trinkwasserqualität im Kanton Zürich nach Gemeinden und Verteilzonen (Selbstkontrolle der Wasserversorgungen) | Gesundheitsdirektion Kanton Zürich | canton | terms_by | commune, commune (titre) | — | non | — | [lien](https://opendata.swiss/dataset/bad68927-4753-4179-b326-3ecd50c6fd26) |
| Siedlungsverzeichnis des Kantons Thurgau 2026 | Canton de Thurgovie | canton | public_domain | commune, npa | — | non | — | [lien](https://opendata.swiss/dataset/f9f1bf42-e490-41bc-b5b6-aad0caaca66f) |
| Kantonsgrenze | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/121eb563-40b8-4a25-8d80-138420aa416d) |
| Landesgrenze | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/1bb701f7-75ee-4e35-901c-6c8dd76a73d7) |
| Amtliche Vermessung Parzellen und andere rechtliche Abgrenzungen | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/254d270e-d0d3-48d9-a43e-7ffd1bb542d5) |
| Servitutpunkt: laufende Änderung | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/28ca06e1-b6c7-4d6d-b42e-ca34cfccb03a) |
| Servitut Linienelement | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/2b901524-81c4-46ca-921f-7e0bef8cc262) |
| Gemeinde | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/2ecc868c-9056-4512-b74f-cac885ca6071) |
| Liegenschaft: laufende Änderung | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/3bf52371-3ad2-491e-b0ec-e91b04088c7c) |
| Liegenschaftsgrenzpunkt | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/40a12791-a624-4ce1-8e50-ba66c92859f4) |
| Verkehrszähldaten motorisierter Individualverkehr | Canton de Thurgovie | canton | public_domain | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/45adb5ff-91e8-4efd-8989-8021d14890fc) |
| Servitutpunkt | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/4e32d719-7669-4127-b05e-5db5656417c2) |
| Selbstrecht: laufende Änderung | Canton de Bâle-Ville | canton | terms_by | commune | http://publications.europa.eu/resource/authority/frequency/DAILY | non | — | [lien](https://opendata.swiss/dataset/5bf0b312-a365-41f5-b12a-6b624cb3db59) |

## Jeux de l'OFS — droits à confirmer

Décision de l'intégrateur du 07.10.2026 : un jeu de l'OFS reste un candidat à part entière, jamais caché pour ce seul motif — mais toujours présenté ICI, après tous les autres, jusqu'à ce que la clarification écrite du 06.10.2026 aboutisse (« droits à confirmer »).

| Titre | Éditeur | Niveau | Licence | Clés de jointure | Fréquence | Déjà collecté | Statut | Fiche |
|---|---|---|---|---|---|---|---|---|
| Naissances vivantes selon l'âge de la mère, le sexe de l'enfant et le canton, de 1969 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/07b1939d-9fda-44e4-b69e-24c3d079e745) |
| Partenariats dissous selon l'âge de chacun des partenaires et le canton, de 2007 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/3c1ce9ee-7911-4883-9415-ef485262a52b) |
| Reconnaissances de paternité selon l'âge et le sexe de l'enfant et le canton de la mère, 1987-2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/4e2246cc-d523-40e4-87fb-14523d5de160) |
| Mariages selon l'âge de chacun des époux et le canton, de 1969 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/94dee036-f108-40f6-8448-29a238206cdc) |
| Adoptions selon la classe d'âge quinquennale, le sexe, la nationalité (sélection) avant l'adoption de la personne adoptée et le canton, de 1979 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/af4d760d-4e73-4765-94f0-f54327651ec1) |
| Décès selon la classe d'âge quinquennale, le sexe et le canton, de 1969 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/cf79ec30-1cb4-48db-bbca-8d30fcadd35a) |
| Divorces selon l'âge de chacun des époux et le canton, de 1984 à 2025 | Office fédéral de la statistique OFS | confederation | terms_by | canton, canton (titre) | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/eef6473d-15c8-4654-adae-94a6820d1189) |
| Entreprises marchandes selon la division économique et la forme juridique | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/05503b68-ddb9-42a7-81d9-63c66975267b) |
| Compte de production par secteurs institutionnels | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/24149076-2ad0-4d17-8dcc-874fff3428ad) |
| Compte de production par secteurs économiques | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/39025073-0aa1-4e77-9817-667e75fac86d) |
| Entreprises marchandes selon la division économique et la taille de l'entreprise | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/68331728-d2ff-408b-986d-c40339bb5f12) |
| Compte de production par branches (agrégées par sections) | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/b3cf57ec-75ae-4bcf-b423-7af77e806494) |
| Valeur ajoutée brute des activités financières et d'assurance | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/cf4f0453-d476-441d-8348-47e2089b7dfe) |
| Compte de production par branches (64 branches) | Office fédéral de la statistique OFS | confederation | terms_by | noga | http://publications.europa.eu/resource/authority/frequency/ANNUAL | non | droits à confirmer (OFS) | [lien](https://opendata.swiss/dataset/d461f547-32cc-4675-b0ae-81b900022c6d) |

Chaque jeu, qu'il soit retenu ou non ici, reste « à vérifier » pour toute donnée personnelle (jamais affirmé « sans données personnelles »).
