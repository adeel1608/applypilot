# Personal go-live gates and test matrix

Status: manual-intake Beta gates implemented and privately exercised; final implementation PR review remains open. Source-enabled Beta and Personal Live V1 gates remain open. Exact commands/results are in [PROJECT_PLAN](../PROJECT_PLAN.md).

## Earliest safe use — eight answers

1. Real pasted jobs can be used now for owner-reviewed local intake and conservative eligibility/fit inspection, with a valid local profile and migrated DB. Unparsed requirements remain unknown; scores are uncalibrated.
2. Phase 2.5A establishes one real UI import/private evaluation and scoped privacy/regression evidence. It does not establish general extraction accuracy, document readiness or applications.
3. Real automated discovery still needs an approved source/tenant/read-only interface and an authorised smoke. Bounded readers and controls exist, but zero capabilities are enabled.
4. CV/letter preparation now uses typed verified evidence, semantic claim validation, template policy, page/font/text checks, confined exports, parity checks, and owner approval.
5. Packet preparation and synthetic filling proofs exist. Real assisted filling still needs a supported target adapter and separate policy/owner approval.
6. Final submission support needs frozen packet review, fresh one-use owner consent, approved target, exactly-once fixture proof and unknown-outcome reconciliation. No submit capability exists now.
7. Cloud is unnecessary: recommend loopback UI, local SQLite and local runner for personal V1.
8. Scheduling, alerts/email, broader sources, advanced analytics, AI and hosting can wait. Truth, privacy, recovery and immediate final review cannot.

## Release definitions

| Level               | Entry criteria                                                                                                                                 | Exit / promotion criteria                                                                                     | Current assessment                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| LOCAL LIVE ALPHA    | Validated ignored private profile; reviewed/migrated DB; truthful real UI import; no source fetch/application action; privacy/regression gates | Owner accepts intake/scoring/unknown limitations and approves R0 evidence; stronger use waits for later gates | Demonstrated for supervised intake only; final gate results in project plan |
| MANUAL-INTAKE BETA  | R0 approved; owner-supplied intake; R2 evidence/identity fixes; R3/R4 truthful packet preview                                                  | Final implementation PR review; continued owner review of every real artifact                                 | IMPLEMENTED; private smoke PASS; PR review pending                          |
| SOURCE-ENABLED BETA | Manual-intake Beta plus one owner-approved read-only source/tenant capability and scoped smoke                                                 | Tenant policy/budget remains current; owner accepts source-specific residual risk                             | WAITING_FOR_APPROVED_TENANT; zero real calls                                |
| PERSONAL LIVE V1    | R0–R6 and mandatory R11 controls; one approved discovery and application path; full matrix; owner release approval                             | Scoped supported operation; regressions disable affected capability pending reviewed fix                      | NOT_READY                                                                   |
| HOSTED PRODUCTION   | Separate R10/R11 authz/isolation/keys/pairing/retention/residency/security approval                                                            | Staging, restore, rollback, internet-facing acceptance and explicit deploy/spend authority                    | NOT_READY; unnecessary for personal V1                                      |

## Release acceptance checklist

- [ ] Exact source/tenant/runner capability and policy versions approved.
- [x] Legal limits, preferences and employer requirements remain distinct; unknown never becomes true.
- [x] Real jobs never use demo profiles; stale inputs invalidate evaluation/document/packet readiness.
- [x] Duplicates preserve every source and one canonical application state.
- [x] Ten CV categories and letters pass semantic claim, font, text, page, parity, and path gates.
- [x] Answers are tri-state; unknown mandatory answers block readiness.
- [x] Synthetic browser protection stops, disclosure consent, and fresh single-application final review pass.
- [x] Paused/unknown-outcome runs and DB backups can be recovered without automatic resubmission.
- [x] Default routes pass labelled-control and narrow-viewport acceptance; synthetic routes cover empty/error/stop states.
- [ ] Exact-head CI and final human review pass for the implementation PR.
- [ ] Human reviews the final implementation PR and separately authorises release.

## Test matrix

U = unit/domain; I = integration/persistence; B = fictional browser; S = security; M = private manual acceptance; P = scoped production smoke. Automated data is fictional. Real M/P runs emit only safe counts/codes/statuses, with no screenshot/video/trace or raw profile/ad/log dumps. Proposed cases must become executable before their train is accepted.

