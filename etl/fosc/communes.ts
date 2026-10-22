/**
 * Siège d'un avis HR → numéro OFS et canton de la commune.
 *
 * Le schéma HR livre `seat` comme un NOM (« désignation actuelle de la commune politique (selon
 * l'OFS) », documentation du schéma 1.26), jamais un numéro ; la documentation de l'API précise
 * que le numéro OFS de commune n'existe pas sur les avis de la FOSC (« no SOGC publications are
 * affected »). Rapprochement EXACT seulement (règle du dépôt) avec le répertoire officiel des
 * localités déjà servi (`src/mcp/data/localities.csv`, swisstopo, colonnes `municipality`,
 * `municipality_bfs_id`, `canton`), nom en forme NFC, espaces de bord retirés :
 *   1. même nom ET même canton que l'avis ;
 *   2. sinon, même nom, s'il ne désigne qu'une seule commune en Suisse (les noms officiels de
 *      l'OFS portent un suffixe cantonal quand ils se répètent, « Buchs (AG) ») : mesuré le
 *      22.10.2026, le canton de l'avis est celui de l'office qui publie, pas toujours celui du
 *      siège (transfert de siège dans un autre canton : 9 cas sur 244 lignes d'un échantillon).
 * Aucun rapprochement approché ; à défaut, `null`, compté dans le rapport du passage.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LOCALITIES_PATH = join(__dirname, "..", "..", "src", "mcp", "data", "localities.csv");

export const SWISS_CANTONS: ReadonlySet<string> = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);

export interface ResolvedCommune { bfs: number; canton: string }
export type CommuneResolver = (seat: string | null, canton: string | null) => ResolvedCommune | null;

const norm = (name: string) => name.normalize("NFC").trim();

/** Construit le résolveur depuis le CSV des localités (texte déjà lu). */
export function communeResolverFromCsv(csv: string, minCommunes = 1000): CommuneResolver {
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const byName = new Map<string, Map<number, string>>();
  for (const row of rows) {
    const name = norm(row.municipality ?? "");
    const canton = row.canton ?? "";
    const id = Number(row.municipality_bfs_id);
    if (!name || !SWISS_CANTONS.has(canton) || !Number.isInteger(id) || id <= 0) continue;
    const ids = byName.get(name) ?? new Map<number, string>();
    if (ids.has(id) && ids.get(id) !== canton) throw new Error("Répertoire des communes incohérent (une commune dans deux cantons)");
    ids.set(id, canton);
    byName.set(name, ids);
  }
  const communes = new Set([...byName.values()].flatMap((m) => [...m.keys()]));
  if (communes.size < minCommunes) throw new Error(`Répertoire des communes trop court (${communes.size} communes)`);
  return (seat, canton) => {
    if (!seat) return null;
    const ids = byName.get(norm(seat));
    if (!ids) return null;
    const sameCanton = [...ids].filter(([, c]) => c === canton);
    if (sameCanton.length === 1) return { bfs: sameCanton[0][0], canton: sameCanton[0][1] };
    if (sameCanton.length === 0 && ids.size === 1) {
      const [[bfs, c]] = [...ids];
      return { bfs, canton: c };
    }
    return null;
  };
}

export function loadCommuneResolver(path = DEFAULT_LOCALITIES_PATH): CommuneResolver {
  return communeResolverFromCsv(readFileSync(path, "utf8"));
}
