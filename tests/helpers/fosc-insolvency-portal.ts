/**
 * Faux Portail des feuilles officielles pour les tests des faillites, concordats, liquidations et
 * appels aux créanciers (lot FOSC du 24.10.2026).
 *
 * Données entièrement INVENTÉES (dépôt public) : identifiants d'avis fabriqués, IDE fictifs déjà
 * utilisés ailleurs dans les tests (chiffre de contrôle valide), noms, adresses, dates de naissance
 * et textes manifestement fictifs. La structure suit celle des schémas d'export 1.26 relevés le
 * 24.10.2026 (`content/debtor/companies/company`, `content/debtor/person`, `content/dissolved/…`),
 * avec des leurres sur les chemins voisins : IDE dans `meta/registrationOffice`, commissaire,
 * liquidateur et office dans le texte libre, numéro IDE sans préfixe dans `uidOrganisationId`.
 */
import { FOSC_TERMS_URL } from "../../etl/fosc/sources.js";
import { INSOLVENCY_BY_CODE } from "../../etl/fosc/subrubrics.js";
import { avisXml, FAKE_TERMS, IDE, type FakeAvis } from "./fosc-portal.js";

/** Chaînes témoins : aucune ne doit sortir de la collecte (état, totaux, fichiers, journal). */
export const PERSON = {
  prename: "Prenom-Fictif-Faillite",
  name: "Nom-Fictif-Faillite",
  birth: "1901-02-03",
  death: "1999-09-09",
  origin: "Lieu-Origine-Temoin",
  info: "TEMOIN-PERSONNE-4F7Q",
} as const;
export const TEXTS = {
  company: "Societe Temoin Faillite SA",
  street: "Rue du Temoin Fictif",
  office: "Office Temoin des Faillites",
  trustee: "Commissaire Temoin Fictif",
  liquidator: "Liquidateur Temoin Fictif",
  remark: "TEMOIN-REMARQUE-9K3Z",
  title: "TEMOIN-TITRE-2M8W",
} as const;
export const INSOLVENCY_WITNESSES: readonly string[] = [...Object.values(PERSON), ...Object.values(TEXTS)];

/** Les trois écritures d'un IDE fictif : forme canonique, sans préfixe, compacte (`uidOrganisationId`). */
export const ideForms = (ide: string): string[] => {
  const digits = ide.replace(/\D/g, "");
  return [ide, ide.slice(4), digits];
};

export interface FakeCompanyBlock {
  uid?: string | null;
  legalForm?: string | null;
  canton?: string | null;
  zip?: string | null;
  town?: string | null;
  /** Nombre de blocs `address` (défaut 1). */
  addresses?: number;
  /** Indice du chemin de bloc de la sous-rubrique (`companyPaths`), défaut 0. */
  pathIndex?: number;
  noUID?: string | null;
}

export interface FakePerson { birth?: string | null; death?: string | null }

