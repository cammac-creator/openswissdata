/**
 * Minimal ambient typings for `parquetjs-lite`.
 *
 * The package ships no types and `@types/parquetjs-lite` does not exist.
 * We declare just enough surface to satisfy the MCP data-loader (read path)
 * and the ETL bundlers (write path). Both rely on `tsconfig.exclude` for
 * the ETL and `skipLibCheck` for the rest, so a loose `any`-typed shape is
 * acceptable here — strict typing of upstream's columnar shred logic is
 * not in scope.
 */
declare module "parquetjs-lite" {
  // Reader API used in src/mcp/data-loader.ts
  export class ParquetCursor {
    next(): Promise<unknown | null>;
  }
  export class ParquetReader {
    static openFile(path: string): Promise<ParquetReader>;
    getCursor(): ParquetCursor;
    close(): Promise<void>;
  }
  // Writer API used by ETL (excluded from TS compile but kept for completeness)
  export class ParquetSchema {
    constructor(definition: Record<string, unknown>);
  }
  export class ParquetWriter {
    static openFile(schema: ParquetSchema, path: string): Promise<ParquetWriter>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
  const parquet: {
    ParquetReader: typeof ParquetReader;
    ParquetWriter: typeof ParquetWriter;
    ParquetSchema: typeof ParquetSchema;
  };
  export default parquet;
}
