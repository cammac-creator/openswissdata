/** Source HTTP → bronze brut daté et immuable, avant toute lecture métier. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// Une réponse vide avec HTTP 200 est réessayée : la FINMA sert au hasard des fichiers vides (relevé du 23.10.2026,
// environ un téléchargement sur trois pour uid.csv et les classeurs ; collecte FINMA du jour en échec). Dix essais
// espacés de 1,5 s laissent moins d'une chance sur mille d'échouer pour un fichier. Un fichier vide n'est jamais écrit.
export const EMPTY_BODY_RETRY = { attempts: 10, delayMs: 1_500 };

export async function fetchBronze(
  url: string, cacheDir: string, filename: string,
  init: RequestInit = {}, maxAgeHours = 12,
  retry: { attempts?: number; delayMs?: number } = {},
): Promise<string> {
  const dir = join(cacheDir, "bronze", new Date().toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  let path = join(dir, filename);
  if (existsSync(path)) {
    if (existsSync(`${path}.meta.json`) && Date.now() - statSync(path).mtimeMs < maxAgeHours * 3_600_000) {
      const meta = JSON.parse(readFileSync(`${path}.meta.json`, "utf8"));
      if (meta.url === url && meta.sha256 === createHash("sha256").update(readFileSync(path)).digest("hex")) return path;
    }
    path = join(dir, `${randomUUID()}-${filename}`);
  }
  const attempts = Math.max(1, retry.attempts ?? EMPTY_BODY_RETRY.attempts);
  const delayMs = retry.delayMs ?? EMPTY_BODY_RETRY.delayMs;
  let response: Response | undefined;
  let bytes = Buffer.alloc(0);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, delayMs));
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Source indisponible : HTTP ${response.status} (${new URL(url).hostname})`);
    if (!response.body) throw new Error("Source sans contenu");
    const parts: Uint8Array[] = []; let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > 20_000_000) throw new Error("Taille de source invalide");
      parts.push(part);
    }
    bytes = Buffer.concat(parts);
    if (bytes.length) break;
  }
  if (!response || !bytes.length) throw new Error("Taille de source invalide");
  writeFileSync(path, bytes, { flag: "wx" });
  writeFileSync(`${path}.meta.json`, JSON.stringify({
    url, fetched_at: new Date().toISOString(), status: response.status,
    last_modified: response.headers.get("last-modified"),
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  }, null, 2), { flag: "wx" });
  return path;
}
