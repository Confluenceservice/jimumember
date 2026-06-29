# Tasks — Email Notifications

> Spec ID: `009` · Type: system feature
> Status: backfilled. Approval pending first email change.

## Phase 1: Foundation
- [x] Mailgun client wrapper
- [x] Region resolution (US/EU)
- [x] Org identity helper
- [x] Send-error logging (no throw)

## Phase 2: Seven Senders
- [x] `sendResumeLink()`
- [x] `sendAdvancedConfirmation()`
- [x] `sendAdvancedApplicationNotification()`
- [x] `sendBasicConfirmation()`
- [x] `sendBasicApplicationNotification()`
- [x] `sendRenewalAdminNotification()`
- [x] `sendRenewalPdLogLink()`

## Phase 3: Gmail Removal (Phase K)
- [x] Remove Gmail OAuth path (invalid_rapt errors)
- [x] Mailgun as sole provider

## Phase 4: Future
- [ ] HTML email templates
- [ ] Bounce webhook handling
- [ ] Email template extraction to JSON
- [ ] Drip campaigns

## Notes
- All senders are plain-text only (NFR-EN-005). HTML migration requires spec re-approval.
- Send failures never throw — webhook handler must succeed.