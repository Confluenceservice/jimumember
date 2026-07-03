// itdocsnow-health-alert (module worker)
// Triggered by GitHub Actions cron (every 5 min) via POST /check with bearer auth.
// Pings the production /api/health endpoint, posts to Slack on failure.
//
// Targets are configured via env vars so this Worker can be reused by other
// Re:Member deployments without code changes:
//   TARGET_URL    — full URL of /api/health on the production Fly app
//   TARGET_NAME   — display label for the Slack alert (default: "production")
//   ORG_NAME      — org name shown in the Slack alert header (default: "Re:Member")

function loadTargets(env) {
  const url = env.TARGET_URL?.trim();
  if (!url) return [];
  let baseUrl;
  try { baseUrl = new URL(url).origin + "/"; } catch { return []; }
  return [{ name: env.TARGET_NAME?.trim() || "production", url, baseUrl }];
}

function orgName(env) {
  return env.ORG_NAME?.trim() || "Re:Member";
}

// Timeouts: cold starts on Fly can exceed 10s (stopped machine + Node import
// graph + Vite dev server in dev). Use a longer window for the warmup ping
// that wakes the machine, then a tighter window for the actual health probe
// (warm machine should respond in <2s).
const WARMUP_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 10_000;

function isAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!env.CHECK_TOKEN) return false;
  return header === `Bearer ${env.CHECK_TOKEN}`;
}

async function check(target) {
  const start = Date.now();

  // Stage 1 — warmup. Ping the base URL with a generous timeout so a stopped
  // Fly machine has time to cold-start. Accept any HTTP response (even 5xx):
  // we only care that the machine is alive. /api/health is the source of
  // truth for subsystem health.
  try {
    const warmup = await fetch(target.baseUrl, {
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
headers: { "User-Agent": "itdocsnow-health-alert/1.0 (warmup)" },
    });
    // Drain body so the connection is released back to the pool.
    try { await warmup.text(); } catch {}
  } catch (err) {
    // Warmup didn't return within WARMUP_TIMEOUT_MS — treat the machine as
    // unreachable. Don't bother with /api/health; that would just time out
    // the same way.
    return {
      name: target.name,
      url: target.url,
      ok: false,
      httpStatus: 0,
      body: null,
      latencyMs: Date.now() - start,
      error: `warmup_timeout: ${String(err && err.message ? err.message : err)}`,
    };
  }

  // Stage 2 — health probe. Machine is warm; expect <2s response.
  try {
    const res = await fetch(target.url, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
headers: { "User-Agent": "itdocsnow-health-alert/1.0" },
    });
    const body = await res.json();
    return {
      name: target.name,
      url: target.url,
      ok: res.ok && body && body.status === "ok",
      httpStatus: res.status,
      body,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return {
      name: target.name,
      url: target.url,
      ok: false,
      httpStatus: 0,
      body: null,
      latencyMs: Date.now() - start,
      error: String(err && err.message ? err.message : err),
    };
  }
}

function summarizeResult(r) {
  return {
    name: r.name,
    ok: r.ok,
    httpStatus: r.httpStatus,
    latencyMs: r.latencyMs,
    stripe: r.body && r.body.stripe,
    email: r.body && r.body.email,
    status: r.body && r.body.status,
    error: r.error,
  };
}

async function postSlack(webhook, results, env) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { sent: false, reason: "all_ok" };

  // An alert is needed but we can't deliver it — the monitor itself is broken.
  if (!webhook) return { sent: false, reason: "no_webhook" };

  const headerText = `🚨 ${orgName(env)} health: ${failed.length}/${results.length} failing`;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText } },
    ...failed.map((f) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${f.name}* — \`${f.url}\`\n` +
          `HTTP ${f.httpStatus} in ${f.latencyMs}ms` +
          (f.error ? `\nError: \`${f.error}\`` : "") +
          (f.body ? `\n\`\`\`json\n${JSON.stringify(f.body, null, 2)}\n\`\`\`` : ""),
      },
    })),
    { type: "context", elements: [{ type: "mrkdwn", text: `Checked at ${new Date().toISOString()}` }] },
  ];

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: headerText, blocks }),
      signal: AbortSignal.timeout(10_000),
    });

    const respText = await res.text();
    if (!res.ok) {
      return { sent: false, reason: "slack_error", httpStatus: res.status, slackResponse: respText };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: "slack_exception", error: String(err && err.message ? err.message : err) };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
"itdocsnow-health-alert\n\nPOST /check with Authorization: Bearer <CHECK_TOKEN>\n",
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }

    if (request.method !== "POST" || url.pathname !== "/check") {
      return new Response("Not found", { status: 404 });
    }

    if (!isAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const targets = loadTargets(env);
    if (targets.length === 0) {
      return new Response(
        JSON.stringify({ error: "TARGET_URL not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const results = await Promise.all(targets.map(check));
    const slack = await postSlack(env.SLACK_WEBHOOK_URL, results, env);

    // Return 502 when an alert was needed but couldn't be delivered, so the
    // GitHub Actions cron fails loudly instead of going green on a broken
    // monitor. "all_ok" (nothing to send) stays 200.
    const alertUndelivered = slack.sent === false && slack.reason !== "all_ok";
    const status = alertUndelivered ? 502 : 200;

    return new Response(
      JSON.stringify(
        {
          checked: results.length,
          failed: results.filter((r) => !r.ok).length,
          slack,
          results: results.map(summarizeResult),
        },
        null,
        2,
      ),
      { status, headers: { "Content-Type": "application/json" } },
    );
  },
};
