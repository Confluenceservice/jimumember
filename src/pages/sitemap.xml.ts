import type { APIRoute } from "astro";
import { getPublicAppUrl } from "../lib/staging";

/**
 * SSR sitemap for the public, indexable pages of the app.
 *
 * The base URL is env-driven (getPublicAppUrl → PUBLIC_APP_URL / staging /
 * prod fallback) so a fork never has to hardcode a domain here. Only pages a
 * search engine should crawl are listed — token-gated flows (renew/*,
 * advanced/*), post-payment terminals (success/cancel), API routes and the
 * /_dev pages are deliberately excluded. `/` is a redirect to /apply/, so we
 * list /apply/ directly instead.
 */
const PUBLIC_PATHS = ["/apply/", "/associate-membership/"];

export const prerender = false;

export const GET: APIRoute = () => {
  const base = getPublicAppUrl().replace(/\/+$/, "");
  const urls = PUBLIC_PATHS.map(
    (path) => `  <url><loc>${base}${path}</loc></url>`,
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
