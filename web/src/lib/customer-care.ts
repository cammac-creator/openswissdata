/**
 * Textes partagés du compte, du support et des tarifs : trajet d’un achat et aide.
 * Chaque phrase reprend les conditions de vente en vigueur (art. 2, 4, 8 et 9) ou le
 * comportement réel du service ; aucun délai de réponse n’est promis. Un changement des
 * CGV ou du parcours de livraison impose de relire ce module.
 */
import type { Lang } from "../i18n/utils";

export const SUPPORT_EMAIL = "contact@openswissdata.com";

export type JourneyStepId = "paiement" | "email" | "lien" | "archive";
export interface JourneyStep { id: JourneyStepId; title: string; text: string; meta: string; hint: string }
export interface JourneyCopy {
  kicker: string; title: string; intro: string; steps: JourneyStep[]; hintLabel: string;
  returnTitle: string; returnText: string; returnLink: string; figure: string;
}

export const JOURNEY: Record<Lang, JourneyCopy> = {
  fr: {
    kicker: "Le trajet d’un achat", title: "Du paiement à l’archive vérifiée.",
    intro: "Quatre étapes, chacune avec sa trace. Si l’une d’elles bloque, vous savez où regarder.",
    figure: "Trajet d’un achat de fichier, en quatre étapes, avec retour possible par l’espace client",
    hintLabel: "Si ça bloque",
    steps: [
      { id: "paiement", title: "Paiement confirmé", text: "Stripe traite le paiement en CHF. L’accès est accordé après sa confirmation ; un moyen de paiement différé peut la retarder.", meta: "Stripe · CHF", hint: "Paiement différé : la livraison part dès sa confirmation." },
      { id: "email", title: "Email de livraison", text: "Un email vous donne accès à l’archive ZIP, normalement en quelques minutes. Ce délai est indicatif, pas une garantie de réception.", meta: "En principe quelques minutes", hint: "Rien reçu ? Regardez les indésirables, puis ouvrez votre espace client." },
      { id: "lien", title: "Téléchargement confirmé", text: "Le lien du mail est personnel et utilisable une fois pendant 48 heures. Il ouvre une page où vous confirmez le téléchargement.", meta: "48 h · un clic de confirmation", hint: "Lien expiré ou déjà utilisé ? Téléchargez depuis votre espace client." },
      { id: "archive", title: "Archive vérifiée", text: "Le manifeste provenance.json est signé Ed25519 ; les empreintes SHA-256 permettent de contrôler chaque fichier reçu.", meta: "Ed25519 · SHA-256", hint: "Fichier illisible ou signature invalide ? Écrivez-nous (CGV, art. 9)." },
    ],
    returnTitle: "Votre espace client",
    returnText: "L’expiration d’un lien ne supprime pas vos droits. Votre espace, ouvert par un lien de connexion valable 15 minutes, donne accès aux versions comprises dans votre achat.",
    returnLink: "Ouvrir mon espace",
  },
  de: {
    kicker: "Der Weg eines Kaufs", title: "Von der Zahlung zum geprüften Archiv.",
    intro: "Vier Schritte, jeder mit seiner Spur. Hakt es irgendwo, wissen Sie, wo Sie nachsehen.",
    figure: "Weg eines Dateikaufs in vier Schritten, mit Rückweg über das Kundenkonto",
    hintLabel: "Wenn es hakt",
    steps: [
      { id: "paiement", title: "Zahlung bestätigt", text: "Stripe wickelt die Zahlung in CHF ab. Der Zugang wird nach der Bestätigung gewährt; verzögerte Zahlungsmethoden können sie hinauszögern.", meta: "Stripe · CHF", hint: "Verzögerte Zahlung: Die Lieferung folgt nach der Bestätigung." },
      { id: "email", title: "Liefer-E-Mail", text: "Eine E-Mail gibt Ihnen Zugriff auf das ZIP-Archiv, normalerweise innert weniger Minuten. Das ist ein Richtwert, keine Garantie für den Eingang.", meta: "In der Regel wenige Minuten", hint: "Nichts erhalten? Prüfen Sie den Spamordner und öffnen Sie dann Ihr Kundenkonto." },
      { id: "lien", title: "Download bestätigt", text: "Der Link in der E-Mail ist persönlich und 48 Stunden lang einmal nutzbar. Er öffnet eine Seite, auf der Sie den Download bestätigen.", meta: "48 Std. · ein Bestätigungsklick", hint: "Link abgelaufen oder bereits verwendet? Laden Sie die Datei im Kundenkonto herunter." },
      { id: "archive", title: "Archiv geprüft", text: "Das Manifest provenance.json ist mit Ed25519 signiert; mit den SHA-256-Prüfsummen kontrollieren Sie jede erhaltene Datei.", meta: "Ed25519 · SHA-256", hint: "Datei unlesbar oder Signatur ungültig? Schreiben Sie uns (AGB, Ziff. 9)." },
    ],
    returnTitle: "Ihr Kundenkonto",
    returnText: "Der Ablauf eines Links löscht Ihre Rechte nicht. Im Kundenkonto, geöffnet über einen 15 Minuten gültigen Anmeldelink, finden Sie die von Ihrem Kauf erfassten Versionen.",
    returnLink: "Kundenkonto öffnen",
  },
  en: {
    kicker: "The path of a purchase", title: "From payment to a verified archive.",
    intro: "Four steps, each leaving a trace. If one of them stalls, you know where to look.",
    figure: "Path of a file purchase in four steps, with a way back through your account",
    hintLabel: "If it stalls",
    steps: [
      { id: "paiement", title: "Payment confirmed", text: "Stripe processes the payment in CHF. Access is granted once it is confirmed; delayed payment methods can postpone that confirmation.", meta: "Stripe · CHF", hint: "Delayed payment: delivery starts once it is confirmed." },
      { id: "email", title: "Delivery email", text: "An email gives you access to the ZIP archive, normally within a few minutes. This is an indication, not a guarantee of receipt.", meta: "Usually a few minutes", hint: "Nothing received? Check your spam folder, then open your account." },
      { id: "lien", title: "Download confirmed", text: "The email link is personal and can be used once within 48 hours. It opens a page where you confirm the download.", meta: "48 h · one confirmation click", hint: "Link expired or already used? Download from your account." },
      { id: "archive", title: "Archive verified", text: "The provenance.json manifest is signed with Ed25519; SHA-256 checksums let you check every file you receive.", meta: "Ed25519 · SHA-256", hint: "Unreadable file or invalid signature? Write to us (terms, section 9)." },
    ],
    returnTitle: "Your account",
    returnText: "An expired link does not remove your rights. Your account, opened with a sign-in link valid for 15 minutes, gives access to the versions covered by your purchase.",
    returnLink: "Open my account",
  },
};

