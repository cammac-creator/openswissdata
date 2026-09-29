/**
 * Guides FINMA (FR/DE/EN) : sources officielles seulement, avertissement présent, aucune entrée de la
 * liste d’alerte nommée, aucun prix ni volume figé, et exemples SQL exécutés contre une archive construite
 * au format réellement livré (etl/finma/bundle.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle as buildProductionBundle } from "../../etl/finma/bundle.js";
import type { FinmaEntity, FinmaWarning } from "../../etl/finma/types.js";
import { parseUidCsv } from "../../etl/finma/ingest.js";
import { withTestSignature } from "../helpers/signature.js";
import { ANONYMOUS_RATE_LIMIT } from "../../src/mcp/rate-limit.js";
import { GUIDES } from "../../web/src/content/guides-finma";
import { COUNTERPARTIES_CSV } from "../../web/src/content/guides-finma/screening-automation";
import { GUIDE_IDS, GUIDE_UI, SAMPLE_CSV_URL, SOURCES, blockTexts, citationOrder, guidePath, parseInline, type Block } from "../../web/src/lib/guides";
import { guideJsonLd } from "../../web/src/lib/structured-data";

const buildBundle = withTestSignature(buildProductionBundle);
const LANGS = ["fr", "de", "en"] as const;
const WEB = join(process.cwd(), "web/src");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const OFFICIAL_HOSTS = ["www.finma.ch", "www.bfs.admin.ch", "www.uid.admin.ch", "www.bj.admin.ch", "www.seco.admin.ch", "www.gleif.org"];
const cases = GUIDE_IDS.flatMap(id => LANGS.map(lang => [id, lang] as const));
const allTexts = (id: (typeof GUIDE_IDS)[number], lang: (typeof LANGS)[number]) => {
  const copy = GUIDES[id][lang];
  return [copy.title, copy.description, copy.lede, copy.h1, copy.accent, copy.short, copy.summary, ...copy.sections.flatMap(s => [s.title, ...s.blocks.flatMap(b => [...blockTexts(b), ...(b.type === "code" ? [b.code] : [])])])];
};
const codeBlocks = (lang: (typeof LANGS)[number], language: string) =>
  GUIDES["finma-screening-automation"][lang].sections.flatMap(s => s.blocks).filter((b): b is Extract<Block, { type: "code" }> => b.type === "code" && b.language === language);

describe("Guides FINMA : pages et adresses", () => {
  it("publie trois guides à la même adresse dans les trois langues", () => {
    expect(GUIDE_IDS).toHaveLength(3);
    for (const [route, depth] of [["pages/guides/[guide].astro", "../../"], ["pages/de/guides/[guide].astro", "../../../"], ["pages/en/guides/[guide].astro", "../../../"]]) {
      expect(existsSync(join(WEB, route)), route).toBe(true);
      expect(read(route), route).toContain(`import FinmaGuide from "${depth}components/FinmaGuide.astro"`);
    }
    for (const id of GUIDE_IDS) {
      expect(guidePath(id, "fr")).toBe(`/guides/${id}/`);
      expect(guidePath(id, "de")).toBe(`/de/guides/${id}/`);
      expect(guidePath(id, "en")).toBe(`/en/guides/${id}/`);
    }
  });

  it.each(cases)("%s en %s : titres, description et sections exploitables", (id, lang) => {
    const copy = GUIDES[id][lang];
    expect(copy.title.length).toBeLessThanOrEqual(110);
    expect(copy.description.length).toBeGreaterThanOrEqual(80);
    expect(copy.description.length).toBeLessThanOrEqual(160);
    const ids = copy.sections.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(copy.sections.length).toBeGreaterThanOrEqual(5);
    // Mêmes ancres dans les trois langues : un lien partagé mène à la même section.
    expect(ids).toEqual(GUIDES[id].fr.sections.map(s => s.id));
  });
});

describe("Guides FINMA : sources et liens", () => {
  it("ne cite que des pages officielles en HTTPS", () => {
    for (const [key, source] of Object.entries(SOURCES)) {
      for (const lang of LANGS) {
        const url = new URL(source.url[lang]);
        expect(url.protocol, key).toBe("https:");
        expect(OFFICIAL_HOSTS, `${key} ${url.host}`).toContain(url.host);
      }
    }
  });

  it.each(cases)("%s en %s : chaque renvoi vise une source connue et chaque lien externe un site officiel", (id, lang) => {
    const copy = GUIDES[id][lang];
    expect(citationOrder(copy).length).toBeGreaterThan(2);
    for (const text of allTexts(id, lang)) {
      for (const part of parseInline(text, lang)) {
        if (part.kind === "link" && part.external) expect(OFFICIAL_HOSTS, part.href).toContain(new URL(part.href).host);
        if (part.kind === "link" && !part.external) expect(part.href, part.href).toMatch(lang === "fr" ? /^\/(?!de\/|en\/)/ : new RegExp(`^/(${lang}/|api/)`));
      }
      // Aucune page de détail de la liste d’alerte : son adresse porte le nom d’une entreprise ou d’une personne.
      expect(text).not.toMatch(/warnungen\/(?:warning-list|warnliste|liste-d'alerte)\/[a-z0-9]/i);
    }
  });

  it.each(cases)("%s en %s : libellés de code et de tableau uniques (régions distinctes pour les lecteurs d’écran)", (id, lang) => {
    const blocks = GUIDES[id][lang].sections.flatMap(s => s.blocks);
    const labels = blocks.flatMap(b => b.type === "code" ? [b.label] : b.type === "table" ? [b.caption] : []);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(cases)("%s en %s : renvoie à la fiche produit", (id, lang) => {
    const texts = allTexts(id, lang).join("\n");
    expect(texts).toContain("(@/datasets/finma/)");
  });

  it("chaque guide propose la fiche produit et l’échantillon sans compte", () => {
    const shell = read("components/FinmaGuide.astro");
    expect(shell).toContain("href={SAMPLE_CSV_URL}");
    expect(shell).toContain("href={L('/datasets/finma/')}");
    expect(SAMPLE_CSV_URL).toBe("/api/catalog/finma?format=csv");
  });

  it("les pages FINMA existantes renvoient aux guides", () => {
    expect(read("components/FinmaProduct.astro")).toMatch(/guidePath\(id, lang\)/);
    expect(read("components/FinmaIndex.astro")).toMatch(/guidePath\(id, lang\)/);
    expect(read("components/FinmaEntityPage.astro")).toContain('guidePath("finma-authorisation-check", lang)');
  });
});

describe("Guides FINMA : prudence du contenu", () => {
  it("rappelle dans chaque langue que le guide n’engage pas la FINMA et ne remplace pas un avis professionnel", () => {
    expect(GUIDE_UI.fr.disclaimer).toMatch(/n’engage pas la FINMA/);
    expect(GUIDE_UI.fr.disclaimer).toMatch(/ne remplace pas un avis juridique ou professionnel/);
    expect(GUIDE_UI.de.disclaimer).toMatch(/bindet die FINMA nicht/);
    expect(GUIDE_UI.de.disclaimer).toMatch(/ersetzt keine rechtliche oder fachliche Beratung/);
    expect(GUIDE_UI.en.disclaimer).toMatch(/does not bind FINMA/);
    expect(GUIDE_UI.en.disclaimer).toMatch(/no substitute for legal or professional advice/);
    expect(read("components/FinmaGuide.astro")).toContain("{ui.disclaimer}");
  });

  it("n’écrit ni prix ni volume du produit en dur", () => {
    const sources = ["content/guides-finma/authorisation-check.ts", "content/guides-finma/warning-list.ts", "content/guides-finma/screening-automation.ts", "components/FinmaGuide.astro", "components/GuideBlock.astro", "lib/guides.ts"].map(read).join("\n");
    expect(sources).not.toMatch(/\b(299|399|797|997)\b/);
    expect(sources).not.toMatch(/\b(120|160) ?CHF|CHF ?(120|160)\b/);
    // Volumes de la version du 28.09.2026 : ils se lisent sur la fiche, depuis le catalogue servi.
    expect(sources).not.toMatch(/\b(2[ ’',.]?943|2[ ’',.]?748|2[ ’',.]?345|2[ ’',.]?858)\b/);
    expect(read("components/FinmaGuide.astro")).toContain("ui.ctaText(FILE_OFFERS.finma.price)");
  });

  it("donne la limite anonyme réellement appliquée au serveur MCP", () => {
    const expected = { fr: `${ANONYMOUS_RATE_LIMIT.calls} appels par heure`, de: `${ANONYMOUS_RATE_LIMIT.calls} Aufrufen pro Stunde`, en: `${ANONYMOUS_RATE_LIMIT.calls} calls per hour` };
    for (const lang of LANGS) expect(allTexts("finma-screening-automation", lang).join("\n")).toContain(expected[lang]);
    const call = codeBlocks("fr", "sh").map(b => b.code).find(code => code.includes("tools/call"));
    const body = JSON.parse(/-d '(.+)'$/m.exec(call ?? "")?.[1] ?? "{}");
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "kyc_check", arguments: { name: "Exemple Banque" } } });
  });

  it("n’emploie que des IDE fictifs, au chiffre de contrôle invalide", () => {
    // Chiffre de contrôle modulo 11 (poids 5 4 3 2 7 6 5 4), vérifié le 29.09.2026 sur les 2 858 UID de la liste de la FINMA.
    const valid = (uid: string) => {
      const digits = uid.replace(/\D/g, "").split("").map(Number);
      const check = 11 - ([5, 4, 3, 2, 7, 6, 5, 4].reduce((sum, weight, i) => sum + weight * digits[i], 0) % 11);
      return check !== 10 && (check === 11 ? 0 : check) === digits[8];
    };
    expect(valid("CHE-103.137.179")).toBe(true);
    const examples = new Set(GUIDE_IDS.flatMap(id => LANGS.flatMap(lang => allTexts(id, lang).join("\n").match(/CHE-?\d{3}\.?\d{3}\.?\d{3}/g) ?? [])));
    expect(examples.size).toBeGreaterThan(0);
    for (const uid of examples) expect(valid(uid), uid).toBe(false);
    for (const line of COUNTERPARTIES_CSV.split("\n").slice(1)) expect(line.split(",")[1]).toMatch(/^Exemple /);
  });

  it("le balisage des guides n’invente aucune date et cite les sources", () => {
    const copy = GUIDES["finma-warning-list"].de;
    const data = guideJsonLd({ lang: "de", path: "/guides/finma-warning-list/", type: "Article", headline: copy.title, description: copy.description,
      breadcrumb: [{ name: "Datensätze", path: "/" }, { name: "FINMA Registry", path: "/datasets/finma" }, { name: copy.short, path: "/guides/finma-warning-list/" }],
      citations: citationOrder(copy).map(id => ({ name: SOURCES[id].title.de, url: SOURCES[id].url.de, publisher: SOURCES[id].publisher.de })) });
    const [article, breadcrumb] = data["@graph"] as Array<Record<string, unknown>>;
    expect(article).toMatchObject({ "@type": "Article", url: "https://www.openswissdata.com/de/guides/finma-warning-list/", inLanguage: "de-CH", author: { "@type": "Organization", name: "OpenSwissData" } });
    expect(article).not.toHaveProperty("datePublished");
    expect(article).not.toHaveProperty("dateModified");
    expect((article.citation as unknown[]).length).toBe(citationOrder(copy).length);
    expect((breadcrumb.itemListElement as Array<{ item: string }>).map(i => i.item)).toEqual(["https://www.openswissdata.com/de/", "https://www.openswissdata.com/de/datasets/finma/", "https://www.openswissdata.com/de/guides/finma-warning-list/"]);
  });
});

describe("Guide d’automatisation : les exemples SQL tournent sur le format livré", () => {
  let dir: string;
  let registrySql: string;
  let warningsSql: string;
  const source = "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/";
  const entities: FinmaEntity[] = [
    { entity_type: "bank", name: "Exemple Banque SA", uid: "CHE-123.456.789", city: "Berne", licence_type: "Bank", licence_type_fr: "Banque", licence_type_de: "Bank", licence_type_it: "Banca", source_list: "finma-uid-csv", source_url: source },
    { entity_type: "securities_firm", name: "Exemple Banque SA", uid: "CHE-123.456.789", city: "Berne", licence_type: "Securities firm", licence_type_fr: "Maison de titres", licence_type_de: "Wertpapierhaus", licence_type_it: "Società di intermediazione mobiliare", source_list: "finma-uid-csv", source_url: source },
    { entity_type: "asset_manager_individual", name: "Exemple Gestion Sàrl", uid: "CHE-987.654.321", city: "Lausanne", licence_type: "Portfolio manager", licence_type_fr: "gestionnaire de fortune", licence_type_de: "Vermögensverwalter", licence_type_it: "gestore patrimoniale", source_list: "finma-uid-csv", source_url: source },
    // Nom voisin, IDE différent : ne doit jamais être rapproché par l’IDE.
    { entity_type: "bank", name: "Exemple Banque Privée SA", uid: "CHE-111.222.333", city: "Genève", licence_type: "Bank", licence_type_fr: "Banque", licence_type_de: "Bank", licence_type_it: "Banca", source_list: "finma-uid-csv", source_url: source },
    { entity_type: "other", name: "Exemple Fintech SA", city: "Zoug", licence_type: "Persons under Article 1b of the Banking Act", licence_type_fr: "personnes selon l'art. 1b de la loi sur les banques", licence_type_de: "Personen nach Art. 1b Bankengesetz", licence_type_it: "persone secondo l'art. 1b LBCR", source_list: "finma-uid-csv", source_url: source },
  ];
  const warnings: FinmaWarning[] = [
    { name: "Exemple Conseil", date_added: "2026-09-01", category: "Not entered in commercial register", source_url: "https://www.finma.ch/en/finma-public/warnungen/warning-list/fictif-1/", source_list: "finma-warnings", warning_type: "unauthorized_provider", additional_info: "fictif-1" },
    { name: "Exemplaire Invest Ltd", date_added: "2026-08-15", category: "Entered in commercial register", source_url: "https://www.finma.ch/en/finma-public/warnungen/warning-list/fictif-2/", source_list: "finma-warnings", warning_type: "unauthorized_provider", additional_info: "fictif-2" },
  ];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-guides-finma-"));
    const result = await buildBundle({ entities, warnings }, "2026.09.29", dir);
    registrySql = execFileSync("unzip", ["-p", result.zipPath, "finma_registry.sql"], { encoding: "utf8" });
    warningsSql = execFileSync("unzip", ["-p", result.zipPath, "finma_warnings.sql"], { encoding: "utf8" });
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  /** Exécute checks.sql comme la ligne de commande sqlite3 : .import émulé, SELECT recueillis dans l’ordre. */
  function runChecks(script: string): Array<Array<Record<string, string>>> {
    const db = new Database(":memory:");
    db.exec(registrySql);
    db.exec(warningsSql);
    const results: Array<Array<Record<string, string>>> = [];
    for (const chunk of script.split(/;\s*(?:\n|$)/)) {
      const lines = chunk.split("\n").filter(line => !line.trim().startsWith("--"));
      for (const line of lines.filter(l => l.startsWith(".import"))) {
        expect(line).toBe(".import --csv counterparties.csv counterparties");
        const [header, ...rows] = COUNTERPARTIES_CSV.split("\n").map(row => row.split(","));
        db.exec(`CREATE TABLE counterparties (${header.map(column => `"${column}" TEXT`).join(", ")})`);
        const insert = db.prepare(`INSERT INTO counterparties VALUES (${header.map(() => "?").join(", ")})`);
        for (const row of rows) insert.run(...header.map((_, i) => row[i] ?? ""));
      }
      const statement = lines.filter(l => !l.startsWith(".")).join("\n").trim();
      if (!statement) continue;
      if (/^SELECT/i.test(statement)) results.push(db.prepare(statement).all() as Array<Record<string, string>>);
      else db.exec(statement);
    }
    db.close();
    return results;
  }

  it("l’archive livre des tables texte, avec des chaînes vides pour les valeurs absentes", () => {
    expect(registrySql).toMatch(/^CREATE TABLE finma_registry \(entity_type TEXT, name TEXT, uid TEXT, lei TEXT/);
    expect(warningsSql).toMatch(/^CREATE TABLE finma_warnings \(name TEXT/);
    const db = new Database(":memory:");
    db.exec(registrySql);
    expect(db.prepare("SELECT count(*) AS n FROM finma_registry WHERE uid = ''").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM finma_registry WHERE uid IS NULL").get()).toEqual({ n: 0 });
    db.close();
  });

  it("un type d’autorisation non classé par OpenSwissData tombe dans « other », comme le guide l’annonce", () => {
    const csv = join(dir, "uid-fictif.csv");
    writeFileSync(csv, '"Name";"City";"AuthorisationTypeDE";"AuthorisationTypeFR";"AuthorisationTypeIT";"AuthorisationTypeEN";"UID"\n"Exemple Nouveau SA";"Berne";"Neu";"Nouveau";"Nuovo";"New authorisation type";"CHE-123.456.789"\n');
    const [entity] = parseUidCsv(csv);
    expect(entity).toMatchObject({ entity_type: "other", licence_type: "New authorisation type", licence_type_fr: "Nouveau" });
  });

  it("le même contrôle SQL, aux commentaires près, dans les trois langues", () => {
    const normalized = LANGS.map(lang => {
      const [sql] = codeBlocks(lang, "sql");
      return sql.code.split("\n").filter(line => !line.startsWith("--")).join("\n").replace(/licence_type(?:_fr|_de)?/g, "LABEL");
    });
    expect(normalized[1]).toBe(normalized[0]);
    expect(normalized[2]).toBe(normalized[0]);
    for (const lang of LANGS) expect(codeBlocks(lang, "csv")[0].code).toBe(COUNTERPARTIES_CSV);
  });

  it.each([["fr", ["Banque", "Maison de titres"]], ["de", ["Bank", "Wertpapierhaus"]], ["en", ["Bank", "Securities firm"]]] as const)("checks.sql en %s : IDE rapprochés, cas à examiner et candidats de la liste d’alerte", (lang, labels) => {
    const [sql] = codeBlocks(lang, "sql");
    const [matches, review, candidates] = runChecks(sql.code);
    matches.sort((a, b) => a.reference.localeCompare(b.reference));
    expect(matches.map(row => row.reference)).toEqual(["C-001", "C-002"]);
    expect(matches[0].finma_name).toBe("Exemple Banque SA");
    expect(matches[0].authorisations.split(" ; ").sort()).toEqual([...labels].sort());
    expect(matches[1].finma_name).toBe("Exemple Gestion Sàrl");
    expect(review).toEqual([{ reference: "C-003", name: "Exemple Conseil AG" }]);
    expect(candidates).toEqual([expect.objectContaining({ reference: "C-003", warning_name: "Exemple Conseil", date_added: "2026-09-01" })]);
  });
});
