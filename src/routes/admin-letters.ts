// Routes d'administration des lettres institutionnelles : dépôt, liste,
// annulation, marquage « traité ». Protégées par `x-admin-secret` (même
// modèle que src/routes/admin.ts), pour le veilleur du Mac (tâche 4) et
// Claude lui-même — aucun envoi ici, aucun worker démarré (tâche 2).
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../lib/db.js";
import { constantTimeEqual } from "../lib/tokens.js";
import { isAllowedRecipient, scheduleSlot, LETTER_STATUSES } from "../lib/letters.js";

// Pas de caractère de contrôle (ni retour à la ligne) : l'objet et le motif
// deviendront un en-tête de mail (tâche 2) — bloque une injection d'en-tête.
const NO_CONTROL_CHARS_RE = /^[^\u0000-\u001f\u007f]*$/;

const CreateLetterSchema = z
  .object({
    to: z.string().trim().min(3).max(320),
    cc: z.string().trim().min(3).max(320).optional(),
    subject: z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS_RE),
    body: z.string().trim().min(1).max(8000),
    purpose: z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS_RE),
  })
  .strict();

const ListQuerySchema = z
  .object({
    status: z.enum(LETTER_STATUSES).optional(),
    replied: z.enum(["1"]).optional(),
    unprocessed: z.enum(["1"]).optional(),
  })
  .strict();

// Jamais `body` dans une liste d'administration.
const LETTER_LIST_COLUMNS =
  "id, kind, parent_id, to_address, cc, subject, purpose, status, scheduled_at, " +
  "lease_until, attempts, resend_id, sent_at, reply_at, reply_from, reply_subject, " +
  "reply_extract, reply_kind, reply_processed_at, created_at";

// Statuts qui occupent encore un créneau : comptent pour le plafond journalier
// et l'écart de 12 min. `cancelled`/`failed` libèrent leur créneau.
const OCCUPYING_STATUSES = "('queued','sending','sent')";

interface AdminLettersDeps {
  now: () => number;
  rng: () => number;
  db: () => Database.Database;
}

const defaultDeps: AdminLettersDeps = {
  now: () => Date.now(),
  rng: () => Math.random(),
  db: getDb,
};

