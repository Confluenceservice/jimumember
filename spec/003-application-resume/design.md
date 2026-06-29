# Design — Application Resume

> Spec ID: `003` · Type: member-facing feature
> Depends on: `000-platform-overview`, `001-advanced-application`

## Overview

Token-first resume flow. UUIDv4 token stored in column AG. Email lookup only as fallback when token absent AND email is verified.

## Component Design

1. **`src/pages/api/advanced/apply.ts`** — GET handler: token-first lookup, response includes `applicantId`.
2. **`src/lib/email-sender.ts`** — `sendResumeLink()` templated email.
3. **`src/lib/google-sheets.ts`** — `getApplicantByToken()` returns full `ApplicantInfo` (47 columns).

## Lookup Logic

```typescript
async function handler({ token, email }) {
  if (token) {
    const applicant = await getApplicantByToken(token);
    if (!applicant) throw new InvalidTokenError();
    return applicant;
  }
  if (email) {
    const applicant = await getApplicantByEmail(email);
    if (!applicant) throw new NotFoundError();
    if (!applicant.email_verified) throw new UnverifiedEmailError();
    return applicant;
  }
  throw new MissingIdentifierError();
}
```

## Security

- UUIDv4 tokens are unguessable (122 bits of entropy).
- Email verification prevents attackers from claiming an applicant by guessing email.
- Token persists in URL but never logged (query params redacted in pino).

## Migration Plan

- REQ-AR-004 (return `applicantId`) was a breaking change. Pre-change clients that relied on email+applicantId pairing needed updates. Documented in `.wolf/memory.md` and `.wolf/cerebrum.md` Phase J2.

## Future Considerations

- Token rotation per resume (currently tokens are permanent until paid).
- Email-based magic link instead of tokenised URL.