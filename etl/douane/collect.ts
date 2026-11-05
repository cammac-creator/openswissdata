/**
 * Collecte du commerce extérieur de l'OFDF (décision de Claude-Alain du 05.11.2026, `SOURCES.md`).
 *
 * Étages : source (trois ZIP et une table de l'OFDF) → bronze temporaire (fichiers du passage, effacés
 * après lecture : 2 Go de données publiques que l'OFDF garde en ligne, écart voulu à la règle du bronze
 * daté) → or réduit dans le bucket R2 PRIVÉ, un seul objet réécrit. Rien dans le dépôt, aucun artefact.
 *
 * Usage :
 *   npm run sync:douane                      simulation : télécharge, lit, contrôle, n'envoie rien
 *   npm run sync:douane -- --out <dossier>   simulation, garde le document réduit dans ce dossier
 *   npm run sync:douane -- --from-dir <x>    simulation sur des fichiers déjà téléchargés
 *   npm run sync:douane -- --write-r2        passage réel (workflow `refresh-douane.yml`)
 *   … --accept-anomaly                       adopte, après examen, une baisse, une année close qui bouge ou une source figée
 *
 * Le journal n'affiche que des nombres, des dates et des empreintes. Code de sortie 1 : arrêt sur un
 * contrôle ou une panne ; rien n'est envoyé, la version précédente reste.
 */
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getObjectBuffer, putObjectBytes } from "../../src/lib/r2.js";
import { DouaneAggregator, readZipInto, type FileLedger } from "./aggregate.js";
import {
  buildMeta,
  checkDocument,
  journalSummary,
  MAX_DOCUMENT_GZIP_BYTES,
  parseConcordance,
  readMetaFromGzip,
  verifyDocument,
  writeDocument,
  type DouaneMeta,
  type DouaneSourceProof,
} from "./build.js";
import { CONCORDANCE_ATTEMPT_MS, downloadToFile, ZIP_ATTEMPT_MS, type DownloadedFile } from "./download.js";
import { DOUANE_CONCORDANCE_SOURCE, DOUANE_PREVIOUS_READ_MS, DOUANE_R2_KEY, DOUANE_RUN_DEADLINE_MS, DOUANE_USER_AGENT, DOUANE_ZIP_SOURCES, type DouaneFileKind, type DouaneSource } from "./sources.js";

const MAX_ZIP_BYTES = 2_000_000_000;
const MAX_CONCORDANCE_BYTES = 20_000_000;
const KINDS: DouaneFileKind[] = ["duties", "imports", "exports"];

interface Args { writeR2: boolean; out: string | null; fromDir: string | null; acceptAnomaly: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { writeR2: false, out: null, fromDir: null, acceptAnomaly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write-r2") args.writeR2 = true;
    else if (argv[i] === "--accept-anomaly") args.acceptAnomaly = true;
    else if (argv[i] === "--out") args.out = argv[++i] ?? null;
    else if (argv[i] === "--from-dir") args.fromDir = argv[++i] ?? null;
    else throw new Error("Argument inconnu");
  }
  if (args.writeR2 && args.fromDir) throw new Error("--write-r2 lit toujours la source officielle, jamais un fichier local");
  return args;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function fetchSource(source: DouaneSource, args: Args, workDir: string, maxBytes: number, timeoutMs: number): Promise<DownloadedFile> {
  if (args.fromDir) {
    const path = join(args.fromDir, source.fileName);
    return { path, sha256: await hashFile(path), bytes: statSync(path).size, etag: null, lastModified: null };
  }
  return downloadToFile({ url: source.url, path: join(workDir, source.fileName), userAgent: DOUANE_USER_AGENT, maxBytes, timeoutMs });
}

/** `null` seulement quand l'objet n'existe pas encore : toute autre panne arrête le passage. */
async function readPrevious(): Promise<DouaneMeta | null> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBuffer(DOUANE_R2_KEY, { maxBytes: MAX_DOCUMENT_GZIP_BYTES, timeoutMs: DOUANE_PREVIOUS_READ_MS });
  } catch (err) {
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) return null;
    throw new Error("Version précédente illisible : passage arrêté");
  }
  const meta = await readMetaFromGzip(bytes);
  if (!meta) throw new Error("Version précédente illisible : passage arrêté");
  return meta;
}

