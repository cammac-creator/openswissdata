import { describe, expect, it } from "vitest";
import { Client } from "../src/index.js";
import { makeMock, rpcOk } from "./_mock.js";

describe("finma", () => {
  it("kycCheck() returns registry_matches + warning_matches", async () => {
    const fixture = {
      query: "UBS",
      registry_matches: [
        {
          entity_type: "bank",
          name: "UBS AG",
          uid: "CHE-101.329.561",
          lei: "BFM8T61CT2L1QCEMIK50",
          licence_type: "bank",
          status: "authorised",
          canton: "ZH",
          city: "Zürich",
          is_warning_listed: false,
          source_url: "https://www.finma.ch/...",
        },
      ],
      warning_matches: [],
      match_count: 1,
      warning_count: 0,
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const r = await client.finma.kycCheck({ name: "UBS", top_k: 5 });
    expect(r.registry_matches[0]!.uid).toBe("CHE-101.329.561");
    expect(r.warning_matches).toHaveLength(0);
    expect(r.match_count).toBe(1);
  });

  it("search() returns ranked fuzzy matches", async () => {
    const fixture = {
      query: "Cred Suisse",
      matches: [
        {
          entity_type: "bank",
          name: "Credit Suisse AG",
          uid: "CHE-105.884.030",
          lei: null,
          licence_type: "bank",
          status: "authorised",
          canton: "ZH",
          city: "Zürich",
          is_warning_listed: false,
          source_url: "https://www.finma.ch/...",
          score: 0.91,
        },
      ],
      match_count: 1,
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const r = await client.finma.search({ name: "Cred Suisse" });
    expect(r.matches[0]!.score).toBeGreaterThan(0.9);
  });

  it("entityHistory() returns timeline sorted", async () => {
    const fixture = {
      uid: "CHE-103.137.179",
      current: {
        name: "ACME SA",
        licence_type: "asset_manager_individual",
        status: "authorised",
        canton: "GE",
        city: "Genève",
        is_warning_listed: false,
      },
      timeline: [
        {
          event: "added",
          field: "name",
          old_value: null,
          new_value: "ACME SA",
          recorded_at: 1700000000,
          version: "2024-01-01",
        },
      ],
      versions_observed: ["2024-01-01"],
      source_note: "Source: FINMA registers (non-official copy).",
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const r = await client.finma.entityHistory({ uid: "CHE-103.137.179" });
    expect(r.uid).toBe("CHE-103.137.179");
    expect(r.timeline).toHaveLength(1);
  });
});