/** Lien interne à localiser (chemin FR) ou adresse mailto, avec son libellé. */
export interface HelpLink { label: string; href: string }
export interface HelpTopic { id: string; question: string; answer: string[]; links: HelpLink[] }

const mailto = (subject: string) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;

export const HELP_TOPICS: Record<Lang, HelpTopic[]> = {
  fr: [
    { id: "email-absent", question: "Je n’ai pas reçu l’email de livraison.", answer: [
      "La livraison part après la confirmation du paiement par Stripe, normalement en quelques minutes ; un moyen de paiement différé peut prendre plus longtemps.",
      "Regardez les courriers indésirables, puis ouvrez votre espace client avec l’adresse saisie chez Stripe : vos fichiers y figurent dès que l’achat est enregistré.",
      "Toujours rien ? Écrivez-nous avec l’adresse d’achat et la référence de paiement, sans données de carte."],
      links: [{ label: "Ouvrir mon espace client", href: "/account" }, { label: "CGV, art. 4", href: "/legal/cgv#livraison" }] },
    { id: "lien-expire", question: "Mon lien de téléchargement a expiré ou a déjà servi.", answer: [
      "Le lien du mail est utilisable une fois pendant 48 heures. Son expiration ne supprime pas vos droits.",
      "Connectez-vous à votre espace client : le bouton « Télécharger » prépare un nouvel accès aux versions comprises dans votre achat."],
      links: [{ label: "Ouvrir mon espace client", href: "/account" }] },
    { id: "connexion", question: "Mon lien de connexion ne fonctionne pas.", answer: [
      "Un lien de connexion est valable 15 minutes et ne sert qu’une fois. Demandez-en un nouveau depuis l’espace client, avec l’adresse utilisée pour l’achat.",
      "Ouvrez-le dans le navigateur où vous voulez consulter vos fichiers, puis confirmez sur la page qui s’affiche. Si elle indique que votre connexion a changé, rouvrez simplement le lien reçu.",
      "Par confidentialité, la réponse affichée est la même pour toutes les adresses : si aucun email n’arrive, l’adresse saisie ne correspond peut-être à aucun achat."],
      links: [{ label: "Demander un nouveau lien", href: "/account" }] },
    { id: "fichier", question: "Un fichier est illisible, incomplet ou sa signature ne se vérifie pas.", answer: [
      "Signalez-le en précisant le produit, sa version et l’erreur observée, sans données confidentielles inutiles.",
      "Nous examinons le problème et proposons une nouvelle livraison ou une correction ; si la prestation convenue ne peut pas être fournie, un remboursement adapté à la partie affectée est proposé."],
      links: [{ label: "Signaler un fichier", href: mailto("Support OpenSwissData · fichier") }, { label: "CGV, art. 9", href: "/legal/cgv#defauts" }] },
    { id: "recu-facture", question: "Il me faut un reçu ou une facture au nom de l’entreprise.", answer: [
      "Le reçu Stripe de chaque achat est accessible depuis votre espace client, avec les conditions de vente acceptées.",
      "Pour une facture au nom de votre entreprise, envoyez-nous sa raison sociale et son adresse de facturation, avec l’adresse utilisée pour l’achat."],
      links: [{ label: "Mes reçus", href: "/account" }, { label: "Demander une facture", href: mailto("Facture OpenSwissData") }] },
    { id: "remboursement", question: "Je souhaite être remboursé.", answer: [
      "Vous pouvez demander le remboursement intégral dans les 14 jours suivant l’achat, sans justification, y compris après téléchargement, sauf redistribution des fichiers à un tiers en violation de la licence.",
      "Écrivez-nous avec l’email d’achat et la référence de commande. Le remboursement est effectué sur le moyen de paiement initial ; le délai d’affichage dépend de votre banque."],
      links: [{ label: "Demander un remboursement", href: mailto("Remboursement OpenSwissData") }, { label: "CGV, art. 8", href: "/legal/cgv#remboursement" }] },
    { id: "mcp", question: "J’ai une question sur l’accès MCP.", answer: [
      "Les outils MCP gratuits restent accessibles sans compte. Les nouvelles souscriptions Pro et Business sont fermées.",
      "Si vous avez déjà un abonnement, il se gère depuis votre espace client et son portail de facturation."],
      links: [{ label: "Le serveur MCP", href: "/mcp" }, { label: "Tarifs", href: "/pricing#mcp" }] },
  ],
  de: [
    { id: "email-absent", question: "Ich habe keine Liefer-E-Mail erhalten.", answer: [
      "Die Lieferung folgt nach der Zahlungsbestätigung durch Stripe, normalerweise innert weniger Minuten; verzögerte Zahlungsmethoden können länger dauern.",
      "Prüfen Sie den Spamordner und öffnen Sie dann Ihr Kundenkonto mit der bei Stripe angegebenen Adresse: Ihre Dateien erscheinen dort, sobald der Kauf erfasst ist.",
      "Immer noch nichts? Schreiben Sie uns mit der Kauf-E-Mail und der Zahlungsreferenz, ohne Kartendaten."],
      links: [{ label: "Kundenkonto öffnen", href: "/account" }, { label: "AGB, Ziff. 4", href: "/legal/cgv#livraison" }] },
    { id: "lien-expire", question: "Mein Download-Link ist abgelaufen oder wurde bereits verwendet.", answer: [
      "Der Link in der E-Mail ist 48 Stunden lang einmal nutzbar. Sein Ablauf löscht Ihre Rechte nicht.",
      "Melden Sie sich im Kundenkonto an: Die Schaltfläche «Herunterladen» bereitet einen neuen Zugriff auf die von Ihrem Kauf erfassten Versionen vor."],
      links: [{ label: "Kundenkonto öffnen", href: "/account" }] },
    { id: "connexion", question: "Mein Anmeldelink funktioniert nicht.", answer: [
      "Ein Anmeldelink ist 15 Minuten gültig und nur einmal nutzbar. Fordern Sie im Kundenkonto mit der Kauf-E-Mail einen neuen an.",
      "Öffnen Sie ihn im Browser, in dem Sie Ihre Dateien ansehen möchten, und bestätigen Sie auf der angezeigten Seite. Meldet sie, dass sich Ihre Anmeldung geändert hat, öffnen Sie den erhaltenen Link einfach erneut.",
      "Aus Datenschutzgründen ist die Antwort für alle Adressen gleich: Kommt keine E-Mail an, gehört die Adresse vielleicht zu keinem Kauf."],
      links: [{ label: "Neuen Link anfordern", href: "/account" }] },
    { id: "fichier", question: "Eine Datei ist unlesbar, unvollständig oder ihre Signatur lässt sich nicht prüfen.", answer: [
      "Melden Sie es uns mit Produkt, Version und beobachtetem Fehler, ohne unnötige vertrauliche Daten.",
      "Wir prüfen den Fall und bieten eine neue Lieferung oder Korrektur an; ist die vereinbarte Leistung nicht erbringbar, bieten wir eine dem betroffenen Teil entsprechende Erstattung."],
      links: [{ label: "Datei melden", href: mailto("Support OpenSwissData · Datei") }, { label: "AGB, Ziff. 9", href: "/legal/cgv#defauts" }] },
    { id: "recu-facture", question: "Ich brauche einen Beleg oder eine Rechnung auf das Unternehmen.", answer: [
      "Den Stripe-Zahlungsbeleg jedes Kaufs finden Sie im Kundenkonto, zusammen mit den akzeptierten Verkaufsbedingungen.",
      "Für eine Rechnung auf Ihr Unternehmen senden Sie uns bitte Firmennamen und Rechnungsadresse, zusammen mit der Kauf-E-Mail."],
      links: [{ label: "Meine Belege", href: "/account" }, { label: "Rechnung anfordern", href: mailto("Rechnung OpenSwissData") }] },
    { id: "remboursement", question: "Ich möchte eine Erstattung.", answer: [
      "Innerhalb von 14 Tagen nach dem Kauf können Sie ohne Begründung die vollständige Erstattung verlangen, auch nach dem Download, ausser wenn Dateien lizenzwidrig an Dritte weitergegeben wurden.",
      "Schreiben Sie uns mit Kauf-E-Mail und Bestellreferenz. Die Erstattung erfolgt auf das ursprüngliche Zahlungsmittel; die Anzeige hängt von Ihrer Bank ab."],
      links: [{ label: "Erstattung verlangen", href: mailto("Erstattung OpenSwissData") }, { label: "AGB, Ziff. 8", href: "/legal/cgv#remboursement" }] },
    { id: "mcp", question: "Ich habe eine Frage zum MCP-Zugang.", answer: [
      "Die kostenlosen MCP-Werkzeuge bleiben ohne Konto zugänglich. Neue Pro- und Business-Abonnements sind geschlossen.",
      "Ein bestehendes Abonnement verwalten Sie im Kundenkonto und dessen Abrechnungsportal."],
      links: [{ label: "Der MCP-Server", href: "/mcp" }, { label: "Preise", href: "/pricing#mcp" }] },
  ],
  en: [
    { id: "email-absent", question: "I did not receive the delivery email.", answer: [
      "Delivery starts once Stripe confirms the payment, normally within a few minutes; delayed payment methods can take longer.",
      "Check your spam folder, then open your account with the address entered at Stripe: your files appear there as soon as the purchase is recorded.",
      "Still nothing? Write to us with the purchase email and payment reference, without card details."],
      links: [{ label: "Open my account", href: "/account" }, { label: "Terms, section 4", href: "/legal/cgv#livraison" }] },
    { id: "lien-expire", question: "My download link has expired or was already used.", answer: [
      "The email link can be used once within 48 hours. Its expiry does not remove your rights.",
      "Sign in to your account: the “Download” button prepares new access to the versions covered by your purchase."],
      links: [{ label: "Open my account", href: "/account" }] },
    { id: "connexion", question: "My sign-in link does not work.", answer: [
      "A sign-in link is valid for 15 minutes and works only once. Request a new one from your account page, with the address used for the purchase.",
      "Open it in the browser where you want to see your files, then confirm on the page that appears. If it says your sign-in has changed, simply reopen the link you received.",
      "For privacy, the confirmation shown is the same for every address: if no email arrives, the address entered may not match any purchase."],
      links: [{ label: "Request a new link", href: "/account" }] },
    { id: "fichier", question: "A file is unreadable, incomplete or its signature does not verify.", answer: [
      "Report it with the product, its version and the error you see, without unnecessary confidential information.",
      "We examine the issue and offer redelivery or a correction; if the agreed service cannot be provided, we offer a refund appropriate to the affected part."],
      links: [{ label: "Report a file", href: mailto("OpenSwissData support · file") }, { label: "Terms, section 9", href: "/legal/cgv#defauts" }] },
    { id: "recu-facture", question: "I need a receipt or an invoice addressed to my company.", answer: [
      "The Stripe receipt for each purchase is available in your account, together with the sales terms you accepted.",
      "For an invoice addressed to your company, send us its legal name and billing address, together with the purchase email."],
      links: [{ label: "My receipts", href: "/account" }, { label: "Request an invoice", href: mailto("OpenSwissData invoice") }] },
    { id: "remboursement", question: "I would like a refund.", answer: [
      "You may request a full refund within 14 days after purchase without giving a reason, including after downloading, unless files have been redistributed to a third party in breach of the licence.",
      "Write to us with the purchase email and order reference. Refunds use the original payment method; the time until they appear depends on your bank."],
      links: [{ label: "Request a refund", href: mailto("OpenSwissData refund") }, { label: "Terms, section 8", href: "/legal/cgv#remboursement" }] },
    { id: "mcp", question: "I have a question about MCP access.", answer: [
      "The free MCP tools remain available without an account. New Pro and Business subscriptions are closed.",
      "If you already have a subscription, manage it from your account and its billing portal."],
      links: [{ label: "The MCP server", href: "/mcp" }, { label: "Pricing", href: "/pricing#mcp" }] },
  ],
};