| Scenario                         | Levels    | Acceptance                                                    | Current evidence / remaining work                          |
| -------------------------------- | --------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Real private profile             | I/B/S/M/P | Valid private snapshot, no public values                      | Provider/path tests and R0 equality; durable enum needs R2 |
| One-job paste                    | U/I/B/M/P | Complete source, truthful edits, one canonical job            | Tests plus real R0 proof; extraction incomplete            |
| Multi-job paste                  | U/I/B     | Correct boundaries, selective review/confirm                  | Fictional coverage; broader adversarial corpus pending     |
| HTML import                      | U/I/B/S   | Inert text/JSON-LD, no resource/script load                   | Existing fixtures; future reader parity pending            |
| File import                      | U/I/B/S   | Bounded size/MIME/encoding; no credential retention           | Existing tests; document upload separate                   |
| Duplicate import                 | U/I/B     | Idempotent repeat, no extra canonical row                     | Per-source tests; tenant/cross-source queue pending        |
| Changed re-import                | U/I/B/M   | Explicit update, retain old observation                       | Existing update gate; immutable versions pending           |
| Invalid ad                       | U/I/B/S   | Safe coded error, no canonical write                          | Validation fixtures; focus/retry UX pending                |
| Expired ad                       | U/I/B/M   | Expiry blocks stale preparation/submission                    | Date utilities; end-to-end gate pending                    |
| Missing profile                  | U/I/B/P   | Import permitted, no evaluation/demo fallback                 | Existing provider/integration/E2E tests                    |
| Invalid profile                  | U/I/B/S   | Generic invalid status, no values exposed                     | Provider tests; broader browser errors pending             |
| Work-right ambiguity             | U/I/B/M   | Valid not unrestricted; unknown -> review                     | Unit rules and R0; typed extraction pending                |
| Availability conflict            | U/I/B/M   | Verified mandatory conflict blocks                            | Basic rules; overnight/DST/exceptions pending              |
| Licence blocker                  | U/I/B/M   | Mandatory class/jurisdiction/expiry verified                  | Basic unit checks; richer evidence pending                 |
| Vehicle blocker                  | U/I/B/M   | Own vehicle distinct from commute/licence                     | Basic rules; typed extraction pending                      |
| Good casual match                | U/I/B/M   | Verified-only reasons and sensible ranking                    | Foundation fixtures; held-out calibration pending          |
| Good engineering match           | U/I/B/M   | Verified projects/skills, no unverified boost                 | Template/score foundation; R2/R3 pending                   |
| CV generation                    | U/I/B/S/M | Ten layouts, claim provenance, min10pt/page/text rules        | HTML/PDF foundation; UI/DOCX/full validator pending        |
| Cover letter                     | U/I/B/M   | Exact target, verified concise evidence, optional/tone/export | Basic generator only; R3 pending                           |
| Unknown answer                   | U/I/B/S/M | Never YES by default; mandatory unknown blocks                | Types only; R4 pending                                     |
| Browser pause                    | U/I/B/M   | Durable checkpoint, explicit safe resume                      | Stop types only; R5 pending                                |
| CAPTCHA stop                     | U/I/B/S/M | No solve/bypass/continued action                              | Executable R5 proof required                               |
| MFA stop                         | U/I/B/S/M | Manual owner auth, no challenge automation                    | Executable R5 proof required                               |
| Bot/access/rate/site restriction | U/I/B/S   | Stop, no stealth/proxy/budget bypass                          | Source foundation; runner proof pending                    |
| Final-review gate                | U/I/B/S/M | Frozen packet/domain/digests, fresh one-use consent           | Invariant only; R5 pending                                 |
| Submission fixture               | I/B/S     | One approved click; stale/replayed consent zero clicks        | Not implemented; no real submission in mission             |
| Tracking                         | U/I/B/M   | Valid audited transitions and canonical state                 | Unit transition helper; durable UX pending                 |
| Crash recovery                   | I/B/S/M/P | Atomic replay; unknown submit never retried                   | Import transactions; run recovery pending                  |
| Database recovery                | I/S/M/P   | Consistent separate restore, counts/schema/FKs/integrity      | Migration checks; restore rehearsal pending                |
| Privacy audit                    | I/B/S/M/P | No private data in Git/history/build/maps/traces/CI/PR        | R0 scoped audit; repeatable tooling proposed               |
| UX/a11y/mobile                   | B/M       | Keyboard/focus/labels/contrast/zoom/narrow viewport           | Happy-path tests do not certify accessibility              |
| Approved-source smoke            | I/S/M/P   | Allowlisted GET only, bounded, no candidate payload           | No source smoke performed/approved yet                     |

All implementation heads require formatting, lint, typecheck, unit/integration/browser tests, production build, full and production dependency audits, diff check, privacy audit and final-head CI. Failed/unavailable checks are reported exactly, not waived silently. Green fictional CI does not replace source permission or private owner acceptance.
