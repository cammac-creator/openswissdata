/** Archives or publiées → bronze ZIP vérifié → historique argent daté. */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getObjectBuffer } from "../../src/lib/r2.js";
import { extractCsvFromZip } from "../../src/mcp/r2-refresh.js";
import { computeDelta, type DeltaChange } from "./delta.js";
import type { FinmaEntity } from "./types.js";

export interface PublishedVersion {
  version: string; r2_key: string; sha256: string; size_bytes: number; released_at: number;
}
export interface FinmaSnapshot { version: string; entities: FinmaEntity[] }
export function versionDate(version: string) { return `${version.slice(0, 4)}-${version.slice(5, 7)}-${version.slice(8, 10)}`; }

export async function readPublishedSnapshots(versions: PublishedVersion[], cacheDir: string): Promise<FinmaSnapshot[]> {
  const dir = join(cacheDir, "bronze", new Date().toISOString().slice(0, 10), "historique");
  mkdirSync(dir, { recursive: true });
  const snapshots: FinmaSnapshot[] = [];
  for (const version of versions) {
    if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version.version)) throw new Error("Version historique invalide");
    const path = join(dir, `finma-${version.version}.zip`);
    if (!existsSync(path)) writeFileSync(path, await getObjectBuffer(version.r2_key, { maxBytes: 20_000_000 }), { flag: "wx" });
    const bytes = readFileSync(path);
    if (bytes.length !== version.size_bytes || createHash("sha256").update(bytes).digest("hex") !== version.sha256) {
      throw new Error(`Archive historique altérée : ${version.version}`);
    }
    const entities = JSON.parse(await extractCsvFromZip(bytes, "finma_registry.json")) as FinmaEntity[];
    if (!Array.isArray(entities) || entities.length < 2_000) throw new Error(`Archive historique incomplète : ${version.version}`);
    snapshots.push({ version: version.version, entities });
  }
  return snapshots;
}

export function buildHistory(snapshots: FinmaSnapshot[], current: FinmaSnapshot) {
  const ordered = [...snapshots.filter(s => s.version !== current.version), current].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  const cutoff = Date.parse(versionDate(current.version)) - 90 * 86_400_000;
  const changes: DeltaChange[] = [];
  const gaps: { from: string; to: string; days: number }[] = [];
  // Comparer uniquement les champs FINMA : ajouter GLEIF n'est pas un changement d'autorisation.
  const sourceRows = (rows: FinmaEntity[]) => rows.map(row => ({ ...row, address: row.address_source_url ? undefined : row.address }));
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1], after = ordered[i];
    const observed = versionDate(after.version);
    if (Date.parse(observed) < cutoff) continue;
    const days = (Date.parse(observed) - Date.parse(versionDate(before.version))) / 86_400_000;
    if (days > 2) gaps.push({ from: before.version, to: after.version, days });
    changes.push(...computeDelta(sourceRows(before.entities), sourceRows(after.entities)).changes.map(change => ({
      ...change, observed_at: observed, previous_version: before.version, version: after.version,
    })));
  }
  return { changes, coverage: {
    available_from: ordered.length > 1 ? versionDate(ordered[0].version) : null,
    available_until: versionDate(current.version), snapshots: ordered.length, gaps,
    interpretation: "Changements observés entre deux versions ; la date exacte du changement à la source peut être antérieure. Une autorisation retirée du fichier n'est pas une décision de sanction.",
  } };
}
