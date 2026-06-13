import { google } from "googleapis";
import { logger } from "./logger";
import type { ApplicantInfo } from "./upload-sheet";
import { listDriveFiles } from "./drive-files";
import { getServiceAccountJwtAuth } from "./google-auth";
import { getStagingPrefix } from "./staging";

function getDocsClient() {
  const auth = getServiceAccountJwtAuth(["https://www.googleapis.com/auth/documents"]);
  return google.docs({ version: "v1", auth });
}
function getDriveClient() {
  const auth = getServiceAccountJwtAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function ensureDriveFolderExists(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  folderName: string
): Promise<string> {
  const response = await drive.files.list({
    q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error(`Failed to create folder ${folderName}`);
  return created.data.id;
}

// ---------------------------------------------------------------------------
// Associate Application (single-page form)
// ---------------------------------------------------------------------------

type AssociateApplicationData = {
  applicationId: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  fullAddress: string;
  postalAddress: string;
  businessName: string;
  interestJoining: string;
  trainingDetails: string;
  listOnPage: string;
  listingDetails: string;
  signature: string;
  applicationDate: string;
  checkoutStatus: string;
};

function buildAssociateContent(data: AssociateApplicationData) {
  const requests: object[] = [];
  let index = 1;

  function insert(text: string) {
    requests.push({ insertText: { text, location: { index } } });
    index += text.length;
  }

  function setStyle(startIndex: number, endIndex: number, bold: boolean, fontSize: number) {
    if (endIndex <= startIndex) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { bold, fontSize: { magnitude: fontSize, unit: "PT" } },
        fields: "bold,fontSize",
      },
    });
  }

  function h1(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 20);
  }

  function h2(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 14);
  }

  function p(text: string) {
    insert(text + "\n");
  }

  function bullet(text: string) {
    insert("• " + text + "\n");
  }

  function gap() {
    insert("\n");
  }

  h1("ELDAA Associate Membership Application");
  gap();

  h2("Applicant Details");
  p(`Name: ${data.firstName} ${data.lastName}`);
  p(`Email: ${data.email}`);
  p(`Phone: ${data.phone}`);
  p(`Business Name: ${data.businessName || "—"}`);
  gap();

  h2("Address");
  p(`Full Address: ${data.fullAddress}`);
  p(`Postal Address: ${data.postalAddress || "—"}`);
  gap();

  h2("Additional Information");
  p(`Interest in Joining ELDAA: ${data.interestJoining}`);
  p(`Training Details: ${data.trainingDetails}`);
  p(`List on Associate Members Page: ${data.listOnPage === "yes" ? "Yes" : data.listOnPage === "no" ? "No" : "—"}`);
  if (data.listOnPage === "yes" && data.listingDetails) {
    p(`Listing Details: ${data.listingDetails}`);
  }
  gap();

  h2("Declaration");
  p(`Signature: ${data.signature || "—"}`);
  p(`Application Date: ${data.applicationDate || "—"}`);
  p(`Checkout Status: ${data.checkoutStatus}`);

  return requests;
}

export async function createAssociateApplicationReviewDoc(
  application: AssociateApplicationData,
): Promise<string> {
  const docs = getDocsClient();
  const drive = getDriveClient();
  const rootFolderId =
    process.env.GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim() ||
    "";

  const docTitle = `Associate Application — ${application.firstName} ${application.lastName} (${application.email})`;

  let docId: string | undefined;
  let applicantFolderId = "";

  if (rootFolderId) {
    const amFolderId = await ensureDriveFolderExists(drive, rootFolderId, `${getStagingPrefix()}AM Applications`);
    applicantFolderId = await ensureDriveFolderExists(
      drive,
      amFolderId,
      `${application.firstName}_${application.lastName}`.replace(/[^a-zA-Z0-9]/g, "_")
    );
    const created = await drive.files.create({
      requestBody: {
        name: docTitle,
        mimeType: "application/vnd.google-apps.document",
        parents: [applicantFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    docId = created.data.id ?? undefined;
  } else {
    const doc = await docs.documents.create({
      requestBody: { title: docTitle },
    });
    docId = doc.data.documentId ?? undefined;
  }
  if (!docId) throw new Error("Failed to create Associate Google Doc");

  const requests = buildAssociateContent(application);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: requests as never[] },
    });
  }

  const docUrl = `https://docs.google.com/document/d/${docId}`;
  logger.info("associate_review_doc_created", {
    applicationId: application.applicationId,
    docId,
    docUrl,
    folderId: applicantFolderId || null,
  });

  return docUrl;
}

// ---------------------------------------------------------------------------
// Professional Application (8-step wizard)
// ---------------------------------------------------------------------------

type DriveFile = { fileId: string; docType: string; originalFilename: string };

