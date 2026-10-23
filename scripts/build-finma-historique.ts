#!/usr/bin/env tsx
/** Construction locale seulement : pas de réseau, de clé, de signature ni de publication. */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
import {
  buildFullHistory, HISTORY_START, validateHistorySnapshot, writeFullHistoryArchive,
} from "../etl/finma/historique-complet.js";
import { sha256OfBuffer } from "../etl/shared/provenance.js";
import type { MovementsSnapshot } from "../etl/finma/movements.js";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEATS = join(REPOSITORY, "src/mcp/data/finma_seats.csv");
const VERSION = /^\d{4}\.\d{2}\.\d{2}(\.[0-9A-Za-z]+)?$/;
const MEMBERS = new Set(["finma_registry.json", "finma_warnings.json", "quality.json", "checksums.sha256"]);

export function parseHistoryArgs(argv: string[]): { archives: string; out: string } {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!["--archives", "--out"].includes(key) || key in result || !value || !isAbsolute(value)) {
      throw new Error("Arguments attendus : --archives <chemin absolu> --out <chemin absolu> ; aucune option de signature ou de retrait nommé");
    }
    result[key] = value;
  }
  if (!result["--archives"] || !result["--out"]) throw new Error("--archives et --out sont obligatoires");
  return { archives: result["--archives"], out: result["--out"] };
}

function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(physicalPath(dirname(path)), path.slice(dirname(path).length + 1));
}
const within = (path: string, parent: string) => {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

export function checkHistoryOutput(archives: string, out: string): void {
  const input = physicalPath(resolve(archives)), output = physicalPath(resolve(out));
  const repository = realpathSync(REPOSITORY);
  if (within(output, input) || within(input, output)) throw new Error("Le dossier de sortie ne doit pas recouvrir les archives sources");
  // Exception privée expressément demandée pour l'essai ; aucun autre chemin du dépôt.
  const privateTrial = join(repository, "docs/internal/codex-historique-complet");
  if (within(output, repository) && !within(output, privateTrial)) {
    throw new Error("Sortie interdite dans le dépôt, hors du dossier privé de cet essai");
  }
}

/** Lit seulement les membres utiles en mémoire ; aucune extraction de ligne brute sur disque. */
export function readHistoryZip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(new Error("Archive ZIP illisible")); return; }
      const found = new Map<string, Buffer>();
      const fail = () => { zip.close(); reject(new Error("Archive ZIP illisible, ambiguë ou trop volumineuse")); };
      zip.on("error", fail);
      zip.on("end", () => resolve(found));
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!MEMBERS.has(entry.fileName)) { zip.readEntry(); return; }
        if (found.has(entry.fileName) || entry.uncompressedSize > 30_000_000) { fail(); return; }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) { fail(); return; }
          const chunks: Buffer[] = [];
          let length = 0;
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 30_000_000) { stream.destroy(); fail(); return; }
            chunks.push(chunk);
          });
          stream.on("end", () => { found.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

function jsonMember(files: Map<string, Buffer>, name: string): unknown {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("JSON historique illisible (contenu non journalisé)"); }
}

export async function readLocalHistory(archives: string) {
  const versions = readdirSync(archives, { withFileTypes: true })
    .filter(d => d.isDirectory() && VERSION.test(d.name)).map(d => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error("Aucune archive FINMA locale trouvée");
  const snapshots: MovementsSnapshot[] = [];
  const inputs: { version: string; size_bytes: number; sha256: string }[] = [];
  for (const version of versions) {
    const path = join(archives, version, "finma.zip");
    if (statSync(path).size > 20_000_000) throw new Error(`Archive trop volumineuse : ${version}`);
    const bytes = readFileSync(path);
    const files = await readHistoryZip(bytes);
    const checksums = files.get("checksums.sha256")?.toString("utf8");
    if (!checksums || !files.has("finma_registry.json")) throw new Error(`Archive incomplète : ${version}`);
    for (const [name, content] of files) {
      if (name === "checksums.sha256") continue;
      const lines = checksums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line))
        .filter(match => match?.[2] === name);
      if (lines.length !== 1 || lines[0]![1] !== sha256OfBuffer(content)) throw new Error(`Empreinte historique invalide : ${version}`);
    }
    // Toutes les archives sont lues et contrôlées ; seules celles de la période promise sont retenues.
    const entities = jsonMember(files, "finma_registry.json");
    const warnings = jsonMember(files, "finma_warnings.json");
    const quality = jsonMember(files, "quality.json");
    if (version.slice(0, 10).replaceAll(".", "-") >= HISTORY_START) {
      snapshots.push(validateHistorySnapshot({ version, entities, warnings, quality } as MovementsSnapshot));
    }
    inputs.push({ version, size_bytes: bytes.length, sha256: sha256OfBuffer(bytes) });
  }
  return { snapshots, inputs };
}

