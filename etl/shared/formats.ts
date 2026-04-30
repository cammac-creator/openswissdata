import { stringify } from "csv-stringify/sync";
import parquet from "parquetjs-lite";
import { writeFileSync } from "node:fs";

export function writeCsv(rows: Record<string, unknown>[], path: string): void {
  if (rows.length === 0) { writeFileSync(path, "", "utf8"); return; }
  const csv = stringify(rows, { header: true });
  writeFileSync(path, csv, "utf8");
}

export async function writeParquet<T extends Record<string, unknown>>(
  rows: T[],
  schema: parquet.ParquetSchema,
  path: string
): Promise<void> {
  // @ts-expect-error parquetjs-lite openFile return type not fully typed
  const writer = await parquet.ParquetWriter.openFile(schema, path);
  for (const row of rows) await writer.appendRow(row);
  await writer.close();
}

export function writeJson(data: unknown, path: string): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export function writeSqlInserts(tableName: string, rows: Record<string, unknown>[], path: string): void {
  if (rows.length === 0) { writeFileSync(path, "", "utf8"); return; }
  const cols = Object.keys(rows[0]);
  const ddl = `CREATE TABLE ${tableName} (${cols.map(c => `${c} TEXT`).join(", ")});\n`;
  const inserts = rows.map(r => {
    const vals = cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    }).join(", ");
    return `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${vals});`;
  }).join("\n");
  writeFileSync(path, ddl + inserts + "\n", "utf8");
}

/**
 * Same as writeSqlInserts but emits multi-row INSERTs in chunks of `chunkSize`
 * (default 500) and types each column as TEXT or REAL/INTEGER based on the
 * first non-null value found. Designed for bulk tables (≥10k rows) where
 * one-INSERT-per-row would be unusable.
 */
export function writeSqlInsertsChunked(
  tableName: string,
  rows: Record<string, unknown>[],
  path: string,
  chunkSize = 500,
): void {
  if (rows.length === 0) { writeFileSync(path, "", "utf8"); return; }
  const cols = Object.keys(rows[0]);

  // Infer column SQL types from first non-null sample per column.
  const colTypes = cols.map((c) => {
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
      return "TEXT";
    }
    return "TEXT";
  });

  const ddl =
    `CREATE TABLE ${tableName} (${cols.map((c, i) => `${c} ${colTypes[i]}`).join(", ")});\n` +
    `BEGIN;\n`;

  const formatVal = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const lines: string[] = [ddl];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const tuples = slice
      .map((r) => `(${cols.map((c) => formatVal(r[c])).join(", ")})`)
      .join(",\n  ");
    lines.push(
      `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES\n  ${tuples};`,
    );
  }
  lines.push(`COMMIT;\n`);
  writeFileSync(path, lines.join("\n"), "utf8");
}
