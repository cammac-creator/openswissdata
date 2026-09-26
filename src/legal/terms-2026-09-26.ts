// Version contractuelle figée. Après publication, créer une nouvelle version sans modifier celle-ci.
export type LegalLocale = "fr" | "de" | "en";
export type LegalSection = { id: string; title: string; paragraphs: string[] };
export type LegalDocument = { title: string; summary: string; highlights: string[]; sections: LegalSection[] };
export const TERMS_VERSION = "2026-09-26";

export const terms: Record<LegalLocale, LegalDocument> = {
  fr: {
    title: "Conditions générales de vente et de licence",
    summary: "Achats professionnels de fichiers numériques OpenSwissData. Version du 26 septembre 2026, applicable aux nouvelles commandes qui la présentent avant paiement.",
    highlights: ["Achat unique, sans renouvellement automatique", "360 jours de mises à jour incluses", "Remboursement commercial sous 14 jours", "Données de référence, sans certification réglementaire"],
    sections: [
      { id: "vendeur", title: "1. Vendeur et clientèle professionnelle", paragraphs: [
        "OpenSwissData est un service de Claude-Alain Martin, exploitant en nom propre, Rue de l’Église 23, 1045 Ogens, Suisse. Contact : contact@openswissdata.com. Le service est indépendant des administrations et des organismes dont il utilise les sources.",
        "Les offres s’adressent aux entreprises, indépendants et organismes agissant pour leur activité professionnelle. La personne qui commande confirme agir à cette fin et disposer du pouvoir d’engager l’acquéreur. Une simple déclaration ne prive toutefois personne des droits impératifs dont elle bénéficierait légalement comme consommateur."
      ]},
      { id: "commande", title: "2. Commande et formation du contrat", paragraphs: [
        "La fiche produit décrit le périmètre, les formats, les limites de qualité et le prix. Le bouton d’achat conduit au récapitulatif Stripe : vérifiez le produit, le montant, votre identité et votre email, puis corrigez-les avant de payer, ou revenez au site. L’acceptation des présentes conditions est demandée avant la confirmation du paiement.",
        "Le contrat est conclu lorsque le paiement est confirmé et que la commande est enregistrée. Un moyen de paiement différé peut retarder cette confirmation. Un email confirme la mise à disposition ; le compte permet également de consulter l’achat. En cas d’email absent ou d’erreur, contactez le support avec la référence de paiement, sans transmettre de données de carte.",
        "Les engagements particuliers expressément convenus et la description du produit au moment de l’achat prévalent pour leurs objets respectifs. La version des CGV présentée au paiement est conservée ; les conditions nouvelles ne modifient pas rétroactivement les commandes antérieures."
      ]},
      { id: "prix", title: "3. Prix et paiement", paragraphs: [
        "Le montant total à payer est indiqué en francs suisses (CHF) avant validation. Aucun frais de livraison numérique n’est ajouté. L’exploitant n’est actuellement pas assujetti à la TVA suisse et ne facture pas de TVA suisse. Les frais de conversion ou de banque éventuellement facturés par votre établissement restent distincts du prix OpenSwissData.",
        "Stripe traite le paiement ; OpenSwissData ne conserve pas le numéro complet de votre carte. L’achat d’un fichier ou du bundle est un paiement unique, sans prélèvement récurrent ni renouvellement automatique. Les nouvelles souscriptions MCP payantes sont fermées ; l’achat de fichiers ne crée pas de clé MCP payante."
      ]},
      { id: "livraison", title: "4. Livraison et accès", paragraphs: [
        "Après confirmation du paiement, la livraison numérique est préparée automatiquement et un email vous donne accès à l’archive ZIP. Le traitement prend normalement quelques minutes ; ce délai indicatif n’est pas une garantie de réception dans votre boîte. En cas de difficulté, vérifiez les courriers indésirables et l’espace client, puis contactez le support.",
        "Le lien reçu par email est utilisable pendant 48 heures et demande une confirmation avant téléchargement. L’expiration du lien ne supprime pas les droits de votre achat. Le compte, accessible par lien de connexion envoyé par email, permet de retrouver les versions comprises dans vos droits. Conservez une copie des fichiers acquis : une licence perpétuelle n’est pas une promesse d’hébergement perpétuel.",
        "Un navigateur récent, une adresse email accessible et un outil ouvrant les archives ZIP sont nécessaires. Les formats et fichiers effectivement inclus sont ceux de la fiche produit et du README de la version distribuée. La signature du fichier provenance.json sert à contrôler l’intégrité et l’origine de la livraison OpenSwissData ; elle ne certifie ni l’exactitude métier des données ni leur acceptation par une autorité."
      ]},
      { id: "licence", title: "5. Licence et droits des sources", paragraphs: [
        "Sous réserve du paiement et des droits propres aux sources, l’achat donne une licence non exclusive et non transférable sur la compilation et les éléments originaux OpenSwissData, pour l’usage professionnel interne de l’organisation acquéreuse. Elle est perpétuelle pour les versions valablement acquises, sauf résolution du contrat, remboursement intégral ou manquement grave justifiant sa résiliation.",
        "Vous pouvez importer, indexer, analyser et intégrer les fichiers dans vos outils internes. Les collaborateurs et prestataires agissant exclusivement pour votre organisation peuvent y accéder dans la mesure nécessaire, sous confidentialité et sans droit autonome de redistribution. Conservez les références de source et distinguez clairement vos enrichissements des valeurs officielles.",
        "La revente, la publication des archives ou la mise à disposition d’un service donnant à des tiers accès à la compilation OpenSwissData ne sont pas comprises dans cette licence. Contactez-nous avant un tel usage. Ces restrictions ne créent aucun droit exclusif sur des données publiques et ne réduisent pas les droits que vous tenez directement d’une source ou d’une licence ouverte applicable."
      ]},
      { id: "sources", title: "6. Conditions propres aux jeux de données", paragraphs: [
        "TARES : publication non officielle. Seules les publications de la Chancellerie fédérale et de l’Office fédéral de la douane et de la sécurité des frontières (OFDF/BAZG) font foi. « Dies ist keine offizielle Veröffentlichung. » L’autorisation documentée du 21 avril 2026 impose notamment l’intégrité du contenu, l’attribution et l’absence de présentation comme produit officiel. Les notes explicatives et décisions de classement ne sont pas comprises. Les transformations de format ne doivent pas altérer les valeurs officielles ni faire passer une interprétation pour une donnée de l’OFDF.",
        "FINMA : la réponse documentée du 6 mai 2026 permet l’utilisation des données publiques sous réserve des droits d’auteur et de l’intégrité des documents sources. Il ne s’agit ni d’une homologation du produit ni d’une attestation de conformité KYC/AML. L’absence d’une entité dans une recherche ne prouve pas son absence de risque. Les enrichissements LEI/GLEIF sont séparés et peuvent être incomplets.",
        "Classifications : la source, la nomenclature, la révision et la nature exacte ou approchée des relations sont documentées. Une correspondance approchée ne doit pas être traitée comme une équivalence officielle. Les conditions des sources OFS, Eurostat et ONU demeurent applicables ; l’achat ne donne pas une autorisation générale de redistribution de ces sources. Les éventuelles restrictions sont à vérifier pour votre propre usage."
      ]},
      { id: "mises-a-jour", title: "7. Mises à jour et changements", paragraphs: [
        "L’achat comprend l’accès aux versions publiées pendant 360 jours à partir de sa confirmation. Le bundle porte sur les trois jeux de fichiers indiqués. Les versions acquises restent utilisables selon leur licence après cette période ; les nouvelles versions ultérieures ne sont pas incluses.",
        "Les collectes FINMA sont planifiées quotidiennement et TARES chaque semaine ; les classifications sont publiées après contrôle. Une source indisponible ou un contrôle en échec peut retarder la publication. La date de version, la couverture et les lacunes signalées permettent d’apprécier la fraîcheur réelle. Les index de recherche peuvent avoir une date distincte.",
        "Des formats ou champs peuvent évoluer pour suivre les sources. Les changements de schéma sont documentés dans les livrables ; aucune compatibilité illimitée de vos logiciels n’est promise. Une éventuelle prolongation fera l’objet d’une offre séparée, librement acceptée. Un tarif de prolongation expressément annoncé lors de l’achat reste applicable selon les conditions de cette offre."
      ]},
      { id: "remboursement", title: "8. Garantie commerciale de remboursement", paragraphs: [
        "Vous pouvez demander le remboursement intégral dans les 14 jours suivant l’achat, sans avoir à justifier votre décision, y compris après téléchargement, sauf redistribution des fichiers à un tiers en violation de la licence. Écrivez à contact@openswissdata.com avec l’email d’achat et la référence de commande. Le remboursement est effectué sur le moyen de paiement initial ; le délai d’affichage dépend de votre banque.",
        "Après remboursement intégral, les droits issus de cet achat prennent fin : cessez d’utiliser la compilation remboursée et supprimez ses copies, sauf conservation strictement imposée par la loi. Un autre achat valable du même produit conserve ses propres droits. Cette garantie commerciale ne remplace ni ne limite les recours légaux impératifs ou les droits liés à une inexécution."
      ]},
      { id: "defauts", title: "9. Défaut de livraison et réclamation", paragraphs: [
        "Signalez un fichier absent, illisible, une signature invalide ou un écart substantiel à la description à contact@openswissdata.com. Précisez le produit, sa version et l’erreur, sans transmettre de données confidentielles inutiles. Nous examinons le problème et proposons une nouvelle livraison ou une correction ; si la prestation convenue ne peut être fournie, un remboursement adapté à la partie affectée est proposé. Les droits impératifs restent réservés.",
        "Les services ne sont pas un conseil juridique, fiscal, douanier, financier ou réglementaire. Avant une déclaration, un contrôle de conformité ou une décision importante, vérifiez les informations auprès de la source officielle et, si nécessaire, d’un professionnel compétent. Les similitudes, classements et résultats produits par un modèle sont des aides à vérifier humainement."
      ]},
      { id: "responsabilite", title: "10. Responsabilité", paragraphs: [
        "OpenSwissData apporte un travail de préparation et de contrôle, mais ne garantit pas que les sources publiques soient exemptes d’erreurs, complètes ou à jour à chaque instant. Les limites déclarées du produit font partie de l’information préalable ; elles n’excusent pas une prestation contraire aux engagements exprès de la commande.",
        "Dans la mesure permise par le droit applicable, la responsabilité pour faute légère est limitée aux dommages directs prouvés et au montant payé pour la commande à l’origine du dommage. Les pertes de bénéfice, pertes d’opportunité et autres dommages indirects sont exclus dans cette même mesure.",
        "Ces exclusions et plafonds ne s’appliquent pas au dol, à la faute grave, aux atteintes à la vie ou à l’intégrité corporelle, ni aux responsabilités ou droits auxquels la loi interdit de déroger. Ils ne suppriment pas le droit à la prestation convenue ou à son remboursement en cas d’inexécution."
      ]},
      { id: "indisponibilite", title: "11. Incidents, suspension et retrait", paragraphs: [
        "La disponibilité continue du site, des prestataires et des sources n’est pas garantie. Une panne d’un prestataire n’est pas automatiquement un cas de force majeure. Nous prenons les mesures raisonnables pour rétablir le service et limiter les conséquences, sans écarter les droits impératifs de l’acquéreur.",
        "Un accès peut être suspendu en cas d’incident de sécurité, d’impayé, de contestation de paiement ou d’usage illicite documenté. La mesure doit être proportionnée et peut être réexaminée par le support. Sauf urgence ou interdiction légale, le motif est communiqué et un manquement remédiable peut être corrigé avant résiliation.",
        "Un contenu peut être retiré à la suite d’une obligation légale ou d’une demande fondée d’un titulaire de droits. Nous informons les acquéreurs concernés lorsque cela est possible. Une livraison devenue impossible donne lieu à remboursement de la partie non exécutée ; le retrait de futures mises à jour donne lieu à une solution ou à un remboursement proportionné. Aucun droit légal impératif n’est supprimé."
      ]},
      { id: "donnees", title: "12. Données personnelles et communications", paragraphs: [
        "La politique de confidentialité décrit les traitements liés au paiement, au compte, au support, à la sécurité et aux statistiques. Son affichage est une information, pas un consentement global à tous les traitements ni à la prospection. L’acceptation des CGV n’inscrit pas à une newsletter.",
        "Les messages nécessaires à l’achat et au support restent distincts des publicités. Le client protège ses liens de connexion et de téléchargement et signale sans délai une utilisation non autorisée."
      ]},
      { id: "droit", title: "13. Droit applicable, langue et litiges", paragraphs: [
        "Le droit suisse s’applique, sous réserve des règles impératives applicables, notamment lorsqu’une personne bénéficie légalement du statut de consommateur. Pour les litiges professionnels, les tribunaux compétents du domicile de l’exploitant sont désignés ; les litiges relatifs à TARES relèvent de Berne conformément aux conditions spécifiques documentées. Les fors impératifs demeurent réservés.",
        "Les versions française, allemande et anglaise sont disponibles avant l’achat. La langue présentée et acceptée au paiement est enregistrée. Aucun changement de langue ne doit réduire les droits impératifs ni les engagements expressément convenus. Contactez-nous si une traduction paraît diverger.",
        "Un échange avec le support peut permettre de résoudre un litige, sans être une condition préalable pour saisir une autorité ou préserver un délai. Si une clause est invalide, le droit applicable la remplace ; les autres dispositions demeurent applicables dans la mesure permise."
      ]}
    ]
  },
  de: {
    title: "Allgemeine Verkaufs- und Lizenzbedingungen",
    summary: "Geschäftliche Käufe digitaler OpenSwissData-Dateien. Fassung vom 26. September 2026 für neue Bestellungen, bei denen sie vor der Zahlung angezeigt wird.",
    highlights: ["Einmalkauf ohne automatische Verlängerung", "360 Tage Aktualisierungen inklusive", "Freiwillige Erstattung innerhalb von 14 Tagen", "Referenzdaten ohne regulatorische Zertifizierung"],
    sections: [
      { id: "vendeur", title: "1. Anbieter und Geschäftskunden", paragraphs: [
        "OpenSwissData ist ein Dienst von Claude-Alain Martin, tätig im eigenen Namen, Rue de l’Église 23, 1045 Ogens, Schweiz. Kontakt: contact@openswissdata.com. Der Dienst ist unabhängig von den Behörden und Organisationen, deren Quellen er verwendet.",
        "Die Angebote richten sich an Unternehmen, Selbstständige und Organisationen für ihre berufliche Tätigkeit. Die bestellende Person bestätigt diesen Zweck und ihre Vertretungsbefugnis. Eine Erklärung allein entzieht jedoch niemandem zwingende Rechte, die ihm rechtlich als Verbraucher zustehen."
      ]},
      { id: "commande", title: "2. Bestellung und Vertragsschluss", paragraphs: [
        "Die Produktseite beschreibt Umfang, Formate, Qualitätsgrenzen und Preis. Die Kauf-Schaltfläche führt zur Stripe-Zusammenfassung: Prüfen und berichtigen Sie Produkt, Betrag, Identität und E-Mail vor der Zahlung oder kehren Sie zur Website zurück. Vor Bestätigung der Zahlung ist die Zustimmung zu diesen Bedingungen erforderlich.",
        "Der Vertrag kommt mit bestätigter Zahlung und Erfassung der Bestellung zustande. Bei verzögerten Zahlungsmethoden kann sich diese Bestätigung verschieben. Eine E-Mail bestätigt die Bereitstellung; der Kauf ist auch im Kundenkonto sichtbar. Bei fehlender E-Mail oder Fehlern kontaktieren Sie den Support mit der Zahlungsreferenz, ohne Kartendaten zu übermitteln.",
        "Ausdrücklich vereinbarte besondere Zusagen und die Produktbeschreibung zum Kaufzeitpunkt gehen für ihren jeweiligen Gegenstand vor. Die beim Bezahlen vorgelegte AGB-Fassung wird aufbewahrt; neue Bedingungen ändern frühere Bestellungen nicht rückwirkend."
      ]},
      { id: "prix", title: "3. Preise und Zahlung", paragraphs: [
        "Der zu zahlende Gesamtbetrag wird vor Bestätigung in Schweizer Franken (CHF) angegeben. Es fallen keine zusätzlichen digitalen Lieferkosten an. Der Anbieter ist derzeit nicht schweizerisch mehrwertsteuerpflichtig und berechnet keine schweizerische Mehrwertsteuer. Etwaige Umrechnungs- oder Bankgebühren Ihrer Bank sind vom OpenSwissData-Preis unabhängig.",
        "Stripe verarbeitet die Zahlung; OpenSwissData speichert nicht Ihre vollständige Kartennummer. Der Kauf von Dateien oder des Bundles ist eine einmalige Zahlung ohne wiederkehrende Belastung oder automatische Verlängerung. Neue kostenpflichtige MCP-Abonnements sind geschlossen; ein Dateikauf erzeugt keinen kostenpflichtigen MCP-Schlüssel."
      ]},
      { id: "livraison", title: "4. Lieferung und Zugriff", paragraphs: [
        "Nach bestätigter Zahlung wird die digitale Lieferung automatisch vorbereitet; eine E-Mail ermöglicht den Zugriff auf das ZIP-Archiv. Dies dauert normalerweise einige Minuten; diese Orientierung ist keine Garantie für den Eingang in Ihrem Postfach. Prüfen Sie bei Problemen Spamordner und Kundenkonto und kontaktieren Sie den Support.",
        "Der E-Mail-Link ist 48 Stunden nutzbar und verlangt eine Bestätigung vor dem Download. Sein Ablauf löscht die Rechte aus dem Kauf nicht. Im Konto, zugänglich über einen per E-Mail versandten Anmeldelink, finden Sie die von Ihren Rechten erfassten Versionen. Bewahren Sie eine Kopie auf: Eine unbefristete Lizenz ist keine Zusage unbefristeten Hostings.",
        "Erforderlich sind ein aktueller Browser, ein erreichbares E-Mail-Postfach und ein ZIP-Werkzeug. Enthaltene Formate und Dateien ergeben sich aus der Produktseite und der README der gelieferten Version. Die Signatur von provenance.json dient der Prüfung von Integrität und Herkunft der OpenSwissData-Lieferung; sie bestätigt weder die fachliche Richtigkeit noch eine behördliche Anerkennung."
      ]},
      { id: "licence", title: "5. Lizenz und Rechte der Quellen", paragraphs: [
        "Vorbehaltlich der Zahlung und der Rechte der Quellen erhalten Sie eine nicht ausschliessliche, nicht übertragbare Lizenz an der Zusammenstellung und den originären OpenSwissData-Bestandteilen für den internen geschäftlichen Gebrauch Ihrer Organisation. Sie gilt unbefristet für rechtmässig erworbene Versionen, ausser bei Vertragsaufhebung, vollständiger Erstattung oder einer schweren, die Kündigung rechtfertigenden Vertragsverletzung.",
        "Sie dürfen die Dateien in interne Werkzeuge importieren, indexieren, analysieren und integrieren. Mitarbeitende und ausschliesslich für Ihre Organisation tätige Dienstleister dürfen im erforderlichen Umfang unter Vertraulichkeit und ohne eigenes Weiterverbreitungsrecht zugreifen. Quellenangaben sind zu erhalten; eigene Ergänzungen sind von offiziellen Werten klar zu trennen.",
        "Der Weiterverkauf, die Veröffentlichung der Archive und ein Dienst, der Dritten Zugriff auf die OpenSwissData-Zusammenstellung gibt, sind nicht umfasst. Kontaktieren Sie uns vorher. Diese Beschränkungen begründen keine ausschliesslichen Rechte an öffentlichen Daten und beschneiden keine Rechte, die Sie unmittelbar von einer Quelle oder aus einer anwendbaren offenen Lizenz erhalten."
      ]},
      { id: "sources", title: "6. Besondere Bedingungen der Datensätze", paragraphs: [
        "TARES: Dies ist keine offizielle Veröffentlichung. Massgebend sind allein die Veröffentlichungen durch die Bundeskanzlei und das Bundesamt für Zoll- und Grenzsicherheit BAZG. Die dokumentierte Erlaubnis vom 21. April 2026 verlangt insbesondere unveränderte Inhalte, Quellenangaben und keine Darstellung als amtliches Produkt. Erläuterungen und Entscheide sind nicht enthalten. Formatänderungen dürfen amtliche Werte nicht verfälschen oder Interpretationen als BAZG-Daten ausgeben.",
        "FINMA: Die dokumentierte Antwort vom 6. Mai 2026 erlaubt die Nutzung öffentlicher Daten unter Wahrung des Urheberrechts und der Integrität der Quelldokumente. Sie ist weder eine Produktzulassung noch ein Nachweis der KYC-/AML-Konformität. Ein fehlender Suchtreffer beweist keine Risikofreiheit. LEI-/GLEIF-Ergänzungen sind getrennt ausgewiesen und können unvollständig sein.",
        "Klassifikationen: Quelle, Nomenklatur, Revision sowie exakte oder ungefähre Beziehungen sind dokumentiert. Ungefähre Zuordnungen sind keine amtlichen Gleichsetzungen. Die Bedingungen von BFS, Eurostat und UNO bleiben anwendbar; der Kauf erteilt keine allgemeine Erlaubnis zur Weiterverbreitung dieser Quellen. Prüfen Sie die Beschränkungen für Ihren konkreten Gebrauch."
      ]},
      { id: "mises-a-jour", title: "7. Aktualisierungen und Änderungen", paragraphs: [
        "Der Kauf umfasst Versionen, die innerhalb von 360 Tagen ab Kaufbestätigung veröffentlicht werden. Das Bundle umfasst die drei angegebenen Dateidatensätze. Erworbene Versionen bleiben danach entsprechend ihrer Lizenz nutzbar; spätere neue Versionen sind nicht eingeschlossen.",
        "FINMA-Erhebungen sind täglich und TARES-Erhebungen wöchentlich geplant; Klassifikationen werden nach Prüfung veröffentlicht. Nicht verfügbare Quellen oder fehlgeschlagene Kontrollen können eine Veröffentlichung verzögern. Versionsdatum, Abdeckung und ausgewiesene Lücken zeigen die tatsächliche Aktualität. Suchindizes können einen anderen Datenstand haben.",
        "Formate und Felder können sich mit den Quellen ändern. Schemaänderungen werden in den Lieferdateien dokumentiert; eine unbegrenzte Kompatibilität Ihrer Software wird nicht zugesagt. Eine Verlängerung bedarf eines gesonderten, freiwillig angenommenen Angebots. Ein beim Kauf ausdrücklich genannter Verlängerungspreis bleibt gemäss den Bedingungen dieses Angebots anwendbar."
      ]},
      { id: "remboursement", title: "8. Freiwillige Erstattungsgarantie", paragraphs: [
        "Innerhalb von 14 Tagen nach dem Kauf können Sie ohne Begründung eine vollständige Erstattung verlangen, auch nach dem Download, ausser wenn Dateien lizenzwidrig an Dritte weitergegeben wurden. Schreiben Sie mit Kauf-E-Mail und Bestellreferenz an contact@openswissdata.com. Die Erstattung erfolgt auf das ursprüngliche Zahlungsmittel; die Anzeige hängt von Ihrer Bank ab.",
        "Nach vollständiger Erstattung enden die Rechte aus diesem Kauf: Nutzen Sie die erstattete Zusammenstellung nicht weiter und löschen Sie Kopien, ausser soweit gesetzlich zwingend aufzubewahren. Ein anderer gültiger Kauf desselben Produkts behält seine eigenen Rechte. Diese freiwillige Garantie ersetzt oder beschränkt weder zwingende gesetzliche Ansprüche noch Rechte wegen Nichterfüllung."
      ]},
      { id: "defauts", title: "9. Liefermängel und Beanstandungen", paragraphs: [
        "Melden Sie fehlende oder unlesbare Dateien, ungültige Signaturen oder wesentliche Abweichungen von der Beschreibung an contact@openswissdata.com. Nennen Sie Produkt, Version und Fehler ohne unnötige vertrauliche Daten. Wir prüfen den Fall und bieten eine neue Lieferung oder Korrektur an; ist die vereinbarte Leistung nicht erbringbar, bieten wir eine dem betroffenen Teil entsprechende Erstattung. Zwingende Rechte bleiben vorbehalten.",
        "Die Dienste sind keine Rechts-, Steuer-, Zoll-, Finanz- oder Regulierungsberatung. Prüfen Sie Informationen vor Meldungen, Compliance-Prüfungen oder wichtigen Entscheidungen bei der amtlichen Quelle und gegebenenfalls mit einer Fachperson. Ähnlichkeiten, Einstufungen und Modellergebnisse sind Hilfsmittel, die menschlich überprüft werden müssen."
      ]},
      { id: "responsabilite", title: "10. Haftung", paragraphs: [
        "OpenSwissData bereitet Daten auf und prüft sie, gewährleistet aber nicht, dass öffentliche Quellen jederzeit fehlerfrei, vollständig oder aktuell sind. Die offengelegten Produktgrenzen sind vorvertragliche Informationen; sie entschuldigen keine Leistung, die ausdrücklichen Bestellzusagen widerspricht.",
        "Soweit rechtlich zulässig, ist die Haftung für leichte Fahrlässigkeit auf nachgewiesene direkte Schäden und den für die schadensursächliche Bestellung gezahlten Betrag begrenzt. Entgangener Gewinn, entgangene Chancen und andere indirekte Schäden sind im selben Umfang ausgeschlossen.",
        "Ausschlüsse und Höchstbeträge gelten nicht bei Vorsatz, grober Fahrlässigkeit, Schäden an Leben oder körperlicher Unversehrtheit sowie gesetzlich unabdingbarer Haftung oder unabdingbaren Rechten. Sie beseitigen nicht den Anspruch auf die vereinbarte Leistung oder deren Erstattung bei Nichterfüllung."
      ]},
      { id: "indisponibilite", title: "11. Störungen, Sperrung und Rücknahme", paragraphs: [
        "Die ständige Verfügbarkeit der Website, Dienstleister und Quellen wird nicht garantiert. Ein Dienstleisterausfall ist nicht automatisch höhere Gewalt. Wir ergreifen angemessene Massnahmen zur Wiederherstellung und Schadensbegrenzung, ohne zwingende Käuferrechte auszuschliessen.",
        "Bei Sicherheitsvorfällen, ausstehender Zahlung, Zahlungsstreitigkeiten oder dokumentiertem rechtswidrigem Gebrauch kann der Zugang gesperrt werden. Die Massnahme muss verhältnismässig sein und kann vom Support überprüft werden. Ausser bei Dringlichkeit oder gesetzlichem Verbot wird der Grund mitgeteilt und Gelegenheit gegeben, einen behebbaren Verstoss vor Kündigung zu beseitigen.",
        "Inhalte können aufgrund einer gesetzlichen Pflicht oder einer begründeten Rechteinhaberanfrage entfernt werden. Betroffene Käufer werden soweit möglich informiert. Eine unmögliche Lieferung führt zur Erstattung des nicht erfüllten Teils; der Wegfall künftiger Aktualisierungen führt zu einer Lösung oder angemessenen anteiligen Erstattung. Zwingende Rechte bleiben unberührt."
      ]},
      { id: "donnees", title: "12. Personendaten und Kommunikation", paragraphs: [
        "Die Datenschutzerklärung erläutert Zahlung, Konto, Support, Sicherheit und Statistiken. Sie informiert und ist keine pauschale Einwilligung in jede Bearbeitung oder Werbung. Die AGB-Zustimmung meldet Sie nicht für einen Newsletter an.",
        "Notwendige Kauf- und Supportnachrichten bleiben von Werbung getrennt. Schützen Sie Anmelde- und Downloadlinks und melden Sie unbefugten Gebrauch umgehend."
      ]},
      { id: "droit", title: "13. Recht, Sprache und Streitigkeiten", paragraphs: [
        "Es gilt Schweizer Recht unter Vorbehalt anwendbarer zwingender Vorschriften, insbesondere für Personen, die rechtlich als Verbraucher geschützt sind. Für geschäftliche Streitigkeiten werden die zuständigen Gerichte am Wohnsitz des Anbieters vereinbart; TARES-Streitigkeiten unterliegen gemäss den dokumentierten besonderen Bedingungen dem Gerichtsstand Bern. Zwingende Gerichtsstände bleiben vorbehalten.",
        "Französische, deutsche und englische Fassungen stehen vor dem Kauf zur Verfügung. Die beim Bezahlen angezeigte und akzeptierte Sprache wird erfasst. Sprachwechsel dürfen weder zwingende Rechte noch ausdrückliche Zusagen schmälern. Bitte melden Sie scheinbare Übersetzungsabweichungen.",
        "Der Support kann bei der Streitbeilegung helfen; seine Kontaktierung ist keine Voraussetzung für behördliche Schritte oder die Wahrung einer Frist. Eine unwirksame Klausel wird durch das anwendbare Recht ersetzt; die übrigen Bestimmungen bleiben im rechtlich zulässigen Umfang bestehen."
      ]}
    ]
  },
  en: {
    title: "Terms of sale and licence",
    summary: "Business purchases of OpenSwissData digital files. Version dated 26 September 2026, applying to new orders that display it before payment.",
    highlights: ["One-off purchase, no automatic renewal", "360 days of updates included", "14-day commercial refund guarantee", "Reference data, no regulatory certification"],
    sections: [
      { id: "vendeur", title: "1. Seller and business customers", paragraphs: [
        "OpenSwissData is a service operated in his own name by Claude-Alain Martin, Rue de l’Église 23, 1045 Ogens, Switzerland. Contact: contact@openswissdata.com. The service is independent of the authorities and organisations whose sources it uses.",
        "Offers are intended for companies, self-employed professionals and organisations acting for business purposes. The person ordering confirms that purpose and their authority to bind the buyer. A declaration alone does not deprive anyone of mandatory rights they legally enjoy as a consumer."
      ]},
      { id: "commande", title: "2. Ordering and contract formation", paragraphs: [
        "The product page describes scope, formats, quality limitations and price. The purchase button leads to the Stripe summary: check and correct the product, amount, identity and email before paying, or return to the website. Acceptance of these terms is required before confirming payment.",
        "The contract is formed when payment is confirmed and the order is recorded. Delayed payment methods may postpone confirmation. An email confirms availability; the purchase is also visible in the account. If an email is missing or an error occurs, contact support with the payment reference, without sending card details.",
        "Expressly agreed specific commitments and the product description at purchase take precedence for their respective subject matter. The terms presented at checkout are preserved; new terms do not retrospectively change earlier orders."
      ]},
      { id: "prix", title: "3. Prices and payment", paragraphs: [
        "The total payable is shown in Swiss francs (CHF) before confirmation. No digital delivery fee is added. The operator is currently not registered for Swiss VAT and does not charge Swiss VAT. Any conversion or bank charges imposed by your bank are separate from the OpenSwissData price.",
        "Stripe processes payment; OpenSwissData does not store your full card number. A file or bundle purchase is a one-off payment without recurring charges or automatic renewal. New paid MCP subscriptions are closed; purchasing files does not create a paid MCP key."
      ]},
      { id: "livraison", title: "4. Delivery and access", paragraphs: [
        "After confirmed payment, digital delivery is prepared automatically and an email provides access to the ZIP archive. Processing normally takes a few minutes; this indication is not a guarantee of inbox receipt within that time. If there is a problem, check spam and your account, then contact support.",
        "The email link can be used for 48 hours and requires confirmation before download. Link expiry does not remove your purchase rights. The account, accessed using a sign-in link sent by email, provides the versions covered by your rights. Keep a copy of acquired files: a perpetual licence is not a promise of perpetual hosting.",
        "A recent browser, an accessible email address and a tool that opens ZIP archives are required. Included formats and files are those described on the product page and in the delivered version’s README. The provenance.json signature checks the integrity and origin of the OpenSwissData delivery; it does not certify substantive accuracy or acceptance by an authority."
      ]},
      { id: "licence", title: "5. Licence and source rights", paragraphs: [
        "Subject to payment and source rights, a purchase grants a non-exclusive, non-transferable licence to the compilation and original OpenSwissData elements for internal business use within the purchasing organisation. It is perpetual for lawfully acquired versions, except where the contract is rescinded, fully refunded or terminated for a serious breach justifying termination.",
        "You may import, index, analyse and integrate files into internal tools. Employees and contractors acting exclusively for your organisation may access them as needed, under confidentiality and without independent redistribution rights. Preserve source references and clearly distinguish your enrichments from official values.",
        "Reselling or publishing archives, or providing a service giving third parties access to the OpenSwissData compilation, is not included. Contact us before doing so. These restrictions create no exclusive rights over public data and do not reduce rights you obtain directly from a source or an applicable open licence."
      ]},
      { id: "sources", title: "6. Dataset-specific conditions", paragraphs: [
        "TARES: this is not an official publication. Only publications of the Federal Chancellery and the Federal Office for Customs and Border Security (FOCBS/BAZG) are authoritative. ‘Dies ist keine offizielle Veröffentlichung.’ The documented permission of 21 April 2026 requires, among other things, content integrity, attribution and no presentation as an official product. Explanatory notes and classification decisions are excluded. Format changes must not alter official values or present an interpretation as FOCBS data.",
        "FINMA: the documented reply of 6 May 2026 permits use of public data subject to copyright and source-document integrity. It is neither product approval nor certification of KYC/AML compliance. No search result does not mean no risk. LEI/GLEIF enrichments are separate and may be incomplete.",
        "Classifications: source, nomenclature, revision and exact or approximate relations are documented. Approximate mappings are not official equivalences. Conditions of FSO, Eurostat and UN sources remain applicable; purchasing does not grant blanket permission to redistribute those sources. Check any restrictions for your own intended use."
      ]},
      { id: "mises-a-jour", title: "7. Updates and changes", paragraphs: [
        "A purchase includes access to versions published within 360 days from confirmation. The bundle covers the three listed file datasets. Acquired versions remain usable under their licence afterwards; later new versions are not included.",
        "FINMA collection is scheduled daily and TARES weekly; classifications are published after review. Unavailable sources or failed checks may delay publication. Version dates, coverage and disclosed gaps indicate actual freshness. Search indexes may have a different date.",
        "Formats and fields may evolve with sources. Schema changes are documented in the delivered files; unlimited compatibility with your software is not promised. Any extension requires a separate, voluntarily accepted offer. An extension price expressly advertised at purchase remains applicable under the conditions of that offer."
      ]},
      { id: "remboursement", title: "8. Commercial refund guarantee", paragraphs: [
        "You may request a full refund within 14 days after purchase without giving a reason, including after downloading, unless files have been redistributed to a third party in breach of the licence. Email contact@openswissdata.com with the purchase email and order reference. Refunds use the original payment method; the time until they appear depends on your bank.",
        "After a full refund, rights from that purchase end: stop using the refunded compilation and delete copies except where retention is strictly required by law. Another valid purchase of the same product keeps its own rights. This commercial guarantee neither replaces nor limits mandatory legal remedies or rights arising from non-performance."
      ]},
      { id: "defauts", title: "9. Delivery defects and complaints", paragraphs: [
        "Report missing or unreadable files, invalid signatures or substantial deviations from the description to contact@openswissdata.com. Identify the product, version and error without unnecessary confidential information. We examine the issue and offer redelivery or correction; if the agreed service cannot be provided, we offer a refund appropriate to the affected part. Mandatory rights remain reserved.",
        "The services are not legal, tax, customs, financial or regulatory advice. Before filing a declaration, conducting a compliance check or making an important decision, verify information with the official source and, where needed, a qualified professional. Similarities, classifications and model outputs are aids requiring human verification."
      ]},
      { id: "responsabilite", title: "10. Liability", paragraphs: [
        "OpenSwissData prepares and checks data but does not guarantee that public sources are always error-free, complete or current. Disclosed product limitations form part of pre-contract information; they do not excuse performance contrary to express order commitments.",
        "To the extent permitted by applicable law, liability for ordinary negligence is limited to proven direct losses and the amount paid for the order causing the loss. Lost profits, lost opportunities and other indirect losses are excluded to the same extent.",
        "These exclusions and caps do not apply to intent, gross negligence, death or personal injury, or liability and rights that cannot legally be excluded. They do not remove the right to the agreed performance or its refund in case of non-performance."
      ]},
      { id: "indisponibilite", title: "11. Incidents, suspension and withdrawal", paragraphs: [
        "Continuous availability of the site, providers and sources is not guaranteed. A provider outage is not automatically force majeure. We take reasonable steps to restore service and limit consequences without excluding mandatory buyer rights.",
        "Access may be suspended for a security incident, unpaid amount, payment dispute or documented unlawful use. The measure must be proportionate and can be reviewed by support. Unless urgent or legally prohibited, the reason is communicated and a remediable breach can be corrected before termination.",
        "Content may be removed because of a legal obligation or a substantiated rights-holder request. Affected buyers are informed where possible. An impossible delivery leads to refund of the unperformed part; withdrawal of future updates leads to a solution or proportionate refund. Mandatory rights are not removed."
      ]},
      { id: "donnees", title: "12. Personal data and communications", paragraphs: [
        "The privacy notice describes payment, account, support, security and statistics processing. It provides information and is not blanket consent to all processing or marketing. Accepting these terms does not subscribe you to a newsletter.",
        "Necessary purchase and support messages remain separate from advertising. Protect your sign-in and download links and promptly report unauthorised use."
      ]},
      { id: "droit", title: "13. Applicable law, language and disputes", paragraphs: [
        "Swiss law applies, subject to applicable mandatory rules, including where a person legally qualifies as a consumer. For business disputes, the competent courts at the operator’s domicile are designated; TARES disputes are subject to Bern under the documented specific conditions. Mandatory jurisdictions remain reserved.",
        "French, German and English versions are available before purchase. The language presented and accepted at checkout is recorded. No language change may reduce mandatory rights or express commitments. Contact us if a translation appears inconsistent.",
        "Support discussions may help resolve disputes but are not a prerequisite to contacting an authority or preserving a deadline. An invalid clause is replaced by applicable law; other provisions remain effective to the extent permitted."
      ]}
    ]
  }
};
