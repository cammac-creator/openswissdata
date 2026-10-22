/**
 * Faux Portail des feuilles officielles pour les tests de la collecte FOSC.
 *
 * Données entièrement SYNTHÉTIQUES (dépôt public) : identifiants d'avis inventés, IDE fictifs
 * déjà utilisés ailleurs dans les tests (chiffre de contrôle valide), raisons sociales, buts,
 * adresses et textes inventés. Chaque texte libre porte une chaîne témoin : les tests vérifient
 * qu'aucune n'atteint l'état stocké ni les totaux.
 */
import { createHash } from "node:crypto";
import { FOSC_TERMS_URL } from "../../etl/fosc/sources.js";

export const WITNESSES = [
  "TEMOIN-TEXTE-LIBRE-7Q2X",
  "Raison Temoin Inventee",
  "But temoin invente pour les tests",
  "Rue du Temoin Fictif",
  "Prenom-Temoin Nom-Temoin",
] as const;

export const FAKE_TERMS = Buffer.from("conditions generales fictives pour les tests\n");
export const FAKE_TERMS_SHA256 = createHash("sha256").update(FAKE_TERMS).digest("hex");

/** IDE fictifs (chiffre de contrôle valide), repris des tests existants. */
export const IDE = {
  sa1: "CHE-200.000.001",
  sa2: "CHE-200.000.018",
  sarl: "CHE-200.000.053",
  soleProp: "CHE-200.000.030",
  snc: "CHE-200.000.047",
  other: "CHE-200.000.024",
  unknown: "CHE-123.456.009",
  revision: "CHE-109.000.001",
} as const;

export interface FakeCompany { uid?: string | null; legalForm?: string | null; seat?: string | null }

export interface FakeAvis {
  id: string;
  subRubric: string;
  date: string;
  canton: string | null;
  expirationDate?: string | null;
  state?: string;
  /** Un bloc, plusieurs blocs (le schéma autorise plusieurs `company` ou plusieurs `commonsNew`), ou aucun. */
  after?: FakeCompany | FakeCompany[] | null;
  before?: FakeCompany | FakeCompany[] | null;
  /** `companies` (défaut) : plusieurs `company` dans un seul `commonsX` ; `commons` : un `commonsX` par bloc. */
  layout?: "companies" | "commons";
  testImport?: boolean;
  revisionUid?: string;
}

export const avisId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function oneCompany(c: FakeCompany): string {
  const field = (name: string, v: string | null | undefined) => (v === undefined || v === null ? "" : `<${name}>${esc(v)}</${name}>`);
  return `
    <company>
      <name>${WITNESSES[1]}</name>
      <translations>(${WITNESSES[1]} Ltd)</translations>
      ${field("uid", c.uid)}
      <uidOrganisationId>200000001</uidOrganisationId>
      <uidOrganisationIdCategorie>CHE</uidOrganisationIdCategorie>
      ${field("seat", c.seat)}
      ${field("legalForm", c.legalForm)}
      <address><street>${WITNESSES[3]}</street><houseNumber>1</houseNumber><swissZipCode>1000</swissZipCode><town>Lausanne</town></address>
    </company>`;
}

function companyXml(tag: string, c: FakeCompany | FakeCompany[] | null | undefined, layout: FakeAvis["layout"], revisionUid?: string): string {
  if (!c) return "";
  const list = Array.isArray(c) ? c : [c];
  const tail = `
    <purpose><![CDATA[${WITNESSES[2]} & <b>riche</b>]]></purpose>
    ${revisionUid ? `<revision><optingOut>false</optingOut><revisionCompany><name>Organe Temoin SA</name><uid>${revisionUid}</uid></revisionCompany></revision>` : ""}`;
  if (layout === "commons") return list.map((x) => `<${tag}>${oneCompany(x)}${tail}</${tag}>`).join("\n");
  return `<${tag}>${list.map(oneCompany).join("")}${tail}
  </${tag}>`;
}

export function avisXml(a: FakeAvis, overrideId?: string): string {
  const sub = a.subRubric;
  return `<?xml version='1.0' encoding='UTF-8'?>
<${sub}:publication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:${sub}="https://shab.ch/shab/${sub}-export">
<meta>
  <id>${overrideId ?? a.id}</id>
  <rubric>HR</rubric>
  <subRubric>${sub}</subRubric>
  <title><de>${WITNESSES[1]}, Ort</de></title>
  <!-- commentaire ${WITNESSES[0]} -->
</meta>
<content>
  <testImport>${a.testImport ? "true" : "false"}</testImport>
  <publicationText>${WITNESSES[0]} ${WITNESSES[4]} &amp; associés</publicationText>
  ${companyXml("commonsNew", a.after, a.layout, a.revisionUid)}
  ${companyXml("commonsActual", a.before, a.layout)}
</content>
</${sub}:publication>`;
}

export interface FakePortal {
  fetchImpl: typeof fetch;
  calls: string[];
  avis: FakeAvis[];
  /** Réponses forcées, consommées dans l'ordre, pour une adresse qui contient la clé. */
  forced: { match: string; status: number; headers?: Record<string, string> }[];
  /** Détail XML servi tel quel pour un identifiant (documents volontairement malformés). */
  rawDetail: Map<string, string>;
  termsBytes: Buffer;
}

export function fakePortal(avis: FakeAvis[], termsBytes: Buffer = FAKE_TERMS): FakePortal {
  const portal: FakePortal = { calls: [], avis, forced: [], rawDetail: new Map(), termsBytes, fetchImpl: undefined as unknown as typeof fetch };
  portal.fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    portal.calls.push(url);
    const forced = portal.forced.findIndex((f) => url.includes(f.match));
    if (forced !== -1) {
      const f = portal.forced.splice(forced, 1)[0];
      return new Response("refus", { status: f.status, headers: f.headers });
    }
    if (url === FOSC_TERMS_URL) return new Response(new Uint8Array(portal.termsBytes), { status: 200, headers: { "content-type": "application/pdf" } });
    const u = new URL(url);
    const detail = /\/publications\/([0-9a-f-]{36})\/xml$/.exec(u.pathname);
    if (detail) {
      const raw = portal.rawDetail.get(detail[1]);
      if (raw !== undefined) return new Response(raw, { status: 200, headers: { "content-type": "application/xml" } });
      const a = portal.avis.find((x) => x.id === detail[1]);
      if (!a) return new Response("absent", { status: 404 });
      return new Response(avisXml(a), { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (u.pathname.endsWith("/publications")) {
      const day = u.searchParams.get("publicationDate.start");
      const page = Number(u.searchParams.get("pageRequest.page"));
      const size = Number(u.searchParams.get("pageRequest.size"));
      const all = portal.avis.filter((a) => a.date === day && (a.state ?? "PUBLISHED") === "PUBLISHED").sort((x, y) => x.id.localeCompare(y.id));
      const content = all.slice(page * size, (page + 1) * size).map((a) => ({
        meta: {
          id: a.id, rubric: "HR", subRubric: a.subRubric, publicationDate: `${a.date}T00:00:00.000Z`,
          publicationState: "PUBLISHED", expirationDate: a.expirationDate ? `${a.expirationDate}T00:00:00.000Z` : null,
          cantons: a.canton ? [a.canton] : [], title: { de: `${WITNESSES[1]}, Ort` }, legalRemedy: WITNESSES[0],
        },
        content: null, attachments: [], links: [],
      }));
      return new Response(JSON.stringify({ content, total: all.length, pageRequest: { page, size } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("inconnu", { status: 404 });
  }) as typeof fetch;
  return portal;
}
