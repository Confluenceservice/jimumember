#!/usr/bin/env node
/**
 * setup-google-workspace — Phase 4 automation for the Re:Member blueprint.
 *
 * Idempotently creates the Drive folders + spreadsheet that Re:Member needs.
 * Runs after Phase 5 (Workspace DWD authorized) so the SA can impersonate.
 *
 * Two modes for fetching the SA key:
 *
 *   1. From Bitwarden (preferred — no plaintext key on disk):
 *      export BW_SESSION="$(bw unlock --raw)"      # in a TTY-enabled shell
 *      export GOOGLE_WORKSPACE_IMPERSONATE_USER="it-admin@<client-domain>"
 *      export BW_ATTACHMENT_ITEM="gcp-sa-key-itdocsnow"
 *      export CLIENT_NAME="itdocsnow"
 *      node bin/setup-google-workspace.js
 *
 *   2. From env var (fallback for CI / scripted ops without bw):
 *      export GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY="$(cat ./sa-key.json)"
 *      ... (rest as above)
 *
 * Output (stdout):
 *   APPLICATIONS_FOLDER_ID=...
 *   REVIEW_DOCS_FOLDER_ID=...
 *   SPREADSHEET_ID=...
 *   SPREADSHEET_URL=...
 *
 * Idempotent: if a folder or spreadsheet already exists with the expected
 * name, the existing ID is returned instead of creating a duplicate.
 */

import { google } from "googleapis";
import { execFileSync } from "node:child_process";

const IMPERSONATE = process.env.GOOGLE_WORKSPACE_IMPERSONATE_USER;
const CLIENT_NAME = process.env.CLIENT_NAME ?? "client";
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID ?? null;

if (!IMPERSONATE) {
  console.error("GOOGLE_WORKSPACE_IMPERSONATE_USER is required");
  process.exit(1);
}

async function loadCredentialsFromBitwarden(itemName) {
  if (!process.env.BW_SESSION) {
    throw new Error("BW_SESSION is not set; required for bw-based credential loading");
  }
  // Find the item by name in any folder
  const itemIdJson = execFileSync("bw", [
    "list", "items",
    "--search", itemName,
  ], { env: process.env, encoding: "utf8" });
  const items = JSON.parse(itemIdJson);
  const item = items.find((i) => i.name === itemName);
  if (!item) {
    throw new Error(`Bitwarden item "${itemName}" not found`);
  }
  const itemJson = execFileSync("bw", ["get", "item", item.id], {
    env: process.env,
    encoding: "utf8",
  });
  const full = JSON.parse(itemJson);
  const attachment = full.attachments?.[0];
  if (!attachment) {
    throw new Error(`No attachment on Bitwarden item "${itemName}"`);
  }
  // Download attachment to a temp file (avoid stdout exposure)
  const tmpFile = `/tmp/${itemName}-${attachment.id}.json`;
  execFileSync("bw", [
    "get", "attachment", attachment.id,
    "--itemid", item.id,
    "--output", tmpFile,
  ], { env: process.env, encoding: "utf8" });
  console.error(`Downloaded SA key from BW item "${itemName}" to ${tmpFile}`);
  return tmpFile;
}

async function loadCredentials() {
  if (process.env.BW_ATTACHMENT_ITEM) {
    const path = await loadCredentialsFromBitwarden(process.env.BW_ATTACHMENT_ITEM);
    return JSON.parse(await import("node:fs").then((m) => m.promises.readFile(path, "utf8")));
  }
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    console.error("Either BW_ATTACHMENT_ITEM or GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY is required");
    process.exit(1);
  }
  return JSON.parse(raw);
}

const APPLICATIONS_FOLDER = `${CLIENT_NAME}/applications`;
const REVIEW_DOCS_FOLDER = `${CLIENT_NAME}/review-docs`;
const SPREADSHEET_NAME = `${CLIENT_NAME}-member-test`;

let drive, sheets, credentials;

async function findFolder(name, parent) {
  const safeName = name.replace(/'/g, "\\'");
  const query = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `name='${safeName}'`,
    parent ? `'${parent}' in parents` : null,
  ].filter(Boolean).join(" and ");
  const res = await drive.files.list({ q: query, fields: "files(id,name)" });
  return res.data.files?.[0]?.id ?? null;
}

