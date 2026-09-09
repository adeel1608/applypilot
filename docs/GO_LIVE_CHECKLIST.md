# Personal go-live gates and test matrix

Status: **MANUAL-INTAKE PERSONAL BETA READY**. PR #10 was reviewed at exact head `b7872fe5791f1baa88d9e95e2b7096926ea44813` and merged as `4a0462d24b9a8db79ec49ff64242405d8f96f40d`. Source-enabled Personal Beta is `WAITING_FOR_APPROVED_TENANT`; Personal Live V1 and hosted production are `NOT_READY`; the real runner is `TARGET_APPROVAL_REQUIRED`. Exact implementation evidence is in [PROJECT_PLAN](../PROJECT_PLAN.md).

R2A is **IMPLEMENTED / SYNTHETICALLY VERIFIED / PRIVATELY VERIFIED** on its unmerged implementation review branch. The real ignored database is schema v3 with zero pending migrations and clean integrity/FKs after a verified backup, additive migration 0003, and offline stored-vacancy reprocess. R2B, R2C, and R2D remain `NOT_IMPLEMENTED`; this does not expand Manual-intake Personal Beta authority or enable a source/runner.

## Earliest safe use — eight answers

1. Real owner-supplied jobs may be used now for reviewed local intake, conservative eligibility/fit inspection, private document generation/approval, and review-required packet preparation with the validated local profile/database. Scores remain uncalibrated and unknowns require owner review.
2. Manual-intake Personal Beta does not authorize source fetching, employer-form visits, external uploads, or final submission. A separately approved R1 capability/smoke and R5 target/runner gate are required.
3. R2 must improve typed normalization/evidence, class semantics, scoring calibration, cross-source dedup, and queue freshness before ranking is treated as mature. It can be implemented entirely with fictional/local owner-supplied inputs.
4. R1 source-enabled Beta is a separate train. Greenhouse/Lever readers are default-disabled, no private capability is present, and zero real source calls have been made.
5. CV/letter preparation uses verified evidence, semantic claim validation, template policy, page/font/text checks, confined PDF/DOCX exports, parity checks, and owner approval. Every real artifact still needs owner review.
6. Packet preparation and synthetic filling/final-action proofs exist. No real target is approved and no real application action is permitted.
7. Cloud is unnecessary: loopback UI, local SQLite, and a future separately approved local runner remain the recommended personal topology.
8. Scheduling, notifications, broad sources, analytics, AI, and hosting remain optional later work. Truth, privacy, recovery, and immediate human review stay mandatory.

## Release definitions

| Level                          | Entry criteria                                                                                                                                                                                           | Exit / promotion criteria                                                                                   | Current assessment                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `LOCAL LIVE ALPHA`             | Validated ignored private profile; reviewed/migrated DB; truthful local UI; no external action; privacy/recovery gates                                                                                   | Owner accepts supervised limitations                                                                        | `COMPLETE`                                                         |
| `MANUAL-INTAKE PERSONAL BETA`  | Approved Beta Core, owner-supplied intake, immutable evidence/evaluation, conservative eligibility/fit, truthful private document/packet workflow, synthetic runner safety, current backup/privacy gates | Continued owner review of every input/artifact/packet; later releases require separate gates                | `READY`; PR #10 merged; private smoke passed                       |
| `R2 MATCHING QUALITY`          | Approved R2 plan and slices R2A–R2D                                                                                                                                                                      | Typed truth/modality, class semantics, verified-only scoring, durable dedup/queue, golden/calibration gates | `R2A VERIFIED / PR REVIEW PENDING`; R2B–R2D remain not implemented |
| `SOURCE-ENABLED PERSONAL BETA` | Manual Beta + R1A/R1B + one exact owner-approved read-only tenant capability + R1C smoke                                                                                                                 | Current policy/capability/budgets and explicit post-smoke owner release                                     | `WAITING_FOR_APPROVED_TENANT`; zero real calls                     |
| `PERSONAL LIVE V1`             | R0–R6 plus mandatory R11 controls; approved discovery and application paths; full matrix; owner release                                                                                                  | Scoped supported operation; regression disables affected capability                                         | `NOT_READY`                                                        |
| `HOSTED PRODUCTION`            | Separate R10/R11 authentication, isolation, keys, pairing, retention, residency, operations, and security approval                                                                                       | Staging/restore/rollback/internet-facing acceptance and explicit deployment authority                       | `NOT_READY`; unnecessary for Personal V1                           |

## Manual-intake Personal Beta acceptance — satisfied

- [x] PR #10 exact-head CI and human review passed; reviewed head was merged without changing release authority.
- [x] Real jobs do not use demo profiles; current job/profile/evaluation bindings guard documents and stale inputs invalidate downstream readiness.
- [x] Manual intake preserves immutable source observations, job/evidence/evaluation versions, changed-import confirmation, and corrections.
- [x] Ten CV categories and optional letters pass verified-claim, font, text, page, parity, path, digest, and owner-approval gates.
- [x] Packet answers/documents remain tri-state; missing, unknown, stale, expired, or unresolved duplicate inputs block readiness.
- [x] Synthetic browser stop, disclosure, destination, stale/replay, fresh one-use consent, exactly-one fixture click, and unknown-outcome no-retry tests pass.
- [x] Durable queue/application timeline, backup/restore, migration, database integrity/FKs, default-route, keyboard, zoom, narrow-view, privacy, build, and dependency gates passed at the reviewed implementation head.
- [x] Private smoke generated no published values and performed zero source calls, employer-form visits, uploads, submissions, or other real application actions.

