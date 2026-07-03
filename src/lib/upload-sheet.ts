import crypto from "node:crypto";
import { logger } from "./logger";
import { TIERS, getTier } from "./forms/tiers";
import {
  ensureSheetWithHeaders,
  readRange,
  updateRange,
  batchUpdateRanges,
  appendToRange,
} from "./google-sheets-helpers";

export const REQUIRED_DOC_TYPES = [
  "training",
  "ethics",
  "criminal",
  "advance_care",
  "assisted_dying",
  "fundamentals",
] as const;

export const OPTIONAL_DOC_TYPES = ["insurance"] as const;

export type DocType = (typeof REQUIRED_DOC_TYPES)[number];

export interface UploadStatus {
  applicantId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  emailHash: string;
  docs: Partial<Record<DocType, number>>;
  complete: boolean;
  stripeSessionId?: string;
  paid: boolean;
  createdAt: string;
  paidAt?: string;
}

/**
 * Phase M: sheet name resolved from TIERS by applicationSchemaId — keeps
 * the advancedApply → "Advanced Applications" mapping config-driven. The
 * legacy upload-sheet.ts was tied to a single tier (advanced); now any
 * application schema gets its own sheet via `getTier(schemaSlug).sheetName`.
 */
function sheetNameForApplicationSchema(schemaSlug: string): string {
  // Try matching by applicationSchemaId; fall back to the first tier that
  // matches the slug pattern, then to the advanced tier (preserves the
  // legacy hardcoded behaviour for the advanced-apply flow).
  for (const t of Object.values(TIERS)) {
    if (t.applicationSchemaId === schemaSlug) return t.sheetName;
  }
  return getTier("advanced").sheetName;
}

const DEFAULT_SHEET_NAME = getTier("advanced").sheetName;

// 47 columns: A through AU
const SHEET_HEADERS = [
  "applicant_id",     // A
  "email",           // B
  "first_name",      // C
  "last_name",       // D
  "phone",           // E
  "date_of_birth",   // F
  "ethnicity",       // G
  "address",        // H
  "postal_address",  // I
  "business_name",   // J
  "website",        // K
  "qualifications",  // L  (JSON array)
  "experience",     // M  (JSON array)
  "further_requirements", // N  (JSON object of Y/N responses)
  "core_competencies",    // O  (JSON array of Y/N responses)
  "referee1_name",        // P
  "referee1_role",        // Q
  "referee1_email",       // R
  "referee1_phone",      // S
  "referee2_name",        // T
  "referee2_role",       // U
  "referee2_email",      // V
  "referee2_phone",       // W
  "declaration_accuracy",     // X
  "declaration_ethics",       // Y
  "declaration_scope",        // Z
  "declaration_doula_services",  // AA
  "declaration_interview",       // AB
  "declaration_professional_dev", // AC
  "declaration_criminal_check",   // AD
  "declaration_meetings",         // AE
  "declaration_signed_at",        // AF
  "resume_token",    // AG
  "email_hash",      // AH
  "doc_training_count",    // AI
  "doc_ethics_count",      // AJ
  "doc_criminal_count",    // AK
  "doc_advance_care_count",  // AL
  "doc_assisted_dying_count", // AM
  "doc_fundamentals_count",   // AN
  "doc_insurance_count",      // AO
  "complete",        // AP
  "stripe_session",  // AQ
  "paid",           // AR
  "created_at",     // AS
  "paid_at",        // AT
  "email_verified", // AU  (blank = legacy, treated as verified)
];

function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

// Column AU (index 46). Blank = legacy row, treated as verified so existing
// applicants are not locked out. New rows write "FALSE" and flip to "TRUE"
// when the applicant clicks the emailed resume link.
function parseEmailVerified(raw: unknown): string {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "") return "TRUE";
  return v === "TRUE" ? "TRUE" : "FALSE";
}

