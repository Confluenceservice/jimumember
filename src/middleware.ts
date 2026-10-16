import { defineMiddleware } from "astro:middleware";

/**
 * In-memory rate limiter for API routes.
 * Limits: 30 requests per IP per 15-minute fixed window (resets when the
 * window expires, not on every request).
 */
const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 30;

// Paths exempt from IP rate limiting. The Stripe webhook arrives from a small
// pool of Stripe IPs, so an event burst would trip the per-IP limit and Stripe
// would see 429s (dropped/delayed deliveries). The health endpoint is polled by
// Fly's liveness check + the Cloudflare alert worker and must never be
// throttled. Both are independently authenticated (Stripe signature / health
// CHECK_TOKEN), so the rate limiter adds no protection there.
const RATE_LIMIT_EXEMPT_PATHS = new Set<string>([
  "/api/stripe-webhook",
  "/api/health",
]);

// Prefixes exempt from IP rate limiting. Every /api/xero/ route is
// machine-to-machine and arrives from egress the counter handles badly: the
// OAuth callback comes from Xero's IP, the sweeper from an Apps Script IP
// pool, and any caller without a forwarded-for header lands in the single
// "unknown" bucket alongside every other such caller. 30 requests / 15 min
// would throttle the sweeper and could burn the one-shot consent callback.
// Each route is gated on its own high-entropy shared secret (or, for the
// callback, a single-use state nonce), which is the real access control.
const RATE_LIMIT_EXEMPT_PREFIXES = ["/api/xero/"];

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

function cleanStaleEntries(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(ip);
    }
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "payment=(self)",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Only rate-limit API routes; exempt webhook + health (see
  // RATE_LIMIT_EXEMPT_PATHS). Both still receive security headers.
  if (
    !url.pathname.startsWith("/api/") ||
    RATE_LIMIT_EXEMPT_PATHS.has(url.pathname) ||
    RATE_LIMIT_EXEMPT_PREFIXES.some((p) => url.pathname.startsWith(p))
  ) {
    const response = await next();
    // Apply security headers to all responses
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // Clean stale entries on every request (cheap enough at this scale)
  cleanStaleEntries();

  const ip = getClientIp(context.request);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (entry) {
    if (entry.resetAt <= now) {
      // Window expired — reset
      rateLimitStore.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else if (entry.count >= MAX_REQUESTS) {
      // Limit exceeded
      const rateLimitedResponse = new Response(
        JSON.stringify({
          error: "Too many requests. Please try again later.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(
              Math.ceil((entry.resetAt - now) / 1000),
            ),
            "X-RateLimit-Limit": String(MAX_REQUESTS),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
          },
        },
      );
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        rateLimitedResponse.headers.set(key, value);
      }
      return rateLimitedResponse;
    } else {
      entry.count++;
    }
  } else {
    rateLimitStore.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }

  const response = await next();

  const currentEntry = rateLimitStore.get(ip);
  if (currentEntry) {
    response.headers.set(
      "X-RateLimit-Limit",
      String(MAX_REQUESTS),
    );
    response.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, MAX_REQUESTS - currentEntry.count)),
    );
    response.headers.set(
      "X-RateLimit-Reset",
      String(Math.ceil(currentEntry.resetAt / 1000)),
    );
  }

  // Apply security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
});
