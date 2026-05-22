# ELDAA Notifications

> When and how ELDAA sends notifications to applicants and members.

---

## Currently Implemented

### 1. Resume Link Email

**Trigger:** New Professional Membership application started (`POST /api/professional/apply`)

**Conditions:**
- Only on **new** applicant creation (not on subsequent form updates/resumes)
- Applicant must have provided an email address

**Template:** `sendResumeLink(toEmail, fullName, resumeLink)` in `src/lib/email-sender.ts`

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

**Template:** `sendProfessionalConfirmation(toEmail, fullName)` in `src/lib/email-sender.ts`

```
Subject: Your ELDAA Professional Membership Application

Dear {fullName},

Thank you for your application to become a Professional Member of ELDAA. We will process your application and get back to you as soon as we can.

We look forward to seeing you soon.

Kia ora,
ELDAA Committee
```

**Delivery:** Non-blocking — failures are logged but do not fail webhook processing.

---

### 3. Internal Application Notification (ELDAA Membership Team)

**Trigger:** After `createApplicationReviewDoc()` completes successfully for professional membership

**To:** `membership@eldaa.org.nz` (hardcoded)

**Template:** `sendProfessionalApplicationNotification(toEmail, applicantName, docUrl)` in `src/lib/email-sender.ts`

```
Subject: New Professional Membership Application — {applicantName}

A new professional membership application has been received and the review document is ready.

Applicant: {applicantName}
Review document: {docUrl}

Please log in to review the application and continue the membership process.

ELDAA
```

**Delivery:** Non-blocking — failures are logged but do not fail webhook processing.

---

### 4. Associate Membership Confirmation (Applicant Email)

**Trigger:** After `createAssociateApplicationReviewDoc()` completes for associate membership

**To:** Applicant's email address

**Reply-To:** `membership@eldaa.org.nz`

**Template:** `sendAssociateConfirmation(toEmail, fullName, listOnPage)` in `src/lib/email-sender.ts`

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

---

### 5. Stripe Payment Receipt

**Trigger:** Stripe Checkout — ELDAA passes `receipt_email` in the Checkout Session API call, which overrides Dashboard automatic receipt settings. Stripe sends its own branded receipt directly to the applicant.

- **With `receipt_email` in the API call:** Stripe sends a receipt to that specific address regardless of Dashboard settings
- **Without `receipt_email`:** Stripe uses the Dashboard setting (automatic receipts on/off)

---

## Email Infrastructure

**Module:** `src/lib/email-sender.ts`

### Authentication (in order of preference)

1. **Gmail OAuth2** (primary)
   - `GMAIL_OAUTH_CLIENT_ID`
   - `GMAIL_OAUTH_CLIENT_SECRET`
   - `GMAIL_OAUTH_REFRESH_TOKEN`

2. **Service Account** (fallback)
   - Uses `GOOGLE_APPLICATION_CREDENTIALS` or workload identity

### Configuration

```env
GMAIL_SENDER_EMAIL=no-reply@eldaa.org.nz
```

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
