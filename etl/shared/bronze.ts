/** Source HTTP → bronze brut daté et immuable, avant toute lecture métier. */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export async function fetchBronze(
  url: string, cacheDir: string, filename: string,
  init: RequestInit = {}, maxAgeHours = 12,
): Promise<string> {
  const dir = join(cacheDir, "bronze", new Date().toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  let path = join(dir, filename);
  if (existsSync(path)) {
    if (Date.now() - statSync(path).mtimeMs < maxAgeHours * 3_600_000) return path;
    path = join(dir, `${Date.now()}-${filename}`);
  }
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Source indisponible : HTTP ${response.status} (${new URL(url).hostname})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20_000_000) throw new Error("Taille de source invalide");
  writeFileSync(path, bytes, { flag: "wx" });
  writeFileSync(`${path}.meta.json`, JSON.stringify({
    url, fetched_at: new Date().toISOString(), status: response.status,
    last_modified: response.headers.get("last-modified"),
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  }, null, 2), { flag: "wx" });
  return path;
}
