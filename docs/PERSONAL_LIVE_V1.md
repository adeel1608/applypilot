# ApplyPilot Personal Live V1 master blueprint

Status: **AWAITING_HUMAN_REVIEW — design only**. Baseline: 2026-09-07, approved runtime fix merged at `4920b593aad90cc734570a3aae1d562d09d480e7`. See [PROJECT_PLAN](../PROJECT_PLAN.md) for exact activation and validation evidence. This plan does not enable discovery, document delivery, browser filling, scheduling, hosting, or submission.

## Product definition and release boundary

Personal Live V1 is a single-owner, local-first assistant that discovers jobs from at least one legitimately approved read-only source, accepts permitted owner-supplied jobs, preserves source evidence, conservatively deduplicates, explains eligibility and fit, builds truthful application packets, assists a specifically supported application form, pauses for human decisions, and records owner-confirmed submission/outcomes. Unsupported sites fall back to manual owner operation. V1 does not mean every board/ATS is automated.

No paid API, AI provider, cloud dashboard or cloud browser is required. All candidate data, source snapshots, SQLite, generated documents, answers and browser sessions remain private local runtime assets. GitHub is PUBLIC; npm `private: true` remains a publication safeguard. Final submission requires an immediate deliberate owner action for one frozen application; never background or batch submission.

The mandatory lifecycle for each material train is PLAN -> HUMAN REVIEW -> MERGE PLAN -> IMPLEMENT -> TEST -> HUMAN REVIEW -> MERGE. This PR contains activation evidence and the forward blueprint only. After review/merge, a new owner-authorised task may implement the selected train; changed scope/security assumptions require a revised plan first.

## Current evidence and capability inventory

Inspected 13 package directories including shared/database, eight routes, two migrations, source adapters, CI, scripts and tests. Existing module presence is not an end-to-end capability claim. Real activation used the actual loopback UI with one canonical job, one completed import, three retained unconfirmed previews, private-profile evaluation, and no application/document action. No real source fetch occurred. Full text survived, but several structured fields remained unknown. Tests and privacy results are recorded separately in the project plan.

| Capability                    | State   | Evidence / minimum remaining work                                                                                                                        |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Real discovery             | BLOCKED | Production URL registry allows no fetching; only fictional SEEK discovery. Implement an approved reader per [source matrix](SOURCE_CAPABILITY_MATRIX.md) |
| B. Job ingestion              | READY   | Bounded paste/multi/HTML/file -> preview -> explicit local confirm works; readiness limited to owner-reviewed input, not perfect extraction              |
| C. Normalization              | PARTIAL | Labelled/structured fields and full text; ordinary headings, source labels, requirement modality, schedule and geography incomplete                      |
| D. Deduplication              | PARTIAL | Per-source ID/URL/fingerprint uniqueness and changed-import review; no canonical cross-source resolution queue                                           |
| E. Eligibility                | PARTIAL | Deterministic rules and review state; legal/preference conflation and missing-input handling require correction                                          |
| F. Fit                        | PARTIAL | Explainable bounded score; arbitrary baseline/weights and unverified employment evidence path are not calibrated                                         |
| G. Shortlist/queue            | MISSING | Job lists exist; fixture detail shortlist controls are disabled; no durable real-job queue UX                                                            |
| H. CV generation              | PARTIAL | Fact-referenced model, HTML/PDF engine; no private-job UI, robust claim entailment, DOCX or enforced page limits                                         |
| I. CV tailoring               | PARTIAL | Keyword template choice and matching skills; no ranked evidence/bullet selection or measurable layout loop                                               |
| J. Cover letter               | PARTIAL | Basic text generator only; missing end-to-end truth validation, optionality, tone, private exports and UI                                                |
| K. Application answers        | PARTIAL | Tri-state types/answer-store contract; preparation stub returns no answers                                                                               |
| L. Document checklist         | PARTIAL | Required-document list in runner stub; no approved packet/version/presence validation                                                                    |
| M. Assisted browser fill      | MISSING | Stop-reason types only; no executable applicant runner                                                                                                   |
| N. Human final review         | PARTIAL | Invariant and disabled submission exist; no immutable packet review page or executable gate                                                              |
| O. Owner-confirmed submission | BLOCKED | No submit implementation or approved target; must remain disabled until R5/R8 gates                                                                      |
| P. Tracking                   | PARTIAL | Transition helper/schema; applications route uses fixture state, not durable real workflow                                                               |
| Q. Failure/recovery           | PARTIAL | Transactional imports, migration backup and integrity checks; no full restore/resume drills or unknown-submission recovery                               |
| R. Privacy                    | PARTIAL | Ignored local runtime, server-only provider, inert imports, no demo fallback; local-origin/auth, retention and browser controls need hardening           |
| S. Auditability               | PARTIAL | Import/evaluation events and profile-version links exist; explicit profile-state metadata is accidentally filtered by broad redaction                    |
| T. Operations                 | PARTIAL | Validation/migration/quality scripts and CI exist; doctor, backup/restore UX, operational release gate missing                                           |

Scheduling/notifications, analytics, AI and hosting are OPTIONAL_POST_V1 unless the owner makes scheduling part of the approved V1 scope. All changes affecting truth, privacy or irreversible actions remain release blockers, even if filed under R11.