/** Le CSV ne porte que l'IDE et la commune ; il est déjà filtré par forme juridique en amont. */
export function allowedHistoryUids(csv: string): Set<string> {
  let rows: Record<string, string>[];
  try { rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[]; }
  catch { throw new Error("Fichier de sièges illisible (contenu non journalisé)"); }
  if (!rows.length || rows.some(r => Object.keys(r).sort().join(",") !== "municipality_bfs_id,uid"
    || !/^CHE-\d{3}\.\d{3}\.\d{3}$/.test(r.uid) || !/^\d+$/.test(r.municipality_bfs_id))
    || new Set(rows.map(r => r.uid)).size !== rows.length) {
    throw new Error("Fichier de sièges incomplet ou ambigu");
  }
  return new Set(rows.map(r => r.uid));
}

export async function buildLocalHistory(archives: string, out: string) {
  checkHistoryOutput(archives, out);
  const { snapshots, inputs } = await readLocalHistory(archives);
  const seats = readFileSync(SEATS);
  const history = buildFullHistory(snapshots, { allowedUids: allowedHistoryUids(seats.toString("utf8")) });
  // Aucun paramètre de signature ou de retrait nommé : même une variable d'environnement ne l'active pas.
  const archive = await writeFullHistoryArchive(history, out, { inputs, seatsSha256: sha256OfBuffer(seats) });
  const totalsOnly = history.monthly.reduce((n, r) => n + r.totals_only, 0);
  return {
    versions_read: inputs.length, versions_outside_period: inputs.length - snapshots.length,
    coverage: history.coverage, named_movements: history.named.length, totals_only_movements: totalsOnly,
    withdrawals_in_totals: history.monthly.filter(r => r.kind === "removed").reduce((n, r) => n + r.total, 0),
    full_months: [...new Set(history.observations.filter(r => r.registry_status === "counted").map(r => r.observed_at.slice(0, 7)))].map(month => ({
      month, total: history.monthly.filter(r => r.month === month).reduce((n, r) => n + r.total, 0),
      named: history.monthly.filter(r => r.month === month).reduce((n, r) => n + r.named, 0),
      totals_only: history.monthly.filter(r => r.month === month).reduce((n, r) => n + r.totals_only, 0),
      withdrawals: history.monthly.filter(r => r.month === month && r.kind === "removed").reduce((n, r) => n + r.total, 0),
    })),
    full_warning_months: history.warningMonthly,
    storefront_months: history.history.movements.months.map(m => ({
      month: m.month, registry: m.registry.totals, warnings: m.warnings,
    })),
    reconciliation: history.reconciliation,
    resumptions: history.history.movements.resumptions,
    excluded_comparisons: history.excluded.length,
    archive,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  Promise.resolve().then(() => {
    const args = parseHistoryArgs(process.argv.slice(2));
    return buildLocalHistory(args.archives, args.out);
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    // Les erreurs de bibliothèques peuvent inclure un fragment de données : ne pas les journaliser.
    console.error("Construction historique impossible : contrôler les chemins, les empreintes et le schéma des archives. Aucune publication effectuée.");
    process.exitCode = 1;
  });
}
