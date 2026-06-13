// One-off: list children of the new shared-drive parent and the lowercase
// "applications" folder to find the new structure.
// Run with: node --env-file=.env .run/list-parent-children.mjs
import { google } from "googleapis";

const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");

const PARENTS_TO_PROBE = [
  "16XHm2qW3tdCFr7X52wplYGc2W-Lo3g1U",  // user said this is the new parent
  "1949kR-OSmh1s1w-F9UHCodPtk7PTf2_w",  // lowercase "applications" in myDrive
  "0AO2UdklXEqS7Uk9PVA",                // the shared drive itself
];

function makeDriveClient() {
  return new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function listChildren(drive, parentId, label) {
  console.log(`\n[CHILDREN] ${label} (${parentId})`);
  // Try shared-drive parent
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, driveId, parents, owners(emailAddress), createdTime, modifiedTime)",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    const files = res.data.files || [];
    console.log(`   count=${files.length}`);
    for (const f of files) {
      const tag = f.mimeType === "application/vnd.google-apps.folder" ? "[DIR]" : f.mimeType === "application/vnd.google-apps.spreadsheet" ? "[SHEET]" : f.mimeType === "application/vnd.google-apps.document" ? "[DOC]" : "[FILE]";
      console.log(`     - ${f.id}  ${tag}  ${f.name}  (driveId:${f.driveId || "myDrive"})`);
    }
    return files;
  } catch (err) {
    console.log("   err:", err.code, err.status, err.message);
    return [];
  }
}

async function main() {
  const auth = makeDriveClient();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });

  for (const p of PARENTS_TO_PROBE) {
    await listChildren(drive, p, p);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
