import type { TaresRow, HierarchyNode } from "./types.js";

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
  if (/^.{2}000000$/.test(code)) return null;
  const candidates: string[] = [];
  if (/^.{4}0000$/.test(code) || /^.{6}00$/.test(code) === false) {
    candidates.push(code.slice(0, 6) + "00");
  }
  if (/^.{4}0000$/.test(code) || /^.{4}....$/.test(code)) {
    candidates.push(code.slice(0, 4) + "0000");
  }
  candidates.push(code.slice(0, 2) + "000000");
  for (const parent of candidates) {
    if (parent !== code && existing[parent]) return parent;
  }
  return null;
}
