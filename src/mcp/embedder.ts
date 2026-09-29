/**
 * Requêtes et index partagent les mêmes poids q8, chargés localement à la demande.
 * Le modèle vit dans un processus à part, arrêté après dix minutes sans recherche :
 * libérer le modèle dans le processus principal ne rendait pas sa mémoire (mesure du 29.09.2026).
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
export { EMBEDDING_MODEL } from "../lib/embedding-model.js";
export const EMBEDDING_DIMENSIONS = 768;

type Pending = { resolve: (vector: Float32Array) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type Worker = { proc: ChildProcess; pending: Map<number, Pending>; idle: NodeJS.Timeout | null };

const source = import.meta.url.endsWith(".ts");
const settings = {
  workerPath: fileURLToPath(new URL(source ? "../lib/embedding-worker.ts" : "../lib/embedding-worker.js", import.meta.url)),
  idleMs: 10 * 60_000,
  requestMs: 120_000,
};
let worker: Worker | null = null;
let nextId = 0;

function stopWorker(current: Worker, error: Error): void {
  if (worker === current) worker = null;
  if (current.idle) clearTimeout(current.idle);
  for (const request of current.pending.values()) { clearTimeout(request.timer); request.reject(error); }
  current.pending.clear();
  current.proc.kill("SIGKILL");
}

function startWorker(): Worker {
  const proc = fork(settings.workerPath, [], {
    execArgv: settings.workerPath.endsWith(".ts") ? ["--import", "tsx"] : [],
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    // Aucun identifiant applicatif ne passe au processus du modèle.
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: "C.UTF-8" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const current: Worker = { proc, pending: new Map(), idle: null };
  proc.on("message", (message: { id?: number; vector?: number[]; error?: string }) => {
    const request = typeof message?.id === "number" ? current.pending.get(message.id) : undefined;
    if (!request) return;
    current.pending.delete(message.id!);
    clearTimeout(request.timer);
    if (Array.isArray(message.vector) && message.vector.length === EMBEDDING_DIMENSIONS) request.resolve(Float32Array.from(message.vector));
    else request.reject(new Error("embedQuery: worker failed"));
    if (current.pending.size === 0 && worker === current) {
      current.idle = setTimeout(() => stopWorker(current, new Error("embedQuery: worker stopped")), settings.idleMs);
      current.idle.unref();
    }
  });
  proc.once("error", () => stopWorker(current, new Error("embedQuery: worker failed")));
  proc.once("exit", () => stopWorker(current, new Error("embedQuery: worker exited")));
  return current;
}

/**
 * Embed a free-text query into a 768-dimensional unit vector.
 *
 * Mean-pooled + L2-normalised so cosine similarity reduces to a dot product
 * against the pre-baked dataset vectors (which were normalised the same way).
 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("embedQuery: empty input");
  }
  const current = worker ??= startWorker();
  if (current.idle) { clearTimeout(current.idle); current.idle = null; }
  const id = ++nextId;
  return new Promise<Float32Array>((resolve, reject) => {
    const timer = setTimeout(() => stopWorker(current, new Error("embedQuery: timeout")), settings.requestMs);
    current.pending.set(id, { resolve, reject, timer });
    current.proc.send({ id, text: trimmed }, (error) => { if (error) stopWorker(current, new Error("embedQuery: worker unreachable")); });
  });
}

/**
 * Cosine similarity between two equal-length vectors. Both inputs are assumed
 * L2-normalised at generation time, so this is effectively a dot product —
 * but we keep the explicit denominator for safety against future schema
 * changes (e.g. unnormalised vectors slipping in).
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Test helper: stops the model process and rejects what was waiting. */
export function _resetEmbedderCache(): void {
  if (worker) stopWorker(worker, new Error("embedQuery: reset"));
}

/** Test helper: another worker script and shorter delays, for the protocol tests. */
export function _configureEmbedderForTests(options: Partial<typeof settings>): void {
  _resetEmbedderCache();
  Object.assign(settings, options);
}

/** Test helper: pid of the running model process, or null. */
export function _embedderWorkerPid(): number | null {
  return worker?.proc.pid ?? null;
}
