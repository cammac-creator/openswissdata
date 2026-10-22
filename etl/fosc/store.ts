/**
 * Où vit l'état argent de la collecte FOSC entre deux passages, et où va l'or.
 *
 * - `r2` (passage réel) : le bucket R2 PRIVÉ existant (accès par liens signés seulement), sous
 *   le préfixe `fosc/` ; deux objets réécrits à chaque passage, pour que la purge efface
 *   vraiment. Ni le dépôt (public, historique permanent), ni un artefact GitHub (téléchargeable
 *   par tout compte connecté) : une ligne y resterait au-delà de la durée de publication.
 * - `file` (simulation) : un dossier du bloc-notes, hors du dépôt.
 * - `memory` (tests).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getObjectBuffer, putObjectBytes } from "../../src/lib/r2.js";
import type { FoscState } from "./state.js";
import type { TotalsDocument } from "./totals.js";

export const R2_STATE_KEY = "fosc/argent/hr-state-v1.json";
export const R2_TOTALS_KEY = "fosc/or/hr-monthly-totals-v1.json";
const STATE_FILE = "hr-state-v1.json";
const TOTALS_FILE = "hr-monthly-totals-v1.json";
const MAX_STATE_BYTES = 64_000_000;

export interface FoscStore {
  readonly kind: "memory" | "file" | "r2";
  /** `null` : aucun état encore écrit. Un contenu illisible lève une erreur (jamais `null`). */
  loadState(): Promise<unknown | null>;
  saveState(state: FoscState): Promise<void>;
  saveTotals(doc: TotalsDocument): Promise<void>;
}

const serialize = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;

export function memoryStore(initial: unknown | null = null): FoscStore & { state: unknown | null; totals: TotalsDocument | null; writes: number } {
  const store = {
    kind: "memory" as const,
    state: initial,
    totals: null as TotalsDocument | null,
    writes: 0,
    async loadState() { return store.state === null ? null : JSON.parse(JSON.stringify(store.state)); },
    async saveState(state: FoscState) { store.state = JSON.parse(serialize(state)); store.writes++; },
    async saveTotals(doc: TotalsDocument) { store.totals = JSON.parse(serialize(doc)); },
  };
  return store;
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, "utf8");
  try { renameSync(tmp, path); } catch (err) {
    try { unlinkSync(tmp); } catch { /* déjà absent */ }
    throw err;
  }
}

export function fileStore(dir: string): FoscStore {
  mkdirSync(dir, { recursive: true });
  return {
    kind: "file",
    async loadState() {
      const p = join(dir, STATE_FILE);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, "utf8"));
    },
    async saveState(state) { writeAtomic(join(dir, STATE_FILE), serialize(state)); },
    async saveTotals(doc) { writeAtomic(join(dir, TOTALS_FILE), serialize(doc)); },
  };
}

const isMissingObject = (error: unknown): boolean => {
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
};

export function r2Store(): FoscStore {
  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    if (!process.env[name]) throw new Error(`Passage réel FOSC refusé : ${name} absent (aucun repli vers un fichier local)`);
  }
  return {
    kind: "r2",
    async loadState() {
      let bytes: Buffer;
      try {
        bytes = await getObjectBuffer(R2_STATE_KEY, { maxBytes: MAX_STATE_BYTES });
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
      return JSON.parse(bytes.toString("utf8"));
    },
    async saveState(state) { await putObjectBytes(R2_STATE_KEY, Buffer.from(serialize(state)), "application/json"); },
    async saveTotals(doc) { await putObjectBytes(R2_TOTALS_KEY, Buffer.from(serialize(doc)), "application/json"); },
  };
}
