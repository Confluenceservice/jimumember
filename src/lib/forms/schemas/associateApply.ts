/**
 * Associate Application — schema (TS structure side).
 *
 * 16-column `Associate Applications` sheet (per google-sheets.ts:173).
 * This is a DIFFERENT sheet + DIFFERENT flow from renewals (plan
 * finding C1): deferred-subscription flow with proration, not a one-time
 * payment via the [tier] checkout route. The schema here validates +
 * maps fields; the route stays as `create-checkout-session.ts` and
 * imports `validateTier` / `toRow` for the 13 form-derived cells only.
 *
 * Form-derived cells (13 of 16):
 *   C firstName, D lastName, E email, F phone, G fullAddress,
 *   H postalAddress, I businessName, J interestJoining, K trainingDetails,
 *   L listOnPage, M listingDetails, N signature, O applicationDate
 * Managed cells stay in `create-checkout-session.ts` /
 * `appendAssociateApplication`:
 *   A submittedAt, B applicationId, P checkoutStatus
 *
 * `listingDetails` is gated by `visibleWhen: v.listOnPage === "yes"`
 * (server-side, plan finding M3 — option values stay in TS, not JSON).
 * A `conditional` validator makes it required only when listed.
 */

import type { FormSchema } from "../types";
import { emailNZ, phoneNZ, required } from "../validators";
import { conditional } from "../validators";

export const schema: FormSchema = {
  id: "associateApply",
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "details",
      fields: [
        { name: "firstName", type: "text", required: true, contentKey: "details.firstName", validators: [required] },
        { name: "lastName", type: "text", required: true, contentKey: "details.lastName", validators: [required] },
        { name: "email", type: "email", required: true, contentKey: "details.email", validators: [required, emailNZ] },
        { name: "phone", type: "tel", required: true, contentKey: "details.phone", validators: [required, phoneNZ] },
        { name: "fullAddress", type: "text", required: true, contentKey: "details.fullAddress", validators: [required] },
        { name: "postalAddress", type: "text", required: false, contentKey: "details.postalAddress" },
        { name: "businessName", type: "text", required: false, contentKey: "details.businessName" },
        { name: "interestJoining", type: "textarea", required: true, contentKey: "details.interestJoining", validators: [required] },
        { name: "trainingDetails", type: "textarea", required: true, contentKey: "details.trainingDetails", validators: [required] },
        {
          name: "listOnPage",
          type: "radio",
          required: true,
          contentKey: "details.listOnPage",
          serialize: "upper",
          validators: [required],
          options: [
            { value: "yes", label: "Yes — list me on the public directory" },
            { value: "no", label: "No — keep me unlisted" },
          ],
        },
        {
          name: "listingDetails",
          type: "textarea",
          required: false,
          contentKey: "details.listingDetails",
          validators: [conditional((v) => v.listOnPage === "yes")],
          visibleWhen: (v) => v.listOnPage === "yes",
        },
        { name: "signature", type: "text", required: true, contentKey: "details.signature", validators: [required] },
        { name: "applicationDate", type: "date", required: true, contentKey: "details.applicationDate", validators: [required] },
      ],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Associate Applications",
    columnMap: {
      firstName: "C",
      lastName: "D",
      email: "E",
      phone: "F",
      fullAddress: "G",
      postalAddress: "H",
      businessName: "I",
      interestJoining: "J",
      trainingDetails: "K",
      listOnPage: "L",
      listingDetails: "M",
      signature: "N",
      applicationDate: "O",
    },
    rowFactory: "appendAssociateApplication",
  },
};