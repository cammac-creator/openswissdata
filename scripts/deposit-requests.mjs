// Dépôt des demandes de licence aux distributeurs officiels (plan du 08.10.2026).
//
// SEULE étape de la tâche hebdomadaire qui reçoit le secret d'administration (`ADMIN_SECRET`) :
// Node pur, aucune dépendance, aucune lecture réseau autre que l'API d'OpenSwissData. Elle reçoit un
// lot DÉJÀ préparé par `scripts/prospect-requests.ts generate` (sans secret), le vérifie, le dépose
// par `POST /api/admin/letters` (le serveur refait tous les contrôles : domaine, doublon 120 jours,
// plafond hebdomadaire, créneau), puis relit le statut des seules demandes de licence.
//
// Usage : node scripts/deposit-requests.mjs <lot.json> <resultats.json>
// Variables : ADMIN_SECRET (obligatoire), OSD_API_BASE (défaut https://www.openswissdata.com).
// Le secret part dans un en-tête, jamais dans une adresse, un argument ou un journal. Le journal
// (dépôt GitHub public) ne montre que l'éditeur et l'issue de chaque dépôt, jamais une adresse.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PREFIX = "demande-licence:";
const MAX_LETTERS = 3; // même plafond que le serveur (LICENCE_REQUEST_WEEKLY_CAP)
const TIMEOUT_MS = 30_000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Refuse tout lot suspect AVANT le moindre appel : rien n'est posté si une seule lettre cloche. */
export function validateLot(lot) {
  if (!lot || typeof lot !== "object" || !Array.isArray(lot.letters)) throw new Error("lot illisible");
  if (lot.letters.length > MAX_LETTERS) throw new Error(`plus de trois lettres dans le lot (${lot.letters.length})`);
  const seen = new Set();
  for (const l of lot.letters) {
    for (const field of ["organisation", "to", "subject", "body", "purpose"]) {
      if (typeof l?.[field] !== "string" || l[field].trim() === "") throw new Error(`champ ${field} manquant`);
    }
    if (!l.purpose.startsWith(PREFIX) || l.purpose !== `${PREFIX}${l.organisation}`) throw new Error("motif inattendu");
    if (CONTROL_CHARS.test(l.subject) || CONTROL_CHARS.test(l.purpose) || CONTROL_CHARS.test(l.to)) throw new Error("caractère de contrôle");
    if (seen.has(l.purpose)) throw new Error("éditeur en double dans le lot");
    seen.add(l.purpose);
  }
  return lot;
}

function outcomeOf(status) {
  if (status === 200) return "deposee";
  if (status === 409) return "deja_deposee";
  if (status === 429) return "plafond";
  if (status === 400) return "refusee";
  return "erreur";
}

/**
 * Dépose chaque lettre puis relit les statuts. Renvoie `{ deposits, statuses, failed }` sans aucune
 * adresse : `statuses` ne garde que le motif, le statut et la date de création des lettres d'origine
 * (jamais les relances, jamais une information tirée d'une réponse reçue).
 */
export async function depositRequests({ lot, secret, apiBase, fetchImpl = fetch }) {
  if (!secret) throw new Error("ADMIN_SECRET manquant : aucun dépôt");
  validateLot(lot);
  const base = apiBase.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", "x-admin-secret": secret, "user-agent": "osd-demandes-licence" };
  const deposits = [];
  let capReached = false;
  let failed = false;

  for (const l of lot.letters) {
    if (capReached) {
      deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome: "plafond", http_status: null });
      continue;
    }
    let status = null;
    try {
      const res = await fetchImpl(`${base}/api/admin/letters`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: l.to, subject: l.subject, body: l.body, purpose: l.purpose }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch {
      status = null;
    }
    const outcome = status === null ? "erreur" : outcomeOf(status);
    if (outcome === "plafond") capReached = true;
    if (outcome === "refusee" || outcome === "erreur") failed = true;
    deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome, http_status: status });
    console.log(`dépôt ${l.organisation} : ${outcome}${status === null ? "" : ` (HTTP ${status})`}`);
  }

  let statuses = [];
  try {
    const res = await fetchImpl(`${base}/api/admin/letters`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    statuses = (Array.isArray(body?.letters) ? body.letters : [])
      .filter((r) => r?.kind === "letter" && typeof r.purpose === "string" && r.purpose.toLowerCase().startsWith(PREFIX))
      .map((r) => ({ purpose: r.purpose, status: String(r.status), created_at: Number(r.created_at) }));
  } catch (err) {
    failed = true;
    console.error(`relecture des statuts impossible (${err instanceof Error ? err.message.slice(0, 80) : "erreur"})`);
  }
  return { deposits, statuses, failed };
}

async function main(argv) {
  const [lotPath, resultsPath] = argv;
  if (!lotPath || !resultsPath) {
    console.error("usage : node scripts/deposit-requests.mjs <lot.json> <resultats.json>");
    return 1;
  }
  const lot = JSON.parse(readFileSync(lotPath, "utf8"));
  const results = await depositRequests({
    lot,
    secret: process.env.ADMIN_SECRET ?? "",
    apiBase: process.env.OSD_API_BASE || "https://www.openswissdata.com",
  });
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 1)}\n`);
  return results.failed ? 2 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
