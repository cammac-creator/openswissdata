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
