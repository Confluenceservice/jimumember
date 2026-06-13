// One-off: probe Drive as service account (no DWD impersonation).
//   1. List shared drives the SA is a member of
//   2. Search by name patterns to find replacements for the moved folders
//   3. Probe a list of likely-candidate IDs
//
// Run with: node --env-file=.env .run/probe-drive-ids.mjs
import { google } from "googleapis";

const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");

// IDs we care about (from .env + the user's new shared-drive parent)
const STORED_IDS = {
  APPLICATIONS_FOLDER_LOCAL: "1RHyCxuxDZpbVAjw8V-5Z0blG6YE29nEK",
  SPREADSHEET_LOCAL: "1Zbqn6BSExD5V9cPmA2rCJ2rN5f7gnP9fHjP0s5oq_I8",
  NEW_SHARED_DRIVE_PARENT: "16XHm2qW3tdCFr7X52wplYGc2W-Lo3g1U",
};

// Patterns we expect the new folders to match. The 8 recreated items likely
// have names like the originals but with a new ID.
const NAME_PATTERNS = [
  "ELDAA",
  "Applications",
  "PM Applications",
  "AM Applications",
  "Review Docs",
  "Review",
  "applicants",
  "applicant",
  "Drive Files",
  "Professional",
  "Associate",
];

function makeDriveClient() {
  return new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function probeFile(drive, id, label) {
  try {
    const res = await drive.files.get({
      fileId: id,
      fields: "id, name, mimeType, parents, driveId, trashed, owners(emailAddress,displayName), sharingUser, permissions",
      supportsAllDrives: true,
    });
    console.log(`[ALIVE] ${label} (${id})`);
    console.log("        name:", res.data.name);
    console.log("        mimeType:", res.data.mimeType);
    console.log("        trashed:", res.data.trashed);
    console.log("        driveId:", res.data.driveId || "(myDrive)");
    console.log("        parents:", JSON.stringify(res.data.parents));
    return res.data;
  } catch (err) {
    console.log(`[DEAD]  ${label} (${id})  code=${err.code} status=${err.status}`);
    return null;
  }
}

async function listSharedDrives(drive) {
  console.log("\n[SHARED DRIVES SA is a member of]");
  try {
    const res = await drive.drives.list({ pageSize: 100 });
    for (const d of res.data.drives || []) {
      console.log(`   ${d.id}  name="${d.name}"  hidden=${d.hidden}`);
    }
    return res.data.drives || [];
  } catch (err) {
    console.log("   err:", err.code, err.message);
    return [];
  }
}

async function listChildrenOfParent(drive, parentId, label) {
  console.log(`\n[CHILDREN] ${label} (${parentId})`);
  // Try shared-drive parent first with corpora=drive
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, driveId, parents)",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "drive",
      driveId: parentId,
    });
    const files = res.data.files || [];
    console.log(`   (corpora=drive) count=${files.length}`);
    for (const f of files) {
      console.log(`     - ${f.id}  ${f.mimeType === "application/vnd.google-apps.folder" ? "[DIR]" : "[FILE]"}  ${f.name}  (driveId:${f.driveId || "myDrive"})`);
    }
    return files;
  } catch (err) {
    console.log("   err:", err.code, err.message);
    return [];
  }
}

async function searchByName(drive, pattern) {
  console.log(`\n[SEARCH] name contains '${pattern}'`);
  // The name contains query must escape single quotes
  const safe = pattern.replace(/'/g, "\\'");
  const queries = [
    `name contains '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    `name contains '${safe}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    `name contains '${safe}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
  ];
  const all = [];
  for (const q of queries) {
    try {
      const res = await drive.files.list({
        q,
        fields: "files(id, name, mimeType, driveId, parents, trashed, owners(emailAddress))",
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
      });
      for (const f of res.data.files || []) {
        all.push(f);
      }
    } catch (err) {
      // some queries may 400; that's fine
    }
  }
  // dedupe by id
  const seen = new Set();
  const dedup = all.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  console.log(`   results: ${dedup.length}`);
  for (const f of dedup) {
    console.log(`     - ${f.id}  ${f.mimeType}  ${f.name}  (driveId:${f.driveId || "myDrive"}, trashed:${f.trashed})`);
  }
  return dedup;
}

async function main() {
  const auth = makeDriveClient();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });

  console.log("=".repeat(60));
  console.log("Probing stored IDs (no DWD)");
  console.log("=".repeat(60));
  for (const [label, id] of Object.entries(STORED_IDS)) {
    if (id === STORED_IDS.NEW_SHARED_DRIVE_PARENT) continue;
    await probeFile(drive, id, label);
  }

  await listSharedDrives(drive);

  console.log("\n" + "=".repeat(60));
  console.log("Listing children of new shared-drive parent");
  console.log("=".repeat(60));
  await listChildrenOfParent(drive, STORED_IDS.NEW_SHARED_DRIVE_PARENT, "NEW_SHARED_DRIVE_PARENT");

  console.log("\n" + "=".repeat(60));
  console.log("Searching by name patterns");
  console.log("=".repeat(60));
  const allMatches = {};
  for (const p of NAME_PATTERNS) {
    const matches = await searchByName(drive, p);
    allMatches[p] = matches;
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary — folders likely to be the new applications / review docs");
  console.log("=".repeat(60));
  // Heuristic: prefer items in the new shared drive (driveId = NEW_SHARED_DRIVE_PARENT)
  const newDriveId = STORED_IDS.NEW_SHARED_DRIVE_PARENT;
  const candidates = [];
  for (const [pattern, matches] of Object.entries(allMatches)) {
    for (const f of matches) {
      candidates.push({ ...f, pattern });
    }
  }
  // Sort: items in new drive first
  candidates.sort((a, b) => {
    const aInNew = a.driveId === newDriveId ? 0 : 1;
    const bInNew = b.driveId === newDriveId ? 0 : 1;
    return aInNew - bInNew;
  });
  for (const c of candidates) {
    const tag = c.driveId === newDriveId ? "[IN-NEW-DRIVE]" : "[other]";
    console.log(`   ${tag} ${c.id}  ${c.mimeType}  ${c.name}  pattern=${c.pattern}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