export async function createApplicantRow(
  applicantId: string,
  firstName: string,
  lastName: string,
  phone: string,
  email: string,
  resumeToken: string,
  // New form fields (all optional for backwards compat)
  dateOfBirth = "",
  ethnicity = "",
  address = "",
  postalAddress = "",
  businessName = "",
  website = "",
  qualifications = "",
  experience = "",
  furtherRequirements = "",
  coreCompetencies = "",
  referee1Name = "",
  referee1Role = "",
  referee1Email = "",
  referee1Phone = "",
  referee2Name = "",
  referee2Role = "",
  referee2Email = "",
  referee2Phone = "",
  declarationAccuracy = "",
  declarationEthics = "",
  declarationScope = "",
  declarationDoulaServices = "",
  declarationInterview = "",
  declarationProfessionalDev = "",
  declarationCriminalCheck = "",
  declarationMeetings = "",
  declarationSignedAt = "",
  emailVerified = "FALSE"
): Promise<void> {
  await ensureSheetWithHeaders(DEFAULT_SHEET_NAME, SHEET_HEADERS);

  const emailHash = hashEmail(email);

  const row = [
    applicantId,     // A
    email,           // B
    firstName,       // C
    lastName,        // D
    phone,           // E
    dateOfBirth,     // F
    ethnicity,       // G
    address,        // H
    postalAddress,  // I
    businessName,   // J
    website,        // K
    qualifications,  // L
    experience,     // M
    furtherRequirements, // N
    coreCompetencies,    // O
    referee1Name,        // P
    referee1Role,        // Q
    referee1Email,       // R
    referee1Phone,      // S
    referee2Name,        // T
    referee2Role,       // U
    referee2Email,      // V
    referee2Phone,       // W
    declarationAccuracy,     // X
    declarationEthics,       // Y
    declarationScope,        // Z
    declarationDoulaServices,  // AA
    declarationInterview,       // AB
    declarationProfessionalDev, // AC
    declarationCriminalCheck,   // AD
    declarationMeetings,         // AE
    declarationSignedAt,        // AF
    resumeToken,    // AG
    emailHash,      // AH
    0, // doc_training_count  // AI
    0, // doc_ethics_count    // AJ
    0, // doc_criminal_count  // AK
    0, // doc_advance_care_count // AL
    0, // doc_assisted_dying_count // AM
    0, // doc_fundamentals_count  // AN
    0, // doc_insurance_count     // AO
    "FALSE", // complete   // AP
    "", // stripe_session  // AQ
    "FALSE", // paid      // AR
    new Date().toISOString(), // created_at // AS
    "", // paid_at         // AT
    emailVerified, // AU   (default "FALSE" — verified by clicking emailed link)
  ];

  await appendToRange(`'${DEFAULT_SHEET_NAME}'!A:AU`, row);
}

export async function updateApplicantFormData(
  applicantId: string,
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    dateOfBirth?: string;
    ethnicity?: string;
    address?: string;
    postalAddress?: string;
    businessName?: string;
    website?: string;
    qualifications?: string;
    experience?: string;
    furtherRequirements?: string;
    coreCompetencies?: string;
    referee1Name?: string;
    referee1Role?: string;
    referee1Email?: string;
    referee1Phone?: string;
    referee2Name?: string;
    referee2Role?: string;
    referee2Email?: string;
    referee2Phone?: string;
    declarationAccuracy?: string;
    declarationEthics?: string;
    declarationScope?: string;
    declarationDoulaServices?: string;
    declarationInterview?: string;
    declarationProfessionalDev?: string;
    declarationCriminalCheck?: string;
    declarationMeetings?: string;
    declarationSignedAt?: string;
  }
): Promise<void> {
  await ensureSheetWithHeaders(DEFAULT_SHEET_NAME, SHEET_HEADERS);

  // Find row by applicant_id
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:A`);
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Build update values - column letter -> value
  const colMap: Record<string, string> = {
    B: data.email ?? "",
    C: data.firstName ?? "",
    D: data.lastName ?? "",
    E: data.phone ?? "",
    F: data.dateOfBirth ?? "",
    G: data.ethnicity ?? "",
    H: data.address ?? "",
    I: data.postalAddress ?? "",
    J: data.businessName ?? "",
    K: data.website ?? "",
    L: data.qualifications ?? "",
    M: data.experience ?? "",
    N: data.furtherRequirements ?? "",
    O: data.coreCompetencies ?? "",
    P: data.referee1Name ?? "",
    Q: data.referee1Role ?? "",
    R: data.referee1Email ?? "",
    S: data.referee1Phone ?? "",
    T: data.referee2Name ?? "",
    U: data.referee2Role ?? "",
    V: data.referee2Email ?? "",
    W: data.referee2Phone ?? "",
    X: data.declarationAccuracy ?? "",
    Y: data.declarationEthics ?? "",
    Z: data.declarationScope ?? "",
    AA: data.declarationDoulaServices ?? "",
    AB: data.declarationInterview ?? "",
    AC: data.declarationProfessionalDev ?? "",
    AD: data.declarationCriminalCheck ?? "",
    AE: data.declarationMeetings ?? "",
    AF: data.declarationSignedAt ?? "",
  };

  // Only update non-empty values; collect ranges
  const updates: { range: string; values: string[][] }[] = [];
  for (const [col, val] of Object.entries(colMap)) {
    if (val !== "") {
      updates.push({ range: `${DEFAULT_SHEET_NAME}!${col}${rowIndex}`, values: [[val]] });
    }
  }
  if (updates.length === 0) return;

  await batchUpdateRanges(updates);
}

export async function updateDocCount(
  applicantId: string,
  docType: string,
  count: number
): Promise<void> {
  // Find row by applicant_id
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:A`);
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  const colMap: Record<string, string> = {
    training: "AI",
    ethics: "AJ",
    criminal: "AK",
    advance_care: "AL",
    assisted_dying: "AM",
    fundamentals: "AN",
    insurance: "AO",
  };

  const col = colMap[docType];
  if (!col) return;

  await updateRange(`${DEFAULT_SHEET_NAME}!${col}${rowIndex}`, [[count]]);
}

