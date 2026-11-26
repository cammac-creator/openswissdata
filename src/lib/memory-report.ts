/**
 * Relevé de la mémoire du service (26.11.2026) : des nombres seulement, pour savoir ce que l'hébergeur
 * compte (mémoire des processus, fichiers gardés en cache par le noyau, taille de la base). Aucun chemin,
 * aucune variable d'environnement, aucun nom de fichier fourni par un appelant.
 *
 * Le noyau garde en cache les pages des fichiers lus (base SQLite, modèles) tant que rien ne le presse :
 * elles comptent dans la mémoire du conteneur sans appartenir à aucun processus. `cgroup.file` les montre,
 * `cgroup.anon` montre la mémoire réellement tenue par les processus.
 */
import { readFileSync, statSync } from "node:fs";

/** Clés de `memory.stat` (cgroup v2) rendues telles quelles ; les autres ne sortent pas. */
const STAT_KEYS = ["anon", "file", "kernel", "shmem", "file_mapped", "active_file", "inactive_file", "slab"] as const;
type StatKey = (typeof STAT_KEYS)[number];

export interface CgroupMemory {
  current_bytes: number | null;
  max_bytes: number | null;
  stat: Partial<Record<StatKey, number>>;
}

function readNumber(path: string): number | null {
  try {
    const value = Number(readFileSync(path, "utf8").trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** Lit `memory.stat` : lignes « clé valeur », seules les clés de `STAT_KEYS` sont gardées. */
export function parseMemoryStat(raw: string): Partial<Record<StatKey, number>> {
  const wanted = new Set<string>(STAT_KEYS);
  const stat: Partial<Record<StatKey, number>> = {};
  for (const line of raw.split("\n")) {
    const [key, text] = line.trim().split(/\s+/);
    if (!key || !wanted.has(key)) continue;
    const value = Number(text);
    if (Number.isSafeInteger(value) && value >= 0) stat[key as StatKey] = value;
  }
  return stat;
}

/** Compteurs du conteneur ; `null` et objet vide hors de Linux ou sans cgroup v2 (poste de développement). */
export function readCgroupMemory(dir = "/sys/fs/cgroup"): CgroupMemory {
  let stat: Partial<Record<StatKey, number>> = {};
  try {
    stat = parseMemoryStat(readFileSync(`${dir}/memory.stat`, "utf8"));
  } catch {
    // Pas de cgroup v2 lisible : le relevé garde la mémoire du processus et la taille des fichiers.
  }
  return { current_bytes: readNumber(`${dir}/memory.current`), max_bytes: readNumber(`${dir}/memory.max`), stat };
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export interface MemoryReport {
  measured_at: string;
  uptime_seconds: number;
  process: { rss_bytes: number; heap_total_bytes: number; heap_used_bytes: number; external_bytes: number; array_buffers_bytes: number };
  cgroup: CgroupMemory;
  database: { file_bytes: number | null; wal_bytes: number | null };
  search_model_running: boolean;
}

export function memoryReport(input: { databasePath: string; searchModelRunning: boolean; cgroupDir?: string; now?: Date }): MemoryReport {
  const usage = process.memoryUsage();
  const inMemory = input.databasePath === ":memory:";
  return {
    measured_at: (input.now ?? new Date()).toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    process: {
      rss_bytes: usage.rss,
      heap_total_bytes: usage.heapTotal,
      heap_used_bytes: usage.heapUsed,
      external_bytes: usage.external,
      array_buffers_bytes: usage.arrayBuffers,
    },
    cgroup: readCgroupMemory(input.cgroupDir),
    database: {
      file_bytes: inMemory ? null : fileSize(input.databasePath),
      wal_bytes: inMemory ? null : fileSize(`${input.databasePath}-wal`),
    },
    search_model_running: input.searchModelRunning,
  };
}
