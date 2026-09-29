/**
 * Guide 2 : la liste d’alerte de la FINMA (Warnliste, warning list).
 * Aucune entrée réelle n’est nommée ni liée : le schéma d’une entrée reprend seulement les rubriques
 * publiées par la FINMA. Une inscription n’est jamais présentée comme la preuve d’une infraction.
 */
import type { GuideDefinition } from '../../lib/guides';

export const warningList: GuideDefinition = {
  schemaType: 'Article',
  order: 2,
  fr: {
    title: "Liste d’alerte de la FINMA : ce qu’elle dit et ce qu’elle ne dit pas",
    description: "Qui figure sur la liste d’alerte de la FINMA, ce qu’une inscription signifie ou non, et comment l’utiliser dans un contrôle sans conclure sur un simple nom.",
    short: "La liste d’alerte",
    summary: "Qui y figure, ce qu’une inscription ne prouve pas, et comment traiter un nom proche sans conclusion hâtive.",
    h1: "La liste d’alerte de la FINMA.",
    accent: "Ce qu’elle dit. Ce qu’elle ne dit pas.",
    lede: "La FINMA publie une liste de sociétés et de personnes susceptibles d’exercer sans autorisation une activité qui en exige une. Son nom officiel est « liste d’alerte » ; on la rencontre aussi sous les noms de liste noire, de liste négative ou de liste d’avertissement. Elle est utile dans un contrôle à condition de la lire comme la FINMA la présente : un signal à examiner, pas un verdict sur une personne.",
    sections: [
      {
        id: "listes", title: "Trois listes, trois messages",
        blocks: [
          { type: "p", text: "Sur sa page « Alertes », la FINMA réunit trois listes destinées à rendre investisseurs, créanciers et assurés attentifs à de possibles dangers sur le marché financier : la liste d’alerte, la liste des décisions finales publiées selon l’art. 34 LFINMA et la liste des chargés d’enquête mandatés par la FINMA.[^finma-alertes]" },
          { type: "p", text: "Ces listes ne disent pas la même chose. Selon la FINMA, elle peut publier une décision finale, intégralement ou partiellement, en cas de graves violations du droit de la surveillance et après son entrée en force.[^finma-alertes] La liste d’alerte repose au contraire sur des soupçons que la FINMA n’a pas pu éclaircir." },
        ],
      },
      {
        id: "inscription", title: "Qui figure sur la liste d’alerte",
        blocks: [
          { type: "quote", source: "finma-liste-alerte", text: "Les entreprises et les personnes inscrites sur cette liste ont fait l’objet d’enquêtes de la part de la FINMA en raison d’activités exercées sans droit, mais il n’a pas encore été possible d’éclaircir les soupçons à leur égard car elles n’ont pas respecté leur obligation de renseigner vis-à-vis de la FINMA ou ont donné de fausses indications." },
          { type: "p", text: "La FINMA ajoute qu’un nom peut aussi être inscrit lorsque ses investigations laissent penser que le prestataire expose les investisseurs à un danger imminent et important. Les entreprises concernées sont supprimées de la liste dès que la FINMA a pu procéder aux vérifications nécessaires.[^finma-liste-alerte]" },
          { type: "p", text: "La liste se consulte par nom sur le site de la FINMA, avec deux filtres : « Avec inscription au registre du commerce » et « Sans inscription au registre du commerce ».[^finma-liste-alerte]" },
        ],
      },
      {
        id: "limites", title: "Ce qu’une inscription ne dit pas",
        blocks: [
          { type: "list", items: [
            "**Pas une preuve d’activité illicite.** Pour la FINMA, le fait qu’une entreprise figure sur la liste « ne signifie pas nécessairement qu’elle exerce une activité illicite » ; l’inscription fait savoir qu’elle ne dispose pas de l’autorisation requise.[^finma-liste-alerte]",
            "**Pas une décision de sanction.** Les décisions finales publiées selon l’art. 34 LFINMA forment une liste distincte.[^finma-alertes]",
            "**Pas une liste de sanctions internationales.** La Suisse met en œuvre les sanctions internationales sur la base de la loi sur les embargos ou de la législation sur le blanchiment d’argent[^finma-sanctions] ; le SECO publie la liste récapitulative des personnes, entreprises et organisations sanctionnées.[^seco-sanctions]",
            "**Pas une liste exhaustive.** La FINMA prévient qu’il n’y a « aucune garantie que la liste d’alerte soit exhaustive et totalement à jour » : un prestataire sans autorisation peut ne pas, ou pas encore, y figurer.[^finma-liste-alerte] Une absence de la liste d’alerte ne prouve donc pas une autorisation.",
            "**Pas une vue complète.** La FINMA ne peut agir que si elle est compétente territorialement et matériellement et dispose d’indices concrets ; elle recommande de consulter aussi d’autres listes de mise en garde, comme celle de la police cantonale zurichoise (cybercrimepolice.ch) ou celle de l’IOSCO (I-SCAN).[^finma-liste-alerte]",
          ] },
          { type: "callout", tone: "warn", title: "Une entrée ne vise que l’entité décrite", text: "Une inscription concerne le prestataire décrit par la FINMA, avec son nom, son siège, son adresse et son site internet. Elle ne dit rien d’une autre entreprise au nom proche." },
        ],
      },
      {
        id: "entree", title: "Ce que contient une entrée",
        blocks: [
          { type: "p", text: "Chaque entrée de la liste renvoie à une page de détail sur finma.ch. Le schéma ci-dessous reprend ses rubriques, sans aucune donnée réelle.[^finma-liste-alerte]" },
          { type: "entry", label: "Les rubriques d’une entrée de la liste d’alerte", window: "FINMA · Liste d’alerte · Page de détail", fields: [
            { name: "Date", note: "Affichée en tête de l’entrée." },
            { name: "Nom / raison sociale", note: "Tel que publié : raison sociale, marque ou nom de site internet." },
            { name: "Siège", note: "Peut être vide (« - »)." },
            { name: "Adresse", note: "Telle que publiée." },
            { name: "Site internet", note: "Peut être vide." },
            { name: "Registre du commerce", note: "« Avec » ou « Sans inscription au registre du commerce »." },
            { name: "Remarques", note: "Précisions éventuelles de la FINMA, ou « - »." },
          ], saysTitle: "Ce que l’entrée dit", says: [
            "La FINMA a enquêté sans pouvoir éclaircir ses soupçons, ou craint un danger imminent et important pour les investisseurs.",
            "Selon la FINMA, le prestataire décrit ne dispose pas de l’autorisation requise.",
          ], notTitle: "Ce qu’elle ne dit pas", not: [
            "Que l’activité est illicite, ou qu’une personne précise a commis une infraction.",
            "Qu’une entreprise au nom proche est concernée.",
            "Qu’un prestataire absent de la liste est autorisé.",
          ] },
        ],
      },
      {
        id: "homonymes", title: "Homonymies et sociétés sans lien",
        blocks: [
          { type: "p", text: "Un nom proche ne prouve pas une identité. Une entreprise sérieuse peut porter un nom voisin d’une entrée, et un prestataire peut utiliser un nom qui rappelle celui d’un établissement connu sans avoir de lien avec lui. Pour les intermédiaires d’assurance, la FINMA recommande d’ailleurs de vérifier si les indications fournies correspondent à celles de son registre public.[^finma-intermediaires]" },
          { type: "p", text: "Avant de rattacher une contrepartie à une entrée :" },
          { type: "list", ordered: true, items: [
            "Ouvrez la page de détail de l’entrée sur finma.ch.",
            "Comparez siège, adresse et site internet avec les coordonnées connues de votre contrepartie.",
            "Vérifiez l’IDE de votre contrepartie dans le registre IDE et sa raison sociale dans Zefix.[^ofs-uid][^ofj-zefix] Une entrée « sans inscription au registre du commerce » ne se rattache pas à une société inscrite sur la seule foi d’un nom.",
            "Consignez la conclusion : correspondance confirmée, écartée, ou incertaine et transmise pour examen.",
          ] },
          { type: "callout", title: "Dans le fichier OpenSwissData", text: "La liste d’alerte reste dans des fichiers séparés du registre, et aucun établissement autorisé n’est signalé automatiquement sur la base d’une ressemblance de noms : le champ `is_warning_listed` du registre reste vide." },
        ],
      },
      {
        id: "controle", title: "Utiliser la liste dans un contrôle",
        blocks: [
          { type: "p", text: "Lors d’une entrée en relation ou d’une revue périodique, la liste d’alerte sert à repérer des cas à examiner. Une méthode prudente :" },
          { type: "list", items: [
            "chercher le nom complet, puis ses parties distinctives sans la forme juridique, ainsi que le nom de domaine du site internet ;",
            "qualifier chaque résultat de « candidat à examiner », jamais de « positif » automatique ;",
            "consulter aussi la liste des établissements autorisés et celle des décisions finales publiées ;",
            "refaire la recherche à intervalles réguliers : la FINMA ajoute des entrées et en supprime après ses vérifications.[^finma-liste-alerte]",
          ] },
          { type: "p", text: "Pour une question ponctuelle, l’outil gratuit `kyc_check` du [serveur MCP](@/mcp/#install) cherche un nom dans le registre et dans la liste d’alerte. Pour des listes entières, voir le [guide sur l’automatisation](@/guides/finma-screening-automation/)." },
        ],
      },
      {
        id: "fichier", title: "La liste d’alerte dans le fichier OpenSwissData",
        blocks: [
          { type: "p", text: "Le [fichier FINMA](@/datasets/finma/) livre la liste d’alerte séparément du registre, dans `finma_warnings.csv`, `.json`, `.sql` et `.parquet`, ainsi que dans la feuille « Avertissements » du classeur Excel. Chaque ligne comporte :" },
          { type: "table", caption: "Champs de finma_warnings", head: ["Champ", "Contenu"], rows: [
            ["`name`", "Le nom tel que publié par la FINMA."],
            ["`date_added`", "La date affichée par la FINMA pour l’entrée, au format AAAA-MM-JJ."],
            ["`category`", "Le libellé anglais du filtre de la FINMA, par exemple « Entered in commercial register »."],
            ["`source_url`", "Le lien vers la page de détail de l’entrée sur finma.ch."],
            ["`warning_type`", "Une valeur constante pour cette liste."],
            ["`country`", "Vide dans la version actuelle."],
            ["`additional_info`", "Le dernier segment de l’adresse de la page de détail."],
          ] },
          { type: "p", text: "Le fichier ne reprend ni le siège, ni l’adresse, ni le site internet : pour comparer, ouvrez la page de détail. L’[échantillon CSV gratuit](/api/catalog/finma?format=csv) contient des lignes du registre, pas la liste d’alerte." },
        ],
      },
    ],
  },
  de: {
    title: "Die Warnliste der FINMA: was sie aussagt und was nicht",
    description: "Wer auf der Warnliste der FINMA steht, was ein Eintrag bedeutet und was nicht, und wie Sie die Liste in einer Prüfung nutzen, ohne aus einem Namen zu folgern.",
    short: "Die Warnliste",
    summary: "Wer darauf steht, was ein Eintrag nicht beweist und wie Sie mit einem ähnlichen Namen umgehen, ohne vorschnell zu urteilen.",
    h1: "Die Warnliste der FINMA.",
    accent: "Was sie sagt. Und was nicht.",
    lede: "Die FINMA veröffentlicht eine Liste mit Gesellschaften und Personen, die möglicherweise ohne Bewilligung eine bewilligungspflichtige Tätigkeit ausüben. In einer Prüfung ist sie nützlich, wenn man sie so liest, wie die FINMA sie beschreibt: als Hinweis, dem nachzugehen ist, nicht als Urteil über eine Person.",
    sections: [
      {
        id: "listes", title: "Drei Listen, drei Aussagen",
        blocks: [
          { type: "p", text: "Auf ihrer Seite «Warnungen» führt die FINMA drei Listen, die Anleger, Gläubiger und Versicherte auf mögliche Gefahren auf dem Finanzmarkt aufmerksam machen: die Warnliste, die Liste der Endverfügungen nach Art. 34 FINMAG und die Liste der eingesetzten Untersuchungsbeauftragten.[^finma-alertes]" },
          { type: "p", text: "Diese Listen sagen nicht dasselbe. Bei schwerer Verletzung aufsichtsrechtlicher Bestimmungen kann die FINMA ihre Verfügung nach Eintritt der Rechtskraft ganz oder teilweise veröffentlichen.[^finma-alertes] Die Warnliste beruht dagegen auf einem Verdacht, den die FINMA nicht abklären konnte." },
        ],
      },
      {
        id: "inscription", title: "Wer auf der Warnliste steht",
        blocks: [
          { type: "quote", source: "finma-liste-alerte", text: "Bei den Unternehmen und Personen, die auf dieser Liste stehen, hat die FINMA Untersuchungen wegen unerlaubter Tätigkeit eingeleitet, konnte den Verdacht jedoch nicht weiter abklären, da die Unternehmen ihrer Auskunftspflicht gegenüber der FINMA nicht nachgekommen sind oder falsche Angaben gemacht haben." },
          { type: "p", text: "Laut FINMA kann eine Aufnahme auch erfolgen, wenn ihre Untersuchungen eine immanente, erhebliche Gefährdung von Anlegern vermuten lassen. Betroffene Unternehmen werden von der Liste gestrichen, sobald die FINMA die notwendigen Abklärungen vornehmen konnte.[^finma-liste-alerte]" },
          { type: "p", text: "Die Liste lässt sich auf der Website der FINMA nach Namen durchsuchen und mit den Filtern «Mit HR-Eintrag» und «Ohne HR-Eintrag» eingrenzen.[^finma-liste-alerte]" },
        ],
      },
      {
        id: "limites", title: "Was ein Eintrag nicht aussagt",
        blocks: [
          { type: "list", items: [
            "**Kein Beweis für eine illegale Tätigkeit.** Ein Eintrag bedeutet laut FINMA «nicht zwangsläufig, dass die vom aufgeführten Unternehmen ausgeübte Aktivität illegal ist»; er weist darauf hin, dass keine Bewilligung vorliegt.[^finma-liste-alerte]",
            "**Keine Sanktionsverfügung.** Die nach Art. 34 FINMAG veröffentlichten Endverfügungen bilden eine eigene Liste.[^finma-alertes]",
            "**Keine Liste internationaler Sanktionen.** Die Schweiz setzt internationale Sanktionen gestützt auf das Embargogesetz oder im Rahmen der Geldwäschereigesetzgebung um[^finma-sanctions]; das SECO veröffentlicht die Gesamtliste der sanktionierten Personen, Unternehmen und Organisationen.[^seco-sanctions]",
            "**Keine abschliessende Liste.** Für die Warnliste besteht laut FINMA «nicht der Anspruch, abschliessend und tagesaktuell zu sein»: Ein Anbieter ohne Bewilligung kann (noch) fehlen.[^finma-liste-alerte] Ein fehlender Eintrag auf der Warnliste belegt deshalb keine Bewilligung.",
            "**Kein vollständiges Bild.** Die FINMA kann nur tätig werden, wenn sie örtlich und sachlich zuständig ist und konkrete Anhaltspunkte vorliegen; sie empfiehlt, auch weitere Warnlisten zu konsultieren, etwa jene der Kantonspolizei Zürich (cybercrimepolice.ch) oder der IOSCO (I-SCAN).[^finma-liste-alerte]",
          ] },
          { type: "callout", tone: "warn", title: "Ein Eintrag betrifft nur die beschriebene Einheit", text: "Ein Eintrag betrifft den von der FINMA beschriebenen Anbieter, mit Namen, Sitz, Adresse und Website. Über ein anderes Unternehmen mit ähnlichem Namen sagt er nichts aus." },
        ],
      },
      {
        id: "entree", title: "Was ein Eintrag enthält",
        blocks: [
          { type: "p", text: "Jeder Eintrag der Liste führt zu einer Detailseite auf finma.ch. Die Darstellung unten zeigt deren Rubriken, ohne echte Daten.[^finma-liste-alerte]" },
          { type: "entry", label: "Die Rubriken eines Eintrags der Warnliste", window: "FINMA · Warnliste · Detailseite", fields: [
            { name: "Datum", note: "Oben im Eintrag angezeigt." },
            { name: "Name", note: "Wie veröffentlicht: Firma, Marke oder Name einer Website." },
            { name: "Sitz", note: "Kann leer sein («-»)." },
            { name: "Adresse", note: "Wie veröffentlicht." },
            { name: "Internet", note: "Kann leer sein." },
            { name: "Handelsregister (HR)", note: "«Mit HR-Eintrag» oder «Ohne HR-Eintrag»." },
            { name: "Bemerkungen", note: "Allfällige Präzisierungen der FINMA, oder «-»." },
          ], saysTitle: "Was der Eintrag sagt", says: [
            "Die FINMA hat ermittelt, ohne ihren Verdacht abklären zu können, oder vermutet eine erhebliche Gefährdung von Anlegern.",
            "Laut FINMA verfügt der beschriebene Anbieter über keine Bewilligung.",
          ], notTitle: "Was er nicht sagt", not: [
            "Dass die Tätigkeit illegal ist oder eine bestimmte Person einen Verstoss begangen hat.",
            "Dass ein Unternehmen mit ähnlichem Namen betroffen ist.",
            "Dass ein Anbieter ohne Eintrag bewilligt ist.",
          ] },
        ],
      },
      {
        id: "homonymes", title: "Ähnliche Namen und Unternehmen ohne Verbindung",
        blocks: [
          { type: "p", text: "Ein ähnlicher Name beweist keine Identität. Ein seriöses Unternehmen kann ähnlich heissen wie ein Eintrag, und ein Anbieter kann einen Namen verwenden, der an ein bekanntes Institut erinnert, ohne mit ihm verbunden zu sein. Bei Versicherungsvermittlern rät die FINMA ausdrücklich zu prüfen, ob die Angaben mit jenen im öffentlichen FINMA-Register übereinstimmen.[^finma-intermediaires]" },
          { type: "p", text: "Bevor Sie eine Gegenpartei einem Eintrag zuordnen:" },
          { type: "list", ordered: true, items: [
            "Öffnen Sie die Detailseite des Eintrags auf finma.ch.",
            "Vergleichen Sie Sitz, Adresse und Website mit den bekannten Angaben Ihrer Gegenpartei.",
            "Prüfen Sie die UID Ihrer Gegenpartei im UID-Register und ihre Firma in Zefix.[^ofs-uid][^ofj-zefix] Ein Eintrag «Ohne HR-Eintrag» lässt sich nicht allein aufgrund eines Namens einem im Handelsregister eingetragenen Unternehmen zuordnen.",
            "Halten Sie Ihre Schlussfolgerung fest: Übereinstimmung bestätigt, ausgeschlossen, oder unklar und zur Prüfung weitergeleitet.",
          ] },
          { type: "callout", title: "In der Datei von OpenSwissData", text: "Die Warnliste bleibt in eigenen Dateien, getrennt vom Register, und kein bewilligtes Institut wird aufgrund einer Namensähnlichkeit automatisch markiert: Das Feld `is_warning_listed` des Registers bleibt leer." },
        ],
      },
      {
        id: "controle", title: "Die Liste in einer Prüfung verwenden",
        blocks: [
          { type: "p", text: "Bei der Aufnahme einer Geschäftsbeziehung oder einer periodischen Überprüfung hilft die Warnliste, Fälle für eine genauere Prüfung zu erkennen. Ein vorsichtiges Vorgehen:" },
          { type: "list", items: [
            "nach dem vollständigen Namen suchen, dann nach unterscheidungskräftigen Namensteilen ohne Rechtsform und nach dem Domainnamen der Website;",
            "jeden Treffer als «zu prüfenden Kandidaten» einstufen, nie als automatischen Treffer;",
            "auch die Liste der bewilligten Institute und die veröffentlichten Endverfügungen konsultieren;",
            "die Suche regelmässig wiederholen: Die FINMA nimmt Einträge auf und streicht sie nach ihren Abklärungen.[^finma-liste-alerte]",
          ] },
          { type: "p", text: "Für eine einzelne Frage durchsucht das kostenlose Werkzeug `kyc_check` des [MCP-Servers](@/mcp/#install) das Register und die Warnliste nach einem Namen. Für ganze Listen siehe den [Leitfaden zur Automatisierung](@/guides/finma-screening-automation/)." },
        ],
      },
      {
        id: "fichier", title: "Die Warnliste in der Datei von OpenSwissData",
        blocks: [
          { type: "p", text: "Die [FINMA-Datei](@/datasets/finma/) liefert die Warnliste getrennt vom Register, als `finma_warnings.csv`, `.json`, `.sql` und `.parquet` sowie im Tabellenblatt «Avertissements» der Excel-Arbeitsmappe. Jede Zeile enthält:" },
          { type: "table", caption: "Felder von finma_warnings", head: ["Feld", "Inhalt"], rows: [
            ["`name`", "Der Name, wie ihn die FINMA veröffentlicht."],
            ["`date_added`", "Das von der FINMA für den Eintrag angezeigte Datum, im Format JJJJ-MM-TT."],
            ["`category`", "Die englische Bezeichnung des FINMA-Filters, zum Beispiel «Entered in commercial register»."],
            ["`source_url`", "Der Link zur Detailseite des Eintrags auf finma.ch."],
            ["`warning_type`", "Ein fester Wert für diese Liste."],
            ["`country`", "In der aktuellen Version leer."],
            ["`additional_info`", "Das letzte Segment der Adresse der Detailseite."],
          ] },
          { type: "p", text: "Sitz, Adresse und Website sind nicht enthalten: Öffnen Sie für einen Vergleich die Detailseite. Das [kostenlose CSV-Muster](/api/catalog/finma?format=csv) enthält Registerzeilen, nicht die Warnliste." },
        ],
      },
    ],
  },
  en: {
    title: "The FINMA warning list: what it says and what it does not",
    description: "Who is on FINMA’s warning list, what an entry does and does not mean, and how to use the list in screening without jumping to conclusions from a name.",
    short: "The warning list",
    summary: "Who is on it, what an entry does not prove, and how to handle a similar name without jumping to conclusions.",
    h1: "The FINMA warning list.",
    accent: "What it says. What it does not.",
    lede: "FINMA publishes a list of companies and individuals that may be carrying out activities requiring authorisation without being authorised. It is useful in a screening process, provided it is read the way FINMA presents it: as a signal to investigate, not a verdict on a person.",
    sections: [
      {
        id: "listes", title: "Three lists, three messages",
        blocks: [
          { type: "p", text: "On its “Warnings” page, FINMA maintains three lists that draw the attention of investors, creditors and policyholders to possible dangers in the financial market: the warning list, a list of final rulings released in line with Article 34 FINMASA, and a list of investigating agents acting for FINMA.[^finma-alertes]" },
          { type: "p", text: "These lists do not say the same thing. Where a company is in serious breach of regulatory provisions, FINMA can publish part or all of its final rulings once they come into force.[^finma-alertes] The warning list, by contrast, rests on suspicions that FINMA could not clear up." },
        ],
      },
      {
        id: "inscription", title: "Who is on the warning list",
        blocks: [
          { type: "quote", source: "finma-liste-alerte", text: "FINMA has investigated the companies and individuals on its warning list to see if they are providing unauthorised services. The findings, however, were inconclusive because the companies and individuals concerned did not comply with the requirement to provide information, or the information they provided was false." },
          { type: "p", text: "FINMA adds that providers are also entered in the list when its investigations reveal an imminent and considerable threat to investors, and that they are removed once FINMA has completed its investigations and taken any appropriate measures.[^finma-liste-alerte]" },
          { type: "p", text: "The list can be searched by name on FINMA’s website and filtered by “Entered in commercial register” or “Not entered in commercial register”.[^finma-liste-alerte]" },
        ],
      },
      {
        id: "limites", title: "What an entry does not say",
        blocks: [
          { type: "list", items: [
            "**Not proof of unlawful activity.** In FINMA’s words, being on the warning list “does not automatically mean that its activities are unlawful”; the entry highlights the lack of authorisation.[^finma-liste-alerte]",
            "**Not an enforcement ruling.** Final rulings published under Article 34 FINMASA form a separate list.[^finma-alertes]",
            "**Not an international sanctions list.** Switzerland implements international sanctions through its Embargo Act or via anti-money laundering legislation[^finma-sanctions]; SECO publishes the overall list of sanctioned individuals, companies and organisations.[^seco-sanctions]",
            "**Not exhaustive.** FINMA states that the warning list “does not claim to be exhaustive and is not updated on a daily basis”: a provider without authorisation may not (yet) be on it.[^finma-liste-alerte] Being absent from the warning list is therefore no evidence of authorisation.",
            "**Not the whole picture.** FINMA can only act if it has territorial and material jurisdiction and concrete indications of a violation; it advises consulting other warning lists as well, such as those of the Cantonal Police of Zurich (cybercrimepolice.ch) or IOSCO (I-SCAN).[^finma-liste-alerte]",
          ] },
          { type: "callout", tone: "warn", title: "An entry concerns only the entity described", text: "An entry concerns the provider that FINMA describes, with its name, domicile, address and website. It says nothing about another company with a similar name." },
        ],
      },
      {
        id: "entree", title: "What an entry contains",
        blocks: [
          { type: "p", text: "Each entry on the list links to a detail page on finma.ch. The diagram below shows its headings, without any real data.[^finma-liste-alerte]" },
          { type: "entry", label: "The headings of a warning list entry", window: "FINMA · Warning list · Detail page", fields: [
            { name: "Date", note: "Shown at the top of the entry." },
            { name: "Name", note: "As published: company name, brand or website name." },
            { name: "Domicile", note: "May be empty (“-”)." },
            { name: "Address", note: "As published." },
            { name: "Internet", note: "May be empty." },
            { name: "Commercial register", note: "“Entered” or “Not entered in commercial register”." },
            { name: "Remarks", note: "Any clarification by FINMA, or “-”." },
          ], saysTitle: "What the entry says", says: [
            "FINMA investigated without being able to clear up its suspicions, or suspects an imminent and considerable threat to investors.",
            "According to FINMA, the provider described lacks the required authorisation.",
          ], notTitle: "What it does not say", not: [
            "That the activity is unlawful, or that a specific person committed a breach.",
            "That a company with a similar name is concerned.",
            "That a provider absent from the list is authorised.",
          ] },
        ],
      },
      {
        id: "homonymes", title: "Namesakes and unrelated companies",
        blocks: [
          { type: "p", text: "A similar name does not prove identity. A legitimate company may have a name close to an entry, and a provider may use a name that recalls a well-known institution without any link to it. For insurance intermediaries, FINMA explicitly advises checking whether the details match those in its public register.[^finma-intermediaires]" },
          { type: "p", text: "Before linking a counterparty to an entry:" },
          { type: "list", ordered: true, items: [
            "Open the entry’s detail page on finma.ch.",
            "Compare domicile, address and website with the known details of your counterparty.",
            "Check your counterparty’s UID in the UID Register and its legal name in Zefix.[^ofs-uid][^ofj-zefix] An entry “Not entered in commercial register” cannot be linked to a registered company on the strength of a name alone.",
            "Record your conclusion: match confirmed, ruled out, or uncertain and escalated for review.",
          ] },
          { type: "callout", title: "In the OpenSwissData file", text: "The warning list stays in files separate from the registry, and no authorised institution is flagged automatically because of a similar name: the registry field `is_warning_listed` stays empty." },
        ],
      },
      {
        id: "controle", title: "Using the list in a screening process",
        blocks: [
          { type: "p", text: "When onboarding a client or partner, or during a periodic review, the warning list helps spot cases to examine. A careful approach:" },
          { type: "list", items: [
            "search for the full name, then for distinctive parts of it without the legal form, and for the website’s domain name;",
            "treat every result as a “candidate for review”, never as an automatic hit;",
            "check the list of authorised institutions and the published final rulings as well;",
            "repeat the search at regular intervals: FINMA adds entries and removes them after its investigations.[^finma-liste-alerte]",
          ] },
          { type: "p", text: "For a one-off question, the free `kyc_check` tool of the [MCP server](@/mcp/#install) searches a name in the registry and in the warning list. For whole lists, see the [guide to automation](@/guides/finma-screening-automation/)." },
        ],
      },
      {
        id: "fichier", title: "The warning list in the OpenSwissData file",
        blocks: [
          { type: "p", text: "The [FINMA file](@/datasets/finma/) delivers the warning list separately from the registry, as `finma_warnings.csv`, `.json`, `.sql` and `.parquet`, and in the “Avertissements” sheet of the Excel workbook. Each row contains:" },
          { type: "table", caption: "Fields of finma_warnings", head: ["Field", "Content"], rows: [
            ["`name`", "The name as published by FINMA."],
            ["`date_added`", "The date FINMA shows for the entry, as YYYY-MM-DD."],
            ["`category`", "The English label of FINMA’s filter, for example “Entered in commercial register”."],
            ["`source_url`", "The link to the entry’s detail page on finma.ch."],
            ["`warning_type`", "A constant value for this list."],
            ["`country`", "Empty in the current version."],
            ["`additional_info`", "The last segment of the detail page’s address."],
          ] },
          { type: "p", text: "Domicile, address and website are not included: open the detail page to compare. The [free CSV sample](/api/catalog/finma?format=csv) contains registry rows, not the warning list." },
        ],
      },
    ],
  },
};
