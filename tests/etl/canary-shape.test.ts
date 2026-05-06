import { describe, it, expect } from "vitest";
import { describeShape, hashJsonShape, hashCsvShape } from "../../scripts/monitor-sources.js";

describe("describeShape (json-shape)", () => {
  it("ignores array length so a single new entry doesn't drift", () => {
    const a = { items: [{ code: "x", name: "X" }] };
    const b = { items: [{ code: "x", name: "X" }, { code: "y", name: "Y" }] };
    expect(describeShape(a, 0)).toBe(describeShape(b, 0));
    expect(hashJsonShape(a)).toBe(hashJsonShape(b));
  });

  it("detects a renamed top-level key", () => {
    const a = { entries: [] };
    const b = { items: [] };
    expect(hashJsonShape(a)).not.toBe(hashJsonShape(b));
  });

  it("detects a renamed nested key", () => {
    const a = { items: [{ code: "x" }] };
    const b = { items: [{ id: "x" }] };
    expect(hashJsonShape(a)).not.toBe(hashJsonShape(b));
  });

  it("detects a type change at the leaves", () => {
    const a = { count: 1 };
    const b = { count: "1" };
    expect(hashJsonShape(a)).not.toBe(hashJsonShape(b));
  });

  it("BFS NOGA case: shape is stable when only codeListEntries grows", () => {
    const noga = (count: number) => ({
      success: true,
      data: {
        registrationStatus: "Recorded",
        codeListEntries: Array.from({ length: count }, (_, i) => ({
          code: String(i),
          name: { de: "x", fr: "x", it: "x", en: "x" },
        })),
      },
    });
    expect(hashJsonShape(noga(1845))).toBe(hashJsonShape(noga(1846)));
  });

  it("BFS NOGA case: shape changes when a new top-level key is added (real i14y change)", () => {
    const before = {
      success: true,
      data: { registrationStatus: "Recorded", codeListEntries: [] },
    };
    const after = {
      success: true,
      data: {
        registrationStatus: "Recorded",
        registrationStatusProposal: "PreferredStandard",
        codeListEntries: [],
      },
    };
    expect(hashJsonShape(before)).not.toBe(hashJsonShape(after));
  });

  it("treats null and missing keys as distinct", () => {
    expect(hashJsonShape({ a: null })).not.toBe(hashJsonShape({}));
  });
});

describe("hashCsvShape", () => {
  const finmaHeaders = "Name;City;AuthorisationTypeDE;AuthorisationTypeFR;AuthorisationTypeIT;AuthorisationTypeEN;UID";
  const finmaCsv = (extraRows: number) =>
    Buffer.from(
      "﻿" +
        finmaHeaders +
        "\r\n" +
        Array.from({ length: extraRows }, (_, i) => `Bank ${i};Zurich;Bank;Banque;Banca;Bank;CHE-${i}`).join("\r\n"),
      "utf-8",
    );

  it("FINMA case: hash is stable when only rows are added or removed", () => {
    const a = hashCsvShape(finmaCsv(2911));
    const b = hashCsvShape(finmaCsv(2950));
    expect(a.hash).toBe(b.hash);
  });

  it("strips the UTF-8 BOM from the first column name", () => {
    const withBom = hashCsvShape(Buffer.from("﻿a;b;c\r\n1;2;3", "utf-8"));
    const without = hashCsvShape(Buffer.from("a;b;c\r\n1;2;3", "utf-8"));
    expect(withBom.hash).toBe(without.hash);
    expect(withBom.headers).toEqual(["a", "b", "c"]);
  });

  it("auto-detects the separator (semicolon vs comma vs tab)", () => {
    expect(hashCsvShape(Buffer.from("a;b;c\n1;2;3")).separator).toBe(";");
    expect(hashCsvShape(Buffer.from("a,b,c\n1,2,3")).separator).toBe(",");
    expect(hashCsvShape(Buffer.from("a\tb\tc\n1\t2\t3")).separator).toBe("\t");
  });

  it("hash differs when a column is renamed", () => {
    const before = hashCsvShape(Buffer.from("Name;City;UID\nA;Bern;X"));
    const after = hashCsvShape(Buffer.from("Name;City;UniqueId\nA;Bern;X"));
    expect(before.hash).not.toBe(after.hash);
  });

  it("hash differs when the separator changes", () => {
    const semi = hashCsvShape(Buffer.from("Name;City;UID\nA;Bern;X"));
    const comma = hashCsvShape(Buffer.from("Name,City,UID\nA,Bern,X"));
    expect(semi.hash).not.toBe(comma.hash);
  });

  it("is order-insensitive (sorted columns) so a column reorder doesn't drift", () => {
    const a = hashCsvShape(Buffer.from("Name;City;UID\nA;Bern;X"));
    const b = hashCsvShape(Buffer.from("UID;Name;City\nX;A;Bern"));
    expect(a.hash).toBe(b.hash);
  });

  it("strips quoted column names", () => {
    const result = hashCsvShape(Buffer.from('"Name";"City"\nA;Bern'));
    expect(result.headers).toEqual(["City", "Name"]);
  });

  it("ignores trailing blank lines when locating headers", () => {
    const result = hashCsvShape(Buffer.from("\r\n\r\nName;City;UID\nA;Bern;X"));
    expect(result.headers).toEqual(["City", "Name", "UID"]);
  });
});
