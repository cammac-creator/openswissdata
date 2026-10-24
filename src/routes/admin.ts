import { Hono } from "hono";
import { z } from "zod";
import { getDb, currentDatabasePath } from "../lib/db.js";
import { verifyRestoredBackup } from "../lib/backup-verification.js";
import { BackupInspectionError, type BackupInspection } from "../lib/backup-inspection.js";
import { writeBackupAttempt } from "../lib/backup-state.js";
import { seedDatasets } from "../db/seed.js";
import { constantTimeEqual } from "../lib/tokens.js";
import { realCustomerSql } from "./crm.js";
import { runFullCleanup } from "../lib/cleanup.js";
import { countConfirmedAnnouncements } from "../lib/announcements.js";
import { internalEmails } from "../lib/crm-customers.js";
import { refreshFinmaFromR2, refreshTaresFromR2, refreshClassificationsFromR2, getMcpFreshness, extractCsvFromZip } from "../mcp/r2-refresh.js";
import { getObjectBuffer } from "../lib/r2.js";
import { snapshotFromRows, getReleasedAt, type SnapshotDataset } from "../mcp/snapshots.js";
import { parse as parseCsvSync } from "csv-parse/sync";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { readFileSync, createReadStream, createWriteStream, mkdtempSync } from "node:fs";
import { backupKey, encryptBackup, decryptBackup } from "../lib/backup-cipher.js";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const adminRoute = new Hono();
let backupInProgress = false;

adminRoute.get("/operations", (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) return c.json({ error: "unauthorized" }, 401);
  const checks = getDb().prepare("SELECT name,checked_at,details_json FROM operation_checks").all() as Array<{name: string; checked_at: number; details_json: string}>;
  return c.json({ checks: checks.map(({ details_json, ...row }) => ({ ...row, details: JSON.parse(details_json) })) });
});

// Métadonnées publiques du produit uniquement ; aucune donnée client.
/**
 * GET /api/admin/indicateurs?days=7 — relevé de CHIFFRES seulement (21.10.2026), lu par le lanceur sans
 * modèle de la séance hebdomadaire et par les bilans : protégé par le secret d'administration comme
 * /operations. Jamais d'adresse, de nom, d'empreinte de visiteur, d'identifiant de client ou de session, de
 * chemin complet ni de nom fourni par un appelant : des comptes, sous des clés fixes. Les visiteurs sont
 * des « visiteurs-jours » (empreinte renouvelée chaque jour), pas des personnes uniques sur la période.
 * Ventes et comptes : même règle que le CRM (réels cs_live_*, payés, nets des remboursements, sans les
 * comptes internes de ADMIN_EMAILS, CRM_INTERNAL_EMAILS et crm_profiles.internal) ; centimes de CHF.
 */
const OUTILS_MCP = new Set([
  "tariff_lookup", "kyc_check", "company_check", "cross_walk", "tariff_semantic_search",
  "classify_text", "finma_search", "tariff_changelog", "entity_history", "statent_lookup",
]);
// Événements produits par le serveur lui-même (noms réservés de src/routes/events.ts, refusés aux appelants).
const EVENEMENTS_SERVEUR = [
  "mcp_initialize", "mcp_rate_limited", "mcp_trial", "checkout_started", "payment_paid",
  "delivery_sent", "download_authorized", "sample_served",
] as const;
// Déclarations de visiteurs à nom FIXÉ d'avance (route publique /api/events/track) : comptées à part,
// jamais mêlées aux événements du serveur ; un nom hors de cette liste n'atteint jamais la sortie.
const DECLARATIONS_VISITEURS = ["etre_prevenu"] as const;
const SECTION = /^[a-z0-9-]{1,40}$/;

