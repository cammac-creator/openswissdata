// Vitrine « Mouvements FINMA » (lot V2). Données entièrement inventées : noms « témoin »,
// IDE en CHE-900.*, adresses en alerte.exemple. Ce fichier prouve : 1) le bloc produit par le
// vrai calcul (etl/finma/movements.ts) est lu et ses nombres sont rendus, sans aucun nom, IDE ni
// adresse, même si le témoin en portait par erreur ; 2) sans bloc, ou avec un bloc illisible, la
// page dit qu'elle attend et n'affiche aucun nombre ; 3) mêmes adresses dans les trois langues
// (hreflang), page reliée au pied de page et à llms.txt ; 4) aucune date, aucun prix, aucune
// promesse pour la suite ; 5) le bouton envoie un seul événement anonyme accepté par la route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMovements, type MovementsBlock, type MovementsSnapshot } from "../../etl/finma/movements.js";
import type { FinmaEntity, FinmaWarning } from "../../etl/finma/types.js";
import { MOVEMENTS_EVENT, MOVEMENTS_PATH, movementsCopy, movementsPage, readMovements, type MovementsPage } from "../../web/src/lib/finma-movements";
import { getHreflangAlternates } from "../../web/src/i18n/utils";
import { createApp } from "../../src/index.js";
import { closeDb, getDb } from "../../src/lib/db.js";

const LANGS = ["fr", "de", "en"] as const;
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const uid = (i: number) => `CHE-900.000.${String(i).padStart(3, "0")}`;
const bank = (i: number, extra: Partial<FinmaEntity> = {}): FinmaEntity => ({
  entity_type: "bank", name: `Banque témoin ${i}`, uid: uid(i), licence_type: "Bank", city: "Ville témoin",
  source_list: "finma-uid-csv", source_url: "https://registre.exemple/", ...extra,
});
const manager = (i: number, extra: Partial<FinmaEntity> = {}): FinmaEntity => bank(i, {
  entity_type: "asset_manager_individual", name: `Gestion témoin ${i}`, licence_type: "Portfolio manager", ...extra,
});
const alert = (i: number, date: string): FinmaWarning => ({
  name: `Entité témoin ${i}`, date_added: date, source_url: `https://alerte.exemple/fiche-${i}/`,
  source_list: "finma-warnings", warning_type: "unauthorized_provider",
});
const base = () => [...Array.from({ length: 40 }, (_, i) => bank(i + 1)), ...Array.from({ length: 20 }, (_, i) => manager(i + 41))];
const snap = (version: string, entities: FinmaEntity[], warnings: FinmaWarning[]): MovementsSnapshot => ({ version, entities, warnings });

/**
 * Août (figé, partiel), le trou du 24.08 au 25.09, septembre (ouvert, partiel) et octobre (ouvert) :
 * apparitions et disparitions au registre, ajouts et retraits de la liste d'alerte.
 */
function fictiveBlock(): MovementsBlock {
  const alerts = [alert(1, "2026-08-01"), alert(2, "2026-08-10")];
  const s = [
    snap("2026.08.23", base(), alerts),
    snap("2026.08.24", [...base(), bank(101)], [...alerts, alert(3, "2026-08-24")]),
    // Reprise après le trou : une banque apparue, un gestionnaire disparu, deux entrées d'alerte.
    snap("2026.09.25", [...base().filter(e => e.uid !== uid(60)), bank(101), bank(102)], [...alerts, alert(3, "2026-08-24"), alert(4, "2026-09-02"), alert(5, "2026-09-20")]),
    snap("2026.09.26", [...base().filter(e => e.uid !== uid(60)), bank(101), bank(102), manager(103)], [...alerts, alert(3, "2026-08-24"), alert(4, "2026-09-02"), alert(5, "2026-09-20"), alert(6, "2026-09-26")]),
    // Du 27.09 au 01.10 : un gestionnaire disparu le 27, une entrée d'alerte retirée le 27, puis rien.
    ...["2026.09.27", "2026.09.28", "2026.09.29", "2026.09.30", "2026.10.01"].map(version =>
      snap(version, [...base().filter(e => ![uid(60), uid(59)].includes(e.uid!)), bank(101), bank(102), manager(103)], [...alerts, alert(4, "2026-09-02"), alert(5, "2026-09-20"), alert(6, "2026-09-26")])),
  ];
  const current = snap("2026.10.02", [...base().filter(e => ![uid(60), uid(59)].includes(e.uid!)), bank(101), bank(102), manager(103), bank(104), bank(105), bank(106)],
    [...alerts, alert(4, "2026-09-02"), alert(5, "2026-09-20"), alert(6, "2026-09-26"), alert(7, "2026-10-01"), alert(8, "2026-10-02")]);
  return buildMovements(s, current);
}
const witnessWith = (block: unknown) => ({ version: "2026.10.02", collected_on: "2026-10-02", registry_rows: 2000, history: { available_from: "2026-08-23", snapshots: 7, movements: block } });
/** Tout ce que la page affiche en dehors de ses textes fixes. */
const dynamicPart = (page: MovementsPage) => JSON.stringify({ freshness: page.freshness, latest: page.latest, trend: page.trend, months: page.months, resumptions: page.resumptions });
const allStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return allStrings((value as (...a: number[]) => unknown)(7, 31));
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
};

