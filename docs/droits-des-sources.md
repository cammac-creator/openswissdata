# Droits des sources — suivi au 26.09.2026

Cette matrice décrit les preuves présentes dans le projet. Elle ne remplace pas
les conditions du fournisseur ni une revue juridique du mode de redistribution.
L’accès technique à une source, ou un droit attribué à un client, ne constitue
jamais une permission du fournisseur.

| Source | Produit concerné | État documentaire et limites | Contrôle suivant |
| --- | --- | --- | --- |
| BAZG / TARES | TARES et bundle | Autorisation écrite du 21.04.2026 documentée dans le dossier de correspondance ; attribution et conditions propres au fournisseur à conserver. | À chaque modification du périmètre ou des conditions. |
| FINMA | Registre, avertissements, MCP et bundle | Réponse écrite du 06.05.2026 documentée ; conserver attribution et intégrité des valeurs officielles. Les enrichissements GLEIF sont identifiés séparément. | À chaque évolution de source ou d’enrichissement. |
| OFS / NOGA | Classifications et MCP | NOGA 2008 / concept 1.0.0 et NOGA 2025 / concept 2.0.1 relus dans i14y. Métadonnées publiques, sans licence explicite identifiée dans ces réponses. Le catalogue indique un accès public ; ce n’est pas une permission commerciale. | Obtenir le fondement précis couvrant les nomenclatures et correspondances, séparément de STATENT. |
| Eurostat / NACE | Classifications et MCP | Politique officielle de réutilisation retrouvée et archivée ; manuel NACE 2.1 édition 2025 sous CC BY 4.0 avec exceptions identifiées. | Rattacher les notices aux distributions CELLAR effectivement utilisées et conserver attribution, modifications et exclusions de droits tiers. |
| ONU / ISIC | Classifications et MCP | Manuel ISIC Rev.4 de 2008 relu : réserve de droits. Les fichiers de structure utilisés proviennent d’UNSD, pas du portail UNdata. | Établir l’autorisation applicable aux structures EN/FR/ES et aux correspondances ; ne pas extrapoler les conditions d’un autre portail. |
| GLEIF | Enrichissement LEI FINMA | Conditions du service de consultation/téléchargement LEI et LE-RD relues : données sous CC0 1.0. Enrichissement distinct de la source FINMA. | Garder la provenance et les dates ; ne pas étendre cette licence aux marques ou à tous les autres contenus du site. |
| OFRC / Zefix REST | Fiche société (`company_check`, `/api/v1/company`) : statut d'inscription et date de radiation seulement, lus en direct | Conditions d'utilisation de l'API REST Zefix acceptées pour le compte du service (relevé du 11.10.2026) : usage gratuit, indication de l'origine et signalement de toute modification, sans garantie (seuls l'extrait certifié et la FOSC font foi), blocage possible en cas de perturbation, pas de requêtes de masse régulières. Consultation unitaire à la demande, cache 24 h, une requête à la fois, plafond quotidien ; rien n'entre dans une archive vendue. | À chaque évolution des conditions de l'API ou de l'usage (jamais de collecte en lot sans nouvel examen). |
| SECO / FOSC (Portail des feuilles officielles) | Aucun produit à ce jour ; collecte envisagée : événements structurés pour un indicateur agrégé | Réponse écrite du SECO du 12.10.2026 (authentification DMARC du domaine réussie) à la lettre du 07.10.2026 : la réutilisation est soumise aux [conditions générales du portail](https://shab.ch/static/agb_fr.pdf) en vigueur (version relue le 16.10.2026 : 07.06.2024), en particulier au point 3.3 ; les durées de publication de chaque avis doivent être respectées, et toute publication ou mise à disposition des données au-delà de ces durées doit être évitée ; la protection des données s'applique au traitement, au stockage et à la rediffusion, notamment pour les avis qui contiennent des données personnelles. Les conditions autorisent l'usage personnel et commercial (3.1, 3.2) et prévoient une API. Obligations (3.3) : protection des données, art. 11 al. 3 OFOSC par analogie pour les données personnelles, structure conforme au registre IDE, une seule publication par opération, mention de la source, mention « Ceci n'est pas une publication officielle », données non modifiées distinguées des commentaires, indications de qualité du SECO reprises. Une entreprise individuelle porte le nom de son titulaire (art. 945 CO) : ses données restent des données personnelles même réduites aux champs structurés. Acceptation de ces conditions pour le compte du service : décision de Claude-Alain en attente. | Aucune collecte avant cette décision. Ensuite : aucune donnée tirée d'un avis ne reste disponible au-delà de la durée de publication de cet avis ; ne garder que des champs structurés (IDE, type d'événement, date, commune, forme juridique), jamais le texte libre ; les entreprises individuelles seulement dans des totaux ; examiner séparément si des totaux calculés restent publiables après ces durées ; relire la version en vigueur des conditions à chaque évolution. |
| OFS / STATENT | Ancien outil `statent_lookup`, complément Pro non publié | Aucune autorisation écrite correspondante identifiée dans le dossier. **Outil retiré du registre MCP et CSV retiré du service courant.** La souscription d’un client ne vaut pas permission OFS. | Réouvrir uniquement après preuve écrite couvrant la diffusion prévue, ou conditions spécifiques établissant clairement ce droit ; vérifier ensuite la qualité et l’actualisation. |

Les [conditions OFS](https://www.bfs.admin.ch/bfs/fr/home/ofs/statistique-publique/copyright.html)
consultées le 25.09.2026 distinguent usage interne et transmission de données à
des tiers. Elles demandent une autorisation écrite pour l’usage commercial
décrit sur cette page. Les éventuelles conditions propres à un jeu doivent être
vérifiées avant d’étendre cette conclusion à d’autres sources.

Le tableau STATENT réellement utilisé est
[canton × division économique](https://www.pxweb.bfs.admin.ch/pxweb/fr/px-x-0602010000_101/-/px-x-0602010000_101.px/).
Ce n’est pas le produit géographique par hectare du même nom. La page de
sélection annonce une base mise à jour le 20.08.2026 ; le fichier retiré du
service était encore une coupe 2023. Les droits et la fraîcheur doivent être
contrôlés séparément.

Les correspondances privées et coordonnées ne sont pas reproduites ici. Les
preuves de consultation et le fichier retiré sont conservés dans le bronze
privé du chantier. Retirer un fichier de la version courante n’efface pas son
historique Git. Aucun message au fournisseur n’a été envoyé dans ce chantier.

## Pièces retrouvées le 26 septembre

### Eurostat et Office des publications

La [politique Eurostat](https://ec.europa.eu/eurostat/help/copyright-notice)
permet la réutilisation commerciale avec attribution, sous réserve des notices
particulières et des droits tiers. Les modifications doivent être signalées et
Eurostat ne doit pas être présenté comme responsable de celles-ci. Cette politique
n’exige pas systématiquement une licence écrite supplémentaire.

Le [manuel NACE 2.1, édition 2025](https://ec.europa.eu/eurostat/documents/3859598/21633320/KS-GQ-24-007-EN-N.pdf),
page PDF 4, porte une autorisation CC BY 4.0 ; l’illustration de couverture est
exclue. Il constitue une preuve propre à cette publication. Le projet distribue
des données structurées issues de CELLAR : le rattachement des notices à ces
objets précis reste à conserver. La [notice de l’Office des publications](https://op.europa.eu/en/web/about-us/legal-notices/publications-office-of-the-european-union-copyright)
renvoie également aux droits propres à chaque publication. Une relation vers un
code ONU n’accorde pas, à elle seule, de droits sur l’ensemble du contenu ONU.

### NOGA et i14y

Les concepts examinés sont [NOGA 2025, 2.0.1](https://api.i14y.admin.ch/api/public/v1/concepts/001bfaa8-fa57-4d66-acfd-c795d67fcf80?includeCodeListEntries=false)
et [NOGA 2008, 1.0.0](https://api.i14y.admin.ch/api/public/v1/concepts/08dc481b-2add-1232-b5fe-b1fae7a1ac02?includeCodeListEntries=false).
Le lien « Droits d’usage » du catalogue conduit aux [informations juridiques OFS](https://www.bfs.admin.ch/bfs/fr/home/ofs/office-federal-statistique/informations-juridiques.html),
qui posent une règle générale d’accord écrit pour la reproduction. Les réponses
API consultées ne comportent pas de champ de licence donnant une exception
explicite. Cela laisse le fondement propre à NOGA à établir ; cela ne constitue
pas une analyse définitive de la protection de chaque code ou intitulé.

### ISIC et GLEIF

Le [manuel ISIC Rev.4](https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_publication_English.pdf),
page PDF 4, indique une réserve de droits ONU. Il ne donne pas l’autorisation
commerciale recherchée pour les fichiers TXT séparés. Les [conditions UNdata](https://data.un.org/Host.aspx?Content=UNdataUse)
permettent la redistribution des données et métadonnées de ce portail avec
référence, mais leur application aux fichiers UNSD utilisés ici n’est pas
établie. Aucune migration vers un autre portail ni autorisation implicite n’est
déduite de cette différence.

Les [conditions LEI de GLEIF](https://www.gleif.org/en/meta/lei-data-terms-of-use),
section II.3, identifient clairement CC0 1.0 pour les données de leur service.
Cette preuve couvre le fondement de réutilisation LEI/LE-RD examiné, sans
transformer la compilation OpenSwissData en publication officielle.

Les réserves NOGA/ISIC, les accords de traitement des fournisseurs et la revue
juridique des clauses sensibles restent ouverts. Les droits des achats passés,
les archives déjà signées et les prix ne sont pas modifiés par ce suivi.
