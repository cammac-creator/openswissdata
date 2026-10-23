// Données entièrement fictives : aucune personne ni archive réelle dans ces tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import archiver from "archiver";
import { buildFullHistory, writeFullHistoryArchive } from "../../etl/finma/historique-complet.js";
import { buildMovements, compareRegistry, type MovementsSnapshot } from "../../etl/finma/movements.js";
import { canonicalize, sha256OfBuffer, type SignedProvenanceManifest } from "../../etl/shared/provenance.js";
import {
  allowedHistoryUids, checkHistoryOutput, parseHistoryArgs, readLocalHistory, readHistoryZip,
} from "../../scripts/build-finma-historique.js";
import type { FinmaEntity, FinmaWarning } from "../../etl/finma/types.js";

const uid = (n: number) => `CHE-900.000.${String(n).padStart(3, "0")}`;
const entity = (n: number, extra: Partial<FinmaEntity> = {}): FinmaEntity => ({
  uid: uid(n), name: `Société fictive ${n}`, entity_type: "bank", licence_type: "Bank",
  city: "Ville fictive", canton: "VD", source_list: "finma-uid-csv", source_url: "https://registre.example/",
  ...extra,
});
const warning = (n: number, date = "2026-10-02"): FinmaWarning => ({
  name: `ALERTE_INTERDITE_${n}`, source_url: `https://alerte.example/interdite-${n}`, date_added: date,
  source_list: "finma-warnings", warning_type: "unauthorized_provider",
});
const snapshot = (version: string, entities: FinmaEntity[], warnings: FinmaWarning[] = [], quality?: unknown): MovementsSnapshot =>
  ({ version, entities, warnings, quality });
const options = { allowedUids: new Set(Array.from({ length: 200 }, (_, n) => uid(n))) };
const baseline = () => Array.from({ length: 40 }, (_, n) => entity(n));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osd-historique-fictif-"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans cet essai"); }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function zipFixture(version: string, rows: FinmaEntity[], warnings: FinmaWarning[] = [], extra: Record<string, string> = {}, corrupt = false) {
  const parent = join(dir, "sources", version);
  mkdirSync(parent, { recursive: true });
  const contents: Record<string, string> = {
    "finma_registry.json": JSON.stringify(rows), "finma_warnings.json": JSON.stringify(warnings), ...extra,
  };
  contents["checksums.sha256"] = Object.entries(contents).map(([name, text]) => `${sha256OfBuffer(text)}  ${name}`).join("\n");
  if (corrupt) contents["finma_registry.json"] += "\n";
  const path = join(parent, "finma.zip");
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(path), archive = archiver("zip");
    out.on("close", resolve); out.on("error", reject); archive.on("error", reject); archive.pipe(out);
    for (const [name, text] of Object.entries(contents)) archive.append(text, { name });
    void archive.finalize().catch(reject);
  });
  return path;
}

