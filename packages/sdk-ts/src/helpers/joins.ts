/**
 * Left join two arrays of records by a computed key.
 */
export function joinBy<A, B>(
  left: A[],
  right: B[],
  leftKey: (a: A) => string,
  rightKey: (b: B) => string
): Array<A & B> {
  const map = new Map<string, B>();
  for (const r of right) map.set(rightKey(r), r);
  const out: Array<A & B> = [];
  for (const l of left) {
    const match = map.get(leftKey(l));
    if (match) out.push({ ...l, ...match });
  }
  return out;
}