async function findSpreadsheet(name) {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,name)",
  });
  return res.data.files?.[0]?.id ?? null;
}

async function createFolder(name, parent) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parent ? [parent] : undefined,
    },
    fields: "id,name",
  });
  console.error(`Created folder: ${name} (${res.data.id})`);
  return res.data.id;
}

async function ensureFolder(name, parent) {
  const existing = await findFolder(name, parent);
  if (existing) {
    console.error(`Found existing folder: ${name} (${existing})`);
    return existing;
  }
  return createFolder(name, parent);
}

async function ensureSpreadsheet(name) {
  const existing = await findSpreadsheet(name);
  if (existing) {
    console.error(`Found existing spreadsheet: ${name} (${existing})`);
    return existing;
  }
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: name },
      sheets: [
        { properties: { title: "Basic Applications", gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: "Renewals", gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: "Email log", gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: "Drive Files", gridProperties: { frozenRowCount: 1 } } },
      ],
    },
  });
  console.error(`Created spreadsheet: ${name} (${res.data.spreadsheetId})`);
  return res.data.spreadsheetId;
}

const HEADERS = {
  "Basic Applications": [
    "application_id", "submitted_at", "first_name", "last_name", "email",
    "phone", "full_address", "postal_address", "business_name", "interest_joining",
    "training_details", "list_on_page", "listing_details", "signature",
    "stripe_session", "created_at",
  ],
  "Renewals": [
    "renewal_id", "tier", "renewal_year", "first_name", "last_name", "email",
    "phone", "pd_entries", "amount_paid_cents", "currency", "payment_status",
    "stripe_session", "created_at", "paid_at",
  ],
  "Email log": [
    "timestamp", "direction", "recipient", "subject", "body", "status", "error",
  ],
  "Drive Files": [
    "file_id", "applicant_id", "doc_type", "original_filename", "uploaded_at", "deleted",
  ],
};

async function writeHeaders(spreadsheetId) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const tabIds = spreadsheet.data.sheets.map((s) => s.properties.title);
  const requests = [];
  for (const tabName of tabIds) {
    const headers = HEADERS[tabName];
    if (!headers) continue;
    requests.push({
      updateCells: {
        range: { sheetId: spreadsheet.data.sheets.find((s) => s.properties.title === tabName).properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
        rows: [{
          values: headers.map((h) => ({ userEnteredValue: { stringValue: h } })),
        }],
        fields: "userEnteredValue",
      },
    });
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    console.error(`Wrote headers to ${requests.length} tab(s)`);
  }
}

async function shareWithServiceAccount(fileId, saEmail) {
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "user",
      role: "writer",
      emailAddress: saEmail,
    },
    sendNotificationEmail: false,
  });
  console.error(`Shared ${fileId} with ${saEmail}`);
}

(async () => {
  try {
    credentials = await loadCredentials();
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
      subject: IMPERSONATE,
    });
    drive = google.drive({ version: "v3", auth });
    sheets = google.sheets({ version: "v4", auth });

    const applicationsFolderId = await ensureFolder(APPLICATIONS_FOLDER, PARENT_FOLDER_ID);
    const reviewDocsFolderId = await ensureFolder(REVIEW_DOCS_FOLDER, PARENT_FOLDER_ID);
    const spreadsheetId = await ensureSpreadsheet(SPREADSHEET_NAME);
    await writeHeaders(spreadsheetId);
    await shareWithServiceAccount(spreadsheetId, credentials.client_email);
    await shareWithServiceAccount(applicationsFolderId, credentials.client_email);
    await shareWithServiceAccount(reviewDocsFolderId, credentials.client_email);

    console.log(`APPLICATIONS_FOLDER_ID=${applicationsFolderId}`);
    console.log(`REVIEW_DOCS_FOLDER_ID=${reviewDocsFolderId}`);
    console.log(`SPREADSHEET_ID=${spreadsheetId}`);
    console.log(`SPREADSHEET_URL=https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  } catch (err) {
    console.error("Setup failed:", err.message);
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
})();