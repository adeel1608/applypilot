# ApplyPilot Production Verification Project Plan

Last updated: 2026-09-22
Owner: `adeel1608`
Repository: `adeel1608/applypilot`
Expected current main: `010cbe909b7d7b2b4ed88c413f270f7ff1ff75ac`
Workflow: `PROJECT_PLAN.md -> one scoped Codex prompt -> execution/evidence -> updated PROJECT_PLAN.md -> technical review -> next prompt`

> This is the active production-readiness checklist. Historical evidence must be preserved separately and never rewritten as current state.

## 1. Resume here

### Current checkpoint

- PR #42 merged as `467e288959edd6983c5086bbee979aad23e434d8`.
- PR #43 merged as `010cbe909b7d7b2b4ed88c413f270f7ff1ff75ac`.
- Latest reported private DB state: schema 9, pending migrations 0, integrity PASS, FK issues 0.
- Latest reported real-action counters: source/employer/upload/submission = `13/9/0/0`.
- Active source authority: reported 0.
- Active target authority: reported 0.
- First real employer target validation: historically proven.
- Source-enabled Personal Beta: READY.
- Personal Live V1: NOT_READY.
- No final-submit consent has been issued.
- No real application has been submitted.

### Important unresolved technical question

The latest runtime checkpoint says remaining blockers are owner-only facts. Do not accept that as final until the real application-operation path is audited.

Current repository code still appears to restrict `REAL_TARGET` `RunnerTargetCapability` to `OPEN_AND_INSPECT_ONLY`. Verify whether a separate production-enforced path exists for `MAP_FOR_FILL`, `FILL`, `UPLOAD`, `VERIFY`, and `FILL_PREVIEW`.

A grant enum alone is not proof of production support.

### Latest selected target evidence

Latest recorded Melbourne target:
`Computer Vision Engineer (C++) (R4633)`

Recorded evidence:
- fact-bound engineering CV generated privately as PDF/DOCX;
- locally validated/approved;
- review-only packet frozen;
- packet reportedly used a legacy evaluation binding;
- passive employer inspection completed;
- 46 controls inventoried;
- 27 unsupported controls;
- 1 document-required control;
- zero candidate values;
- zero writes;
- zero uploads;
- zero submissions.

This proves passive compatibility only, not fill/upload/submission readiness.

## 2. Final production objective

ApplyPilot must support a safe, reproducible, single-owner production workflow:

`discover -> normalize -> deduplicate -> evaluate -> shortlist -> generate/freeze documents -> inspect -> map -> fill -> upload -> human review -> fresh submit consent -> submit once -> track outcome`

### Green banner

`# 🟢 **WE ARE READY**`

means:
- ready for the first supervised real submission;
- suitable current role selected;
- candidate facts supported;
- current CV and packets frozen;
- actual target inspected;
- real map/fill/upload verified;
- filled preview reviewed;
- exact submit control identified;
- one-use consent mechanism verified;
- no unresolved material blocker.

It does NOT mean an application has already been submitted.

### Permanent safety boundaries

- Unknown facts remain unknown.
- Never infer citizenship, visa/work rights, sponsorship, clearance, experience, education, certifications, licences, availability, or other material application facts.
- Never bypass CAPTCHA, MFA, authentication, bot controls, rate limits, access controls, or website restrictions.
- No blind retry after ambiguous submission.
- Final submit always requires fresh one-use owner consent.
- Private profile, documents, DB, cookies, sessions, secrets, and live payloads remain local/ignored.
- Public showcase is not operational production.

## 3. Working agreement

For every future Codex iteration:

1. Read `AGENTS.md`, this plan, and relevant history.
2. Verify branch, HEAD, origin/main, worktree, DB/schema compatibility, and dependencies.
3. Select only the authorized task.
4. Update the task blueprint before application/runtime code changes.
5. Implement only within scope.
6. Run acceptance checks.
7. Record evidence, failures, blockers, and decisions.
8. Update current state and next dependency.
9. Return the updated plan and handoff.
10. Wait for review where required.

### Status values

`NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `BLOCKED`, `VERIFIED`, `DEFERRED`, `NOT_APPLICABLE`

### Evidence values

`REPORTED`, `CODE_REVIEWED`, `SYNTHETICALLY_VERIFIED`, `LOCAL_RUNTIME_VERIFIED`, `LIVE_VERIFIED`, `DEPLOYMENT_VERIFIED`

Every verified task must record revision, environment, command/observation, timestamp, result, evidence location, and invalidation conditions.

## 4. Verified-state ledger

### BASE-001 — Repository baseline
Status: `IN_PROGRESS`
Owner: Codex

Checklist:
- [ ] Verify local HEAD.
- [ ] Verify `origin/main`.
- [ ] Verify worktree.
- [ ] Verify PR #42/#43 ancestry.
- [ ] Verify current plan blob.
- [ ] Compare current plan to supplied `PROJECT_PLAN(7).md`.
- [ ] Archive the pre-rebase plan losslessly.
- [ ] Preserve unresolved historical work.

Acceptance: one non-contradictory baseline.

### BASE-002 — Private runtime baseline
Status: `NOT_STARTED`
Depends on: `BASE-001`

Read-only checks:
- [ ] schema version;
- [ ] pending migrations;
- [ ] integrity;
- [ ] foreign keys;
- [ ] migration inventory;
- [ ] parent grant state;
- [ ] active child/capability counts;
- [ ] real-action counters;
- [ ] selected role;
- [ ] current profile/evaluation/document/packet bindings;
- [ ] target inspection evidence.

Acceptance: safe current-state summary with no private values printed.

### BASE-003 — Source accounting
Status: `NOT_STARTED`
Depends on: `BASE-002`

Latest recorded run:
- 4 requests;
- 4 pages;
- 100 provider records;
- 100 accepted;
- 83 persisted/evaluated/queued.

Checklist:
- [ ] Account for all 100 records.
- [ ] Explain the 17-record difference.
- [ ] Distinguish duplicate/unchanged/replayed/rejected/pre-existing outcomes.
- [ ] Confirm no silent loss.
- [ ] Verify idempotent replay.

Acceptance: every provider record has a deterministic disposition.

## 5. Architecture and trust boundaries

Document actual ownership for:
- `apps/web`;
- `apps/showcase`;
- candidate profile/truth store;
- job sources;
- importer;
- R2 normalization/evidence;
- eligibility/fit;
- duplicate/queue/corrections;
- documents;
- application runner;
- tracker;
- database;
- green-banner parent/child authority.

### Parent grant

Current operation ceiling includes:
- `SOURCE_LIST_JOBS`
- `OPEN_AND_INSPECT_ONLY`
- `MAP_FOR_FILL`
- `FILL`
- `UPLOAD`
- `VERIFY`
- `FILL_PREVIEW`

`SUBMIT` remains excluded.

Audit:
- [ ] parent persistence/digest;
- [ ] child derivation/scope;
- [ ] child expiry/replay;
- [ ] code SHA binding;
- [ ] parent revocation;
- [ ] cumulative action budgets;
- [ ] restart behavior.

### Runner authority

Audit how real operations are actually authorized and executed.

Do not assume parent child capability = runner capability.

## 6. Environment/configuration/secrets

### ENV-001 — Supported host
Verify:
- Windows/PowerShell;
- Node/npm;
- native SQLite;
- Playwright Chromium;
- filesystem permissions;
- loopback ports;
- timezone/DST;
- sleep/reboot;
- disk space;
- process concurrency.

### ENV-002 — Configuration inventory
Create:
`variable | purpose | environment | default | secret? | owner | validation | rotation/recovery`

Never record secret values.

### ENV-003 — Secrets
Verify:
- ignored env files;
- no credentials in Git/history;
- no secrets in CI artifacts;
- cookies/browser state local only;
- documented provisioning, rotation, revocation, leak response.

## 7. Dependency-ordered implementation plan

### P0 — Baseline reconciliation and plan rebase
Status: `IN_PROGRESS`

- [ ] Archive old plan at `docs/project-history/PROJECT_PLAN.before-production-rebaseline.md`.
- [ ] Record source commit/blob/hash.
- [ ] Replace stale front-page state.
- [ ] Add stable task IDs.
- [ ] Add old-to-new crosswalk.
- [ ] Separate reported vs verified evidence.
- [ ] Open documentation-only PR and leave unmerged.

Exit: one consistent active plan.

### P1 — Production scope and architecture verification
Status: `NOT_STARTED`

- [ ] Component capability matrix.
- [ ] End-to-end data-flow map.
- [ ] Private app vs showcase boundary.
- [ ] Real `MAP_FOR_FILL/FILL/UPLOAD/VERIFY/FILL_PREVIEW` architecture audit.
- [ ] Parent/child authority enforcement audit.
- [ ] Runner target capability enforcement audit.
- [ ] Deployment topology decision.
- [ ] Trust-boundary review.

Exit: explicit implemented-vs-proposed capability map.

### P2 — Candidate, role, and evidence readiness
Status: `NOT_STARTED`

- [ ] Inventory existing candidate evidence before asking owner.
- [ ] Classify verified/stale/conflicting/unknown facts.
- [ ] Verify work-right evidence and temporal bounds.
- [ ] Verify selected-role suitability.
- [ ] Keep Shield AI London validation role excluded.
- [ ] Verify job freshness via provider evidence.
- [ ] Verify current R2/evaluation/duplicate/queue state.
- [ ] Verify engineering CV provenance, digests, approval, currentness.
- [ ] Classify each unsupported form control.
- [ ] Create one minimal role-specific owner questionnaire only for genuinely missing facts.

Exit: evidence-backed suitable role and current packet, or precise blocker register.

### P3 — Source-to-application integrity
Status: `NOT_STARTED`

- [ ] Reconcile 100/83.
- [ ] Test partial-page restart/replay.
- [ ] Test unchanged/changed/duplicate records.
- [ ] Verify current R2 linkage.
- [ ] Verify staleness/invalidation propagation.
- [ ] Verify demo/private separation.

Exit: deterministic traceability with no silent loss or stale shortcut.

### P4 — Real map/fill/upload implementation
Status: `NOT_STARTED`

- [ ] Prove concrete real-target authority path.
- [ ] Separate MAP/FILL/UPLOAD/VERIFY.
- [ ] Keep SUBMIT unavailable.
- [ ] Bind target/form/adapter/packet/answers/disclosures/document digests.
- [ ] Support only known controls.
- [ ] Block unknown required controls.
- [ ] Verify post-fill values.
- [ ] Verify exact uploaded document.
- [ ] Test stale bindings, replay, changed form, wrong document, interruption, redirect, popup, protection signals.

Exit: real non-submit engine implemented and synthetically/integration verified.

### P5 — Final review and submission safety
Status: `NOT_STARTED`

- [ ] Freeze exact final-review state.
- [ ] Fresh one-use consent.
- [ ] Invalidate consent after material change.
- [ ] Prevent concurrent/double consumption.
- [ ] Bind exact submit control.
- [ ] Define `SUBMITTED`, `FAILED_PRE_SUBMIT`, `OUTCOME_UNKNOWN`.
- [ ] No retry after ambiguous result.

Exit: synthetic submit lifecycle verified.

### P6 — Reproducible staging/release candidate
Status: `NOT_STARTED`

- [ ] Clean checkout install/build/test.
- [ ] Separate staging DB/grants/docs/browser/ports.
- [ ] Same production build/config model.
- [ ] No real external actions in CI.
- [ ] Record release artifact digest, SHA, schema/config versions.
- [ ] Define and verify stability/recovery thresholds.

Exit: identifiable release candidate.

### P7 — Controlled live non-submit validation
Status: `NOT_STARTED`

Requires P2/P4/P6.

- [ ] Revalidate suitable live role.
- [ ] Revalidate target/form.
- [ ] Run one bounded real mapping.
- [ ] Run controlled fill.
- [ ] Upload exact approved document if required.
- [ ] Verify all material fields/documents.
- [ ] Freeze reviewable preview.
- [ ] Stop on protection/uncertainty.

Exit: verified real non-submit preview.

### P8 — Green-banner review
Status: `NOT_STARTED`

Require all:
- [ ] suitable current role;
- [ ] supported material facts;
- [ ] current approved CV;
- [ ] frozen answer/disclosure packets;
- [ ] current target inspection;
- [ ] real mapping;
- [ ] real fill;
- [ ] required upload;
- [ ] verified fill preview;
- [ ] exact submit control;
- [ ] one-use consent mechanism;
- [ ] outcome handling;
- [ ] no release blocker.

Only then emit:
`# 🟢 **WE ARE READY**`