## Activation interpretation and known defects

The exact real job-specific eligibility result, score and contributions remain private local evaluation metadata and are reported directly to the owner, not published in this public repository. It is not a probability, hire prediction, legal clearance or positive suitability verdict. Work-right and transport requirements remain ambiguous; hours, schedule, suburb, commute, structured duties/requirements and supported dates are not established. The raw ad preserves these passages locally, so the owner can review them without inventing normalized facts.

The UI required title entry from the source heading and source-URL copying. URL edits do not reclassify `UNKNOWN` origin; origin and `USER_SUPPLIED_CONTENT` acquisition must remain separate. Preview resets its original input form and shows only a 500-character excerpt; a full side-by-side source/normalized review is needed. Three abandoned preview records are retained locally; there is no preview-cleanup UX. Future cleanup needs explicit retention/confirmation, not direct deletion during activation.

Private provenance was proved through schema validation, the provider's real-import enforcement, and in-memory equality of the eligibility/fit profile snapshot with the private file and inequality with the example. The UI labels this private-profile analysis but does not show a durable evaluation-state enum. `job-import-repository.ts` filters keys matching `profile`, removing intended `profileState` audit metadata. R2 must persist allowlisted provenance enums without exposing profile values.

Other code-backed gaps: the generic import normalizer leaves typed licences/education/experience/skills empty and work rights UNKNOWN; full state names do not normalize to abbreviations; salary text gets a YEAR default without a parsed period; cover-letter unknown is collapsed to false in generic normalized booleans; employment-type parsing searches all text and prioritises casual; empty structured requirements can be mistaken for no requirements. These need fictional regressions and reviewed fixes, not ad-specific scoring patches.

## Data and architecture contracts

Keep domain engines pure and candidate-blind ingestion separate from candidate-aware evaluation. Proposed types are Zod-validated at file/network/UI boundaries:

- `SourceObservation`: source/tenant/record ID, raw local snapshot reference, observed/posted/expiry timestamps with certainty, URL provenance, parser/policy versions and run ID. Immutable observations are distinct from the current canonical job.
- `RequirementEvidence`: stable ID, exact bounded source span/path, normalized proposition, modality REQUIRED/PREFERRED/CONDITIONAL/UNKNOWN/NEGATED, condition, certainty and extraction version. Ad text is data, never instructions.
- `CanonicalJob`: identity, observations, normalized field evidence, duplicate-cluster/review state and current availability. Editing records author, reason, old/new values and source/profile version locally.
- `Evaluation`: canonical job version + profile version + rule/weight versions + explicit PRIVATE_LOCAL_PROFILE/DEMO_PROFILE context + reason codes/field references + score contributions + missing-data coverage. Stale inputs invalidate readiness, not silently reuse old approval.
- `DocumentArtifact`: immutable local path, content digest, template/rules/profile/job versions, per-claim evidence, layout result and owner approval. Digests/IDs are local metadata; do not publish private artifacts or fingerprints.
- `ApplicationPacket` and `ApplicationRun`: frozen job/profile/document/answer versions, target host, per-field certainty, review state, stop reason, durable checkpoint, one-use consent and submission outcome. SQLite writes and audit events are transactional.

Proposed additive migration sequence after separate review: canonical observations/duplicate clusters; typed requirements/evaluation versions/overrides; artifact/packet/question records; run/checkpoint/consent/outcome records; schedule/notification outbox. Use the next unused migration numbers at implementation time, not a preassigned destructive replacement of 0000/0001. Preserve old rows and source chains, back up first, validate mapping counts/FKs; no automatic startup migration.

## Cross-source duplicate model

Current identity order is source-scoped external ID -> canonical HTTPS URL -> title/company/location/description fingerprint -> content hash. URLs remove fragments and `utm_` parameters and sort other parameters. That is not enough for cross-source dedup: tenant-local IDs collide, meaningful query parameters must remain, and changed text can create a new fallback identity.

R1/R2 will treat `(source, tenant, externalId)` as a strong observation key, not universal canonical identity. Same approved ATS requisition or exact canonical application target plus consistent employer/role/location can support a high-confidence candidate link. Employer aliases, title, location, employment type, description fingerprint and posting dates supply corroboration, not automatic proof. Conflicting requisitions, reposts, multi-location variants and uncertain employer aliases go to a duplicate-cluster review queue. Never merge solely on a similar title or a model score.

Preserve every observation and its original source metadata. One canonical job owns shortlist/application state; links are reversible through audited split/unlink commands before irreversible actions. A submitted cluster cannot be silently collapsed/split; require explicit owner resolution and retained evidence. Unique observation and run/page idempotency keys prevent duplicates under reruns/concurrency. Changed content produces a new observation plus a reviewable canonical update, never erases history.

Acceptance: same-source reruns create zero extra canonical jobs; cross-source fixture pairs preserve both observations; same IDs across tenants stay separate; ambiguous clusters never auto-merge; changed reposts and conflicting URLs enter review; application state survives link/unlink and crash replay; every correction has reason/actor/version. Candidate values never enter identity computation.

