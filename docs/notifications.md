# ELDAA Notifications

> When and how ELDAA sends notifications to applicants and members.

---

## Currently Implemented

### 1. Resume Link Email

**Trigger:** New Professional Membership application started (`POST /api/professional/apply`)

**Conditions:**
- Only on **new** applicant creation (not on subsequent form updates/resumes)
- Applicant must have provided an email address

**Template:** `sendResumeLink(toEmail, fullName, resumeLink, applicantId?)` in `src/lib/email-sender.ts`

```
Subject: Your ELDAA Professional Membership Application

Dear {fullName},

Thank you for starting your Professional Membership application with ELDAA.

To continue your application, please click the link below:
{resumeLink}

This link will allow you to upload your required documents and complete your application.

If you did not start this application, please ignore this email.

Best regards,
ELDAA
```

**Delivery:** Non-blocking — failures are logged but do not fail the application submission.

**Audit:** Resume link emails are logged to the `Email log` sheet.

---

## Planned / Not Yet Implemented

The following notifications are described in the UI but **not yet implemented**:

| Notification | UI Copy | Trigger Location | Status |
|---|---|---|---|
| Document verification confirmation | "You will receive confirmation once your documents have been verified" | `success-upload.astro` | Not implemented |
| Membership activation confirmation | "You will receive confirmation once your membership has been activated" | `associate-membership.astro` | Not implemented |
| Payment receipt | — | — | **Stripe handles it** — ELDAA passes `receipt_email` in the Checkout Session API call, which overrides Dashboard automatic receipt settings. Stripe sends its own branded receipt directly to that address. |
| Subscription renewal reminder | — | — | Not implemented |
| Application review completion | — | — | Not implemented |

### 2. Payment Confirmation (Applicant Email)

**Trigger:** `checkout.session.completed` webhook event for professional membership

**To:** Applicant's email address (from sheet)

**Template:** `sendProfessionalConfirmation(toEmail, fullName, applicantId?)` in `src/lib/email-sender.ts`

```
Subject: Your ELDAA Professional Membership Application

Dear {fullName},

Thank you for your application to become a Professional Member of ELDAA. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kia ora,
ELDAA Committee
```

**Delivery:** Non-blocking — failures are logged but do not fail webhook processing.

**Audit:** Confirmation email sends are logged to the `Email log` sheet (columns: timestamp, to, subject, template, applicantId, result, error).

---

### 3. Internal Application Notification (ELDAA Membership Team)

**Trigger:** After `createApplicationReviewDoc()` completes successfully for professional membership

**To:** `membership@eldaa.org.nz` (hardcoded)

**Template:** `sendProfessionalApplicationNotification(toEmail, applicantName, docUrl, applicantId?)` in `src/lib/email-sender.ts`

```
Subject: New Professional Membership Application — {applicantName}

A new professional membership application has been received and the review document is ready.

Applicant: {applicantName}
Review document: {docUrl}

Please log in to review the application and continue the membership process.

ELDAA
```

**Delivery:** Non-blocking — failures are logged but do not fail webhook processing.

**Audit:** Notification emails are logged to the `Email log` sheet.

---

### 4. Associate Membership Confirmation (Applicant Email)

**Trigger:** After `createAssociateApplicationReviewDoc()` completes for associate membership

**To:** Applicant's email address

**Reply-To:** `membership@eldaa.org.nz`

**Template:** `sendAssociateConfirmation(toEmail, fullName, listOnPage, associateApplicationId?)` in `src/lib/email-sender.ts`

```
Subject: Welcome to ELDAA — Associate Membership Confirmed

Welcome to ELDAA ☺

Dear {fullName},

We would like to officially welcome you on board the End of Life Doula Alliance
of Aotearoa as an Associate Member. We are delighted you are joining us in this
role, and look forward to supporting you in your mahi.

{listOnPage ? "You have requested to be listed on our Associate Member list on
our website — we will process that shortly." : "You have not requested to be
listed at this time. If you would like to be added in future, please email us
at membership@eldaa.org.nz."}

[Resources, Meetings, Networking sections...]

Questions? Email us at membership@eldaa.org.nz — we would love your feedback
and any ideas you have to support you in your mahi.

Again, welcome on board ☺

Kia ora,
ELDAA Committee
```

