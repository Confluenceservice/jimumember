#!/usr/bin/env node
// Rebuilds the Memberships sheet mirror from Stripe (the source of truth).
//
// Uses: (1) one-time migration after deploying the durable memberships.ts,
// (2) recovery after any gap, (3) completing partial upsert-on-missing rows.
// Idempotent: upserts by customer_id; safe to re-run.
//
// Self-contained plain JS (like bin/setup-google-workspace.js) so it runs
// with plain `node` — it does NOT import src/lib/*.ts. The sheet contract it
// writes (9 columns A-I) is defined in spec 000 REQ-OV-003 and mirrored in
// src/lib/memberships.ts; keep the three in sync.
//
// Env required: STRIPE_SECRET_KEY, GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
// GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY, GOOGLE_SHEETS_SPREADSHEET_ID.
//
// Usage:
//   node bin/memberships-backfill.js            # all option_c subscriptions
//   node bin/memberships-backfill.js --limit 1  # verify with a single row
//   node bin/memberships-backfill.js --dry-run  # report, write nothing

import Stripe from "stripe";
import { google } from "googleapis";

const SHEET_NAME = "Memberships";
const HEADERS = [
  "customer_id", "plan", "recurring_price_id", "status", "subscription_id",
  "next_anchor_epoch", "joined_at", "updated_at", "last_event",
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
const SPREADSHEET_ID = requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID");

function getSheetsClient() {
  const email = requireEnv("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL");
  // Fly secrets inject the key with literal "\n" sequences.
  const key = requireEnv("GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    subject: process.env.GOOGLE_WORKSPACE_IMPERSONATE_USER?.trim() || undefined,
  });
  return google.sheets({ version: "v4", auth });
}

const sheets = getSheetsClient();

async function ensureSheet() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === SHEET_NAME);
  if (exists) return;
  if (DRY_RUN) {
    console.log(`[dry-run] would create tab '${SHEET_NAME}' with headers`);
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
  console.log(`Created tab '${SHEET_NAME}'.`);
}

async function findRowNumber(customerId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:A`,
  });
  const ids = res.data.values ?? [];
  const idx = ids.findIndex((r) => (r[0] ?? "").trim() === customerId);
  return idx === -1 ? null : idx + 2;
}

async function upsertRow(customerId, row) {
  const rowNumber = await findRowNumber(customerId);
  if (rowNumber === null) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
    return "created";
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A${rowNumber}:I${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
  return "updated";
}

// Map a live Stripe subscription status onto the mirror's vocabulary.
function mirrorStatus(sub) {
  if (sub.status === "canceled" || sub.status === "unpaid") return "cancelled";
  if (sub.status === "past_due") return "payment_failed";
  if (sub.status === "trialing") return "awaiting_subscription"; // deferred, pre-anchor
  return "active"; // active / incomplete treated as active mirror state
}

await ensureSheet();

let scanned = 0;
let written = 0;

for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
  if (sub.metadata?.flow !== "option_c") continue;
  if (scanned >= LIMIT) break;
  scanned++;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) continue;

  const status = mirrorStatus(sub);
  const row = [
    customerId,
    sub.metadata?.plan ?? "",
    sub.items?.data?.[0]?.price?.id ?? "",
    status,
    sub.id,
    String(sub.trial_end ?? 0),
    new Date(sub.created * 1000).toISOString(),
    new Date().toISOString(),
    `backfill:${sub.id}`,
  ];

  if (DRY_RUN) {
    console.log(`[dry-run] ${customerId} sub=${sub.id} stripe=${sub.status} → mirror=${status}`);
    continue;
  }

  const action = await upsertRow(customerId, row);
  console.log(`${customerId} sub=${sub.id} stripe=${sub.status} → mirror=${status} (${action})`);
  written++;
  // Throttle well under the 60 writes/min SA quota (~24 writes/min incl. the
  // find-row read per upsert).
  await new Promise((r) => setTimeout(r, 2500));
}

console.log(
  `\nDone. Scanned ${scanned} option_c subscription(s), ` +
    (DRY_RUN ? "dry-run (nothing written)." : `wrote ${written} row(s).`),
);