## Eligibility matrix and review model

Every rule must identify **LEGAL LIMIT**, **CANDIDATE PREFERENCE** or **EMPLOYER REQUIREMENT**, its verified evidence, time basis, effective dates, and uncertainty. Store hours/fortnight separately from hours/week and minutes separately from kilometres. Do not infer visa conditions from a visa label or convert a legal fortnight ceiling into a weekly preference. Legal interpretation requires current official policy and owner-validated conditions in a future reviewed change; this blueprint makes no candidate-specific legal determination.

| Dimension                        | Current foundation / problem                                                                    | V1 decision and required tests                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work rights                      | UNKNOWN/valid/unrestricted rules exist; generic extraction does not populate them               | Preserve source wording/modality. Limited valid rights are not unrestricted; unknown evidence routes to review; NONE blocks only an actual applicable requirement                                                       |
| Student visa / legal hours       | Fortnight minimum is compared with a minimum of preference/legal limits only when both verified | Separate legal ceiling, current period, work already performed and owner preference. Missing legal evidence cannot be hidden by missing preference; variable roster and rolling/defined periods require explicit review |
| Weekly/fortnight preference      | Current codes call both limits blockers                                                         | Preferences may rank/filter with an explicit owner-reviewed preference exception; never override a legal restriction. Test equivalent units without implicit conversion                                                 |
| Mandatory qualification          | Verified names and loose substring matching                                                     | Evidence-backed equivalence and recency; exact mandatory absence blocks, unknown requires review; preferred qualification affects fit only                                                                              |
| Licence                          | Mandatory licence checks exist                                                                  | Type/jurisdiction/class/expiry matter; overseas licence is not an Australian licence; negation and training promises are not possession                                                                                 |
| Vehicle                          | REQUIRED / UNKNOWN rules                                                                        | Distinguish commuting ability from employer-required own vehicle; no licence-to-vehicle inference; unknown access stays review                                                                                          |
| Availability / fixed roster      | Mandatory shift overlap checks exist                                                            | Timezone, overnight/week-boundary shifts, date exceptions, commitments and duration; unknown roster cannot become fully available                                                                                       |
| Location / commute               | Generic suburb/distance absent; kilometre preference can hard-block                             | Normalize location with provenance, avoid invented distance/time. Route/geocoder optional and consented; separate mode, distance, duration and uncertainty                                                              |
| Experience                       | Mandatory verified evidence matching exists                                                     | Minimum years/domain and transferability need explicit evidence; no hospitality/POS/cash/kitchen assumption from generic service skills                                                                                 |
| Certifications                   | Some licence-like concepts; no comprehensive modality model                                     | Conditional certification stays conditional; unknown local law/course eligibility does not mean certificate held or universally mandatory                                                                               |
| Physical requirements            | Model fields, no complete evaluator                                                             | No health/physical inference; owner confirmation for an explicit essential demand; disability/accommodation information remains sensitive                                                                               |
| Age requirements                 | No complete evaluator                                                                           | Only explicit, applicable requirement with verified evidence; no age inference from education dates; policy/legal uncertainty pauses                                                                                    |
| Unknown/conflicting requirements | Generic ambiguity reasons, not coverage-aware                                                   | Distinguish not stated, unparsed, contradictory, conditional and verified absent. Empty extracted arrays never certify completeness                                                                                     |

Overrides are separate immutable review events, not edits to original ad/profile evidence: rule ID, evidence versions, classification, owner rationale, expiry and scope. A preference exception cannot waive law or fabricate employer acceptance. Employer exceptions need recorded evidence; unknowns require actual fact confirmation. Changed ad/profile/roster invalidates affected overrides and packet approval. Tests cover all rule classes, expired evidence, negation, conditional RSA, valid versus unrestricted rights, incompatible units and audited revocation.

## Fit calibration

Current `fit-scorer` uses base 50 plus eligibility, location/commute, work type, skills, experience, education, training, category, customer-service and technical contributions, then clamps 0–100. Weights are hand-authored. Location/commute may read preferences without checking verification; the experience pool includes employment without filtering verification. Fix those evidence paths before real tailored claims or trustworthy ranking, using fictional regressions.

Proposed calibration: owner privately labels at least 30 diverse jobs spanning the ten categories, including at least five clear good matches, five clear poor matches and ten ambiguous/edge cases. Keep real labels local; publish only synthetic equivalents and aggregate metrics. Separate tuning and held-out cases. Record pairwise preferences and reason agreement, not fabricated hiring outcomes. Test monotonicity, sensitivity to one fact/weight, category-specific weight changes, duplicate ranking, missing-data coverage and hard-blocker interaction. No INELIGIBLE job may be labelled recommended regardless of score. Missing facts reduce confidence/coverage, not imply skills present or absent. Require owner acceptance of at least 80% held-out pairwise orderings and zero unsupported positive claims; thresholds are proposed acceptance targets, not achieved measurements. Version weights and compare before/after without retroactively changing history. No opaque AI primary matcher.

## CV and deterministic tailoring design