## R2 and R1 gates — intentionally open

- [x] R2A evidence-state/modality schemas, conservative additive migration, fictional corpus, evidence UI, and private offline reprocess are implemented and verified; implementation PR review remains pending.
- [ ] R2B legal/employer/preference outcomes and verified-only scoring/calibration gates pass.
- [ ] R2C cross-source suggestions, owner link/reject/split, version-bound queue freshness, typed corrections, and audit schemas are durable.
- [ ] R2D fictional golden corpus, private aggregate calibration threshold, uncertainty UX, and exact-head validation pass.
- [ ] R1A exact capability approval/revocation/expiry, connection-time DNS pinning, full-body cancellation, and network/tenant threat gates pass without real calls.
- [ ] R1B selected source-family fictional integration passes; current recommendation is Lever.
- [ ] Owner separately identifies and approves one exact tenant and the bounded R1C smoke.
- [ ] R1C makes exactly the approved read-only call(s), passes private/data/integrity/idempotency checks, and receives a separate post-smoke source-enabled Beta release decision.
- [ ] A real application target/runner is separately planned, policy-reviewed, implemented, tested, and explicitly approved before any real form operation.

## Test matrix

U = unit/domain; I = integration/persistence; B = fictional browser; S = security; M = private manual acceptance; P = future scoped source/target smoke. Automated data is fictional. Real M/P evidence publishes only safe counts/codes/statuses, with no screenshot/video/trace or raw profile/job/log dump.

| Scenario                               | Levels    | Acceptance                                                                                                                    | Current evidence / remaining gate                                                         |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Private profile/version                | I/B/S/M   | Valid current private snapshot; no public values; no demo fallback                                                            | Beta binding/path/privacy tests and private smoke pass; R2 adds per-field evidence states |
| One/multi/HTML/file intake             | U/I/B/S/M | Bounded inert input, correct segments, explicit confirmation, canonical versions                                              | Beta gates pass; R2A expands ordinary headings, structured fields, and sparse coverage    |
| Normalized evidence                    | U/I/B/M   | State + modality + span/path for geography, employment, salary, schedule, documents, and typed requirements                   | Foundation partial; R2A required                                                          |
| Repeated/changed import                | U/I/B/M   | Repeat idempotent; change creates immutable observation/version after confirmation                                            | Beta repository/integration and private offline reprocess pass                            |
| Cross-source duplicate                 | U/I/B     | Preserve observations; ambiguous stays suggested; owner link/reject/split is reversible                                       | Conservative helper/tests exist; durable R2C use required                                 |
| Work rights/legal hours                | U/I/B/M   | Valid != unrestricted; expiry/hours/conditions and time basis explicit                                                        | Foundation passes; class/state-complete R2A/R2B required                                  |
| Licence/qualification/experience/skill | U/I/B/M   | Exact required/preferred/conditional/equivalent evidence; unknown reviews                                                     | Basic rules pass; richer R2A/R2B required                                                 |
| Schedule/commute/vehicle               | U/I/B/M   | Overnight/alternatives, week/fortnight, km/minutes, ownership/licence remain distinct                                         | Basic rules pass; R2A/R2B matrix required                                                 |
| Fit/recommendation                     | U/I/B/M   | Current verified evidence only; deterministic/explainable; no blocker/review override; calibrated label                       | Verified history/preferences already gated; R2B/R2D required                              |
| Corrections and queue                  | U/I/B/M   | Immutable correction and invalidation; queue binds current versions and duplicate state                                       | Beta partial/current stale display; expanded R2C gate required                            |
| CV and cover letter                    | U/I/B/S/M | Verified claims, ten templates, optional tri-state letter, PDF/DOCX parity/path/digest/approval                               | Beta complete for Manual-intake Personal Beta                                             |
| Packet/answers                         | U/I/B/S/M | Current tuple, tri-state unknowns, document/expiry/duplicate checks, owner review                                             | Beta complete for current manual scope; profile re-resolve carryover belongs R4/R11       |
| Browser/final action                   | U/I/B/S   | Every access/auth/bot/rate/change stop; frozen review; exactly one synthetic click; unknown outcome no retry                  | Synthetic Beta proof complete; real target remains unapproved/disabled                    |
| Source capability/network              | U/I/B/S/P | Exact tenant/GET, approval/expiry/revocation, pinned public destination, bounded/cancelled/idempotent run, no private payload | Strong reader foundation; R1A/R1B and owner-approved R1C remain                           |
| Tracking/recovery                      | U/I/B/S/M | Append-only valid transitions, paused/unknown recovery, no inferred/replayed submit                                           | Manual Beta complete; future real-run recovery needs target gate                          |
| Database/privacy/publication           | I/B/S/M/P | Additive backup/migration/restore, counts/schema/FKs/integrity; no private Git/history/build/CI data                          | Beta schema v2/private audit pass; repeat for every migration/smoke                       |
| UX/a11y/mobile                         | B/M       | Keyboard/focus/labels/contrast/zoom/narrow/long/empty/error states                                                            | Manual Beta route gates pass; R2 evidence/dedup UI and cosmetic separator remain          |

Every implementation head requires formatting, lint, typecheck, unit/integration/browser tests, production build, full and production dependency audits, diff check, privacy audit, database/migration tests where applicable, and exact-head CI. Failed or unavailable checks are reported exactly, not waived. Green fictional CI never replaces source permission, private owner acceptance, or real-target approval.
