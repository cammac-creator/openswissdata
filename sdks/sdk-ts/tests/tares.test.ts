import { describe, expect, it } from "vitest";
import { Client } from "../src/index.js";
import { makeMock, rpcOk } from "./_mock.js";
import type { TariffLookupResult, TariffSemanticSearchResult } from "../src/types.js";

describe("tares", () => {
  it("lookup() unwraps result.structured", async () => {
    const fixture: TariffLookupResult = {
      hs8: "84620010",
      hs6: "846200",
      chapter: "84",
      heading: "8462",
      designation: "Machines de forgeage",
      designations_all: { fr: "Machines de forgeage", de: "...", it: "...", en: "..." },
      unit_stat: "Stk",
      duty_mfn: { value: 0, unit: "CHF/100kg", currency: "CHF" },
      preferential_regimes: { EFTA: "free" },
      restrictions_codes: [],
      customs_relief_codes: [],
      valid_from: "2025-01-01",
      source_url: "https://xtares.admin.ch/tares/details/84620010",
      disclaimer: "AVIS NON-OFFICIEL ...",
    };

    const { fetch, calls } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const result = await client.tares.lookup({ hs8: "84620010", lang: "fr" });
    expect(result.hs8).toBe("84620010");
    expect(result.duty_mfn.value).toBe(0);
    expect(result.disclaimer).toMatch(/AVIS NON-OFFICIEL/);

    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("tariff_lookup");
    expect(body.params.arguments).toEqual({ hs8: "84620010", lang: "fr" });
  });

  it("search() returns semantic hits", async () => {
    const fixture: TariffSemanticSearchResult = {
      query: "couteau de cuisine",
      hits: [
        { hs_code: "82119100", description: "Couteaux de table", score: 0.84 },
        { hs_code: "82119290", description: "Autres couteaux", score: 0.79 },
      ],
      disclaimer: "AVIS NON-OFFICIEL ...",
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const result = await client.tares.search({ query: "couteau de cuisine", top_k: 5 });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score);
  });

  it("changelog() returns change events", async () => {
    const fixture = {
      hs8: "84620010",
      changes: [
        {
          from_version: "2025-01-01",
          to_version: "2025-04-01",
          field: "duty_mfn_value",
          old_value: "5.0",
          new_value: "4.5",
          recorded_at: 1714512000,
        },
      ],
      current_version: "2025-04-01",
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const result = await client.tares.changelog({ hs8: "84620010", since: "2025-01-01" });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.field).toBe("duty_mfn_value");
  });
});