The ten category enums exist, but currently share one renderer and mostly identical selection. `pageLimit` is metadata, not enforced. The truth validator verifies referenced IDs but not semantic entailment of arbitrary claim text; headings/contact/education need uniform coverage. Projects are not a dedicated resume section. File naming removes some characters but needs root confinement, reserved-name/collision handling and no overwrite. No actual personal document was generated in this task.

All categories use verified identity/contact only; summary/skills/experience/projects/education/achievements must carry source fact IDs and exact rendering transformations. Employment/education dates remain unknown when not supplied. Availability/work-right statements are optional and require applicable verified facts and precise conditions; omit sensitive identifiers and referees by default.

| Template                   | Evidence priorities and section order                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| casual-general             | Short role-relevant summary; transferable verified skills; concise experience; education; selected achievements; optional verified availability |
| retail-customer-service    | Verified customer-facing evidence first; relevant skills/experience; education/achievements; POS or cash handling only with direct facts        |
| hospitality-front-of-house | Verified guest-service/team evidence; relevant employment; education; conditional certificate gaps surfaced outside CV, never claimed as held   |
| admin-reception            | Verified communication/organisation/software evidence; administrative responsibilities; education/achievements; no inferred office tenure       |
| warehouse-operations       | Verified operations/logistics/safety evidence; employment; education/certifications; no inferred forklift/licence/lifting capability            |
| technical-casual           | Verified practical technical skills/projects; transferable employment; education; relevant measured achievements                                |
| engineering-general        | Discipline summary; technical skills; relevant projects/employment; education; evidenced achievements; maximum two pages                        |
| robotics-mechatronics      | Verified robotics/mechanical/electrical integration projects and skills; experience; education; evidenced project outcomes                      |
| automation-controls        | Verified controls/automation tools and project evidence; employment; education; no inferred PLC/industrial-site experience                      |
| embedded-systems           | Verified firmware/electronics/languages and projects; experience; education; actual tested outcomes only                                        |

Pipeline: rank explicit requirements by mandatory/preferred/conditional importance -> retrieve VERIFIED evidence -> choose template with a visible override -> prioritise sections -> select/reorder exact or controlled fact-derived bullets -> check every claim against allowed transformations and forbidden claims -> render -> extract text/page/font metadata and check layout -> owner preview. An employer request unsupported by evidence becomes a packet gap, not a creative CV sentence. Unknown/unverified facts never reach output.

ATS acceptance: Australian English; black text; Times-compatible fonts; minimum 10 pt; real bullets, selectable text, no graphics/sidebar/skill bars; casual target one page and engineering maximum two. Trim lower-priority evidence before overflow, never shrink below the font floor or hide text. Test PDF reading order and text fidelity, DOCX paragraph/style structure and PDF/DOCX parity. HTML/PDF foundation remains; a maintained DOCX dependency must be selected and audited in R3, not silently added now. Ten golden fictional layouts plus sparse/long/multilingual-input/forbidden-claim/path-collision cases require manual visual review and automated checks. No screenshots of real documents enter CI.

## Cover letter and application packet

Use exact employer/role from reviewed job evidence. Requirement-aware cover letters choose up to three verified evidence links, omit generic filler and unsupported requirements, and expose direct/warm/formal tone as presentation only. Required/optional/unknown cover-letter status remains tri-state. Owner may skip an unnecessary letter. Default short text preview; PDF/DOCX only when required or requested. All substantive clauses, including transformed prose and headings, pass the same claim validator; retain paragraph-level provenance and approval versions.

Packet contains canonical identity, employer/source, approved application URL/domain, selected CV/version, optional letter/version, required documents, screening questions, known/unknown/review answers, verified availability/work-right statements, salary expectation and notice/start date only if supplied, and private application-specific notes. `VERIFIED_ANSWER`, `USER_CONFIRMATION_REQUIRED`, `UNKNOWN` are explicit; fact confirmation and permission to disclose that fact are separate. Never default an unknown checkbox to YES, claim unrestricted rights, or auto-answer demographic/health/background questions. Persist question text/options/version and owner-confirmed mapping; similar wording is not automatic equivalence across employers. Missing documents, expired evidence and unknown mandatory answers block READY_TO_APPLY.

## Local browser runner and irreversible gate

Proposed local process in `packages/application-runner`, separated from discovery and the web request lifecycle. Only an owner-approved packet/host and explicitly supported fixture-tested form adapter may launch. Use an isolated local browser context; encrypted persistence requires an approved OS-bound key design and recovery policy. No cloud credentials, password storage in SQLite, stealth flags, CAPTCHA services or alternate proxy identities.

Run states: prepared -> opened -> mapped -> filled -> paused/review -> final review -> submitted or outcome unknown. At each navigation/redirect verify domain and policy; inspect form semantics and required fields; map only approved facts; uploads require approved document digest/name/version and target consent. Pause on unknown questions, sensitive answers, unexpected content, login/authentication, CAPTCHA, MFA, bot detection, 401/403/access denial, rate limits or site restrictions. The owner handles legitimate authentication manually and must explicitly resume; the runner never automates auth/protection screens. Changed page/packet invalidates readiness.

