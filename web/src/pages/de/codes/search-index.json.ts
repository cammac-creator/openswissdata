/**
 * GET /de/codes/search-index.json — NOGA search index (DE labels).
 */
import type { APIRoute } from "astro";
import { loadNoga2025, dottedCode } from "../../../lib/noga-helpers";

export const prerender = true;

export const GET: APIRoute = () => {
  const searchIndex = loadNoga2025()
    .filter((r) => r.level === "section" || r.level === "division" || r.level === "group" || r.level === "class")
    .map((r) => ({ code: r.code, label: r.label_de || r.label_fr, dotted: dottedCode(r.code), href: `/de/codes/noga/${r.code}` }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=31536000",
    },
  });
};