function buildContent(applicant: ApplicantInfo, driveFiles: DriveFile[]) {
  const requests: object[] = [];
  // Google Docs insertText locations are 1-based in a newly created doc.
  let index = 1;

  function insert(text: string) {
    requests.push({ insertText: { text, location: { index } } });
    index += text.length;
  }

  function setStyle(startIndex: number, endIndex: number, bold: boolean, fontSize: number) {
    if (endIndex <= startIndex) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { bold, fontSize: { magnitude: fontSize, unit: "PT" } },
        fields: "bold,fontSize",
      },
    });
  }

  function h1(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 20);
  }

  function h2(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 14);
  }

  function p(text: string) {
    insert(text + "\n");
  }

  function bullet(text: string) {
    insert("• " + text + "\n");
  }

  function gap() {
    insert("\n");
  }

  // Title
  h1("ELDAA Professional Membership Application");
  gap();

  // Applicant Details
  h2("Applicant Details");
  p(`Name: ${applicant.firstName} ${applicant.lastName}`);
  p(`Email: ${applicant.email}`);
  p(`Phone: ${applicant.phone}`);
  gap();

  // About You
  h2("About You");
  p(`Date of Birth: ${applicant.dateOfBirth || "—"}`);
  p(`Ethnicity: ${applicant.ethnicity || "—"}`);
  p(`Address: ${applicant.address || "—"}`);
  p(`Postal Address: ${applicant.postalAddress || "—"}`);
  p(`Business Name: ${applicant.businessName || "—"}`);
  p(`Website: ${applicant.website || "—"}`);
  gap();

  // Training & Education
  h2("Training & Education");
  try {
    const quals = JSON.parse(applicant.qualifications || "[]");
    if (quals.length === 0) {
      p("(No training records)");
    } else {
      quals.forEach((q: { name?: string; provider?: string; year?: string }) => {
        bullet(`${q.name || "—"}${q.provider ? ` (${q.provider}${q.year ? `, ${q.year}` : ""})` : ""}`);
      });
    }
  } catch {
    p("(Unable to parse training records)");
  }
  gap();

  // EOL Doula Experience
  h2("EOL Doula Experience");
  try {
    const exps = JSON.parse(applicant.experience || "[]");
    if (exps.length === 0) {
      p("(No experience records)");
    } else {
      exps.forEach((e: { role?: string; skills?: string }) => {
        bullet(`${e.role || "—"}: ${e.skills || "—"}`);
      });
    }
  } catch {
    p("(Unable to parse experience records)");
  }
  gap();

  // Further Requirements
  h2("Further Requirements");
  const FR_LABELS: Record<string, string> = {
    agreeDoulaServices: "Agrees to actively provide Doula Services",
    agreeInterview: "Agrees to an interview by committee members",
    commitProfessionalDev: "Commits to 10 hours professional development/year",
    willInsurance: "Will take out professional indemnity insurance",
    listDirectory: "Wishes to be listed in ELDAA directory",
    provideCriminalCheck: "Willing to provide Ministry of Justice criminal record check",
    attendMeetings: "Willing to attend regular ELDAA meetings and events",
    workRemotely: "Willing to work remotely where no other Professional Member available",
  };
  try {
    const fr = JSON.parse(applicant.furtherRequirements || "{}");
    for (const [key, label] of Object.entries(FR_LABELS)) {
      const val = fr[key];
      p(`${label}: ${val === "YES" ? "YES" : val === "NO" ? "NO" : "—"}`);
    }
  } catch {
    p("(Unable to parse further requirements)");
  }
  gap();

  // Core Competencies
  h2("Core Competencies");
  const COMPETENCIES = [
    "Effective Communication Skills",
    "Advocacy & Empowerment",
    "Cultural & Spiritual Diversity",
    "Shows initiative",
    "Compassionate Presence",
    "Ongoing Education & Development",
    "Self-Care & Professional Boundaries",
    "Knowledge of End-of-Life Options",
    "Business acumen",
    "Networking & Referrals",
    "Holistic support",
    "Illness journey advocacy",
    "Legacy & Life Review",
    "Holistic Advance Care Planning",
    "Vigil Planning & Support",
    "Practical Assistance during illness",
    "Funeral & Memorial Planning",
    "Body care and After Death care",
    "Grief & Bereavement Awareness",
    "Interdisciplinary Collaboration",
    "Mentorship",
  ];
  try {
    const comps = JSON.parse(applicant.coreCompetencies || "[]");
    COMPETENCIES.forEach((label, i) => {
      const checked = comps[i] === true || comps[i] === "true";
      p(`[${checked ? "✓" : " "}] ${label}`);
    });
  } catch {
    p("(Unable to parse core competencies)");
  }
  gap();

  // Referees
  h2("Referees");
  p(`Referee 1: ${applicant.referee1Name || "—"} (${applicant.referee1Role || "—"})`);
  p(`  Email: ${applicant.referee1Email || "—"} | Phone: ${applicant.referee1Phone || "—"}`);
  p(`Referee 2: ${applicant.referee2Name || "—"} (${applicant.referee2Role || "—"})`);
  p(`  Email: ${applicant.referee2Email || "—"} | Phone: ${applicant.referee2Phone || "—"}`);
  gap();

  // Documents Uploaded
  h2("Documents Uploaded");
  const docCounts = [
    ["Training certificates", applicant.docTrainingCount, "training"],
    ["Code of Ethics", applicant.docEthicsCount, "ethics"],
    ["Criminal Records Check", applicant.docCriminalCount, "criminal"],
    ["Advanced Care Planning", applicant.docAdvanceCareCount, "advance_care"],
    ["Assisted Dying Training", applicant.docAssistedDyingCount, "assisted_dying"],
    ["Fundamentals of Palliative Care", applicant.docFundamentalsCount, "fundamentals"],
    ["Professional Indemnity Insurance", applicant.docInsuranceCount, "insurance"],
  ];
  docCounts.forEach(([label, count, docType]) => {
    p(`${label}: ${count || 0} file(s)`);
    const filesForType = driveFiles.filter((f) => f.docType === docType);
    filesForType.forEach((f) => {
      p(`  ${f.originalFilename}: https://drive.google.com/file/d/${f.fileId}/view`);
    });
  });
  gap();

  // Declarations
  h2("Declarations");
  const decls = [
    ["Accuracy and completeness", applicant.declarationAccuracy],
    ["Code of Ethics", applicant.declarationEthics],
    ["Scope of Practice", applicant.declarationScope],
    ["Active Doula Services", applicant.declarationDoulaServices],
    ["Interview Agreement", applicant.declarationInterview],
    ["Professional Development", applicant.declarationProfessionalDev],
    ["Criminal Record Check", applicant.declarationCriminalCheck],
    ["Meeting Attendance", applicant.declarationMeetings],
  ];
  decls.forEach(([label, val]) => {
    p(`${label}: ${val === "TRUE" ? "CONFIRMED" : "NOT CONFIRMED"}`);
  });
  p(`Signed at: ${applicant.declarationSignedAt || "—"}`);

  return requests;
}

