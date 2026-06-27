/**
 * PD Log — schema (TS structure side).
 *
 * Token-gated `renew/pd-log.astro` page. Single repeatable `entries`
 * whose item shape matches `renewPro.pdEntries.itemFields` (dateCompleted,
 * activity, totalHours, provider). Server stores JSON in Renewals H
 * column via `updateRenewalPdEntries(renewalId, entries)` — same writer
 * used by the pro renewal flow.
 *
 * Validation: handler builds a synthetic per-entry schema from
 * `entries.itemFields` and calls `validate()` once per entry. `walkFields`
 * does not descend into repeatable itemFields (treats the array as a
 * leaf), so per-entry validation lives in the handler.
 */

import type { FormSchema } from "../types";
import { required } from "../validators";

export const schema: FormSchema = {
  id: "pdLog",
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "entries",
      fields: [
        {
          name: "entries",
          type: "repeatable",
          required: false,
          contentKey: "entries.entries",
          serialize: "json",
          minRows: 0,
          itemFields: [
            { name: "dateCompleted", type: "date", required: true, contentKey: "entries.dateCompleted", validators: [required] },
            { name: "activity", type: "text", required: true, contentKey: "entries.activity", validators: [required] },
            { name: "totalHours", type: "number", required: true, contentKey: "entries.totalHours", validators: [required] },
            { name: "provider", type: "text", required: false, contentKey: "entries.provider" },
          ],
        },
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
