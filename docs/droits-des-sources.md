# Droits des sources — suivi au 26.09.2026

Cette matrice décrit les preuves présentes dans le projet. Elle ne remplace pas
les conditions du fournisseur ni une revue juridique du mode de redistribution.
L’accès technique à une source, ou un droit attribué à un client, ne constitue
jamais une permission du fournisseur.

| Source | Produit concerné | État documentaire et limites | Contrôle suivant |
| --- | --- | --- | --- |
| BAZG / TARES | TARES et bundle | Autorisation écrite du 21.04.2026 documentée dans le dossier de correspondance ; attribution et conditions propres au fournisseur à conserver. | À chaque modification du périmètre ou des conditions. |
| FINMA | Registre, avertissements, MCP et bundle ; flux `/api/v1/finma/licences` (IDE et libellés de l'autorisation des banques, fintechs et maisons de titres), lu par IBANforge | Réponse écrite du 06.05.2026 documentée, qui vise « votre produit » et renvoie aux conditions du site (autorisation écrite préalable pour toute reproduction) ; conserver attribution et intégrité des valeurs officielles. Les enrichissements GLEIF sont identifiés séparément. Flux : source citée, retrait sous 48 heures sur demande. | À chaque évolution de source ou d’enrichissement. |
| OFS / NOGA | Classifications et MCP | NOGA 2008 / concept 1.0.0 et NOGA 2025 / concept 2.0.1 relus dans i14y. Métadonnées publiques, sans licence explicite identifiée dans ces réponses. Le catalogue indique un accès public ; ce n’est pas une permission commerciale. | Obtenir le fondement précis couvrant les nomenclatures et correspondances, séparément de STATENT. |
| Eurostat / NACE | Classifications et MCP | Politique officielle de réutilisation retrouvée et archivée ; manuel NACE 2.1 édition 2025 sous CC BY 4.0 avec exceptions identifiées. | Rattacher les notices aux distributions CELLAR effectivement utilisées et conserver attribution, modifications et exclusions de droits tiers. |
| ONU / ISIC | Classifications et MCP | Manuel ISIC Rev.4 de 2008 relu : réserve de droits. Les fichiers de structure utilisés proviennent d’UNSD, pas du portail UNdata. | Établir l’autorisation applicable aux structures EN/FR/ES et aux correspondances ; ne pas extrapoler les conditions d’un autre portail. |
| GLEIF | Enrichissement LEI FINMA | Conditions du service de consultation/téléchargement LEI et LE-RD relues : données sous CC0 1.0. Enrichissement distinct de la source FINMA. | Garder la provenance et les dates ; ne pas étendre cette licence aux marques ou à tous les autres contenus du site. |
| OFRC / Zefix REST | Fiche société (`company_check`, `/api/v1/company`) : statut d'inscription et date de radiation seulement, lus en direct | Conditions d'utilisation de l'API REST Zefix acceptées pour le compte du service (relevé du 11.10.2026) : usage gratuit, indication de l'origine et signalement de toute modification, sans garantie (seuls l'extrait certifié et la FOSC font foi), blocage possible en cas de perturbation, pas de requêtes de masse régulières. Consultation unitaire à la demande, cache 24 h, une requête à la fois, plafond quotidien ; rien n'entre dans une archive vendue. | À chaque évolution des conditions de l'API ou de l'usage (jamais de collecte en lot sans nouvel examen). |
| SECO / FOSC (Portail des feuilles officielles) | Aucun produit publié. Collecte quotidienne construite le 22.10.2026 (`etl/fosc/`, voir `etl/fosc/SOURCES.md`) : événements structurés des sociétés et totaux mensuels, conservés en privé, rien n'est publié | Réponse écrite du SECO du 12.10.2026 (authentification DMARC du domaine réussie) à la lettre du 07.10.2026 : la réutilisation est soumise aux [conditions générales du portail](https://shab.ch/static/agb_fr.pdf) en vigueur (version relue le 16.10.2026 et le 22.10.2026 : 07.06.2024), en particulier au point 3.3 ; les durées de publication de chaque avis doivent être respectées, et toute publication ou mise à disposition des données au-delà de ces durées doit être évitée ; la protection des données s'applique au traitement, au stockage et à la rediffusion, notamment pour les avis qui contiennent des données personnelles. Les conditions autorisent l'usage personnel et commercial (3.1, 3.2) et prévoient une API. Obligations (3.3) : protection des données, art. 11 al. 3 OFOSC par analogie pour les données personnelles, structure conforme au registre IDE, une seule publication par opération, mention de la source, mention « Ceci n'est pas une publication officielle », données non modifiées distinguées des commentaires, indications de qualité du SECO reprises. Une entreprise individuelle porte le nom de son titulaire (art. 945 CO) : ses données restent des données personnelles même réduites aux champs structurés. **Acceptation des conditions pour le compte du service : décision de Claude-Alain du 16.10.2026 (d3 = A, F8 accordé)** ; les CG exigent une nouvelle acceptation tous les 90 jours (CG 1.2 al. 1), premier renouvellement au plus tard le 14.01.2027, contrôlé par la collecte. Durée de publication d'un avis HR : aucune échéance dans l'API (`expirationDate` vide), accès « pour une durée indéterminée » que le service d'annonces peut limiter (art. 11 al. 2 et 3 OFOSC). | Champs structurés des sociétés seulement (IDE, type d'événement, date, commune, canton, forme juridique), jamais le texte libre ; liste blanche fermée de formes juridiques, entreprises individuelles et sociétés de personnes dans les totaux seulement ; une ligne n'existe plus le 30e jour après la publication (ni le jour de l'échéance de l'avis), et part aussi dès que l'avis n'est plus publié ou faute de revérification depuis 3 jours ; un avis à plusieurs sociétés ou sans IDE reste dans les totaux. Avant toute publication : décider ce qui reste publiable des totaux après les durées de publication (petites cases), la durée de conservation des lignes et l'élargissement éventuel de la liste blanche ; renouveler l'acceptation tous les 90 jours ; relire la version en vigueur des conditions à chaque évolution (la collecte s'arrête si le PDF change). |
| OFS / Registre IDE (service web IDE, Public Services) | Aucun produit à ce jour. Envisagé pour la fiche société (`company_check`) : consultation d'une seule entité à la fois, à la demande ; rien n'est lu ni servi depuis ce service | Réponse écrite de l'OFS du 13.11.2026 (authentification DMARC du domaine réussie) à la question du 07.10.2026, relancée une fois, après une réponse d'attente du 02.11.2026. Elle dit que l'accès aux données IDE par les Public Services est ouvert à tous et que les conditions sont fixées par la [loi sur le numéro d'identification des entreprises](https://www.fedlex.admin.ch/eli/cc/2010/705/fr) (LIDE, RS 431.03) : art. 11 (l'OFS limite la consultation aux requêtes individuelles concernant une entité déterminée ; par lots, seuls les numéros IDE peuvent être rendus accessibles ; les caractères clés d'une entité sont publiés uniquement avec son accord, sauf disposition contraire d'une autre loi fédérale ; une phrase transitoire, en vigueur du 19.12.2020 au 31.12.2032 selon la note du texte, prévoit que l'OFS les publie sans cet accord jusqu'à l'abrogation de la loi sur les cautionnements solidaires liés au COVID-19) et art. 13 (l'utilisation de l'IDE par des tiers est autorisée si le numéro est publié dans le registre). Sur l'usage commercial, l'OFS écrit que son site porte encore des indications contradictoires, qu'un nouveau texte est en rédaction et que les conditions déterminantes sont celles indiquées sur l'objet publié lui-même : la [fiche des spécifications du service web](https://statistik.admin.ch/de/asset/24605175) porte le badge OPEN-BY (« Freie Nutzung - Quellenangabe ist Pflicht », relu le 15.11.2026). Limite d'appel indiquée : 20 requêtes par minute. Mention demandée : « OFS, registre IDE, https://www.uid.admin.ch ». La réponse ne se prononce pas expressément sur la reprise dans des fichiers : elle renvoie à l'art. 11, qui écarte la consultation par lots des caractères autres que le numéro. La réponse ne mentionne aucune condition contractuelle à accepter. Lecture d'OpenSwissData, pas un avis juridique. | Avant toute lecture du service : une entité à la fois et à la demande, jamais de lot, de préchargement ni de fichier tiré de ce service ; moins de 20 requêtes par minute ; la mention demandée et la date de consultation ; pas de copie durable (ce que le registre publie d'une entité peut changer, et la règle de l'accord de l'entité s'appliquera de nouveau à la fin de la phrase transitoire) ; aucune personne physique (le registre couvre aussi des entreprises individuelles et des professions libérales). À revoir à la parution des nouvelles conditions d'utilisation de l'OFS. |
| SECO / SESAM (liste des sanctions) | Service d'interrogation `/api/v1/sanctions` : organisations et bateaux seulement (décision du 04.11.2026), personnes physiques non reprises ; collecte quotidienne `refresh-sanctions.yml`, document réduit dans le bucket privé. Aucun fichier vendu | Réponse écrite du secteur des sanctions du SECO du 04.11.2026 (authentification DMARC du domaine réussie) à la lettre du 07.10.2026 : les données étant accessibles au public, leur reprise dans un fichier destiné à des professionnels et dans un service d'interrogation est autorisée, « sous réserve du respect des dispositions légales applicables ». Points signalés par le SECO : la mise à jour régulière relève de la responsabilité de l'utilisateur ; privilégier, dans la mesure du possible, le format structuré officiellement mis à disposition par le SECO (relevé de notre part le 04.11.2026 : fichier XML de SESAM) ; conservation recommandée de la référence à la version de la liste utilisée. Pour les personnes physiques, notamment : garantir la fidélité des informations reprises, limiter les risques d'homonymie, respecter les dispositions applicables en matière de protection des données. Aucune condition générale à accepter n'accompagne cette réponse. | Périmètre tranché le 04.11.2026 : sans les personnes physiques ; les reprendre demanderait un examen écrit de protection des données. Tenu dans le code (`etl/sanctions/SOURCES.md`) : date et empreinte de la liste dans chaque réponse, entrées radiées écartées, rapprochement exact seulement, sans relevé réussi depuis trois jours, la liste n'est plus servie comme actuelle ; fichier du SECO inchangé depuis plus de 60 jours : la collecte s'arrête et alerte. |
| OFDF / commerce extérieur (recettes douanières, commerce par tarif et pays, concordance CPA) | Aucun produit publié, rien de vendu. Collecte mensuelle `refresh-douane.yml` (`etl/douane/`), document réduit sans personne dans le bucket privé ; aucune route ne le lit à ce jour | Licence affichée sur opendata.swiss : `terms_by_ask` (usage libre avec indication de la source, usage commercial seulement avec l'autorisation de l'éditeur), relue le 05.11.2026. **Aucun accord demandé ni obtenu** pour ces fichiers ; l'autorisation du 21.04.2026 vise TARES seulement. Usage réel : décision de Claude-Alain du 05.11.2026, service gratuit, source citée, retrait sous 48 heures sur demande ; un éditeur peut réclamer. Ce n'est pas un avis juridique. | Avant tout service public et avant toute vente, qui demanderaient une nouvelle décision (F2). À chaque changement de licence sur la fiche. |
| OFS / STATENT | Ancien outil `statent_lookup`, complément Pro non publié | Aucune autorisation écrite correspondante identifiée dans le dossier. **Outil retiré du registre MCP et CSV retiré du service courant.** La souscription d’un client ne vaut pas permission OFS. | Réouvrir uniquement après preuve écrite couvrant la diffusion prévue, ou conditions spécifiques établissant clairement ce droit ; vérifier ensuite la qualité et l’actualisation. |

Les [conditions OFS](https://www.bfs.admin.ch/bfs/fr/home/ofs/statistique-publique/copyright.html)
consultées le 25.09.2026 distinguent usage interne et transmission de données à
des tiers. Elles demandent une autorisation écrite pour l’usage commercial
décrit sur cette page. Les éventuelles conditions propres à un jeu doivent être
vérifiées avant d’étendre cette conclusion à d’autres sources. Le 03.11.2026,
cette adresse redirige vers une autre page ; les textes actuels sont les
[conditions d’utilisation](https://www.bfs.admin.ch/fr/conditions-dutilisation)
publiées le 27.10.2026 (dont le badge OPEN BY) et
l’[impressum](https://www.bfs.admin.ch/fr/impressum-fr) (accord préalable et
écrit pour la reproduction). Le 13.11.2026, à propos du service web IDE, l’OFS
a écrit que son site porte encore des indications contradictoires sur l’usage
commercial, qu’un nouveau texte est en rédaction et que les conditions
indiquées sur l’objet publié lui-même sont déterminantes. Cette réponse vise
le registre IDE : elle n’est étendue ici ni à STATENT, ni aux nomenclatures,
ni à un autre jeu, dont le badge et les conditions se vérifient un par un.

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