export async function markComplete(
  applicantId: string,
  stripeSessionId: string
): Promise<void> {
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:A`);
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Update columns AP (complete) and AQ (stripe_session)
  await updateRange(`${DEFAULT_SHEET_NAME}!AP${rowIndex}:AQ${rowIndex}`, [["TRUE", stripeSessionId]]);
}

export async function markPaid(applicantId: string): Promise<void> {
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:A`);
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Update columns AR (paid) and AT (paid_at)
  const paidAt = new Date().toISOString();
  await batchUpdateRanges([
    { range: `${DEFAULT_SHEET_NAME}!AR${rowIndex}`, values: [["TRUE"]] },
    { range: `${DEFAULT_SHEET_NAME}!AT${rowIndex}`, values: [[paidAt]] },
  ]);
}

export async function markEmailVerified(applicantId: string): Promise<void> {
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:A`);
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === applicantId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error(`Applicant not found: ${applicantId}`);
  }

  // Column AU = email_verified. Best-effort write: callers (e.g. GET on token
  // load) should not fail the user-visible response if this write fails.
  await updateRange(`${DEFAULT_SHEET_NAME}!AU${rowIndex}`, [["TRUE"]]);
}

export interface ApplicantInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth: string;
  ethnicity: string;
  address: string;
  postalAddress: string;
  businessName: string;
  website: string;
  qualifications: string;
  experience: string;
  furtherRequirements: string;
  coreCompetencies: string;
  referee1Name: string;
  referee1Role: string;
  referee1Email: string;
  referee1Phone: string;
  referee2Name: string;
  referee2Role: string;
  referee2Email: string;
  referee2Phone: string;
  declarationAccuracy: string;
  declarationEthics: string;
  declarationScope: string;
  declarationDoulaServices: string;
  declarationInterview: string;
  declarationProfessionalDev: string;
  declarationCriminalCheck: string;
  declarationMeetings: string;
  declarationSignedAt: string;
  resumeToken: string;
  emailHash: string;
  docTrainingCount: number;
  docEthicsCount: number;
  docCriminalCount: number;
  docAdvanceCareCount: number;
  docAssistedDyingCount: number;
  docFundamentalsCount: number;
  docInsuranceCount: number;
  complete: string;
  stripeSession: string;
  paid: string;
  createdAt: string;
  paidAt: string;
  emailVerified: string;
}

export async function getApplicantByToken(
  token: string
): Promise<ApplicantInfo | null> {
  await ensureSheetWithHeaders(DEFAULT_SHEET_NAME, SHEET_HEADERS);

  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:AU`);

  // Row index: AG = column index 32 (0-based), so row[32] = resumeToken
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowToken = row[32] ?? "";
    if (rowToken === token) {
      const paidVal = row[43] ?? "FALSE";
      logger.info("getApplicantByToken_match", {
        rowIndex: i,
        matchedToken: rowToken,
        paidValue: paidVal,
        applicantId: row[0],
        tokenPrefix: token.substring(0, 8),
      });
      return {
        id: row[0] ?? "",
        email: row[1] ?? "",
        firstName: row[2] ?? "",
        lastName: row[3] ?? "",
        phone: row[4] ?? "",
        dateOfBirth: row[5] ?? "",
        ethnicity: row[6] ?? "",
        address: row[7] ?? "",
        postalAddress: row[8] ?? "",
        businessName: row[9] ?? "",
        website: row[10] ?? "",
        qualifications: row[11] ?? "",
        experience: row[12] ?? "",
        furtherRequirements: row[13] ?? "",
        coreCompetencies: row[14] ?? "",
        referee1Name: row[15] ?? "",
        referee1Role: row[16] ?? "",
        referee1Email: row[17] ?? "",
        referee1Phone: row[18] ?? "",
        referee2Name: row[19] ?? "",
        referee2Role: row[20] ?? "",
        referee2Email: row[21] ?? "",
        referee2Phone: row[22] ?? "",
        declarationAccuracy: row[23] ?? "",
        declarationEthics: row[24] ?? "",
        declarationScope: row[25] ?? "",
        declarationDoulaServices: row[26] ?? "",
        declarationInterview: row[27] ?? "",
        declarationProfessionalDev: row[28] ?? "",
        declarationCriminalCheck: row[29] ?? "",
        declarationMeetings: row[30] ?? "",
        declarationSignedAt: row[31] ?? "",
        resumeToken: row[32] ?? "",
        emailHash: row[33] ?? "",
        docTrainingCount: Number(row[34]) || 0,
        docEthicsCount: Number(row[35]) || 0,
        docCriminalCount: Number(row[36]) || 0,
        docAdvanceCareCount: Number(row[37]) || 0,
        docAssistedDyingCount: Number(row[38]) || 0,
        docFundamentalsCount: Number(row[39]) || 0,
        docInsuranceCount: Number(row[40]) || 0,
        complete: String(row[41] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        stripeSession: row[42] ?? "",
        paid: String(row[43] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        createdAt: row[44] ?? "",
        paidAt: row[45] ?? "",
        emailVerified: parseEmailVerified(row[46]),
      };
    }
  }

  return null;
}

