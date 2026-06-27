/**
 * Professional Renewal — schema (TS structure side).
 *
 * Same 14-column Renewals sheet layout as `renewAssociate`, plus a
 * phone field and a repeatable `pdEntries` collection (10 hours/year
 * commitment). Phone is required for Pro (Associate doesn't collect it).
 *
 * columnMap form-derived cells:
 *   C renewal_year, D first_name, E last_name, F email, G phone,
 *   H pd_entries (JSON)
 * Managed cells (A renewal_id, B tier, I amount_paid_cents, J currency,
 * K payment_status, L stripe_session, M created_at, N paid_at) stay
 * in the API route + Stripe webhook.
 */

import type { FormSchema } from "../types";
import { emailNZ, phoneNZ, required } from "../validators";

export const schema: FormSchema = {
  id: "renewAdvanced",
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "identity",
      fields: [
        { name: "firstName", type: "text", required: true, contentKey: "identity.firstName", validators: [required] },
        { name: "lastName", type: "text", required: true, contentKey: "identity.lastName", validators: [required] },
        { name: "email", type: "email", required: true, contentKey: "identity.email", validators: [required, emailNZ] },
        { name: "phone", type: "tel", required: true, contentKey: "identity.phone", validators: [required, phoneNZ] },
        { name: "year", type: "number", required: true, contentKey: "identity.year", validators: [required] },
        {
          name: "pdEntries",
          type: "repeatable",
          required: false,
          contentKey: "identity.pdEntries",
          serialize: "json",
          minRows: 0,
          itemFields: [
            { name: "dateCompleted", type: "date", required: false, contentKey: "identity.pdEntries.dateCompleted" },
            { name: "activity", type: "text", required: false, contentKey: "identity.pdEntries.activity" },
            { name: "totalHours", type: "number", required: false, contentKey: "identity.pdEntries.totalHours" },
            { name: "provider", type: "text", required: false, contentKey: "identity.pdEntries.provider" },
          ],
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
      phone: "G",
      pdEntries: "H",
    },
    rowFactory: "appendRenewal",
  },
};