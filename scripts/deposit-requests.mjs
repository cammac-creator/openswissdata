// Dépôt des demandes de licence aux distributeurs officiels (plan du 08.10.2026).
//
// SEULE étape de la tâche hebdomadaire qui reçoit le secret d'administration (`ADMIN_SECRET`) :
// Node pur, aucune dépendance, aucune lecture réseau autre que l'API d'OpenSwissData. Elle reçoit un
// lot DÉJÀ préparé par `scripts/prospect-requests.ts generate` (sans secret), le vérifie, le dépose
// par `POST /api/admin/letters` (le serveur refait tous les contrôles : domaine, doublon 120 jours,
// plafond hebdomadaire, créneau), puis relit le statut des seules demandes de licence.
//
// Usage : node scripts/deposit-requests.mjs <lot.json> <resultats.json>
// Variable : ADMIN_SECRET (obligatoire). L'adresse du serveur est FIGÉE ici (relecture de sécurité du
// 08.10.2026) : aucune variable d'environnement ne peut la détourner, et aucun appel ne suit une
// redirection (le secret ne part jamais vers une autre adresse).
// Le secret part dans un en-tête, jamais dans une adresse, un argument ou un journal. Le journal
// (dépôt GitHub public) ne montre que l'éditeur et l'issue de chaque dépôt, jamais une adresse.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const API_BASE = "https://www.openswissdata.com";
const PREFIX = "demande-licence:";
// Une même adresse ne reçoit qu'une demande de licence par 30 jours, même pour des éditeurs
// différents (plusieurs offices d'un canton peuvent partager une adresse). Contrôlé ici, seule voie
// automatique de dépôt, à partir des lettres relues sur le serveur (relecture de sécurité du 08.10.2026).
const RECIPIENT_DAYS = 30;
const DAY_MS = 86_400_000;
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
  if (status === 409) return "deja_deposee"; // seul 409 du serveur pour ce motif : `duplicate_purpose`
  if (status === 429) return "plafond";
  if (status === 400) return "refusee";
  return "erreur";
}

/**
 * Lettres d'origine `demande-licence:` connues du serveur. `statuses` (motif, statut, date) sort du
 * script ; `recentRecipients` (adresses en minuscules, demandes non annulées de moins de 30 jours)
 * reste en mémoire, jamais écrit ni journalisé.
 */
async function readLicenceLetters(fetchImpl, base, headers, now) {
  const res = await fetchImpl(`${base}/api/admin/letters`, { headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const rows = (Array.isArray(body?.letters) ? body.letters : []).filter(
    (r) => r?.kind === "letter" && typeof r.purpose === "string" && r.purpose.toLowerCase().startsWith(PREFIX),
  );
  const recentRecipients = new Set(
    rows
      .filter((r) => r.status !== "cancelled" && Number(r.created_at) > now - RECIPIENT_DAYS * DAY_MS && typeof r.to_address === "string")
      .map((r) => r.to_address.toLowerCase()),
  );
  return {
    statuses: rows.map((r) => ({ purpose: r.purpose, status: String(r.status), created_at: Number(r.created_at) })),
    recentRecipients,
  };
}

/**
 * Relit d'abord les lettres du serveur, dépose les seules demandes qu'il ne connaît pas encore (une
 * demande annulée à la main reste une décision humaine : jamais reposée par cette tâche), puis relit
 * les statuts. Liste illisible avant le dépôt : rien n'est posté. Renvoie `{ deposits, statuses,
 * failed }` sans aucune adresse (jamais les relances, jamais une information tirée d'une réponse).
 */
export async function depositRequests({ lot, secret, apiBase = API_BASE, fetchImpl = fetch, now = Date.now }) {
  if (!secret) throw new Error("ADMIN_SECRET manquant : aucun dépôt");
  validateLot(lot);
  const base = apiBase.replace(/\/+$/, "");
  const headers = { "content-type": "application/json", "x-admin-secret": secret, "user-agent": "osd-demandes-licence" };
  const deposits = [];
  let failed = false;

  let known;
  let recentRecipients;
  try {
    const before = await readLicenceLetters(fetchImpl, base, headers, now());
    known = new Set(before.statuses.map((r) => r.purpose.toLowerCase()));
    recentRecipients = before.recentRecipients;
  } catch (err) {
    console.error(`lettres du serveur illisibles avant le dépôt (${err instanceof Error ? err.message.slice(0, 80) : "erreur"}) : rien n'est posté`);
    for (const l of lot.letters) deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome: "erreur", http_status: null });
    return { deposits, statuses: [], failed: true };
  }

  let capReached = false;
  for (const l of lot.letters) {
    if (known.has(l.purpose.toLowerCase())) {
      deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome: "deja_deposee", http_status: null });
      console.log(`dépôt ${l.organisation} : deja_deposee (connue du serveur)`);
      continue;
    }
    if (recentRecipients.has(l.to.toLowerCase())) {
      deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome: "destinataire_recent", http_status: null });
      console.log(`dépôt ${l.organisation} : destinataire_recent (adresse déjà sollicitée depuis moins de ${RECIPIENT_DAYS} jours)`);
      continue;
    }
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
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch {
      status = null;
    }
    const outcome = status === null ? "erreur" : outcomeOf(status);
    if (outcome === "plafond") capReached = true;
    if (outcome === "deposee") recentRecipients.add(l.to.toLowerCase());
    if (outcome === "refusee" || outcome === "erreur") failed = true;
    deposits.push({ organisation: l.organisation, purpose: l.purpose, outcome, http_status: status });
    console.log(`dépôt ${l.organisation} : ${outcome}${status === null ? "" : ` (HTTP ${status})`}`);
  }

  let statuses = [];
  try {
    statuses = (await readLicenceLetters(fetchImpl, base, headers, now())).statuses;
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
    apiBase: API_BASE,
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
