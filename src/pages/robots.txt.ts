import type { APIRoute } from "astro";
import { getPublicAppUrl } from "../lib/staging";

/**
 * SSR robots.txt.
 *
 * Allows crawling of the public pages and points crawlers at the env-driven
 * sitemap. Token-gated flows, post-payment terminals, API routes and the
 * /_dev pages are disallowed — they should never surface in search results
 * and hold nothing worth crawling.
 */
export const prerender = false;

export const GET: APIRoute = () => {
  const base = getPublicAppUrl().replace(/\/+$/, "");

  const body = `User-agent: *
Allow: /$
Allow: /apply/
Allow: /associate-membership/
Disallow: /api/
Disallow: /renew/
Disallow: /advanced/
Disallow: /success/
Disallow: /cancel/
Disallow: /_dev/

Sitemap: ${base}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
