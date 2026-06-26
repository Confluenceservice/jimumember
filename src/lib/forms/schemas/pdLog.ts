/**
 * PD Log — schema (TS structure side).
 *
 * Single-entry form used by token-gated `renew/pd-log.astro`. Reuses the
 * same row shape as renewPro.pdEntries itemFields. Stored in the Renewals
 * sheet's H column via appendRenewal with the rest of the row already
 * populated by the prior renewal.
 *
 * For Phase D this schema is informational — the page + API still work
 * via the existing positional shape. Migration to use validateTier
 * is a Phase D' follow-up.
 */

import type { FormSchema } from "../types";
import { required } from "../validators";

export const schema: FormSchema = {
  id: "pdLog",
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "entry",
      fields: [
        { name: "dateCompleted", type: "date", required: true, contentKey: "entry.dateCompleted", validators: [required] },
        { name: "activity", type: "text", required: true, contentKey: "entry.activity", validators: [required], placeholder: "e.g. course, webinar, book, PD event" },
        { name: "totalHours", type: "number", required: true, contentKey: "entry.totalHours", validators: [required] },
        { name: "provider", type: "text", required: false, contentKey: "entry.provider" },
      ],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Renewals",
    columnMap: {
      pdEntries: "H",
    },
    rowFactory: "appendRenewal",
  },
};