// Règles partagées par le serveur et le bureau : types fermés et note courte, sans coordonnée ni identifiant.
// Le serveur fait foi ; le bureau reprend le même contrôle pour expliquer un refus avant l'envoi.
export const RESOLUTION_KINDS = ['provider_delivery_verified', 'customer_contacted', 'manual_resend', 'no_action'] as const;
export type ResolutionKind = typeof RESOLUTION_KINDS[number];
export const RESOLUTION_NOTE_MAX = 280;
export type ResolutionNoteProblem = 'empty' | 'too_long' | 'control' | 'email' | 'link' | 'identifier';

export function isResolutionKind(value: unknown): value is ResolutionKind {
  return typeof value === 'string' && (RESOLUTION_KINDS as readonly string[]).includes(value);
}

/** Forme enregistrée : retours à la ligne unifiés, tabulations en espaces, bords retirés. */
export function normalizeResolutionNote(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
}

// Contrôles, caractères invisibles de direction et marques bidirectionnelles : l'affichage ne doit pas tromper.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;
// Schéma d'URL, « www. » ou domaine suivi d'un chemin : un domaine seul (« resend.com ») reste permis.
const LINK = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// Références Stripe, clés et jetons préfixés (cs_live_…, pi_…, re_…, whsec_…).
const PREFIXED = /\b(?:cs|pi|ch|py|re|in|cus|sub|evt|whsec|sk|pk|rk|seti|price|prod|acct|txn|tok|src|pm|po|tr|dp|du)_[A-Za-z0-9_]{6,}/;
const LONG_NUMBER = /\d{13,}/;
const OPAQUE_RUN = /[A-Za-z0-9_\-+/=]{20,}/g;
/** Suite opaque : casse mêlée avec chiffres (jeton aléatoire) ou longue suite hexadécimale (empreinte, identifiant). */
function opaque(run: string): boolean {
  return (/\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run)) || /^[0-9a-f]{24,}$/i.test(run.replace(/[-_]/g, ''));
}

/** Le texte reçu doit déjà être normalisé. Retourne la première raison de refus, ou null. */
export function resolutionNoteProblem(note: string): ResolutionNoteProblem | null {
  if (!note) return 'empty';
  if (note.length > RESOLUTION_NOTE_MAX) return 'too_long';
  if (CONTROL.test(note)) return 'control';
  if (EMAIL.test(note)) return 'email';
  if (LINK.test(note)) return 'link';
  if (UUID.test(note) || PREFIXED.test(note) || LONG_NUMBER.test(note) || [...note.matchAll(OPAQUE_RUN)].some(([run]) => opaque(run))) return 'identifier';
  return null;
}