adminRoute.get("/indicateurs", (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) return c.json({ error: "unauthorized" }, 401);
  const days = Math.min(90, Math.max(1, Number.parseInt(c.req.query("days") ?? "7", 10) || 7));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const db = getDb();
  const reel = realCustomerSql("c");
  const ventes = (depuis: number) => db.prepare(`
    SELECT COUNT(*) AS commandes, COUNT(DISTINCT o.customer_id) AS clients,
           COALESCE(SUM(o.amount_chf - o.refunded_chf), 0) AS net_centimes
    FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN crm_profiles p ON p.customer_id = c.id
    WHERE o.status = 'paid' AND o.stripe_session_id GLOB 'cs_live_*' AND o.created_at >= ? AND ${reel.sql}
  `).get(depuis, ...reel.params) as { commandes: number; clients: number; net_centimes: number };
  const comptes = db.prepare(`
    SELECT COUNT(*) AS nouveaux FROM customers c LEFT JOIN crm_profiles p ON p.customer_id = c.id
    WHERE c.created_at >= ? AND ${reel.sql}
  `).get(since, ...reel.params) as { nouveaux: number };

  const filtrePages = `kind = 'custom' AND name = 'page_view' AND origin = 'server' AND ts >= ? AND ua_class IN ('desktop', 'mobile') AND visitor_hash IS NOT NULL`;
  const total = db.prepare(`SELECT COUNT(DISTINCT visitor_hash) AS n FROM events WHERE ${filtrePages}`).get(since) as { n: number };
  const brutes = db.prepare(`
    WITH v AS (SELECT visitor_hash, COALESCE(json_extract(meta_json, '$.path'), '') AS p FROM events WHERE ${filtrePages}),
         s AS (SELECT visitor_hash, CASE WHEN p IN ('', '/') THEN 'accueil'
                                         WHEN instr(substr(p, 2), '/') > 0 THEN substr(p, 2, instr(substr(p, 2), '/') - 1)
                                         ELSE substr(p, 2) END AS section FROM v)
    SELECT section, COUNT(DISTINCT visitor_hash) AS visiteurs_jours FROM s GROUP BY section ORDER BY visiteurs_jours DESC LIMIT 60
  `).all(since) as Array<{ section: string; visiteurs_jours: number }>;
  const parSection = new Map<string, number>();
  for (const r of brutes) {
    const cle = SECTION.test(r.section) ? r.section : "autre";
    parSection.set(cle, (parSection.get(cle) ?? 0) + r.visiteurs_jours);
  }
  const sections = [...parSection.entries()].map(([section, visiteurs_jours]) => ({ section, visiteurs_jours }))
    .sort((a, b) => b.visiteurs_jours - a.visiteurs_jours || a.section.localeCompare(b.section)).slice(0, 20);

  const appelsMcp = db.prepare(`
    SELECT json_extract(meta_json, '$.tool') AS outil, COALESCE(ua_class, 'unknown') AS classe,
           COUNT(*) AS appels, COUNT(DISTINCT visitor_hash) AS visiteurs_jours
    FROM events
    WHERE kind = 'custom' AND name = 'mcp_tool_call' AND origin IN ('server', 'legacy') AND ts >= ?
      AND COALESCE(json_extract(meta_json, '$.admin'), 0) = 0
    GROUP BY outil, classe
  `).all(since) as Array<{ outil: unknown; classe: string; appels: number; visiteurs_jours: number }>;
  const mcp: Record<string, { appels: number; visiteurs_jours: number; par_classe: Record<string, number> }> = {};
  for (const r of appelsMcp) {
    const outil = typeof r.outil === "string" && OUTILS_MCP.has(r.outil) ? r.outil : "autre";
    const m = (mcp[outil] ??= { appels: 0, visiteurs_jours: 0, par_classe: {} });
    m.appels += r.appels;
    m.visiteurs_jours += r.visiteurs_jours;
    m.par_classe[r.classe] = (m.par_classe[r.classe] ?? 0) + r.appels;
  }

  const evenements = db.prepare(`
    SELECT name AS nom, COUNT(*) AS nombre, COUNT(DISTINCT visitor_hash) AS visiteurs_jours
    FROM events
    WHERE kind IN ('custom', 'conversion') AND origin = 'server' AND ts >= ?
      AND name IN (${EVENEMENTS_SERVEUR.map(() => "?").join(",")})
    GROUP BY name ORDER BY nombre DESC
  `).all(since, ...EVENEMENTS_SERVEUR) as Array<{ nom: string; nombre: number; visiteurs_jours: number }>;

  const declarations = db.prepare(`
    SELECT name AS nom, COUNT(*) AS nombre, COUNT(DISTINCT visitor_hash) AS visiteurs_jours
    FROM events
    WHERE kind IN ('custom', 'conversion') AND origin = 'client' AND ts >= ? AND ua_class IN ('desktop', 'mobile')
      AND name IN (${DECLARATIONS_VISITEURS.map(() => "?").join(",")})
    GROUP BY name ORDER BY nombre DESC
  `).all(since, ...DECLARATIONS_VISITEURS) as Array<{ nom: string; nombre: number; visiteurs_jours: number }>;

  return c.json({
    genere_le: new Date().toISOString(),
    fenetre_jours: days,
    ventes: { periode: ventes(since), depuis_toujours: ventes(0) },
    comptes_crees: comptes.nouveaux,
    visites: { visiteurs_jours_navigateurs: total.n, par_section: sections },
    mcp,
    evenements,
    declarations_visiteurs: declarations,
    // Inscriptions « être prévenu » confirmées, par sujet (clés fixes) : un nombre, jamais une adresse.
    // Toute la durée de conservation, pas la fenêtre ; adresses de ADMIN_EMAILS et CRM_INTERNAL_EMAILS exclues.
    inscriptions_confirmees: countConfirmedAnnouncements(db, internalEmails()),
    notes: "Chiffres seulement. Déclarations de visiteurs : déclaratives (navigateurs seulement, un clic n'est pas une personne). Fenêtre glissante (pas la période suisse du CRM). Visiteurs-jours : empreinte renouvelée chaque jour, pas des personnes uniques. Montants en centimes de CHF. Inscriptions confirmées : total en cours, hors adresses internes.",
  });
});

