/**
 * Associate Renewal — schema (TS structure side).
 *
 * Four-field identity form (firstName, lastName, email, year). Year is
 * pre-filled from the URL (or the current year) and validated as an
 * integer in [2024, 2100].
 *
 * `appendRenewal` takes named args, so the API route passes
 * `result.values` straight through after merging managed cells
 * (renewalId, tier, phone, pdEntries, amountCents, currency, etc.).
 * `toRow` is reserved for positional adapters (Phase C — `createApplicantRow`'s
 * 31 positional args).
 *
 * Storage column map (form-derived cells only):
 *   C renewal_year, D first_name, E last_name, F email
 *   (A renewal_id, B tier, G phone, H pd_entries, I amount_paid_cents,
 *    J currency, K payment_status, L stripe_session, M created_at,
 *    N paid_at are managed cells — written by the API route + Stripe
 *    webhook, not by this schema.)
 */

import type { FormSchema } from "../types";
import { emailNZ, integer, max, min, required } from "../validators";

export const schema: FormSchema = {
  id: "renewBasic",
  // Content loaded from renewAssociate.content.json at runtime by loadSchema().
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "identity",
      fields: [
        {
          name: "firstName",
          type: "text",
          required: true,
          contentKey: "identity.firstName",
          validators: [required],
        },
        {
          name: "lastName",
          type: "text",
          required: true,
          contentKey: "identity.lastName",
          validators: [required],
        },
        {
          name: "email",
          type: "email",
          required: true,
          contentKey: "identity.email",
          validators: [required, emailNZ],
        },
        {
          name: "year",
          type: "number",
          required: true,
          contentKey: "identity.year",
          validators: [required, integer, min(2024), max(2100)],
        },
      ],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Renewals",
    columnMap: {
      year: "C",
      firstName: "D",
      lastName: "E",
      email: "F",
    },
    rowFactory: "appendRenewal",
  },
};