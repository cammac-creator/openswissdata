/**
 * GET /codes/search-index.json — lazy-loaded NOGA search index.
 *
 * Returns the same array previously inlined in /codes/index.astro via
 * `define:vars`, but now served as a separate static JSON file. Astro
 * pre-renders this at build time, so it's a static file served with a
 * long cache header by Cloudflare.
 *
 * Why split it:
 *   - /codes/index.html shrinks from 396 KB to ~70 KB (HTML + critical CSS).
 *   - The search payload (~300 KB JSON) is fetched only when the user
 *     focuses or types in the search box → instant first paint, no
 *     blocking on JS download for users who never use search.
 *   - Browsers cache the JSON across navigations (e.g. /codes/noga/[code]
 *     pages can re-use it for related-codes hints later).
 */

import type { APIRoute } from "astro";
import { loadNoga2025, dottedCode } from "../../lib/noga-helpers";

export const prerender = true;

export const GET: APIRoute = () => {
  const all = loadNoga2025();
  const searchIndex = all
    .filter(
      (r) =>
        r.level === "section" ||
        r.level === "division" ||
        r.level === "group" ||
        r.level === "class",
    )
    .map((r) => ({
      code: r.code,
      label: r.label_fr,
      level: r.level,
      dotted: dottedCode(r.code),
    }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 7 days browser, 30 days CDN, SWR 1 year — index changes only on
      // NOGA refresh (annual), so caching aggressively is safe.
      "cache-control":
        "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=31536000",
    },
  });
};