adminRoute.get("/dataset-versions/:id", (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) return c.json({ error: "unauthorized" }, 401);
  const db = getDb();
  const dataset = db.prepare("SELECT id, current_version FROM datasets WHERE id=?").get(c.req.param("id"));
  if (!dataset) return c.json({ error: "unknown_dataset" }, 404);
  const versions = db.prepare("SELECT version, r2_key, sha256, size_bytes, released_at FROM versions WHERE dataset_id=? ORDER BY released_at ASC").all(c.req.param("id"));
  return c.json({ dataset, versions });
});

const ReleaseSchema = z.object({
  dataset_id: z.string().min(1),
  version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
  r2_key: z.string().min(1),
  sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/i),
  size_bytes: z.number().int().positive(),
  changelog: z.string().default(""),
  expected_previous_version: z.string().nullable().optional(),
});

adminRoute.post("/seed", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = seedDatasets();
  return c.json({ ok: true, ...result });
});

/**
 * POST /api/admin/backup-to-r2
 *
 * Snapshot the live SQLite DB and upload to R2 under `backups/db-YYYY-MM-DD-TIMESTAMP.sqlite.enc`,
 * then prune backups older than 30 days. Runs ON Railway (where the DB volume
 * is mounted) — the GitHub Actions cron only fires a curl with ADMIN_SECRET
 * because the runner has no access to the Railway volume.
 *
 * Why better-sqlite3's .backup() and not a simple file copy: backup yields a
 * consistent snapshot even while the live DB is accepting writes (essential
 * because the Hono server runs against the same file in WAL mode).
 */
