import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRfc3161Timestamp } from "../../etl/shared/provenance.js";

vi.mock("node:crypto", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  // Nonce fixe pour comparer exactement la requête avant et après le changement de type.
  randomBytes: () => Buffer.from("ff00010203040506", "hex"),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("octets du corps d’horodatage RFC-3161", () => {
  it.each([false, true])("conserve la requête de référence avec recours au secours : %s", async (useFallback) => {
    // Référence vérifiée sur le corps Buffer d’origine : DER, empreinte SHA-256 et nonce.
    const expectedBody = new Uint8Array(Buffer.from(
      "30430201013031300d060960864801650304020105000420" +
      "89273d2f70b93285bb7ddb4bcee86a5347ca7159352e3cbdd20c23e9d1e507d3" +
      "02087f000102030405060101ff",
      "hex",
    ));
    const sentBodies: Uint8Array[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      // Request sérialise le corps comme fetch, sans ouvrir de connexion réseau.
      const request = new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/timestamp-query");
      expect(request.headers.get("accept")).toBe("application/timestamp-reply");
      sentBodies.push(new Uint8Array(await request.arrayBuffer()));
      if (useFallback && sentBodies.length === 1) return new Response(null, { status: 503 });
      return new Response(Uint8Array.of(0x30, 0x00), {
        headers: { "content-type": "application/timestamp-reply" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestRfc3161Timestamp(Buffer.from([0x00, 0x7f, 0x80, 0xff]), {
      primaryUrl: "https://principal.invalid/tsr",
      fallbackUrl: "https://secours.invalid/tsr",
    });

    expect(result.status).toBe(useFallback ? "fallback" : "ok");
    expect(result.rfc3161_timestamp).toBe("MAA=");
    expect(fetchMock).toHaveBeenCalledTimes(useFallback ? 2 : 1);
    for (const body of sentBodies) expect(body).toEqual(expectedBody);
  });
});
