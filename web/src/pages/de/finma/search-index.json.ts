/** GET /de/finma/search-index.json — FINMA-Register-Suchindex (DE Links). */
import type { APIRoute } from "astro";
import { loadFinma } from "../../../lib/finma-helpers";

export const prerender = true;

export const GET: APIRoute = () => {
  const idx = loadFinma().map((e) => ({ name: e.name, city: e.city, href: `/de/finma/${e.slug}` }));
  return new Response(JSON.stringify(idx), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=31536000",
    },
  });
};