adminRoute.post("/backup-to-r2", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const dbPath = currentDatabasePath();
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return c.json({ error: "r2_credentials_missing" }, 500);
  }
  let encryptionKey: Buffer;
  try { encryptionKey = backupKey(); } catch { return c.json({ error: "backup_key_missing_or_invalid" }, 503); }
  if (backupInProgress) return c.json({ error: "backup_in_progress" }, 409);

  const dateKey = new Date().toISOString().slice(0, 10);
  const tmp = mkdtempSync(join(tmpdir(), "osd-backup-"));
  const snapshotPath = join(tmp!, "snapshot.sqlite");
  const compressedPath = join(tmp!, "snapshot.sqlite.gz");
  const restoredPath = join(tmp!, "restored.sqlite");
  const r2Key = `backups/db-${dateKey}-${Date.now()}.sqlite.gz.enc`;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  let uploadedBytes = 0;
  let prunedCount = 0;
  let restoreVerification: BackupInspection;
  let phase = "snapshot";
  let retentionStatus: 'ok' | 'error' = 'ok';
  const deadline = Date.now() + 480_000;
  const remaining = (limit: number) => {
    const time = Math.min(limit, deadline - Date.now());
    if (time <= 0) throw new Error("backup_deadline");
    return time;
  };
  backupInProgress = true;
  try {
    writeBackupAttempt(getDb(), "running", phase);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const started = Date.now();
      await db.backup(snapshotPath, { progress: () => {
        if (Date.now() - started > 150_000 || Date.now() >= deadline) throw new Error("backup_snapshot_timeout");
        return 4096;
      } });
    } finally {
      db.close();
    }
    // La base peut être volumineuse : compresser en flux avant le chiffrement.
    await pipeline(createReadStream(snapshotPath), createGzip(), createWriteStream(compressedPath, { mode: 0o600 }));
    const encrypted = encryptBackup(readFileSync(compressedPath), encryptionKey);
    uploadedBytes = encrypted.length;
    phase = "upload";
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: encrypted,
        ContentType: "application/octet-stream",
        ContentLength: uploadedBytes,
        IfNoneMatch: "*",
      }),
      { abortSignal: AbortSignal.timeout(remaining(120_000)) },
    );

    // Restaurer le fichier en flux : une base WAL ne se désérialise pas toujours en mémoire.
    phase = "restore";
    const downloaded = await getObjectBuffer(r2Key, { maxBytes: uploadedBytes + 1, timeoutMs: remaining(120_000) });
    if (!downloaded.equals(encrypted)) throw new Error("backup_object_mismatch");
    const compressed = decryptBackup(downloaded, encryptionKey);
    await pipeline(Readable.from([compressed]), createGunzip(), createWriteStream(restoredPath, { mode: 0o600 }));
    restoreVerification = await verifyRestoredBackup(snapshotPath, restoredPath, remaining(60_000));

    // Témoin indépendant de la base : candidat de reprise, à recontrôler après récupération.
    phase = "manifest";
    const manifestKey = `backups/verified/${r2Key.slice('backups/'.length)}.json`;
    const manifest = Buffer.from(JSON.stringify({ version: 1, backup_key: r2Key, encrypted_sha256: createHash('sha256').update(encrypted).digest('hex'), size_bytes: uploadedBytes, verified_at: new Date().toISOString(), encryption: 'aes-256-gcm', checks: restoreVerification }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: manifest, ContentType: 'application/json', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(remaining(30_000)) });
    if (!(await getObjectBuffer(manifestKey, { maxBytes: 8192, timeoutMs: remaining(30_000) })).equals(manifest)) throw new Error('backup_manifest_mismatch');

    phase = "retention";
    // Une copie validée reste retrouvable même si l’élagage échoue ensuite.
    try {
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      let continuation: string | undefined;
      const seen = new Set<string>();
      do {
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/", ContinuationToken: continuation }),
          { abortSignal: AbortSignal.timeout(remaining(30_000)) },
        );
        for (const obj of listed.Contents ?? []) {
          // Garder le résultat de ce passage même si l’horloge du serveur est incorrecte.
          if (!obj.Key || obj.Key === r2Key || obj.Key === manifestKey) continue;
          const modified = obj.LastModified?.getTime();
          if (modified === undefined || !Number.isFinite(modified) || modified >= cutoff) continue;
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }), { abortSignal: AbortSignal.timeout(remaining(30_000)) });
          prunedCount += 1;
        }
        continuation = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        if (listed.IsTruncated && (!continuation || seen.has(continuation))) throw new Error('backup_retention_pagination');
        if (continuation) seen.add(continuation);
      } while (continuation);
    } catch { retentionStatus = 'error'; }

    const proof = {
      ok: true,
      r2_key: r2Key,
      size_bytes: uploadedBytes,
      pruned_count: prunedCount,
      backed_up_at: new Date().toISOString(),
      encrypted: true,
      restore_check: "ok",
      restore_verification: restoreVerification,
      manifest_key: manifestKey,
      verified_manifest: true,
      retention_status: retentionStatus,
    };
    phase = "proof";
    getDb().transaction(() => {
      getDb().prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('backup',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json").run(Date.now(), JSON.stringify(proof));
      writeBackupAttempt(getDb(), retentionStatus === 'ok' ? "success" : "failed", retentionStatus === 'ok' ? "complete" : "retention", retentionStatus === 'error' ? 'backup_failed_retention' : undefined);
    })();
    return c.json(proof, retentionStatus === 'ok' ? 200 : 503);
  } catch (err) {
    const code = err instanceof BackupInspectionError ? err.code : "backup_failed_" + phase;
    try { writeBackupAttempt(getDb(), "failed", phase, code); } catch { /* Le workflow reste en échec même si le témoin ne peut être écrit. */ }
    return c.json({ error: code }, 503);
  } finally {
    backupInProgress = false;
    client.destroy();
    await rm(tmp!, { recursive: true, force: true });
  }
});