Before irreversible submission display employer, role, exact URL/domain, CV and letter filenames/versions, all material answers, unresolved/review fields, work-right and availability statements. Require a fresh, deliberate owner click for this exact frozen snapshot. Use an expiring single-use consent bound to job/packet/domain/form version; recheck no blocking unknowns, file digests and target just before action. No Enter-key implicit submit, prechecked consent, timer, background task or batch approval. Future implementation must distinguish data disclosure during upload/fill from final submission and ask for the appropriate disclosure approval beforehand.

If submit response is lost, persist OUTCOME_UNKNOWN and stop; never automatically retry. Owner reconciles with visible receipt/application history before another attempt. Store a minimal local confirmation reference, not an unredacted page dump. A fixture submission must prove exactly one irreversible click and an expired/changed/replayed consent must produce zero clicks. Actual submission support requires a separately approved target-specific acceptance run.

## Tracking, scheduling, notifications and recovery

Canonical lifecycle: DISCOVERED -> REVIEWING -> SHORTLISTED -> PREPARING -> READY_TO_APPLY -> APPLICATION_IN_PROGRESS -> READY_FOR_FINAL_REVIEW -> SUBMITTED -> ASSESSMENT/INTERVIEW -> OFFER/REJECTED. WITHDRAWN and EXPIRED branch where logically applicable; PAUSED and OUTCOME_UNKNOWN are run states, not successful application outcomes. Backward preparation edits are audited and invalidate readiness. Never reverse a real submission into 'never submitted'; record a correction/withdrawal event. Terminal outcome corrections require owner rationale and retain original history.

Migrate legacy NEW/REVIEWED to DISCOVERED/REVIEWING and APPLIED to SUBMITTED while preserving original status/event evidence. Eligibility labels become a separate axis, not lifecycle shortcuts. Documents/answers/profile/source versions and actor/timestamp belong to every material event. Add durable queue and real `/applications` views; interrupted writes must roll back together. Owner-entered outcomes are distinguishable from source-confirmed ones.

Optional R7 scheduling uses local durable run/cursor checkpoints, per-source leases, dedup/idempotency, explicit retry ceilings and policy-expiry checks. No catch-up request burst after sleep/offline. 429/restrictions pause until policy-approved recovery; repeated auth failures stop. A transactional notification outbox deduplicates `(event, channel, recipient, version)`. Default local dashboard inbox; desktop opt-in contains counts/status only. Email is optional, consented, credentials stored outside Git/SQLite and no sensitive body/attachments by default; no paid provider required. A sleeping/offline PC cannot promise continuous scheduled service.

Structured local logs contain run/import/application IDs, stable codes, timestamps and counts; never ad bodies, full answers, profile snapshots, raw exceptions with request bodies, cookies or credentials. Classify validation/policy/auth/unsupported as non-retryable; bounded transient read errors may retry only within permission. Preserve checkpoint and reconcile committed rows before resuming. Backups use SQLite's consistent snapshot mechanism or stopped-app backup, not a lone live WAL database copy. Restore rehearsals, migration rollback, browser resume and unknown-submission recovery are detailed in the [runbook](RELEASE_RUNBOOK.md). Encryption/retention/incident gaps are in the [threat model](THREAT_MODEL_V1.md).

## UX audit of all eight routes

| Route           | Current evidence / defect                                                                                   | Minimum V1 change and verification                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Stale fixture-only foundation copy; dashboard/profile links work                                            | Describe supported local mode and unsupported actions accurately; direct first-time user to preflight/import                                              |
| `/dashboard`    | Real import counts coexist with fixture priority queue and fixture metrics                                  | Separate demo mode completely; real review queue, unknown/blocked cards, last run/backoff and safe status counts                                          |
| `/jobs`         | Demo and local rows labelled, but no real filters/shortlist and wide table                                  | Real-only default, explicit demo switch, source/evaluation freshness/coverage filters, durable queue actions; mobile card/table alternative               |
| `/jobs/[id]`    | Real description/reasons/provenance visible; fewer controls than fixture detail                             | Full normalized/source comparison, coded reasons, private evaluation state/version, missing-data list, duplicate review and approved preparation controls |
| `/import`       | Real paste/upload preview and confirm; source form resets, excerpt-only preview; title/source labels missed | Full source-side preview, typed field modality/date review, clear reset/retry/expired-token states, retention controls, one-job selection confirmation    |
| `/applications` | Fixture-only empty state, no persisted real packets/outcomes                                                | Canonical application timeline, packet versions, pause/reconcile workflow and explicit empty/loading/error states                                         |
| `/profile`      | Safe loaded/missing/invalid label beside fictional profile facts                                            | Separate demo panel from real status, schema guidance and local validation diagnostics; no automatic full profile display/logging                         |
| `/settings`     | Static safeguards; old phase labels, no operational controls                                                | Explain effective source capabilities, local paths/status without values, backup/retention/policy expiry; locked final-action invariants                  |

Accessibility/mobile are not certified by source inspection or existing happy-path tests. R8 needs keyboard-only flow, focus/error summary, distinct accessible labels without 'Extracted' text ambiguity, screen-reader status announcements, contrasts, 200% zoom, narrow viewport overflow, long-text handling, loading/empty/invalid-profile states and disabled-control explanations. Use fictional data for screenshots/accessibility artifacts. Real run captured no screenshots/traces.

