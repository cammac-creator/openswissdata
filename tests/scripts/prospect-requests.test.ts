import { describe, it, expect } from "vitest";
import {
  CANTONAL_LANGUAGES,
  buildDemandesReport,
  buildLetter,
  chooseRecipient,
  classifyAddress,
  cleanOrgTitle,
  detectIndividualRowColumns,
  datasetLicenceState,
  generateRequests,
  letterLanguage,
  recheckOpenLicences,
  type DemandesReport,
  type RequestLot,
} from "../../scripts/prospect-requests.js";
import { ALLOWED_RECIPIENT_DOMAINS } from "../../src/lib/letters.js";

// Demandes de licence aux distributeurs officiels (plan du 08.10.2026). Aucun appel réseau réel :
// CKAN et les en-têtes CSV passent par un `fetch` simulé, routé par URL.

const BASE_DOMAINS = ["admin.ch", "finma.ch", "un.org", "gleif.org"];
const SHOW = "https://ckan.opendata.swiss/api/3/action/package_show?id=";

type Pkg = Record<string, unknown> & { id: string };

/** UUID déterministe tiré d'une étiquette courte (le catalogue ne donne que des UUID ; l'ordre des
 *  étiquettes de même longueur est conservé). */
function U(tag: string): string {
  const hex = Buffer.from(tag).toString("hex").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pkg(tag: string, over: Record<string, unknown> = {}): Pkg {
  const id = tag;
  return {
    id: U(tag),
    name: `slug-${id}`,
    title: { de: `Gemeindefinanzen ${id}`, fr: `Finances communales ${id}` },
    notes: { de: "Budgets der Gemeinden." },
    organization: { name: "lustat", title: { de: "LUSTAT Statistik Luzern", fr: "LUSTAT Statistique Lucerne" }, political_level: "canton" },
    contact_points: [{ name: "Service", email: "statistik@lustat.ch" }],
    resources: [{ format: "CSV", url: `https://data.example.ch/${id}.csv`, rights: "https://opendata.swiss/terms-of-use#terms_by_ask" }],
    ...over,
  };
}

/** `fetch` simulé : package_show depuis `packages`, en-têtes CSV depuis `headers` (URL → première ligne). */
function fakeFetch(packagesByTag: Record<string, Pkg | null>, headers: Record<string, string | null> = {}) {
  const packages: Record<string, Pkg | null> = Object.fromEntries(Object.entries(packagesByTag).map(([tag, p]) => [U(tag), p]));
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(SHOW)) {
      const id = decodeURIComponent(url.slice(SHOW.length));
      const p = packages[id];
      if (p === undefined || p === null) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ success: true, result: p }), { status: 200 });
    }
    const h = headers[url];
    if (h === undefined || h === null) return new Response("", { status: 404 });
    return new Response(`${h}\n1;2;3\n`, { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const run = (rows: Array<[string, string, string]>, f: ReturnType<typeof fakeFetch>, extra: Partial<Parameters<typeof generateRequests>[0]> = {}) =>
  generateRequests({
    alreadyRequested: new Set(),
    fetchImpl: f.impl,
    sleepImpl: async () => {},
    delayMs: 0,
    timeoutMs: 1000,
    userAgent: "OpenSwissData prospection",
    maxOrgs: 3,
    ...extra,
    // Les étiquettes des tests deviennent des UUID, comme dans l'état réel de la prospection.
    stateRows: rows.map(([tag, d, motif]) => [U(tag), d, motif] as [string, string, string]),
    exclusions: new Set([...(extra.exclusions ?? [])].map(U)),
  });

const HEADER_OK = "Jahr;BFS_Nr;Gemeinde;Budget";

describe("datasetLicenceState : `rights` puis `license` (les deux champs du catalogue)", () => {
  it("lit `license` quand `rights` est vide : un jeu déjà ouvert n'est jamais demandé", () => {
    expect(datasetLicenceState([{ rights: null, license: "https://opendata.swiss/terms-of-use#terms_by" }])).toBe("ouverte");
    expect(datasetLicenceState([{ license: "https://opendata.swiss/terms-of-use#terms_open" }])).toBe("ouverte");
  });
  it("terms_by_ask et terms_ask : utilisation commerciale sur autorisation", () => {
    expect(datasetLicenceState([{ rights: "https://opendata.swiss/terms-of-use#terms_by_ask" }])).toBe("commerciale_sur_autorisation");
    expect(datasetLicenceState([{ license: "https://opendata.swiss/terms-of-use#terms_ask" }])).toBe("commerciale_sur_autorisation");
  });
  it("une autre licence (Creative Commons NC/ND, inconnue) : non ouverte ; aucune licence : absente", () => {
    expect(datasetLicenceState([{ rights: "https://creativecommons.org/licenses/by-nc/4.0/" }])).toBe("non_ouverte");
    expect(datasetLicenceState([{ rights: null, license: null }])).toBe("absente");
    expect(datasetLicenceState([])).toBe("absente");
  });
  it("une seule ressource ouverte suffit à rendre le jeu ouvert (même règle que la prospection)", () => {
    expect(datasetLicenceState([
      { rights: "https://opendata.swiss/terms-of-use#terms_by_ask" },
      { license: "https://opendata.swiss/terms-of-use#terms_by" },
    ])).toBe("ouverte");
  });
  it("CC-BY-SA n'est jamais demandé (exclu par le plan)", () => {
    expect(datasetLicenceState([{ rights: "https://creativecommons.org/licenses/by-sa/4.0/" }])).toBe("cc_by_sa");
  });
});

describe("classifyAddress et chooseRecipient : adresse fonctionnelle d'abord", () => {
  it("reconnaît une adresse fonctionnelle (chaque morceau de la partie locale est un mot de service)", () => {
    for (const a of ["data@blv.admin.ch", "statistik@lustat.ch", "open-data@zh.ch", "info@ge.ch", "ogd@bs.ch", "geoinformation@bd.so.ch"]) {
      expect(classifyAddress(a), a).toBe("fonctionnelle");
    }
  });
  it("tout le reste est traité comme nominatif (prénom.nom, initiales, mot inconnu)", () => {
    for (const a of ["prenom.nom@lustat.ch", "geo.nom@etat.ge.ch", "jdupont@fr.ch", "nom2@zh.ch", "a.b-c@zh.ch"]) {
      expect(classifyAddress(a), a).toBe("nominative");
    }
  });
  it("préfère l'adresse fonctionnelle la plus fréquente, sinon la nominative la plus fréquente", () => {
    expect(chooseRecipient(["prenom.nom@zh.ch", "prenom.nom@zh.ch", "statistik@zh.ch"])).toBe("statistik@zh.ch");
    expect(chooseRecipient(["b.b@zh.ch", "a.a@zh.ch", "a.a@zh.ch"])).toBe("a.a@zh.ch");
    expect(chooseRecipient([])).toBeNull();
  });
});

describe("letterLanguage : français pour la Confédération, langue du canton sinon", () => {
  it("donne une langue à chaque domaine cantonal autorisé (un ajout sans langue échoue ici)", () => {
    const cantonal = ALLOWED_RECIPIENT_DOMAINS.filter((d) => !BASE_DOMAINS.includes(d));
    expect(cantonal.length).toBeGreaterThan(0);
    for (const d of cantonal) expect(CANTONAL_LANGUAGES[d], d).toMatch(/^(fr|de|it)$/);
  });
  it("Confédération → fr ; Lucerne → de ; Genève → fr ; Tessin → it ; sous-domaine reconnu", () => {
    expect(letterLanguage("confederation", "data@blv.admin.ch")).toBe("fr");
    expect(letterLanguage("canton", "statistik@lustat.ch")).toBe("de");
    expect(letterLanguage("canton", "info@etat.ge.ch")).toBe("fr");
    expect(letterLanguage("canton", "info@ti.ch")).toBe("it");
    expect(letterLanguage("canton", "info@statistik.zh.ch")).toBe("de");
  });
});

describe("buildLetter : lettre honnête, identité reprise des lettres du 06.10, aucune invention", () => {
  const org = { name: "lustat", title: { de: "LUSTAT Statistik Luzern", fr: "LUSTAT Statistique Lucerne" }, level: "canton" };
  const datasets = [
    { id: "11111111-1111-1111-1111-111111111111", title: { de: "Gemeindefinanzen", fr: "Finances communales" }, licenceState: "commerciale_sur_autorisation" as const, joinKeys: ["commune"] },
    { id: "22222222-2222-2222-2222-222222222222", title: { de: "Bevölkerungsszenarien" }, licenceState: "absente" as const, joinKeys: ["commune"] },
  ];

  for (const lang of ["fr", "de", "it"] as const) {
    it(`${lang} : objet stable propre à l'éditeur, liens opendata.swiss, signature, motif réservé`, () => {
      const letter = buildLetter(org, datasets, "statistik@lustat.ch", lang);
      expect(letter.to).toBe("statistik@lustat.ch");
      expect(letter.purpose).toBe("demande-licence:lustat");
      expect(letter.subject.length).toBeGreaterThanOrEqual(15);
      expect(letter.subject.length).toBeLessThanOrEqual(200);
      expect(letter.subject).toContain("opendata.swiss");
      expect(letter.subject).toMatch(/LUSTAT/);
      expect(letter.subject).not.toMatch(/[\u0000-\u001f\u007f]/);
      for (const d of datasets) expect(letter.body).toContain(`https://opendata.swiss/${lang}/dataset/${d.id}`);
      expect(letter.body).toContain("Claude-Alain Martin\nOpenSwissData\ncontact@openswissdata.com");
      expect(letter.body).toContain("www.openswissdata.com");
      expect(letter.body).toContain("FINMA"); // honnêteté : une partie de l'activité est commerciale
      expect(letter.body).toContain("terms_by");
      expect(letter.body).not.toContain("statistik@lustat.ch"); // jamais l'adresse du destinataire dans le texte
      expect(letter.body).not.toMatch(/[—–]/); // pas de tiret long (préférence de Claude-Alain)
      expect(letter.body.length).toBeLessThanOrEqual(7500);
      expect(letter.dataset_ids).toEqual(datasets.map((d) => d.id));
      expect(letter.lang).toBe(lang);
    });
  }

  it("ne promet pas une reprise : « pourrons reprendre » / « können … übernehmen » / « potremo riprendere »", () => {
    expect(buildLetter(org, datasets, "statistik@lustat.ch", "fr").body).toContain("nous pourrons reprendre ces données");
    expect(buildLetter(org, datasets, "statistik@lustat.ch", "de").body).toContain("können wir die Daten");
    expect(buildLetter(org, datasets, "statistik@lustat.ch", "it").body).toContain("potremo riprendere questi dati");
  });

  it("refuse de construire un lien vers un identifiant qui n'est pas un UUID", () => {
    expect(() => buildLetter(org, [{ ...datasets[0], id: "../../evil" }], "statistik@lustat.ch", "fr")).toThrow(/UUID/);
  });

  it("titre manquant dans la langue de la lettre : repli sur une autre langue, jamais sur le slug", () => {
    const letter = buildLetter(org, datasets, "statistik@lustat.ch", "it");
    expect(letter.body).toContain("Bevölkerungsszenarien");
    expect(letter.body).not.toContain("slug-");
  });

  it("un seul jeu : la lettre parle au singulier dans les trois langues", () => {
    const one = [datasets[0]];
    expect(buildLetter(org, one, "statistik@lustat.ch", "de").body).toMatch(/den folgenden Datensatz,[\s\S]*Könnten Sie diesen Datensatz/);
    expect(buildLetter(org, one, "statistik@lustat.ch", "fr").body).toMatch(/le jeu de données suivant,[\s\S]*Pourriez-vous le publier/);
    expect(buildLetter(org, one, "statistik@lustat.ch", "it").body).toMatch(/il seguente set di dati,[\s\S]*Potreste pubblicarlo/);
    expect(buildLetter(org, datasets, "statistik@lustat.ch", "de").body).toMatch(/die folgenden Datensätze,[\s\S]*Könnten Sie diese Datensätze/);
  });

  it("au plus 12 jeux par lettre", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...datasets[0], id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` }));
    expect(buildLetter(org, many, "statistik@lustat.ch", "de").dataset_ids).toHaveLength(12);
  });
});

describe("detectIndividualRowColumns : colonnes qui trahissent une ligne par personne", () => {
  it("repère sexe, âge, année de naissance, statut de candidat, élu (toutes langues, après normalisation)", () => {
    expect(detectIndividualRowColumns(["jahr", "gnr", "gemeinde", "partei", "sex", "kand_status", "gewaehlt"])).toEqual(["sex", "kand_status", "gewaehlt"]);
    expect(detectIndividualRowColumns(["Geschlecht"])).toEqual(["Geschlecht"]);
    expect(detectIndividualRowColumns(["Année de naissance"])).toEqual(["Année de naissance"]);
    expect(detectIndividualRowColumns(["candidat_e"])).toEqual(["candidat_e"]);
    expect(detectIndividualRowColumns(["eletto"])).toEqual(["eletto"]);
  });
  it("laisse passer une comptabilité publique par commune (budgets LUSTAT)", () => {
    expect(detectIndividualRowColumns(["jahr", "gnr", "gemeinde", "erhebungsinhalt", "erhebungsteil", "fkt_nr", "fkt_name", "art_nr", "art_name", "saldo"])).toEqual([]);
  });
});

describe("cleanOrgTitle : le titre CKAN « Canton: Office » devient « Office »", () => {
  it("retire un préfixe court suivi de deux-points", () => {
    expect(cleanOrgTitle("Luzern: LUSTAT Statistik Luzern")).toBe("LUSTAT Statistik Luzern");
    expect(cleanOrgTitle("Kanton Zürich: Statistisches Amt")).toBe("Statistisches Amt");
  });
  it("laisse un titre sans préfixe tel quel", () => {
    expect(cleanOrgTitle("Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV")).toBe("Office fédéral de la sécurité alimentaire et des affaires vétérinaires OSAV");
    expect(cleanOrgTitle("LUSTAT")).toBe("LUSTAT");
  });
  it("une lettre à LUSTAT ne commence jamais une phrase par « Luzern: »", () => {
    const letter = buildLetter({ name: "lustat", title: { de: "Luzern: LUSTAT Statistik Luzern" }, level: "canton" }, [{ id: "11111111-1111-1111-1111-111111111111", title: "Gemeindefinanzen", licenceState: "commerciale_sur_autorisation", joinKeys: ["commune"] }], "statistik@lustat.ch", "de");
    expect(letter.subject).toBe("Anfrage für eine offene Lizenz auf opendata.swiss (LUSTAT Statistik Luzern)");
    expect(letter.body).not.toContain("Luzern: LUSTAT");
    expect(letter.body).toContain("mit LUSTAT Statistik Luzern als Quelle");
  });
});

describe("generateRequests : seules les cibles sûres deviennent une lettre", () => {
  it("un jeu cantonal propre, CSV avec clé, contact autorisé → une lettre en allemand à LUSTAT", async () => {
    const f = fakeFetch({ a: pkg("a") }, { "https://data.example.ch/a.csv": HEADER_OK });
    const out = await run([["a", "2026-10-07", "licence_non_ouverte"]], f);
    expect(out.letters).toHaveLength(1);
    expect(out.letters[0]).toMatchObject({ organisation: "lustat", to: "statistik@lustat.ch", lang: "de", purpose: "demande-licence:lustat", dataset_ids: [U("a")] });
  });

  it("ne lit que les motifs de licence de l'état (jamais les candidats ni CC-BY-SA)", async () => {
    const f = fakeFetch({ a: pkg("a"), b: pkg("b"), c: pkg("c") }, { "https://data.example.ch/a.csv": HEADER_OK });
    await run([["a", "d", "candidate"], ["b", "d", "licence_cc_by_sa"], ["c", "d", "personnes_detectees"]], f);
    expect(f.calls).toEqual([]);
  });

  const skipCases: Array<[string, Pkg, Record<string, string | null>, string]> = [
    ["niveau « other » (institut, EnviDat)", pkg("x", { organization: { name: "envidat", title: "EnviDat", political_level: "other" } }), {}, "niveau"],
    ["commune", pkg("x", { organization: { name: "stadt-x", title: "Stadt", political_level: "commune" } }), {}, "niveau"],
    ["OFS (correspondance déjà en cours)", pkg("x", { organization: { name: "bundesamt-fur-statistik-bfs", title: "OFS", political_level: "confederation" } }), {}, "ofs"],
    ["licence ouverte dans `license`", pkg("x", { resources: [{ format: "CSV", url: "https://data.example.ch/x.csv", rights: null, license: "https://opendata.swiss/terms-of-use#terms_by" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "deja_ouverte"],
    ["CC-BY-SA", pkg("x", { resources: [{ format: "CSV", url: "https://data.example.ch/x.csv", rights: "https://creativecommons.org/licenses/by-sa/4.0/" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "cc_by_sa"],
    ["marqueur de personnes dans le texte", pkg("x", { notes: { fr: "Liste des membres avec nom et prénom" } }), { "https://data.example.ch/x.csv": HEADER_OK }, "personnes"],
    ["colonne de personne dans l'en-tête", pkg("x"), { "https://data.example.ch/x.csv": "Gemeinde;Vorname;Nachname" }, "colonne_personne"],
    ["aucun en-tête lisible", pkg("x"), { "https://data.example.ch/x.csv": null }, "sans_entete"],
    ["aucun CSV", pkg("x", { resources: [{ format: "PDF", url: "https://data.example.ch/x.pdf", rights: "https://opendata.swiss/terms-of-use#terms_by_ask" }] }), {}, "sans_entete"],
    ["en-tête sans clé de jointure", pkg("x"), { "https://data.example.ch/x.csv": "Datum;Wert;Einheit" }, "sans_cle"],
    ["une ligne par candidat (élections LUSTAT, sans nom mais reconnaissable)", pkg("x"), { "https://data.example.ch/x.csv": '"jahr";"gnr";"gemeinde";"partei";"partei_kurz";"sex";"kand_status";"gewaehlt";"stand";"record_id"' }, "ligne_par_personne_possible"],
    ["contact hors liste (energiefranken.ch)", pkg("x", { contact_points: [{ email: "info@energiefranken.ch" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "destinataire_hors_liste"],
    ["aucun contact", pkg("x", { contact_points: [] }), { "https://data.example.ch/x.csv": HEADER_OK }, "destinataire_hors_liste"],
    ["éditeur cantonal dont le contact est fédéral (destinataire lié au niveau)", pkg("x", { contact_points: [{ email: "data@blv.admin.ch" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "destinataire_hors_liste"],
    ["éditeur fédéral dont le contact est cantonal", pkg("x", { organization: { name: "blv", title: "OSAV", political_level: "confederation" }, contact_points: [{ email: "info@zh.ch" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "destinataire_hors_liste"],
    ["éditeur déjà en correspondance (SECO, OFRC, FINMA)", pkg("x", { organization: { name: "seco", title: "SECO", political_level: "confederation" }, contact_points: [{ email: "info@seco.admin.ch" }] }), { "https://data.example.ch/x.csv": HEADER_OK }, "correspondance_en_cours"],
    ["identifiant du jeu qui n'est pas un UUID", pkg("x", { id: "pas-un-uuid" }), { "https://data.example.ch/x.csv": HEADER_OK }, "identifiant_invalide"],
  ];
  for (const [label, p, headers, reason] of skipCases) {
    it(`écarte : ${label} (${reason})`, async () => {
      const out = await run([["x", "d", "licence_non_ouverte"]], fakeFetch({ x: p }, headers));
      expect(out.letters).toEqual([]);
      expect(out.skipped[reason]).toBe(1);
    });
  }

  it("doute = pas de lettre : un CSV illisible parmi plusieurs écarte le jeu, même si un autre est propre", async () => {
    const p = pkg("x", { resources: [
      { format: "CSV", url: "https://data.example.ch/x1.csv", rights: "https://opendata.swiss/terms-of-use#terms_by_ask" },
      { format: "CSV", url: "https://data.example.ch/x2.csv", rights: "https://opendata.swiss/terms-of-use#terms_by_ask" },
    ] });
    const out = await run([["x", "d", "licence_non_ouverte"]], fakeFetch({ x: p }, { "https://data.example.ch/x1.csv": null, "https://data.example.ch/x2.csv": HEADER_OK }));
    expect(out.letters).toEqual([]);
    expect(out.skipped.sans_entete).toBe(1);
  });

  it("doute = pas de lettre : une ressource CSV sans adresse écarte le jeu", async () => {
    const p = pkg("x", { resources: [
      { format: "CSV", rights: "https://opendata.swiss/terms-of-use#terms_by_ask" },
      { format: "CSV", url: "https://data.example.ch/x2.csv", rights: "https://opendata.swiss/terms-of-use#terms_by_ask" },
    ] });
    const out = await run([["x", "d", "licence_non_ouverte"]], fakeFetch({ x: p }, { "https://data.example.ch/x2.csv": HEADER_OK }));
    expect(out.letters).toEqual([]);
    expect(out.skipped.sans_entete).toBe(1);
  });

  it("doute = pas de lettre : plus de CSV que le générateur n'en lit écarte le jeu (jamais lu à moitié)", async () => {
    const resources = Array.from({ length: 7 }, (_, i) => ({ format: "CSV", url: `https://data.example.ch/x${i}.csv`, rights: "https://opendata.swiss/terms-of-use#terms_by_ask" }));
    const headers = Object.fromEntries(resources.map((r) => [r.url, HEADER_OK]));
    const f = fakeFetch({ x: pkg("x", { resources }) }, headers);
    const out = await run([["x", "d", "licence_non_ouverte"]], f);
    expect(out.letters).toEqual([]);
    expect(out.skipped.trop_de_csv).toBe(1);
    expect(f.calls.filter((u) => u.endsWith(".csv"))).toEqual([]);
  });

  it("tous les CSV lus et propres (jusqu'à six) : la lettre part", async () => {
    const resources = Array.from({ length: 6 }, (_, i) => ({ format: "CSV", url: `https://data.example.ch/x${i}.csv`, rights: "https://opendata.swiss/terms-of-use#terms_by_ask" }));
    const headers = Object.fromEntries(resources.map((r) => [r.url, HEADER_OK]));
    const out = await run([["x", "d", "licence_non_ouverte"]], fakeFetch({ x: pkg("x", { resources }) }, headers));
    expect(out.letters).toHaveLength(1);
  });

  it("écarte un jeu de la liste noire durable sans même le relire", async () => {
    const f = fakeFetch({ x: pkg("x") }, { "https://data.example.ch/x.csv": HEADER_OK });
    const out = await run([["x", "d", "licence_non_ouverte"]], f, { exclusions: new Set(["x"]) });
    expect(out.letters).toEqual([]);
    expect(out.skipped.liste_noire).toBe(1);
    expect(f.calls).toEqual([]);
  });

  it("n'écrit jamais deux fois au même éditeur (déjà présent dans demandes.json)", async () => {
    const f = fakeFetch({ x: pkg("x") }, { "https://data.example.ch/x.csv": HEADER_OK });
    const out = await run([["x", "d", "licence_non_ouverte"]], f, { alreadyRequested: new Set(["lustat"]) });
    expect(out.letters).toEqual([]);
    expect(out.skipped.deja_demande).toBe(1);
  });

  it("package_show en échec : compté, jamais deviné", async () => {
    const out = await run([["x", "d", "licence_non_ouverte"]], fakeFetch({ x: null }));
    expect(out.letters).toEqual([]);
    expect(out.skipped.catalogue_illisible).toBe(1);
    expect(out.readFailures).toBe(1);
  });

  it("regroupe par éditeur, Confédération d'abord, au plus `maxOrgs` éditeurs", async () => {
    const orgs = ["o1", "o2", "o3", "o4"];
    const packages: Record<string, Pkg> = {};
    const headers: Record<string, string> = {};
    const rows: Array<[string, string, string]> = [];
    for (const o of orgs) {
      for (const n of [1, 2]) {
        const id = `${o}-${n}`;
        packages[id] = pkg(id, { organization: { name: o, title: o.toUpperCase(), political_level: "canton" }, contact_points: [{ email: `statistik@${o === "o1" ? "zh" : "ge"}.ch` }] });
        headers[`https://data.example.ch/${id}.csv`] = HEADER_OK;
        rows.push([id, "d", "licence_non_ouverte"]);
      }
    }
    packages.fed = pkg("fed", { organization: { name: "blv", title: "OSAV", political_level: "confederation" }, contact_points: [{ email: "data@blv.admin.ch" }] });
    headers["https://data.example.ch/fed.csv"] = HEADER_OK;
    rows.push(["fed", "d", "licence_absente"]);
    const out = await run(rows, fakeFetch(packages, headers));
    expect(out.letters.map((l) => l.organisation)).toEqual(["blv", "o1", "o2"]);
    expect(out.letters[0].lang).toBe("fr");
    expect(out.letters[1].dataset_ids).toEqual([U("o1-1"), U("o1-2")]);
    expect(out.skipped.plafond_editeurs).toBe(2);
  });

  it("le résumé public ne contient aucune adresse", async () => {
    const f = fakeFetch({ a: pkg("a") }, { "https://data.example.ch/a.csv": HEADER_OK });
    const out = await run([["a", "d", "licence_non_ouverte"]], f);
    expect(JSON.stringify(out.summary)).not.toContain("@");
  });
});

describe("buildDemandesReport : rapport public, nos actes et le catalogue seulement", () => {
  const lot: RequestLot = {
    generated_on: "2026-10-13",
    letters: [{ organisation: "lustat", to: "statistik@lustat.ch", subject: "s".repeat(20), body: "b", purpose: "demande-licence:lustat", dataset_ids: ["a", "b"], lang: "de" }],
  };

  it("une lettre déposée ajoute ses jeux, avec la date et le statut seulement", () => {
    const report = buildDemandesReport(null, lot, { deposits: [{ organisation: "lustat", purpose: "demande-licence:lustat", outcome: "deposee", http_status: 200 }], statuses: [] }, new Set(), "2026-10-13");
    expect(report.entries).toEqual([
      { id: "a", organisation: "lustat", date: "2026-10-13", statut: "deposee" },
      { id: "b", organisation: "lustat", date: "2026-10-13", statut: "deposee" },
    ]);
    for (const e of report.entries) expect(Object.keys(e).sort()).toEqual(["date", "id", "organisation", "statut"]);
    expect(JSON.stringify(report)).not.toContain("@");
  });

  it("plafond atteint ou refus : rien n'est ajouté (l'éditeur reste demandable)", () => {
    for (const outcome of ["plafond", "refusee", "erreur", "destinataire_recent"] as const) {
      const report = buildDemandesReport(null, lot, { deposits: [{ organisation: "lustat", purpose: "demande-licence:lustat", outcome, http_status: 429 }], statuses: [] }, new Set(), "2026-10-13");
      expect(report.entries).toEqual([]);
    }
  });

  it("statut tiré de la lettre du serveur (nos actes) : en file, envoyée, en échec, annulée", () => {
    const existing: DemandesReport = { generated_on: "2026-10-13", entries: [{ id: "a", organisation: "lustat", date: "2026-10-13", statut: "deposee" }] };
    const map: Array<[string, string]> = [["queued", "deposee"], ["sending", "deposee"], ["sent", "envoyee"], ["failed", "echec_envoi"], ["cancelled", "annulee"]];
    for (const [server, statut] of map) {
      const r = buildDemandesReport(existing, { generated_on: "x", letters: [] }, { deposits: [], statuses: [{ purpose: "demande-licence:lustat", status: server, created_at: 1 }] }, new Set(), "2026-10-20");
      expect(r.entries[0].statut, server).toBe(statut);
    }
  });

  it("licence devenue ouverte sur opendata.swiss : constatée, prioritaire sur le statut de la lettre", () => {
    const existing: DemandesReport = { generated_on: "x", entries: [{ id: "a", organisation: "lustat", date: "2026-10-13", statut: "envoyee" }] };
    const r = buildDemandesReport(existing, { generated_on: "x", letters: [] }, { deposits: [], statuses: [{ purpose: "demande-licence:lustat", status: "sent", created_at: 1 }] }, new Set(["a"]), "2026-10-20");
    expect(r.entries[0]).toEqual({ id: "a", organisation: "lustat", date: "2026-10-13", statut: "licence_ouverte_constatee" });
  });

  it("une demande déjà déposée (409) mais absente du rapport y est reprise", () => {
    const r = buildDemandesReport(null, lot, { deposits: [{ organisation: "lustat", purpose: "demande-licence:lustat", outcome: "deja_deposee", http_status: 409 }], statuses: [] }, new Set(), "2026-10-13");
    expect(r.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("recheckOpenLicences", () => {
  it("rend les seuls jeux dont la licence est devenue ouverte ; un échec de lecture ne conclut rien", async () => {
    const f = fakeFetch({
      a: pkg("a", { resources: [{ format: "CSV", url: "u", license: "https://opendata.swiss/terms-of-use#terms_by" }] }),
      b: pkg("b"),
      c: null,
    });
    const open = await recheckOpenLicences([U("a"), U("b"), U("c")], { fetchImpl: f.impl, sleepImpl: async () => {}, delayMs: 0, timeoutMs: 1000, userAgent: "x" });
    expect([...open]).toEqual([U("a")]);
  });
});