### P9 — Production deployment
Status: `NOT_STARTED`

- [ ] Approve topology.
- [ ] Disable overlapping runners.
- [ ] Verify consistent backup.
- [ ] Apply migration only if required.
- [ ] Install/start approved artifact.
- [ ] Verify version/schema/config.
- [ ] Keep external actions default-deny until checks pass.
- [ ] Verify browser runtime/private storage.
- [ ] Define monitoring and rollback triggers.

Exit: production runtime deployed reproducibly.

### P10 — First real submission
Status: `NOT_STARTED`

- [ ] Recheck target/job/profile/docs/form/preview.
- [ ] Owner reviews exact application.
- [ ] Generate fresh one-use final consent.
- [ ] Submit exactly once.
- [ ] Record truthful outcome.
- [ ] Verify consent consumed/capability terminal/tracker updated.
- [ ] Verify runtime health.

Exit: first supervised production application has durable outcome evidence.

### P11 — Recovery, maintenance, handover
Status: `NOT_STARTED`

- [ ] Code rollback test.
- [ ] Config rollback test.
- [ ] Isolated DB restore test.
- [ ] Prove restore cannot resurrect consumed consent/authority.
- [ ] Prove restore cannot cause duplicate submission.
- [ ] Incident response/kill switch.
- [ ] Credential/session revocation.
- [ ] Provider drift procedure.
- [ ] Operator install/start/stop/check/backup/restore/rollback guide.