## Deployment decision

Scores are design judgments, 1 poor / 5 favourable for this single owner's needs, not measured service benchmarks.

| Criterion                         | Fully local | Hybrid dashboard/local runner | Fully hosted |
| --------------------------------- | ----------- | ----------------------------- | ------------ |
| Privacy / minimal data movement   | 5           | 3                             | 1            |
| Security scope simplicity         | 4           | 2                             | 1            |
| Low mandatory cost                | 5           | 3                             | 2            |
| Low implementation complexity     | 5           | 2                             | 1            |
| Reliability while owner PC is on  | 4           | 3                             | 4            |
| Unattended scheduled availability | 2           | 4                             | 5            |
| Mobile access                     | 1           | 4                             | 5            |
| Minimal credential exposure       | 5           | 3                             | 1            |
| Low maintenance burden            | 4           | 2                             | 1            |

Recommend fully local, loopback-bound UI + local SQLite + local browser runner, backed by OS account/disk protections and tested local backup. It still requires local-origin/session hardening; loopback alone is not authentication. Hybrid adds device pairing, authenticated encrypted transport, minimal sync schemas and conflict/revocation complexity; if later approved, keep documents/profile/browser credentials local by default. Fully hosted introduces identity/access controls, tenant isolation, key management, data-residency/retention, incident response and browser credential exposure. Neither hosting option is needed for personal V1 and neither is approved here.

## Forward release trains

The following common contract applies to **every** train: update the detailed implementation plan and obtain review/merge before code; use separate feature branches/PRs; fictional automated tests only; full quality gates plus train-specific tests; no private CI artifacts; additive/versioned data changes with approved backups; stop on failed safety gate. Rollback disables the new capability and reverts reviewed code without deleting private data; migrations restore only through an owner-approved tested backup procedure. Each train ends with implementation PR review, not automatic merge. No train grants authority for another source, site or final submission.

### R0 — Local Activation (old Phase 2.5A; foundations 0/1/2/2.5)

- Objective/scope: prove one truthful private local UI import/evaluation, audit privacy and publish the forward blueprint. Dependencies: approved PR8, validated private file, migrated DB, owner input. Non-goals: source fetch, documents, applications or future implementation.
- Architecture/files/data flow: existing web/importer/database/provider -> eligibility/fit; safe plan/docs and existing validator branch work only. Private source and profile remain in ignored local storage; committed evidence is counts/codes/versions.
- Tests/acceptance: one canonical/source/evaluation chain, PRIVATE_LOCAL_PROFILE, no invented facts or external requests, integrity/FKs, zero applications/documents, complete quality/privacy gates. Retained unconfirmed previews are disclosed, not counted as imports.
- Rollback: stop local app; preserve input/DB/audit records; reviewed resolver revert if needed. Complexity S–M; external approval already granted for PR8 merge and one local import. Next gate: human review of this unmerged activation/master-plan PR.

### R1 — Real Discovery (old Phases 2/3/4/5 plus identity parts of 6)

- Objective/scope: one or two approved candidate-blind readers, beginning with Greenhouse/Lever allowlisted tenants; normalized immutable observations, idempotent runs and duplicate candidates. Depends on R0 review and source/tenant policy approval. Non-goals: global crawling, restricted boards, applications.
- Architecture/files/flow: `job-sources` adapters + `job-importer` shared normalization + `database` observations/run checkpoint migration + web discovery review; approved query -> bounded GET -> observation -> canonical/duplicate review. No candidate data outbound.
- Tests/acceptance: source-matrix fixtures and caps, SSRF/redirect/credential/DNS denial, cursor loops, expiry, reruns and owner-approved read-only smoke; every record has provenance; no write request. Rollback: disable source capability, retain observations.
- Complexity M–L. External approvals: employer/terms/robots/use scope and owner tenant allowlist. Human gates: adapter plan and each source capability, then implementation/smoke evidence before enabling scheduled use.

### R2 — Matching Quality (old Phases 6/7/8)

- Objective/scope: typed evidence/modality, canonical duplicate resolution, legal/preference/employer separation, verified-only scoring, calibration and durable real shortlist. Depends on R0 evidence; uses R1 observations when available, with local-import fixtures usable independently. Non-goals: inferred candidate facts or AI scoring.
- Architecture/files/flow: `job-model`, `job-importer`, `job-normalizer`, `candidate-profile`, `eligibility-engine`, `fit-scorer`, `database`, jobs/dashboard UI; source/profile versions -> typed requirements -> eligibility -> coverage/score -> audited owner review. Private evaluation never joins public source requests.
- Tests/acceptance: complete eligibility matrix, false entitlement/conditional certification regressions, verified experience filter, ambiguous dedup review, provenance enum survives redaction, no INELIGIBLE recommendation, calibration targets above. Rollback: pin earlier rule/weight versions, mark newer evaluations stale, preserve review events.
- Complexity L. External approvals: current official legal-policy evidence when modelling legal rules; owner-labelled golden cases and preference semantics. Human gates: rule/data-migration review, calibration review, then implementation PR.

### R3 — Documents (old Phases 9/10/11)

