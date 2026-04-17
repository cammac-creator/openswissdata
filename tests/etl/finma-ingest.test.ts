import { describe, it, expect } from "vitest";
import { ingestOneSource } from "../../etl/finma/ingest.js";
import { unifyRow } from "../../etl/finma/unify-schema.js";
import { FINMA_SOURCES } from "../../etl/finma/sources.js";
import { join } from "node:path";

const fixtureDir = join(process.cwd(), "etl/finma/fixtures");

describe("finma sources registry", () => {
  it("exposes 10 distinct entity types", () => {
    const types = new Set(FINMA_SOURCES.map(s => s.entity_type));
    expect(types.size).toBe(10);
  });

  it("every source has a headers_map mapping to 'name'", () => {
    for (const s of FINMA_SOURCES) {
      const values = Object.values(s.headers_map);
      expect(values).toContain("name");
    }
  });
});

describe("unifyRow", () => {
  it("normalizes a bank row with Swiss UID format", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "bank")!;
    const unified = unifyRow({
      "Name": "UBS Switzerland AG",
      "UID": "CHE-101.329.561",
      "Canton": "ZH",
      "Licence date": "15.06.2014",
    }, source);
    expect(unified).toBeDefined();
    expect(unified?.name).toBe("UBS Switzerland AG");
    expect(unified?.uid).toBe("CHE-101.329.561");
    expect(unified?.canton).toBe("ZH");
    expect(unified?.licence_date).toBe("2014-06-15");
    expect(unified?.entity_type).toBe("bank");
    expect(unified?.source_list).toBe("finma-banks");
  });

  it("returns null when no name column matches", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "bank")!;
    const unified = unifyRow({ "Random": "value" }, source);
    expect(unified).toBe(null);
  });

  it("handles DD.MM.YYYY dates", () => {
    const source = FINMA_SOURCES[0];
    const unified = unifyRow({ "Name": "X AG", "Licence date": "01.01.2020" }, source);
    expect(unified?.licence_date).toBe("2020-01-01");
  });

  it("keeps ISO dates as-is", () => {
    const source = FINMA_SOURCES[0];
    const unified = unifyRow({ "Name": "Y AG", "Licence date": "2023-03-15" }, source);
    expect(unified?.licence_date).toBe("2023-03-15");
  });

  it("canonicalizes UID with 9 raw digits", () => {
    const source = FINMA_SOURCES[0];
    const unified = unifyRow({ "Name": "Z AG", "UID": "CHE123456789" }, source);
    expect(unified?.uid).toBe("CHE-123.456.789");
  });
});

describe("ingestOneSource — synthetic fixtures", () => {
  it("parses banks fixture → 5 rows", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "bank")!;
    const rows = ingestOneSource(join(fixtureDir, "finma-banks-sample.xlsx"), source);
    expect(rows.length).toBe(5);
    const ubs = rows.find(r => r.name.includes("UBS"));
    expect(ubs?.canton).toBe("ZH");
    expect(ubs?.uid).toBe("CHE-101.329.561");
  });

  it("parses PSP fixture → 4 rows with fintech licence", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "payment_institution")!;
    const rows = ingestOneSource(join(fixtureDir, "finma-psp-sample.xlsx"), source);
    expect(rows.length).toBe(4);
    expect(rows.every(r => r.entity_type === "payment_institution")).toBe(true);
  });

  it("parses insurance fixture → 4 rows", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "insurance")!;
    const rows = ingestOneSource(join(fixtureDir, "finma-insurance-sample.xlsx"), source);
    expect(rows.length).toBe(4);
    const zurich = rows.find(r => r.name.includes("Zurich Insurance"));
    expect(zurich?.status).toBe("active");
  });

  it("parses asset managers individual fixture → 2 rows", () => {
    const source = FINMA_SOURCES.find(s => s.entity_type === "asset_manager_individual")!;
    const rows = ingestOneSource(join(fixtureDir, "finma-asset-manager-individual-sample.xlsx"), source);
    expect(rows.length).toBe(2);
  });
});
