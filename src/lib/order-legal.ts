import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type Stripe from "stripe";
import { type LegalLocale } from "../legal/terms-2026-09-26.js";

import { contractDocument, termsPath, CURRENT_TERMS_VERSION as TERMS_VERSION } from "../legal/catalog.js";

export function termsText(locale: LegalLocale, version = TERMS_VERSION): string {
  const doc = contractDocument(version, locale);
  if (!doc) throw new Error("Version contractuelle inconnue");
  return [doc.title, doc.summary, ...doc.highlights,
    ...doc.sections.flatMap(section => [section.title, ...section.paragraphs])].join("\n\n") + "\n";
}
export const termsDigest = (locale: LegalLocale, version = TERMS_VERSION): string => createHash("sha256").update(termsText(locale, version)).digest("hex");

export function checkoutLegal(locale: LegalLocale, base: string) {
  const url = base + termsPath(locale, TERMS_VERSION);
  const privacy = `${base}${locale === "fr" ? "" : `/${locale}`}/legal/privacy`;
  const [year, month, day] = TERMS_VERSION.split("-");
  const numericDate = `${day}.${month}.${year}`;
  const englishDate = new Intl.DateTimeFormat("en-GB", {day:"numeric", month:"long", year:"numeric", timeZone:"UTC"}).format(new Date(TERMS_VERSION+"T00:00:00Z"));
  const message = {
    fr: `Je confirme acheter pour mon activité professionnelle et avoir le pouvoir d’engager l’acquéreur. J’accepte les [CGV du ${numericDate}](${url}).`,
    de: `Ich bestätige den Kauf für meine berufliche Tätigkeit und meine Vertretungsbefugnis. Ich akzeptiere die [AGB vom ${numericDate}](${url}).`,
    en: `I confirm that I am buying for business purposes and have authority to bind the buyer. I accept the [terms dated ${englishDate}](${url}).`,
  }[locale];
  const submit = {
    fr: `Achat unique de fichiers, sans abonnement. 360 jours de mises à jour incluses. Garantie de remboursement de 14 jours selon les CGV. [Données personnelles](${privacy}).`,
    de: `Einmalkauf von Dateien, kein Abonnement. 360 Tage Aktualisierungen inklusive. 14 Tage Erstattung gemäss AGB. [Datenschutz](${privacy}).`,
    en: `One-off file purchase, no subscription. 360 days of updates included. 14-day refund guarantee under the terms. [Privacy notice](${privacy}).`,
  }[locale];
  return {
    metadata: { terms_version: TERMS_VERSION, terms_locale: locale, terms_sha256: termsDigest(locale) },
    consent_collection: { terms_of_service: "required" as const },
    custom_text: { terms_of_service_acceptance: { message }, submit: { message: submit } },
  };
}

// Un événement Stripe signé atteste le consentement déclaré, pas l’identité civile du signataire.
// Les anciennes commandes ne reçoivent jamais une acceptation présumée.
export function recordOrderLegal(db: Database.Database, orderId: number, session: Stripe.Checkout.Session, event: Stripe.Event): void {
  const meta = session.metadata ?? {};
  const locale = meta.terms_locale === "fr" || meta.terms_locale === "de" || meta.terms_locale === "en" ? meta.terms_locale : null;
  const identified = locale !== null && Boolean(contractDocument(meta.terms_version, locale)) && meta.terms_sha256 === termsDigest(locale, meta.terms_version);
  const accepted = identified && session.consent?.terms_of_service === "accepted";
  const status = accepted ? "accepted" : meta.terms_version ? "unverified" : "legacy";
  db.prepare(`INSERT INTO order_legal(order_id,status,terms_version,locale,document_sha256,event_id,event_created_at,recorded_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(orderId,status,identified ? meta.terms_version : null,identified ? locale : null,
      identified ? termsDigest(locale!, meta.terms_version) : null,event.id,Number.isSafeInteger(event.created) ? event.created * 1000 : null,Date.now());
}

export function orderTermsAttachment(db: Database.Database, orderId: number) {
  const row = db.prepare("SELECT terms_version,locale,document_sha256 FROM order_legal WHERE order_id=? AND status='accepted'").get(orderId) as
    {terms_version:string;locale:LegalLocale;document_sha256:string} | undefined;
  if (!row || !contractDocument(row.terms_version, row.locale) || row.document_sha256 !== termsDigest(row.locale, row.terms_version)) return undefined;
  return { filename: `openswissdata-cgv-${row.terms_version}-${row.locale}.txt`, content: Buffer.from(termsText(row.locale, row.terms_version)).toString("base64") };
}

export function orderLegalSummary(db: Database.Database, orderId: number) {
  const row = db.prepare("SELECT status,terms_version,locale,document_sha256,event_created_at,recorded_at FROM order_legal WHERE order_id=?").get(orderId) as
    {status:string;terms_version:string|null;locale:LegalLocale|null;document_sha256:string|null;event_created_at:number|null;recorded_at:number} | undefined;
  return row ? { ...row, url: row.terms_version && row.locale && contractDocument(row.terms_version, row.locale) ? termsPath(row.locale, row.terms_version) : null } : { status: "legacy", url: null };
}