- Objective/scope: ten fact-bound templates, deterministic tailoring, optional concise letters, private PDF/DOCX export and layout/claim validation. Depends on R2 evidence semantics and approved schema/template design. Non-goals: unsupported claims, AI generation or external upload.
- Architecture/files/flow: `resume-engine`, `cover-letter-engine`, `candidate-profile`, `database` artifact records, web private preview/export and fictional fixtures; approved evidence -> selected claims -> rendered artifact -> automated checks -> owner preview. Files remain confined to ignored private output roots.
- Tests/acceptance: all ten layouts, minimum font/page/text constraints, arbitrary text with a valid fact ID rejected, forbidden claims checked in every field, path traversal/collision and unverified facts fail closed; no real output in CI. Rollback: disable export/version, retain approved old artifacts; never overwrite silently.
- Complexity L. External approvals: owner template/style acceptance, audited DOCX dependency choice, artifact privacy review. Human gates: template/claim design then rendered fictional examples and implementation review.

### R4 — Application Preparation (old Phase 12)

- Objective/scope: durable packets, tri-state answers, required-document checklist, known/unknown/review UX and versions. Depends on R2/R3; local/manual preparation works without network. Non-goals: browser operations or submit.
- Architecture/files/flow: `application-runner` preparation/answer contracts, candidate/job models, packet/question migrations and `/applications` UI; canonical job + approved documents + confirmed facts -> versioned packet -> owner review. Questions/notes/answers remain local.
- Tests/acceptance: missing/expired documents and unknown required answers block readiness; salary/start/work-right answers exist only when supplied/verified; job/profile changes invalidate packets; disclosure consent is separate from truth verification. Rollback: disable packet promotion, preserve drafts/versions.
- Complexity M–L. External approvals: owner question mapping and sensitive-data disclosure preferences. Human gates: packet/answer schema plan then implementation review; no implicit consent to upload.

### R5 — Assisted Browser Filling (old Phase 13; explicit final gate added)

- Objective/scope: one approved target-specific local form adapter, pause/resume, approved uploads, final review and one-use owner submission gate. Depends on R2–R4, mandatory R11 origin/session/secrets controls and target terms approval. Non-goals: auth automation, universal forms, restricted-site bypass, batch/background submission.
- Architecture/files/flow: isolated `application-runner` process, supported form adapters, local session-key integration, run/checkpoint/consent migration and review UI; frozen packet -> field mapping -> disclosure-approved fill -> final review -> fresh consent -> at most one submit -> reconciliation. Sessions/documents never enter cloud/Git.
- Tests/acceptance: CAPTCHA/MFA/bot/access/rate/page-change stops, unknown answer pause, upload digest check, domain change invalidation, zero pre-consent submits, exactly one fixture submit, lost response -> OUTCOME_UNKNOWN with no retry; owner-approved target smoke separately.
- Rollback: revoke consent/disable adapter, stop browser, preserve encrypted checkpoint for owner recovery. Complexity XL. External approvals: source/tenant application policy, owner disclosure and exact final action. Human gates: runner/threat model, fixture proof, target-specific smoke and every real final submission.

### R6 — Tracking (old Phases 14/17)

- Objective/scope: durable canonical queue, full application timeline/outcomes, minimal counts and recovery/reconciliation; not outcome prediction. Depends on R4 and R5 events, with manual owner events supported. Non-goals: inbox scraping or inferred success.
- Architecture/files/flow: `application-tracker`, job/application enums, database lifecycle migration, dashboard/applications UI; user/runner event -> validated transition -> atomic audit/projection -> local timeline. Profile/document/source versions remain local.
- Tests/acceptance: legacy mapping, invalid/duplicate transitions, out-of-order events, ambiguous submission, reversible preparation but irreversible submission history, crash/transaction replay and consistent metrics. Rollback: read-only timeline mode with retained event log; approved backup for migration rollback.
- Complexity M. External approval: owner-defined outcome semantics; no external mailbox integration authorised. Human gates: state-machine/migration plan and implementation review.

### R7 — Scheduling / Notifications (old Phases 15/16; optional after V1)

- Objective/scope: owner-opted local approved-source schedules, safe local/desktop alerts; email optional. Depends on R1/R6 and operational/privacy gates. Non-goals: scheduled application filling/submission, paid mandatory services, restricted-source requests.
- Architecture/files/flow: proposed local worker under scripts or a separately approved scheduling package, DB leases/checkpoints/outbox, settings UI; schedule -> permission/budget -> discovery -> dedup events -> redacted notification. Source receives no candidate profile; notification excludes job/candidate specifics by default.
- Tests/acceptance: sleep/offline recovery, clock/DST, duplicate leases/pages/alerts, bounded retries, 429 pause, revoked permissions, policy expiry and no catch-up bursts. Rollback: disable schedules/outbox delivery while retaining cursors.
- Complexity M. External approvals: owner OS scheduling/desktop permission and optional email provider/account consent. Human gates: worker/channel design and implementation; opt-in required per source/channel.

### R8 — Personal Live V1 Release Candidate (cross-cutting release gate)