/**
 * POST /api/admin/cleanup-expired
 *
 * Deletes expired ephemeral rows (sessions, magic_links, download_tokens,
 * mcp_oauth_codes, old request_log/events). Runs ON Railway where the DB
 * volume is mounted — the GitHub Actions cron only fires a curl with
 * ADMIN_SECRET because the runner has no access to the Railway volume.
 */
adminRoute.post("/cleanup-expired", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const db = getDb();
  const result = await runFullCleanup(db);
  return c.json({ ...result, ran_at: new Date(result.checked_at).toISOString() }, result.ok ? 200 : 503);
});

adminRoute.post("/release", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let parsed;
  try {
    parsed = ReleaseSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "invalid_body", details: String(err) }, 400);
  }

  const db = getDb();
  const now = Date.now();

  const datasetExists = db.prepare("SELECT id, current_version FROM datasets WHERE id=?").get(parsed.dataset_id) as { id: string; current_version: string | null } | undefined;
  if (!datasetExists) {
    return c.json({ error: "unknown_dataset" }, 404);
  }

  if (parsed.expected_previous_version !== undefined && parsed.expected_previous_version !== datasetExists.current_version) {
    return c.json({ error: "current_version_changed" }, 409);
  }
  if (db.prepare("SELECT 1 FROM versions WHERE dataset_id=? AND version=?").get(parsed.dataset_id, parsed.version)) {
    return c.json({ error: "version_already_exists" }, 409);
  }
  const { expected_previous_version: _expected, ...release } = parsed;
  db.transaction(() => {
    db.prepare(`
    INSERT INTO versions (dataset_id, version, r2_key, sha256, size_bytes, changelog, released_at)
    VALUES (@dataset_id, @version, @r2_key, @sha256, @size_bytes, @changelog, @released_at)
    `).run({ ...release, released_at: now });

  db.prepare("UPDATE datasets SET current_version = ? WHERE id = ?")
    .run(parsed.version, parsed.dataset_id);
  })();

  // Refresh the in-memory MCP slices from the just-released ZIP — DECOUPLED:
  // fire-and-forget so a refresh failure can never fail the release response.
  // This runs on Railway (same process as the MCP server) so it mutates the
  // live in-memory caches; the daily FINMA cron's release POST makes the MCP
  // fresh within seconds. The 12 h timer + next boot are the safety nets.
  if (parsed.dataset_id === "finma") {
    void refreshFinmaFromR2();
  }
  if (parsed.dataset_id === "tares") void refreshTaresFromR2();
  if (parsed.dataset_id === "classifications") void refreshClassificationsFromR2();

  return c.json({ ok: true, dataset_id: parsed.dataset_id, version: parsed.version });
});

