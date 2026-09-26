import type Database from 'better-sqlite3';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { EVENT_KINDS, type TrackArgs } from './event-types.js';
import { swissDay } from './crm-period.js';
import { EVENT_RETENTION_MS } from './event-retention.js';

export const EVENT_LIMITS = { queued: 100, queuedBytes: 512 * 1024, eventBytes: 8192, burst: 100, perMinute: 600, byteBurst: 256 * 1024, bytesPerMinute: 1024 * 1024, reserveBytes: 300_000_000 } as const;
const CLIENT_LIMITS = { ...EVENT_LIMITS, queued: 20, queuedBytes: 64 * 1024, burst: 20, perMinute: 120, byteBurst: 64 * 1024, bytesPerMinute: 256 * 1024 };
let lastFailureLog = -Infinity;
export function reportEventFailure(): void {
  const now = Date.now();
  if (now >= lastFailureLog && now - lastFailureLog < 60_000) return;
  lastFailureLog = now; console.warn('[mesures] enregistrement momentanément indisponible');
}
class InvalidProof extends Error {}
const reasons = ['queue', 'rate', 'size', 'storage', 'write', 'format'] as const;
type Reason = typeof reasons[number];
export type EventGap = { day: string; dropped: number; first_at: number; last_at: number; reasons: Partial<Record<Reason, number>> };
export type EventCoverage = { available: boolean; checked_at: number | null; gaps: EventGap[]; pending: boolean; uncertain_before: number | null };
const integer = z.number().int().nonnegative().safe();
const gapSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dropped: integer, first_at: integer, last_at: integer, reasons: z.object(Object.fromEntries(reasons.map(k => [k, integer.optional()])) as Record<Reason, z.ZodOptional<typeof integer>>).strict() }).strict();
const proofSchema = z.object({ version: z.literal(1), checked_at: integer, uncertain_before: integer.nullable(), gaps: z.array(gapSchema).max(183) }).strict();
type Proof = z.infer<typeof proofSchema>;
const sum = (a: number, b: number) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

