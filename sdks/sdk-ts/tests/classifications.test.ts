import { describe, expect, it } from "vitest";
import { Client } from "../src/index.js";
import { makeMock, rpcOk } from "./_mock.js";

describe("classifications", () => {
  it("crossWalk() forwards source/target/code", async () => {
    const fixture = {
      source_scheme: "NACE_2.0",
      target_scheme: "NOGA_2025",
      source_code: "62.01",
      mappings: [
        {
          source_code: "62.01",
          target_code: "62.01",
          mapping_type: "exact",
          notes: "",
        },
      ],
      count: 1,
    };
    const { fetch, calls } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const r = await client.classifications.crossWalk({
      code: "62.01",
      source: "NACE_2.0",
      target: "NOGA_2025",
    });
    expect(r.mappings[0]!.target_code).toBe("62.01");

    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.params.name).toBe("cross_walk");
    expect(body.params.arguments).toEqual({
      code: "62.01",
      source: "NACE_2.0",
      target: "NOGA_2025",
    });
  });

  it("classifyText() returns ranked NOGA hits", async () => {
    const fixture = {
      query: "vente de café en grain",
      scheme_requested: "NOGA_2025",
      scheme_returned: "NOGA_2025",
      hits: [
        { code: "47.29", label_fr: "Commerce de détail alimentaire spécialisé", score: 0.81 },
        { code: "47.26", label_fr: "Commerce de tabac", score: 0.42 },
      ],
      count: 2,
      model: "Xenova/paraphrase-multilingual-mpnet-base-v2",
    };
    const { fetch } = makeMock(() => ({ body: rpcOk(1, fixture) }));
    const client = new Client({ fetch, maxRetries: 0 });

    const r = await client.classifications.classifyText({
      text: "vente de café en grain",
      top_k: 2,
    });
    expect(r.scheme_returned).toBe("NOGA_2025");
    expect(r.hits[0]!.code).toBe("47.29");
  });
});
