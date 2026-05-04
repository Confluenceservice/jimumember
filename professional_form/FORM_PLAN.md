# Professional Membership Application — Digital Form

**Date:** 2026-04-10
**Status:** Phase 1 complete | Phase 2 in progress

---

## Overview

Professional Membership applicants complete a structured digital form and upload supporting documents. The form supports multi-session completion (resume via link), gates submission until all requirements are met, and transitions to Stripe payment upon completion.

---

## Required Uploads

| Doc Type | Description | Required |
|----------|-------------|----------|
| `training` | Certificates of training (may be multiple) | Yes |
| `ethics` | Signed ELDAA Code of Ethics and Scope of Practice | Yes |
| `criminal` | Ministry of Justice criminal record check | Yes |
| `advance_care` | Advanced Care Planning NZ (4 modules) | Yes |
| `assisted_dying` | Assisted Dying online training (Te Whatu Ora, 3 modules) | Yes |
| `fundamentals` | Fundamentals of Palliative Care (Hospice NZ, 4 modules) | Yes |
| `insurance` | Professional indemnity insurance certificate | Recommended (optional) |

---

## Digital Form Fields

### Section: "About You"
| Field | Type | Required |
|-------|------|----------|
| First Name | text | Yes |
| Last Name | text | Yes |
| Date of Birth | date (DD/MM/YYYY) | Yes |
| Ethnicity | text | Yes |
| Address | text (number, street, city, postcode) | Yes |
| Postal Address | text | No |
| Phone | tel | Yes |
| Email | email | Yes |
| Business Name | text | No |
| Website / Social Media | text | No |

### Section: "Your Training & Education"
| Field | Type | Required |
|-------|------|----------|
| Course: Name | text | Yes (at least 1) |
| Course: Provider | text | Yes |
| Course: Year Completed | text (year) | Yes |
| Additional courses | repeat rows | No |
| Non-ELDAA provider curriculum outline | file upload | Conditional (if applicable) |

### Section: "Your EOL Doula Experience"
| Field | Type | Required |
|-------|------|----------|
| Experience table: Role/Context | textarea per row | Yes (at least 1) |
| Experience: Skills that relate to EOL | textarea per row | Yes |
| Experience: Dates | text per row | No |
| Example 1: Setting/context, Role, Skills, Ethical/cultural considerations, Outcome/learning | textarea | Yes |
| Example 2 | textarea | No |
| Example 3 | textarea | No |

### Section: "Further Requirements" (all Y/N)
- Do you agree to actively provide Doula Services?
- Do you agree to an interview by one or more committee members?
- Do you agree to submit proof of up to 10 hours of professional development each year?
- Will you take out professional indemnity insurance? (recommended)
- Do you wish to be listed as a practicing End of Life Doula in our directory?
- Are you willing to provide a current Ministry of Justice criminal record check?
- Are you willing to attend regular ELDAA meetings and events, and engage with and support your local ELDAA community?
- Are you willing to work remotely where there is no other available Professional Member in a Client's area?

### Section: "EOL Doula Standards & Core Competencies"
20 Y/N competency questions (tick if confident):

1. Effective Communication Skills — deep listening, open-ended questioning, holding space
2. Advocacy & Empowerment — navigating medical/healthcare systems
3. Understanding of Cultural & Spiritual Diversity
4. Shows initiative — anticipate needs, seek information
5. Compassionate Presence — quiet, calm presence, follow the lead
6. Ongoing Education & Development
7. Self-Care & Professional Boundaries
8. Knowledge of End-of-Life Options — palliative care, hospice, VAD, home death
9. Business acumen — contractual agreement, sliding scale, timely invoices
10. Networking & Referrals
11. Holistic support — emotional, spiritual, cultural, practical, social
12. Illness journey advocacy and empowerment
13. Legacy & Life Review
14. Holistic Advance Care Planning
15. Vigil Planning & Support
16. Practical Assistance during illness
17. Funeral & Memorial Planning
18. Body care and After Death care
19. Grief & Bereavement Awareness
20. Interdisciplinary Collaboration
21. Mentorship — willing to mentor other ELDAA members

### Section: "Referees"
| Field | Required |
|-------|----------|
| Referee 1: Full name | Yes |
| Referee 1: Role | Yes |
| Referee 1: Email | Yes |
| Referee 1: Phone | Yes |
| Referee 2: Full name | Yes |
| Referee 2: Role | Yes |
| Referee 2: Email | Yes |
| Referee 2: Phone | Yes |

### Section: "Declarations"
| Field | Required |
|-------|----------|
| I confirm the information provided is accurate | Yes |
| I have read and agree to the ELDAA Code of Ethics | Yes |
| I have read and understand the Scope of Practice | Yes |
| I agree to actively provide Doula Services | Yes |
| I agree to an interview by the committee if required | Yes |
| I commit to 10 hours professional development per year | Yes |
| I agree to provide a criminal record check | Yes |
| Declaration signed at | auto (server timestamp) |

---

## Application States

```
new → partial → complete → paid
```

- **new:** Form started but not submitted
- **partial:** Form in progress, can resume via link
- **complete:** All required fields filled AND all required uploads present → payment unlocked
- **paid:** Stripe payment confirmed

