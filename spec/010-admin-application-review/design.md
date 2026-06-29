# Design — Admin Application Review

> Spec ID: `010` · Type: system feature
> Depends on: `000-platform-overview`, `001-advanced-application`, `002-basic-application`, `008-stripe-webhook-side-effects`

## Overview

Async Google Doc generation per paid application. Aggregate index docs per tier.

## Component Design

1. **`src/lib/google-docs.ts`** — `createApplicationReviewDoc(applicant)`, `createBasicApplicationReviewDoc(application)`, `refreshAdvancedIndexDoc()`, `refreshBasicIndexDoc()`.

## Review Doc Template

```
# {ORG_NAME} — Application Review

**Applicant:** {firstName} {lastName}
**Email:** {email}
**Phone:** {phone}
**Paid:** {paidAt} (session {stripeSession})

## About You
- Date of Birth: {dateOfBirth}
- Ethnicity: {ethnicity}
- Address: {address}
- Postal Address: {postalAddress}
- Business: {businessName} ({website})

## Training & Education
- {year}: {name} ({provider})
- ...

## Experience
- {year}: {name} ({provider})
  Narrative: {narrative}
- ...

## Further Requirements
- Question 1: Yes
- Question 2: No
- ...

## Core Competencies
- effectiveCommunication: Yes
- advocacyEmpowerment: No
- ...

## Referees
- {name1} ({role1}) — {email1} — {phone1}
- {name2} ({role2}) — {email2} — {phone2}

## Declarations
- Accuracy: signed at {signed_at}
- Ethics: TRUE
- ...

## Documents Uploaded
- training: 3 files [link1, link2, link3]
- ethics: 1 file [link1]
- ...
```

## Data Flow

```
Webhook → checkout.session.completed (option_c)
   │
   ▼
sync: setApplicantPaid()  // sheet
   │
   ├─async─► createApplicationReviewDoc(applicant)
   │             │
   │             ▼
   │         create Google Doc in review-docs folder
   │             │
   │             ▼
   │         log doc URL + return
   │
   ├─async─► sendConfirmation(applicant)
   │
   └─async─► sendAdminNotification(applicant, docUrl)
```

## Index Doc

- One per tier (advanced + basic).
- Lists all paid applications: name, email, paid_at, link to review Doc.
- Refresh: on demand (admin triggers via `refresh{Advanced,Basic}IndexDoc()`).

## Error Handling

- Doc creation failure → log with applicant ID; admin email sent without Doc URL.
- Folder permission failure → log + skip.

## Testing Strategy

- `google-docs.test.ts` — Doc creation with mocked Drive API
- Template rendering test

## Risks

- Drive API quota: shared with file uploads. Mitigation: review Docs are small (one per paid application).

## Future Considerations

- Doc template customisation per org (today: hardcoded structure)
- Doc archival policy
- Collaborative review (comments, suggestions)