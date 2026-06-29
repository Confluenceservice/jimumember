# Design — Email Notifications

> Spec ID: `009` · Type: system feature
> Depends on: `000-platform-overview`, `015-environment-configuration`

## Overview

Mailgun-only. Plain-text bodies. Org-identity interpolation. Seven named senders.

## Component Design

1. **`src/lib/email-sender.ts`** — Mailgun client + 7 named senders + org-identity helper.

## Sender Implementation Pattern

```typescript
export async function sendResumeLink(toEmail: string, fullName: string, resumeLink: string) {
  const subject = `Resume your ${ORG_NAME} application`;
  const body = [
    `Kia ora ${fullName},`,
    ``,
    `You can resume your application here:`,
    resumeLink,
    ``,
    `Questions? Contact ${SUPPORT_EMAIL}.`,
    `${ORG_NAME} team`,
  ].join('\n');
  return sendEmail({ to: toEmail, subject, body });
}

async function sendEmail({ to, subject, body }: { to: string; subject: string; body: string }) {
  const region = process.env.MAILGUN_REGION === 'eu' ? 'eu' : 'us';
  const baseUrl = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  const form = new URLSearchParams({ from: MAILGUN_FROM, to, subject, text: body });
  try {
    const res = await fetch(`${baseUrl}/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}` },
      body: form,
    });
    if (!res.ok) logger.error({ to, subject, status: res.status }, 'email send failed');
  } catch (e) {
    logger.error({ to, subject, err: e }, 'email send threw');
  }
  // Never throw: webhook handler must continue
}
```

## Org Identity Helper

```typescript
function orgContext() {
  return {
    orgName: process.env.ORG_NAME ?? 'Re:Member',
    supportEmail: process.env.SUPPORT_EMAIL ?? 'support@example.com',
    adminEmail: process.env.ADMIN_EMAIL ?? 'admin@example.com',
    publicUrl: process.env.PUBLIC_ORG_URL ?? 'https://example.com',
  };
}
```

## Error Handling

- Mailgun 4xx: log + skip. Don't throw (caller's webhook must succeed).
- Mailgun 5xx: log + skip. Same.
- Network error: log + skip.

## Testing Strategy

- `email-sender.test.ts` — sender templates + org identity substitution
- Region resolution test (US default, EU when `MAILGUN_REGION=eu`)
- Send failure → logged, not thrown

## Risks

- Mailgun outage: members don't get confirmation. Mitigation: admin can verify via Sheets; replay webhook if needed.

## Future Considerations

- HTML email templates (with safe rendering)
- Bounce webhook handling
- Email template extraction to JSON (parallel to form schema system)