const requireAdminSecret: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const secret = c.req.header("x-admin-secret");
  if (!secret || !constantTimeEqual(secret, process.env.ADMIN_SECRET ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

/**
 * Construit le routeur des lettres institutionnelles. `deps` est injectable
 * (horloge, générateur aléatoire, base) pour des tests déterministes ; la
 * production utilise l'instance par défaut exportée plus bas.
 */
export function createAdminLettersRoute(deps: Partial<AdminLettersDeps> = {}): Hono {
  const { now, rng, db } = { ...defaultDeps, ...deps };
  const route = new Hono();
  route.use("*", requireAdminSecret);

  /**
   * POST / — dépose une lettre, planifiée par `scheduleSlot` (jours ouvrés,
   * 09:05–17:30 Zurich, minute non ronde, écart de 12 min, 5 lettres par
   * jour ouvré au plus). Reste `queued` : l'expéditeur périodique (tâche 2,
   * pas encore démarré) ne tourne pas ici.
   */
  route.post("/", async (c) => {
    const parsed = CreateLetterSchema.safeParse(
      await c.req.json().catch((error) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      }),
    );
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const { to, cc, subject, body, purpose } = parsed.data;

    if (!isAllowedRecipient(to)) return c.json({ error: "recipient_domain_not_allowed" }, 400);
    if (cc !== undefined && !isAllowedRecipient(cc)) {
      return c.json({ error: "cc_domain_not_allowed" }, 400);
    }

    const database = db();
    const id = randomUUID();
    const createdAt = now();

    // Lecture des créneaux occupés, calcul du créneau et insertion dans une
    // seule transaction IMMEDIATE : deux dépôts concurrents ne peuvent pas
    // choisir le même créneau (pas d'`await` entre lecture et écriture).
    const depose = database.transaction(() => {
      const existing = database
        .prepare(`SELECT scheduled_at FROM institutional_letters WHERE status IN ${OCCUPYING_STATUSES}`)
        .all() as Array<{ scheduled_at: number }>;
      const scheduledAt = scheduleSlot(now(), existing.map((r) => r.scheduled_at), rng);
      database
        .prepare(
          `INSERT INTO institutional_letters
            (id, kind, parent_id, to_address, cc, subject, body, purpose, status,
             scheduled_at, lease_until, attempts, resend_id, sent_at, reply_at,
             reply_from, reply_subject, reply_extract, reply_kind, reply_processed_at, created_at)
           VALUES
            (@id, 'letter', NULL, @to_address, @cc, @subject, @body, @purpose, 'queued',
             @scheduled_at, NULL, 0, NULL, NULL, NULL,
             NULL, NULL, NULL, NULL, NULL, @created_at)`,
        )
        .run({
          id,
          to_address: to,
          cc: cc ?? null,
          subject,
          body,
          purpose,
          scheduled_at: scheduledAt,
          created_at: createdAt,
        });
      return scheduledAt;
    });

    const scheduledAt = depose.immediate();
    return c.json({ id, scheduled_at: scheduledAt });
  });

  /**
   * GET /?status=&replied=1&unprocessed=1 — liste sans `body`, triée par
   * date d'envoi planifiée. `replied=1` : une réponse est rattachée
   * (`reply_at` non nul). `unprocessed=1` : rattachée mais pas encore
   * traitée (`reply_processed_at` nul).
   */
  route.get("/", (c) => {
    const parsed = ListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const { status, replied, unprocessed } = parsed.data;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (replied === "1") conditions.push("reply_at IS NOT NULL");
    if (unprocessed === "1") conditions.push("reply_processed_at IS NULL");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db()
      .prepare(
        `SELECT ${LETTER_LIST_COLUMNS} FROM institutional_letters ${where} ` +
          "ORDER BY scheduled_at ASC, created_at ASC, id ASC",
      )
      .all(...params);
    return c.json({ letters: rows });
  });

  /** POST /:id/cancel — seulement une lettre encore `queued`. */
  route.post("/:id/cancel", (c) => {
    const id = c.req.param("id");
    const database = db();
    const result = database
      .prepare("UPDATE institutional_letters SET status = 'cancelled' WHERE id = ? AND status = 'queued'")
      .run(id);
    if (result.changes === 0) {
      const row = database
        .prepare("SELECT status FROM institutional_letters WHERE id = ?")
        .get(id) as { status: string } | undefined;
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json({ error: "not_queued", status: row.status }, 409);
    }
    return c.json({ ok: true });
  });

  /**
   * POST /:id/processed — marque comme traitée la réponse rattachée (par
   * Claude, après la tâche déposée par le veilleur — tâche 4). 409 s'il n'y a
   * pas de réponse rattachée. Rejeu idempotent : déjà traitée → 200 avec la
   * date d'origine, sans écrasement.
   */
  route.post("/:id/processed", (c) => {
    const id = c.req.param("id");
    const database = db();
    const processedAt = now();
    const result = database
      .prepare(
        "UPDATE institutional_letters SET reply_processed_at = ? " +
          "WHERE id = ? AND reply_at IS NOT NULL AND reply_processed_at IS NULL",
      )
      .run(processedAt, id);
    if (result.changes > 0) return c.json({ ok: true, reply_processed_at: processedAt });

    const row = database
      .prepare("SELECT reply_at, reply_processed_at FROM institutional_letters WHERE id = ?")
      .get(id) as { reply_at: number | null; reply_processed_at: number | null } | undefined;
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.reply_at === null) return c.json({ error: "no_reply_attached" }, 409);
    // reply_at non nul et reply_processed_at déjà posé : rejeu, pas une erreur.
    return c.json({ ok: true, reply_processed_at: row.reply_processed_at });
  });

  return route;
}

export const adminLettersRoute = createAdminLettersRoute();
