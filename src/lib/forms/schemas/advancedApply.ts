/**
 * Professional Application — schema (TS structure side).
 *
 * 8-step wizard mirroring the existing apply.astro layout:
 *   1. About You       — identity fields
 *   2. Training        — repeatable rows (name, provider, year)
 *   3. Experience      — repeatable rows + 3 fixed example narratives
 *   4. Further Reqs    — 8 Y/N questions (grid)
 *   5. Competencies    — 21 Y/N grid (plan finding m2: id-order serialization)
 *   6. Referees        — 2 referee blocks (group)
 *   7. Declarations    — 8 confirmation checkboxes
 *   8. Document Upload — multi-file per doc type
 *
 * Content (labels + ordering) lives in `advancedApply.content.json` —
 * 21 competency labels + 8 declaration labels + 8 Y/N question labels +
 * doc-type descriptions = 38 string labels editable by non-developers.
 *
 * 47-column row layout: `createApplicantRow` takes 31 positional args
 * (the original 31 form-derived cells). Managed cells (emailHash,
 * created_at, doc counts, complete, paid, payment_ref, declarationSignedAt)
 * stay in `apply.ts` + `upload-sheet.ts` — `toRow` produces the
 * form-derived cells only.
 */

import type { FormSchema } from "../types";
import { email, phone, required } from "../validators";
import content from "./advancedApply.content.json";

/**
 * Grid column ids are derived from the content JSON's `options` map keys —
 * NOT hardcoded in TS as org-specific constants. Rationale (Phase L):
 * the framework must be dynamically composable; the TS file owns the
 * PATTERN (a grid of column radios), the JSON owns the per-org content
 * (which competencies + which further-requirements questions).
 *
 * The keys remain the production contract (sheet column-O + column-N
 * keys + order are stable). Reordering the JSON options silently breaks
 * the historical sheet data — same constraint as before, just expressed
 * in the editable surface.
 */
const FURTHER_REQUIREMENT_IDS = Object.keys(
  content.steps.furtherRequirements.fields.furtherRequirements.options,
);

/**
 * Re-exported for tests + any caller that needs the column-id list. Source
 * of truth is the content JSON's `options` map keys (see comment above).
 */
export const COMPETENCY_IDS = Object.keys(
  content.steps.competencies.fields.coreCompetencies.options,
);

/**
 * Upload doc types follow the same Phase-L pattern as competencies: the
 * content JSON's `uploads.docTypes` map owns WHICH doc types exist and
 * their labels (per-org content, non-dev editable); TS owns only the
 * validation contract — which of them are required. Unknown ids added in
 * the JSON default to required (fail-safe for compliance docs).
 */
const DOC_TYPE_REQUIRED: Record<string, boolean> = {
  insurance: false,
};