describe("Mouvements FINMA : bloc du vrai calcul rendu en nombres seulement", () => {
  const block = fictiveBlock();

  it("le bloc fictif couvre les cas de la page (mois figé, mois ouverts, reprise)", () => {
    expect(block.months.map(m => [m.month, m.status, m.partial])).toEqual([["2026-08", "frozen", true], ["2026-09", "open", true], ["2026-10", "open", true]]);
    expect(block.resumptions.map(r => [r.from, r.to, r.days])).toEqual([["2026.08.24", "2026.09.25", 32]]);
  });

  it.each(LANGS)("%s : nombres présents, aucun nom, IDE ni adresse", lang => {
    const page = movementsPage(witnessWith(block), lang);
    expect(page.state).toBe("ready");
    const october = block.months.find(m => m.month === "2026-10")!;
    expect(page.latest!.stats.map(s => s.value)).toEqual([october.registry.totals.added, october.registry.totals.removed, october.warnings.added_dated_in_month]);
    expect(page.latest!.stats.map(s => s.value)).toEqual([3, 0, 2]);
    expect(page.months.map(m => m.registry.added)).toEqual([3, 1, 1]);
    expect(page.months[1].registry.removed).toBe(1);
    expect(page.months.map(m => m.tags.length)).toEqual([2, 2, 2]);
    expect(page.months[0].registryCoverage).toMatch(/^2 /);
    expect(page.resumptions).toHaveLength(1);
    expect(page.resumptions[0].heading).toContain("24.08.2026");
    expect(page.resumptions[0].heading).toContain("25.09.2026");
    expect(page.resumptions[0].registry.slice(0, 2).map(([, n]) => n)).toEqual([1, 1]);
    expect(page.resumptions[0].byMonth.map(([, n]) => n)).toEqual([2]);
    expect(page.freshness).toContain("02.10.2026");
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/témoin|CHE-\d|alerte\.exemple|registre\.exemple/);
  });

  it("un champ inattendu du témoin (nom, adresse, catégorie inconnue) n'atteint jamais la page", () => {
    const tainted = JSON.parse(JSON.stringify(block)) as MovementsBlock & Record<string, unknown>;
    const month = tainted.months.at(-1)! as unknown as Record<string, unknown> & MovementsBlock["months"][number];
    month.name = "Exemple Banque SA";
    month.source_url = "https://alerte.exemple/fiche-exemple/";
    month.registry.by_category["Exemple Gestion Sàrl"] = { added: 4, removed: 0, licence_changed: 0, name_changed: 0, city_changed: 0, status_changed: 0, address_changed: 0 };
    tainted.names = ["Exemple Banque SA"];
    for (const lang of LANGS) {
      const page = movementsPage(witnessWith(tainted), lang);
      expect(page.state).toBe("ready");
      expect(JSON.stringify(page)).not.toMatch(/Exemple|alerte\.exemple/);
      const other = page.latest!.categories.find(c => c.label === { fr: "Autre catégorie", de: "Andere Kategorie", en: "Other category" }[lang]);
      expect(other?.added).toBe(4);
    }
  });

  it("chaque retrait de la liste d'alerte est rendu avec les changements d'adresse probables et la réserve", () => {
    for (const lang of LANGS) {
      const page = movementsPage(witnessWith(block), lang);
      for (const row of page.months) expect(row.removedCell).toBe(page.copy.removedCell(row.warnings.removed, row.warnings.removedUrlChange));
      expect(page.copy.removedCell(5, 4)).toMatch(/5.*4/);
      expect(page.copy.warningsNote.join(" ")).toMatch(/sanction|Sanktion/);
    }
  });
});

