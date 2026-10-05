/**
 * kyc_check est un outil anonyme : son classement ne doit pas bouger quand finma_search réutilise
 * le même classement. Deux empreintes qui couvrent ensemble la réponse complète (le classement
 * « structured » et le texte « content », rien d'autre), plus les premiers noms en clair pour lire un écart.
 * Séparées le 06.10.2026 (osd.S10) : un changement de formulation ne touche que digest_text.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { kycCheckHandler } from "../../src/mcp/tools/kyc-check.js";
import { _resetDataLoaderCache } from "../../src/mcp/data-loader.js";

const PINNED: Array<{ q: string; total: number; wtotal: number; top: string[]; digest_structured: string; digest_text: string }> = [
  { q: "UBS", total: 9, wtotal: 4, top: ["UBS AG", "UBS Fund Management (Switzerland) AG", "UBS Fund Management (Switzerland) AG"], digest_structured: "c1098106a0c9e491", digest_text: "8c87d460ff8750bf" },
  { q: "ubs ag", total: 6, wtotal: 3, top: ["UBS AG", "UBS Fund Management (Switzerland) AG", "UBS Fund Management (Switzerland) AG"], digest_structured: "36dd910189e87474", digest_text: "555d8959bd5beaee" },
  { q: "Banque Cantonale", total: 8, wtotal: 0, top: ["Banque Cantonale de Fribourg", "Banque Cantonale de Genève", "Banque Cantonale de Genève"], digest_structured: "9084327a8cd3a249", digest_text: "98bd061caebf7e39" },
  { q: "Kantonalbank", total: 22, wtotal: 0, top: ["Urner Kantonalbank", "Appenzeller Kantonalbank", "Basler Kantonalbank"], digest_structured: "18989444fa215087", digest_text: "3c5ac7218cc803eb" },
  { q: "Raiffeisen", total: 211, wtotal: 0, top: ["Raiffeisen Schweiz Genossenschaft", "Banque Raiffeisen d'Assens société coopérative", "Banque Raiffeisen Entremont société coopérative"], digest_structured: "e3a872e925da4912", digest_text: "1358c5413f554860" },
  { q: "Morges Raiffeisen", total: 1, wtotal: 0, top: ["Banque Raiffeisen Morges Venoge société coopérative"], digest_structured: "6af0eccabee1caad", digest_text: "3a47c061d1465ed2" },
  { q: "Zürcher", total: 4, wtotal: 0, top: ["Zürcher Kantonalbank", "Zürcher Kantonalbank", "Zürcher Landbank AG"], digest_structured: "9b5e713eaeba050d", digest_text: "f757ab34e61b6e32" },
  { q: "zurcher kantonalbank", total: 2, wtotal: 0, top: ["Zürcher Kantonalbank", "Zürcher Kantonalbank"], digest_structured: "75c331100f041ef7", digest_text: "29b8e0ff9e707cf8" },
  { q: "Genève", total: 31, wtotal: 2, top: ["Genève Invest Sàrl", "Banque Cantonale de Genève", "Banque Cantonale de Genève"], digest_structured: "81a5d7808ad2ec8a", digest_text: "b293f02b5acf8a74" },
  { q: "Pictet & Cie", total: 3, wtotal: 0, top: ["Banque Pictet & Cie SA", "Banque Pictet & Cie SA", "de Pury Pictet Turrettini & Cie SA"], digest_structured: "3aedbfb38f4701b2", digest_text: "dbaed2b6e5cf034b" },
  { q: "SA", total: 1036, wtotal: 143, top: ["Safe Capital Management SA", "Saffery Trust (Suisse) SA", "Safe & Sound Consulting SA"], digest_structured: "39f07bf01f73baa0", digest_text: "71a2795f80c0ae1b" },
  { q: "invest", total: 243, wtotal: 224, top: ["Invest-Partners Wealth Management AG", "Zurich Invest AG", "LEMANIK INVEST SA"], digest_structured: "9cc5a18d538b688b", digest_text: "a6739d043f941c01" },
  { q: "capital", total: 286, wtotal: 199, top: ["Capital International Sàrl", "Capital International Sàrl", "CAPITAL Y SA"], digest_structured: "cf3f54efff82f7cc", digest_text: "01b2b87c95b2e81d" },
  { q: "Julius Bär", total: 5, wtotal: 0, top: ["Julius Bär Family Office & Trust AG", "Julius Bär Nomura Wealth Management AG", "Bank Julius Bär & Co. AG"], digest_structured: "dea90cc59104a4a1", digest_text: "2516317823c05bdd" },
  { q: "PostFinance", total: 1, wtotal: 0, top: ["PostFinance AG"], digest_structured: "cd0be904be3f2dfb", digest_text: "dc9130d7b75d0032" },
  { q: "crypto", total: 1, wtotal: 51, top: ["Crypto Finance AG"], digest_structured: "3aa2e6d48ee414dc", digest_text: "de77ef18192458b9" },
  { q: "Lombard Odier", total: 4, wtotal: 0, top: ["Lombard Odier Asset Management (Switzerland) SA", "Lombard Odier Asset Management (Switzerland) SA", "Banque Lombard Odier & Cie SA"], digest_structured: "b4bb6396de267ebc", digest_text: "54d7cea0526902ef" },
  { q: "xx", total: 1, wtotal: 0, top: ["Axxets Management (Schweiz) AG"], digest_structured: "50891f27b8831052", digest_text: "a5fa35a91103b66b" },
];

describe("kyc_check : classement figé sur le registre embarqué", () => {
  beforeAll(() => _resetDataLoaderCache());

  it.each(PINNED)("« $q » garde les mêmes correspondances, dans le même ordre", ({ q, total, wtotal, top, digest_structured, digest_text }) => {
    const out = kycCheckHandler({ name: q, top_k: 10 });
    expect(out.structured?.match_total).toBe(total);
    expect(out.structured?.warning_total).toBe(wtotal);
    expect(out.structured?.registry_matches.slice(0, 3).map((m) => m.name)).toEqual(top);
    const empreinte = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
    expect(Object.keys(out).sort()).toEqual(["content", "structured"]);
    expect(empreinte(out.structured)).toBe(digest_structured);
    expect(empreinte({ content: out.content })).toBe(digest_text);
  });
});
