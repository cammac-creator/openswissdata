// Guichet d'envoi du bureau de Claude-Alain (boîte générale, étape 1, sa décision du 10.11.2026 : « voir ce
// que font ses robots, et leurs pannes »). Contrat : `~/bureau/docs/guichet-contrat.md`, « pas de réponse =
// pas d'envoi ». Chaque lettre institutionnelle demande la permission au guichet, UN destinataire à la fois,
// juste avant l'envoi, puis dit son issue (`letters-sender.ts`) ; le programme dit aussi sa santé
// (`robot-sante.ts`). Le programme `openswissdata` est connu du bureau par son jeton (`GUICHET_JETON`),
// jamais écrit dans le dépôt ni dans un journal ; l'adresse du guichet est `GUICHET_URL`.
//
// Tout ce qui n'est pas « HTTP 200 et `autorise === true` avec un identifiant » vaut refus : délai dépassé,
// réseau, 401, 404, 409, 422, 5xx, réponse non JSON, `"true"` écrit comme du texte. Ce module ne lève
// jamais : il rend un code fermé. Aucune adresse, aucun objet, aucun texte du guichet ne sort d'ici.
import { domainToASCII } from "node:url";

// Adresse du guichet : variable du serveur `GUICHET_URL` (Railway est hors du serveur commun, donc
// l'adresse publique du bureau, en https), jamais écrite dans ce dépôt public.
/** Une borne TOTALE par requête, plus serrée que le contrat (3 s pour se connecter, 5 s par lecture). */
const REQUEST_TIMEOUT_MS = 5_000;

export type GuichetIssue = "parti" | "echec" | "annule";

/** Codes de panne admis par le bureau (`docs/API.md`, « Robots et pannes ») ; tout autre code vaut 422. */
export const PANNE_CODES = [
  "credit_epuise",
  "cle_refusee",
  "service_injoignable",
  "boite_injoignable",
  "envoi_refuse",
  "collecte_arretee",
  "autre",
] as const;
export type PanneCode = (typeof PANNE_CODES)[number];

/** Corps d'une santé : ces champs et aucun autre (un champ inconnu vaut 422 au bureau). */
export type SanteBody =
  | { etat: "ok"; code: "ok"; n: number }
  | { etat: "panne"; code: PanneCode; depuis: string; n: number };

/**
 * Refus, en code fermé (pour le témoin et le journal, jamais le texte du guichet) :
 * `not_configured`, `timeout`, `unreachable`, `http_<statut>`, `not_json`, `malformed` (pas un « oui » net),
 * et pour un « non » explicite : `arret`, `plafond`, `borne`, `boite`, `domaine`, `registre`, `refus`.
 */
export type GuichetDemande = { ok: true; id: string } | { ok: false; code: string };

export interface GuichetClient {
  /** Un jeton et une adresse exploitables sont présents (sans les exposer). */
  configured(): boolean;
  /** La permission d'envoyer UN message à UN destinataire, maintenant. */
  demande(boite: string, domaine: string): Promise<GuichetDemande>;
  /** Ce qui est arrivé à un envoi autorisé. Au mieux : une issue perdue n'autorise rien de plus. */
  issue(id: string, issue: GuichetIssue): Promise<boolean>;
  /** La santé du programme ; rend le statut HTTP, ou `null` sans réponse. */
  sante(body: SanteBody): Promise<number | null>;
}

/**
 * Le jeton du programme, ou `null`. Il entre dans un en-tête : caractères imprimables seulement, et
 * 32 signes au moins (le bureau refuse d'enregistrer un jeton plus court).
 */
export function guichetToken(value: string | undefined = process.env.GUICHET_JETON): string | null {
  const token = value?.trim() ?? "";
  return /^[\x21-\x7E]{32,512}$/.test(token) ? token : null;
}

/** L'adresse du guichet, ou `null` : https seulement, sans identifiant, requête ni fragment. */
export function guichetUrl(value: string | undefined = process.env.GUICHET_URL): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Adresse nue (sans `Nom <...>`), en minuscules. */
export function bareAddress(value: string): string {
  const match = /<([^>]+)>\s*$/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
}

