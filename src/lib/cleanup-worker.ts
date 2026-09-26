import type Database from 'better-sqlite3';
import { getDb } from './db.js';
import { readCleanupProof, runFullCleanup } from './cleanup.js';

const START_DELAY = 30_000;
const CHECK_INTERVAL = 15 * 60_000;
const CLEANUP_INTERVAL = 6 * 3_600_000;
const RETRY_INTERVAL = 3_600_000;

type Dependencies = {
  database: () => Database.Database;
  readProof: typeof readCleanupProof;
  cleanup: typeof runFullCleanup;
  now: () => number;
};

/** Le serveur applique la même conservation que la tâche extérieure, même si celle-ci est désactivée. */
export function startCleanupWorker(overrides: Partial<Dependencies> = {}): () => void {
  const deps: Dependencies = { database: getDb, readProof: readCleanupProof, cleanup: runFullCleanup, now: Date.now, ...overrides };
  let stopped = false;
  let lastAttempt: number | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    const now = deps.now();
    try {
      // Une erreur ne provoque pas une rafale de tentatives ; un recul d’horloge ne bloque pas indéfiniment.
      const sinceAttempt = lastAttempt === undefined ? Infinity : now - lastAttempt;
      if (sinceAttempt >= 0 && sinceAttempt < RETRY_INTERVAL) return;
      const db = deps.database();
      const proof = deps.readProof(db);
      const age = proof ? now - proof.checked_at : Infinity;
      // Un passage extérieur récent suffit. Une date future ou un témoin incomplet ne vaut pas succès.
      if (proof?.ok && age >= 0 && age < CLEANUP_INTERVAL) return;
      lastAttempt = now;
      const result = await deps.cleanup(db, now);
      if (!result.ok) console.error('[nettoyage] passage incomplet ; détail dans le bureau privé, nouvel essai dans une heure');
      else console.info('[nettoyage] passage serveur réussi ; témoin conservé dans le bureau privé');
    } catch {
      lastAttempt = now;
      console.error('[nettoyage] passage interrompu ; nouvel essai dans une heure');
    } finally {
      // Une seule minuterie, réarmée après la fin ; aucune exécution concurrente ni relance après arrêt.
      schedule(CHECK_INTERVAL);
    }
  };
  schedule(START_DELAY);
  console.info('[nettoyage] minuterie serveur active ; premier contrôle après 30 secondes');
  return () => { stopped = true; clearTimeout(timer); };
}
