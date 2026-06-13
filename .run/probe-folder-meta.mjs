// One-off: probe metadata on candidate folders to see parents + driveId
// + try a few corpora variants for the user-reported new parent.
// Run with: node --env-file=.env .run/probe-folder-meta.mjs
import { google } from "googleapis";

const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");

const PROBE_IDS = [
  "16XHm2qW3tdCFr7X52wplYGc2W-Lo3g1U",  // user-reported new parent
  "0AO2UdklXEqS7Uk9PVA",                 // shared drive
  "1Nn-F5Cf-0xj02AYZFOZ3ba61QCviuyib",   // PM Applications
  "1smqNhY_FfwkkvdfKf-JFIJPxAwC-8GEm",   // AM Applications
  "1rv_Badml94P3PaKITsgb-TZROV5E-KTJ",   // Professional Applications
  "1949kR-OSmh1s1w-F9UHCodPtk7PTf2_w",   // applications (lowercase)
  "1p0Ltb44IYlTjmiqwqHQIpri90cClBl6Q",   // Chair_ELDAA
];

function makeDriveClient() {
  return new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function probe(drive, id, label) {
  try {
    const res = await drive.files.get({
      fileId: id,
      fields: "id, name, mimeType, parents, driveId, trashed, owners(emailAddress,displayName), createdTime, modifiedTime",
      supportsAllDrives: true,
    });
    const d = res.data;
    console.log(`[ALIVE] ${label}`);
    console.log(`   id:        ${d.id}`);
    console.log(`   name:      ${d.name}`);
    console.log(`   mimeType:  ${d.mimeType}`);
    console.log(`   parents:   ${JSON.stringify(d.parents)}`);
    console.log(`   driveId:   ${d.driveId || "(myDrive)"}`);
    console.log(`   trashed:   ${d.trashed}`);
    console.log(`   owners:    ${JSON.stringify((d.owners || []).map(o => o.emailAddress))}`);
    return d;
  } catch (err) {
    console.log(`[DEAD]  ${label}  code=${err.code} status=${err.status}  ${err.message}`);
    return null;
  }
}

async function listWithCorpora(drive, parentId, label) {
  // Variant A: corpora=drive + driveId=0AO2UdklXEqS7Uk9PVA
  console.log(`\n[LIST A: corpora=drive, driveId=shared] ${label} (${parentId})`);
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, driveId, parents)",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "drive",
      driveId: "0AO2UdklXEqS7Uk9PVA",
    });
    console.log(`   count=${(res.data.files || []).length}`);
    for (const f of res.data.files || []) {
      console.log(`     - ${f.id}  ${f.mimeType}  ${f.name}  (parents:${JSON.stringify(f.parents)})`);
    }
  } catch (err) {
    console.log(`   err: code=${err.code} status=${err.status}  ${err.message}`);
  }

  // Variant B: corpora=allDrives, no driveId
  console.log(`[LIST B: corpora=allDrives] ${label} (${parentId})`);
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, driveId, parents)",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    console.log(`   count=${(res.data.files || []).length}`);
    for (const f of res.data.files || []) {
      console.log(`     - ${f.id}  ${f.mimeType}  ${f.name}  (parents:${JSON.stringify(f.parents)})`);
    }
  } catch (err) {
    console.log(`   err: code=${err.code} status=${err.status}  ${err.message}`);
  }
}

async function main() {
  const auth = makeDriveClient();
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });

  console.log("=".repeat(60));
  console.log("Probing candidate IDs");
  console.log("=".repeat(60));
  for (const id of PROBE_IDS) {
    await probe(drive, id, id);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Listing children with corpora variants");
  console.log("=".repeat(60));
  for (const id of ["16XHm2qW3tdCFr7X52wplYGc2W-Lo3g1U", "0AO2UdklXEqS7Uk9PVA"]) {
    await listWithCorpora(drive, id, id);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
