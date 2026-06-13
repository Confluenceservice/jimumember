import { google } from "googleapis";
const SA_EMAIL = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
await auth.authorize();
const drive = google.drive({ version: "v3", auth });
const id = "1spXBve9dXfOE-VTnebKnsiojO7eSRgjT";
try {
  const r = await drive.files.get({ fileId: id, fields: "id, name, mimeType, driveId, parents, trashed", supportsAllDrives: true });
  console.log("[ALIVE]", JSON.stringify(r.data, null, 2));
} catch (e) {
  console.log("[DEAD]", e.code, e.status, e.message);
}