Exit: another engineer can operate/recover the system safely.

## 8. Testing and verification matrix

Repository commands to map to tasks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e`
- `npm run privacy:audit`
- `npm audit`
- `npm run audit:production`
- `npm run db:status`
- `npm run preflight`
- `npm run release:check`
- backup/restore commands
- `git diff --check`
- `git fsck --strict`

Integration path:
`profile -> source -> observation -> normalization -> R2 -> queue -> document -> packet -> inspection -> map -> fill -> upload -> review -> consent -> outcome`

Regression must cover:
- source drift;
- inert content;
- page/request budgets;
- restart/replay;
- accepted-to-persistence boundary;
- source accounting;
- current R2;
- packet staleness;
- capability identity;
- parent/child scope;
- destination/popup/write-request behavior;
- unsupported controls;
- document mismatch;
- duplicate external action;
- ambiguous outcome.

Security/privacy must cover:
- SSRF/DNS/host/path/query;
- target origin/path;
- redirects;
- no secret logs;
- no candidate data in source discovery;
- parent revocation;
- child expiry/replay;
- unauthorized operations;
- submit exclusion;
- candidate isolation;
- upload disclosure;
- private artifact exclusion from Git/CI/build/showcase.

Host/device:
- Windows/PowerShell;
- Node/npm;
- SQLite;
- Chromium;
- headless/headful assumptions;
- PDF fonts/rendering;
- disk exhaustion;
- interrupted process;
- reboot/sleep;
- connectivity loss;
- timezone/DST;
- concurrent processes.

Robotics hardware: `NOT_APPLICABLE` unless a real dependency is introduced.

## 9. Safety/failure handling

- Unknown facts stay unknown.
- Protection signal => stop.
- Ambiguous submit => `OUTCOME_UNKNOWN`.
- No blind retry.
- Typing/upload are external disclosure operations before final submit and must be scoped/audited.
- Persist only minimal safe evidence needed for audit/recovery.

## 10. Database/migration/backup/recovery

Expected current state to verify:
- schema 9;
- pending 0;
- integrity PASS;
- FK issues 0;
- migrations 0000-0008 immutable;
- 0009 additive.

Checklist:
- [ ] migration hashes/status;
- [ ] future-schema refusal;
- [ ] transaction boundaries;
- [ ] WAL-aware backup correctness;
- [ ] isolated restore;
- [ ] authority reconciliation after restore;
- [ ] restore cannot resurrect consumed submit consent or cause duplicate external actions.

## 11. Staging/pre-production

- separate DB;
- separate grants;
- separate documents;
- separate browser state;
- separate ports;
- synthetic external targets only;
- release artifact digest;
- release SHA;
- schema compatibility;
- config version;
- recovery rehearsal.

## 12. Deployment procedure

Production runbook must include:
1. stop writers;
2. verify approved artifact;
3. verify config/secrets without printing;
4. verify schema;
5. create/verify backup;
6. migrate only if required;
7. install/start;
8. health/version/schema checks;
9. verify external actions default-deny;
10. verify authority state;
11. verify browser runtime/private storage;
12. enable only approved scope;
13. monitor;
14. roll back on defined trigger.

## 13. Blocker register

Use:
`ID | category | affected task | evidence | impact | resolver | next action | unblock condition`

Categories:
- `OWNER_FACT`
- `OWNER_DECISION`
- `ENGINEERING`
- `PROVIDER_EVIDENCE`
- `CONFIGURATION`
- `SECURITY_POLICY`
- `MISSING_VERIFICATION`

Initial blockers:

| ID | Category | Impact |
|---|---|---|
| BLK-001 | ENGINEERING/MISSING_VERIFICATION | real MAP/FILL/UPLOAD production path not yet proven |
| BLK-002 | PROVIDER_EVIDENCE | selected job currentness/expiry unresolved |
| BLK-003 | OWNER_FACT | work-right/sponsorship answers where exact target requires them |
| BLK-004 | MISSING_VERIFICATION | broad experience/skills/education gaps may conflict with existing profile evidence |
| BLK-005 | ENGINEERING | 27 unsupported target controls need materiality/type classification |
| BLK-006 | MISSING_VERIFICATION | 100 provider vs 83 persisted accounting incomplete |
| BLK-007 | MISSING_VERIFICATION | review packet reportedly uses legacy evaluation binding |

Do not classify every unresolved item as owner-only.

## 14. Risk and decision logs

Risk register must include:
- repeated live debugging;
- fixture bias;
- uncalibrated scoring;
- stale grants/packets;
- unsupported controls;
- private-data exposure;
- cumulative parent authority;
- recovery-induced duplicate action;
- provider/ATS drift.

Decision format:
`ID | date | context | options | selected | rationale | evidence/approval | consequences | supersedes`

Do not estimate deadlines, percentages, or prompt counts without defensible evidence.

## 15. Historical preservation

Archive:
`docs/project-history/PROJECT_PLAN.before-production-rebaseline.md`

Record:
- source commit;
- source blob/hash;
- major checkpoint index.

Historical index should include:
- Phase 0/1 bootstrap;
- SEEK work;
- real-world intake;
- R2A/B/C/D;
- source-enabled beta;
- public showcase;
- Personal Live V1 enablement;
- real source runs;
- target inspection v1-v7;
- first real target validation;
- persistent green-banner grant;
- bounded source discovery;
- engineering CV generation;
- selected Melbourne target inspection;
- PR #42/#43 checkpoint.

## 16. Old-to-new crosswalk

Map every unresolved old roadmap item into P0-P11.

Examples:
- truth store -> P2
- sources -> P1/P3
- normalization/R2 -> P3
- documents -> P2
- application preparation -> P2/P4
- assisted filling -> P4/P7
- final review -> P5/P8
- submit -> P5/P10
- deployment -> P6/P9
- security/recovery -> P6/P9/P11
- optional scheduling/notifications/analytics/AI -> DEFERRED unless needed for narrow production scope

## 17. Current iteration handoff

Current task:
`P0 — baseline reconciliation and production-plan rebase`

Scope:
documentation/evidence reconciliation only.

No:
- source fetch;
- employer visit;
- fill;
- upload;
- submission;
- capability mutation;
- migration;
- deployment;
- secret/config mutation;
- application-code change.

Required PR:
`docs: reconcile readiness and rebuild the production project plan`

Leave OPEN and UNMERGED.

Expected likely next task after P0:
`P1-002 — Real application-operation architecture audit`

Do not finalize the next task until P0 evidence is complete.