export async function getApplicantByEmail(
  email: string
): Promise<ApplicantInfo | null> {
  await ensureSheetWithHeaders(DEFAULT_SHEET_NAME, SHEET_HEADERS);

  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:AU`);

  // row[1] = email (column B)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1]?.toLowerCase() === email.toLowerCase()) {
      return {
        id: row[0] ?? "",
        email: row[1] ?? "",
        firstName: row[2] ?? "",
        lastName: row[3] ?? "",
        phone: row[4] ?? "",
        dateOfBirth: row[5] ?? "",
        ethnicity: row[6] ?? "",
        address: row[7] ?? "",
        postalAddress: row[8] ?? "",
        businessName: row[9] ?? "",
        website: row[10] ?? "",
        qualifications: row[11] ?? "",
        experience: row[12] ?? "",
        furtherRequirements: row[13] ?? "",
        coreCompetencies: row[14] ?? "",
        referee1Name: row[15] ?? "",
        referee1Role: row[16] ?? "",
        referee1Email: row[17] ?? "",
        referee1Phone: row[18] ?? "",
        referee2Name: row[19] ?? "",
        referee2Role: row[20] ?? "",
        referee2Email: row[21] ?? "",
        referee2Phone: row[22] ?? "",
        declarationAccuracy: row[23] ?? "",
        declarationEthics: row[24] ?? "",
        declarationScope: row[25] ?? "",
        declarationDoulaServices: row[26] ?? "",
        declarationInterview: row[27] ?? "",
        declarationProfessionalDev: row[28] ?? "",
        declarationCriminalCheck: row[29] ?? "",
        declarationMeetings: row[30] ?? "",
        declarationSignedAt: row[31] ?? "",
        resumeToken: row[32] ?? "",
        emailHash: row[33] ?? "",
        docTrainingCount: Number(row[34]) || 0,
        docEthicsCount: Number(row[35]) || 0,
        docCriminalCount: Number(row[36]) || 0,
        docAdvanceCareCount: Number(row[37]) || 0,
        docAssistedDyingCount: Number(row[38]) || 0,
        docFundamentalsCount: Number(row[39]) || 0,
        docInsuranceCount: Number(row[40]) || 0,
        complete: String(row[41] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        stripeSession: row[42] ?? "",
        paid: String(row[43] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        createdAt: row[44] ?? "",
        paidAt: row[45] ?? "",
        emailVerified: parseEmailVerified(row[46]),
      };
    }
  }

  return null;
}

export async function getUploadStatus(
  applicantId: string
): Promise<UploadStatus | null> {
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:AU`);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === applicantId) {
      const docs: Partial<Record<DocType, number>> = {};
      docs.training = Number(row[34]) || 0;
      docs.ethics = Number(row[35]) || 0;
      docs.criminal = Number(row[36]) || 0;
      docs.advance_care = Number(row[37]) || 0;
      docs.assisted_dying = Number(row[38]) || 0;
      docs.fundamentals = Number(row[39]) || 0;

      const complete = String(row[41] ?? "").toUpperCase() === "TRUE";

      return {
        applicantId: row[0] ?? "",
        firstName: row[2] ?? "",
        lastName: row[3] ?? "",
        phone: row[4] ?? "",
        email: row[1] ?? "",
        emailHash: row[33] ?? "",
        docs,
        complete,
        stripeSessionId: row[42] || undefined,
        paid: String(row[43] ?? "").toUpperCase() === "TRUE",
        createdAt: row[44] ?? "",
        paidAt: row[45] || undefined,
      };
    }
  }

  return null;
}

