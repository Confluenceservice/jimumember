# Astro App Bug Scan

Date: 2026-06-12 · Branch: `main` · Scope: API routes, lib modules, middleware, client-side apply flow.

Baseline: `astro check` passes (only unused-var hints). All 117 vitest tests pass. The issues below are logic/security bugs that typecheck and tests do not catch. Nothing has been fixed; this is a report.

Summary: 0 high, 8 medium, 6 low.

## MEDIUM

### 1. Unauthenticated resume-token disclosure + data tampering via email
`src/pages/api/professional/apply.ts` (188-244)

Status: Fixed (2026-06-12). Email verification via the resume link now gates the no-token registration paths. New registrations and existing-email re-registrations receive a resume email and a `requiresVerification: true` response with no token in the body. The `?token=` GET marks the row verified on load. Legacy blank AU rows are treated as verified. See `src/pages/api/professional/apply.ts` (POST branches, `isValidEmail` helper) and `src/lib/upload-sheet.ts` (`markEmailVerified`, `parseEmailVerified`).

The `POST` "resume by email" branch used to defeat the token capability model. With no `token` but an `email` matching an existing applicant (`getApplicantByEmail`), the handler updated that row and returned a `resumeLink` containing the real `resumeToken`:

```ts path=/Users/thomasb/eldaa/src/pages/api/professional/apply.ts start=235
const tokenForResumeLink = existingApplicant.resumeToken || resumeToken;
const resumeLink = `${siteBaseUrl}/professional/apply?token=${tokenForResumeLink}`;
return Response.json({ success: true, resumeLink, applicantId: existingApplicant.id, existing: true });
```

Anyone who submitted a known email got the victim's token. The token did not expose document contents — uploaded files lived in Google Drive and the app had no download route; the `GET` handler returned only document metadata (original filenames and upload timestamps), and the stored `fileId` was the random local filename, not a Drive accessor. The token did expose the applicant's stored PII (name, date of birth, ethnicity, address, phone, business, qualifications, experience) and third-party referee PII (names, emails, phones), and it let the holder overwrite application fields, soft-delete or hide uploaded documents (`delete-file`), and drive the application to payment. Email was never verified.

Fix: never return the token for the email-match path — email the link instead (as the new-applicant path already does via `sendResumeLink`). Do not mutate an existing record without a valid token.

### 2. Public env-var disclosure endpoint
`src/pages/api/debug-env.ts`

Unauthenticated `GET /api/debug-env` reports which secrets are configured (SET/MISSING). Recon surface with no prod use. Remove it, or gate behind auth and a non-prod check.

### 3. Webhook side effects re-run on duplicate/retry delivery
`src/pages/api/stripe-webhook.ts` (166-323)

Subscription creation is guarded by the local record plus `idempotencyKey` (61-164). Everything after it — `markApplicantPaid`, confirmation emails, review-doc creation, committee notifications, index refresh — runs outside the `alreadyProcessed` guard. Stripe delivers at-least-once and retries on non-2xx, so a retry or duplicate re-sends emails and creates duplicate Google Docs.

Fix: `return` after the idempotency check when `alreadyProcessed`, or dedupe by `event.id`.

### 4. Unbounded in-memory upload buffering (DoS)
`src/pages/api/professional/upload-file.ts` (298-336, 420)

For all three content types the entire body is read into a `Buffer` (`request.arrayBuffer()` / `file.arrayBuffer()` / base64 decode) before the `buffer.length > MAX_FILE_SIZE` check at line 420. `content-length` is logged but never enforced. On the 256 MB Fly VM, a few large concurrent POSTs can exhaust memory.

Fix: reject early when the `Content-Length` header exceeds `MAX_FILE_SIZE`.

### 5. Stored/self-XSS via `innerHTML`
`src/pages/professional/apply.astro` (1097, 790-801, 830-835)

Uploaded filenames are injected unescaped:

```js path=/Users/thomasb/eldaa/src/pages/professional/apply.astro start=1097
<span class="text-sm">${f.filename}</span>
```

`f.filename` is the user-supplied original filename, stored verbatim and returned by `listDriveFiles`. A file named `<img src=x onerror=...>.pdf` executes when the doc list renders. Course/experience values interpolated into `value="${...}"` (790-801, 830-835) allow attribute breakout too. Mostly self-scoped, but the resume link can be opened by others.

Fix: escape values or build nodes with `textContent`/`setAttribute`.

### 6. Membership state is non-durable on Fly
`src/lib/memberships.ts`

State persists to `.data/memberships.json` on local disk. `fly.toml` mounts no volume, with `auto_stop_machines='stop'` and `min_machines_running=0`, so the file is wiped on stop or deploy. After a wipe, `setActive`/`setCancelled`/`setPaymentFailed` are silent no-ops — they only mutate when a record already exists (60-83) — so cancellations and payment failures get dropped. The financial dup path is saved by Stripe's idempotency key, but status tracking is unreliable.

Fix: use a real datastore (or a mounted volume), and treat Stripe as the source of truth.

### 7. Email header injection
`src/lib/email-sender.ts` (66-79)

`To`/`Subject` are interpolated into raw headers joined by `\r\n`. `params.to` is the user-supplied applicant email, validated only as `includes("@") && includes(".")` in `apply.ts:154`. A value with embedded CRLF can inject headers (for example `Bcc:`).

Fix: reject or strip CR/LF in recipient and subject before building the message.

### 8. Rate-limit bypass via spoofed `X-Forwarded-For`
`src/middleware.ts` (16-22)

`getClientIp` trusts the leftmost `x-forwarded-for`, which the client controls. Rotating that header defeats the limiter.

Fix: derive the IP from a trusted hop (Fly sets `Fly-Client-IP`) rather than client-supplied XFF.

## LOW

- `src/middleware.ts` (3-14): comment says "15 requests… resets the window on each new request," but `MAX_REQUESTS = 30` and the window does not reset per request. Doc/code mismatch.
- `src/pages/api/get-prices.ts` (39-44): on Stripe failure or non-NZD price the plan stays `{ amount: 0 }`, so the UI can render "NZ$0.00". Return an error or sentinel instead.
- `src/pages/api/create-checkout-session.ts` (259-279): `appendAssociateApplication` runs before `sessions.create`; if Stripe throws you get an orphan `checkout_requested` row.
- `src/pages/api/stripe-webhook.ts` (326-349): `handleInvoicePaid` fetches `membership` then does nothing — renewals via `invoice.paid` are not recorded. Dead/incomplete logic.
- `src/lib/stripe-checkout.ts` (47-51): `calcFirstTermAmount` divides weeks by 52; right after July 1 weeks-remaining can be ~52.14, yielding a first term slightly above the annual amount (minor overcharge).
- Test gap: `src/pages/api/stripe-webhook.test.ts` mock omits `refreshPmIndexDoc`/`refreshAmIndexDoc` exports (the vitest warnings). Harmless today because they run in a detached `.then()`, but the tests would throw if that path were awaited.

## Suggested order

Start with #1 (token disclosure) and #2 (debug-env): most exploitable, small self-contained fixes.