describe("Historique complet : calcul et confidentialité", () => {
  it("reprend exactement les agrégats de la vitrine et distingue les dates d'observation", () => {
    const a = snapshot("2026.10.01", baseline(), [warning(1, "2026-09-30")]);
    const after = baseline().filter(r => r.uid !== uid(1)).map(r => r.uid === uid(2) ? { ...r, name: "Société fictive renommée" }
      : r.uid === uid(3) ? { ...r, city: "Autre ville fictive" }
        : r.uid === uid(4) ? { ...r, entity_type: "securities_firm" as const, licence_type: "Securities firm" } : r);
    after.push(entity(50, { licence_date: "2020-01-01" }));
    const b = snapshot("2026.10.02", after, [warning(2)]);
    const history = buildFullHistory([b, a], options);
    expect(history.history.movements).toEqual(buildMovements([a], b));
    expect(history.history.movements.months[0].registry.totals).toMatchObject({
      added: 1, removed: 1, name_changed: 1, city_changed: 1, licence_changed: 1,
    });
    expect(history.monthly.reduce((n, r) => n + r.total, 0)).toBe(5);
    expect(history.named).toHaveLength(4);
    expect(history.warningMonthly[0]).toEqual({ month: "2026-10", ...buildMovements([a], b).months[0].warnings });
    expect(history.named.every(r => r.observed_at === "2026-10-02")).toBe(true);
    expect(history.named.find(r => r.kind === "licence_changed")).toMatchObject({
      before: { entity_type: "bank", licence_type: "Bank" }, after: { entity_type: "securities_firm", licence_type: "Securities firm" },
    });
    expect(history.observations[0].registry_status).toBe("baseline");
    expect(JSON.stringify(history)).not.toMatch(/ALERTE_INTERDITE|alerte\.example|2020-01-01/);
    expect(Object.values(history.reconciliation[0].difference)).toEqual(Array(7).fill(0));
  });

  it("ne nomme que l'IDE exact autorisé, quelle que soit la catégorie, et jamais une identité incertaine", () => {
    const rows = [
      entity(1, { name: "Autorisée fictive", entity_type: "asset_manager_individual" }),
      entity(2, { name: "SANS_IDE_INTERDIT", uid: undefined }),
      entity(3, { name: "FORME_INCONNUE_INTERDITE" }),
      entity(4, { name: "FORMAT_PROCHE_INTERDIT", uid: "CHE900000001" }),
      entity(5, { name: "ESPACE_INTERDIT", uid: `${uid(1)} ` }),
      entity(6, { name: "CASSE_INTERDITE", uid: uid(1).toLowerCase() }),
    ];
    const h = buildFullHistory([snapshot("2026.10.01", []), snapshot("2026.10.02", rows)], { allowedUids: new Set([uid(1)]) });
    expect(h.named.map(r => r.uid)).toEqual([uid(1)]);
    expect(h.monthly.reduce((n, r) => n + r.totals_only, 0)).toBe(5);
    expect(JSON.stringify(h)).not.toMatch(/SANS_IDE_INTERDIT|FORME_INCONNUE_INTERDITE|FORMAT_PROCHE_INTERDIT|ESPACE_INTERDIT|CASSE_INTERDITE/);
    expect(buildFullHistory([snapshot("2026.10.01", []), snapshot("2026.10.02", rows)], { allowedUids: new Set() }).named).toEqual([]);
  });

  it("garde tous les mouvements d'une société retirée en totaux par défaut, même son apparition antérieure", () => {
    const a = snapshot("2026.10.01", []), b = snapshot("2026.10.02", [entity(1, { name: "RETRAIT_INTERDIT" })]);
    const c = snapshot("2026.10.03", []);
    const h = buildFullHistory([a, b, c], options);
    expect(h.named).toEqual([]);
    expect(JSON.stringify(h)).not.toContain("RETRAIT_INTERDIT");
    expect(h.monthly.find(r => r.kind === "removed")).toMatchObject({ month: "2026-10", entity_type: "bank", canton: "VD", total: 1, totals_only: 1 });
    const enabled = buildFullHistory([a, b, c], { ...options, includeWithdrawnNames: true });
    expect(enabled.named.map(r => r.kind)).toEqual(["added", "removed"]);
    expect(buildFullHistory([a, b, c], { allowedUids: new Set(), includeWithdrawnNames: true }).named).toEqual([]);
  });

  it("conserve le trou août-septembre comme reprise, sans détail ni mouvement mensuel inventé", () => {
    const a = snapshot("2026.08.24", [entity(1)], [warning(1)]);
    const b = snapshot("2026.09.25", [entity(2)], [warning(2)]);
    const c = snapshot("2026.09.26", [entity(2)], [warning(2)]);
    const h = buildFullHistory([a, b, c], options);
    expect(h.named).toEqual([]); expect(h.monthly).toEqual([]);
    expect(h.history.movements.resumptions[0]).toMatchObject({ from: "2026.08.24", to: "2026.09.25", days: 32,
      registry: { totals: { added: 1, removed: 1 } }, warnings: { appeared: 1, removed: 1 } });
    expect(h.observations.map(r => r.registry_status)).toEqual(["baseline", "resumption", "counted"]);
    expect(h.coverage.observed_days).toBe(3);
    expect(h.history.movements).toEqual(buildMovements([a, b], c));
  });

  it("exclut une comparaison anormale pour la seule liste concernée", () => {
    const a = snapshot("2026.10.01", baseline(), []);
    const b = snapshot("2026.10.02", [], [warning(1)]);
    const h = buildFullHistory([a, b], { ...options, includeWithdrawnNames: true });
    expect(h.named).toEqual([]); expect(h.monthly).toEqual([]);
    expect(h.excluded).toHaveLength(1);
    expect(h.excluded[0]).toMatchObject({ list: "registry", movements: 40, limit: 30 });
    expect(h.history.movements.months[0].warnings.appeared).toBe(1);
    const badWarnings = snapshot("2026.10.02", [...baseline(), entity(90)], Array.from({ length: 31 }, (_, n) => warning(n)));
    const other = buildFullHistory([a, badWarnings], options);
    expect(other.named).toHaveLength(1);
    expect(other.excluded[0].list).toBe("warnings");
    expect(other.history.movements.months[0].warnings.appeared).toBe(0);
  });

  it("neutralise les reclassements et GLEIF ; isole les changements du canton FINMA", () => {
    const a = snapshot("2026.10.01", [entity(1, { entity_type: "other", licence_type: "Fintech licence" }), entity(2), entity(3)]);
    const b = snapshot("2026.10.02", [entity(1, { entity_type: "fintech", licence_type: "Fintech licence" }),
      entity(2, { canton: "GE", address: "ADRESSE_INTERDITE", address_source_url: "https://gleif.example/" }), entity(3, { canton: "GE" })]);
    const h = buildFullHistory([a, b], options);
    expect(h.history.movements.months[0].registry.reclassified_by_collection).toBe(1);
    expect(Object.values(h.history.movements.months[0].registry.totals).every(n => n === 0)).toBe(true);
    expect(h.named.map(r => r.kind)).toEqual(["canton_changed"]);
    expect(h.named[0]).toMatchObject({ before: { canton: "VD", canton_source: "FINMA" }, after: { canton: "GE" } });
    expect(JSON.stringify(h)).not.toContain("ADRESSE_INTERDITE");
  });

  it("préserve l'autorisation exacte des changements quand un IDE porte plusieurs autorisations", () => {
    const a = snapshot("2026.10.01", [entity(1), entity(1, { licence_type: "Second licence", city: "Ville secondaire" })]);
    const b = snapshot("2026.10.02", [entity(1), entity(1, { licence_type: "Second licence", city: "Ville modifiée" })]);
    const h = buildFullHistory([a, b], options);
    expect(h.named).toHaveLength(1);
    expect(h.named[0]).toMatchObject({ kind: "city_changed", before: { city: "Ville secondaire", licence_type: "Second licence" }, after: { city: "Ville modifiée" } });
    const ambiguous = snapshot("2026.10.02", [entity(1, { licence_type: "Third licence" }), entity(1, { licence_type: "Fourth licence" })]);
    expect(buildFullHistory([a, ambiguous], options).history.movements.months[0].registry).toMatchObject(compareRegistry(a.entities, ambiguous.entities));
  });

  it("recopie les mois figés et signale les mouvements supplémentaires sans les réécrire", () => {
    const a = snapshot("2026.07.17", []), b = snapshot("2026.07.18", [entity(1)], [warning(1, "2026-07-18")]);
    const c = snapshot("2026.07.23", [entity(1)]), d = snapshot("2026.07.24", [entity(1), entity(2)]);
    const last = snapshot("2026.10.22", [entity(1), entity(2)]);
    const storefront = buildMovements([c, d], last);
    const current = { ...last, quality: { history: { movements: storefront } } };
    const h = buildFullHistory([a, b, c, d, current], options);
    expect(h.history.movements).toEqual(storefront);
    expect(h.reconciliation.find(r => r.month === "2026-07")).toMatchObject({ difference: { added: 1 } });
    expect(h.warningMonthly.find(r => r.month === "2026-07")).toMatchObject({ appeared: 1 });
    expect(h.reconciliation.find(r => r.month === "2026-07")).toMatchObject({ warnings_difference: { appeared: 1 } });
    const next = snapshot("2026.10.23", last.entities);
    const inherited = buildFullHistory([a, b, c, d, current, next], options);
    expect(inherited.history.movements.months.find(r => r.month === "2026-07")).toEqual(storefront.months[0]);
  });

  it("refuse un bloc hérité illisible ou porteur de données nominatives cachées", () => {
    const a = snapshot("2026.10.01", [entity(1)]), b = snapshot("2026.10.02", [entity(1)]);
    expect(() => buildFullHistory([a, { ...b, quality: { history: { movements: {} } } }], options)).toThrow();
    const block = buildMovements([a], b);
    expect(() => buildFullHistory([a, { ...b, quality: { history: { movements: { ...block, identity: "INTERDIT" } } } }], options)).toThrow(/champs non autorisés/);
  });

  it("ne compte ni la référence initiale ni les jours absents, et refuse dates ou versions ambiguës", () => {
    const a = snapshot("2026.07.16", []), b = snapshot("2026.07.17", [entity(1)]);
    const c = snapshot("2026.07.17.2", [entity(1)]), d = snapshot("2026.07.19", [entity(1)]);
    const h = buildFullHistory([d, c, a, b], options);
    expect(h.named).toEqual([]); expect(h.coverage.versions).toBe(3); expect(h.coverage.observed_days).toBe(2);
    expect(h.observations.map(r => r.version)).toEqual([b.version, c.version, d.version]);
    expect(() => buildFullHistory([b, b], options)).toThrow(/double/);
    expect(() => buildFullHistory([snapshot("2026.02.30", [])], options)).toThrow(/Version/);
    expect(() => buildFullHistory([], options)).toThrow(/Aucun relevé/);
    const missing = buildFullHistory([b, { ...d, warnings: undefined }], options);
    expect(missing.observations[1].warnings_status).toBe("unavailable");
    expect(missing.history.movements.months[0].warnings.comparisons).toBe(0);
  });
});