describe("Mouvements FINMA : sans bloc lisible, aucun nombre", () => {
  const current = JSON.parse(read("docs/data-status/finma.json"));

  it.each(LANGS)("%s : témoin sans bloc → message d'attente, aucun nombre inventé", lang => {
    const witness = { ...current, history: { ...current.history } };
    delete witness.history.movements;
    for (const value of [witness, undefined, null, {}, { history: {} }]) {
      const page = movementsPage(value, lang);
      expect(page.state).toBe("waiting");
      expect([page.latest, page.months.length, page.trend.length, page.resumptions.length]).toEqual([null, 0, 0, 0]);
      expect(dynamicPart(page)).not.toMatch(/\d/);
      expect(page.copy.waitingTitle).toMatch(/prochaine collecte|nächsten Erhebung|next collection/);
    }
  });

  it("un bloc illisible ou d'un autre schéma n'affiche rien plutôt qu'un nombre douteux", () => {
    const good = fictiveBlock();
    const broken: unknown[] = [
      { ...good, schema_version: 2 },
      { ...good, months: "aucun" },
      { ...good, months: [{ ...good.months[0], month: "2026-13" }] },
      { ...good, months: [{ ...good.months[0], registry: { ...good.months[0].registry, totals: { ...good.months[0].registry.totals, added: -1 } } }] },
      { ...good, months: [{ ...good.months[0], warnings: { ...good.months[0].warnings, added_dated_in_month: "Exemple Banque SA" } }] },
      { ...good, months: [good.months[0], good.months[0]] },
      { ...good, resumptions: [{ ...good.resumptions[0], from: "hier" }] },
      "Exemple Banque SA",
    ];
    for (const block of broken) for (const lang of LANGS) {
      const page = movementsPage(witnessWith(block), lang);
      expect(page.state).toBe("unavailable");
      expect(dynamicPart(page)).not.toMatch(/\d|Exemple/);
    }
  });

  it("un bloc vide (aucune comparaison encore) reste en attente", () => {
    expect(readMovements(witnessWith({ ...fictiveBlock(), months: [], resumptions: [] }))).toEqual({ state: "waiting" });
  });

  it("le témoin public du dépôt se lit sans erreur, avec ou sans bloc", () => {
    expect(["waiting", "ready"]).toContain(readMovements(current).state);
  });
});