/**
 * Domaine réellement utilisé pour l'envoi : après le DERNIER « @ », en minuscules, en punycode pour un
 * domaine accentué. `null` si l'adresse n'en a pas.
 */
export function recipientDomain(address: string): string | null {
  const bare = bareAddress(address);
  const at = bare.lastIndexOf("@");
  if (at < 1 || at === bare.length - 1) return null;
  const ascii = domainToASCII(bare.slice(at + 1));
  return ascii ? ascii.toLowerCase() : null;
}

/** Raison fixe d'un refus du guichet → code fermé (la raison elle-même n'est jamais recopiée). */
export function refusalCode(raison: unknown): string {
  const text = typeof raison === "string" ? raison.trim().toLowerCase() : "";
  if (text.startsWith("arrêt")) return "arret";
  if (text.startsWith("plafond")) return "plafond";
  if (text.startsWith("borne")) return "borne";
  if (text.startsWith("registre")) return "registre";
  if (text.startsWith("domaine")) return "domaine";
  if (text.includes("boîte") || text.startsWith("aucun envoi")) return "boite";
  return "refus";
}

type PostResult = { status: number; body: unknown; parsed: boolean } | { error: "timeout" | "unreachable" };

export type GuichetOptions = {
  /** Adresse fixe (essais, serveur local) ; sans elle, `GUICHET_URL` est relue à chaque appel. */
  url?: string | null;
  /** Jeton fixe (essais) ; sans lui, `GUICHET_JETON` est relu à chaque appel. */
  token?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export function createGuichetClient(options: GuichetOptions = {}): GuichetClient {
  const urlOf = () => (options.url !== undefined ? options.url : guichetUrl());
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const tokenOf = () => (options.token !== undefined ? options.token : guichetToken());
  const fetcher: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function post(url: string, path: string, payload: unknown, token: string, readBody: boolean): Promise<PostResult> {
    try {
      const response = await fetcher(`${url}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        // Corps en chaîne : une longueur connue (le bureau répond 411 sans elle).
        body: JSON.stringify(payload),
        // Une redirection emporterait le jeton ailleurs : jamais suivie.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!readBody || response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return { status: response.status, body: null, parsed: false };
      }
      try {
        // Lu sous le même délai : un corps qui traîne vaut « délai dépassé ».
        return { status: response.status, body: (await response.json()) as unknown, parsed: true };
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return { error: "timeout" };
        return { status: response.status, body: null, parsed: false };
      }
    } catch (error) {
      // Le message d'une erreur réseau peut citer l'adresse : seul un code fermé est gardé.
      return { error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unreachable" };
    }
  }

  return {
    configured: () => tokenOf() !== null && urlOf() !== null,

    async demande(boite, domaine) {
      const token = tokenOf();
      const url = urlOf();
      if (!token || !url) return { ok: false, code: "not_configured" };
      const result = await post(url, "/demande", { boite, domaine }, token, true);
      if ("error" in result) return { ok: false, code: result.error };
      if (result.status !== 200) return { ok: false, code: `http_${result.status}` };
      if (!result.parsed) return { ok: false, code: "not_json" };
      const body = result.body as { autorise?: unknown; id?: unknown; raison?: unknown } | null;
      if (body && typeof body === "object" && body.autorise === true && typeof body.id === "string" && /^[\x21-\x7E]{1,100}$/.test(body.id)) {
        return { ok: true, id: body.id };
      }
      if (body && typeof body === "object" && body.autorise === false) return { ok: false, code: refusalCode(body.raison) };
      return { ok: false, code: "malformed" };
    },

    async issue(id, issue) {
      const token = tokenOf();
      const url = urlOf();
      if (!token || !url) return false;
      const result = await post(url, "/issue", { id, issue }, token, false);
      return !("error" in result) && result.status === 200;
    },

    async sante(body) {
      const token = tokenOf();
      const url = urlOf();
      if (!token || !url) return null;
      const result = await post(url, "/sante", body, token, false);
      return "error" in result ? null : result.status;
    },
  };
}
