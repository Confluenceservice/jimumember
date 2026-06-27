/**
 * Example schema — Member Survey (Phase E sample).
 *
 * Deliberately non-production. Demonstrates every FieldDefinition variant
 * in a single schema so non-developers can see the full surface before
 * composing their own form. NOT registered in TIERS — this is a reference
 * template, not a real member flow.
 *
 * Smoke-rendered at `/_dev/forms/example` for visual review.
 *
 * The form exercises:
 *   - text / email / tel / date / number / textarea
 *   - select / radio (with options + custom values)
 *   - checkbox
 *   - repeatable (course feedback rows)
 *   - grid (satisfaction ratings across 4 dimensions)
 *   - group (2 nested sub-objects)
 *   - visibleWhen + conditional required (referral source drives follow-up)
 */

import type { FormSchema } from "../types";
import {
  emailNZ,
  phoneNZ,
  required,
  conditional,
} from "../validators";

const SATISFACTION_OPTIONS = [
  { value: "very", label: "Very satisfied" },
  { value: "somewhat", label: "Somewhat satisfied" },
  { value: "neutral", label: "Neutral" },
  { value: "unsatisfied", label: "Unsatisfied" },
];

export const schema: FormSchema = {
  id: "exampleMemberSurvey",
  content: {} as FormSchema["content"],
  steps: [
    {
      id: "identity",
      fields: [
        { name: "firstName", type: "text", required: true, contentKey: "identity.firstName", validators: [required], placeholder: "Jane" },
        { name: "lastName", type: "text", required: true, contentKey: "identity.lastName", validators: [required] },
        { name: "email", type: "email", required: true, contentKey: "identity.email", validators: [required, emailNZ] },
        { name: "phone", type: "tel", required: false, contentKey: "identity.phone", validators: [phoneNZ] },
        { name: "memberSince", type: "date", required: true, contentKey: "identity.memberSince", validators: [required] },
      ],
    },
    {
      id: "feedback",
      fields: [
        {
          name: "satisfaction",
          type: "radio",
          required: true,
          contentKey: "feedback.satisfaction",
          validators: [required],
          options: SATISFACTION_OPTIONS,
        },
        {
          name: "improvementAreas",
          type: "select",
          required: true,
          contentKey: "feedback.improvementAreas",
          validators: [required],
          options: [
            { value: "events", label: "Events and meetups" },
            { value: "resources", label: "Member resources" },
            { value: "comms", label: "Communication" },
            { value: "training", label: "Training and PD" },
          ],
        },
        {
          name: "comments",
          type: "textarea",
          required: false,
          contentKey: "feedback.comments",
          placeholder: "Anything else you'd like the committee to know?",
        },
      ],
    },
    {
      id: "ratings",
      fields: [
        {
          name: "ratings",
          type: "grid",
          required: false,
          contentKey: "ratings",
          serialize: "json",
          columns: [
            { name: "events", type: "radio" },
            { name: "resources", type: "radio" },
            { name: "comms", type: "radio" },
            { name: "training", type: "radio" },
          ],
        },
      ],
    },
    {
      id: "activities",
      fields: [
        {
          name: "coursesAttended",
          type: "repeatable",
          required: false,
          contentKey: "activities.coursesAttended",
          serialize: "json",
          itemFields: [
            { name: "title", type: "text", required: false, contentKey: "activities.coursesAttended.title" },
            { name: "date", type: "date", required: false, contentKey: "activities.coursesAttended.date" },
            { name: "rating", type: "number", required: false, contentKey: "activities.coursesAttended.rating" },
          ],
        },
        {
          name: "wouldRecommend",
          type: "checkbox",
          required: false,
          contentKey: "activities.wouldRecommend",
        },
        {
          name: "referralSource",
          type: "radio",
          required: false,
          contentKey: "activities.referralSource",
          options: [
            { value: "friend", label: "Friend or colleague" },
            { value: "event", label: "Event" },
            { value: "online", label: "Online search" },
            { value: "other", label: "Other" },
          ],
        },
        {
          name: "referralDetail",
          type: "textarea",
          required: false,
          contentKey: "activities.referralDetail",
          validators: [conditional((v) => v.referralSource === "other")],
          visibleWhen: (v) => v.referralSource === "other",
        },
      ],
    },
    {
      id: "contact",
      fields: [
        {
          name: "address",
          type: "group",
          contentKey: "contact",
          fields: [
            { name: "street", type: "text", required: false, contentKey: "contact.street" },
            { name: "city", type: "text", required: false, contentKey: "contact.city" },
            { name: "postcode", type: "text", required: false, contentKey: "contact.postcode" },
          ],
        },
      ],
    },
  ],
  storage: {
    kind: "sheet",
    sheetName: "Member Survey Responses",
    columnMap: {
      firstName: "A",
      lastName: "B",
      email: "C",
      phone: "D",
      memberSince: "E",
      satisfaction: "F",
      improvementAreas: "G",
      comments: "H",
      ratings: "I",
      coursesAttended: "J",
      wouldRecommend: "K",
      referralSource: "L",
      referralDetail: "M",
      "address.street": "N",
      "address.city": "O",
      "address.postcode": "P",
    },
    rowFactory: "createApplicantRow",
  },
};