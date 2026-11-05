/**
 * Téléchargement des fichiers de l'OFDF vers un fichier temporaire, sans passer par la mémoire.
 * Étage lu : source. Étage écrit : bronze temporaire du passage, effacé par `collect.ts` dès qu'il est
 * lu (2 Go pour trois ZIP publics, sans personne, que l'OFDF garde en ligne).
 *
 * Les messages ne citent que le code HTTP ou le code d'erreur technique, jamais un contenu.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { safeErrorCode } from "../sanctions/download.js";

export class DouaneDownloadError extends Error {
  constructor(reason: string) {
    super(`Source OFDF : ${reason}`);
    this.name = "DouaneDownloadError";
  }
}

/**
 * Plafonds. Le plus lent mesuré sur un Mac le 05.11.2026 : 140 s pour un ZIP. La somme au pire doit tenir
 * dans `DOUANE_RUN_DEADLINE_MS` (`tests/etl/sources-registry-douane.test.ts` le vérifie).
 */
export const ZIP_ATTEMPT_MS = 600_000;
export const CONCORDANCE_ATTEMPT_MS = 120_000;
export const RETRY_DELAYS_MS: readonly number[] = [60_000];

/** Temps maximal d'un téléchargement, reprises comprises. */
export function worstCaseMs(attemptMs: number, retryDelaysMs: readonly number[] = RETRY_DELAYS_MS): number {
  return attemptMs * (retryDelaysMs.length + 1) + retryDelaysMs.reduce((sum, delay) => sum + delay, 0);
}

/** Une réponse qui ne changera pas en réessayant s'arrête tout de suite. */
class Permanent extends DouaneDownloadError {}

export interface DownloadedFile {
  path: string;
  sha256: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
}

export interface DownloadOptions {
  url: string;
  path: string;
  userAgent: string;
  maxBytes: number;
  /** Temps total d'un essai, corps compris. */
  timeoutMs?: number;
  /** Attente avant chaque reprise : un essai de plus que de valeurs. */
  retryDelaysMs?: readonly number[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(options: DownloadOptions): Promise<DownloadedFile> {
  const res = await (options.fetchImpl ?? fetch)(options.url, {
    headers: { "User-Agent": options.userAgent },
    signal: AbortSignal.timeout(options.timeoutMs ?? ZIP_ATTEMPT_MS),
  });
  if (!res.ok) {
    const reason = `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new DouaneDownloadError(reason);
    throw new Permanent(reason);
  }
  // La source sert `binary/octet-stream` : une page d'erreur se reconnaît à son type.
  if (/html/i.test(res.headers.get("content-type") ?? "")) throw new Permanent("type de contenu inattendu");
  const announced = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(announced) && announced > options.maxBytes) throw new Permanent("fichier trop volumineux");
  if (!res.body) throw new DouaneDownloadError("réponse sans corps");

  const hash = createHash("sha256");
  const out = createWriteStream(options.path);
  let bytes = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > options.maxBytes) throw new Permanent("fichier trop volumineux");
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
    }
  } finally {
    out.end();
    await finished(out).catch(() => undefined);
  }
  if (announced > 0 && bytes !== announced) throw new DouaneDownloadError("fichier tronqué");
  return {
    path: options.path,
    sha256: hash.digest("hex"),
    bytes,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

export async function downloadToFile(options: DownloadOptions): Promise<DownloadedFile> {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((message: string) => console.log(message));
  let last = "aucun essai";
  for (let tryNumber = 0; tryNumber <= delays.length; tryNumber++) {
    if (tryNumber > 0) await sleep(delays[tryNumber - 1]);
    try {
      return await attempt(options);
    } catch (err) {
      if (err instanceof Permanent) throw err;
      last = err instanceof DouaneDownloadError
        ? err.message.replace("Source OFDF : ", "")
        : `${err instanceof Error ? err.name : "Error"}${safeErrorCode(err) ? ` ${safeErrorCode(err)}` : ""}`;
      log(`téléchargement, essai ${tryNumber + 1} sur ${delays.length + 1} : ${last}`);
    }
  }
  throw new DouaneDownloadError(`échec après ${delays.length + 1} essais (${last})`);
}
