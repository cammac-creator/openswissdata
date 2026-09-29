/**
 * Guide 1 : vérifier qu’un établissement est autorisé par la FINMA.
 * Chaque fait vient d’une source de lib/guides.ts, consultée le 29.09.2026 ; les citations reprennent
 * le texte officiel de la FINMA dans la langue de la page.
 */
import type { GuideDefinition } from '../../lib/guides';

export const authorisationCheck: GuideDefinition = {
  schemaType: 'Article',
  order: 1,
  fr: {
    title: "Vérifier qu’un établissement est autorisé par la FINMA",
    description: "Listes de la FINMA, catégories d’autorisation, IDE (UID) et LEI : où vérifier un prestataire financier suisse, et ce qu’une absence signifie ou non.",
    short: "Vérifier une autorisation",
    summary: "Où chercher selon le prestataire, comment lire un résultat, et pourquoi une absence n’est jamais une sanction.",
    h1: "Vérifier qu’un établissement",
    accent: "est autorisé par la FINMA.",
    lede: "Avant d’ouvrir une relation, de signer un contrat ou de verser des fonds, on veut savoir si le prestataire dispose de l’autorisation requise. La FINMA publie les listes des établissements, personnes et produits autorisés. Ce guide explique où chercher selon le prestataire, comment lire un résultat, et pourquoi une absence ne se lit jamais comme une sanction.",
    sections: [
      {
        id: "essentiel", title: "L’essentiel en quatre temps",
        blocks: [
          { type: "p", text: "Une vérification solide suit quatre étapes. Les sections suivantes les détaillent, chacune avec ses sources officielles." },
          { type: "path", label: "Le parcours d’une vérification", steps: [
            { title: "Identifier l’entité", text: "Raison sociale, siège et IDE (UID) : le registre IDE et Zefix aident à les confirmer." },
            { title: "Choisir la bonne liste", text: "Établissements autorisés, registre des intermédiaires d’assurance ou membres d’un OAR, selon l’activité." },
            { title: "Lire la catégorie", text: "L’autorisation trouvée doit correspondre au service proposé." },
            { title: "Conclure prudemment", text: "Une présence vaut à la date de la liste ; une absence appelle une vérification, jamais une conclusion de sanction." },
          ] },
        ],
      },
      {
        id: "publication", title: "Ce que publie la FINMA",
        blocks: [
          { type: "p", text: "La FINMA rappelle que de nombreuses activités du marché financier nécessitent une autorisation, délivrée par elle dans la plupart des domaines : accepter de l’argent placé par des clients ou des investisseurs, signer des polices d’assurance, proposer et gérer des fonds de placement.[^finma-autorises]" },
          { type: "quote", source: "finma-autorises", text: "Pour vérifier si une personne, une entreprise ou un produit financier dispose bien de l’autorisation requise, vous pouvez les rechercher ici par leurs noms." },
          { type: "p", text: "La même page propose des listes téléchargeables par catégorie, chacune avec sa date de dernière modification. En complément, la FINMA met à disposition, « à titre de prestation », les numéros d’identification (UID) disponibles des entreprises autorisées.[^finma-autorises]" },
          { type: "p", text: "L’autorisation n’entraîne pas partout la même surveillance. Selon la FINMA, celle-ci va « du contrôle continu et généralisé au simple enregistrement sans suivi régulier » ; dans certains cas, les prestataires doivent aussi s’affilier à un organisme privé d’autorégulation.[^finma-autorises]" },
        ],
      },
      {
        id: "listes", title: "Choisir la bonne liste",
        blocks: [
          { type: "p", text: "Le type de prestataire détermine l’endroit où chercher. Le tableau reprend les catégories telles que la FINMA les présente. La dernière colonne indique si la catégorie figure dans la liste des UID d’entreprises autorisées publiée par la FINMA, sur laquelle repose le fichier d’OpenSwissData.[^finma-uid-csv]" },
          { type: "table", caption: "Où vérifier, selon le prestataire", head: ["Prestataire", "Où vérifier sur finma.ch", "Dans la liste des UID"], rows: [
            ["Banques et maisons de titres, y compris banques Raiffeisen, succursales et représentations d’établissements étrangers", "Recherche par nom ; listes des banques et maisons de titres autorisées, des banques Raiffeisen et des représentations étrangères", "Oui"],
            ["Entreprises et groupes d’assurance", "Recherche par nom ; listes des entreprises et des groupes d’assurance autorisés", "Oui"],
            ["Intermédiaires d’assurance", "[Registre des intermédiaires d’assurance](https://www.finma.ch/fr/surveillance/versicherungsvermittler/registersuche/) : inscription obligatoire pour les intermédiaires non liés, exceptionnelle pour les liés[^finma-intermediaires]", "Non"],
            ["Directions de fonds, gestionnaires de fortune collective, SICAV, sociétés en commandite de placements collectifs, représentants de placements collectifs étrangers", "Recherche par nom ; liste des directions de fonds, gestionnaires de fortune collective et représentants de fonds de placement étrangers", "Oui"],
            ["Placements collectifs (les produits eux-mêmes)", "Listes des placements collectifs suisses et étrangers", "Non"],
            ["Gestionnaires de fortune et trustees", "Liste des gestionnaires de fortune et trustees autorisés par la FINMA et surveillés par un organisme de surveillance", "Oui"],
            ["Organismes de surveillance", "Liste des organismes de surveillance autorisés par la FINMA", "Oui"],
            ["Personnes autorisées selon l’art. 1b LB (autorisation fintech)", "Liste des personnes autorisées selon l’art. 1b LB", "Oui"],
            ["Infrastructures des marchés financiers : plates-formes de négociation, système multilatéral de négociation, contrepartie centrale, dépositaire central, référentiel central", "Liste des participants étrangers et des infrastructures des marchés financiers", "Oui, pour les infrastructures suisses autorisées"],
            ["Organes d’enregistrement et organes de contrôle des prospectus", "Listes des organes d’enregistrement et des organes de contrôle des prospectus", "Oui"],
            ["Intermédiaires financiers affiliés à un organisme d’autorégulation (OAR)", "[Recherche de membres OAR](https://www.finma.ch/fr/autorisation/organisme-d-autoregulation-oar/recherche-de-membres-oar/)[^finma-oar]", "Non"],
          ], note: "Dernière colonne : constat fait le 29.09.2026 d’après les types d’autorisation présents dans la liste des UID. La FINMA peut faire évoluer cette liste." },
          { type: "callout", title: "Lire la catégorie, pas seulement le nom", text: "Une autorisation couvre une activité. La FINMA le rappelle pour les intermédiaires d’assurance : une inscription à ce titre « ne signifie pas nécessairement qu’une autorisation a été octroyée pour la vente d’autres services financiers ».[^finma-intermediaires] Vérifiez que la catégorie trouvée correspond au service proposé." },
          { type: "p", text: "Les intermédiaires financiers soumis à la loi sur le blanchiment d’argent (LBA) par l’affiliation à un OAR se recherchent parmi les membres des OAR. La FINMA précise qu’elle ne garantit ni l’exhaustivité ni l’exactitude de ces données, actualisées sur la base des informations des OAR, généralement dans un délai de deux à cinq jours ouvrables.[^finma-oar]" },
        ],
      },
      {
        id: "resultat", title: "Ce qu’un résultat permet de conclure",
        blocks: [
          { type: "p", text: "Les listes de la FINMA sont mises à jour régulièrement. La FINMA avertit toutefois qu’elles peuvent être en décalage, dans les deux sens :" },
          { type: "quote", source: "finma-autorises", text: "Il peut arriver que des assujettis aient reçu l’autorisation d’exercer une activité commerciale, mais qu’ils ne figurent pas encore sur la liste correspondante, ou que des assujettis figurent encore comme disposant d’une autorisation d’exercer une activité commerciale, mais que ladite autorisation leur a déjà été retirée." },
          { type: "p", text: "Une présence est donc un indice fort à la date de la liste, pas une garantie à la minute. Une absence appelle une vérification, pas une conclusion. Plusieurs explications sont possibles :" },
          { type: "list", items: [
            "**Un autre nom.** Le prestataire se présente sous une marque ou un nom commercial, alors que la liste reprend une autre dénomination. Cherchez la raison sociale exacte, puis une partie distinctive du nom.",
            "**Un autre registre.** Les intermédiaires d’assurance ont leur propre registre, et les intermédiaires financiers affiliés à un OAR se recherchent parmi les membres des OAR.[^finma-autorises]",
            "**Une activité qui ne requiert pas d’autorisation de la FINMA.** Depuis le 1er août 2017, par exemple, des entreprises peuvent, à certaines conditions, accepter des fonds jusqu’à un million de francs sans autorisation (« sandbox ») ; elles ne sont alors pas surveillées par la FINMA et il n’existe pas de garantie des dépôts.[^finma-sans-droit]",
            "**Un décalage de la liste**, dans un sens ou dans l’autre, comme la FINMA l’indique ci-dessus.",
          ] },
          { type: "callout", tone: "warn", title: "Une absence n’est pas une sanction", text: "Ne pas figurer sur une liste d’autorisations n’est ni une décision de la FINMA, ni la preuve d’une infraction. Les décisions finales que la FINMA publie après de graves violations forment une liste distincte, tout comme la liste d’alerte.[^finma-alertes] Voir le [guide sur la liste d’alerte](@/guides/finma-warning-list/)." },
          { type: "p", text: "En cas de doute, la FINMA indique sur la même page une adresse et une ligne téléphonique pour demander si un prestataire dispose de l’autorisation nécessaire.[^finma-autorises]" },
        ],
      },
      {
        id: "identifiants", title: "Identifier la bonne entité : IDE (UID) et LEI",
        blocks: [
          { type: "p", text: "Un nom peut être partagé, traduit ou mal orthographié. Un identifiant désigne une seule entité : c’est lui qu’il faut rapprocher en priorité." },
          { type: "h3", text: "L’IDE, ou UID" },
          { type: "p", text: "Selon l’Office fédéral de la statistique (OFS), chaque entreprise active en Suisse reçoit un numéro d’identification des entreprises (IDE, UID en allemand et en anglais), unique et immuable. Il se compose de « CHE » et de neuf chiffres attribués au hasard ; les graphies `CHE123456789` et `CHE-123.456.789` sont toutes deux admises. L’ajout qui suit parfois le numéro (RC, TVA ou RC/TVA) ne fait pas partie de l’IDE.[^ofs-uid]" },
          { type: "p", text: "Le registre IDE est tenu par l’OFS, et une partie de ses données peut être consultée par le public[^ofs-uid] ; sa [recherche en ligne](https://www.uid.admin.ch/) accepte un nom ou un IDE.[^uid-register] Pour la raison sociale et le siège inscrits au registre du commerce, l’index central Zefix, actualisé quotidiennement, répond à des requêtes individuelles.[^ofj-zefix]" },
          { type: "p", text: "Dans la liste des UID publiée par la FINMA, toutes les lignes n’ont pas d’UID : la FINMA parle des numéros « disponibles ».[^finma-autorises] Une même entreprise peut aussi y figurer sur plusieurs lignes, une par type d’autorisation.[^finma-uid-csv]" },
          { type: "h3", text: "Le LEI" },
          { type: "p", text: "Le LEI (Legal Entity Identifier) est un code alphanumérique de 20 caractères, fondé sur la norme ISO 17442 et administré par la GLEIF.[^gleif-lei] La liste des UID de la FINMA n’en contient pas : elle donne le nom, la localité, le type d’autorisation en allemand, français, italien et anglais, et l’UID.[^finma-uid-csv]" },
          { type: "p", text: "Le statut d’un LEI décrit son enregistrement, pas l’autorisation FINMA. « LAPSED » désigne un enregistrement qui n’a pas été renouvelé à la date prévue et dont l’entité n’est pas connue, d’après les sources publiques, pour avoir cessé ses activités.[^gleif-cdf] Un LEI échu ne dit donc rien de l’autorisation." },
        ],
      },
      {
        id: "trace", title: "Garder une trace de la vérification",
        blocks: [
          { type: "p", text: "Une vérification utile doit pouvoir être relue plus tard. Pour chaque contrôle, il est prudent de noter :" },
          { type: "list", items: [
            "la date de la consultation et la source : page ou liste de la FINMA, avec sa date de dernière modification ;",
            "le nom et l’identifiant recherchés ;",
            "le résultat, la catégorie d’autorisation trouvée et la conclusion retenue ;",
            "les démarches complémentaires : registre IDE, Zefix, question posée à la FINMA.",
          ] },
          { type: "p", text: "Cette liste est une méthode de travail, pas une exigence réglementaire : vos obligations dépendent de votre activité et de votre cadre interne." },
        ],
      },
      {
        id: "echelle", title: "Vérifier une liste entière",
        blocks: [
          { type: "p", text: "Contrôler un nom à la main reste simple. Pour des centaines de contreparties, ou pour refaire le contrôle à intervalles réguliers, le [guide sur l’automatisation](@/guides/finma-screening-automation/) montre comment rapprocher une liste par IDE, par LEI, puis par nom." },
          { type: "p", text: "Le [fichier FINMA d’OpenSwissData](@/datasets/finma/) reprend la liste des UID de la FINMA, ajoute le LEI lorsque l’IDE correspond exactement à un seul LEI chez la GLEIF, et place la liste d’alerte dans des fichiers séparés. L’[échantillon CSV](/api/catalog/finma?format=csv) permet d’examiner le format sans compte." },
        ],
      },
    ],
  },
  de: {
    title: "Prüfen, ob ein Institut von der FINMA bewilligt ist",
    description: "FINMA-Listen, Bewilligungsarten, UID und LEI: wo Sie einen Schweizer Finanzdienstleister prüfen und was ein fehlender Eintrag bedeutet, und was nicht.",
    short: "Bewilligung prüfen",
    summary: "Wo Sie je nach Anbieter suchen, wie Sie ein Ergebnis lesen und warum ein fehlender Eintrag nie eine Sanktion ist.",
    h1: "Prüfen, ob ein Institut",
    accent: "von der FINMA bewilligt ist.",
    lede: "Bevor Sie eine Geschäftsbeziehung eröffnen, einen Vertrag unterzeichnen oder Geld überweisen, wollen Sie wissen, ob der Anbieter über die nötige Bewilligung verfügt. Die FINMA veröffentlicht Listen der bewilligten Institute, Personen und Produkte. Dieser Leitfaden zeigt, wo Sie je nach Anbieter suchen, wie Sie ein Ergebnis lesen und warum ein fehlender Eintrag nie als Sanktion zu verstehen ist.",
    sections: [
      {
        id: "essentiel", title: "Das Wichtigste in vier Schritten",
        blocks: [
          { type: "p", text: "Eine sorgfältige Prüfung folgt vier Schritten. Die nächsten Abschnitte erläutern sie, jeweils mit den offiziellen Quellen." },
          { type: "path", label: "Ablauf einer Prüfung", steps: [
            { title: "Einheit bestimmen", text: "Firma, Sitz und UID: UID-Register und Zefix helfen bei der Bestätigung." },
            { title: "Richtige Liste wählen", text: "Bewilligte Institute, Register der Versicherungsvermittler oder SRO-Mitglieder, je nach Tätigkeit." },
            { title: "Bewilligungsart lesen", text: "Die gefundene Bewilligung muss zur angebotenen Dienstleistung passen." },
            { title: "Vorsichtig folgern", text: "Ein Eintrag gilt für den Stand der Liste; ein fehlender Eintrag verlangt Abklärungen, nie den Schluss auf eine Sanktion." },
          ] },
        ],
      },
      {
        id: "publication", title: "Was die FINMA veröffentlicht",
        blocks: [
          { type: "p", text: "Für viele Tätigkeiten im Schweizer Finanzmarkt braucht es eine Bewilligung, die in den meisten Bereichen von der FINMA erteilt wird: etwa um Gelder von Kunden zu verwalten oder von Anlegern entgegenzunehmen, Versicherungspolicen zu zeichnen oder Fonds aufzulegen und zu verwalten.[^finma-autorises]" },
          { type: "quote", source: "finma-autorises", text: "Damit Sie überprüfen können, ob eine Person, ein Unternehmen oder ein Finanzprodukt über die notwendige Bewilligung verfügt, können Sie hier gezielt nach dessen Namen suchen." },
          { type: "p", text: "Auf derselben Seite stehen Listen je Kategorie zum Herunterladen bereit, jede mit dem Datum der letzten Änderung. Ergänzend stellt die FINMA «als Dienstleistung» die verfügbaren Unternehmens-Identifikationsnummern (UID) bewilligter Unternehmen zur Verfügung.[^finma-autorises]" },
          { type: "p", text: "Eine Bewilligung zieht nicht überall die gleiche Aufsicht nach sich. Laut FINMA reicht das Spektrum «von einer umfassenden laufenden Überwachung bis zu einer reinen Registrierung ohne laufende Überwachung»; in bestimmten Fällen müssen sich Anbieter zudem einer privaten Selbstregulierungsorganisation anschliessen.[^finma-autorises]" },
        ],
      },
      {
        id: "listes", title: "Die richtige Liste wählen",
        blocks: [
          { type: "p", text: "Welche Liste die richtige ist, hängt vom Anbieter ab. Die Tabelle übernimmt die Kategorien, wie die FINMA sie darstellt. Die letzte Spalte zeigt, ob die Kategorie in der von der FINMA veröffentlichten UID-Liste bewilligter Unternehmen enthalten ist, auf der die Datei von OpenSwissData beruht.[^finma-uid-csv]" },
          { type: "table", caption: "Wo prüfen, je nach Anbieter", head: ["Anbieter", "Wo prüfen auf finma.ch", "In der UID-Liste"], rows: [
            ["Banken und Wertpapierhäuser, einschliesslich Raiffeisenbanken, Zweigniederlassungen und Vertretungen ausländischer Institute", "Namenssuche; Listen der bewilligten Banken und Wertpapierhäuser, der Raiffeisenbanken und der ausländischen Vertretungen", "Ja"],
            ["Versicherungsunternehmen und Versicherungskonzerne", "Namenssuche; Listen der bewilligten Versicherungsunternehmen und Versicherungskonzerne", "Ja"],
            ["Versicherungsvermittlerinnen und -vermittler", "[Register für Versicherungsvermittlerinnen und -vermittler](https://www.finma.ch/de/ueberwachung/versicherungsvermittler/registersuche/): Eintrag obligatorisch für ungebundene, im Ausnahmefall für gebundene[^finma-intermediaires]", "Nein"],
            ["Fondsleitungen, Verwalter von Kollektivvermögen, SICAV, Kommanditgesellschaften für kollektive Kapitalanlagen, Vertreter ausländischer kollektiver Kapitalanlagen", "Namenssuche; Liste der bewilligten Fondsleitungen, Verwalter von Kollektivvermögen und Vertreter von ausländischen kollektiven Kapitalanlagen", "Ja"],
            ["Kollektive Kapitalanlagen (die Produkte selbst)", "Listen der schweizerischen und ausländischen kollektiven Kapitalanlagen", "Nein"],
            ["Vermögensverwalter und Trustees", "Liste der von der FINMA bewilligten und von einer Aufsichtsorganisation überwachten Vermögensverwalter und Trustees", "Ja"],
            ["Aufsichtsorganisationen", "Liste der von der FINMA bewilligten Aufsichtsorganisationen", "Ja"],
            ["Bewilligte Personen nach Art. 1b BankG (Fintech-Bewilligung)", "Liste der bewilligten Personen nach Art. 1b BankG", "Ja"],
            ["Finanzmarktinfrastrukturen: Handelsplätze, multilaterales Handelssystem, zentrale Gegenpartei, Zentralverwahrer, Transaktionsregister", "Liste der ausländischen Teilnehmer und der Finanzmarktinfrastrukturen", "Ja, für bewilligte Schweizer Infrastrukturen"],
            ["Registrierungsstellen und Prüfstellen für Prospekte", "Listen der zugelassenen Registrierungsstellen und Prüfstellen für Prospekte", "Ja"],
            ["Finanzintermediäre, die einer Selbstregulierungsorganisation (SRO) angeschlossen sind", "[SRO-Mitglieder-Suche](https://www.finma.ch/de/bewilligung/selbstregulierungsorganisationen-sro/sro-mitglieder-suche/)[^finma-oar]", "Nein"],
          ], note: "Letzte Spalte: Befund vom 29.09.2026 anhand der Bewilligungsarten in der UID-Liste. Die FINMA kann diese Liste ändern." },
          { type: "callout", title: "Die Bewilligungsart lesen, nicht nur den Namen", text: "Eine Bewilligung gilt für eine Tätigkeit. Die FINMA hält dies für Versicherungsvermittler fest: Eine Registrierung als Versicherungsvermittlerin oder -vermittler «schliesst nicht automatisch eine Bewilligung für die Vermittlung anderer Finanzdienstleistungen mit ein».[^finma-intermediaires] Prüfen Sie, ob die gefundene Bewilligungsart zur angebotenen Dienstleistung passt." },
          { type: "p", text: "Finanzintermediäre, die dem Geldwäschereigesetz (GwG) über den Anschluss an eine SRO unterstehen, finden Sie über die SRO-Mitglieder-Suche. Die FINMA bietet dort keine Gewähr für Vollständigkeit und Richtigkeit; die Daten der Selbstregulierungsorganisationen werden regelmässig aktualisiert, in der Regel innert zwei bis fünf Arbeitstagen.[^finma-oar]" },
        ],
      },
      {
        id: "resultat", title: "Was ein Ergebnis aussagt",
        blocks: [
          { type: "p", text: "Die Listen der FINMA werden regelmässig aktualisiert. Die FINMA weist aber selbst darauf hin, dass sie in beide Richtungen vom aktuellen Stand abweichen können:" },
          { type: "quote", source: "finma-autorises", text: "Es kann vorkommen, dass Beaufsichtigte die Bewilligung zur Geschäftstätigkeit erhalten haben, jedoch noch nicht auf der entsprechenden Liste aufgeführt sind, oder dass Beaufsichtigte noch als bewilligt aufgeführt sind, denen die Bewilligung zur Geschäftstätigkeit bereits entzogen worden ist." },
          { type: "p", text: "Ein Eintrag ist also ein starkes Indiz für den Stand der Liste, keine Garantie auf die Minute. Ein fehlender Eintrag verlangt Abklärungen, keine Schlussfolgerung. Mögliche Erklärungen:" },
          { type: "list", items: [
            "**Ein anderer Name.** Der Anbieter tritt unter einer Marke oder einem Geschäftsnamen auf, die Liste führt eine andere Bezeichnung. Suchen Sie nach der genauen Firma und danach nach einem unterscheidungskräftigen Namensteil.",
            "**Ein anderes Register.** Versicherungsvermittler haben ein eigenes Register, und Finanzintermediäre mit SRO-Anschluss finden Sie über die SRO-Mitglieder-Suche.[^finma-autorises]",
            "**Eine Tätigkeit ohne FINMA-Bewilligungspflicht.** Seit dem 1. August 2017 dürfen Unternehmen zum Beispiel unter bestimmten Voraussetzungen Gelder bis CHF 1 Mio. bewilligungsfrei entgegennehmen («Sandbox»); sie werden dann nicht von der FINMA beaufsichtigt, und es besteht keine Einlagensicherung.[^finma-sans-droit]",
            "**Eine zeitliche Abweichung der Liste**, in die eine oder andere Richtung, wie oben von der FINMA beschrieben.",
          ] },
          { type: "callout", tone: "warn", title: "Kein Eintrag ist keine Sanktion", text: "Wer auf keiner Bewilligungsliste steht, ist weder Gegenstand einer FINMA-Verfügung, noch ist damit ein Verstoss belegt. Die Endverfügungen, welche die FINMA bei schweren Verletzungen veröffentlicht, bilden eine eigene Liste, ebenso die Warnliste.[^finma-alertes] Siehe den [Leitfaden zur Warnliste](@/guides/finma-warning-list/)." },
          { type: "p", text: "Im Zweifelsfall nennt die FINMA auf derselben Seite eine Adresse und eine Hotline, über die Sie erfragen können, ob ein Anbieter die notwendige Bewilligung besitzt.[^finma-autorises]" },
        ],
      },
      {
        id: "identifiants", title: "Die richtige Einheit bestimmen: UID und LEI",
        blocks: [
          { type: "p", text: "Ein Name kann mehrfach vorkommen, übersetzt oder falsch geschrieben sein. Eine Kennung bezeichnet genau eine Einheit: Sie sollte zuerst abgeglichen werden." },
          { type: "h3", text: "Die UID" },
          { type: "p", text: "Laut Bundesamt für Statistik (BFS) erhält jedes in der Schweiz aktive Unternehmen eine einheitliche Unternehmens-Identifikationsnummer (UID), eindeutig und unveränderlich. Sie besteht aus «CHE» und neun zufällig zugeteilten Ziffern; die Schreibweisen `CHE123456789` und `CHE-123.456.789` sind beide gültig. Die Ergänzung hinter der Nummer (HR, MWST oder HR/MWST) ist nicht Teil der UID.[^ofs-uid]" },
          { type: "p", text: "Das UID-Register wird vom BFS geführt, und ein Teil seiner Daten kann von der Öffentlichkeit eingesehen werden[^ofs-uid]; die [Online-Suche](https://www.uid.admin.ch/) nimmt einen Namen oder eine UID entgegen.[^uid-register] Für Firma und Sitz laut Handelsregister gibt der zentrale Firmenindex Zefix, täglich aktualisiert, Auskunft auf Einzelabfragen.[^ofj-zefix]" },
          { type: "p", text: "In der UID-Liste der FINMA hat nicht jede Zeile eine UID: Die FINMA spricht von den «verfügbaren» Nummern.[^finma-autorises] Ein Unternehmen kann zudem mehrmals erscheinen, mit einer Zeile je Bewilligungsart.[^finma-uid-csv]" },
          { type: "h3", text: "Der LEI" },
          { type: "p", text: "Der LEI (Legal Entity Identifier) ist ein alphanumerischer Code mit 20 Zeichen, beruht auf der Norm ISO 17442 und wird von der GLEIF verwaltet.[^gleif-lei] Die UID-Liste der FINMA enthält keinen LEI: Sie nennt Name, Ort, Bewilligungsart auf Deutsch, Französisch, Italienisch und Englisch sowie die UID.[^finma-uid-csv]" },
          { type: "p", text: "Der Status eines LEI beschreibt dessen Registrierung, nicht die FINMA-Bewilligung. «LAPSED» bezeichnet eine Registrierung, die nicht bis zum vorgesehenen Datum erneuert wurde und deren Einheit nach öffentlichen Quellen ihre Tätigkeit nicht eingestellt hat.[^gleif-cdf] Ein abgelaufener LEI sagt also nichts über die Bewilligung aus." },
        ],
      },
      {
        id: "trace", title: "Die Prüfung dokumentieren",
        blocks: [
          { type: "p", text: "Eine nützliche Prüfung lässt sich später nachvollziehen. Für jede Abklärung empfiehlt es sich festzuhalten:" },
          { type: "list", items: [
            "Datum und Quelle: Seite oder Liste der FINMA, mit ihrem Datum der letzten Änderung;",
            "den gesuchten Namen und die gesuchte Kennung;",
            "das Ergebnis, die gefundene Bewilligungsart und die gezogene Schlussfolgerung;",
            "weitere Abklärungen: UID-Register, Zefix, Anfrage bei der FINMA.",
          ] },
          { type: "p", text: "Diese Liste ist eine Arbeitsweise, keine regulatorische Vorgabe: Ihre Pflichten hängen von Ihrer Tätigkeit und Ihren internen Vorgaben ab." },
        ],
      },
      {
        id: "echelle", title: "Eine ganze Liste prüfen",
        blocks: [
          { type: "p", text: "Einen Namen von Hand zu prüfen ist einfach. Für Hunderte von Gegenparteien oder regelmässige Wiederholungen zeigt der [Leitfaden zur Automatisierung](@/guides/finma-screening-automation/), wie Sie eine Liste über die UID, den LEI und zuletzt über den Namen abgleichen." },
          { type: "p", text: "Die [FINMA-Datei von OpenSwissData](@/datasets/finma/) übernimmt die UID-Liste der FINMA, ergänzt den LEI, wenn die UID genau einem LEI bei der GLEIF entspricht, und führt die Warnliste in separaten Dateien. Das [CSV-Muster](/api/catalog/finma?format=csv) zeigt das Format ohne Konto." },
        ],
      },
    ],
  },
  en: {
    title: "How to check whether a firm is authorised by FINMA",
    description: "FINMA lists, authorisation types, UID and LEI: where to check a Swiss financial services provider, and what a missing entry does and does not mean.",
    short: "Checking an authorisation",
    summary: "Where to search for each type of provider, how to read a result, and why a missing entry is never a sanction.",
    h1: "How to check whether a firm",
    accent: "is authorised by FINMA.",
    lede: "Before opening a relationship, signing a contract or transferring funds, you want to know whether the provider holds the required authorisation. FINMA publishes lists of authorised institutions, persons and products. This guide explains where to search for each type of provider, how to read a result, and why a missing entry must never be read as a sanction.",
    sections: [
      {
        id: "essentiel", title: "The essentials in four steps",
        blocks: [
          { type: "p", text: "A sound check follows four steps. The next sections explain each of them, with the official sources." },
          { type: "path", label: "How a check unfolds", steps: [
            { title: "Identify the entity", text: "Legal name, registered office and UID: the UID Register and Zefix help confirm them." },
            { title: "Pick the right list", text: "Authorised institutions, the register for insurance intermediaries or SRO members, depending on the activity." },
            { title: "Read the authorisation type", text: "The authorisation found must match the service offered." },
            { title: "Conclude with care", text: "An entry holds as of the list date; a missing entry calls for further checks, never for a conclusion of sanction." },
          ] },
        ],
      },
      {
        id: "publication", title: "What FINMA publishes",
        blocks: [
          { type: "p", text: "FINMA points out that many financial services in the Swiss market require authorisation, which in most cases it grants itself: for instance to manage clients’ money or take money from investors, to underwrite insurance policies, or to set up and manage a collective investment scheme.[^finma-autorises]" },
          { type: "quote", source: "finma-autorises", text: "To check whether an individual, a company or a financial product has been authorised, you can search for the name here." },
          { type: "p", text: "The same page offers downloadable lists by category, each showing its date of last modification. In addition, FINMA provides “as a service” the available business identification numbers (UID) of authorised companies.[^finma-autorises]" },
          { type: "p", text: "Authorisation does not bring the same supervision everywhere. According to FINMA, it “can range from intensive, ongoing supervision to a simple act of registration”; under certain circumstances, providers must instead join a private self-regulatory organisation.[^finma-autorises]" },
        ],
      },
      {
        id: "listes", title: "Picking the right list",
        blocks: [
          { type: "p", text: "The type of provider determines where to look. The table follows the categories as FINMA presents them. The last column shows whether the category appears in FINMA’s list of UIDs for authorised companies, which the OpenSwissData file is based on.[^finma-uid-csv]" },
          { type: "table", caption: "Where to check, by type of provider", head: ["Provider", "Where to check on finma.ch", "In the UID list"], rows: [
            ["Banks and securities firms, including Raiffeisen banks and branches or representative offices of foreign firms", "Name search; lists of authorised banks and securities firms, Raiffeisen banks and representative offices of foreign firms", "Yes"],
            ["Insurance companies and insurance groups", "Name search; lists of authorised insurance companies and insurance groups", "Yes"],
            ["Insurance intermediaries", "[Register for insurance intermediaries](https://www.finma.ch/en/supervision/versicherungsvermittler/registersuche/): mandatory for untied intermediaries, exceptional for tied ones[^finma-intermediaires]", "No"],
            ["Fund management companies, managers of collective assets, SICAVs, limited partnerships for collective investment schemes, representatives of foreign collective investment schemes", "Name search; list of authorised fund management companies, managers of collective assets and representatives of foreign collective investment schemes", "Yes"],
            ["Collective investment schemes (the products themselves)", "Lists of Swiss and foreign collective investment schemes", "No"],
            ["Portfolio managers and trustees", "List of portfolio managers and trustees licensed by FINMA and monitored by a supervisory organisation", "Yes"],
            ["Supervisory organisations", "List of supervisory organisations authorised by FINMA", "Yes"],
            ["Persons licensed under Article 1b BA (FinTech licence)", "List of persons licensed pursuant to Article 1b BA", "Yes"],
            ["Financial market infrastructures: trading venues, multilateral trading system, central counterparty, central custodian, transaction register", "List of foreign participants and financial market infrastructures", "Yes, for authorised Swiss infrastructures"],
            ["Registration bodies and reviewing bodies for prospectuses", "Lists of registration bodies and of reviewing bodies for prospectuses", "Yes"],
            ["Financial intermediaries affiliated with a self-regulatory organisation (SRO)", "[SRO member search](https://www.finma.ch/en/authorisation/self-regulatory-organisations-sros/sro-member-search/)[^finma-oar]", "No"],
          ], note: "Last column: finding of 29 September 2026, based on the authorisation types present in the UID list. FINMA may change this list." },
          { type: "callout", title: "Read the authorisation type, not just the name", text: "An authorisation covers an activity. FINMA makes the point for insurance intermediaries: “Registration as an insurance intermediary does not automatically include authorisation for the intermediation of other financial services.”[^finma-intermediaires] Check that the authorisation type you find matches the service offered." },
          { type: "p", text: "Financial intermediaries that fall under the Anti-Money Laundering Act (AMLA) through membership of an SRO are found with the SRO member search. FINMA states that it cannot guarantee the completeness or accuracy of this data, which is updated regularly from information provided by the SROs, usually within two to five working days.[^finma-oar]" },
        ],
      },
      {
        id: "resultat", title: "What a result tells you",
        blocks: [
          { type: "p", text: "FINMA’s lists are regularly updated. FINMA itself warns, however, that they can lag behind in both directions:" },
          { type: "quote", source: "finma-autorises", text: "A supervised institution may have been authorised but not yet be included in the list. Similarly, a supervised institution may still feature on the list even though it has lost its authorisation." },
          { type: "p", text: "An entry is therefore strong evidence as of the list date, not a real-time guarantee. A missing entry calls for further checks, not for a conclusion. There are several possible explanations:" },
          { type: "list", items: [
            "**A different name.** The provider trades under a brand or business name while the list uses another designation. Search for the exact legal name, then for a distinctive part of it.",
            "**A different register.** Insurance intermediaries have their own register, and financial intermediaries affiliated with an SRO are found through the SRO member search.[^finma-autorises]",
            "**An activity that does not require FINMA authorisation.** Since 1 August 2017, for example, companies may under certain conditions accept deposits of up to CHF 1 million without authorisation (the “sandbox”); they are then not supervised by FINMA and there is no depositor protection for these deposits.[^finma-sans-droit]",
            "**A lag in the list**, in either direction, as FINMA describes above.",
          ] },
          { type: "callout", tone: "warn", title: "A missing entry is not a sanction", text: "Not appearing on an authorisation list is neither a FINMA ruling nor evidence of a breach. The final rulings that FINMA publishes after serious breaches form a separate list, and so does the warning list.[^finma-alertes] See the [guide to the warning list](@/guides/finma-warning-list/)." },
          { type: "p", text: "If in doubt, FINMA gives an address and a hotline on the same page for asking whether a provider holds the necessary authorisation.[^finma-autorises]" },
        ],
      },
      {
        id: "identifiants", title: "Identifying the right entity: UID and LEI",
        blocks: [
          { type: "p", text: "A name can be shared, translated or misspelt. An identifier designates a single entity, so it is the first thing to match." },
          { type: "h3", text: "The UID" },
          { type: "p", text: "According to the Federal Statistical Office (FSO), every company active in Switzerland is given a unique and unchangeable business identification number (UID). It is made up of “CHE” and nine randomly allocated digits; both `CHE123456789` and `CHE-123.456.789` are allowed. The suffix sometimes shown after the number (HR, MWST or both) is not part of the UID.[^ofs-uid]" },
          { type: "p", text: "The UID Register is kept by the FSO, and some of its data is available to the public[^ofs-uid]; its [online search](https://www.uid.admin.ch/) takes a name or a UID.[^uid-register] For the legal name and registered office recorded in the commercial register, the central business name index Zefix, updated daily, answers individual queries.[^ofj-zefix]" },
          { type: "p", text: "Not every row in FINMA’s UID list has a UID: FINMA refers to the “available” numbers.[^finma-autorises] A company may also appear on several rows, one per authorisation type.[^finma-uid-csv]" },
          { type: "h3", text: "The LEI" },
          { type: "p", text: "The LEI (Legal Entity Identifier) is a 20-character alphanumeric code based on the ISO 17442 standard and administered by GLEIF.[^gleif-lei] FINMA’s UID list contains no LEI: it gives the name, the city, the authorisation type in German, French, Italian and English, and the UID.[^finma-uid-csv]" },
          { type: "p", text: "The status of an LEI describes its registration, not the FINMA authorisation. “LAPSED” means a registration that has not been renewed by its due date and whose entity is not known by public sources to have ceased operation.[^gleif-cdf] A lapsed LEI therefore says nothing about the authorisation." },
        ],
      },
      {
        id: "trace", title: "Keeping a record of the check",
        blocks: [
          { type: "p", text: "A useful check can be reviewed later. For each one, it is sensible to record:" },
          { type: "list", items: [
            "the date and the source: the FINMA page or list, with its date of last modification;",
            "the name and identifier searched for;",
            "the result, the authorisation type found and the conclusion drawn;",
            "any further steps: UID Register, Zefix, question put to FINMA.",
          ] },
          { type: "p", text: "This list is a way of working, not a regulatory requirement: your obligations depend on your activity and your internal framework." },
        ],
      },
      {
        id: "echelle", title: "Checking a whole list",
        blocks: [
          { type: "p", text: "Checking one name by hand is easy. For hundreds of counterparties, or to repeat the check at regular intervals, the [guide to automation](@/guides/finma-screening-automation/) shows how to match a list by UID, then LEI, then name." },
          { type: "p", text: "The [OpenSwissData FINMA file](@/datasets/finma/) takes FINMA’s UID list, adds the LEI when the UID matches exactly one LEI at GLEIF, and keeps the warning list in separate files. The [CSV sample](/api/catalog/finma?format=csv) lets you examine the format without an account." },
        ],
      },
    ],
  },
};
