import { defineMiddleware } from "astro:middleware";

/**
 * In-memory rate limiter for API routes.
 * Limits: 15 requests per IP per 15-minute window.
 * Resets the window on each new request from that IP.
 */
const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 15;

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

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Only rate-limit API routes
  if (!url.pathname.startsWith("/api/")) {
    return next();
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
      return new Response(
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

  return response;
});
