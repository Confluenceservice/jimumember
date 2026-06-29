# Tasks — Admin Application Review

> Spec ID: `010` · Type: system feature
> Status: backfilled. Approval pending first review-doc change.

## Phase 1: Review Doc Generation
- [x] `createApplicationReviewDoc(applicant)` (advanced)
- [x] `createBasicApplicationReviewDoc(application)` (basic)
- [x] Template with all sections (personal details → declarations)
- [x] Drive folder configurable via env var

## Phase 2: Webhook Integration
- [x] Async generation on `checkout.session.completed` (option_c)
- [x] Doc URL in admin notification email
- [x] Failure logged, sheet update still succeeds

## Phase 3: Index Docs
- [x] `refreshAdvancedIndexDoc()`
- [x] `refreshBasicIndexDoc()`
- [x] Lists all paid applications with links

## Phase 4: Future
- [ ] Doc template customisation per org
- [ ] Doc archival policy
- [ ] Collaborative review workflow

## Notes
- Doc generation is async + best-effort. Failure does not block payment processing.
- Index docs are refreshed on demand; not auto-refreshed on each payment.