- Objective/scope: ship the scoped personal journey with one supported discovery and application path, tested local operations and truthful UX. Depends on R0–R6 and all mandatory security gates; R7 is not required. Non-goals: hosted SaaS, universal source coverage.
- Architecture/files/flow: release scripts/runbook/checklist, web route UX, CI gate extensions and packaging manifest; audited source/docs -> quality/build/privacy -> fictional E2E -> scoped owner smoke -> reviewed release. Runtime assets excluded from build/package.
- Tests/acceptance: full [test matrix](GO_LIVE_CHECKLIST.md), all routes/a11y/mobile/error states, clean install, no demo leakage into real calculations, page/claim checks, backup/restore and interruption drill, zero unresolved critical/high safety findings, approved supported-site list and final gate.
- Rollback: retain previous code/build and consistent private backup; disable readers/runner first, never replay submit. Complexity L. External approvals: owner acceptance and source-specific scopes. Human gates: release-plan review, evidence review, explicit release authorisation.

### R9 — Optional AI (old Phase 18)

- Objective/scope: opt-in redacted wording assistance/search over approved evidence, never primary eligibility/fit or autonomous action. Depends on deterministic R2–R4 and mature safety tests. Non-goals: inferred facts, provider-required core, uploading full private stores.
- Architecture/files/flow: proposed provider-neutral package after plan approval; consented minimal evidence -> isolated provider -> untrusted draft -> deterministic claim validator -> human preview. Provider errors fall back to local operation.
- Tests/acceptance: malicious ad prompt injection, exfiltration requests, unsupported claims, quotas/cost limits, cancellation and offline fallback; no tool authority from generated text. Rollback: disable provider and revoke local credentials separately with owner consent.
- Complexity M–L. External approvals: provider privacy/retention/terms/cost and exact outbound-data consent. Human gates: provider/threat-model plan and implementation; no current AI connection enabled.

### R10 — Optional Hosted / Hybrid Deployment (old Phase 19)

- Objective/scope: only owner-approved minimal remote dashboard/pairing if a real need emerges. Depends on R8 and expanded R11 threat model. Non-goals: moving browser credentials or documents to cloud by default, multi-user SaaS without new approval.
- Architecture/files/flow: separately designed auth/pairing/sync service, minimal schema, deployment/IaC and revocation UI; local redacted event -> authenticated encrypted sync -> remote view. Full hosted option requires another reviewed architecture, not a switch.
- Tests/acceptance: authz/tenant isolation, device revocation/replay, offline conflicts, secrets/durable backup, data deletion/retention and rollback; penetration review before internet exposure. Rollback: revoke pairing and disable sync while local core remains usable.
- Complexity XL. External approvals: hosting account/spend, data residency/privacy obligations, explicit transmitted fields. Human gates: topology/security/cost review, staging review, separate deployment authorisation.

### R11 — Production Security Hardening (old Phase 20; mandatory baseline throughout)

- Objective/scope: implement threat-model mitigations, local origin/session protection, artifact/secret boundaries, dependency policy, incident response and tested recovery. Depends on each train's assets; starts before new risky capability, not after release. Non-goals: weakening controls to make tests pass.
- Architecture/files/flow: web action middleware/session boundaries, local runner key storage, database/retention tooling, build/privacy scripts and `.github/workflows`; untrusted input -> allowlisted/redacted boundary -> least-privilege storage/output.
- Tests/acceptance: all [threat-model](THREAT_MODEL_V1.md) cases, CSRF/DNS rebinding/SSRF/XSS/traversal, fixture credential canaries, build/trace/map/CI audits, permission and restore checks, dependency review; no unresolved critical/high exposure or irreversible-action defect.
- Rollback: disable affected capability/stop local services, preserve encrypted evidence/backups, revoke exposed credentials only with appropriate owner authority; public Git copies cannot be recalled. Complexity L ongoing. External approvals: owner security choices; independent security review before hosted production. Human gates: mitigation plan, security evidence review, residual-risk acceptance.

## Old-to-new map and next decision

| Historical phases   | Forward home                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| 0, 1, 2.5, 2.5A     | R0 foundation/activation; deficiencies carried into R2/R8/R11             |
| 2, 3, 4, 5          | R1 source strategy, reordered by current permission evidence              |
| 6                   | R1 observation identity + R2 canonical duplicate review                   |
| 7, 8                | R2 eligibility / calibration                                              |
| 9, 10, 11           | R3 documents / tailoring / letters                                        |
| 12                  | R4 packet and answers                                                     |
| 13                  | R5 browser and explicit final-action gate                                 |
| 14, 17              | R6 tracking and minimal reproducible metrics; advanced analytics optional |
| 15, 16              | R7 scheduling and notifications                                           |
| 18, 19, 20          | R9 optional AI, R10 optional deployment, R11 security throughout          |
| No single old phase | R8 measurable personal release candidate                                  |

Next human decision: review the activation evidence, limitations, source order, local topology, release boundaries and all R0–R11 gates; merge this activation/master-plan PR only if accepted. Then authorise a narrow implementation task, preferably R2 normalization/matching safety repairs before scaling real intake, alongside a separately scoped R1 source plan where permission is established. Do not interpret blueprint acceptance as bulk permission to implement every train or submit applications.
