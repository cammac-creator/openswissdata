/**
 * Rend au noyau le cache des gros fichiers lus par le service (26.11.2026).
 *
 * Mesuré en production le 26.11.2026 avec `/api/admin/memoire` : le conteneur comptait 282 Mo, dont
 * 224 Mo tenus par les processus ; une seule lecture complète de la base (938 Mo) l'a porté à 1 192 Mo,
 * les processus restant à 225 Mo. Le noyau garde en cache les pages des fichiers lus tant que rien ne le
 * presse, et l'hébergeur les compte dans la mémoire facturée. La sauvegarde quotidienne, le nettoyage et
 * les statistiques relisent la base ; les modèles de recherche et de traduction pèsent 1 Go sur disque.
 *
 * Remède : quand ce cache dépasse un seuil, demander au noyau de l'oublier, fichier par fichier
 * (`dd if=<fichier> iflag=nocache count=0`, qui ne lit ni n'écrit aucun octet : c'est la forme documentée
 * de GNU dd pour `posix_fadvise(DONTNEED)`, que Node n'expose pas). Aucune donnée n'est touchée ; la
 * lecture suivante retourne simplement au disque. Hors de Linux, ou sans compteurs de conteneur, rien ne
 * se passe. Sans `dd`, la minuterie s'arrête et le relevé le dit.
 */
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentDatabasePath } from "./db.js";
import { readCgroupMemory } from "./memory-report.js";

const START_DELAY = 2 * 60_000;
const CHECK_INTERVAL = 5 * 60_000;
/** En dessous, on laisse le cache servir : il accélère les lectures et ne coûte presque rien. */
export const FILE_CACHE_THRESHOLD_BYTES = 128 * 1024 * 1024;
const MIN_FILE_BYTES = 1024 * 1024;
const MODELS_DIR = fileURLToPath(new URL("../../dist/models/", import.meta.url));

export interface FileCacheRelease {
  at: string;
  files: number;
  before_file_bytes: number;
  after_file_bytes: number | null;
  error: "dd_unavailable" | "dd_failed" | null;
}

let last: FileCacheRelease | null = null;
/** Dernier passage qui a agi (ou échoué), pour le relevé de mémoire ; `null` tant que le seuil n'a pas été franchi. */
export function lastFileCacheRelease(): FileCacheRelease | null {
  return last;
}

/** Fichiers d'au moins 1 Mo sous un dossier ; dossier absent ou illisible : liste vide. */
export function largeFilesUnder(dir: string, minBytes = MIN_FILE_BYTES): string[] {
  const found: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      const info = statSync(path);
      if (info.isDirectory()) found.push(...largeFilesUnder(path, minBytes));
      else if (info.isFile() && info.size >= minBytes) found.push(path);
    } catch {
      // Fichier disparu entre la liste et la lecture : rien à rendre pour lui.
    }
  }
  return found;
}

type DropResult = "ok" | "unavailable" | "failed";

/** Demande au noyau d'oublier le cache d'UN fichier. Aucune lecture, aucune écriture. */
export function dropWithDd(path: string): Promise<DropResult> {
  return new Promise((resolve) => {
    execFile("dd", [`if=${path}`, "iflag=nocache", "count=0", "status=none"], { timeout: 30_000 }, (error) => {
      if (!error) resolve("ok");
      else resolve((error as NodeJS.ErrnoException).code === "ENOENT" ? "unavailable" : "failed");
    });
  });
}

type Dependencies = {
  cachedFileBytes: () => number | null;
  files: () => string[];
  drop: (path: string) => Promise<DropResult>;
  now: () => Date;
  thresholdBytes: number;
};

function defaultFiles(): string[] {
  const database = currentDatabasePath();
  return [...(database === ":memory:" ? [] : [database]), ...largeFilesUnder(MODELS_DIR)];
}

/**
 * Un passage : `"idle"` sous le seuil, `"released"` après avoir agi, `"stop"` quand rien ne pourra jamais
 * agir ici (pas de compteurs de conteneur, pas de `dd`, ou un `dd` qui échoue sur tous les fichiers).
 */
export async function releaseFileCacheOnce(overrides: Partial<Dependencies> = {}): Promise<"idle" | "released" | "stop"> {
  const deps: Dependencies = {
    cachedFileBytes: () => readCgroupMemory().stat.file ?? null,
    files: defaultFiles,
    drop: dropWithDd,
    now: () => new Date(),
    thresholdBytes: FILE_CACHE_THRESHOLD_BYTES,
    ...overrides,
  };
  const before = deps.cachedFileBytes();
  if (before === null) return "stop";
  if (before < deps.thresholdBytes) return "idle";
  let files = 0;
  let error: FileCacheRelease["error"] = null;
  for (const path of deps.files()) {
    const result = await deps.drop(path);
    if (result === "unavailable") {
      error = "dd_unavailable";
      break;
    }
    if (result === "failed") error = "dd_failed";
    else files++;
  }
  last = { at: deps.now().toISOString(), files, before_file_bytes: before, after_file_bytes: deps.cachedFileBytes(), error };
  // Un `dd` présent mais qui refuse l'option (autre que GNU) échoue sur tous les fichiers : inutile d'y revenir.
  return error === "dd_unavailable" || (error === "dd_failed" && files === 0) ? "stop" : "released";
}

/** Minuterie du service : premier contrôle après deux minutes, puis toutes les cinq minutes. Jamais bloquante. */
export function startFileCacheRelease(overrides: Partial<Dependencies> = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    let outcome: "idle" | "released" | "stop" = "idle";
    try {
      outcome = await releaseFileCacheOnce(overrides);
    } catch {
      console.error("[cache fichiers] passage interrompu ; nouvel essai dans cinq minutes");
    }
    if (outcome === "stop") {
      // Nombres et code fixe seulement ; aucun chemin.
      console.warn(`[cache fichiers] minuterie arrêtée (${last?.error ?? "pas de compteurs de conteneur"})`);
      return;
    }
    if (outcome === "released" && last) {
      console.info(`[cache fichiers] ${Math.round(last.before_file_bytes / 1048576)} Mo -> ${last.after_file_bytes === null ? "?" : Math.round(last.after_file_bytes / 1048576)} Mo (${last.files} fichier(s))`);
    }
    schedule(CHECK_INTERVAL);
  };
  schedule(START_DELAY);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Aide de test SEULE : oublie le dernier passage. */
export function _resetFileCacheRelease(): void {
  last = null;
}