describe("Mouvements FINMA : adresses, liens et textes", () => {
  it("même adresse dans les trois langues, hors de /finma/, reliée au pied de page et à llms.txt", () => {
    expect(MOVEMENTS_PATH).toBe("/finma-movements/");
    expect(getHreflangAlternates(MOVEMENTS_PATH)).toEqual([
      { lang: "fr", url: "/finma-movements/" }, { lang: "de", url: "/de/finma-movements/" }, { lang: "en", url: "/en/finma-movements/" },
    ]);
    for (const [route, depth] of [["web/src/pages/finma-movements.astro", "../"], ["web/src/pages/de/finma-movements.astro", "../../"], ["web/src/pages/en/finma-movements.astro", "../../"]]) {
      expect(existsSync(join(ROOT, route)), route).toBe(true);
      expect(read(route), route).toContain(`import FinmaMovementsPage from "${depth}components/FinmaMovementsPage.astro"`);
    }
    expect(existsSync(join(ROOT, "web/src/pages/finma/finma-movements.astro"))).toBe(false);
    expect(read("web/src/components/AtlasFooter.astro")).toContain("L('/finma-movements/')");
    expect(read("web/public/llms.txt")).toContain("https://www.openswissdata.com/en/finma-movements/");
    // Le plan du site et les hreflang de la page construite sont vérifiés par seo:check après le build.
    expect(read("scripts/check-seo.mjs")).toContain("'/finma-movements/', '/de/finma-movements/', '/en/finma-movements/'");
  });

  it.each(LANGS)("%s : aucune date, aucun prix, aucune promesse pour la suite ; les trois mentions", lang => {
    const copy = movementsCopy(lang);
    const texts = allStrings(copy);
    for (const text of texts) {
      expect(text).not.toMatch(/bientôt|prochainement|bald|demnächst|\bsoon\b|coming|CHF|\bprix\b|Preis|\bprice\b|abonnement|Abonnement|subscription/i);
    }
    expect(copy.nextTitle).not.toMatch(/\d/);
    expect(`${copy.nextTitle} ${copy.nextText} ${copy.button} ${copy.buttonNote} ${copy.thanks}`).not.toMatch(/\d/);
    expect(copy.nextTitle).toMatch(/en préparation|in Vorbereitung|in preparation/);
    expect(copy.notice).toHaveLength(3);
    expect(copy.notice.join(" ")).toMatch({ fr: /pas une publication officielle de la FINMA.*pas dates de décision.*n’est pas une sanction/, de: /keine offizielle Veröffentlichung der FINMA.*keine Entscheiddaten.*keine Sanktion/, en: /not an official FINMA publication.*not decision dates.*not a sanction/ }[lang]);
    expect(copy.method.map(([, text]) => text).join(" ")).toMatch(/24\.08.*25\.09\.2026/);
    expect(copy.description.length).toBeGreaterThanOrEqual(80);
    expect(copy.description.length).toBeLessThanOrEqual(160);
  });

  it("la page ne lie aucune entrée de la liste d'alerte et ne lit ses chiffres qu'au build", () => {
    const component = read("web/src/components/FinmaMovementsPage.astro");
    expect(component).toContain("import.meta.glob('../../../docs/data-status/finma.json'");
    expect(component).not.toMatch(/<form\b|fetch\(|warnungen|liste-d|warnliste|warning-list\//i);
    expect(component).toMatch(/<button type="button" class="atlas-btn" data-interest hidden>/);
    for (const lang of LANGS) {
      const page = movementsPage(undefined, lang);
      expect(page.links.official).toMatch(/^https:\/\/www\.finma\.ch\/(fr|de|en)\/finma-public\/(etablissements|bewilligte|authorised)/);
      expect(Object.values(page.links).join(" ")).not.toMatch(/finma\.ch\/\S*(warnungen|alerte|warnliste|warning-list)/);
    }
  });
});

describe("Mouvements FINMA : bouton « être prévenu »", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-mouvements-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.SESSION_SECRET = "test-session-secret-123456";
  });
  afterEach(async () => {
    await new Promise(r => setImmediate(r));
    vi.restoreAllMocks();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.SESSION_SECRET;
  });

  it("le script envoie exactement l'événement anonyme etre_prevenu, accepté par la route existante", async () => {
    expect(MOVEMENTS_EVENT).toBe("etre_prevenu");
    const script = read("web/src/scripts/finma-movements.ts");
    expect(script).toContain("fetch('/api/events/track'");
    expect(script).toContain("JSON.stringify({ name: event, kind: 'custom', meta: { lang: box.dataset.lang ?? 'fr' } })");
    expect(script).toContain("button.hidden = false");
    expect(script).not.toMatch(/innerHTML|localStorage|document\.cookie|email|mail/i);
    const res = await createApp().request("/api/events/track", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: MOVEMENTS_EVENT, kind: "custom", meta: { lang: "fr" } }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(getDb().prepare("SELECT name, kind, origin, meta_json FROM events").all()).toEqual([
      { name: "etre_prevenu", kind: "custom", origin: "client", meta_json: JSON.stringify({ lang: "fr" }) },
    ]);
  });
});