**Delivery:** Non-blocking — fires after Google Doc creation succeeds.

**Audit:** Confirmation emails are logged to the `Email log` sheet.

---

### 5. Stripe Payment Receipt

**Trigger:** Stripe Checkout — ELDAA passes `receipt_email` in the Checkout Session API call, which overrides Dashboard automatic receipt settings. Stripe sends its own branded receipt directly to the applicant.

- **With `receipt_email` in the API call:** Stripe sends a receipt to that specific address regardless of Dashboard settings
- **Without `receipt_email`:** Stripe uses the Dashboard setting (automatic receipts on/off)

---

## Email Infrastructure

**Module:** `src/lib/email-sender.ts`

### Provider: Mailgun (HTTP API via `mailgun.js`)

### Configuration

```env
MAILGUN_API_KEY=key-...
MAILGUN_DOMAIN=mg.eldaa.org.nz
MAILGUN_FROM=ELDAA Membership Notifications <no-reply@mg.eldaa.org.nz>
```

`MAILGUN_FROM` should be a recognisable brand name, not "No Reply" or
"noreply" — generic From names are penalised by iCloud/Apple spam
classifiers and the message lands in Junk even with DKIM/SPF/DMARC
all passing. See `docs/runbooks/mailgun-setup.md` §7 for the full
deliverability note (first-send reputation, `List-Unsubscribe`
header, recipient training).

### Audit Logging

All outgoing emails are logged to the `Email log` tab in the same spreadsheet that holds application data. The sheet has 7 columns:

| Column | Content |
|---|---|
| A | timestamp (ISO 8601) |
| B | to (recipient email) |
| C | subject |
| D | template (one of: `confirmation`, `associate_confirmation`, `application_notification`, `resume_link`) |
| E | applicantId (or associateApplicationId) |
| F | result (`sent` or `failed`) |
| G | error (present only when result is `failed`) |

Logging is best-effort — Gmail send completes before the sheet write is attempted. If the audit write fails, the error is re-thrown to the caller (for logging purposes), but the email itself has already been sent.

---

## Related: Google Docs (Post-Payment)

After successful payment, a **Google Document** is created for internal review (not sent to applicant):

- `createApplicationReviewDoc()` — Professional membership (`stripe-webhook.ts`)
- `createAssociateApplicationReviewDoc()` — Associate membership (`stripe-webhook.ts`)

Documents are saved to `GOOGLE_DRIVE_REVIEW_DOCS_FOLDER_ID` (falls back to `GOOGLE_DRIVE_APPLICATIONS_FOLDER_ID`).

---

## Adding a New Notification

### 1. Define the trigger

Decide **when** the notification should fire (form submission, payment, status change, etc.).

### 2. Choose the channel

- **Email:** Use `sendEmail()` from `src/lib/email-sender.ts`
- **Google Doc:** Use `createApplicationReviewDoc()` pattern from `src/lib/google-docs.ts`

### 3. Implement

```typescript
import { sendEmail } from '@/lib/email-sender';

// In your handler:
await sendEmail({
  to: applicant.email,
  subject: 'Your ELDAA Application - Next Steps',
  body: `Dear ${applicant.firstName},\n\n...`,
});
```

### 4. Document it

Add the notification type to the table above with:
- Trigger condition
- UI location where it is promised (if applicable)
- Implementation file

### 5. Non-blocking rule

Email failures should be logged but not fail the parent operation:

```typescript
try {
  await sendEmail({ ... });
} catch (err) {
  logger.error({ err, applicantId }, 'Failed to send notification email');
}
```