export async function createApplicationReviewDoc(
  applicant: ApplicantInfo
): Promise<string> {
  const docs = getDocsClient();
  const drive = getDriveClient();
  const rootFolderId =
    process.env.GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim() ||
    "";

  const docTitle = `Professional Application — ${applicant.firstName} ${applicant.lastName} (${applicant.email})`;

  let docId: string | undefined;
  let applicantFolderId = "";

  if (rootFolderId) {
    // Ensure PM Applications subfolder exists, then create doc inside it
    const pmFolderId = await ensureDriveFolderExists(drive, rootFolderId, `${getStagingPrefix()}PM Applications`);
    applicantFolderId = await ensureDriveFolderExists(
      drive,
      pmFolderId,
      `${applicant.firstName}_${applicant.lastName}`.replace(/[^a-zA-Z0-9]/g, "_")
    );
    const created = await drive.files.create({
      requestBody: {
        name: docTitle,
        mimeType: "application/vnd.google-apps.document",
        parents: [applicantFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    docId = created.data.id ?? undefined;
  } else {
    // Fallback for environments without a configured folder.
    const doc = await docs.documents.create({
      requestBody: { title: docTitle },
    });
    docId = doc.data.documentId ?? undefined;
  }
  if (!docId) throw new Error("Failed to create Google Doc");

  // Build and push content
  const driveFiles = await listDriveFiles(applicant.id);
  const requests = buildContent(applicant, driveFiles);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: requests as never[] },
    });
  }

  const docUrl = `https://docs.google.com/document/d/${docId}`;
  logger.info("review_doc_created", {
    applicantId: applicant.id,
    docId,
    docUrl,
    folderId: applicantFolderId || null,
    driveFilesCount: driveFiles.length,
  });

  return docUrl;
}

// ---------------------------------------------------------------------------
// Application Index Docs
// ---------------------------------------------------------------------------

type IndexEntry = {
  name: string;
  email: string;
  docUrl: string;
  folderUrl: string;
};