describe("Historique complet : archive et script local", () => {
  it("vérifie chaque fichier et la signature éphémère sans écrire de clé ni appeler le réseau", async () => {
    const keyPair = generateKeyPairSync("ed25519");
    const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const publicRepositoryKey = readFileSync(resolve("packages/schemas/openswissdata.pubkey.ed25519"));
    const h = buildFullHistory([snapshot("2026.10.01", []), snapshot("2026.10.02", [entity(1), entity(2, { name: "NON_AUTORISE_INTERDIT" })], [warning(1)])], { allowedUids: new Set([uid(1)]) });
    const result = await writeFullHistoryArchive(h, dir, { signing: {
      publicKeyPem, privateKeyBase64: keyPair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    } });
    const extract = (name: string) => execFileSync("unzip", ["-p", result.zipPath, name]);
    const manifest = JSON.parse(extract("provenance.json").toString()) as SignedProvenanceManifest;
    const { signature, timestamp_authority, ...unsigned } = manifest;
    expect(verify(null, Buffer.from(canonicalize(unsigned)), publicKeyPem, Buffer.from(signature.signature, "base64"))).toBe(true);
    expect(signature.signed_payload_hash).toBe(sha256OfBuffer(canonicalize(unsigned)));
    expect(timestamp_authority.name).toBe("none");
    expect(manifest.files.map(f => f.name).sort()).toEqual(result.files.filter(f => f !== "provenance.json"));
    for (const f of manifest.files) {
      const bytes = extract(f.name);
      expect(bytes.length).toBe(f.size); expect(sha256OfBuffer(bytes)).toBe(f.sha256);
      expect(bytes.toString()).not.toMatch(/NON_AUTORISE_INTERDIT|ALERTE_INTERDITE|alerte\.example/);
    }
    expect(readFileSync(resolve("packages/schemas/openswissdata.pubkey.ed25519"))).toEqual(publicRepositoryKey);
    expect(readdirSync(dir)).toEqual([`finma-historique-complet-${h.version}.zip`]);
    expect(extract("README.md").toString()).toContain("Ceci n'est pas une publication officielle de la FINMA");
    expect(extract("README.md").toString()).toContain("This is not an official FINMA publication");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("écrit un manifeste non signé même avec une clé dans l'environnement et ne remplace pas une archive", async () => {
    vi.stubEnv("OSD_SIGNING_KEY_ED25519", "NE_PAS_LIRE");
    const h = buildFullHistory([snapshot("2026.10.01", [])], options);
    const result = await writeFullHistoryArchive(h, dir);
    const before = readFileSync(result.zipPath);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", result.zipPath, "provenance.json"], { encoding: "utf8" }));
    expect(manifest.signature).toBeUndefined(); expect(manifest.timestamp_authority).toBeUndefined();
    expect(execFileSync("unzip", ["-p", result.zipPath, "README.md"], { encoding: "utf8" })).toContain("MANIFESTE NON SIGNÉ");
    await expect(writeFullHistoryArchive(h, dir)).rejects.toThrow();
    expect(readFileSync(result.zipPath)).toEqual(before);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lit les ZIP locaux et contrôle leurs empreintes sans modifier les sources", async () => {
    await zipFixture("2026.07.16", []);
    const first = await zipFixture("2026.07.17", [entity(1)]);
    const last = await zipFixture("2026.07.18", [entity(1), entity(2)], [warning(1)]);
    const before = [first, last].map(p => sha256OfBuffer(readFileSync(p)));
    const result = await readLocalHistory(join(dir, "sources"));
    expect(result.inputs).toHaveLength(3); expect(result.snapshots).toHaveLength(2);
    expect([first, last].map(p => sha256OfBuffer(readFileSync(p)))).toEqual(before);
    expect(result.snapshots[1].warnings).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    await zipFixture("2026.07.19", [], [], { "quality.json": "JSON_INVALIDE_INTERDIT" });
    await expect(readLocalHistory(join(dir, "sources"))).rejects.toThrow("JSON historique illisible (contenu non journalisé)");
    await expect(readHistoryZip(Buffer.from("INVALIDE"))).rejects.toThrow(/ZIP/);
  });

  it("refuse les options dangereuses, les sorties publiques et les liens vers les sources", () => {
    expect(parseHistoryArgs(["--archives", "/sources", "--out", "/sortie"])).toEqual({ archives: "/sources", out: "/sortie" });
    expect(() => parseHistoryArgs(["--archives", "/sources", "--out", "/sortie", "--includeWithdrawnNames", "true"])).toThrow();
    expect(() => parseHistoryArgs(["--archives", "/sources", "--out", "/sortie", "--sign", "true"])).toThrow();
    expect(() => parseHistoryArgs(["--archives", "relatif", "--out", "/sortie"])).toThrow();
    expect(() => checkHistoryOutput(join(dir, "source"), resolve("etl/sortie"))).toThrow(/dépôt/);
    expect(() => checkHistoryOutput(join(dir, "source"), join(dir, "source", "sortie"))).toThrow(/recouvrir/);
    expect(() => checkHistoryOutput(join(dir, "source"), resolve("docs/internal/codex-historique-complet/essai"))).not.toThrow();
    mkdirSync(join(dir, "source")); symlinkSync(join(dir, "source"), join(dir, "lien"));
    expect(() => checkHistoryOutput(join(dir, "source"), join(dir, "lien", "sortie"))).toThrow(/recouvrir/);
  });

  it("refuse un membre dont l'empreinte ne correspond plus au contrôle de l'archive", async () => {
    await zipFixture("2026.07.17", [entity(1)], [], {}, true);
    await expect(readLocalHistory(join(dir, "sources"))).rejects.toThrow("Empreinte historique invalide : 2026.07.17");
  });

  it("refuse un fichier de sièges ambigu et ne normalise jamais les IDE", () => {
    const csv = `uid,municipality_bfs_id\n${uid(1)},1\n`;
    expect([...allowedHistoryUids(csv)]).toEqual([uid(1)]);
    expect(() => allowedHistoryUids(csv + `${uid(1)},2\n`)).toThrow(/ambigu/);
    expect(() => allowedHistoryUids(csv.replace(uid(1), "CHE900000001"))).toThrow();
    expect(() => allowedHistoryUids("uid,municipality_bfs_id\n")).toThrow();
  });
});
