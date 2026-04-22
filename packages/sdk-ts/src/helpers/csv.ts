import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

export async function parseCsv(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}
