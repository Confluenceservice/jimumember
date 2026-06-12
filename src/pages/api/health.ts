import type { APIRoute } from "astro";
import Stripe from "stripe";
import { google } from "googleapis";
import { logger } from "../../lib/logger";

type SubsystemStatus = "connected" | "disconnected" | "not_configured";

interface SubsystemResult {
  status: SubsystemStatus;
  error?: string;
}

async function checkStripe(): Promise<SubsystemResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { status: "not_configured" };

  try {
    const stripe = new Stripe(secretKey);
    await stripe.products.list({ limit: 1 });
    return { status: "connected" };
  } catch (err) {
    return {
      status: "disconnected",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Probes the Gmail OAuth refresh token by performing an access-token refresh.
// Does NOT call the Gmail API — no side effects, no Sent-folder entries.
// Fails fast on invalid_grant / invalid_rapt / 401; surfaced as gmail:
// "disconnected" and an overall "degraded" status in the GET response body.
async function checkGmail(): Promise<SubsystemResult> {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return { status: "not_configured" };
  }

  try {
    const oauth = new google.auth.OAuth2(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    // refreshAccessToken round-trips to Google's token endpoint. A dead
    // refresh token (invalid_grant / invalid_rapt) throws within ~300ms.
    // This call does not revoke or rotate the stored refresh token.
    await oauth.refreshAccessToken();
    return { status: "connected" };
  } catch (err) {
    return {
      status: "disconnected",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const GET: APIRoute = async () => {
  const [stripe, gmail] = await Promise.all([checkStripe(), checkGmail()]);

  if (stripe.status === "disconnected") {
    logger.error("health.stripe_check_failed", { error: stripe.error });
  }
  if (stripe.status === "not_configured") {
    logger.warn("health.check", { reason: "STRIPE_SECRET_KEY not configured" });
  }
  if (gmail.status === "disconnected") {
    logger.error("health.gmail_check_failed", { error: gmail.error });
  }
  if (gmail.status === "not_configured") {
    logger.warn("health.check", { reason: "GMAIL_OAUTH_* not configured" });
  }

  // A subsystem is healthy only when fully connected. "not_configured" counts
  // as unhealthy: in deployed envs these credentials are mandatory, and a
  // silently missing token is exactly the failure this endpoint must catch.
  const healthy = stripe.status === "connected" && gmail.status === "connected";
  const body: Record<string, unknown> = {
    status: healthy ? "ok" : "degraded",
    stripe: stripe.status,
    gmail: gmail.status,
  };
  if (stripe.error || gmail.error) {
    body.errors = {
      ...(stripe.error ? { stripe: stripe.error } : {}),
      ...(gmail.error ? { gmail: gmail.error } : {}),
    };
  }

  // Always 200: this path backs the Fly HTTP liveness check on a single-machine
  // app. Returning 503 here would make Fly pull the only VM out of rotation and
  // take the public site down when only a background subsystem (e.g. email) is
  // degraded. Consumers read `body.status` for readiness; the Slack worker
  // alerts whenever status !== "ok".
  return Response.json(body);
};
