/** Archive or dans R2 → bronze de traitement daté sur le volume, avant lecture du contenu. */
import { mkdir, readdir, stat, unlink, rmdir, writeFile, readFile, statfs } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getObjectBuffer } from "./r2.js";

export async function readTaresArchive(info: { r2_key: string; sha256: string; size_bytes: number }): Promise<Buffer> {
  if (!/^tares\/[\d.]+\/tares\.zip$/.test(info.r2_key) || !/^[a-f0-9]{64}$/.test(info.sha256) || info.size_bytes <= 0 || info.size_bytes > 100_000_000) throw new Error("Métadonnées TARES invalides");
  const root = join(dirname(resolve(process.env.DATABASE_PATH ?? "./data/openswissdata.db")), "bronze", "tares");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const today = new Date().toISOString().slice(0, 10), cutoff = Date.now() - 30 * 86_400_000;
  let used = 0;
  for (const day of await readdir(root, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    const folder = join(root, day.name);
    for (const file of await readdir(folder, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9]{64}\.zip$/.test(file.name)) continue;
      const path = join(folder, file.name);
      if (Date.parse(day.name) < cutoff) await unlink(path).catch(e => { if (e.code !== "ENOENT") throw e; });
      else used += (await stat(path)).size;
    }
    if (Date.parse(day.name) < cutoff) await rmdir(folder).catch(e => { if (!["ENOENT", "ENOTEMPTY"].includes(e.code)) throw e; });
  }
  const folder = join(root, today); await mkdir(folder, { recursive: true, mode: 0o700 });
  const expectedPath = join(folder, info.sha256 + ".zip");
  try {
    const bytes = await readFile(expectedPath);
    if (bytes.length !== info.size_bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256) throw new Error("Bronze TARES altéré");
    return bytes;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const space = await statfs(root);
  if (used + info.size_bytes > 200_000_000 || space.bavail * space.bsize < info.size_bytes + 300_000_000) throw new Error("Espace bronze TARES insuffisant");
  const bytes = await getObjectBuffer(info.r2_key, { maxBytes: Math.min(100_000_000, info.size_bytes + 1_000_000) });
  const actual = createHash("sha256").update(bytes).digest("hex");
  try { await writeFile(join(folder, actual + ".zip"), bytes, { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  if (bytes.length !== info.size_bytes || actual !== info.sha256) throw new Error("Empreinte TARES invalide");
  return bytes;
}
