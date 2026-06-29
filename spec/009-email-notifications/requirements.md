# Requirements — Email Notifications

> Spec ID: `009` · Type: system feature · Status: backfilled (not yet approved)
> Depends on: `000-platform-overview`, `015-environment-configuration`
> Source today: `src/lib/email-sender.ts` (7 named senders)

## Overview

All transactional email goes through Mailgun. Seven named senders cover the full member lifecycle: resume link, confirmation (advanced + basic), admin notifications (advanced + basic + renewal), PD-log link.

## Functional Requirements

- **REQ-EN-001** Provider: Mailgun (sole). Gmail OAuth fallback removed in Phase K due to recurring `invalid_rapt` errors.
- **REQ-EN-002** Seven senders:
  1. `sendResumeLink(toEmail, fullName, resumeLink)` — applicant mid-form
  2. `sendAdvancedConfirmation(fullName, email, applicantId)` — advanced payment confirmation
  3. `sendAdvancedApplicationNotification(firstName, lastName, email, applicantId, reviewDocUrl)` — admin
  4. `sendBasicConfirmation(fullName, email)` — basic payment confirmation
  5. `sendBasicApplicationNotification(firstName, lastName, email, applicationId)` — admin
  6. `sendRenewalAdminNotification(tier, fullName, email, renewalId, amountCents, sheetsUrl)` — admin
  7. `sendRenewalPdLogLink(fullName, pdLogLink, renewalId)` — advanced member post-renewal
- **REQ-EN-003** Org identity interpolation: `ORG_NAME`, `SUPPORT_EMAIL`, `ADMIN_EMAIL`, `PUBLIC_ORG_URL` appear in subjects + bodies.
- **REQ-EN-004** Region-aware: `MAILGUN_REGION` (US default; EU when set). API base URL derived from region.
- **REQ-EN-005** Plain-text bodies only (no HTML). Eliminates HTML injection surface; aligns with `emailNZ` header-injection safety.
- **REQ-EN-006** Send failures logged but do not crash the calling webhook handler.

## Non-Functional Requirements

- **NFR-EN-001** Mailgun API key + domain + from address required. Missing → health check reports `email: down`.
- **NFR-EN-002** No retry on Mailgun failure (logged for manual follow-up).

## Acceptance Criteria

1. New advanced applicant first save → `sendResumeLink()` called → email delivered within 30s.
2. Advanced payment → confirmation + admin notification.
3. Renewal payment → admin notification + (advanced only) PD-log link.
4. Email contains correct org identity (e.g. "Re:Member" not "ELDAA").
5. Mailgun region = `eu` → API base URL switches to `api.eu.mailgun.net`.

## Out of Scope

- HTML email templates.
- Bounce + complaint handling.
- Drip campaigns / marketing email.

## Related

- `src/lib/email-sender.ts` — implementation
- Spec `015` — env vars (`MAILGUN_*`)
- Spec `008` — webhook triggers confirmation + admin notification senders