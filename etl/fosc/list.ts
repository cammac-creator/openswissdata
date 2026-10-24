/**
 * Lecture d'une page de la liste des avis (`/api/v1/publications`, JSON), en mémoire seulement.
 * Seuls les champs de métadonnées utiles sortent de ce module : identifiant technique, numéro de
 * sous-rubrique, date de publication, état, échéance et canton. Le titre (raison sociale et
 * siège), l'office et le texte juridique de la liste ne sont jamais lus.
 */
import { PUBLICATION_ID_RE } from "./sources.js";

export interface ListEntry {
  id: string;
  subRubric: string;
  publicationDate: string;
  publicationState: string;
  /** AAAA-MM-JJ, ou null (cas de tous les avis HR relevés le 22.10.2026). */
  expirationDate: string | null;
  /** Premier canton de `meta.cantons` (un seul canton pour 1 187 avis sur 1 187 le 20.10.2026). */
  canton: string | null;
  /**
   * Présent (et vrai) seulement si `meta.cantons` porte plusieurs cantons distincts : 62 avis de
   * faillite, de concordat ou d'appel aux créanciers sur 1 451 en portaient deux, du 19 au
   * 23.10.2026. Le classement de ces rubriques ne retient alors pas le canton de la liste
   * (`insolvency.ts`) ; celui des avis HR est inchangé.
   */
  multipleCantons?: true;
}

export interface ListPage { total: number; entries: ListEntry[] }

export class FoscListError extends Error {
  constructor(reason: string) {
    super(`Liste des avis illisible (${reason})`);
    this.name = "FoscListError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const SUBRUBRIC_RE = /^[A-Z]{2}\d{2}$/;

function datePart(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return value.slice(0, 10);
}

export function parseListPage(body: unknown): ListPage {
  if (!body || typeof body !== "object") throw new FoscListError("réponse non JSON");
  const { total, content } = body as { total?: unknown; content?: unknown };
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) throw new FoscListError("total absent");
  if (!Array.isArray(content)) throw new FoscListError("contenu absent");
  const entries: ListEntry[] = [];
  for (const item of content) {
    const meta = (item as { meta?: Record<string, unknown> } | null)?.meta;
    if (!meta || typeof meta !== "object") throw new FoscListError("métadonnées absentes");
    const id = meta.id;
    if (typeof id !== "string" || !PUBLICATION_ID_RE.test(id)) throw new FoscListError("identifiant d'avis invalide");
    const subRubric = typeof meta.subRubric === "string" && SUBRUBRIC_RE.test(meta.subRubric) ? meta.subRubric : null;
    if (!subRubric) throw new FoscListError("sous-rubrique invalide");
    const publicationDate = datePart(meta.publicationDate);
    if (!publicationDate) throw new FoscListError("date de publication invalide");
    const publicationState = typeof meta.publicationState === "string" ? meta.publicationState : "";
    const cantons = Array.isArray(meta.cantons) ? meta.cantons.filter((c): c is string => typeof c === "string") : [];
    entries.push({
      id,
      subRubric,
      publicationDate,
      publicationState,
      expirationDate: datePart(meta.expirationDate),
      canton: cantons[0] ?? null,
      ...(new Set(cantons).size > 1 ? { multipleCantons: true as const } : {}),
    });
  }
  return { total, entries };
}