The "Proceed to Payment" button is disabled until `status === "complete"`.

---

## Applicant Flow

### First Visit
1. Visit `/professional/apply` (no token)
2. Fill registration form (first name, last name, email, phone)
3. Submit → applicant created → resume link shown on-screen
4. Email sent with resume link (if Gmail configured)

### Document Upload
1. After registration, upload required documents
2. Each file: validates type/size → uploads to Drive → records in Drive Files sheet
3. Progress: "N of 6 required categories uploaded"
4. Can upload multiple files per category

### Return Visit
1. Open resume link (`?token=xxx`)
2. All previously entered form data is pre-populated
3. Incomplete sections highlighted
4. Continue uploading/filling until complete

### Completion
1. All required form fields filled
2. All required document categories have ≥1 file
3. "Proceed to Payment" button activates
4. Click → Stripe Checkout session created
5. Pay → webhook fires → status becomes `paid`

---

## Multi-File Upload (Drive Files Sheet)

**`Drive Files` tab:**
```
A: file_id
B: applicant_id
C: doc_type
D: original_filename
E: uploaded_at
F: deleted
```

- One row per uploaded file
- `deleted = "TRUE"` for soft deletes
- Applicant Drive folder: `/applications/{applicant_id}/documents/{doc_type}/{file_id}.{ext}`

**File limits:**
- Max 10MB per file
- Allowed types: PDF, JPEG, PNG, GIF, DOC, DOCX

---

## API Endpoints

### `GET /api/professional/apply?token=xxx`
Returns: `{ status, firstName, lastName, email, phone, docsUploaded: { [docType]: FileInfo[] }, formData: { ...all fields }, complete }`

### `POST /api/professional/apply`
Accepts: `{ firstName, lastName, email, phone, dateOfBirth, ethnicity, address, postalAddress, businessName, website, courses[], experience[], examples[], furtherRequirements Y/N responses, coreCompetencies Y/N responses, referees[], confirmAccuracy, confirmEthics, confirmScope, agreeDoulaServices, agreeInterview, commitProfessionalDev, criminalCheck, meetings, remoteWork, declarationSignedAt }`

Returns: `{ success, resumeLink, applicantId }` or `{ error }`

### `POST /api/professional/upload-file`
Multipart: `token`, `docType`, `file`
Returns: `{ success, fileId, filename }`

### `DELETE /api/professional/upload-file?fileId=xxx&token=xxx`
Soft-deletes file from Drive Files sheet, trashes Drive file.
Returns: `{ success }`

### `POST /api/professional/upload-complete`
Creates Stripe Checkout session if all requirements met.
Returns: `{ url }` or `{ error }`

---

## Google Sheet: Professional Applications

**Columns (post-Phase 2):**
```
A:  applicant_id
B:  email
C:  first_name
D:  last_name
E:  phone
F:  date_of_birth
G:  ethnicity
H:  address
I:  postal_address
J:  business_name
K:  website
L:  qualifications (courses as JSON text)
M:  experience (free text)
N:  further_requirements (Y/N responses as JSON)
O:  core_competencies (Y/N responses as JSON)
P:  referee_1_name
Q:  referee_1_role
R:  referee_1_email
S:  referee_1_phone
T:  referee_2_name
U:  referee_2_role
V:  referee_2_email
W:  referee_2_phone
X:  confirm_accuracy
Y:  confirm_ethics
Z:  confirm_scope
AA: agree_doula_services
AB: agree_interview
AC: commit_professional_dev
AD: criminal_check
AE: meetings
AF: remote_work
AG: declaration_signed_at
AH: resume_token
AI: email_hash
AJ: doc_training_count
AK: doc_ethics_count
AL: doc_criminal_count
AM: doc_advance_care_count
AN: doc_assisted_dying_count
AO: doc_fundamentals_count
AP: doc_insurance_count
AQ: complete
AR: stripe_session
AS: paid
AT: created_at
AU: paid_at
```

---

## New Files to Create

- `src/lib/drive-files.ts` — Drive Files sheet CRUD
- `src/pages/api/professional/delete-file.ts` — soft-delete endpoint

## Files to Modify

- `src/lib/upload-sheet.ts` — add new form columns, update interfaces
- `src/pages/api/professional/apply.ts` — accept full form payload, write all fields
- `src/pages/api/professional/upload-file.ts` — insert Drive Files row, return fileId
- `src/pages/professional/apply.astro` — full digital form UI with all sections

---

## Backwards Compatibility

Existing applicants (pre-Phase 2) have blank new columns — acceptable.
Resume links continue to work.

---

## Testing Checklist

- [ ] New application → all form fields written to correct sheet columns
- [ ] Resume link → all form fields pre-populated
- [ ] Upload 3 files to "training" category → all 3 shown with filenames
- [ ] Delete middle file → remaining 2 still shown, deleted gone
- [ ] "Proceed to Payment" activates only when all required sections complete
- [ ] Y/N questions all answered → declaration section allows submission
- [ ] Stripe payment → webhook fires → Sheet1 logged
- [ ] Existing applicant resume link still works