// One-off: find spreadsheets and remaining ELDAA items.
// Run with: node --env-file=.env .run/find-spreadsheets.mjs
import { google } from "googleapis";

const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");

const NAME_PATTERNS = [
  "Professional Applications",
  "ELDAA",
  "Drive Files",
  "Sheet1",
  "Application",
  "Member",
  "Membership",
  "Stripe",
  "Email",
  "Orders",
  "Subscribers",
  "Audit",
  "PM ",
  "AM ",
  "Review",
  "Application Review",
];

function makeDriveClient() {
  return new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function search(drive, q, label) {
  console.log(`\n[${label}] q=${q}`);
  try {
    const res = await drive.files.list({
      q,
      fields: "files(id, name, mimeType, driveId, parents, trashed, modifiedTime, owners(emailAddress))",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    const files = res.data.files || [];
    console.log(`   count=${files.length}`);
    for (const f of files) {
      const tag = f.mimeType === "application/vnd.google-apps.folder" ? "[DIR]" : f.mimeType === "application/vnd.google-apps.spreadsheet" ? "[SHEET]" : f.mimeType === "application/vnd.google-apps.document" ? "[DOC]" : "[FILE]";
      console.log(`     - ${f.id}  ${tag}  ${f.name}  (driveId:${f.driveId || "myDrive"}, parents:${JSON.stringify(f.parents || [])})`);
    }
    return files;
  } catch (err) {
    console.log(`   err: ${err.code} ${err.message}`);
    return [];
  }
}

async function main() {
  const auth = makeDriveClient();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });

  // All non-trashed spreadsheets we can see
  await search(drive, `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`, "ALL SPREADSHEETS");
  // All non-trashed docs
  await search(drive, `mimeType = 'application/vnd.google-apps.document' and trashed = false`, "ALL DOCS");

  // By name pattern
  for (const p of NAME_PATTERNS) {
    const safe = p.replace(/'/g, "\\'");
    await search(drive, `name contains '${safe}' and trashed = false`, `name~${p}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