export const schema: FormSchema = {
  id: "advancedApply",
  content: {} as FormSchema["content"], // loaded from .content.json
  steps: [
    // ── Step 1: About You ─────────────────────────────────────────────
    {
      id: "about",
      fields: [
        { name: "firstName", type: "text", required: true, contentKey: "about.firstName", validators: [required], placeholder: "Jane", autocomplete: "given-name" },
        { name: "lastName", type: "text", required: true, contentKey: "about.lastName", validators: [required], placeholder: "Doe", autocomplete: "family-name" },
        { name: "dateOfBirth", type: "date", required: true, contentKey: "about.dateOfBirth", validators: [required] },
        { name: "ethnicity", type: "text", required: false, contentKey: "about.ethnicity", placeholder: "e.g. NZ European" },
        { name: "address", type: "textarea", required: false, contentKey: "about.address", placeholder: "Street, suburb, city, postcode" },
        { name: "postalAddress", type: "textarea", required: false, contentKey: "about.postalAddress", placeholder: "If different from above" },
        { name: "phone", type: "tel", required: false, contentKey: "about.phone", validators: [phone], autocomplete: "tel" },
        { name: "email", type: "email", required: true, contentKey: "about.email", validators: [required, email], autocomplete: "email" },
        { name: "businessName", type: "text", required: false, contentKey: "about.businessName" },
        { name: "website", type: "text", required: false, contentKey: "about.website", placeholder: "https://" },
      ],
    },

    // ── Step 2: Training & Education ──────────────────────────────────
    {
      id: "training",
      fields: [
        {
          name: "qualifications",
          type: "repeatable",
          required: true,
          contentKey: "training.qualifications",
          serialize: "json",
          minRows: 1,
          validators: [required],
          itemFields: [
            { name: "name", type: "text", required: true, contentKey: "training.qualifications.name", validators: [required] },
            { name: "provider", type: "text", required: false, contentKey: "training.qualifications.provider" },
            { name: "year", type: "number", required: false, contentKey: "training.qualifications.year" },
          ],
        },
      ],
    },

    // ── Step 3: Experience ─────────────────────────────────────────────
    {
      id: "experience",
      fields: [
        {
          name: "experience",
          type: "repeatable",
          required: false,
          contentKey: "experience.rows",
          serialize: "json",
          itemFields: [
            { name: "role", type: "text", required: false, contentKey: "experience.rows.role", placeholder: "Role or position" },
            { name: "skills", type: "textarea", required: false, contentKey: "experience.rows.skills" },
            { name: "description", type: "textarea", required: false, contentKey: "experience.rows.description" },
          ],
        },
        {
          name: "example1",
          type: "textarea",
          required: false,
          contentKey: "experience.example1",
          placeholder: "Describe your experience…",
        },
        {
          name: "example2",
          type: "textarea",
          required: false,
          contentKey: "experience.example2",
          placeholder: "Optional second example…",
        },
        {
          name: "example3",
          type: "textarea",
          required: false,
          contentKey: "experience.example3",
          placeholder: "Optional third example…",
        },
      ],
    },

    // ── Step 4: Further Requirements (8 independent Y/N) ──────────────
    // Modeled as a grid (not a single radio) — column N is a JSON OBJECT of
    // 8 independent yes/no answers per the CLAUDE.md sheet contract, not a
    // single selection. Mirrors the coreCompetencies grid: each column is one
    // question, serialized together into one cell. The YES/NO-vs-tick
    // rendering is a renderer concern handled when the page is wired (Phase C').
    {
      id: "furtherRequirements",
      fields: [
        {
          name: "furtherRequirements",
          type: "grid",
          required: true,
          contentKey: "furtherRequirements.furtherRequirements",
          serialize: "json",
          validators: [required],
          // `willInsurance` is the one optional row ("recommended"); every
          // other requirement must be answered. Client step validation derives
          // the required set from these flags — no hardcoded list in the page.
          columns: FURTHER_REQUIREMENT_IDS.map((id) => ({
            name: id,
            type: "radio" as const,
            required: id !== "willInsurance",
          })),
        },
      ],
    },

    // ── Step 5: Core Competencies (21 Y/N grid) ──────────────────────
    {
      id: "competencies",
      fields: [
        {
          name: "coreCompetencies",
          type: "grid",
          required: true,
          contentKey: "competencies.coreCompetencies",
          serialize: "json",
          validators: [required],
          columns: COMPETENCY_IDS.map((id) => ({ name: id, type: "radio" as const })),
        },
      ],
    },

    // ── Step 6: Referees (2 blocks) ────────────────────────────────────
    {
      id: "referees",
      fields: [
        {
          name: "referees",
          type: "group",
          contentKey: "referees",
          fields: [
            { name: "referee1Name", type: "text", required: true, contentKey: "referees.referee1Name", validators: [required] },
            { name: "referee1Role", type: "text", required: false, contentKey: "referees.referee1Role" },
            { name: "referee1Email", type: "email", required: true, contentKey: "referees.referee1Email", validators: [required, email] },
            { name: "referee1Phone", type: "tel", required: false, contentKey: "referees.referee1Phone", validators: [phone] },
            { name: "referee2Name", type: "text", required: true, contentKey: "referees.referee2Name", validators: [required] },
            { name: "referee2Role", type: "text", required: false, contentKey: "referees.referee2Role" },
            { name: "referee2Email", type: "email", required: true, contentKey: "referees.referee2Email", validators: [required, email] },
            { name: "referee2Phone", type: "tel", required: false, contentKey: "referees.referee2Phone", validators: [phone] },
          ],
        },
      ],
    },

    // ── Step 7: Declarations (8 checkboxes) ───────────────────────────
    {
      id: "declarations",
      fields: [
        { name: "declarationAccuracy", type: "checkbox", required: true, contentKey: "declarations.accuracy", validators: [required] },
        { name: "declarationEthics", type: "checkbox", required: true, contentKey: "declarations.ethics", validators: [required] },
        { name: "declarationScope", type: "checkbox", required: true, contentKey: "declarations.scope", validators: [required] },
        { name: "declarationMemberServices", type: "checkbox", required: true, contentKey: "declarations.memberServices", validators: [required] },
        { name: "declarationInterview", type: "checkbox", required: true, contentKey: "declarations.interview", validators: [required] },
        { name: "declarationProfessionalDev", type: "checkbox", required: true, contentKey: "declarations.professionalDev", validators: [required] },
        { name: "declarationCriminalCheck", type: "checkbox", required: true, contentKey: "declarations.criminalCheck", validators: [required] },
        { name: "declarationMeetings", type: "checkbox", required: true, contentKey: "declarations.meetings", validators: [required] },
        { name: "signature", type: "signature", required: true, contentKey: "declarations.signature", validators: [required] },
      ],
    },

    // ── Step 8: Document Upload (handled by form-client.ts + dedicated API) ──
    {
      id: "uploads",
      fields: [],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Advanced Applications",
    columnMap: {
      // 31 form-derived columns. Letters mirror `createApplicantRow`'s
      // positional contract in upload-sheet.ts. Managed cells (emailHash,
      // doc counts, complete, paid, payment_ref, declarationSignedAt,
      // created_at, paid_at) stay in upload-sheet.ts / apply.ts.
      firstName: "C",
      lastName: "D",
      phone: "E",
      email: "B",
      dateOfBirth: "F",
      ethnicity: "G",
      address: "H",
      postalAddress: "I",
      businessName: "J",
      website: "K",
      qualifications: "L",
      experience: "M",
      furtherRequirements: "N",
      coreCompetencies: "O",
      referee1Name: "P",
      referee1Role: "Q",
      referee1Email: "R",
      referee1Phone: "S",
      referee2Name: "T",
      referee2Role: "U",
      referee2Email: "V",
      referee2Phone: "W",
      declarationAccuracy: "X",
      declarationEthics: "Y",
      declarationScope: "Z",
      declarationMemberServices: "AA",
      declarationInterview: "AB",
      declarationProfessionalDev: "AC",
      declarationCriminalCheck: "AD",
      declarationMeetings: "AE",
      // AF declaration_signed_at is a managed cell (written in apply.ts).
      signature: "AV",
    },
    rowFactory: "createApplicantRow",
  },
  uploads: {
    docTypes: Object.entries(content.uploads.docTypes).map(([id, label]) => ({
      id,
      label,
      required: DOC_TYPE_REQUIRED[id] ?? true,
    })),
  },
};