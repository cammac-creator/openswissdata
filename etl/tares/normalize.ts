import type { TaresRow, HierarchyNode } from "./types.js";

const FORBIDDEN_FIELD_PATTERNS = [
  /erl(?:[aä]|ae)ut/i, // Erläuterungen (ä, a, or ae ASCII transliteration)
  /entscheid/i,       // Entscheide
  /explan/i,          // explanatory notes (EN)
  /ruling/i,          // classification rulings (EN)
  /commentaire/i,     // commentaires (FR)
  /décision/i,        // décisions (FR, if accented)
  /decision/i,        // decisions (FR, unaccented)
];

/**
 * Defensive: validate that an ingested row does NOT contain any BAZG-restricted
 * field (Erläuterungen/Entscheide). Returns the list of violating field names,
 * or [] if the row is compliant. MUST be called by future scrapers (Task 2.4)
 * after parsing, before adding to the output set.
 *
 * BAZG approval 2026-04-21 condition 3 prohibits redistribution of these fields.
 */
export function assertNoForbiddenFields(row: Record<string, unknown>): string[] {
  const violations: string[] = [];
  for (const key of Object.keys(row)) {
    for (const pattern of FORBIDDEN_FIELD_PATTERNS) {
      if (pattern.test(key)) {
        violations.push(key);
        break;
      }
    }
  }
  return violations;
}

/**
 * Pads an HS code to 8 digits (TARES CH canonical form).
 * Strips non-digits, right-pads with zeros, truncates at 8.
 */
export function normalizeHsCode(code: string): string {
  const clean = code.replace(/[^0-9]/g, "");
  return clean.padEnd(8, "0").slice(0, 8);
}

/**
 * Builds a parent-child hierarchy from a flat list of HS8 codes.
 * A code's parent is obtained by right-trimming trailing non-zero pairs:
 * - chapter level: XX000000 → no parent
 * - heading: XXXX0000 → parent is XX000000
 * - subheading 6-digit: XXXXXX00 → parent is XXXX0000
 * - 8-digit: XXXXXXXX → parent is XXXXXX00
 */
export function buildHierarchyMap(rows: Pick<TaresRow, "hs8">[]): Record<string, HierarchyNode> {
  const map: Record<string, HierarchyNode> = {};
  for (const r of rows) {
    const c = normalizeHsCode(r.hs8);
    if (!map[c]) {
      map[c] = { code: c, parent: null, children: [] };
    }
  }

  for (const code of Object.keys(map)) {
    const parent = resolveParent(code, map);
    if (parent) {
      map[code].parent = parent;
      map[parent].children.push(code);
    }
  }
  return map;
}

function resolveParent(code: string, existing: Record<string, HierarchyNode>): string | null {
  if (/^.{2}000000$/.test(code)) return null; // chapter is root
  const candidates = [
    code.slice(0, 6) + "00",       // subheading parent (most specific)
    code.slice(0, 4) + "0000",     // heading parent
    code.slice(0, 2) + "000000",   // chapter parent (fallback)
  ];
  for (const parent of candidates) {
    if (parent !== code && existing[parent]) return parent;
  }
  return null;
}
