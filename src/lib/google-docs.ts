import { google } from "googleapis";
import { logger } from "./logger";
import type { ApplicantInfo } from "./upload-sheet";

function getDocsClient() {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  const keyRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY?.trim();
  if (!email || !keyRaw) throw new Error("Missing GOOGLE_SHEETS service account config.");
  const key = keyRaw.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/documents"] });
  return google.docs({ version: "v1", auth });
}

function buildContent(applicant: ApplicantInfo) {
  const requests: object[] = [];
  let index = 0;

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
    index++; // newline
  }

  function h2(text: string) {
    const start = index;
    insert(text + "\n");
    setStyle(start, start + text.length, true, 14);
    index++; // newline
  }

  function p(text: string) {
    insert(text + "\n");
    index++;
  }

  function bullet(text: string) {
    insert("• " + text + "\n");
    index++;
  }

  function gap() {
    insert("\n");
    index++;
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
    ["Training certificates", applicant.docTrainingCount],
    ["Code of Ethics", applicant.docEthicsCount],
    ["Criminal Records Check", applicant.docCriminalCount],
    ["Advanced Care Planning", applicant.docAdvanceCareCount],
    ["Assisted Dying Training", applicant.docAssistedDyingCount],
    ["Fundamentals of Palliative Care", applicant.docFundamentalsCount],
    ["Professional Indemnity Insurance", applicant.docInsuranceCount],
  ];
  docCounts.forEach(([label, count]) => {
    p(`${label}: ${count || 0} file(s)`);
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
  applicant: ApplicantInfo,
  docCounts: Record<string, number>
): Promise<string> {
  const docs = getDocsClient();
  const folderId = process.env.GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID?.trim();

  const docTitle = `Professional Application — ${applicant.firstName} ${applicant.lastName} (${applicant.email})`;

  // Create the document
  const doc = await docs.documents.create({
    requestBody: { title: docTitle },
  });

  const docId = doc.data.documentId;
  if (!docId) throw new Error("Failed to create Google Doc");

  // Build and push content
  const requests = buildContent(applicant);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: requests as never[] },
    });
  }

  // Move to folder if folderId provided
  if (folderId) {
    try {
      const drive = google.drive({ version: "v3", auth: docs.auth as never });
      await drive.files.update({
        fileId: docId,
        addParents: [folderId],
        removeParents: ["root"],
      } as never);
    } catch (err) {
      logger.warn("review_doc_move_to_folder_failed", {
        docId,
        folderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const docUrl = `https://docs.google.com/document/d/${docId}`;
  logger.info("review_doc_created", { applicantId: applicant.id, docId, docUrl });

  return docUrl;
}
