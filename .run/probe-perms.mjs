import { google } from "googleapis";
const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
await auth.authorize();
const drive = google.drive({ version: "v3", auth });

const ids = [
  ["PM Applications", "1Nn-F5Cf-0xj02AYZFOZ3ba61QCviuyib"],
  ["AM Applications", "1smqNhY_FfwkkvdfKf-JFIJPxAwC-8GEm"],
  ["Professional Applications", "1rv_Badml94P3PaKITsgb-TZROV5E-KTJ"],
  ["applications (lowercase, in other shared drive)", "1949kR-OSmh1s1w-F9UHCodPtk7PTf2_w"],
];
for (const [label, id] of ids) {
  try {
    const perms = await drive.permissions.list({ fileId: id, fields: "permissions(id,type,role,emailAddress,domain)", supportsAllDrives: true });
    console.log(`\n[PERMS] ${label} (${id})`);
    for (const p of perms.data.permissions || []) {
      console.log(`   - ${p.type}  role=${p.role}  ${p.emailAddress || p.domain || ""}`);
    }
  } catch (err) {
    console.log(`\n[PERMS ERR] ${label} (${id})  code=${err.code} ${err.message}`);
  }
}