function proof(source: DouaneSource, kind: DouaneSourceProof["kind"], file: DownloadedFile, updatedAt: string): DouaneSourceProof {
  return {
    id: source.id,
    kind,
    url: source.url,
    dataset_url: source.datasetUrl,
    licence: "terms_by_ask",
    sha256: file.sha256,
    bytes: file.bytes,
    etag: file.etag,
    last_modified: file.lastModified,
    updated_at: updatedAt,
  };
}

let stage = "démarrage";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    stage = name;
    const from = Date.now();
    const result = await run();
    timings[name] = Math.round((Date.now() - from) / 1000);
    return result;
  };

  const workDir = mkdtempSync(join(tmpdir(), "osd-douane-"));
  // Un échec, pas une annulation : c'est ce qui fait partir l'alerte du workflow.
  const deadline = setTimeout(() => {
    console.error(`Collecte de la douane arrêtée (délai dépassé, étape ${stage})`);
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }, DOUANE_RUN_DEADLINE_MS);
  try {
    // La version précédente d'abord : inutile de lire 30 Go si elle est illisible.
    const previous = args.writeR2 ? await step("version précédente", readPrevious) : null;

    const aggregator = new DouaneAggregator();
    const ledgers = {} as Record<DouaneFileKind, FileLedger>;
    const proofs: DouaneSourceProof[] = [];
    for (const kind of KINDS) {
      const source = DOUANE_ZIP_SOURCES[kind];
      const file = await step(`téléchargement ${kind}`, () => fetchSource(source, args, workDir, MAX_ZIP_BYTES, ZIP_ATTEMPT_MS));
      ledgers[kind] = await step(`lecture ${kind}`, () => readZipInto(kind, file.path, aggregator));
      proofs.push(proof(source, kind, file, ledgers[kind].updated_at[0] ?? ""));
      // Le disque d'un exécuteur n'a pas à garder les trois en même temps.
      if (!args.fromDir) rmSync(file.path, { force: true });
    }

    const concordanceFile = await step("téléchargement concordance", () => fetchSource(DOUANE_CONCORDANCE_SOURCE, args, workDir, MAX_CONCORDANCE_BYTES, CONCORDANCE_ATTEMPT_MS));
    const concordance = parseConcordance(readFileSync(concordanceFile.path, "utf8"));
    proofs.push(proof(DOUANE_CONCORDANCE_SOURCE, "concordance", concordanceFile, concordance.updatedAt));

    stage = "contrôles";
    const now = Date.now();
    const meta = buildMeta({ aggregator, ledgers, sources: proofs, concordance: concordance.rows, collectedAt: new Date(now).toISOString() });
    checkDocument(meta, { duties: ledgers.duties.updated_at, imports: ledgers.imports.updated_at, exports: ledgers.exports.updated_at }, { now, previous, acceptAnomaly: args.acceptAnomaly });

    const documentPath = join(workDir, "douane-v1.txt.gz");
    const sizes = await step("écriture du document", () => writeDocument(meta, aggregator, documentPath));
    if (sizes.gzip_bytes > MAX_DOCUMENT_GZIP_BYTES) throw new Error("Document trop volumineux : passage arrêté");
    await step("relecture du document", () => verifyDocument(documentPath, meta));

    // Le journal est public : `journalSummary` n'y laisse aucun montant lu dans la source.
    console.log(JSON.stringify(journalSummary(meta, {
      mode: args.writeR2 ? "réel" : "simulation",
      document: sizes,
      secondsByStep: timings,
      secondsTotal: Math.round((Date.now() - started) / 1000),
      maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    }), null, 1));

    if (args.out) {
      mkdirSync(args.out, { recursive: true });
      copyFileSync(documentPath, join(args.out, "douane-v1.txt.gz"));
    }
    if (args.writeR2) {
      stage = "écriture R2";
      await putObjectBytes(DOUANE_R2_KEY, readFileSync(documentPath), "application/gzip");
      console.log("écrit dans R2 : douane/or");
    }
  } finally {
    clearTimeout(deadline);
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // Nos erreurs ont un message fixe ; une autre pourrait citer un extrait du contenu.
  const known = err instanceof Error && (err.name === "DouaneFormatError" || err.name === "DouaneControlError" || err.name === "DouaneDownloadError" || err.message.startsWith("Version précédente") || err.message.startsWith("Argument") || err.message.startsWith("--write-r2") || err.message.startsWith("Document trop"));
  console.error(known ? (err as Error).message : `Échec de la collecte de la douane, étape ${stage} (${err instanceof Error ? err.name : "Error"})`);
  process.exit(1);
});
