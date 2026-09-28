/**
 * kyc_check est un outil anonyme : son classement ne doit pas bouger quand finma_search réutilise
 * le même classement. Empreinte de la réponse complète sur le registre embarqué, plus les premiers
 * noms en clair pour lire un écart.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { kycCheckHandler } from "../../src/mcp/tools/kyc-check.js";
import { _resetDataLoaderCache } from "../../src/mcp/data-loader.js";

const PINNED: Array<{ q: string; total: number; wtotal: number; top: string[]; digest: string }> = [
  { q: "UBS", total: 9, wtotal: 4, top: ["UBS AG", "UBS Fund Management (Switzerland) AG", "UBS Fund Management (Switzerland) AG"], digest: "be1cf728c7dc0a1c" },
  { q: "ubs ag", total: 6, wtotal: 3, top: ["UBS AG", "UBS Fund Management (Switzerland) AG", "UBS Fund Management (Switzerland) AG"], digest: "2b2e0495e18b1150" },
  { q: "Banque Cantonale", total: 8, wtotal: 0, top: ["Banque Cantonale de Fribourg", "Banque Cantonale de Genève", "Banque Cantonale de Genève"], digest: "15a4e51928927896" },
  { q: "Kantonalbank", total: 22, wtotal: 0, top: ["Urner Kantonalbank", "Appenzeller Kantonalbank", "Basler Kantonalbank"], digest: "5a3606a4d4016db9" },
  { q: "Raiffeisen", total: 211, wtotal: 0, top: ["Raiffeisen Schweiz Genossenschaft", "Banque Raiffeisen d'Assens société coopérative", "Banque Raiffeisen Entremont société coopérative"], digest: "1bbb098b77451e69" },
  { q: "Morges Raiffeisen", total: 1, wtotal: 0, top: ["Banque Raiffeisen Morges Venoge société coopérative"], digest: "42e45d17ed074136" },
  { q: "Zürcher", total: 4, wtotal: 0, top: ["Zürcher Kantonalbank", "Zürcher Kantonalbank", "Zürcher Landbank AG"], digest: "c2f143699e0de95b" },
  { q: "zurcher kantonalbank", total: 2, wtotal: 0, top: ["Zürcher Kantonalbank", "Zürcher Kantonalbank"], digest: "9ce8e95435443920" },
  { q: "Genève", total: 31, wtotal: 2, top: ["Genève Invest Sàrl", "Banque Cantonale de Genève", "Banque Cantonale de Genève"], digest: "a7255151e6297810" },
  { q: "Pictet & Cie", total: 3, wtotal: 0, top: ["Banque Pictet & Cie SA", "Banque Pictet & Cie SA", "de Pury Pictet Turrettini & Cie SA"], digest: "9e21b55a609516cf" },
  { q: "SA", total: 1036, wtotal: 143, top: ["Safe Capital Management SA", "Saffery Trust (Suisse) SA", "Safe & Sound Consulting SA"], digest: "e2ca990f5ac52fbe" },
  { q: "invest", total: 243, wtotal: 224, top: ["Invest-Partners Wealth Management AG", "Zurich Invest AG", "LEMANIK INVEST SA"], digest: "32f9f08175c6d3ae" },
  { q: "capital", total: 286, wtotal: 199, top: ["Capital International Sàrl", "Capital International Sàrl", "CAPITAL Y SA"], digest: "e9acd6baf3b3ef37" },
  { q: "Julius Bär", total: 5, wtotal: 0, top: ["Julius Bär Family Office & Trust AG", "Julius Bär Nomura Wealth Management AG", "Bank Julius Bär & Co. AG"], digest: "4657a7f3c9e8934c" },
  { q: "PostFinance", total: 1, wtotal: 0, top: ["PostFinance AG"], digest: "c02e20c1d22fbde0" },
  { q: "crypto", total: 1, wtotal: 51, top: ["Crypto Finance AG"], digest: "090faeaf079d7bcf" },
  { q: "Lombard Odier", total: 4, wtotal: 0, top: ["Lombard Odier Asset Management (Switzerland) SA", "Lombard Odier Asset Management (Switzerland) SA", "Banque Lombard Odier & Cie SA"], digest: "73367fbb494b399a" },
  { q: "xx", total: 1, wtotal: 0, top: ["Axxets Management (Schweiz) AG"], digest: "5366bc8356ff5c53" },
];

describe("kyc_check : classement figé sur le registre embarqué", () => {
  beforeAll(() => _resetDataLoaderCache());

  it.each(PINNED)("« $q » garde les mêmes correspondances, dans le même ordre", ({ q, total, wtotal, top, digest }) => {
    const out = kycCheckHandler({ name: q, top_k: 10 });
    expect(out.structured?.match_total).toBe(total);
    expect(out.structured?.warning_total).toBe(wtotal);
    expect(out.structured?.registry_matches.slice(0, 3).map((m) => m.name)).toEqual(top);
    expect(createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16)).toBe(digest);
  });
});
