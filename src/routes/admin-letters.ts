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
import { readLettersPause, writeLettersPause } from "../lib/letters-sender.js";

// Pas de caractère de contrôle (ni retour à la ligne) : l'objet et le motif
// deviendront un en-tête de mail (tâche 2) — bloque une injection d'en-tête.
const NO_CONTROL_CHARS_RE = /^[^\u0000-\u001f\u007f]*$/;

const CreateLetterSchema = z
  .object({
    to: z.string().trim().min(3).max(320),
    cc: z.string().trim().min(3).max(320).optional(),
    // `min(15)` (correction finale du 06.10.2026, mineur) : un objet de moins de 15 caractères est
    // presque toujours un gabarit oublié ou un essai, jamais une vraie demande à une autorité.
    subject: z.string().trim().min(15).max(200).regex(NO_CONTROL_CHARS_RE),
    body: z.string().trim().min(1).max(8000),
    purpose: z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS_RE),
  })
  .strict();

/** `POST /:id/reply` (correction finale du 06.10.2026, item 4) : marquage manuel d'une réponse humaine. */
const ReplySchema = z.object({ kind: z.literal("human") }).strict();
/** `POST /pause` (correction finale du 06.10.2026, item 4). */
const PauseSchema = z.object({ paused: z.boolean() }).strict();

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
      // `scheduled_at` des lettres qui occupent encore un créneau, PLUS `attempted_at` des lettres
      // `failed` (correction B, 06.10, cf. letters-sender.ts) : une lettre tentée puis échouée a
      // consommé une des cinq places du jour où elle a été tentée, même si elle n'occupe plus de
      // créneau par son statut.
      // UNION ALL, jamais UNION seul : deux lettres distinctes dont les valeurs coïncident
      // exactement (même minute, voire même ms) ne doivent jamais être dédoublonnées en une
      // seule occupation — cela sous-compterait le plafond du jour.
      const existing = database
        .prepare(
          `SELECT scheduled_at FROM institutional_letters WHERE status IN ${OCCUPYING_STATUSES}
           UNION ALL
           SELECT attempted_at FROM institutional_letters WHERE status='failed' AND attempted_at IS NOT NULL`,
        )
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

  /**
   * POST /:id/reply `{ kind: "human" }` — marquage manuel d'une réponse humaine reçue hors de la
   * boîte surveillée (ex. par téléphone), ou confirmation d'une réponse déjà vue ailleurs
   * (correction finale du 06.10.2026, item 4 ; affinée par la correction finale 2, item 6). Arrête la
   * relance comme un rattachement automatique (même `reply_kind`). `:id` peut être l'identifiant
   * d'une RELANCE : on écrit alors sur la lettre D'ORIGINE (`parent_id`), jamais sur la relance
   * elle-même — c'est elle que `letters-sender.ts` consulte. 404 lettre (ou lettre d'origine)
   * inconnue ; 409 lettre pas encore `sent`/`failed` (jamais réclamée ou jamais tentée) ; déjà
   * `human` : 200 sans rien changer. Déjà `unverified` (domaine/objet/date déjà rattachés par la
   * veille courrier, authenticité seule en cause) : on se contente de confirmer `human` sans toucher
   * à `reply_at`/`reply_from`/`reply_subject` — ne jamais écraser une vraie correspondance déjà
   * connue par le texte générique ci-dessous, qui ne sert qu'au tout premier rattachement.
   */
  route.post("/:id/reply", async (c) => {
    const parsed = ReplySchema.safeParse(
      await c.req.json().catch((error) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      }),
    );
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const id = c.req.param("id");
    const database = db();
    const row = database
      .prepare("SELECT id, kind, parent_id, status, to_address, reply_kind FROM institutional_letters WHERE id = ?")
      .get(id) as { id: string; kind: string; parent_id: string | null; status: string; to_address: string; reply_kind: string | null } | undefined;
    if (!row) return c.json({ error: "not_found" }, 404);

    // Une relance pointe toujours vers la lettre D'ORIGINE (comme `mail-watch.ts`/`letters-sender.ts`).
    const letter =
      row.kind === "reminder" && row.parent_id
        ? ((database
            .prepare("SELECT id, status, to_address, reply_kind FROM institutional_letters WHERE id = ?")
            .get(row.parent_id) as { id: string; status: string; to_address: string; reply_kind: string | null } | undefined) ?? null)
        : row;
    if (!letter) return c.json({ error: "not_found" }, 404); // défensif : clé étrangère, ne devrait jamais arriver

    if (letter.status !== "sent" && letter.status !== "failed") {
      return c.json({ error: "not_sent", status: letter.status }, 409);
    }
    if (letter.reply_kind === "human") return c.json({ ok: true, reply_kind: "human" });
    if (letter.reply_kind === "unverified") {
      database
        .prepare("UPDATE institutional_letters SET reply_kind = 'human', reply_processed_at = NULL WHERE id = ?")
        .run(letter.id);
      return c.json({ ok: true, reply_kind: "human" });
    }

    database
      .prepare(
        "UPDATE institutional_letters SET reply_at = ?, reply_from = ?, reply_subject = 'marqué manuellement', " +
          "reply_kind = 'human', reply_processed_at = NULL WHERE id = ?",
      )
      .run(now(), domainOf(letter.to_address), letter.id);
    return c.json({ ok: true, reply_kind: "human" });
  });

  /**
   * POST /pause `{ paused: boolean }` et GET /pause (correction finale du 06.10.2026, item 4) : lue
   * par `letters-sender.ts` à chaque passage — en pause, rien n'est réclamé ni créé.
   */
  route.post("/pause", async (c) => {
    const parsed = PauseSchema.safeParse(
      await c.req.json().catch((error) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      }),
    );
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    writeLettersPause(parsed.data.paused, now(), db());
    return c.json({ ok: true, paused: parsed.data.paused });
  });
  route.get("/pause", (c) => c.json(readLettersPause(db())));

  return route;
}

/** Domaine (pour `reply_from`, jamais l'adresse), même convention que `mail-watch.ts`/`letters-sender.ts`. */
function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).trim().toLowerCase();
}

export const adminLettersRoute = createAdminLettersRoute();