/**
 * GET /api/admin/mcp-freshness — observability for the MCP data freshness.
 * Returns, per dataset, the version currently loaded in memory vs the current
 * DB version (+ a `stale` flag), last refresh/attempt timestamps and last
 * error. Lets us see at a glance whether the paid MCP is serving fresh data,
 * instead of trusting it silently (the C1→C2 honesty thread).
 */
adminRoute.get("/mcp-freshness", (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ ok: true, datasets: getMcpFreshness(), checked_at: new Date().toISOString() });
});

// The slice CSV (inside the release ZIP) snapshotted per dataset.
const SNAPSHOT_SLICE: Record<SnapshotDataset, string> = {
  finma: "finma_registry.csv",
  tares: "tares.csv",
};

/**
 * POST /api/admin/snapshot-backfill — one-shot historical backfill of
 * `dataset_snapshots` from the dated R2 ZIPs (powers tariff_changelog /
 * entity_history). Body: { dataset_id: "finma" | "tares" }.
 *
 * Iterates every version oldest→newest. FULL snapshots are self-contained →
 * order-independent AND idempotent (INSERT OR IGNORE), so re-running is safe and
 * only adds missing rows. Per-version errors (e.g. a pruned ZIP) are collected,
 * not fatal. Run from INSIDE the container (railway ssh → localhost) to dodge
 * the edge proxy timeout — it downloads + unzips one ZIP per version.
 */
adminRoute.post("/snapshot-backfill", async (c) => {
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: { dataset_id?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  if (body.dataset_id !== "finma" && body.dataset_id !== "tares") {
    return c.json({ error: "dataset_id must be 'finma' or 'tares'" }, 400);
  }
  const ds: SnapshotDataset = body.dataset_id;
  const slice = SNAPSHOT_SLICE[ds];
  const db = getDb();
  const versions = db
    .prepare("SELECT version, r2_key, released_at FROM versions WHERE dataset_id=? ORDER BY released_at ASC")
    .all(ds) as { version: string; r2_key: string; released_at: number }[];

  let totalInserted = 0;
  const processed: { version: string; inserted: number; entities: number }[] = [];
  const errors: { version: string; error: string }[] = [];
  for (const v of versions) {
    try {
      // 60 MB cap: the TARES ZIP carries embeddings (~25 MB); still guards
      // against a wrong key pointing at a much larger object.
      const zip = await getObjectBuffer(v.r2_key, { maxBytes: 60_000_000 });
      const csv = await extractCsvFromZip(zip, slice);
      const rows = parseCsvSync(csv, {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
      }) as Array<Record<string, string>>;
      const recordedAt = v.released_at || getReleasedAt(db, ds, v.version);
      const r = snapshotFromRows(db, ds, v.version, recordedAt, rows);
      totalInserted += r.inserted;
      processed.push({ version: v.version, inserted: r.inserted, entities: r.entities });
    } catch (e) {
      errors.push({ version: v.version, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({
    ok: true,
    dataset_id: ds,
    versions_total: versions.length,
    versions_ok: processed.length,
    versions_failed: errors.length,
    total_inserted: totalInserted,
    processed,
    errors,
  });
});
