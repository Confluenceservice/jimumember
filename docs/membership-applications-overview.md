# Re:Member Membership Applications — User Overview

A complete, end-to-end guide to how the Professional and Associate Membership applications work — from starting a form to having a paid subscription and a review document generated.

---

## Membership Plans

| Plan | Entry point | Form type | Documents | Payment gating |
|---|---|---|---|---|
| **Professional** | `/professional/apply` | 8-step wizard with resume | 7 categories, multi-file upload to Google Drive | Yes — must complete all sections and upload all 6 required doc categories before payment |
| **Associate** | `/apply` | Single-page form | None | No — form submitted, then redirected directly to payment |

---

## The Journeys in Brief

**Professional:**
```
Start → Resume Link → 8-Step Form → Document Upload → Payment → Review Doc
```

**Associate:**
```
Start → Single-Page Form → Payment → Review Doc
```

---

## Professional Membership

### 1. Starting an Application

The applicant visits [example.com/professional/apply](https://example.com/professional/apply).

They fill in a short registration form:

- First name
- Last name
- Phone
- Email

On submitting, the system:
1. Creates a new row in the **Professional Applications** Google Sheet
2. Generates a unique **resume token** (UUID) stored in column AG
3. Sends an email with a personal resume link: `example.com/professional/apply?token=<uuid>`

> **If email fails**, the link is still displayed on screen — the applicant can bookmark it or copy it manually.

The link is also stored in the URL via `history.replaceState`, so the browser address bar always holds the correct resume link.

---

## 2. Application States

Applications move through four states, tracked in the Google Sheet:

```
new → partial → complete → paid
```

| State | Meaning | Sheet flags |
|---|---|---|
| `new` | Form started but not submitted | No row created yet |
| `partial` | Form in progress | Row exists, `complete=FALSE` |
| `complete` | All fields filled + all 6 required doc categories uploaded | `complete=TRUE` |
| `paid` | Stripe payment confirmed | `paid=TRUE`, `paid_at` timestamp |

---

## 3. The 8-Step Form

The form is a single Astro page. No page reloads between steps.

| Step | Name | Key fields |
|---|---|---|
| 1 | About You | Date of birth, ethnicity, address, postal address, business name, website |
| 2 | Training & Education | Repeatable course rows (name, provider, year) |
| 3 | EOL Doula Experience | Repeatable experience entries + 3 example narratives |
| 4 | Further Requirements | 7 Y/N questions (e.g. doula services, criminal check, meetings) |
| 5 | Core Competencies | 21 Y/N tickboxes |
| 6 | Referees | 2 referees: name, role, email, phone each |
| 7 | Declarations | 8 confirmation checkboxes |
| 8 | Document Upload | Multi-file per category with delete support |

### Autosave

Every "Continue" or "Back" button press triggers an autosave:

- A client-side queue ensures saves never overlap
- The server-side also serialises saves per applicant to avoid races
- All identity fields (`firstName`, `lastName`, `phone`, `email`) are saved alongside form data

---

## 4. Document Upload

### Required Documents

| Category | Description |
|---|---|
| `training` | Certificates of training (may be multiple) |
| `ethics` | Signed Re:Member Code of Ethics and Scope of Practice |
| `criminal` | Ministry of Justice criminal record check |
| `advance_care` | Advanced Care Planning NZ (4 modules) |
| `assisted_dying` | Assisted Dying online training — Te Whatu Ora (3 modules) |
| `fundamentals` | Fundamentals of Palliative Care — Hospice NZ (4 modules) |
| `insurance` | Professional indemnity insurance certificate *(optional, recommended)* |

### File Rules

- **Max 50 MB per file**
- Allowed types: PDF, JPEG, PNG, GIF, DOC, DOCX
- Multiple files per category are allowed
- Files are validated by magic bytes (file signature), not just extension

### Upload Flow

1. File is validated client-side, then POSTed to `/api/professional/upload-file`
2. Server looks up applicant by resume token (rejects if already paid)
3. File is uploaded to Google Drive: `/{applicant_id}/documents/{doc_type}/{uuid}.{ext}`
4. A row is written to the **Drive Files** sheet: `file_id, applicant_id, doc_type, original_filename, uploaded_at, deleted=FALSE`
5. The applicant's doc count for that category is incremented

### Deleting a File

`POST /api/professional/delete-file` soft-deletes the Drive Files row (`deleted=TRUE`) and trashes the actual Drive file. Doc count is recalculated.

---

## 5. Completing the Form

When the applicant clicks **Proceed to Payment**, the system validates:

- **Form completeness**: all required fields filled, all 8 declarations confirmed (`"TRUE"`)
- **Document completeness**: all 6 required doc types have at least 1 file

If incomplete, the applicant sees a message listing what's still needed.

If complete, a Stripe Checkout session is created and the applicant is redirected to Stripe's hosted checkout page.

---

## 6. Payment (Stripe)

### Checkout Session

- **Mode:** one-time payment (`mode: "payment"`)
- **First term:** prorated from today until 1 July (the renewal date)
- **Annual renewal:** Stripe subscription created in the post-payment webhook, billed annually from 1 July
- The checkout URL is: `https://example.com/professional/success-upload?session_id=...`

### What happens on the Stripe side

1. Applicant enters card details on Stripe's hosted page
2. Payment is processed
3. Stripe fires `checkout.session.completed` to the webhook

---

## 7. After Payment — Webhook

When `checkout.session.completed` fires at `/api/stripe-webhook`:

1. **Subscription created** — recurring annual subscription with trial end set to 1 July (next renewal date)
2. **Membership activated** — `setAwaitingSubscription()` → `setActive()` in the memberships system
3. **Sheet updated** — `complete=TRUE`, `paid=TRUE`, `paid_at` timestamp recorded
4. **Checkout logged** — a row written to the **Checkout Log** sheet (timestamp, name, email, plan, amount, session ID, customer ID)
5. **Google Doc generated** — `createApplicationReviewDoc()` creates a formatted summary document in Google Drive (see below)

---

## 8. Post-Payment Google Doc

After payment is confirmed, a Google Doc is automatically created containing a full summary of the application:

**Document title:** `Professional Application — {FirstName} {LastName} ({email})`

**Sections:**
- Applicant Details (name, email, phone, business)
- About You (DOB, ethnicity, address)
- Training & Education (all course rows)
- EOL Doula Experience (entries + example narratives)
- Further Requirements (Y/N answers)
- Core Competencies (21 checkboxes with checkmarks)
- Referees (both with full contact details)
- Documents Uploaded (file count per category)
- Declarations (`CONFIRMED` / `NOT CONFIRMED` per item)

The doc is saved in the configured Google Drive folder (`GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID`), or falls back to the applications folder.

---

## 9. Google Sheets Data Model

### Professional Applications Sheet (47 columns)

| Column | Field | Column | Field |
|---|---|---|---|
| A | `applicant_id` | AI | `doc_training_count` |
| B | `email` | AJ | `doc_ethics_count` |
| C | `first_name` | AK | `doc_criminal_count` |
| D | `last_name` | AL | `doc_advance_care_count` |
| E | `phone` | AM | `doc_assisted_dying_count` |
| F | `date_of_birth` | AN | `doc_fundamentals_count` |
| G | `ethnicity` | AO | `doc_insurance_count` |
| H | `address` | AP | `complete` |
| I | `postal_address` | AQ | `stripe_session` |
| J | `business_name` | AR | `paid` |
| K | `website` | AS | `created_at` |
| L | `qualifications` (JSON) | AT | `paid_at` |
| M | `experience` (JSON) | AU | `email_verified` |
| N | `further_requirements` (JSON) | | |
| O | `core_competencies` (JSON) | | |
| P–S | Referee 1 (name, role, email, phone) | | |
| T–W | Referee 2 (name, role, email, phone) | | |
| X–AF | 8 declaration flags + `declaration_signed_at` | | |
| AG | `resume_token` | | |
| AH | `email_hash` (SHA-256) | | |

### Drive Files Sheet (6 columns, one row per uploaded file)

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| `file_id` | `applicant_id` | `doc_type` | `original_filename` | `uploaded_at` | `deleted` |

### Checkout Log Sheet

Written after each successful payment: timestamp, firstName, lastName, phone, email, plan, amount (NZ$), sessionId, customerId

---

## 10. Google Drive Folder Structure

```
GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID/
└── {FirstName}_{LastName}/
    ├── training/
    │   ├── {uuid1}.pdf
    │   └── {uuid2}.pdf
    ├── ethics/
    │   └── {uuid3}.docx
    ├── criminal/
    ├── advance_care/
    ├── assisted_dying/
    ├── fundamentals/
    └── insurance/
```

Files are stored with a random UUID as filename (original name preserved in the Drive Files sheet).

---

## 11. Resuming an Application

The applicant opens their resume link: `example.com/professional/apply?token=<uuid>`

The server looks up the applicant by `resume_token` (column AG). If found, all form data and document statuses are returned and the form is pre-populated.

> Matching is **token-first**. Email is only used as fallback if no token is supplied.

---

## 12. Summary: Complete User Journey

```
1. Applicant visits /professional/apply
2. Fills registration form (name, phone, email) → submits
3. Server creates sheet row + resume UUID → emails resume link
4. Applicant opens resume link → form pre-populated
5. Applicant completes all 8 wizard steps
6. Each step navigation triggers autosave to Google Sheets
7. Applicant uploads required documents (≥1 per required category)
8. Each upload → Google Drive file + Drive Files sheet row + doc count increment
9. Applicant clicks "Proceed to Payment"
10. Server validates all form fields complete + all 6 required doc types uploaded
11. Stripe Checkout session created → applicant redirected to Stripe
12. Applicant pays on Stripe → checkout.session.completed fires
13. Webhook creates recurring subscription (trial to 1 July), activates membership
14. Webhook marks applicant paid in sheet, logs checkout, generates Google Doc
15. Applicant lands on /professional/success-upload — "Application is being reviewed"
```

---

## Environments

| Environment | App name | Stripe webhook URL |
|---|---|---|
| Staging | `remember` | `https://remember-staging.fly.dev/api/stripe-webhook` |
| Production | `remember-production` | `https://subscribe.example.com/api/stripe-webhook` |

If the webhook URL was misconfigured during a payment, correct it in the Stripe dashboard and replay the `checkout.session.completed` event.

---

## Associate Membership

### Overview

Associate Membership uses a **single-page form** at `/apply`. There is no multi-step wizard, no resume link, and no document uploads. The applicant fills in the form, submits, and is taken directly to Stripe checkout.

---

### Application States

```
checkout_requested → paid
```

| State | Meaning | Sheet `checkout_status` |
|---|---|---|
| `checkout_requested` | Form submitted, checkout session created | `checkout_requested` |
| `paid` | Stripe payment confirmed | `paid` (set by webhook) |

---

### The Form (`/apply`)

The single-page form collects:

**Personal Information:**
- First name, last name, email, phone
- Full address, postal address (optional if same)
- Business name (optional)

**Additional Information:**
- Interest in joining Re:Member (free text, required)
- End of Life Doula training details (free text, required)
- Whether to be listed on the Associate Members page (`yes` / `no`)
- Listing details (required if `listOnPage = yes`)

**Declaration:**
- Signature (text, required)
- Application date (required)

---

### Form Submission Flow

1. Applicant submits the form at `/apply`
2. `POST /api/create-checkout-session` is called with `plan: "associate"` and `applicationSource: "apply"`
3. The server:
   - Validates all required fields
   - Generates an `associateApplicationId` (UUID)
   - Writes a row to the **Associate Applications** Google Sheet with `checkoutStatus: "checkout_requested"`
   - Creates a Stripe Checkout session (one-time payment, same Option C pattern as Professional)
   - Returns the Stripe checkout URL
4. Applicant is redirected to Stripe's hosted checkout page

---

### Post-Payment Webhook

When `checkout.session.completed` fires for an Associate application:

1. **Subscription created** — same as Professional (trial to 1 July, recurring annual billing)
2. **Membership activated** — `setAwaitingSubscription()` → `setActive()`
3. **Checkout logged** — row written to the **Checkout Log** sheet
4. **Google Doc generated** — `createAssociateApplicationReviewDoc()` creates a formatted summary in Google Drive

**Note:** The Associate Applications sheet is not updated by the webhook (`checkout_status` remains `checkout_requested`). This is a known gap — the sheet does not reflect `paid` status for Associate applications.

---

### Associate Google Doc

After payment, a Google Doc is created:

**Document title:** `Associate Application — {FirstName} {LastName} ({email})`

**Sections:**
- Applicant Details (name, email, phone, business name)
- Address (full address, postal address)
- Additional Information (interest in joining, training details, listing preference and details)
- Declaration (signature, application date, checkout status)

The doc is saved in the same configured Drive folder as Professional review docs.

---

### Google Sheets — Associate Applications (16 columns)

| Column | Field |
|---|---|
| A | `submitted_at` (ISO timestamp) |
| B | `application_id` (UUID) |
| C | `first_name` |
| D | `last_name` |
| E | `email` |
| F | `phone` |
| G | `full_address` |
| H | `postal_address` |
| I | `business_name` |
| J | `interest_joining` |
| K | `training_details` |
| L | `list_on_page` |
| M | `listing_details` |
| N | `signature` |
| O | `application_date` |
| P | `checkout_status` |

---

### Complete User Journey — Associate

```
1. Applicant visits /apply
2. Fills single-page form → submits
3. Server validates, generates UUID, writes to Associate Applications sheet
4. Stripe Checkout session created → applicant redirected to Stripe
5. Applicant pays on Stripe → checkout.session.completed fires
6. Webhook creates recurring subscription, activates membership
7. Webhook logs checkout, generates Google Doc
8. Applicant lands on /associate-membership — payment confirmed
```

---

## Shared Infrastructure

### Stripe (Option C pattern)

Both plans use the same Stripe checkout flow:
- **Mode:** one-time payment (`mode: "payment"`)
- **First term:** prorated from today until 1 July
- **Annual renewal:** Stripe subscription created in the webhook, trial end set to 1 July

### Webhook (`/api/stripe-webhook`)

Handles `checkout.session.completed` for both plans. Distinguishes by `plan` metadata:
- `plan=professional`: calls `markApplicantPaid()`, creates `createApplicationReviewDoc()`
- `plan=associate`: creates `createAssociateApplicationReviewDoc()`

### Checkout Log

Every successful payment writes a row to the **Checkout Log** sheet: timestamp, firstName, lastName, phone, email, plan, amount (NZ$), sessionId, customerId.