function buildIndexContent(title: string, entries: IndexEntry[]) {
  const requests: object[] = [];
  let index = 1;

  function insert(text: string) {
    requests.push({ insertText: { text, location: { index } } });
    index += text.length;
  }

  function setStyle(startIndex: number, endIndex: number, bold: boolean, fontSize: number) {
    if (endIndex <= startIndex) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: { bold, fontSize: { magnitude: fontSize, unit: "PT" } },
        fields: "bold,fontSize",
      },
    });
  }

  function h1(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 20);
  }

  function linkLine(label: string, url: string) {
    insert(`${label}: ${url}\n`);
  }

  function gap() {
    insert("\n");
  }

  h1(title);
  gap();
  insert(`Total: ${entries.length} application(s)\n`);
  gap();

  entries.forEach((e) => {
    insert(`${e.name} (${e.email})\n`);
    linkLine("  Review Doc", e.docUrl);
    linkLine("  Folder", e.folderUrl);
    gap();
  });

  return requests;
}

async function getOrCreateIndexDoc(
  drive: ReturnType<typeof google.drive>,
  _docs: ReturnType<typeof google.docs>,
  _parentFolderId: string,
  indexFolderId: string,
  docName: string
): Promise<{ docId: string; docUrl: string }> {
  const existing = await drive.files.list({
    q: `name='${docName}' and '${indexFolderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    const id = existing.data.files[0].id!;
    return { docId: id, docUrl: `https://docs.google.com/document/d/${id}` };
  }

  const created = await drive.files.create({
    requestBody: {
      name: docName,
      mimeType: "application/vnd.google-apps.document",
      parents: [indexFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const docId = created.data.id!;
  return { docId, docUrl: `https://docs.google.com/document/d/${docId}` };
}

async function updateIndexDoc(
  docs: ReturnType<typeof google.docs>,
  docId: string,
  title: string,
  entries: IndexEntry[]
): Promise<void> {
  try {
    const doc = await docs.documents.get({ documentId: docId });
    const content = doc.data.body?.content;
    if (content && content.length > 0) {
      const last = content[content.length - 1];
      const endIndex = (last as any).endIndex ?? 1;
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex } } }],
        },
      });
    }
  } catch {
    // If get/clear fails, just overwrite
  }

  const requests = buildIndexContent(title, entries);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: requests as never[] },
    });
  }
}

async function listApplicantFolders(
  drive: ReturnType<typeof google.drive>,
  parentFolderId: string
): Promise<{ id: string; name: string }[]> {
  const result = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (result.data.files ?? []).filter((f) => f.id && f.name).map((f) => ({ id: f.id!, name: f.name! }));
}

export async function refreshPmIndexDoc(): Promise<void> {
  const rootFolderId = process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim();
  if (!rootFolderId) return;

  const drive = getDriveClient();
  const docs = getDocsClient();

  const pmFolderId = await ensureDriveFolderExists(drive, rootFolderId, `${getStagingPrefix()}PM Applications`);
  const { docId, docUrl } = await getOrCreateIndexDoc(
    drive, docs, rootFolderId, pmFolderId, `${getStagingPrefix()}PM Applications — Index`
  );

  const subfolders = await listApplicantFolders(drive, pmFolderId);
  const entries: IndexEntry[] = [];

  for (const folder of subfolders) {
    const docsInFolder = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.document' and '${folder.id}' in parents and trashed=false`,
      fields: "files(id)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const doc = docsInFolder.data.files?.[0];
    const email = folder.name.match(/\(([^)]+)\)$/)?.[1] ?? "";
    entries.push({
      name: folder.name,
      email,
      docUrl: doc ? `https://docs.google.com/document/d/${doc.id}` : "",
      folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  await updateIndexDoc(docs, docId, `${getStagingPrefix()}PM Applications — Index`, entries);
  logger.info("pm_index_doc_refreshed", { docUrl, entryCount: entries.length });
}

export async function refreshAmIndexDoc(): Promise<void> {
  const rootFolderId = process.env.GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID?.trim();
  if (!rootFolderId) return;

  const drive = getDriveClient();
  const docs = getDocsClient();

  const amFolderId = await ensureDriveFolderExists(drive, rootFolderId, `${getStagingPrefix()}AM Applications`);
  const { docId, docUrl } = await getOrCreateIndexDoc(
    drive, docs, rootFolderId, amFolderId, `${getStagingPrefix()}AM Applications — Index`
  );

  const subfolders = await listApplicantFolders(drive, amFolderId);
  const entries: IndexEntry[] = [];

  for (const folder of subfolders) {
    const docsInFolder = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.document' and '${folder.id}' in parents and trashed=false`,
      fields: "files(id)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const doc = docsInFolder.data.files?.[0];
    const email = folder.name.match(/\(([^)]+)\)$/)?.[1] ?? "";
    entries.push({
      name: folder.name,
      email,
      docUrl: doc ? `https://docs.google.com/document/d/${doc.id}` : "",
      folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  await updateIndexDoc(docs, docId, `${getStagingPrefix()}AM Applications — Index`, entries);
  logger.info("am_index_doc_refreshed", { docUrl, entryCount: entries.length });
}
