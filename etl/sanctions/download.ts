/**
 * Téléchargement du fichier SESAM, avec reprises. Étage lu : source ; étage écrit : rien (octets en
 * mémoire). Le premier passage planifié (05.11.2026, 01:03 UTC) a échoué sur une erreur réseau qu'un
 * essai du même fichier, trois minutes plus tard, n'a pas reproduite.
 *
 * Les messages ne citent que le code HTTP ou le code d'erreur technique, jamais un contenu.
 */
export class SesamDownloadError extends Error {
  constructor(reason: string) {
    super(`Source SESAM : ${reason}`);
    this.name = "SesamDownloadError";
  }
}

const SAFE_CODE = /^[A-Z0-9_]{1,40}$/;

/** Code technique d'une erreur (`ECONNRESET`, `UND_ERR_SOCKET`), s'il en porte un : le nom seul ne dit rien. */
export function safeErrorCode(err: unknown): string | null {
  const candidates = [(err as { cause?: { code?: unknown } })?.cause?.code, (err as { code?: unknown })?.code];
  for (const code of candidates) if (typeof code === "string" && SAFE_CODE.test(code)) return code;
  return null;
}

export interface DownloadOptions {
  url: string;
  userAgent: string;
  maxBytes: number;
  timeoutMs?: number;
  /** Attente avant chaque reprise : un essai de plus que de valeurs. */
  retryDelaysMs?: readonly number[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Une réponse qui ne changera pas en réessayant s'arrête tout de suite. */
class Permanent extends SesamDownloadError {}

async function attempt(options: DownloadOptions): Promise<Buffer> {
  const res = await (options.fetchImpl ?? fetch)(options.url, {
    headers: { "User-Agent": options.userAgent },
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  });
  if (!res.ok) {
    const reason = `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new SesamDownloadError(reason);
    throw new Permanent(reason);
  }
  if (!/xml/i.test(res.headers.get("content-type") ?? "")) throw new Permanent("type de contenu inattendu");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > options.maxBytes) throw new Permanent("fichier trop volumineux");
  return bytes;
}

export async function downloadWithRetries(options: DownloadOptions): Promise<Buffer> {
  const delays = options.retryDelaysMs ?? [30_000, 120_000];
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((message: string) => console.log(message));
  let last = "aucun essai";
  for (let tryNumber = 0; tryNumber <= delays.length; tryNumber++) {
    if (tryNumber > 0) await sleep(delays[tryNumber - 1]);
    try {
      return await attempt(options);
    } catch (err) {
      if (err instanceof Permanent) throw err;
      last = err instanceof SesamDownloadError
        ? err.message.replace("Source SESAM : ", "")
        : `${err instanceof Error ? err.name : "Error"}${safeErrorCode(err) ? ` ${safeErrorCode(err)}` : ""}`;
      log(`téléchargement, essai ${tryNumber + 1} sur ${delays.length + 1} : ${last}`);
    }
  }
  throw new SesamDownloadError(`échec après ${delays.length + 1} essais (${last})`);
}
