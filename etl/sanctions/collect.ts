/**
 * Collecte de la liste des sanctions du SECO (SESAM) : organisations et bateaux seulement.
 *
 * Étage lu : source (fichier XML officiel, en mémoire : il contient des personnes physiques et
 * n'est écrit nulle part, ni bronze brut, ni artefact). Étage écrit : argent et or réduits dans le
 * bucket R2 PRIVÉ, avec la taille et l'empreinte du fichier entier (écart à la règle « bronze
 * d'abord », même motif que FOSC et que l'exception Kranli de `DONNEES-ETAGES.md`).
 *
 * Usage :
 *   npm run sync:sanctions                    simulation : lit la source, n'écrit rien, affiche des nombres
 *   npm run sync:sanctions -- --out <dossier> simulation, écrit le document réduit dans ce dossier
 *   npm run sync:sanctions -- --from-file <x> simulation sur un fichier déjà téléchargé
 *   npm run sync:sanctions -- --write-r2      passage réel (workflow `refresh-sanctions.yml`)
 *   … --accept-drop                           adopte une baisse de volume après examen
 *
 * Le journal n'affiche que des nombres, des dates et l'empreinte : jamais un nom.
 * Code de sortie 1 : arrêt sur un contrôle ou une panne ; rien n'est écrit, la version servie reste.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getObjectBuffer, putObjectBytes } from "../../src/lib/r2.js";
import { decodeSanctionsObject, SANCTIONS_R2_KEY, type SanctionsDocument } from "../../src/lib/sanctions.js";
import { buildSanctionsDocument, checkSanctionsDocument } from "./build.js";
import { MAX_XML_CHARS, parseSesamXml } from "./parse.js";
import { SESAM_XML_URL } from "./sources.js";

const FETCH_TIMEOUT_MS = 180_000;
const USER_AGENT = "OpenSwissData-collecte-sanctions/1";

export const datedR2Key = (listDate: string) => `sanctions/argent/${listDate}-v1.json.gz`;

async function downloadSource(): Promise<Buffer> {
  const res = await fetch(SESAM_XML_URL, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Source SESAM : HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/xml/i.test(type)) throw new Error("Source SESAM : type de contenu inattendu");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_XML_CHARS) throw new Error("Source SESAM : fichier trop volumineux");
  return bytes;
}

/** `null` seulement quand l'objet n'existe pas encore : toute autre panne arrête le passage. */
async function readPreviousCounts(): Promise<SanctionsDocument["counts"] | null> {
  try {
    return decodeSanctionsObject(await getObjectBuffer(SANCTIONS_R2_KEY, { maxBytes: 30_000_000 })).counts;
  } catch (err) {
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) return null;
    throw new Error("Version précédente illisible : passage arrêté");
  }
}

interface Args { writeR2: boolean; out: string | null; fromFile: string | null; acceptDrop: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { writeR2: false, out: null, fromFile: null, acceptDrop: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write-r2") args.writeR2 = true;
    else if (argv[i] === "--accept-drop") args.acceptDrop = true;
    else if (argv[i] === "--out") args.out = argv[++i] ?? null;
    else if (argv[i] === "--from-file") args.fromFile = argv[++i] ?? null;
    else throw new Error("Argument inconnu");
  }
  if (args.writeR2 && args.fromFile) throw new Error("--write-r2 lit toujours la source officielle, jamais un fichier local");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bytes = args.fromFile ? readFileSync(args.fromFile) : await downloadSource();
  const now = Date.now();
  const parsed = parseSesamXml(bytes.toString("utf8"));
  const doc = buildSanctionsDocument(parsed, {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    collectedAt: new Date(now).toISOString(),
  });
  const previous = args.writeR2 ? await readPreviousCounts() : null;
  checkSanctionsDocument(doc, { now, previous, acceptDrop: args.acceptDrop });

  const gzipped = gzipSync(Buffer.from(JSON.stringify(doc), "utf8"));
  // Nombres, dates et empreinte seulement.
  console.log(JSON.stringify({
    mode: args.writeR2 ? "réel" : "simulation",
    list_date: doc.list_date,
    source_sha256: doc.source_sha256,
    source_bytes: doc.source_bytes,
    counts: doc.counts,
    previous_counts: previous,
    vessels_without_imo: doc.vessels_without_imo,
    exclusion_proof: doc.exclusion_proof,
    document_gzip_bytes: gzipped.length,
  }, null, 1));

  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, "sanctions-v1.json"), JSON.stringify(doc));
  }
  if (args.writeR2) {
    // L'argent daté d'abord : si la seconde écriture échoue, la version servie reste entière.
    await putObjectBytes(datedR2Key(doc.list_date), gzipped, "application/gzip");
    await putObjectBytes(SANCTIONS_R2_KEY, gzipped, "application/gzip");
    console.log("écrit dans R2 : sanctions/argent et sanctions/or");
  }
}

main().catch((err: unknown) => {
  // Nos erreurs ont un message fixe ; une autre pourrait citer un extrait du contenu.
  const known = err instanceof Error && (err.name === "SesamXmlError" || err.name === "SanctionsControlError" || err.message.startsWith("Source SESAM") || err.message.startsWith("Version précédente") || err.message.startsWith("Argument") || err.message.startsWith("--write-r2"));
  console.error(known ? (err as Error).message : `Échec de la collecte des sanctions (${err instanceof Error ? err.name : "Error"})`);
  process.exit(1);
});