export interface InsolvencyAvis {
  id: string;
  subRubric: string;
  date: string;
  cantons: string[];
  expirationDate?: string | null;
  state?: string;
  companies?: FakeCompanyBlock[];
  persons?: FakePerson[];
  /** Type de débiteur (KK, NA) ; défaut : « company » pour un bloc société, « person » pour une personne. */
  debtorType?: string | null;
  addition?: string | null;
  dates?: Record<string, string>;
  /** Remplace la version ou l'espace de noms (schéma inconnu). */
  schemaVersion?: string;
  namespace?: string;
  testImport?: boolean;
  /** Leurre : IDE dans `meta/registrationOffice/uid` (procédure simplifiée des LS). */
  officeUid?: string;
  /** Détail servi tronqué (document illisible : détail en échec). */
  broken?: true;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const el = (name: string, v: string | null | undefined) => (v === undefined || v === null ? "" : `<${name}>${esc(v)}</${name}>`);

function companyXml(c: FakeCompanyBlock): string {
  const digits = c.uid ? c.uid.replace(/\D/g, "") : "";
  const address = `<address><street>${TEXTS.street}</street><houseNumber>12</houseNumber>${el("swissZipCode", c.zip ?? "1000")}${el("town", c.town ?? "Lausanne")}</address>`;
  return `<company>
      <name>${TEXTS.company}</name>
      ${el("uid", c.uid)}
      ${digits ? `<uidOrganisationId>${digits}</uidOrganisationId><uidOrganisationIdCategorie>CHE</uidOrganisationIdCategorie>` : ""}
      ${el("legalForm", c.legalForm)}
      ${address.repeat(c.addresses ?? 1)}
      ${el("canton", c.canton === undefined ? "VD" : c.canton)}
    </company>`;
}

function personXml(p: FakePerson): string {
  return `<person>
      <prename>${PERSON.prename}</prename><name>${PERSON.name}</name>
      <countryOfOrigin><isoCode>CH</isoCode><name><de>Schweiz</de><fr>Suisse</fr></name></countryOfOrigin>
      <placeOfOrigin>${PERSON.origin}</placeOfOrigin>
      ${el("dateOfBirth", p.birth === undefined ? PERSON.birth : p.birth)}
      ${el("dateOfDeath", p.death)}
      <residence><selectType>switzerland</selectType></residence>
      <addressSwitzerland><street>${TEXTS.street}</street><houseNumber>3</houseNumber><swissZipCode>1000</swissZipCode><town>Lausanne</town></addressSwitzerland>
      <personInformation>${PERSON.info}</personInformation>
    </person>`;
}

/** Imbrique un fragment sous un chemin relatif à `content` (`a/b/company` → `<a><b>…</b></a>`). */
function nest(path: string, inner: string, noUID: string | null | undefined): string {
  const parts = path.split("/");
  parts.pop(); // « company »
  const companiesIndex = parts.length - 1; // dernier segment : « companies »
  let xml = inner;
  for (let i = parts.length - 1; i >= 0; i--) {
    const extra = i === companiesIndex && noUID !== null ? `<noUID>${noUID ?? "false"}</noUID>` : "";
    xml = `<${parts[i]}>${extra}${xml}</${parts[i]}>`;
  }
  return xml;
}

export function insolvencyXml(a: InsolvencyAvis, overrideId?: string): string {
  const sub = a.subRubric;
  const rubric = sub.slice(0, 2);
  const paths = INSOLVENCY_BY_CODE.get(sub)?.companyPaths ?? ["debtor/companies/company"];
  const debtorRubric = rubric === "KK" || rubric === "NA";
  const parts: string[] = [];
  for (const c of a.companies ?? []) {
    const path = paths[c.pathIndex ?? 0];
    if (debtorRubric) {
      const type = a.debtorType === undefined ? "company" : a.debtorType;
      parts.push(`<debtor>${el("selectType", type)}<companies>${c.noUID === null ? "" : `<noUID>${c.noUID ?? "false"}</noUID>`}${companyXml(c)}</companies></debtor>`);
    } else {
      parts.push(nest(path, companyXml(c), c.noUID));
    }
  }
  for (const p of a.persons ?? []) {
    const type = a.debtorType === undefined ? "person" : a.debtorType;
    parts.push(`<debtor>${el("selectType", type)}${personXml(p)}</debtor>`);
  }
  const version = a.schemaVersion ?? "1.26";
  const ns = a.namespace ?? `https://shab.ch/shab/${sub}-export`;
  return `<?xml version='1.0' encoding='UTF-8'?>
<${sub}:publication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:${sub}="${ns}" xsi:schemaLocation="${ns} https://amtsblattportal.ch/api/v1/schemas/shab/${version}/${sub}-export.xsd">
<meta>
  <id>${overrideId ?? a.id}</id>
  <rubric>${rubric}</rubric>
  <subRubric>${sub}</subRubric>
  <language>fr</language>
  <registrationOffice><id>00000000-0000-4000-9000-000000000001</id><displayName>${TEXTS.office}</displayName><street>${TEXTS.street}</street><swissZipCode>1000</swissZipCode><town>Lausanne</town>${el("uid", a.officeUid)}</registrationOffice>
  <publicationDate>${a.date}</publicationDate>
  <title><fr>${TEXTS.title} ${PERSON.name} ${TEXTS.company}</fr></title>
  <!-- commentaire ${TEXTS.remark} -->
</meta>
<content>
  ${a.testImport === undefined ? "" : `<testImport>${a.testImport}</testImport>`}
  ${parts.join("\n  ")}
  ${el("addition", a.addition)}
  ${Object.entries(a.dates ?? {}).map(([k, v]) => el(k, v)).join("")}
  <trustee>${TEXTS.trustee}</trustee>
  <registrationOffice>${TEXTS.office}, ${TEXTS.liquidator}, ${TEXTS.street} 1, 1000 Lausanne</registrationOffice>
  <remarks><![CDATA[${TEXTS.remark} & <b>${PERSON.name}</b>]]></remarks>
</content>
</${sub}:publication>`;
}

export interface CombinedPortal {
  fetchImpl: typeof fetch;
  calls: string[];
  hr: FakeAvis[];
  ins: InsolvencyAvis[];
}

/** Portail qui sert à la fois des avis HR (`fosc-portal.ts`) et des avis des nouvelles rubriques. */
export function combinedPortal(ins: InsolvencyAvis[], hr: FakeAvis[] = []): CombinedPortal {
  const portal: CombinedPortal = { calls: [], hr, ins, fetchImpl: undefined as unknown as typeof fetch };
  portal.fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    portal.calls.push(url);
    if (url === FOSC_TERMS_URL) return new Response(new Uint8Array(FAKE_TERMS), { status: 200, headers: { "content-type": "application/pdf" } });
    const u = new URL(url);
    const detail = /\/publications\/([0-9a-f-]{36})\/xml$/.exec(u.pathname);
    if (detail) {
      const a = portal.ins.find((x) => x.id === detail[1]);
      if (a) {
        const xml = insolvencyXml(a);
        return new Response(a.broken ? xml.slice(0, xml.indexOf("</content>")) : xml, { status: 200, headers: { "content-type": "application/xml" } });
      }
      const h = portal.hr.find((x) => x.id === detail[1]);
      if (h) return new Response(avisXml(h), { status: 200, headers: { "content-type": "application/xml" } });
      return new Response("absent", { status: 404 });
    }
    if (u.pathname.endsWith("/publications")) {
      const day = u.searchParams.get("publicationDate.start");
      const page = Number(u.searchParams.get("pageRequest.page"));
      const size = Number(u.searchParams.get("pageRequest.size"));
      const metas = [
        ...portal.hr.filter((a) => a.date === day && (a.state ?? "PUBLISHED") === "PUBLISHED").map((a) => ({
          id: a.id, rubric: "HR", subRubric: a.subRubric, publicationDate: `${a.date}T00:00:00.000Z`, publicationState: "PUBLISHED",
          expirationDate: a.expirationDate ? `${a.expirationDate}T00:00:00.000Z` : null, cantons: a.canton ? [a.canton] : [],
          title: { fr: TEXTS.title },
        })),
        ...portal.ins.filter((a) => a.date === day && (a.state ?? "PUBLISHED") === "PUBLISHED").map((a) => ({
          id: a.id, rubric: a.subRubric.slice(0, 2), subRubric: a.subRubric, publicationDate: `${a.date}T00:00:00.000Z`, publicationState: "PUBLISHED",
          expirationDate: a.expirationDate === undefined ? `${String(Number(a.date.slice(0, 4)) + 5)}${a.date.slice(4)}T00:00:00.000Z`
            : a.expirationDate ? `${a.expirationDate}T00:00:00.000Z` : null,
          cantons: a.cantons, title: { fr: `${TEXTS.title} ${PERSON.name}` }, legalRemedy: TEXTS.remark,
        })),
      ].sort((x, y) => x.id.localeCompare(y.id));
      const content = metas.slice(page * size, (page + 1) * size).map((meta) => ({ meta, content: null, attachments: [], links: [] }));
      return new Response(JSON.stringify({ content, total: metas.length, pageRequest: { page, size } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("inconnu", { status: 404 });
  }) as typeof fetch;
  return portal;
}

export { IDE };