/** Ce qu’un message au support doit contenir, et ce qu’il ne doit jamais contenir. */
export const SUPPORT_MESSAGE: Record<Lang, { include: string[]; never: string[]; template: { subject: string; body: string } }> = {
  fr: {
    include: ["L’adresse email utilisée pour l’achat", "Le produit : TARES, Classifications, FINMA ou bundle", "La date de l’achat et, si vous l’avez, la référence de paiement du reçu Stripe", "La version concernée, affichée dans votre espace client", "Ce qui se passe : le message d’erreur exact ou une capture d’écran"],
    never: ["Un numéro de carte ou une autre donnée de paiement", "Un lien de connexion ou de téléchargement encore actif : il est personnel", "Des données confidentielles inutiles à la résolution"],
    template: { subject: "Support OpenSwissData", body: "Adresse utilisée pour l’achat :\nProduit :\nDate de l’achat :\nRéférence de paiement (si disponible) :\nCe qui se passe :\n" },
  },
  de: {
    include: ["Die für den Kauf verwendete E-Mail-Adresse", "Das Produkt: TARES, Klassifikationen, FINMA oder Bundle", "Das Kaufdatum und, falls vorhanden, die Zahlungsreferenz auf dem Stripe-Beleg", "Die betroffene Version, angezeigt im Kundenkonto", "Was geschieht: die genaue Fehlermeldung oder ein Bildschirmfoto"],
    never: ["Eine Kartennummer oder andere Zahlungsdaten", "Einen noch gültigen Anmelde- oder Download-Link: Er ist persönlich", "Vertrauliche Daten, die zur Lösung nicht nötig sind"],
    template: { subject: "Support OpenSwissData", body: "Für den Kauf verwendete Adresse:\nProdukt:\nKaufdatum:\nZahlungsreferenz (falls vorhanden):\nWas geschieht:\n" },
  },
  en: {
    include: ["The email address used for the purchase", "The product: TARES, Classifications, FINMA or bundle", "The purchase date and, if you have it, the payment reference on the Stripe receipt", "The version concerned, shown in your account", "What happens: the exact error message or a screenshot"],
    never: ["A card number or any other payment data", "A sign-in or download link that is still valid: it is personal", "Confidential information that is not needed to solve the issue"],
    template: { subject: "OpenSwissData support", body: "Address used for the purchase:\nProduct:\nPurchase date:\nPayment reference (if available):\nWhat happens:\n" },
  },
};

/** Adresse mailto préremplie d’un modèle, sans aucune donnée personnelle. */
export function supportMailto(lang: Lang): string {
  const { subject, body } = SUPPORT_MESSAGE[lang].template;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