// Check if all required form fields are filled (not empty)
function isFormComplete(applicant: ApplicantInfo): boolean {
  const requiredFields = [
    applicant.firstName,
    applicant.lastName,
    applicant.phone,
    applicant.email,
    applicant.dateOfBirth,
    applicant.ethnicity,
    applicant.address,
    applicant.phone,
    applicant.qualifications,
    applicant.experience,
    applicant.referee1Name,
    applicant.referee1Role,
    applicant.referee1Email,
    applicant.referee1Phone,
    applicant.referee2Name,
    applicant.referee2Role,
    applicant.referee2Email,
    applicant.referee2Phone,
  ];

  for (const field of requiredFields) {
    if (!field || field.trim() === "") return false;
  }

  // Check all 8 declarations are "TRUE"
  const declarations = [
    applicant.declarationAccuracy,
    applicant.declarationEthics,
    applicant.declarationScope,
    applicant.declarationDoulaServices,
    applicant.declarationInterview,
    applicant.declarationProfessionalDev,
    applicant.declarationCriminalCheck,
    applicant.declarationMeetings,
  ];

  for (const decl of declarations) {
    if (String(decl ?? "").toUpperCase() !== "TRUE") return false;
  }

  return true;
}

export async function validateCompletion(applicantId: string): Promise<boolean> {
  const applicant = await getApplicantById(applicantId);
  if (!applicant) return false;

  // Check form fields complete
  if (!isFormComplete(applicant)) return false;

  // Check all 6 required doc types have at least 1 file
  const requiredCounts = [
    applicant.docTrainingCount,
    applicant.docEthicsCount,
    applicant.docCriminalCount,
    applicant.docAdvanceCareCount,
    applicant.docAssistedDyingCount,
    applicant.docFundamentalsCount,
  ];

  for (const count of requiredCounts) {
    if (count < 1) return false;
  }

  return true;
}

export async function getApplicantById(applicantId: string): Promise<ApplicantInfo | null> {
  const rows = await readRange(`${DEFAULT_SHEET_NAME}!A:AU`);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === applicantId) {
      return {
        id: row[0] ?? "",
        email: row[1] ?? "",
        firstName: row[2] ?? "",
        lastName: row[3] ?? "",
        phone: row[4] ?? "",
        dateOfBirth: row[5] ?? "",
        ethnicity: row[6] ?? "",
        address: row[7] ?? "",
        postalAddress: row[8] ?? "",
        businessName: row[9] ?? "",
        website: row[10] ?? "",
        qualifications: row[11] ?? "",
        experience: row[12] ?? "",
        furtherRequirements: row[13] ?? "",
        coreCompetencies: row[14] ?? "",
        referee1Name: row[15] ?? "",
        referee1Role: row[16] ?? "",
        referee1Email: row[17] ?? "",
        referee1Phone: row[18] ?? "",
        referee2Name: row[19] ?? "",
        referee2Role: row[20] ?? "",
        referee2Email: row[21] ?? "",
        referee2Phone: row[22] ?? "",
        declarationAccuracy: row[23] ?? "",
        declarationEthics: row[24] ?? "",
        declarationScope: row[25] ?? "",
        declarationDoulaServices: row[26] ?? "",
        declarationInterview: row[27] ?? "",
        declarationProfessionalDev: row[28] ?? "",
        declarationCriminalCheck: row[29] ?? "",
        declarationMeetings: row[30] ?? "",
        declarationSignedAt: row[31] ?? "",
        resumeToken: row[32] ?? "",
        emailHash: row[33] ?? "",
        docTrainingCount: Number(row[34]) || 0,
        docEthicsCount: Number(row[35]) || 0,
        docCriminalCount: Number(row[36]) || 0,
        docAdvanceCareCount: Number(row[37]) || 0,
        docAssistedDyingCount: Number(row[38]) || 0,
        docFundamentalsCount: Number(row[39]) || 0,
        docInsuranceCount: Number(row[40]) || 0,
        complete: String(row[41] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        stripeSession: row[42] ?? "",
        paid: String(row[43] ?? "").toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
        createdAt: row[44] ?? "",
        paidAt: row[45] ?? "",
        emailVerified: parseEmailVerified(row[46]),
      };
    }
  }

  return null;
}

export async function markApplicantPaid(
  applicantId: string,
  stripeSessionId: string
): Promise<void> {
  await markComplete(applicantId, stripeSessionId);
  await markPaid(applicantId);
}