# R2 matching quality implementation blueprint

Status: `PLAN_ONLY_AWAITING_HUMAN_REVIEW`

Baseline: merged Manual-intake Personal Beta at `4a0462d24b9a8db79ec49ff64242405d8f96f40d`

Release boundary: no source activation, employer-form operation, upload, or submission is authorised by this plan.

## Objective and acceptance boundary

R2 makes normalization, eligibility, ranking, duplicate handling, and queue decisions trustworthy enough for repeated owner-reviewed use. It does not infer candidate facts, decide legal eligibility, predict hiring outcomes, or turn a high fit score into permission to apply. R2 must work from owner-supplied local jobs before R1 is enabled and must accept R1 observations later without changing its truth rules.

R2 is complete only when:

- every material normalized value has an explicit evidence state and immutable source span or owner-correction record;
- required, preferred, conditional, negated, conflicting, and unknown requirements remain distinct through persistence, evaluation, scoring, and UI;
- legal limits, employer requirements, and candidate preferences cannot silently substitute for one another;
- only verified candidate facts contribute positive fit points;
- unknown, conditional, and conflicting evidence cannot produce a positive match or a recommendation;
- duplicate suggestions never auto-merge ambiguous jobs and every link/split decision is reversible and audited;
- queue decisions bind the current job, profile, eligibility, and scorer versions and become visibly stale when any input changes;
- a fictional golden corpus and a private, owner-labelled calibration protocol meet the gates below; and
- the full synthetic, migration, privacy, and exact-head CI matrix passes before a separate implementation PR is offered for review.

## Evidence and modality model

Evidence state and requirement modality are separate axes. The proposed `JobEvidenceState` is:

| State             | Meaning                                                                                                                                | Evaluation rule                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE_STATED`   | The source explicitly states the value in a retained span/path. This records what the ad says, not that the claim is objectively true. | May drive a rule only with the applicable modality and sufficient structure.                                                                    |
| `OWNER_CORRECTED` | The owner deliberately replaces or clarifies a normalized value. Original source evidence remains immutable.                           | Current owner value takes presentation/evaluation precedence; correction actor, reason, prior version, and changed fields are retained locally. |
| `DERIVED`         | A deterministic, versioned rule derives the value from one or more stated/corrected inputs.                                            | Cannot increase certainty or requirement strength; stores rule/version and input evidence IDs.                                                  |
| `UNKNOWN`         | No supported value is available, parsing is incomplete, or absence is not meaningful.                                                  | Never treated as false or satisfied; material fields route to review.                                                                           |
| `CONDITIONAL`     | The value applies only when a retained condition is met.                                                                               | Never collapsed to required or satisfied until the condition is resolved from supported evidence.                                               |
| `CONFLICTING`     | Current evidence contains incompatible supported assertions.                                                                           | Stops dependent eligibility, fit recommendation, preparation, and auto-linking pending owner resolution.                                        |

The proposed independent `RequirementModality` remains `REQUIRED | PREFERRED | CONDITIONAL | NEGATED | UNKNOWN`. A conditional requirement stores bounded condition text/span and may also have evidence state `SOURCE_STATED`; the state `CONDITIONAL` is reserved for a field whose value itself is conditional. `NEGATED` never becomes a positive requirement. Words such as “may”, “where applicable”, “depending on”, “desirable”, “or equivalent”, and scoped headings must be tested as grammar, not keyword counts.

Every `JobFieldEvidence` / `RequirementEvidence` record must contain:

- stable evidence ID, job observation/version ID, canonical field, evidence state, modality where applicable;
- exact bounded source path plus character offsets or structured source path;
- raw evidence digest and a bounded local display excerpt, never public logs;
- normalized value JSON validated by the field schema;
- extractor/rule/version, confidence for diagnostic ordering only, and derivation input IDs;
- owner correction ID/reason when applicable; and
- conflict-set ID when current assertions disagree.

Precedence is explicit: unresolved `CONFLICTING` stops; the latest valid `OWNER_CORRECTED` value is current while source history remains; `SOURCE_STATED` follows; `DERIVED` is usable only while all inputs remain current; `UNKNOWN` never supplies a value. Parser confidence must not override this precedence.

### Material field inventory

No material field is exempt from the state/provenance contract:

| Field family | Required typed representation                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity     | Title and employer retain stated/corrected text, normalized comparison value, source path/span, and conflict set. Display normalization never becomes cross-source proof by itself.                                                                                                                                                   |
| Geography    | Location alternatives, suburb/locality, state/territory, postcode, country, workplace type, and remote scope each carry state/evidence.                                                                                                                                                                                               |
| Employment   | Employment type(s), contract/fixed-term facts, hours per week, hours per fortnight, shifts, recurring roster, timezone, and flexibility carry value/unit/state/evidence.                                                                                                                                                              |
| Compensation | Amount/range/qualifier, currency, period including `UNKNOWN`, super/bonus/commission qualifiers, and exact source evidence.                                                                                                                                                                                                           |
| Dates        | Posted, updated, closing/expiry, and expected start dates each retain value, precision, timezone, evidence, and derivation rule. Relative dates derive only from an immutable observed-at time; otherwise `UNKNOWN`.                                                                                                                  |
| Capabilities | Skills, experience, education, licences, certifications, training, alternatives/equivalence, recency/expiry/jurisdiction where stated, modality, condition, and evidence.                                                                                                                                                             |
| Constraints  | Vehicle ownership/use, work rights/sponsorship/hours/expiry, travel, physical requirements, and explicitly stated age requirements remain separate propositions. Physical/age claims never infer candidate ability or affect fit; potentially unlawful/discriminatory wording routes to owner/legal review, not an automatic blocker. |
| Documents    | CV/resume, cover letter, selection criteria, portfolio, transcript, licence/certificate copy, and any other named attachment use tri-state requirement plus evidence.                                                                                                                                                                 |

Empty lists mean only “no typed items extracted at this parser version”. Each family also records coverage (`COMPLETE | PARTIAL | UNKNOWN`) and unparsed material spans, so an empty list can never prove the source contains no requirement.

## Canonical field contracts

### Australian geography

Represent location as a list of structured alternatives rather than one optimistic string:

- `rawLabel`, `countryCode`, `stateOrTerritory`, `postcode`, `locality`, `suburb`, `workplaceType`, and `remoteScope` each carry evidence state and evidence IDs;
- states accept canonical `ACT | NSW | NT | QLD | SA | TAS | VIC | WA` plus deterministic full-name aliases, case-insensitively;
- locality without supported state remains locality + `UNKNOWN` state, never a guessed capital/state;
- comma/slash/“or” multi-location ads preserve separate alternatives; a national/remote ad is not assigned a suburb;
- `REMOTE`, `HYBRID`, `ON_SITE`, `FIELD_BASED`, and `UNKNOWN` are distinct workplace types;
- postcode/state contradictions become `CONFLICTING`; no geocoding or distance is invented;
- commute distance/minutes are candidate-aware evaluation inputs, never normalization facts. Kilometres and minutes remain distinct units.

### Employment, hours, and schedule

Use `FULL_TIME | PART_TIME | CASUAL | CONTRACT | TEMPORARY | FIXED_TERM | INTERNSHIP | APPRENTICESHIP | VOLUNTEER | OTHER | UNKNOWN`, with multiple explicit values retained and incompatible single-value claims marked conflicting. An employment token in benefits, experience history, or generic prose is not enough: source-structured fields, labelled values, or correctly scoped headings/sentences are required.

Hours retain minimum/maximum, unit (`DAY | WEEK | FORTNIGHT | MONTH`), ordinary/overtime status, and stated period. Schedule evidence retains days, start/end local times, timezone, fixed/flexible/on-call/rotating state, overnight flag, and exceptions. Unknown period or timezone remains unknown. No weekly/fortnightly conversion occurs until units and applicable legal/profile limits are explicit.

### Salary

The canonical salary object is nullable only when salary is not mentioned. A mentioned but incomplete salary uses explicit unknowns:

- amount shape `EXACT | RANGE | FROM | UP_TO | APPROXIMATE | UNKNOWN`;
- `minimum`, `maximum`, `currency`, and `period: HOUR | DAY | WEEK | FORTNIGHT | MONTH | YEAR | UNKNOWN`;
- `superannuation: INCLUDED | EXCLUDED | PLUS | UNKNOWN`, commission/bonus flags, and evidence state;
- structured source values take precedence over text-derived values but conflicts are retained; and
- no annual/YEAR default is permitted unless the source states an annual period or an approved source schema defines it unambiguously.

Salary is a ranking/display signal only unless a separately reviewed owner constraint explicitly says otherwise. Unknown salary must not reduce eligibility or imply zero.

### Documents

Canonical document requirements use `REQUIRED | NOT_REQUIRED | UNKNOWN` independently for CV/resume, cover letter, selection criteria, portfolio, transcripts, licences, and other named documents. `UNKNOWN` may not be serialized as `true` or `false`. Runner/packet code consumes the same tri-state contract; required blocks when absent, not-required does not request an artifact, and unknown requires owner review before preparation.

### Typed requirements

Licences retain exact name/class, jurisdiction, expiry requirement, alternatives, modality, and condition. Education retains level, field, equivalence, completion/current-study allowance, modality, and condition. Experience retains domain/task, minimum/maximum amount, unit, recency, modality, and condition. Skills retain normalized label, kind, proficiency/recency only if stated, modality, and source span. Work rights distinguish `VALID_AUSTRALIAN_WORK_RIGHTS`, `UNRESTRICTED_WORK_RIGHTS`, visa/citizenship/sponsorship statements, hours/expiry conditions, and unknowns; “valid” must never become “unrestricted”. Vehicle ownership, driver licence, travel, and commute are separate propositions.

## Eligibility semantics

`EvaluationEvidenceClass` remains `LEGAL_LIMIT | EMPLOYER_REQUIREMENT | CANDIDATE_PREFERENCE`, but R2 enforces these outcomes:

| Class                  | Supported negative/conflict                                                                                                                                             | Unknown/conditional                                       | Positive/satisfied                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `LEGAL_LIMIT`          | `INELIGIBLE` only for a deterministic, current verified conflict with a modelled rule; otherwise stop/review. Not legal advice.                                         | `REVIEW_REQUIRED`; condition must be resolved.            | Removes only that rule's blocker; never proves general eligibility.                |
| `EMPLOYER_REQUIREMENT` | `INELIGIBLE` for a verified mandatory mismatch; preferred gaps do not block.                                                                                            | `REVIEW_REQUIRED` when material and required/conditional. | Supported match may contribute to fit only under the verified-only contract.       |
| `CANDIDATE_PREFERENCE` | Never labels the candidate legally/employer-ineligible. A separately explicit owner hard constraint may yield `OWNER_CONSTRAINT_MISMATCH`, not an employer/legal claim. | Display/review; no fabricated blocker.                    | May influence ordering only when the preference signal itself is verified/current. |

Blockers take precedence, but a blocker from one class must name that class. A score can never clear `INELIGIBLE`, `REVIEW_REQUIRED`, stale evaluation, insufficient extraction coverage, or unresolved conflict. Overnight schedules, multiple alternatives, licence jurisdiction/expiry, work-right hours/expiry, kilometres versus minutes, and conditional certifications require explicit regressions.

## Verified-only scoring contract

R2 replaces the apparent-precision baseline with versioned, evidence-gated contributions:

1. Candidate inputs must be `VERIFIED` and belong to the evaluation's current profile version. `UNKNOWN`, `UNVERIFIED`, stale, or conflicting candidate signals contribute zero positive points.
2. Job inputs must resolve from current `SOURCE_STATED`, `OWNER_CORRECTED`, or valid `DERIVED` evidence. `UNKNOWN`, unresolved `CONDITIONAL`, and `CONFLICTING` evidence contributes zero and is shown as a coverage gap.
3. Required and preferred matches are weighted separately. Missing evidence is not a mismatch; verified mismatch and unknown each have distinct explanations.
4. Legal status and protected/sensitive identity fields never contribute to fit. Legal rules remain eligibility gates. Candidate preferences may contribute only with verified preference provenance.
5. Every contribution stores stable code, signed integer points, field/evidence IDs, evidence class, scorer/weight version, and a safe explanation template.
6. `recommended=true` requires `ELIGIBLE`, current inputs, zero unresolved material conflict, and the approved minimum extraction coverage; score alone is insufficient.

The first R2 score remains an owner-review ordering aid, not a probability or automated decision. The UI must display coverage and uncertainty adjacent to the score and avoid “X% match” language.

## Calibration and golden corpus

Calibration proceeds without publishing private job/profile values:

- Create a versioned fictional corpus covering retail, hospitality, administration, customer service, engineering internships, health/licensed roles, ambiguous conditions, remote/multi-location roles, sparse ads, and duplicates.
- For every case record expected eligibility class/status, material unknowns, allowed contribution directions, duplicate result, and ordinal relevance band (`STRONG_REVIEW | POSSIBLE_REVIEW | LOW_PRIORITY | DO_NOT_RECOMMEND`).
- Maintain a separate ignored private owner-labelled set. Store labels and results locally; publish only aggregate counts and pass/fail criteria, never text, profile facts, employer names, scores for a real job, or row-level errors.
- Before calling weights calibrated, require at least 30 independently reviewed private cases spanning at least four role families and every status. Until then label the scorer `UNCALIBRATED`.
- Gates: 100% blocker safety; 100% no-positive-points from unverified facts; 100% determinism; score bounds; monotonicity for isolated verified signals; no recommendation for review/ineligible/stale/low-coverage cases; no cross-category leakage; and owner review of every changed golden ranking.
- Report ordinal agreement and top-k review utility with confidence intervals only after the sample gate. Never optimize on protected attributes or treat an application outcome as ground-truth merit.

## Duplicate and canonical job lifecycle

An immutable source observation remains separate from a canonical job. Current database states `SUGGESTED | LINKED | REJECTED | SPLIT` are retained; UI adds the explicit no-cluster state `DISTINCT` without rewriting history.

- Same `(source, region, tenant, externalId)` is an idempotent observation identity, not cross-tenant identity.
- A matching ATS requisition or exact canonical application target plus consistent employer/title/location may create a `SUGGESTED` link. Similar title, employer alias, text fingerprint, or date alone never auto-links.
- Only the owner can move `SUGGESTED -> LINKED` or `SUGGESTED -> REJECTED`. `LINKED -> SPLIT` is reversible and retains the prior decision/evidence.
- Every source observation and version remains queryable locally after link/split. Submitted application history is never moved or collapsed silently.
- Conflicting requisition, destination, employer, location, employment, or active/expired evidence blocks auto-link and enters the review queue.
- Import and discovery reruns use unique observation/page keys and transactional upsert; crash replay creates neither a second canonical job nor a lost observation.

R2C must connect `compareCrossSourceObservations()` to durable cluster candidates and owner actions; a tested helper alone is not operational deduplication.

## Queue, corrections, and audit

The durable queue retains `REVIEWING | SHORTLISTED | SKIPPED | PREPARING`, plus owner-facing reason labels. Each decision binds `jobVersionId`, `profileVersionId`, `eligibilityResultId/version`, `fitScoreId/version`, extraction coverage version, duplicate resolution version, actor, time, and reason. Any changed input marks the decision `STALE` and prevents `PREPARING` until the owner sees and confirms a current evaluation. Archive/review-later remain reasoned projections, not destructive deletion.

Corrections are immutable overlays. R2 expands correction UI/schema beyond title/company/location/category to typed location, employment, salary, schedule, document, and requirement fields. It shows source value, corrected value, state/modality, affected rules, and invalidated downstream records before confirmation. Correction does not mutate source text/evidence or weaken a requirement merely to raise a score.

Audit metadata is event-specific and allowlisted. Proposed safe events include normalization completed/ambiguous, correction recorded, evaluation completed/stale, duplicate suggested/linked/rejected/split, queue decision/stale, and calibration run completed. Public-safe metadata is limited to opaque local IDs, enums, versions, rule/error codes, counts, booleans, and timestamps. No source body, excerpt, candidate value, URL with query/userinfo, cookie/header/token, private path, document content, or free-form correction reason enters logs/CI. Event schema validation rejects extra/nested keys rather than relying on regex redaction.

## Additive persistence and compatibility

R2A proposes the next unused additive migration (expected `0003_r2_matching_quality.sql` at implementation time); migration `0002` is immutable. Final columns/tables are reviewed before SQL is written:

- add explicit evidence-state, modality, condition, structured-value, derivation-input, conflict-set, and current/superseded fields to versioned evidence storage;
- add structured normalized job fields without deleting legacy JSON/boolean columns;
- add evaluation coverage/scorer-calibration state and version bindings;
- add durable duplicate candidate/decision evidence and queue-decision snapshot/staleness records; and
- add typed audit event/version metadata where existing storage cannot express it safely.

Proposed reviewed schema shape (names remain proposals until the R2A migration review):

| Table/change                                             | Keys and constraints                                                                                                                                      | Indexes / purpose                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `job_field_evidence_v2`                                  | PK `id`; FKs to job version/source observation/owner correction; CHECK field/state enums, confidence bounds, and ordered non-negative offsets             | `(job_version_id, field_name, is_current)` and `conflict_set_id` for current resolution/review |
| `requirement_evidence_v2`                                | PK `id`; FKs to job version/source observation/owner correction; CHECK kind/modality/state enums and offsets; condition required for conditional modality | `(job_version_id, kind, modality, is_current)` and source observation for rule/review lookup   |
| `evidence_derivations`                                   | Composite PK `(evidence_id, input_evidence_id)`; both FKs restrict deletion; CHECK IDs differ                                                             | input index for stale propagation                                                              |
| `job_normalization_coverage`                             | PK/FK `job_version_id`; CHECK each family state and percentage/count bounds; extractor version required                                                   | coverage-state index for the review queue                                                      |
| duplicate cluster evidence / existing cluster extensions | FKs to cluster and left/right observations; CHECK signal/decision enums and score bounds; unique ordered observation pair + detector version              | unresolved-cluster and observation indexes                                                     |
| `queue_decision_versions`                                | PK `id`; FKs to job/job version/profile version/eligibility/fit/duplicate decision; CHECK queue/freshness/reason enums; immutable rows                    | current decision per job and stale-state review                                                |
| evaluation/fit extensions                                | Add coverage, evidence-contract, calibration, and rule/weight version references; CHECK status/calibration enums                                          | current evaluation by job/profile/version                                                      |

All FKs are explicit and deletion is `RESTRICT` except existing parent lifecycle rules already reviewed. Unique “current” projections are maintained transactionally and tested under concurrency; immutable history rows are never cascade-deleted merely to roll back a feature.

Backfill is conservative: legacy booleans/text map only when their historical meaning is provable; otherwise state is `UNKNOWN`. Legacy cover-letter `false` does not prove `NOT_REQUIRED`. Old evaluations/scores are retained and marked superseded/stale, not recomputed during migration. Migration requires preview, a verified ignored backup, row-count/FK/integrity/mapping checks, and restore rehearsal. No startup auto-migration and no destructive down-migration.

## UI contract

- `/jobs` adds current/stale state, coverage, unknown/conditional/conflict counts, duplicate review state, and version-bound shortlist controls.
- `/jobs/[id]` groups “source says”, “owner corrected”, “derived”, “unknown”, “conditional”, and “conflicting” evidence with accessible text, not colour alone.
- Each eligibility reason shows evidence class and current evidence links. Preferences are never presented as employer/legal disqualification.
- Fit shows contributions, verified fact provenance, coverage, scorer/calibration version, and uncalibrated label; no percentage/predictive wording.
- Duplicate review compares bounded structured fields and source references; link/reject/split requires nonce-bound confirmation and displays application-history impact.
- Queue rows expose freshness, unknown/conflict counts, duplicate state, and last owner decision. Stale decisions cannot advance to preparation.
- Corrections provide typed controls, before/after review, reason code, and downstream invalidation warning without exposing the full private profile.
- `/dashboard` reports queue counts by current eligibility/coverage/duplicate state and marks scorer calibration honestly; it does not expose candidate values or imply automated suitability.
- Empty/loading/invalid/error states, keyboard use, screen-reader status, 200% zoom, narrow viewport, and long untrusted text are mandatory browser cases.

## Current defect disposition

`FIX_IN_R2` means an implementation slice below owns the gap. `ALREADY_FIXED` means the named defect is no longer present at the merged baseline, although broader R2 work may remain. `DEFER` names a different release train and is not hidden as R2 completion.

| Known defect                                                                              | Disposition     | File/function evidence and boundary                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary headings are not extracted reliably                                              | `FIX_IN_R2`     | `packages/job-importer/src/single-job-parser.ts:label` expects colon labels and `section` recognizes a narrow heading form. R2A adds scoped heading grammar and adversarial fixtures.                                                                            |
| Structured duties/requirements are incomplete                                             | `FIX_IN_R2`     | `single-job-parser.ts:section/parseSingleJob` and `beta-extraction.ts:extractBetaJobEvidence` do not consume all source-structured sections/lists. R2A maps source paths before text fallback.                                                                   |
| Schedule/hours extraction is incomplete                                                   | `FIX_IN_R2`     | `beta-extraction.ts:extractBetaJobEvidence` currently emits a fixed empty `schedule`; hours patterns are narrow. R2A adds units, shifts, recurrence, flexibility, timezone, and overnight state.                                                                 |
| Geography/date extraction is incomplete                                                   | `FIX_IN_R2`     | `beta-extraction.ts:normalizeAustralianLocation` is single-label/conservative and `single-job-parser.ts:parseSingleJob` mainly uses structured `datePosted`. R2A adds alternatives/conflicts/remote and typed posted/updated/close/start dates without guessing. |
| Broad audit redaction drops safe `profileState`                                           | `ALREADY_FIXED` | `packages/database/src/job-import-repository.ts:audit` now uses event-specific key allowlists including `profileState`. R2C replaces remaining broad `JobDiscoveryRepository.redactMetadata` behavior with typed event schemas.                                  |
| Generic licence fields are incomplete                                                     | `FIX_IN_R2`     | `packages/job-importer/src/beta-extraction.ts:extractBetaJobEvidence` uses narrow licence keywords and does not fully type class, jurisdiction, alternatives, or expiry. R2A owns it.                                                                            |
| Generic education fields are incomplete                                                   | `FIX_IN_R2`     | `extractBetaJobEvidence` uses narrow qualification keywords and does not fully type field, level, equivalence, or current-study conditions. R2A owns it.                                                                                                         |
| Generic experience fields are incomplete                                                  | `FIX_IN_R2`     | `extractBetaJobEvidence` primarily captures simple required numeric years and lacks recency/alternatives/preferred/conditional structure. R2A owns it.                                                                                                           |
| Generic skill fields are incomplete                                                       | `FIX_IN_R2`     | `extractBetaJobEvidence` depends on a limited requirement-kind classifier and does not preserve the complete structured/source list. R2A owns it.                                                                                                                |
| Work-right extraction is incomplete                                                       | `FIX_IN_R2`     | `extractBetaJobEvidence` recognizes a narrow valid/unrestricted rule set; visa/sponsorship/conditional/hour/expiry claims are not fully represented. R2A/R2B own extraction and rules.                                                                           |
| Full Australian state names fail normalization                                            | `ALREADY_FIXED` | `packages/job-importer/src/beta-extraction.ts:normalizeAustralianLocation` maps all eight full names and abbreviations. R2A still adds multi-location/conflict structure.                                                                                        |
| Salary text silently defaults to YEAR                                                     | `ALREADY_FIXED` | `packages/job-importer/src/beta-extraction.ts:extractSalary` returns `null` without an explicit period. R2A adds an explicit `UNKNOWN` period for a mentioned incomplete salary.                                                                                 |
| Cover-letter `UNKNOWN` collapses to false                                                 | `FIX_IN_R2`     | `packages/database/src/job-import-repository.ts:toCanonicalJob` and `packages/job-model/src/index.ts` serialize canonical document requirements as booleans. R2A replaces that consuming contract with tri-state fields.                                         |
| Employment type scans unrelated prose                                                     | `FIX_IN_R2`     | `packages/job-importer/src/single-job-parser.ts:employmentType` falls back to whole-record token scanning. R2A restricts evidence scope and supports conflicts/multiple types.                                                                                   |
| Empty requirement arrays appear complete                                                  | `FIX_IN_R2`     | `packages/job-importer/src/requirement-evidence.ts:requirementCoverage` counts only recognized candidates; sparse/unrecognized prose can overstate coverage. R2A adds field/section coverage and material unknown gates.                                         |
| Fit uses unverified employment history                                                    | `ALREADY_FIXED` | `packages/fit-scorer/src/index.ts:scoreJobFit` filters employment records to `VerificationStatus.VERIFIED`. R2B locks this with evidence-ID regressions.                                                                                                         |
| Fit uses unverified preference signals                                                    | `ALREADY_FIXED` | `scoreJobFit` gates locations, work types, and categories through `preferences.signalVerification`. R2B adds current-version/evidence-state binding.                                                                                                             |
| Legal limits, preferences, and employer requirements still affect outcomes inconsistently | `FIX_IN_R2`     | `packages/eligibility-engine/src/index.ts` already emits the three evidence classes, but preference severity and current-evidence semantics are incomplete. R2B makes the classification operational.                                                            |
| Cross-source dedup exists only as a helper                                                | `FIX_IN_R2`     | `packages/job-normalizer/src/cross-source-dedup.ts:compareCrossSourceObservations` and tests implement conservative decisions, but no production caller persists review candidates. R2C connects it durably.                                                     |

Audit total: **19 matching defects** — 14 `FIX_IN_R2`, 5 `ALREADY_FIXED`, and 0 deferred from the required defect set. The two non-blocking PR #10 review carryovers below are separate and both `DEFER` to their correct trains.

Two PR #10 review carryovers are separately classified and are not counted as R2 defects:

- `DEFER` to R4/R11 hardening: `apps/web/lib/beta-workspace.ts:preparePrivatePacket` uses persisted bindings while `currentDocumentContext` performs the stronger file/current-tuple gate. Before local packet preparation, R4 should optionally re-resolve the current private profile and apply the same consistency gate.
- `DEFER` to R8 UI hardening: the document-link block in `apps/web/app/jobs/[id]/page.tsx` contains the cosmetic `Â·` separator. Replace it with an encoding-safe separator and add a rendered-text regression.

## Implementation slices

### R2A — evidence model and normalization

- Dependencies: merged Manual-intake Beta, approved R2 plan, verified backup procedure.
- Expected files: `packages/job-model/src/index.ts`, `packages/job-model/src/beta.ts`, `packages/job-importer/src/single-job-parser.ts`, `beta-extraction.ts`, `requirement-evidence.ts`, source mapper files, `packages/database/src/schema.ts`, `job-import-repository.ts`, `beta-repository.ts`, next migration, fixtures, normalization docs, and `apps/web/app/jobs/[id]/page.tsx`.
- Schema/data: evidence states/modality, structured geography/employment/salary/schedule/documents/requirements, conservative legacy mapping, immutable correction/source evidence.
- Tests: headings/labels/source paths; all AU states; multi/remote/conflicting locations; salary with unknown period; tri-state documents; conditional/negated/preferred requirements; work rights; broad-token false positives; empty/sparse coverage; migration/backfill/integrity/FKs.
- Privacy/rollback: fictional fixtures only; backup before local migration; disable new parser/version and read retained legacy projections if rolled back. Never edit 0002.
- Human gate: approve field schemas, legacy mapping, migration SQL, and representative normalized fixtures before implementation PR merge.
- Acceptance: every material field has a truthful state/evidence link; no listed R2A defect remains; old rows/history survive; full gates pass.

### R2B — eligibility and verified-only scoring

- Dependencies: R2A current evidence contracts and owner-approved rule semantics.
- Expected files: `packages/eligibility-engine/src/index.ts` and `types.ts`, `packages/fit-scorer/src/index.ts`, database evaluation repositories, workspace service, unit/integration fixtures, job detail/dashboard UI, and eligibility/fit docs.
- Schema/data: class-specific reasons, evidence IDs, coverage/calibration state, rule/weight versions; no destructive rewrite of old evaluations.
- Tests: complete class/status matrix; conditional certification; work-right expiry/hours; weekly/fortnightly and km/minute separation; overnight schedule; verified/unverified/unknown/conflicting fact ablation; no blocker/review override by score; determinism/monotonicity/bounds.
- Privacy/rollback: no private row-level calibration output; pin prior rule/weight version and mark newer evaluations stale.
- Human gate: approve every blocker/review rule and golden contribution direction; legal rules require current authoritative review and explicit “not legal advice” boundary.
- Acceptance: only current verified evidence scores; recommendation requires ELIGIBLE/current/covered; explanations reproduce every point and reason.

### R2C — duplicate review, corrections, queue, and audit

- Dependencies: R2A; R2B version bindings for queue freshness.
- Expected files: `packages/job-normalizer/src/cross-source-dedup.ts`, `packages/database/src/beta-repository.ts`, `job-discovery-repository.ts`, `job-import-repository.ts`, schema/migration if not completed in R2A, `apps/web/lib/beta-workspace.ts`, jobs actions/pages, and integration/browser tests.
- Schema/data: durable suggested/link/reject/split evidence; decision snapshots/staleness; expanded typed corrections; event-specific audit schemas.
- Tests: rerun/crash idempotency; cross-tenant ID collision; exact target/requisition; similar title stays separate; conflicting/reposted/multi-location cases; link/split application-history preservation; stale queue refusal; correction invalidation; audit extra-key/private-canary rejection.
- Privacy/rollback: display bounded evidence only; disable new actions while preserving observations/decisions. Never delete linked history.
- Human gate: owner reviews link/split semantics, correction scope, and queue transitions before merge.
- Acceptance: ambiguous jobs never auto-merge; preparation cannot use stale/unresolved decisions; every transition is attributable and reversible where safe.

### R2D — calibration, UX, and release evidence

- Dependencies: R2A–R2C; at least the fictional golden corpus. Private calibration remains optional until its sample threshold exists.
- Expected files: a fictional matching fixture manifest, fit-scorer calibration/test harness, `apps/web/app/jobs` and dashboard pages, Playwright accessibility/responsive cases, and go-live/project docs.
- Schema/data: versioned aggregate calibration run metadata only; private cases and row-level results remain ignored/local.
- Tests: full golden matrix, sensitivity/ablation, accessibility/responsive/error states, performance bounds, migration/restore, release/privacy/exact-head CI.
- Privacy/rollback: publish only aggregate safe counts; label scorer UNCALIBRATED until the sample gate. Revert UI/weights and pin prior versions without changing source history.
- Human gate: owner reviews rankings, residual bias/coverage, UI wording, and implementation PR.
- Acceptance: all gates above pass, no predictive claims, current docs match reality, and the implementation PR remains unmerged pending approval.

## Exact implementation order and next slice

1. **Implement R2A only** on a new feature branch after this plan PR is reviewed and merged.
2. Review/migrate the evidence model with fictional fixtures and safe backup/restore proof.
3. Implement R2B against the stable R2A contract.
4. Implement R2C, then R2D. R1 may consume R2 evidence later but cannot relax it.

Recommended next implementation slice: **R2A — evidence model and normalization**. It removes the truth-loss boundaries that currently make later eligibility, scoring, queue, and real-source results look more certain than their evidence. Approval of this plan does not authorise that implementation, any real database migration, or any source call.