/** Réserves locales : calcul monotone, mémoire et débit bornés avant la file d’écriture. */
export class EventBudget {
  constructor(private readonly limits: { [K in keyof typeof EVENT_LIMITS]: number } = EVENT_LIMITS) { this.tokens = limits.burst * 60_000; this.bytes = limits.byteBurst * 60_000; }
  private last: number | null = null;
  private tokens: number;
  private bytes: number;
  private queued = 0;
  private queuedBytes = 0;
  take(size: number, now: number): Reason | null {
    if (!Number.isFinite(now) || !Number.isSafeInteger(size) || size < 0) return 'format';
    now = Math.floor(now);
    if (size > this.limits.eventBytes) return 'size';
    if (this.queued >= this.limits.queued || this.queuedBytes + size > this.limits.queuedBytes) return 'queue';
    const elapsed = this.last === null ? 0 : Math.min(60_000, Math.max(0, now - this.last));
    this.last = this.last === null ? now : Math.max(this.last, now);
    this.tokens = Math.min(this.limits.burst * 60_000, this.tokens + elapsed * this.limits.perMinute);
    this.bytes = Math.min(this.limits.byteBurst * 60_000, this.bytes + elapsed * this.limits.bytesPerMinute);
    if (this.tokens < 60_000 || this.bytes < size * 60_000) return 'rate';
    this.tokens -= 60_000; this.bytes -= size * 60_000; this.queued++; this.queuedBytes += size;
    return null;
  }
  release(size: number): void { this.queued = Math.max(0, this.queued - 1); this.queuedBytes = Math.max(0, this.queuedBytes - size); }
}
type State = { budget: EventBudget; clientBudget: EventBudget; uncertainBefore: number | null; pending: Map<string, EventGap>; knownDays: Set<string>; timer?: ReturnType<typeof setTimeout>; lastFlush: number; spaceAt: number; spaceOkay: boolean };
const states = new WeakMap<Database.Database, State>();
function stateFor(db: Database.Database): State {
  let state = states.get(db);
  if (!state) { state = { budget: new EventBudget(), clientBudget: new EventBudget(CLIENT_LIMITS), uncertainBefore: null, pending: new Map(), knownDays: new Set(), lastFlush: -Infinity, spaceAt: -Infinity, spaceOkay: false }; states.set(db, state); }
  return state;
}
function mergeGaps(gaps: EventGap[], additions: Iterable<EventGap>, now: number): EventGap[] {
  const cutoff = swissDay(now - EVENT_RETENTION_MS), merged = new Map<string, EventGap>();
  for (const gap of [...gaps, ...additions]) {
    if (gap.day < cutoff) continue;
    const old = merged.get(gap.day);
    if (!old) { merged.set(gap.day, { ...gap, reasons: { ...gap.reasons } }); continue; }
    old.dropped = sum(old.dropped, gap.dropped); old.first_at = Math.min(old.first_at, gap.first_at); old.last_at = Math.max(old.last_at, gap.last_at);
    for (const reason of reasons) if (gap.reasons[reason]) old.reasons[reason] = sum(old.reasons[reason] ?? 0, gap.reasons[reason]!);
  }
  return [...merged.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-183);
}
function storedProof(db: Database.Database): Proof | null {
  const row = db.prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='event_collection'").get() as { checked_at: number; details_json: string } | undefined;
  if (!row) return null;
  try {
    if (Buffer.byteLength(row.details_json, 'utf8') > 100_000) throw new InvalidProof('event_proof_invalid');
    const parsed = proofSchema.parse(JSON.parse(row.details_json));
    if (row.checked_at !== parsed.checked_at) throw new InvalidProof('event_proof_invalid');
    if (new Set(parsed.gaps.map(g => g.day)).size !== parsed.gaps.length || parsed.gaps.some(g => g.first_at > g.last_at || swissDay(g.first_at) !== g.day || swissDay(g.last_at) !== g.day || Object.values(g.reasons).reduce((n, v) => sum(n, v ?? 0), 0) !== g.dropped)) throw new InvalidProof('event_proof_invalid');
    return parsed;
  } catch { throw new InvalidProof('event_proof_invalid'); }
}
/** SQLite est synchrone : une mesure facultative ne doit pas attendre un autre écrivain. */
function withoutWriterWait<T>(db: Database.Database, action: () => T): T {
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try { db.pragma('busy_timeout = 0'); return action(); }
  finally { if (db.open) db.pragma(`busy_timeout = ${timeout}`); }
}
/** Appelé au premier abandon puis au plus chaque minute ; aucun contenu de requête dans ce témoin. */
export function flushEventCoverage(db: Database.Database, now = Date.now()): void {
  const state = states.get(db);
  if (!state?.pending.size || !db.open || !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) return;
  state.lastFlush = performance.now();
  for (const day of state.pending.keys()) state.knownDays.add(day);
  if (state.knownDays.size > 183) state.knownDays = new Set([...state.knownDays].sort().slice(-183));
  try {
    const proof = withoutWriterWait(db, () => db.transaction(() => {
      let old: Proof | null = null, unreadable = false;
      try { old = storedProof(db); } catch (error) { if (!(error instanceof InvalidProof)) throw error; unreadable = true; }
      const uncertain = unreadable ? now : Math.max(old?.uncertain_before ?? -Infinity, state.uncertainBefore ?? -Infinity);
      const result: Proof = { version: 1, checked_at: now, uncertain_before: Number.isFinite(uncertain) && uncertain >= now - EVENT_RETENTION_MS ? uncertain : null, gaps: mergeGaps(old?.gaps ?? [], state.pending.values(), now) };
      db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('event_collection',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json").run(now, JSON.stringify(result));
      return result;
    }).immediate());
    state.pending.clear(); state.uncertainBefore = null; state.knownDays = new Set(proof.gaps.map(g => g.day)); state.lastFlush = performance.now();
    if (state.timer) { clearTimeout(state.timer); state.timer = undefined; }
  } catch {
    reportEventFailure();
    // Une panne isolée doit être reprise même s’il n’y a plus de trafic ensuite.
    if (!state.timer) {
      state.timer = setTimeout(() => { state.timer = undefined; flushEventCoverage(db); }, 60_000);
      state.timer.unref();
    }
  }
}
function drop(db: Database.Database, reason: Reason, timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) return;
  if (reason === 'storage' || reason === 'write') reportEventFailure();
  const state = stateFor(db), day = swissDay(timestamp);
  const gap = state.pending.get(day) ?? { day, dropped: 0, first_at: timestamp, last_at: timestamp, reasons: {} };
  gap.dropped = sum(gap.dropped, 1); gap.first_at = Math.min(gap.first_at, timestamp); gap.last_at = Math.max(gap.last_at, timestamp); gap.reasons[reason] = sum(gap.reasons[reason] ?? 0, 1);
  state.pending.set(day, gap);
  // Un recul d’horloge prolongé ne doit pas faire croître une file sans borne.
  if (state.pending.size > 183) {
    const oldest = [...state.pending.keys()].sort()[0];
    state.uncertainBefore = Math.max(state.uncertainBefore ?? 0, state.pending.get(oldest)!.last_at); state.pending.delete(oldest);
  }
  if (!state.timer) {
    const delay = state.knownDays.has(day) ? Math.max(0, 60_000 - (performance.now() - state.lastFlush)) : 0;
    state.timer = setTimeout(() => { state.timer = undefined; flushEventCoverage(db); }, delay);
    state.timer.unref();
  }
}
function enoughSpace(db: Database.Database, state: State): boolean {
  if (db.name === ':memory:') return true;
  const now = performance.now();
  if (now - state.spaceAt < 1000) return state.spaceOkay;
  state.spaceAt = now; state.spaceOkay = false;
  try {
    const disk = statfsSync(dirname(db.name));
    state.spaceOkay = Number.isFinite(disk.bavail * disk.bsize) && disk.bavail * disk.bsize >= EVENT_LIMITS.reserveBytes;
  } catch { /* Stockage illisible : suspendre les statistiques, conserver le service. */ }
  return state.spaceOkay;
}
export function queueEvent(db: Database.Database, args: TrackArgs, timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) { drop(db, 'format', Date.now()); return; }
  // Copie fermée : aucun champ ajouté à l’appel ne rejoint la file ou la preuve.
  const { kind, origin, name, status, duration_ms, customer_id, visitor_hash, country, referer, ua_class, meta_json } = args;
  const event = { kind, origin, name, status, duration_ms, customer_id, visitor_hash, country, referer, ua_class, meta_json }, state = stateFor(db);
  const strings = [event.name, event.visitor_hash, event.country, event.referer, event.ua_class, event.meta_json];
  const numbers = [status, customer_id];
  if (!['server', 'client'].includes(event.origin) || !EVENT_KINDS.includes(event.kind) || strings.some(x => x != null && typeof x !== 'string') || numbers.some(x => x != null && (!Number.isSafeInteger(x) || x < 0))) { drop(db, 'format', timestamp); return; }
  if (duration_ms != null) { if (!Number.isFinite(duration_ms) || duration_ms < 0 || !Number.isSafeInteger(Math.round(duration_ms))) { drop(db, 'format', timestamp); return; } event.duration_ms = Math.round(duration_ms); }
  const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
  const client = event.origin === 'client';
  if (client) { const rejected = state.clientBudget.take(size, performance.now()); if (rejected) { drop(db, rejected, timestamp); return; } }
  const rejected = state.budget.take(size, performance.now());
  if (rejected) { if (client) state.clientBudget.release(size); drop(db, rejected, timestamp); return; }
  setImmediate(() => {
    try {
      if (!db.open) return;
      if (!enoughSpace(db, state)) { drop(db, 'storage', timestamp); return; }
      withoutWriterWait(db, () => db.prepare(`INSERT INTO events(kind,name,status,duration_ms,customer_id,visitor_hash,country,referer,ua_class,meta_json,origin,ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(event.kind, event.name ?? null, event.status ?? null, event.duration_ms ?? null, event.customer_id ?? null, event.visitor_hash ?? null, event.country ?? null, event.referer ?? null, event.ua_class ?? null, event.meta_json ?? null, event.origin, timestamp));
    } catch { drop(db, 'write', timestamp); }
    finally { state.budget.release(size); if (client) state.clientBudget.release(size); }
  });
}
export function readEventCoverage(db: Database.Database, now = Date.now(), since = now - EVENT_RETENTION_MS, until = now + 1): EventCoverage {
  const state = states.get(db), pending = state?.pending ?? new Map<string, EventGap>();
  const overlaps = (g: EventGap) => g.last_at >= since && g.first_at < until;
  const pendingHere = [...pending.values()].some(overlaps);
  try {
    const proof = storedProof(db);
    const uncertain = Math.max(proof?.uncertain_before ?? -Infinity, state?.uncertainBefore ?? -Infinity);
    return { available: true, checked_at: proof?.checked_at ?? null, gaps: mergeGaps(proof?.gaps ?? [], pending.values(), now).filter(overlaps), pending: pendingHere, uncertain_before: Number.isFinite(uncertain) && uncertain >= since ? uncertain : null };
  } catch { return { available: false, checked_at: null, gaps: mergeGaps([], pending.values(), now).filter(overlaps), pending: pendingHere, uncertain_before: now }; }
}
