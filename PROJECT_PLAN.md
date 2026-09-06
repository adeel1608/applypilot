# ApplyPilot Project Plan

Last updated: 2026-09-05  
Owner: `adeel1608`  
Repository: `adeel1608/applypilot`  
Working branch: `chore/phase-2-5a-local-activation-plan`

## 1. Vision

ApplyPilot is a local-first job discovery, job matching, document preparation, assisted application, and outcome-tracking platform. It should help a candidate move safely from discovered vacancies to reviewed applications while keeping sensitive profile data and authenticated browser state under the candidate's control.

The intended workflow is:

`discover -> normalize -> deduplicate -> evaluate eligibility -> score fit -> shortlist -> select CV template -> tailor from verified facts -> create cover letter when required -> prepare application -> assisted form filling -> human review -> submit -> track outcome`

Human approval before final submission is a permanent initial invariant. A later phase may propose changing it, but may not do so silently.

## 2. Goals

- Provide a professional TypeScript monorepo foundation for incremental development.
- Store structured candidate facts locally and distinguish verified, unknown, unsupported, and forbidden claims.
- Normalize jobs from multiple sources behind a common adapter contract.
- Produce deterministic, explainable eligibility and fit results.
- Generate ATS-friendly documents from verified facts only.
- Provide a usable local dashboard for review and tracking.
- Maintain privacy, auditability, testability, and human control.
- Remain useful without paid APIs; make future AI providers optional.

## 3. Non-goals

- Live scraping, CAPTCHA solving, protection bypasses, or unattended applications in Phase 0/1.
- Automatic final submission.
- Production deployment in Phase 0/1.
- Advanced semantic deduplication or AI rewriting in Phase 0/1.
- Treating missing, ambiguous, or inferred candidate data as verified.
- Fully automating LinkedIn discovery before technical and policy evaluation.

## 4. User workflow

The dashboard summarizes fixture-backed jobs and application states. A user opens a normalized job, reviews deterministic eligibility reasons and fit explanations, then chooses to skip or shortlist it. Document actions select an appropriate resume category and create deterministic content from verified profile facts. Future phases add source discovery and assisted form filling, with an explicit human checkpoint immediately before submission.

## 5. Functional requirements

- Validate and version candidate profiles.
- Model forbidden claims and unsupported experience explicitly.
- Normalize job data and retain source records for provenance.
- Expose adapter capabilities and placeholders for SEEK, Indeed, LinkedIn, Employment Hero, Workday, Greenhouse, Lever, and generic company sites.
- Represent deduplication candidates without over-engineering the matcher.
- Evaluate hard blockers deterministically and surface ambiguity as `REVIEW_REQUIRED`.
- Calculate an explainable 0-100 fit score.
- Persist the Phase 0/1 domain in SQLite-compatible Drizzle tables and migrations.
- Render a fixture-backed dashboard, jobs list/detail, applications, profile, and settings pages.
- Select resume templates and render one deterministic ATS-friendly demonstration.
- Prepare a basic deterministic cover-letter representation and application-runner contract.
- Record application events and audit events.

## 6. Non-functional requirements

- TypeScript strict mode and Zod boundary validation.
- Deterministic engines with no required network or paid API.
- Accessible server-rendered React UI with responsive layouts.
- Local-first storage and explicit cloud/local trust boundaries.
- Reproducible installs, lint, formatting checks, tests, typecheck, and build in CI.
- Small, composable packages with source-specific logic isolated behind interfaces.
- Dates serialized as ISO 8601 strings at persistence and interchange boundaries.

## 7. Security/privacy requirements

- Commit only `data/profile.example.json`; ignore `data/profile.private.json` and common variants.
- Ignore databases, write-ahead logs, secrets, environment files, browser profiles, cookies, storage state, generated application documents, personal CVs, identity/visa/tax/bank records, and private referee material.
- Keep authenticated browser work and sensitive documents in a future local runner.
- Never log secrets or full private profiles. Audit state transitions and redacted identifiers instead.
- Validate source data before it reaches deterministic engines.
- Stop and request legitimate human action on CAPTCHA, MFA, access-control, authentication, or website restriction boundaries.
- Do not commit seeded real personal information; examples must be fictional.

## 8. Candidate truth-store architecture

`@applypilot/candidate-profile` owns the Zod schema, inferred TypeScript types, safe parsing, and truth-claim helpers. Facts with material application impact use explicit verification state (`VERIFIED`, `USER_CONFIRMATION_REQUIRED`, or `UNKNOWN`) rather than bare truthy values. Employment, education, achievements, skills, licences, certifications, availability, work rights, transport, preferences, referees, unsupported experience, and forbidden claims are modeled directly.

Content engines receive a validated `CandidateProfile`, build a set of permitted fact references, and reject statements that cite missing or forbidden facts. Candidate profile versions are append-only persistence records so that a generated document can point to the exact source version.

## 9. Multi-site job adapter architecture

`@applypilot/job-sources` defines `JobSourceAdapter`, adapter capability flags, discovery/fetch inputs, and normalized results. Every adapter reports capabilities rather than implying support. Phase 0/1 exports non-networked placeholders for `seek`, `indeed`, `linkedin`, `employment-hero`, `workday`, `greenhouse`, `lever`, and `generic-company-site`. LinkedIn reports `MANUAL_ONLY` and assisted behavior only. Fixture adapters support tests; live HTTP and browser implementations belong to later phases.

## 10. Job normalization architecture

`@applypilot/job-model` owns the normalized job schema and enums. `@applypilot/job-normalizer` owns source-record normalization contracts and a conservative deduplication-candidate interface. Raw payloads remain in source records for provenance, while normalized records provide consistent location, schedule, requirements, salary, hours, application status, and assessment fields. Deduplication signals include canonical URL, source identifiers, normalized company/title/location, posting date, and optional future description similarity.

## 11. Eligibility engine

`@applypilot/eligibility-engine` evaluates a validated job and candidate profile into `ELIGIBLE`, `INELIGIBLE`, or `REVIEW_REQUIRED`. Explicit missing mandatory qualifications, licences, vehicle access, work rights, fixed availability, fixed-hour limits, maximum commute, specialist healthcare qualifications, and mandatory experience are hard blockers. Unknown job or candidate facts never pass silently; material ambiguity produces review. Each rule emits a stable code, severity, human-readable explanation, and supporting field references.

## 12. Fit scoring engine

`@applypilot/fit-scorer` applies deterministic weighted signals after eligibility evaluation. Initial categories cover location/commute, availability, employment type, skills, experience, education, customer-service relevance, technical relevance, training, preferred requirements, mandatory requirements, and category preference. Scores are clamped to 0-100 and return positive and negative explanations plus per-category contributions. An ineligible job may still be scored for diagnosis, but is never represented as a recommended application.

## 13. Resume engine

`@applypilot/resume-engine` defines ten template categories, a deterministic selector, truth-safe resume document data, HTML/CSS rendering, file naming, and Playwright PDF output. Phase 0/1 demonstrates one `casual-general` layout. CSS fixes A4 size, black Times New Roman text, minimum 10 pt body text, professional bullets, no icons/graphics/skill bars/photo/colored sidebars, and selectable text. Casual output targets one page; engineering output targets two pages unless configured otherwise.

## 14. Cover-letter engine

`@applypilot/cover-letter-engine` defines deterministic document data and a basic generator. Employer, role title, and cited requirements come from the normalized job. Candidate statements are assembled only from verified facts. Missing support is omitted or surfaced for review, never invented. Advanced rewriting remains out of scope until Phase 11.

## 15. Application runner

`@applypilot/application-runner` defines modes `DISCOVERY_ONLY`, `ASSISTED_FILL`, `HUMAN_REVIEW_REQUIRED`, and `SUBMISSION_SUPPORTED`; answer certainty; security-stop reasons; preparation results; and runner capabilities. The Phase 0/1 implementation is a no-submit preparation runner. The global policy gate requires human confirmation before any future final submission.

## 16. Application tracking

`@applypilot/application-tracker` defines application statuses, allowed transition helpers, and analytics-ready event fields. Applications link source, job, candidate-profile version, generated documents, and event timestamps. Event data supports later analysis by source, CV template, role category, company, location, and time-to-response.

## 17. Browser automation strategy

Playwright is the planned browser layer. Discovery and application capabilities are adapter-specific and policy-aware. Authenticated state, cookies, downloaded personal documents, and sessions live only in the future local runner. Automation pauses on CAPTCHA, MFA, unexpected authentication, rate limiting, bot detection, access controls, or unsupported page changes. The initial repository uses fixtures and browser tests only; it does not visit job boards.

## 18. Data model

SQLite with Drizzle ORM contains at least:

- `candidate_profiles` and append-only `candidate_profile_versions`.
- `jobs`, `job_sources`, and provenance-preserving `job_source_records`.
- `eligibility_results` and `fit_scores` with structured explanation JSON.
- `generated_documents` with profile version, template, hashes, and local path metadata.
- `applications`, append-only `application_events`, and tri-state `application_answers`.
- append-only `audit_events` and typed `settings`.

Local database files are runtime artifacts and ignored. The schema stores JSON as text where SQLite has no dedicated type and timestamps as ISO strings. A dedicated `packages/database` package is added beyond the suggested tree because persistence is shared by the web app, future local runner, tests, and analytics; isolating it prevents the UI from owning domain storage.

## 19. Dashboard architecture

`apps/web` is a Next.js App Router application. Server components render fixture-backed pages for `/`, `/dashboard`, `/jobs`, `/jobs/[id]`, `/applications`, `/profile`, and `/settings`. Shared UI styles live in the app; business rules stay in packages. The job detail page displays eligibility, score, reasons, requirements, missing skills, work rights, schedule, commute, template recommendation, recommended action, and intentionally inert Phase 0/1 action controls.

## 20. Deployment strategy

There is no Phase 0/1 deployment. The preferred future topology is a cloud-hosted dashboard/backend for non-sensitive coordination plus a local ApplyPilot Runner for authenticated browser automation, browser sessions, private candidate profiles, and personal documents. A fully local deployment maximizes privacy but limits remote access and scheduling. A fully cloud-hosted runner improves availability but creates unacceptable credential and personal-data exposure without substantial hardening. The hybrid plan requires authenticated, encrypted, least-privilege communication and explicit data classification before Phase 19.

## 21. Testing strategy

- Unit tests validate candidate profiles, forbidden-claim enforcement, normalization contracts, eligibility branches, score bounds/explanations, resume selection/content, application transitions, and runner safety gates.
- Fixture scenarios cover retail, hospitality/fast food, receptionist, customer service, robotics and automation internships, registered nurse, sonographer, MR truck driver, own-vehicle roles, unrestricted work-right roles, timetable conflicts, fixed-hour excess, warehouse, and administration.
- Integration tests exercise the fixture pipeline from profile/job parsing through eligibility and scoring.
- Next.js production build validates server rendering and route generation.
- Playwright browser tests validate key dashboard routes and, where practical, A4 PDF output/selectable text/page count.
- Required checks are `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e`, and `npm run build`.

## 22. Risks

- Job-board markup and policies change: isolate sources, expose capabilities, use fixtures, and add policy review per adapter.
- Candidate hallucination or overclaiming: require typed verified facts, forbidden-claim checks, provenance, and negative tests.
- Ambiguous requirements: return `REVIEW_REQUIRED`; never coerce unknown to true.
- SQLite concurrency limits future hosted scale: keep repository contracts separable and revisit during deployment design.
- Browser automation leaks credentials: keep it local, ignore state artifacts, redact logs, and pause at security boundaries.
- Resume layout can vary across Chromium versions: pin dependencies, validate page size/count, and visually inspect reference output when document work expands.
- Monorepo configuration drift: centralize scripts and CI checks, and keep package boundaries documented.
- Fixture bias can make scoring seem more accurate than it is: keep weights transparent and validate against user-reviewed outcomes in later phases.

## 23. Open questions

- Which candidate fields should be encrypted at rest beyond filesystem-level protections?
- Which geocoding provider, if any, can support commute calculations without a required paid API?
- What exact job-board terms and technical constraints apply to each future adapter?
- Should profile versions store full snapshots, normalized relational facts, or both after Phase 1?
- Which PDF archival metadata and signing requirements are useful to the candidate?
- What human-confirmation UX is sufficiently explicit for eventual assisted submission?
- Which deployment functions can safely leave the local runner after threat modeling?

## 24. Phase roadmap

Roadmap statuses use `NOT_STARTED`, `AWAITING_HUMAN_REVIEW`, `IN_PROGRESS`, `COMPLETE`, or `BLOCKED`.

| Phase | Objective                                  | Tasks                                                                                               | Acceptance criteria                                                                                                            | Key risks                                                              | Dependencies                                   | Validation requirements                                             | Status                |
| ----- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | --------------------- |
| 0     | Bootstrap repository and architecture      | Private GitHub repo, branch, workspace, docs, CI, security baseline                                 | Required docs/config exist; CI design covers quality gates; private repo and feature branch verified                           | Premature architecture lock-in                                         | GitHub CLI, Node LTS                           | Lint, typecheck, tests, build, Git/GitHub audit                     | COMPLETE              |
| 1     | Establish candidate/domain/data foundation | Truth store, normalized jobs, database, fixtures, eligibility, scoring, basic documents, dashboard  | All Phase 0/1 acceptance criteria in this plan pass                                                                            | Incorrect rules or unsafe claims                                       | Phase 0, Zod, Drizzle, fixtures                | Unit/integration/E2E tests and production build                     | COMPLETE              |
| 2     | Add SEEK discovery                         | Policy review, discovery/detail mapping, fixture replay, throttling/error model                     | SEEK jobs normalize with provenance; no protection bypass                                                                      | Site/policy changes, rate limits                                       | Phases 0-1                                     | Contract tests, fixture replay, manual policy audit                 | COMPLETE              |
| 2.5   | Add real-world job intake                  | Source-neutral paste, multi-job, HTML, upload, preview, confirmation, and policy-gated URL intake   | Real ads enter one validated local pipeline and are evaluated only with a valid private profile; no scraping or invented facts | Untrusted content, demo-profile leakage, false splits, duplicate drift | Phase 2 normalization and persistence patterns | Parser/profile/security fixtures, integration/E2E, migration review | COMPLETE              |
| 2.5A  | Validate local real-world activation       | One private local profile, one user-supplied vacancy, migration, evaluation, UI, and privacy checks | The real local workflow is truthful and leak-free; no source fetch or application action                                       | Private-data leakage, parser mismatch, demo fallback, invalid profile  | Merged Phase 2.5 implementation                | Manual comparison, isolation/privacy audit, full regression suite   | AWAITING_HUMAN_REVIEW |
| 3     | Add Indeed discovery                       | Policy review, discovery/detail adapter, fixture replay                                             | Indeed jobs normalize with provenance and safe failures                                                                        | Site/policy changes, bot controls                                      | Phases 0-2 patterns                            | Contract tests, fixture replay, manual audit                        | NOT_STARTED           |
| 4     | Add Employment Hero adapter                | Model public listings/details and capability boundaries                                             | Supported public jobs normalize; unsupported flows declared                                                                    | Tenant variation                                                       | Adapter contracts                              | Contract/integration tests                                          | NOT_STARTED           |
| 5     | Add generic ATS adapters                   | Greenhouse, Lever, Workday, generic company sites                                                   | Each adapter passes common contract suite and retains raw provenance                                                           | Vendor/tenant variation                                                | Phases 2-4 lessons                             | Per-adapter fixtures and policy/security checks                     | NOT_STARTED           |
| 6     | Refine normalization and deduplication     | Canonical fields, similarity signals, merge review UX                                               | Duplicate clusters are explainable and source records remain intact                                                            | False merges                                                           | Multi-source fixtures                          | Precision/recall fixture suite and manual review                    | NOT_STARTED           |
| 7     | Refine eligibility                         | Expand rules, confidence, override/audit workflow                                                   | Hard blockers and overrides are deterministic and audited                                                                      | False negatives                                                        | Candidate feedback and normalized data         | Rule matrix, regression tests                                       | NOT_STARTED           |
| 8     | Refine fit scoring                         | Calibrate weights and preference signals                                                            | Scores remain explainable and calibrated against reviewed outcomes                                                             | Misleading precision/bias                                              | Outcome samples                                | Golden cases, sensitivity and bounds tests                          | NOT_STARTED           |
| 9     | Complete CV template engine                | Implement categories and reusable layout validation                                                 | ATS-safe categories render within configured page limits                                                                       | Layout drift                                                           | Truth store, Playwright                        | PDF structure, page-count, visual QA                                | NOT_STARTED           |
| 10    | Add automatic CV tailoring                 | Deterministic tailoring first; optional provider boundary                                           | Every claim has profile provenance; unsupported claims fail closed                                                             | Hallucination                                                          | Phase 9 and truth provenance                   | Adversarial truth-compliance tests                                  | NOT_STARTED           |
| 11    | Complete cover-letter generation           | Requirement selection, tone configuration, layouts                                                  | Employer/role accurate, fact-safe, non-generic output                                                                          | Unsupported claims                                                     | Phase 10 patterns                              | Content provenance and PDF validation                               | NOT_STARTED           |
| 12    | Build application preparation              | Question mapping, answer store, document checklist                                                  | Prepared packet identifies every unknown and required review                                                                   | Incorrect answers                                                      | Documents and normalized jobs                  | Workflow integration tests                                          | NOT_STARTED           |
| 13    | Add assisted browser filling               | Local runner, field mapping, pause/resume, confirmation gate                                        | Safe assisted filling works on approved fixtures; no unattended final submit                                                   | Credential leakage, site controls                                      | Phase 12, security review                      | Synthetic-site E2E, threat-model review                             | NOT_STARTED           |
| 14    | Complete tracking dashboard                | Persistent queues, timelines, status actions                                                        | Applications and events are filterable and auditable                                                                           | State inconsistency                                                    | Database and runner events                     | Transition and UI tests                                             | NOT_STARTED           |
| 15    | Add scheduled discovery                    | Local/cloud schedules, checkpoints, idempotency                                                     | Runs are resumable and deduplicated without duplicate notifications                                                            | Rate limiting, missed runs                                             | Source adapters                                | Scheduler/idempotency tests                                         | NOT_STARTED           |
| 16    | Add notifications                          | Local/email/push option analysis and preferences                                                    | Opt-in notifications contain minimal sensitive data                                                                            | Privacy and alert fatigue                                              | Phase 15                                       | Preference and redaction tests                                      | NOT_STARTED           |
| 17    | Add analytics                              | Conversion, source/template/category/company/location/time metrics                                  | Metrics derive reproducibly from event data                                                                                    | Small-sample bias                                                      | Tracking history                               | Query fixtures and metric reconciliation                            | NOT_STARTED           |
| 18    | Add optional AI providers                  | Provider-neutral interface, redaction, consent, deterministic fallback                              | Base app works without AI; provider use is explicit and auditable                                                              | Privacy, cost, hallucination                                           | Mature truth-safe engines                      | Contract, redaction, fallback tests                                 | NOT_STARTED           |
| 19    | Deploy approved topology                   | Hybrid runner/cloud implementation, migrations, operations                                          | Threat model approved; rollback and recovery tested                                                                            | Secrets, availability, migration loss                                  | Prior phases and hosting choice                | Staging, backup/restore, security tests                             | NOT_STARTED           |
| 20    | Production security hardening              | Pen test, dependency policy, incident response, release gates                                       | Critical findings resolved and operational controls documented                                                                 | Unknown vulnerabilities                                                | Deployment candidate                           | SAST/dependency/manual security audits                              | NOT_STARTED           |

## 25. Current phase status

### Phase 0/1 implementation blueprint

**State at the start of Phase 0/1**

- GitHub CLI authenticated as `adeel1608`.
- Private repository `adeel1608/applypilot` created on 2026-09-05.
- `main` contained only the repository initialization commit.
- Phase 0/1 work was performed on `feat/bootstrap-applypilot`.
- The workspace contained no pre-existing source files or user changes.
- Node `v24.18.0` is available; npm must be invoked as `npm.cmd` in this PowerShell environment because script execution policy blocks `npm.ps1`.

**Objective**

Complete only Phase 0 and Phase 1: establish the repository, domain models, local database schema, deterministic engines, fixture-backed dashboard, document foundations, automated checks, CI, security documentation, and an unmerged pull request.

**Assumptions**

- Node 24 is the current installed LTS-compatible runtime for this repository.
- Fixture identities and employers are fictional.
- Distances in fixtures are precomputed; no geocoding service is introduced.
- Phase 0/1 document generation may demonstrate one layout while defining all requested categories.
- Job detail action controls are non-submitting UI affordances.
- SQLite schema acceptance requires Drizzle schema and a checked-in SQL migration; local database files are not committed.

**Requirements**

- Satisfy every Phase 0/1 acceptance criterion listed below.
- Preserve the candidate truth and human-confirmation invariants.
- Use the specified TypeScript, Next.js, React, SQLite, Drizzle, Zod, Playwright, Vitest, ESLint, Prettier, and GitHub Actions stack.
- Do not perform live job-board access, deploy, or submit applications.

**Architecture**

- npm workspaces coordinate `apps/*` and `packages/*` without an additional task-runner dependency.
- `apps/web` owns routing and presentation only.
- Domain packages own schemas and pure deterministic behavior.
- `packages/database` owns Drizzle persistence definitions and migrations.
- Static fictional fixtures seed the initial UI and tests.
- Playwright is used for web E2E tests and Chromium-backed PDF generation.

**Proposed file changes**

- Root: repository policy, plan, architecture/security/contribution/readme docs, npm/TypeScript/ESLint/Prettier/Vitest/Playwright configuration, environment sample, ignore rules, CI workflow.
- `apps/web`: App Router layout, home redirect/landing behavior, dashboard, jobs list/detail, applications, profile, settings, fixtures/view-model helpers, accessible CSS.
- `packages/candidate-profile`: candidate schema, truth helpers, tests.
- `packages/job-model`: normalized job schema and status enums.
- `packages/job-sources`: shared adapter contract and eight offline placeholders.
- `packages/job-normalizer`: normalization/deduplication contracts.
- `packages/eligibility-engine`: deterministic rule engine and tests.
- `packages/fit-scorer`: deterministic weighted scorer and tests.
- `packages/resume-engine`: category selection, truth-safe document model, ATS HTML/CSS, Playwright PDF function, tests.
- `packages/cover-letter-engine`: deterministic fact-safe foundation.
- `packages/application-runner`: preparation-only safe runner contract.
- `packages/application-tracker`: statuses and transitions.
- `packages/shared`: shared assertion/date/result utilities as needed.
- `packages/database`: Drizzle schema, database factory/config, and initial migration.
- `data`: fictional example profile only.
- `fixtures/jobs`: fifteen requested fictional job records.
- `tests`: cross-package fixture pipeline tests and Playwright UI checks.
- `docs`: required focused architecture documents.

**Data flow**

`source fixture/adapter -> source record validation -> normalized Job -> deduplication signals -> eligibility(candidate profile, job) -> fit score(candidate profile, job, eligibility) -> dashboard review -> shortlist -> resume/cover-letter preparation from verified facts -> application preparation -> human review gate -> future submission -> application/audit events`

Candidate profile versions and raw job source records remain linked to downstream results for provenance.

**Dependencies**

- Runtime: Next.js, React, React DOM, Zod, Drizzle ORM, and a SQLite driver.
- Development: TypeScript, ESLint, Next ESLint config, Prettier, Vitest, Playwright Test, `tsx`, and supporting type definitions. Drizzle Kit was removed after its stable release retained vulnerable legacy build tooling; the checked-in SQL migration is executed directly in an in-memory SQLite test instead.
- External: private GitHub repository and GitHub Actions. No paid API or runtime cloud dependency.

**Risks**

- Native SQLite installation may be incompatible with the installed Node version; prefer a currently supported driver and validate install/build early.
- Next.js workspace transpilation and server/client boundaries can surface build-only failures; validate production build before UI polish.
- Large fixture schemas can become brittle; centralize parsers and fail with actionable paths.
- PDF rendering may require a separate Chromium binary; install and record validation precisely.

**Security/privacy concerns**

- Example data must remain fictional and contain no actual candidate contact details.
- Ensure ignore rules cover private profiles, databases, generated PDFs, browser state, sessions, credentials, identity and financial documents.
- Avoid client-bundling private profile data in future database-backed work; Phase 0/1 uses only the committed fictional example.
- Do not expose a submission implementation or misleading active submit control.

**Testing strategy**

- Create focused unit tests beside domain packages.
- Run a cross-package integration suite over all fifteen job fixtures.
- Cover explicit eligible retail, hospitality, receptionist, engineering internship, missing qualification, missing licence, own vehicle, unrestricted work rights, schedule conflict, excessive hours, and ambiguous-review cases.
- Assert score bounds and positive/negative explanations.
- Assert invalid/unverified claims are rejected or omitted.
- Use Playwright against a production-like local server for main dashboard/job routes.
- Run lint, format check, typecheck, all tests, and build locally and in CI.

**Rollback strategy**

- Phase 0/1 work remained isolated on `feat/bootstrap-applypilot`; `main` stayed at its initialization commit until the reviewed pull request was merged.
- Commits are organized by concern so a problematic layer can be reverted without rewriting history.
- Database evolution begins with migration `0000`; since Phase 0/1 has no real data, rollback is removal of the disposable ignored local database and checkout/revert of the migration commit.
- No deployment or external application state is created.

**Phase 0/1 acceptance criteria**

- Private repository exists at `adeel1608/applypilot`; feature branch exists and is pushed.
- `AGENTS.md`, this plan, architecture, security, contribution, README, and focused docs exist and reflect reality.
- Candidate truth-store and forbidden claims schemas exist with tests and fictional example data.
- Normalized job schema, SQLite/Drizzle schema and migration, adapter interfaces/placeholders, deduplication types, and all fifteen fixtures exist.
- Eligibility and fit engines pass required deterministic scenarios with explanations.
- Resume foundation and one deterministic ATS-safe demonstration exist; cover-letter and safe application-runner foundations exist.
- Required dashboard routes build and run from fixture data.
- Lint, format check, typecheck, unit tests, integration tests, E2E tests, and production build pass.
- CI runs install, lint, typecheck, tests, and build on push and pull request.
- Final audit confirms ignored sensitive artifacts, clean status, private visibility, pushed branch, open unmerged PR, and no critical practical dependency finding left undocumented.

**Exact implementation steps**

1. Commit the plan-first repository policy and blueprint.
2. Add root workspace/tooling configuration and aggressive ignore/environment templates.
3. Add shared, candidate-profile, job-model, and database packages plus migration.
4. Add adapter, normalization, application tracking, and application runner contracts/placeholders.
5. Add fictional candidate and fifteen job fixtures.
6. Implement and unit-test eligibility and fit scoring.
7. Implement and unit-test resume and cover-letter foundations, including truth checks and PDF renderer.
8. Build fixture-backed Next.js routes and styling.
9. Add integration and Playwright tests plus GitHub Actions.
10. Complete all required documentation.
11. Install dependencies/Chromium as needed; run formatting, lint, typecheck, unit, integration, E2E, and production build checks.
12. Audit security, dependency findings, dead code, Git status, repository visibility, branch, docs, and architecture.
13. Update this plan with actual results and limitations; make clean commits, push the branch, and open but do not merge the pull request.

## 26. Completed work

- Verified GitHub authentication belongs to `adeel1608`.
- Confirmed `adeel1608/applypilot` did not already exist.
- Created `adeel1608/applypilot` with private visibility and the required description.
- Initialized and pushed `main` with commit `dd39c7f`.
- Created and pushed feature branch `feat/bootstrap-applypilot`.
- Added permanent plan-first instructions, the full 21-phase roadmap, architecture/security/contribution documentation, and focused domain documentation.
- Bootstrapped the npm/TypeScript/Next.js workspace with strict type checking, flat ESLint configuration, Prettier, Vitest, Playwright, and GitHub Actions.
- Added the strongly typed candidate truth store, fictional example profile, verification states, unsupported experience, forbidden claims, and provenance helpers.
- Added the normalized job model, all fifteen fictional job scenarios, eight offline adapter placeholders, capability flags, source-record contracts, and conservative deduplication structures.
- Added all thirteen required SQLite/Drizzle tables, indexes, foreign keys, an initial SQL migration, and an in-memory migration execution test.
- Implemented deterministic eligibility and 0-100 fit engines with stable reason codes and positive/negative explanations.
- Added all ten resume categories, deterministic selection, provenance-bound resume claims, forbidden-claim validation, A4 ATS HTML, Chromium PDF rendering, safe filenames, and a deterministic cover-letter foundation.
- Added the preparation-only application runner, tri-state answer model, automation stop reasons, human-confirmation invariant, tracking statuses, and transition validation.
- Built `/`, `/dashboard`, `/jobs`, `/jobs/[id]`, `/applications`, `/profile`, and `/settings` as responsive Next.js server-rendered fixture views. The job preparation controls are intentionally disabled.
- Generated and inspected the fictional `JORDAN CV (Northside Homewares).pdf`: one A4 page at 594.96 by 841.92 points, 722 extractable characters, zero replacement characters, black Times text, minimum 10 pt, professional bullets, and no clipping or decorative elements. Poppler was unavailable locally, so PyMuPDF rendered the inspection PNG and pypdf performed structural/text checks; the temporary PNG was removed after review.
- Merged pull request [#1](https://github.com/adeel1608/applypilot/pull/1) from `feat/bootstrap-applypilot` into `main` with normal merge commit `d4f15f862cbc0a976a82241a9a2ef76fda7099c0` at `2026-09-05T05:07:44Z`; the remote feature branch was deleted.

### Validation results

Validated on 2026-09-05 with Node `v24.18.0`:

- `npm run format:check`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed in strict mode.
- `npm test`: 37 tests passed across 9 files.
- `npm run test:integration`: the full 15-job pipeline passed with 6 eligible, 1 review-required, and 8 ineligible results.
- `npm run build`: passed; 23 static pages generated, including all 15 job details.
- `npm run test:e2e`: 4 Chromium tests passed, including dashboard navigation, disabled submission control, private-profile messaging, and live A4 PDF style/structure checks.
- `npm audit`: 0 vulnerabilities across production and development dependencies after upgrading Vitest and removing Drizzle Kit.
- Git ignore audit: private profile, `.env`, browser-session state, SQLite files, and generated candidate PDFs are ignored.
- Secret-pattern audit: no credential-like assignments found outside dependencies/build output.
- GitHub Actions: both push and pull-request `quality` runs passed after correcting a Bash glob-expansion issue in the Vitest exclusions. The failed runs and their cause were not skipped.
- GitHub audit: `adeel1608/applypilot` is private, `main` is the default branch, and PR #1 is merged with merge commit `d4f15f862cbc0a976a82241a9a2ef76fda7099c0`.

Phase 0/1 acceptance criteria are complete. No live job-board access, deployment, or application submission occurred.

## 27. Blocked work

No Phase 0/1 work is blocked.

Intentional boundaries remain: source adapters are offline placeholders; persistence is schema/migration foundation rather than dashboard-backed CRUD; deduplication is a contract rather than a fuzzy matcher; only one common resume layout is rendered; cover-letter support is basic and deterministic; job actions are disabled; and all discovery, deployment, notification, analytics, AI-provider, and browser-assisted submission work remains assigned to later phases.

## 28. Next recommended task

Phase 2 is the next recommended task: implement a policy-reviewed SEEK discovery adapter using captured fixtures and contract tests, without live application submission or protection bypass.

Exact recommended implementation prompt after human approval (do not execute during this blueprint checkpoint):

```text
PROJECT: ApplyPilot
PHASE: 2 - SEEK job discovery adapter

Continue from the merged Phase 0/1 foundation. Follow AGENTS.md and read PROJECT_PLAN.md in full. Inspect the repository and current GitHub state, then update the Phase 2 implementation blueprint in PROJECT_PLAN.md before changing application code. Work on a new feature branch named feat/seek-discovery-adapter.

Implement only the SEEK discovery and job-details phase behind the existing JobSourceAdapter contract. First document a current technical and policy assessment of permitted access, authentication boundaries, robots/rate-limit considerations, and failure/stop conditions. Prefer an official/publicly permitted interface if one is available. Do not bypass CAPTCHA, MFA, bot detection, access controls, authentication protections, rate limits, robots guidance, or website restrictions. Do not implement job application submission, unattended form filling, credential storage, or LinkedIn automation.

Use fictional, redacted, or safely captured fixtures and mocks for deterministic development. Add SEEK source-record validation, discovery pagination/checkpoint contracts, job-detail mapping into the normalized Job schema, raw provenance retention, idempotency, conservative retry/error classification, and explicit capability reporting. Unknown or ambiguous source fields must remain unknown and flow to REVIEW_REQUIRED where material; never invent candidate or job information. Keep the core usable without a paid API.

Add contract, unit, integration, and fixture-replay tests for successful discovery, pagination, job details, malformed records, missing/ambiguous requirements, rate limiting, authentication/security stops, duplicates, and normalization provenance. Update relevant adapter/normalization/security documentation and the dashboard only as needed to display fixture-derived SEEK provenance; do not silently change architecture.

Run format check, lint, strict typecheck, unit tests, integration tests, Playwright tests, production build, and npm audit. Update PROJECT_PLAN.md with exact results, limitations, rollback, blocked items, and the next recommended phase. Push the feature branch and open an unmerged pull request into main. Never claim live SEEK support unless it was actually validated within the documented policy boundaries.
```

# Phase 2.5A Activation Blocker Fix

- Status: `IMPLEMENTATION_IN_PROGRESS`; Phase 2.5A real-data activation remains **BLOCKED** until this dedicated bugfix pull request is reviewed and merged by the owner.
- Working branch: `fix/ignore-sqlite-migration-backups`.
- Fresh base: merged Phase 2.5A blueprint PR #6 at `48a5cf73a83a27dc2dea2d749d79cb3da45e0fe0`; local `main` and `origin/main` matched that commit with a clean worktree before this branch was created.
- Blueprint merge: PR #6 merged normally at `2026-09-06T06:41:46Z`. The merged planning branch was deleted locally and remotely only after ancestry and ref equality were verified.
- Objective: prevent the timestamped safety copy produced by the explicit local migration command from becoming trackable, lock the policy with a deterministic fictional-path regression, and stop at an unmerged human-review PR.

## Problem

When the selected database already exists, `scripts/migrate-local-database.ts` creates a sibling backup by appending a colon-normalized ISO timestamp and `.backup` to `databasePath`. For the supported ApplyPilot filename this produces `data/applypilot.local.sqlite.<timestamp>.backup`. The existing `.gitignore` covers active `.sqlite`, `.sqlite-wal`, and `.sqlite-shm` files, but not that appended backup form. A real migration could therefore leave a private local database copy visible to Git.

Phase 2.5A real-data activation is **BLOCKED** until this fix is reviewed and merged. This task does not create a profile, inspect a CV, run the migration, create a backup, import a vacancy, or operate on real candidate/job data.

## Evidence and assumptions

- `scripts/migrate-local-database.ts` resolves `APPLYPILOT_DB_PATH` or defaults to `data/applypilot.local.sqlite`; for an existing file it copies `databasePath` to a sibling named by appending the colon-normalized ISO timestamp and `.backup`.
- `apps/web/lib/local-database.ts` defaults to `applypilot.local.sqlite` and rejects filenames that do not end in `.sqlite`. The actual application database/backup suffix under the coordinated supported path is therefore `.sqlite.<YYYY-MM-DDTHH-MM-SS.sssZ>.backup`.
- `.gitignore` also contains active-file rules for `.db` and `.sqlite3`, but no application runtime or separate backup path was found that produces timestamped `.db` or `.sqlite3` backups. The migration path override is unconstrained and must remain an explicitly coordinated/reviewed path; this fix does not speculate about unsupported filename suffixes.
- On the fresh merged base, `git check-ignore -v -- data/applypilot.local.sqlite.2026-09-06T12-00-00.000Z.backup` returned exit `1` with no matching rule. The probe is a fictional non-existent path; no database or backup was created.
- On the same base, the active fictional path `data/applypilot.local.sqlite` matched `.gitignore` rule `*.sqlite`, while `packages/database/drizzle/0001_real_world_job_intake.sql` remained non-ignored/trackable.

## Security and privacy impact

Migration backups may contain private candidate facts, supplied vacancy text, normalized records, evaluation results, and audit state. Leaving a backup trackable creates an accidental-commit and remote-disclosure risk even though the active database is ignored. The fix must protect the exact supported backup form without broadly ignoring ordinary `.backup` files, source code, documentation, or reviewed migration SQL. No sensitive content is required to reproduce or validate this policy.

## Architecture, data flow, and dependencies

This is a repository-boundary fix only. The runtime data flow remains `explicit migration confirmation -> sibling timestamped copy when the database exists -> transactional migration and verification`. Git classification changes after the copy is named; migration behavior, database contents, schema, application runtime, source adapters, profile resolution, and submission gates do not change. The regression uses Node's standard child-process API and the repository's existing Git executable through Vitest; it adds no package or external-service dependency.

## Exact proposed fix and file changes

- `PROJECT_PLAN.md`: record the plan-first evidence, security analysis, implementation contract, actual validation, rollback, and remaining human gate.
- `.gitignore`: add only `*.sqlite.*.backup` beside the existing SQLite rules. Do not add broad `*.backup`, database-directory, or generated-content patterns.
- `tests/security/gitignore-policy.test.ts`: add a permanent fictional-path test that invokes `git check-ignore --no-index` and proves both protected and trackable cases.

## Regression-test plan

The dedicated test must prove:

1. reviewed migration SQL remains trackable;
2. an active `.sqlite` database is ignored;
3. its `-wal` and `-shm` journals are ignored;
4. `data/applypilot.local.sqlite.2026-09-06T12-00-00.000Z.backup` is ignored; and
5. ordinary TypeScript source and Markdown documentation remain trackable.

All paths are fictional or already tracked source/document paths. The test must not create, read, copy, migrate, or delete a database. Run the focused regression plus `npm.cmd run format:check`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run build`, `npm.cmd run test:e2e`, `npm.cmd audit`, `npm.cmd run audit:production`, and `git diff --check`. Direct `git check-ignore` probes must confirm the exact new backup path is ignored and a normal source path is not.

## Risks and mitigations

- A rule that is too broad could conceal legitimate backup documentation or source artifacts. Mitigation: constrain the rule to names containing the supported `.sqlite` suffix before the appended backup segment and test non-database source/docs explicitly.
- A test that checks tracked files without `--no-index` could produce a false negative because Git normally suppresses tracked matches. Mitigation: use `--no-index` for every assertion and check process exit status only.
- Platform-specific shell behavior could weaken the regression. Mitigation: call `git` directly from Node without a shell and use repository-relative forward-slash paths.
- The ignore rule prevents new accidental tracking but does not remove already committed secrets. Mitigation: audit reachable Git paths for private profiles and timestamped database backups before handoff.

## Rollback

Leave the bugfix PR unmerged and delete the branch, or normally revert its commits after merge. Removing the single ignore rule and regression restores the prior repository policy; no database/schema/runtime/data rollback is involved. No real database or backup may be deleted as part of rollback.

## Acceptance criteria

- The exact fresh-base bug is reproduced with exit `1`, and the post-fix exact fictional path is ignored specifically by `*.sqlite.*.backup`.
- The permanent regression proves the migration SQL, ordinary source, and ordinary docs remain trackable while `.sqlite`, WAL, SHM, and timestamped SQLite backups are ignored.
- No broad `*.backup` rule, application/schema/migration behavior change, real profile/job content, SQLite file, backup, credential, cookie, session, or generated application artifact is introduced.
- Reachable-history and changed-file audits find no committed private profile or database backup.
- All local quality gates and both dependency audits pass; GitHub CI is green at the final pushed head.
- The bugfix branch is pushed and its pull request into `main` remains unmerged for explicit human review.
- Operational status becomes `READY_FOR_ACTIVATION_PENDING_HUMAN_REVIEW`; Phase 2.5A remains not complete and real activation remains blocked until this PR is approved and merged.

## Scope exclusions

No real candidate profile creation or reading, CV inspection, real database migration/backup, real vacancy import, UI smoke test with real data, live job-board access, document generation, application preparation/form fill/status advance/submission, Phase 2.6, Phase 3, scoring change, schema change, or cleanup/export/delete capability is authorized here. The future Phase 2.5A implementation PR must not be merged automatically.

## Exact implementation steps

1. Commit this plan-first checkpoint before changing `.gitignore`.
2. Add the single supported SQLite timestamped-backup ignore rule.
3. Add the fictional-path Git policy regression and run it directly.
4. Run the complete local validation and dependency-audit matrix.
5. Perform changed-file, reachable-history, secret/runtime-artifact, and direct ignore-policy audits.
6. Update this section with exact commands, results, commit SHAs, files changed, rollback state, and remaining blocker.
7. Push the focused commits, open an unmerged PR into `main`, wait for final-head CI, and stop for human review.

## Implementation and validation record

- Operational status: `READY_FOR_ACTIVATION_PENDING_HUMAN_REVIEW`. The repository fix is implemented and locally validated, but Phase 2.5A real-data activation remains **BLOCKED** until this bugfix PR is explicitly reviewed and merged. Phase 2.5A itself is not complete.
- Blueprint closeout: PR #6 was reverified `OPEN`, non-draft, `MERGEABLE`, and `CLEAN` at approved head `5922bf5aad413530b59bde7648e728db8ac609a1`; both final `quality` runs `33957728933` and `33957730885` passed, the repository was private, and the diff was limited to `PROJECT_PLAN.md`, `README.md`, and `docs/PRIVATE_PROFILE_SETUP.md`. It merged normally as `48a5cf73a83a27dc2dea2d749d79cb3da45e0fe0` at `2026-09-06T06:41:46Z`. Fresh local `main` matched `origin/main`, and the merged planning branch was then deleted locally/remotely.
- Bug confirmation: before the ignore edit, fictional path `data/applypilot.local.sqlite.2026-09-06T12-00-00.000Z.backup` was not ignored (`git check-ignore` exit `1`). The migration's actual supported application backup format is `data/<name>.sqlite.<YYYY-MM-DDTHH-MM-SS.sssZ>.backup`, produced by appending the colon-normalized ISO timestamp and `.backup` to the `.sqlite` database path.
- Exact fix: `.gitignore` now contains only `*.sqlite.*.backup` for the appended migration backup form. The same direct fictional probe now matches `.gitignore` line 46 and exits `0`; a generic `notes/recovery.backup`, migration SQL, normal source, and normal documentation all exit `1` and remain trackable. No broad `*.backup` rule was added.
- Suffix review: the active web runtime permits only `.sqlite` filenames, and the migration defaults to the same suffix. No separate `.db` or `.sqlite3` timestamped-backup producer exists. `.env.example` contains a legacy unused `APPLYPILOT_DATABASE_PATH` `.db` example, but repository search found no code consumer for that variable. The unconstrained migration override remains an explicitly reviewed coordination case rather than a basis for speculative broad ignore rules.
- Regression: `tests/security/gitignore-policy.test.ts` calls Git directly without a shell and uses only fictional or existing repository paths. The focused run passed 7/7 assertions covering active SQLite, WAL, SHM, timestamped backup, reviewed migration SQL, TypeScript source, and Markdown documentation.
- Files changed from the merged blueprint base: `.gitignore`, `PROJECT_PLAN.md`, and `tests/security/gitignore-policy.test.ts` only. The implementation did not change migration/database/schema/application/source/profile/evaluation/submission behavior.
- Focused commits: plan-first checkpoint `689e850d26bf2363f151300f29f59ce6ca8cbf73`; narrow ignore fix `56ce37a85dfdee73f6c4daf5d5d7d3a5b4d1e322`; permanent regression `f16009ed0fac0ecfe1d0d6de6a4580407a2dc748`.
- Formatting: the first `npm.cmd run format:check` stopped on the two freshly merged documentation files with the known Windows line-ending mismatch. Prettier normalized `README.md` and `docs/PRIVATE_PROFILE_SETUP.md`; Git comparison confirmed no substantive or staged diff. The full rerun passed.
- Successful local gates on Node 24: `npm.cmd run lint` passed; strict `npm.cmd run typecheck` passed; `npm.cmd test` passed 87 tests across 17 files; `npm.cmd run test:integration` passed 9 tests across 3 files; `npm.cmd run build` compiled the production application and generated 31 static segments across the eight routes; `npm.cmd run test:e2e` passed all 9 browser tests; `npm.cmd audit` and `npm.cmd run audit:production` each reported 0 vulnerabilities; and `git diff --check` passed. Browser execution emitted only the existing non-fatal `NO_COLOR`/`FORCE_COLOR` warnings.
- Security/privacy audit: the changed-file set is exact, high-confidence secret scan count is zero, and tracked-tree plus all-reachable-ref path checks found no private profile, SQLite/database/journal, migration backup, cookie, or browser/session artifact. Direct checks prove the timestamped backup is ignored without hiding generic backups/source/docs. Required E2E created only its fictional `applypilot.e2e.sqlite` plus WAL/SHM files; the repository-owned controlled shutdown removed those exact artifacts, port 3100 is closed, and the final local private/runtime-file count is zero. No real candidate profile, CV, vacancy, database, migration backup, credential, browser state, job-board request, document/application action, or submission was created, read, performed, or committed.
- Rollback remains the normal unmerged-PR/branch deletion or commit revert described above. There is no database, schema, real-data, runtime, network, or application state to undo.
- Remaining gate: push this final plan record, open the bugfix PR titled `fix: ignore local migration backups before activation`, wait for final-head GitHub CI, and leave it unmerged for explicit human review. Only after approval and merge may a fresh-main Phase 2.5A execution branch perform the separately approved local activation workflow.

# Phase 2 — SEEK Discovery Adapter Blueprint

- Blueprint status: `APPROVED`
- Phase roadmap status: `COMPLETE`
- Prepared on: 2026-09-05
- Blueprint branch: `feat/seek-discovery-adapter`
- Approved implementation branch: `feat/seek-discovery-implementation`

Implementation checkpoint:

- Blueprint PR #2 was approved and merged normally into `main` with merge commit `90a9eafaad32780a81653b3739c19ce95a22d951` at `2026-09-05T05:34:50Z`.
- The remote blueprint branch was deleted after merge.
- Implementation started at `2026-09-05T15:35:08+10:00` on `feat/seek-discovery-implementation`, created and pushed from the merged blueprint commit.
- The evidence-dated access assessment is recorded in `docs/SEEK_ADAPTER.md`. SEEK's official API is conditional on SEEK approval, OAuth credentials, and authorised hirer relationships; no approved public candidate-discovery API was established. Current website terms prohibit automated access outside a provided interface. Phase 2 therefore enables only `FIXTURE_ONLY` and local `USER_SUPPLIED_CONTENT`; `PUBLIC_DISCOVERY`, `PUBLIC_JOB_DETAILS`, `USER_SUPPLIED_URL`, and `ASSISTED_BROWSER` remain disabled.

At blueprint approval, this section was an implementation design only. Preparing it did not access SEEK, fetch a live job page, write browser automation, change submission behaviour, or implement Phase 2 source code. The later implementation result is recorded after the blueprint checkpoint below.

## A. State at blueprint approval

- Phase 0/1 is merged into `main`. Pull request #1 (`feat/bootstrap-applypilot` -> `main`) was merged normally at `2026-09-05T05:07:44Z`; merge commit and current merged baseline are `d4f15f862cbc0a976a82241a9a2ef76fda7099c0`. The remote bootstrap branch was deleted.
- The repository is the private GitHub repository `adeel1608/applypilot`. Phase 0/1 was revalidated immediately before merge with green local and GitHub checks, no reviews or unresolved review blockers, and no unexpected drift from the original `main` commit `dd39c7f9d313081d8b983c5b3a9644c7ce19d0c4`.
- The architecture is a strict TypeScript/npm-workspaces monorepo. `apps/web` is presentation-only; domain packages own schemas and deterministic behaviour; `packages/database` owns SQLite/Drizzle persistence; committed fixtures are fictional; authenticated browser state and candidate-private data remain local and ignored.
- `JobSourceAdapter` currently provides `sourceName`, `capabilities()`, `discoverJobs()`, `fetchJob()`, and `normalizeJob()`. The SEEK entry is an offline `PlaceholderAdapter` that throws `AdapterNotImplementedError` for every operation. Its declared `DISCOVERY` and `JOB_DETAILS` capabilities are design targets rather than proof of live support; Phase 2 must make operational availability explicit.
- `DiscoveryQuery` currently contains keyword and location arrays plus an optional opaque page cursor. `DiscoveryPage` contains source records plus an optional next cursor. These types need conservative, source-neutral extension for filters, limits, resumability, and validated checkpoint state.
- `JobSchema` is the normalized boundary. It already models source identity, source URL, location, employment flags, salary, hours, schedule, explicit and preferred requirements, experience, education, licences, vehicle, work rights, physical requirements, dates, source metadata, document requirements, eligibility, fit, and application state. Several presentation fields such as title, company, location, category, and description are required strings; a source record missing one of these cannot be silently filled and must fail normalization safely.
- `RawJobSourceRecord` currently preserves source, external ID, source URL, discovery time, and an unknown payload. `job_source_records` persists external ID, source URL, raw payload JSON, payload hash, discovery time, and fetch time against a normalized job. The `sourceId + externalId` unique index supplies a strong idempotency key.
- The database already has `jobs`, `job_sources`, `job_source_records`, `settings`, and append-only `audit_events`. It has no dedicated discovery-run or checkpoint table.
- The dashboard reads fifteen normalized `FIXTURE` jobs directly, evaluates eligibility and fit deterministically, and displays lists/details with disabled preparation controls. It is not database-backed and does not show refresh time, source URL, raw-record status, or adapter mode/readiness.
- Current limitations are: no SEEK-specific raw schema, no source client, no access-method decision, no query validation beyond TypeScript, no page/checkpoint orchestration, no retry/error taxonomy, no SEEK mapper, no source-specific fixture replay, no persistence service, and no live source support.

## B. Phase 2 objective

Enable ApplyPilot to discover and normalize SEEK job listings safely and reliably while preserving raw provenance and respecting access, security, privacy, policy, and rate boundaries. Phase 2 covers discovery and job details only. It does not cover application preparation, form interaction, or submission.

The implementation must remain useful in `FIXTURE_ONLY` and user-supplied-content modes if no public automated access method is approved. A public or browser-assisted mode is optional and may be implemented only after the research gate below records sufficient evidence and human approval.

## C. Non-goals

Phase 2 explicitly excludes:

- applying to jobs, filling SEEK forms, submitting applications, or changing the human-confirmation invariant;
- CAPTCHA, MFA, login, access-control, bot-detection, or rate-limit bypass;
- stealth browser techniques, fingerprint manipulation, proxy rotation, or credential/session storage;
- LinkedIn, Indeed, or any other source adapter;
- production deployment or scheduled unattended discovery;
- AI-generated candidate content, probabilistic requirement invention, semantic fuzzy merging, or inference that unknown fields are satisfied.

## D. SEEK technical research plan

No SEEK access was performed while preparing this blueprint. At implementation start, create an evidence-dated decision record in `docs/SEEK_ADAPTER.md` and investigate the following in order. Stop at the first method that is sufficiently complete, stable, and legitimately usable; do not assume scraping or authenticated access is required.

1. Officially documented or public interfaces.
2. Public listing pages.
3. Server-rendered structured data.
4. JSON-LD/schema.org `JobPosting` data.
5. Network responses made by publicly accessible job pages, inspected without defeating controls.
6. Browser-assisted discovery in a user-controlled local browser where legitimate.
7. User-supplied URLs or content as a fallback.

Every candidate method must be recorded with:

- evidence URL, evidence retrieval date, reviewer, and decision (`ALLOWED`, `CONDITIONAL`, `NOT_ALLOWED`, or `UNKNOWN`);
- whether authentication is required and whether any credential/session data would cross a trust boundary;
- stability/versioning, field completeness, pagination behaviour, and whether details require a second fetch;
- published limits and conservative request pacing, `Retry-After` handling, robots guidance, relevant terms/policy considerations, and acceptable use constraints;
- observed access denials, login walls, CAPTCHA, bot protection, or other stop signals;
- maintenance risk, failure visibility, and suitability for local automation;
- an explicit statement of what evidence would invalidate or require re-review of the decision.

The research matrix starts with every method marked `UNKNOWN/NOT_VALIDATED`. Reading public documentation does not by itself authorise page automation, and a technically reachable response is not automatically an approved interface. Network inspection must not replay private tokens, undocumented authenticated requests, or session-bound identifiers. If the review cannot establish a permitted automated path, Phase 2 proceeds with fixtures and user-supplied content only.

## E. Access modes

The SEEK implementation will use a runtime mode separate from capability names:

| Mode                    | Intended behaviour                                                                  | Initial state   | Phase 2 disposition                                       |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| `FIXTURE_ONLY`          | Replay fictional/redacted local records with no network                             | Not implemented | Required first; default for development and CI            |
| `PUBLIC_DISCOVERY`      | Discover jobs through an approved unauthenticated public method                     | Not validated   | Conditional on the research and human-review gates        |
| `PUBLIC_JOB_DETAILS`    | Fetch details through an approved unauthenticated public method                     | Not validated   | Conditional on the research and human-review gates        |
| `ASSISTED_BROWSER`      | Read a user-visible page in a local, user-controlled browser and stop on protection | Not validated   | Optional; no stealth, login automation, or session export |
| `USER_SUPPLIED_URL`     | Process a URL explicitly supplied by the user through an otherwise approved method  | Not validated   | Conditional; a supplied URL does not waive access rules   |
| `USER_SUPPLIED_CONTENT` | Parse content the user provides locally without retrieving it                       | Not implemented | Required fallback if the input can be safely validated    |

Configuration must reject an unvalidated or disabled mode. Adapter/status UI and logs must distinguish `FIXTURE_ONLY`, `AVAILABLE`, `DISABLED`, `REQUIRES_REVIEW`, and `SECURITY_STOP`; no label may imply live SEEK support until it was actually validated.

## F. Capability matrix

| Capability             | Phase 2 target | Constraint                                                                                      |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `DISCOVERY`            | Yes            | Only in fixture mode and in a separately approved public/assisted mode that passed its contract |
| `JOB_DETAILS`          | Yes            | Only in fixture mode and in a separately approved public/assisted mode that passed its contract |
| `ASSISTED_APPLICATION` | No             | Out of scope                                                                                    |
| `FORM_FILLING`         | No             | Must not be returned or implemented                                                             |
| `APPLICATION_STATUS`   | No             | Must not be returned or implemented                                                             |
| `SUBMISSION_SUPPORTED` | No             | Must not be introduced, returned, or implied                                                    |

`capabilities()` must describe operations that work in the configured mode, not aspirational support. A richer status report may be added without weakening the shared `JobSourceAdapter` boundary. The adapter must never fall through from one mode to another silently.

## G. Discovery query model

Introduce a Zod-validated, source-neutral discovery query while retaining adapter compatibility:

- `keywords: string[]`: trimmed, non-empty terms, de-duplicated case-insensitively.
- `location`: optional object with `text`, `suburb`, four-digit `postcode`, Australian `state`, and `radiusKm`.
- `employmentTypes`: zero or more of `CASUAL`, `PART_TIME`, `FULL_TIME`, `CONTRACT`, and `INTERNSHIP`; individual booleans must not contradict this list.
- `datePostedWithinDays`: optional positive integer; an unsupported source filter must be rejected or applied locally and reported, never ignored silently.
- `sortOrder`: `RELEVANCE` or `DATE_POSTED`.
- `pageCursor`: optional opaque cursor bound to the canonical query fingerprint.
- `pageSize`: optional positive integer with a local maximum of 100; the source-specific client may apply a smaller documented cap.

The initial configured use case is `keywords: []`, `suburb: Preston`, `postcode: 3072`, `state: VIC`, with a user-configurable radius. The local default is 25 km until reviewed; the adapter must map it only to a validated source option or fail with an explicit unsupported-filter result. Canonical query serialization sorts set-like arrays and hashes the normalized value so retries and checkpoints cannot be attached to a different query.

## H. Pagination and checkpointing

Use an opaque, versioned cursor and a durable checkpoint with no credentials:

- Cursor fields: schema version, source, access mode, query fingerprint, source cursor/page token, logical page number, and previous-page identity hash.
- Checkpoint fields: schema version, run/query ID, source/mode, query fingerprint, next cursor, last successful fetch timestamp, last successfully committed page, processed page identities, discovered/added/updated/duplicate/failed counts, and expiry timestamp.
- Validate every decoded cursor/checkpoint with Zod. Reject version, source, mode, or query-fingerprint mismatches.
- Commit normalized jobs and source records transactionally; advance the checkpoint only after the page transaction succeeds. A process crash may replay the last page, which idempotency must make safe.
- Compute a page identity from ordered external IDs/canonical URLs plus the page cursor. If the same page identity reappears without progress, stop with `DUPLICATE_PAGE` instead of looping.
- Default limits: 10 pages and 200 distinct jobs per run. Both are locally configurable only within documented caps; reaching a cap returns a safe partial completion and resumable checkpoint.
- A checkpoint older than 24 hours is stale by default. Resume requires the same canonical query and mode; otherwise start a new run while retaining a redacted audit event for the stale checkpoint.
- Store checkpoints under a namespaced `settings` key such as `discovery.seek.checkpoint.<queryHash>` and never include URLs containing sensitive query parameters, cookies, headers, HTML, or browser state.

## I. Rate-limit and failure model

Add a typed `SeekAdapterError` with `code`, `retryable`, `humanActionRequired`, `safeRetryAfter` (an ISO 8601 timestamp or `null`), sanitized `sourceUrl`, redacted diagnostic code/message, and optional cause class without raw response content.

| Code                     | Default retryable | Human action  | Required behaviour                                                           |
| ------------------------ | ----------------- | ------------- | ---------------------------------------------------------------------------- |
| `RATE_LIMITED`           | Yes               | No            | Honour valid `Retry-After`; stop the run; never evade the limit              |
| `AUTH_REQUIRED`          | No                | Yes           | Stop; do not request, store, or replay credentials                           |
| `CAPTCHA_DETECTED`       | No                | Yes           | Immediate security stop; no solver or alternate path                         |
| `BOT_PROTECTION`         | No                | Yes           | Immediate security stop; do not disguise automation                          |
| `ACCESS_DENIED`          | No                | Yes           | Stop and require policy/access review                                        |
| `PAGE_CHANGED`           | No                | Yes           | Quarantine the record/fixture and require parser review                      |
| `NETWORK_ERROR`          | Yes               | No            | Bounded retry with jitter; no retry when a protection signal is suspected    |
| `MALFORMED_RESPONSE`     | No                | Yes           | Preserve safe provenance/hash, reject normalization, continue only by policy |
| `JOB_REMOVED`            | No                | No            | Mark the source record unavailable; do not synthesize a replacement          |
| `NOT_FOUND`              | No                | No            | Record a safe miss and stop retrying                                         |
| `UNSUPPORTED_PAGE`       | No                | Yes           | Do not guess a parser                                                        |
| `RETRYABLE_SERVER_ERROR` | Yes               | No            | Bounded retry using conservative backoff                                     |
| `NON_RETRYABLE_ERROR`    | No                | As classified | Stop or skip according to the explicit run policy                            |
| `DUPLICATE_PAGE`         | No                | Yes           | Stop pagination to prevent an infinite loop                                  |
| `CHECKPOINT_MISMATCH`    | No                | Yes           | Refuse resume and keep the stale checkpoint for review                       |

Retries are capped at three per request and five retryable failures per run. `safeRetryAfter` is the later of a valid server instruction and the local conservative backoff. Repeated rate limiting ends the run. Logs must never contain cookies, authorization headers, tokens, complete response bodies, or unredacted query strings.

## J. Raw SEEK source record

Create a Zod schema for a versioned `SeekRawJobRecord`. It will contain, where available:

- source fixed to `SEEK`, schema/parser version, access mode, external job ID, canonical job URL, and discovery source-page URL;
- title, company, advertiser, location, salary text, employment type/work type, classification, subclassification, posting text/date, description, and any source-provided requirements;
- `discoveredAt`, `fetchedAt`, raw byte/content hash, content type, and retrieval result;
- the untouched raw payload or locally supplied source content, plus a `fieldProvenance` map identifying the structured-data/visible-text/payload path used for each extracted field;
- safe parser warnings and an `unknownFields` object. The Zod boundary should use deliberate passthrough/capture so newly observed source fields are retained rather than silently discarded.

Hash the raw bytes before parsing. Successful persisted records retain the raw payload and hash in `job_source_records`; fixtures retain their fictional source content in Git. Live/user-supplied raw content remains local and is never logged or uploaded. Fields that are absent stay absent. A confidential employer label may be retained only if the source explicitly supplies it; a missing employer must not become a fabricated company.

## K. Normalization mapping

The SEEK mapper must produce a `JobSchema` value or a typed safe failure:

| Normalized field                 | SEEK input/mapping rule                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `title`                          | Trim the explicit listing title; absence is `MALFORMED_RESPONSE`                                                |
| `company`                        | Use explicit company/advertiser display text; if truly absent, fail safely rather than inventing a company      |
| `location/suburb/postcode/state` | Preserve full text; populate components only from explicit structured fields or an unambiguous validated parser |
| `employmentType` + flags         | Map explicit work-type text; otherwise `UNKNOWN` with all flags false                                           |
| `salary`                         | Preserve salary text; parse bounds/currency/period only when syntax is deterministic, otherwise keep `null`     |
| `hours`                          | Populate weekly/fortnightly ranges only from explicit numeric statements; otherwise `null`                      |
| `schedule`                       | Preserve summary; set fixed/shifts only for explicit days/times, otherwise nullable/empty                       |
| `requirements`                   | Include only spans classified `EXPLICIT_REQUIREMENT`                                                            |
| `preferredRequirements`          | Include only spans classified `PREFERRED_REQUIREMENT`                                                           |
| `experienceRequirements`         | Extract explicit description, mandatory marker, and numeric minimum only when stated                            |
| `educationRequirements`          | Extract stated qualification text/keywords without equating related qualifications                              |
| `licences`                       | Map explicitly named licence/check requirements; role title alone is not evidence                               |
| `vehicleRequirement`             | `REQUIRED` only for explicit own-vehicle language; otherwise `NOT_REQUIRED` only if explicit, else `UNKNOWN`    |
| `workRightsRequirement`          | Map explicit unrestricted/valid Australian work-right language; otherwise `NOT_SPECIFIED`/`UNKNOWN`             |
| `physicalRequirements`           | Preserve explicit physical-duty/ability text without medical inference                                          |
| `datePosted`                     | Use an explicit timestamp or the deterministic relative-date rule below; otherwise `null`                       |
| `dateDiscovered`                 | Copy the validated discovery timestamp                                                                          |
| `coverLetterRequired`            | `true` only from explicit source instruction; otherwise `false` plus raw unknown metadata if ambiguous          |

`sourceMetadata` carries SEEK classification/subclassification, advertiser, work-type text, posting text, fetch time, raw hash, parser version, access mode, and normalization warnings. Raw text remains in the source record even after a structured value is produced. No source text may be strengthened: “preferred” cannot become mandatory, “valid work rights” cannot become unrestricted, and an absent fact cannot become positive.

## L. Requirement extraction

Use a deterministic, auditable sentence/list-item pipeline:

1. Extract visible/structured requirement spans without rewriting them.
2. Normalize whitespace and punctuation for matching while retaining the original span.
3. Apply negation rules before positive markers, including `experience not required`, `no experience required`, and `training provided`.
4. Classify strong markers such as `must have`, `required`, and `essential` as `EXPLICIT_REQUIREMENT` only when they grammatically govern the same span.
5. Classify `preferred` and `desirable` as `PREFERRED_REQUIREMENT`.
6. Classify conflicting, incomplete, scope-unclear, or unmatched material language as `AMBIGUOUS_REQUIREMENT` and append the original span to `job.ambiguities`.
7. Apply narrow extractors for `unrestricted work rights`, `valid Australian working rights`, named driver licences, own-vehicle requirements, Working With Children Check/`WWCC`, and police checks. Never infer a licence or vehicle requirement from a driver/warehouse role title alone.

Every extracted item records its class, original text, normalized text, matched rule ID, source field/path, and parser version. Unmatched language is preserved. This is a rules engine with golden fixtures, not an NLP generation or hallucination system.

## M. Date normalization

- Preserve the exact original posting text in raw/source metadata.
- Prefer an explicit machine timestamp when present and valid.
- For exact relative forms such as `Listed one day ago`, `Listed three days ago`, or `Listed eighteen days ago`, map the supported number word/integer and subtract that many 24-hour periods from the immutable `discoveredAt` instant, returning an ISO 8601 UTC timestamp.
- `Listed today` may map to `discoveredAt`; ambiguous forms such as `about a month ago`, malformed numbers, future dates, or unsupported language produce `datePosted: null` plus a parser warning/ambiguity.
- Tests use a fixed discovery clock and cover midnight/time-zone boundaries. Retries reuse the original discovery timestamp so the same raw record cannot drift by a day.

## N. Duplication and idempotency

Use only strong deterministic signals in Phase 2:

1. Primary identity: `(source = SEEK, externalId)`.
2. Secondary exact identity: normalized canonical URL when the external ID is absent or under review. Derive an external ID from a URL only after an exact, validated URL-pattern match; otherwise fail safely.
3. Change detection: raw payload hash.
4. Existing cross-source deduplication signals remain review-only; do not add semantic or fuzzy merging.

Canonicalization removes fragments and only documented tracking parameters, retains parameters that may identify a job, normalizes host/path casing where safe, and records the original URL. An unchanged repeat increments duplicate counters and does not add a job. A changed hash updates the normalized job/source record transactionally and writes a redacted audit event containing old/new hashes and timestamps. Concurrent insertion relies on the existing unique source/external index and resolves conflicts by rereading, never by creating a second job. The checkpoint advances only after this outcome is committed.

## O. Database impact

Planned migration requirement: **NO**.

- `jobs` stores the current normalized SEEK job and evaluation fields.
- `job_sources` stores the SEEK source, enabled state, and actual capability/status metadata.
- `job_source_records` stores current raw provenance, exact source URL, external ID, payload hash, discovery time, and last fetch time; its unique source/external index supports idempotent upsert.
- `settings` stores versioned, namespaced checkpoint JSON validated on read/write.
- `audit_events` records run start/completion, refresh/hash transitions, errors, caps, and security stops using redacted metadata.

The Phase 2 implementation must first prove this design with transaction and restart tests. A migration is not approved by this blueprint. If the implementation demonstrates a genuine need for raw fetch history, failed-record quarantine, or queryable discovery-run analytics that the current tables cannot safely represent, stop, amend this blueprint with the exact migration and rollback, and obtain human review before changing the schema.

## P. Dashboard impact

Plan only minimal provenance/status additions:

- Jobs list: add a `Source` column/badge and preserve existing decision/score presentation.
- Job detail: show source, safe source URL, date discovered, date posted or `Unknown`, last refreshed, and a raw-provenance-present indicator/hash prefix without rendering the raw payload.
- Settings: show SEEK adapter mode and state (`fixture`, disabled, review required, available, or security stopped) and make unsupported capabilities explicit.
- Dashboard: optionally add a small per-source count/status line; do not redesign the page or add application controls.

External links use safe `https` URLs and clear labels. The UI must never display cookies, request headers, raw authenticated content, or a misleading “live” status. Existing eligibility, fit, and disabled application controls remain unchanged.

## Q. Security and privacy

- Never store SEEK passwords in SQLite, config, fixtures, logs, or Git.
- Never commit or upload cookies, browser profiles, session/storage states, authorization headers, tokens, downloaded personal documents, or authenticated response bodies.
- Never place browser session state in a cloud component. An approved future assisted mode may use only a user-controlled local browser and must not export its state.
- CAPTCHA, MFA, login walls, access restrictions, bot protection, unexpected interstitials, and rate limits stop automation and emit a redacted human-action event.
- Do not rotate identities/proxies, spoof fingerprints, replay hidden tokens, or use alternative endpoints to route around a stop.
- Redact URL query values except documented non-sensitive filters, strip fragments, cap diagnostic lengths, and log hashes/IDs rather than full payloads.
- Validate all queries, cursors, checkpoints, source records, database JSON, and normalized jobs with Zod at their boundaries.
- Candidate truth data is not an adapter input. Discovery and normalization must not send or derive candidate facts, and evaluation occurs only after normalized persistence.

## R. Fixture strategy

Create fictional/redacted fixture records under `fixtures/seek/` with a manifest and expected normalized/error outcomes. Planned files are:

- `retail-assistant.json`
- `nandos-team-member.redacted.json`
- `junior-receptionist.json`
- `customer-service.json`
- `engineering-internship.json`
- `warehouse-role.json`
- `driver-role.json`
- `healthcare-qualified-role.json`
- `unrestricted-work-right-role.json`
- `missing-salary.json`
- `missing-company.json`
- `missing-requirements.json`
- `malformed-job.json`
- `removed-job.json`
- `duplicate-job-page.json`
- `manifest.ts`

The Nando's-style case is safely redacted/reconstructed rather than copied from a live advert. The duplicate fixture includes repeated and changed-hash variants. Fixtures contain fixed timestamps, fictional IDs/URLs/employers/contact-free descriptions, raw field-path provenance, and expected classification/mapping outcomes. No live content is committed merely because it is publicly viewable.

## S. Test plan

- Unit tests: raw/query/cursor/checkpoint Zod schemas, URL canonicalization/redaction, hashing, relative dates, salary/hours parsing, work-type mapping, and deterministic requirement rules.
- Adapter contract tests: source name, mode-specific capabilities, discover/fetch/normalize behaviour, explicit unsupported methods, and no form/submission capability.
- Fixture replay: every manifest case parses deterministically and matches its checked expected normalized result or typed failure.
- Normalization tests: every mapping in section K, field provenance, passthrough unknown fields, explicit-vs-preferred-vs-ambiguous requirements, and required-field failures.
- Pagination tests: next-cursor progression, query-bound cursors, empty final page, max pages/jobs, repeated pages, reordered records, and partial completion.
- Checkpoint tests: crash before/after transaction, resume, stale/mismatched/corrupt checkpoints, and deterministic counters.
- Idempotency/duplicate tests: same external ID/hash, same external ID/changed hash, canonical URL fallback, concurrent conflict, and no semantic merge.
- Error/rate tests: every error code and flags, valid/invalid `Retry-After`, bounded retry, repeated-limit stop, server errors, removed/not-found jobs, and redaction.
- Security-stop tests: CAPTCHA, MFA/login wall, bot protection, access denial, unexpected page, and assurance that no fallback/retry bypass occurs.
- Unknown-field tests: missing salary, requirements, work rights, schedule, date, and unsupported extra fields remain unknown/preserved; missing required company fails safely.
- Integration: SEEK fixture -> adapter -> raw schema -> normalization -> transactional persistence -> eligibility -> fit, including restart and repeat runs.
- Regression: all existing fifteen fixture results, eligibility status counts, fit score bounds/explanations, candidate truth rules, database migration test, and preparation-only runner remain unchanged.
- Dashboard integration/E2E: source/provenance/status fields render safely; unknown dates/companies are honest; submission controls remain disabled; raw content is not exposed.
- Quality gates: format check, lint, strict typecheck, unit tests, integration tests, E2E tests, production build, dependency audit, secret/ignored-artifact audit, and GitHub CI.

All tests use fixed clocks, fixture transports, mocks, and a temporary/in-memory SQLite database. CI performs no SEEK network request.

## T. Observability

Emit structured local events for:

- `discovery.run.started` with run ID, mode, query hash, and configured caps;
- `discovery.page.completed` with page number and aggregate counts;
- `discovery.job.added`, `updated`, `duplicate`, or `failed` with redacted source ID/hash;
- `discovery.rate_limited` with safe retry time;
- `discovery.security_stopped` with stop code and human-action flag;
- `discovery.run.completed` or `partial` with pages processed, jobs discovered/added/updated/duplicated/failed, checkpoint presence, and duration.

Run IDs are random local identifiers. Logs/audit records exclude raw payloads, source descriptions, cookies, tokens, headers, browser state, candidate data, and unredacted URLs. Error causes are allowlisted into short stable diagnostic codes rather than serialized wholesale.

## U. Implementation file plan

Expected files to create:

- `docs/SEEK_ADAPTER.md`
- `packages/job-sources/src/seek/index.ts`
- `packages/job-sources/src/seek/types.ts`
- `packages/job-sources/src/seek/schemas.ts`
- `packages/job-sources/src/seek/errors.ts`
- `packages/job-sources/src/seek/query.ts`
- `packages/job-sources/src/seek/dates.ts`
- `packages/job-sources/src/seek/requirements.ts`
- `packages/job-sources/src/seek/normalizer.ts`
- `packages/job-sources/src/seek/fixture-client.ts`
- `packages/job-sources/src/seek/adapter.ts`
- `packages/job-sources/src/seek/schemas.test.ts`
- `packages/job-sources/src/seek/normalizer.test.ts`
- `packages/job-sources/src/seek/adapter.contract.test.ts`
- `packages/database/src/job-discovery-repository.ts`
- `packages/database/src/job-discovery-repository.test.ts`
- the sixteen fixture/manifest files listed in section R
- `tests/integration/seek-fixture-pipeline.test.ts`

Expected files to modify:

- `PROJECT_PLAN.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `README.md`
- `docs/JOB_SOURCE_ADAPTERS.md`
- `docs/JOB_NORMALIZATION.md`
- `packages/job-sources/src/index.ts`
- `packages/job-sources/src/index.test.ts`
- `packages/job-sources/package.json` if explicit workspace dependencies or exports are required
- `packages/database/src/index.ts`
- `packages/database/package.json` if explicit workspace dependencies are required
- `apps/web/lib/data.ts`
- `apps/web/app/jobs/page.tsx`
- `apps/web/app/jobs/[id]/page.tsx`
- `apps/web/app/settings/page.tsx`
- `tests/e2e/dashboard.spec.ts`
- `tests/fixture-data.ts` and `tests/integration/fixture-pipeline.test.ts` only if the shared fixture loader needs a source-neutral extension

Conditional file, forbidden until the access review explicitly approves a public method:

- `packages/job-sources/src/seek/public-client.ts`

No database migration, application-runner change, application form/submission file, browser-auth state, live payload, or generated personal document is planned. Every created/modified TypeScript file above is covered by a direct unit/contract/integration test or by the production build/E2E suite. Before editing `apps/web`, the implementation must read the applicable Next.js 16 guidance under `node_modules/next/dist/docs/` as required by `apps/web/AGENTS.md`.

## V. Implementation order

1. Re-read repository instructions/blueprint and confirm the branch still starts from the approved merged baseline.
2. Complete the dated technical/policy research matrix and obtain human approval for any non-fixture access mode.
3. Add source-neutral query, cursor, checkpoint, capability-status, and error contracts with Zod tests.
4. Add the SEEK raw schema, safe hashing, provenance capture, and redaction utilities.
5. Add deterministic date and requirement extractors with golden tests.
6. Add the SEEK mapper into the existing normalized `Job` contract, including unknown and malformed cases.
7. Implement `FIXTURE_ONLY` and `USER_SUPPLIED_CONTENT` clients, then pass the common adapter contract and all fixture replay tests.
8. Implement pagination, caps, checkpoint validation/resume, retry classification, and security stops using fixture transports.
9. Add transactional persistence/idempotent upsert using existing tables and prove restart/concurrency behaviour.
10. Only if separately approved, implement the lowest-risk validated public or assisted source method in `public-client.ts`; otherwise record it as blocked and keep fixture/content modes.
11. Integrate normalized fixture-derived SEEK records with eligibility and fit and confirm candidate truth invariants.
12. Add the minimal dashboard provenance/status fields after reading the local Next.js 16 documentation.
13. Complete unit, contract, fixture, integration, security, rate, duplicate, dashboard, and E2E tests.
14. Update architecture, adapter, normalization, security, README, and this plan with actual behaviour and limitations.
15. Run all quality/security audits, push the feature branch, and open an unmerged PR for human review.

## W. Risks and mitigations

| Risk                                | Mitigation                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SEEK markup/structured data changes | Version parsers, validate boundaries, use fixture replay, emit `PAGE_CHANGED`, and require review before repair |
| Policy or robots restrictions       | Evidence-dated access decision, fixture/content fallback, no access when status is unknown or disallowed        |
| Anti-bot behaviour                  | Detect and stop; no stealth, proxy rotation, challenge solving, or alternate-route evasion                      |
| Missing structured fields           | Preserve raw content, use null/`UNKNOWN`, fail required-field normalization safely, and surface review          |
| Relative-date ambiguity             | Fixed discovery instant, narrow grammar, original text retention, and null plus warning for unsupported forms   |
| Duplicate listings/pages            | Strong source ID/URL/hash keys, page identity, unique DB index, transactional checkpoint, no fuzzy merge        |
| Removed listings                    | Typed terminal result and audit event; retain existing provenance without inventing current details             |
| Location parsing                    | Prefer structured components, narrow Australian parser, preserve full text, and leave uncertain parts null      |
| Salary parsing                      | Narrow deterministic grammar, raw text preservation, nullable structure, and currency/period validation         |
| False requirement extraction        | Marker/negation precedence, original spans, rule IDs, ambiguity class, and golden/adversarial tests             |
| Unexpected login walls              | `AUTH_REQUIRED` security stop; no credentials, session export, or automatic mode fallback                       |
| Rate limiting/server instability    | Low caps, conservative pacing, `Retry-After`, bounded retries, resumable checkpoints, and run termination       |
| Cursor/source drift                 | Version/query-bound cursors, stale expiry, duplicate-page detection, and explicit mismatch failures             |
| Raw-content privacy/copyright       | Fictional/redacted committed fixtures; local-only user/live content; hashes/redacted metadata in logs           |
| Existing-schema limits              | Prove current-table design first; stop and re-plan before any migration                                         |

## X. Rollback plan

- Keep the Phase 2 implementation on `feat/seek-discovery-implementation` and leave its implementation PR unmerged until review and gates pass.
- The adapter remains dependency-injected and defaults to `FIXTURE_ONLY`; disabling/removing SEEK registration restores the Phase 0/1 offline placeholder without touching candidate data or other adapters.
- Revert Phase 2 commits normally. Do not rewrite `main` history or reset user changes.
- No schema migration is planned. If Phase 2 is reverted, namespaced checkpoint settings and SEEK job/source/audit rows can be ignored; any cleanup of a real local database requires an explicit backup and separate user-approved operation.
- Fixture-driven dashboard data remains the fallback. UI provenance additions are additive and can be reverted independently of eligibility, fit, resume, cover-letter, application-runner, and tracker packages.
- Because no submission behaviour, candidate schema, or generated-document format changes are planned, rollback cannot trigger an application, alter profile truth, or invalidate existing documents.

## Y. Phase 2 acceptance criteria

Phase 2 must not be marked `COMPLETE` unless:

- the SEEK implementation remains behind `JobSourceAdapter`, and `capabilities()`/mode status report only verified behaviour;
- raw source provenance, source URL, external ID, discovery/fetch timestamps, parser version, and payload hash are preserved;
- no candidate fact is invented or supplied to discovery, and no job requirement is silently inferred;
- `EXPLICIT_REQUIREMENT`, `PREFERRED_REQUIREMENT`, and `AMBIGUOUS_REQUIREMENT` remain distinguishable and traceable to raw spans;
- CAPTCHA, MFA/auth, bot-protection, access-denied, page-change, and rate-limit stops work without bypass or silent fallback;
- pagination, caps, checkpoints, crash recovery, and stale handling are deterministic;
- repeated discovery and concurrent conflicts are idempotent by source/external ID, canonical URL, and payload hash;
- malformed, removed, missing, and unknown data fail or degrade safely while preserving permitted provenance;
- fixture replay and the common adapter contract pass without a SEEK network request in CI;
- eligibility and fit integration remain deterministic and all Phase 0/1 regressions pass;
- the dashboard exposes only safe provenance/status and retains disabled submission controls;
- no password, cookie, browser state, credential, live private payload, personal CV, private profile, or local database is tracked;
- documentation states the validated access modes and limitations without overstating live support;
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, and `npm audit` pass;
- `PROJECT_PLAN.md` records actual commands/results, unfinished work, blockers, rollback status, and the next task;
- the feature branch is pushed and an unmerged pull request into `main` exists for human review.

## Z. Human review checkpoint

The blueprint was committed, pushed, and opened as documentation-only PR #2. The owner approved it on 2026-09-05 and authorised a normal merge followed by implementation on the new `feat/seek-discovery-implementation` branch. The later implementation PR must remain unmerged for a separate human review. Network-backed SEEK modes still require the independent access-research approval defined in section D.

## Blueprint checkpoint execution record

The Phase 0/1 merge gate was re-run on 2026-09-05 before merging:

- `npm run format:check`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed in strict mode.
- `npm test`: 37 tests passed across 9 files.
- `npm run test:integration`: 1 integration test passed across the 15-job fixture pipeline.
- `npm run build`: passed; 23 static pages generated.
- `npm run test:e2e`: 4 Chromium tests passed.
- `npm audit`: passed with 0 vulnerabilities.
- `git diff --check` and `git fsck --no-reflogs --full`: passed.
- On the Phase 2 branch, `npm run format` normalized the Windows checkout's CRLF-only working-copy mismatch without introducing an application-file diff; the subsequent `npm run format:check` and staged `git diff --check` passed.
- Git/history audit: no high-confidence committed secrets; no tracked private profile, generated PDF, database, cookie, browser-session, or auth-state artifacts. The one local demonstration PDF was ignored and untracked.
- GitHub: repository remained private; PR #1 was `MERGEABLE`/`CLEAN`; both `quality` checks passed; no reviews or review blockers existed; `main` had not drifted.

Merge/branch results:

- PR #1 status: `MERGED`.
- Merge commit/main baseline: `d4f15f862cbc0a976a82241a9a2ef76fda7099c0`.
- Merge timestamp: `2026-09-05T05:07:44Z` (`2026-09-05 15:07:44 AEST`).
- Remote `feat/bootstrap-applypilot`: deleted.
- Phase 2 blueprint branch: `feat/seek-discovery-adapter`, created from the merged baseline and pushed.

Unfinished work is the entire Phase 2 implementation described above. It is deliberately not started on the blueprint branch. Blueprint approval is complete; the access-method research decision remains an independent gate for any network-backed mode.

## Phase 2 implementation execution record

### State and access decision

- Execution date: 2026-09-05 (Australia/Sydney).
- Implementation branch: `feat/seek-discovery-implementation`, created and pushed from blueprint merge `90a9eafaad32780a81653b3739c19ce95a22d951`.
- Implementation pull request: #3, `https://github.com/adeel1608/applypilot/pull/3`, opened into `main`, received the owner's explicit review/merge approval, and was merged normally at `2026-09-05T06:42:34Z`. The merge commit is `cd3e13699cef3e41b8e3edd56239435ca647d66b`. Focused implementation commits are `6613f126e94845313dec4d2666f85ec7a9eb8370` (adapter/fixtures), `1998f289cf6077e88a349b6d62ca081813e0419e` (database), `0dbcfa954e55494c9650a0eb8efe99019abc361c` (dashboard), `ad8c7aad0a0b7f1248a0ee5ec05f82f4f278352d` / `10a2e51c53934d378c8f26eb412250480ac14a93` (implementation/CI records), and `6ad9e987d8bc8d4ced6abf7d28fdad36f3003416` (final truthfulness/retry refinement).
- Current Phase 2 status: `COMPLETE` and closed. Pull request #3 is merged, refreshed local `main` equals `origin/main` at the merge commit, and the implementation branch is deleted locally and remotely.
- The evidence-dated research in `docs/SEEK_ADAPTER.md` completed the required method review in order. The official partner API remains `CONDITIONAL` and disabled because ApplyPilot has no SEEK approval/credentials and the reviewed documentation did not establish a permitted candidate-facing public discovery scope. SEEK website automation is `NOT_ALLOWED` under the reviewed terms. Robots guidance remains `UNKNOWN` and is not treated as permission.
- Enabled modes are `FIXTURE_ONLY` and local `USER_SUPPLIED_CONTENT`. `PUBLIC_DISCOVERY`, `PUBLIC_JOB_DETAILS`, `USER_SUPPLIED_URL`, and `ASSISTED_BROWSER` are disabled and fail closed without fallback. No SEEK listing/page/network response was fetched, no `public-client.ts` was created, and live SEEK access is not claimed.

### Actual architecture implemented

- The shared `DiscoveryQuery` was extended source-neutrally with structured Australian location/radius, employment types, posting window, sort order, cursor, and bounded page size while preserving `JobSourceAdapter` compatibility.
- `packages/job-sources/src/seek/` now owns Zod contracts for mode/status/query/cursor/checkpoint/raw records/provenance/warnings, typed errors, canonical query and payload hashing, dates, requirements, normalization, the injected fixture client, local user-content parsing, and bounded checkpointed orchestration.
- The registered SEEK adapter defaults to an empty `FIXTURE_ONLY` transport. Its operational capability report exposes only fixture discovery/details or local content details for the configured mode; disabled modes expose no capabilities. No application, form, status, or submission capability was added.
- User-supplied JSON/raw or schema.org `JobPosting` content is parsed locally only after a validated HTTPS SEEK job URL pattern. URL-only input and recognizable authentication/session material are rejected. Exact supplied content is hashed and retained locally as raw provenance; audit events receive no raw content.
- Deterministic normalization preserves source ID/URL, raw hash, fixed discovery/fetch timestamps, parser version, source field paths, warning evidence, and captured unknown fields. Required title/company-or-explicit-advertiser/location/country/category/description absence is a typed safe failure.
- Requirement rules preserve original text, normalized text, source path, rule ID, classification, and negation. Valid Australian work rights stay distinct from unrestricted rights. Narrow date, employment, salary, hours, location, experience, education, licence, vehicle, physical, and training mappings never guess unsupported facts.
- Fixture discovery supports filtering, date sorting, postcode-3072 radius calculations from explicit fixture distance metadata, query-bound opaque cursors, 10-page/200-record defaults, configurable caps, 24-hour checkpoint expiry, resume, empty results, maximum-page/job partial results, and repeated-page protection.
- `JobDiscoveryRepository` reuses `jobs`, `job_sources`, `job_source_records`, `settings`, and `audit_events`. A page transaction inserts/updates normalized jobs and raw records, resolves same-hash duplicates, records redacted job transitions, and only then advances the validated checkpoint. Concurrent checkpoint owners fail with `SEEK_CONCURRENT_CHECKPOINT_CONFLICT` rather than creating duplicate jobs.
- Structured events cover run start/page/job outcomes, rate limits, security stops, partial runs, and completed runs using safe IDs, hashes, counts, durations, timestamps, and stable codes. Errors retain only a cause class, sanitized HTTPS source path, and safe retry time rather than raw causes or query values.
- The server-rendered fixture dashboard now evaluates 11 unique normalized SEEK jobs alongside the original 15 fixtures. It displays source, source URL, discovered/posted/refreshed dates, provenance, mode/status, counts, failures, duplicates, and the explicit live-mode limitation. Application preparation/submission controls remain disabled.

### Files created or changed

- Created the 10 planned SEEK implementation files and three direct test files under `packages/job-sources/src/seek/`.
- Created 15 fictional/redacted JSON fixture cases plus `fixtures/seek/manifest.ts` with fixed timestamps, safe `.example.test` URLs, expected normalization/classification/errors, malformed/removed coverage, and duplicate-page data.
- Created `packages/database/src/job-discovery-repository.ts`, its unit test, and `tests/integration/seek-fixture-pipeline.test.ts`; exported the repository/raw SQLite handle without changing the schema or migration.
- Updated shared adapter registration/contracts, dashboard data/pages/settings/styles/E2E, `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/SEEK_ADAPTER.md`, `docs/JOB_SOURCE_ADAPTERS.md`, `docs/JOB_NORMALIZATION.md`, and this living plan.

### Tests and validation completed locally

- `npm run format:check`: passed; all matched files use Prettier formatting.
- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed in strict mode.
- `npm test`: 63 tests passed across 13 files. This includes the 15-case fixture replay, raw/query/cursor/checkpoint boundaries, requirement/date semantics, mode gating, pagination/caps/duplicate pages, every typed error contract, rate/security stops, sensitive-input rejection, no-network assertions, unknown fields, database idempotency/update/rollback/concurrency, and Phase 0/1 regressions.
- `npm run test:integration`: 3 tests passed across 2 files. The SEEK pipeline covers checkpoint resume, 14 active discoveries, 11 inserts, 1 duplicate, 2 typed normalization failures, transactional persistence, completed-run replay, and downstream eligibility/fit evaluation.
- `npm run build`: passed with Next.js 16.3.4; 34 static pages were generated, including 26 fixture-derived job detail paths.
- `npm run test:e2e`: 5 Chromium tests passed, including safe SEEK provenance/status, no raw-payload rendering, and disabled application preparation.
- `npm audit`: passed with 0 vulnerabilities. `npm run audit:production` also passed with 0 vulnerabilities.
- `git diff --check`: passed. High-confidence workspace secret-pattern scan, tracked sensitive-artifact scan, and tracked-ignored-file audit returned no matches. `git fsck --no-reflogs --full` returned success with one benign dangling blob. GitHub reported `adeel1608/applypilot` as `PRIVATE` with `main` as its default branch.
- Final CI result before merge: pull request #3 (`feat/seek-discovery-implementation` -> `main`) was mergeable and clean. Both final `quality` checks passed (GitHub Actions runs `33950063807` and `33950064759`); the owner supplied explicit approval in the Phase 2 closeout instruction.

### Errors encountered and fixes

- Windows PowerShell blocked `npm.ps1`; all requested npm/npx commands were rerun successfully through `npm.cmd`/`npx.cmd`.
- An exploratory `npm test -- --runInBand` invocation failed because Vitest 4 does not support that Jest option; the required repository command `npm test` was rerun and passed.
- The first full fixture test found that a preferred customer-service experience statement was correctly retained as a non-mandatory experience rather than omitted; the assertion was corrected while keeping “no experience required” negated.
- The first production build failed because a colon in the normalized SEEK job ID became an invalid Windows static-segment directory name. The deterministic separator was changed to a filesystem-safe hyphen; the subsequent build and E2E suite passed.
- Final review identified that the required normalized boolean alone could display an absent cover-letter instruction as “not required.” The raw nullable value is now preserved in source metadata and the SEEK UI displays `Unknown`; bounded retries also use jitter while a future `Retry-After` still stops unscheduled retries. All local gates were rerun and passed after this refinement.

### Database, migration, security, and rollback result

- Database result: existing Phase 0/1 tables are sufficient. Transaction, restart/resume, same-hash duplicate, changed-hash update, rollback, and concurrent-owner behaviours are covered by tests.
- Migration result: `NO`. `packages/database/drizzle/0000_applypilot_foundation.sql` is unchanged.
- Security result: no CAPTCHA/MFA/access-control/bot/rate bypass, no silent access-mode fallback, no live source call, no candidate data in discovery, no weakened candidate truth or human-confirmation invariant, and no tracked credential/private profile/database/browser state/cookie/generated personal CV.
- Rollback remains additive and ready: revert the Phase 2 implementation commits normally, restore the SEEK placeholder registration if required, and leave any local namespaced checkpoint/source/audit rows untouched unless the user separately approves a backed-up data cleanup. No schema rollback is needed.

### Limitations, remaining work, and next task

- Live SEEK discovery/details are unavailable. The official API requires a future approved integration and verified scope; website/URL/browser retrieval remains disabled. Fixture radius calculations are intentionally available only from postcode 3072 because the fixtures contain explicit distances from that origin; another origin fails as unsupported rather than being guessed.
- `USER_SUPPLIED_CONTENT` is a programmatic local adapter entry point, not an upload/paste UI. It handles one validated raw/JSON-LD job record at a time and does not paginate or fetch links.
- SQLite stores the current source payload per strong source/external ID, not raw version history. Cross-source/fuzzy semantic merging is intentionally deferred.
- Remaining Phase 2 implementation work: none. The human review/merge checkpoint was satisfied, the normal merge completed, and Phase 2 is closed without enabling live SEEK access.
- Exact next approved planning checkpoint after merge of the Phase 2 implementation PR: **Phase 2.5 — Real-World Job Intake**, creating a source-neutral local paste/upload pipeline before any Phase 3 Indeed work. Phase 3 is not started.

# Phase 2.5 - Real-World Job Intake Blueprint

- Blueprint status: `APPROVED`
- Roadmap status at blueprint approval: `IN_PROGRESS` (historical); current status: `COMPLETE`
- Prepared on: 2026-09-05
- Amended on: 2026-09-05 after human review identified the candidate-profile, hostname, URL-policy, credential-detection, identity, provenance, and retention gates below.
- Planning branch: `feat/real-world-job-intake-plan`
- Planning base: Phase 2 merge commit `cd3e13699cef3e41b8e3edd56239435ca647d66b`
- Scope: blueprint only; no importer, parser, upload route, profile loader/provider, URL fetcher, source adapter, migration, or application behaviour is implemented by this planning pull request.

Historical implementation-start checkpoint (satisfied by the later closeout record):

- The owner explicitly approved PR #4 and the amended Phase 2.5 blueprint on 2026-09-05 and authorised a normal merge plus implementation.
- Immediately before merge, PR #4 head `09c872d8939a3a58aca9f2a46b7fc3e6b1e17639` was `MERGEABLE`/`CLEAN`; both final `quality` runs passed; `npm audit` reported 0 vulnerabilities; the repository was private; the diff contained only `PROJECT_PLAN.md`; `data/profile.private.json` remained ignored; and no tracked private/session/database artifact was found apart from the intentionally committed `.env.example` template.
- PR #4 merged normally into `main` as `11185763b1679c35fecfcb45fbd9172a4a3a6de2` at `2026-09-05T07:44:09Z`. Refreshed local `main` exactly matched `origin/main`; the fully merged planning branch was deleted locally and remotely.
- Implementation branch `feat/real-world-job-intake-implementation` was created and pushed from that fresh merge commit. Phase 2.5 implementation is now authorised on this branch; its future pull request must remain unmerged for separate human review.
- No live job-board access, production URL fetch, application action, private candidate content, or Phase 2.6/3 work is authorised.

## Blueprint framing

### Current state

- Pull request #3 (`feat/seek-discovery-implementation` -> `main`) was reviewed and merged normally on 2026-09-05 at `2026-09-05T06:42:34Z` (`2026-09-05 16:42:34 AEST`). The merge commit and refreshed `main` HEAD are `cd3e13699cef3e41b8e3edd56239435ca647d66b`; the implementation branch was deleted locally and remotely.
- Immediately before merge, PR #3 was `OPEN`, `MERGEABLE`, and `CLEAN`, both GitHub `quality` checks passed, and its head was `2eabcb1475b0adbfb39c37e960be7ad2b0c95eae`. The repository remained private. The implementation diff contained no database migration, candidate-profile change, application-submission change, public SEEK client, live job-board request, credential/session artifact, real candidate data, or unignored private artifact.
- The merge candidate passed `npm run format:check`, `npm run lint`, `npm run typecheck`, 63 unit tests across 13 files, 3 integration tests across 2 files, a 34-page production build, 5 Playwright tests, and `npm audit` with zero vulnerabilities.
- Phase 2 provides reliable normalization, provenance, checkpoint, persistence, eligibility, and fit patterns, but real-world intake is still programmatic and single-record for user-supplied SEEK content. There is no `/import` workflow, multi-job splitter, upload boundary, source-neutral parser, preview/confirmation stage, or approved live URL retrieval.
- `apps/web/lib/data.ts` currently imports the committed fictional `data/profile.example.json` and evaluates every fixture-derived dashboard job with it. That behaviour is acceptable only for explicitly labelled demo/fixture jobs. Reusing it for a real imported vacancy would create a fictional eligibility/fit result and is a release-blocking Phase 2.5 design flaw unless the runtime boundary below is implemented first.

### Objective and success boundary

Build a source-neutral, local-first intake path that lets a user bring job advertisements they are entitled to use into ApplyPilot, review exactly what was detected, and explicitly confirm persistence. The phase succeeds when paste and safe file-upload inputs can produce deterministic job previews and confirmed normalized jobs without unauthorized scraping, invented source/job facts, document generation, form filling, or application submission.

### Assumptions, requirements, and dependencies

- The user controls the supplied text/file and is responsible for having the right to use it. ApplyPilot does not republish imported content.
- Real inputs are untrusted even when supplied by the local user. Byte limits, content-type checks, inert parsing, Zod validation, deterministic classification, and fail-closed review states are mandatory.
- Candidate data is not an importer, source-detection, splitter, or parser input. Eligibility and fit run only after a confirmed normalized job is persisted and a separate runtime provider resolves an evaluation-eligible candidate profile. A real imported job may use only a validated `PRIVATE_LOCAL_PROFILE`; it must never fall back to the committed demo profile.
- Existing Phase 2 SEEK parsing rules should be reused or extracted into shared deterministic helpers when their input preconditions are met. Source-neutral code must not copy and then silently diverge from those rules.
- Runtime remains local Next.js 16, strict TypeScript, Zod, SQLite/Drizzle, Vitest, and Playwright. Before editing `apps/web`, implementation must read the repository's applicable Next.js 16 documentation and `apps/web/AGENTS.md` if present.
- A small inert HTML parser such as `parse5` is the expected new runtime dependency. It must be pinned, audited, and used only server-side. No browser DOM, script engine, remote asset loader, OCR, PDF parser, or required paid/AI service is planned.

### Non-goals

- Phase 3 Indeed discovery, a Phase 2.6 ATS adapter, any other live job-board adapter, broad web crawling, search-engine discovery, authenticated retrieval, or browser automation.
- Fetching a URL merely because the user supplied it; a URL is data, not permission.
- CAPTCHA/MFA/login/access-control/rate-limit/bot-detection bypass, stealth, proxy rotation, fingerprint spoofing, cookie/session import, or hidden endpoint replay.
- CV or cover-letter generation, application-question answering, form filling, application preparation, status updates, or submission.
- Fuzzy/semantic duplicate matching, inferred job facts, probabilistic record boundaries, or AI extraction.
- PDF/OCR, Word/Office documents, archives, images, executable content, or unknown/binary upload formats.

### Architecture, risks, and rollback summary

`@applypilot/job-importer` will own the source-neutral intake contracts and pure deterministic pipeline. `@applypilot/job-sources` will continue to own source-specific adapter/parsing behaviour. `@applypilot/database` will own import staging and confirmed persistence. `@applypilot/candidate-profile` will own the source-neutral runtime resolution contract, while a server-only web implementation will load and validate the fixed local private-profile path. `apps/web` will provide the local `/import` presentation and server actions only. The preview phase creates only local staging/audit metadata; the confirmation phase is the only path that may create/update normalized jobs. Evaluation is a separate post-persistence step gated by job provenance and the resolved candidate-profile state.

Primary risks are executable/untrusted HTML, denial-of-service through large/deep inputs, false multi-job splits, source misclassification, accidental raw-content exposure, false duplicate merges, forged URLs, SSRF if a future URL fetcher is enabled, and schema evolution against local databases. The controls in sections E, H, J, L, O, Q, and T are acceptance requirements, not optional hardening.

Rollback is additive and local: keep implementation isolated on a future feature branch and leave its PR unmerged; disable the `/import` navigation/route and importer registration to restore the Phase 2 UI; revert code normally; never rewrite `main`; preserve imported user data unless the user separately approves deletion. Database rollback and backup requirements are exact in section O.

### Candidate-profile runtime boundary

Introduce an explicit `CandidateProfileProvider` before any real imported job can reach the eligibility or fit engines. The source-neutral contract belongs to `@applypilot/candidate-profile`; the initial filesystem-backed implementation is server-only and is called by post-confirmation evaluation orchestration, never by the importer:

```ts
type CandidateProfileRuntimeState =
  | "DEMO_PROFILE"
  | "PRIVATE_LOCAL_PROFILE"
  | "NO_ACTIVE_PROFILE"
  | "INVALID_PRIVATE_PROFILE";

type JobEvaluationContext = "DEMO_FIXTURE_JOB" | "REAL_IMPORTED_JOB";

interface CandidateProfileProvider {
  resolve(context: JobEvaluationContext): Promise<CandidateProfileResolution>;
}
```

`CandidateProfileResolution` is a discriminated union. Only `PRIVATE_LOCAL_PROFILE` for `REAL_IMPORTED_JOB`, or `DEMO_PROFILE` for an explicitly labelled `DEMO_FIXTURE_JOB`, carries a server-internal validated `CandidateProfile`. Missing and invalid states carry only stable, non-sensitive reason codes. The provider must enforce these decisions rather than leaving them to callers:

| Evaluation context | Local private file state | Provider result           | Eligibility/fit behaviour                                                                  |
| ------------------ | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------ |
| Real imported job  | Present and valid        | `PRIVATE_LOCAL_PROFILE`   | Evaluate using that validated private profile and its local profile-version provenance     |
| Real imported job  | Missing                  | `NO_ACTIVE_PROFILE`       | Persist the job; do not invoke either engine; expose `NOT_EVALUATED`/unavailable           |
| Real imported job  | Present but invalid      | `INVALID_PRIVATE_PROFILE` | Fail closed; persist the job; do not invoke either engine; expose unavailable with safe UI |
| Demo/fixture job   | Explicit demo flow       | `DEMO_PROFILE`            | Existing fictional evaluation is allowed only with a visible demo/fixture label            |

The committed example is never a fallback for `REAL_IMPORTED_JOB`. Real/demo context is derived from trusted persisted acquisition/provenance (`FIXTURE` versus confirmed user-supplied import), never from the detected vendor source: a fixture whose source is SEEK remains demo, while a pasted SEEK advert remains real. Real and demo records must carry explicit provenance, and an evaluation service must reject a context/profile mismatch even if a caller attempts to pass the example profile directly. For an unevaluated real job, the existing nullable `jobs.eligibility_status` and `jobs.fit_score` fields remain `null`, reason arrays remain empty, and no `eligibility_results` or `fit_scores` row is created. A typed view state such as `NOT_EVALUATED` is derived without extending `EligibilityStatusSchema` or fabricating a score. The jobs/dashboard UI displays: **Private candidate profile required for eligibility and fit analysis.** An invalid private file may use the more specific safe label **Private candidate profile is invalid; eligibility and fit were not evaluated.**

The minimal private loader reads only `data/profile.private.json` from a fixed application-controlled path on the local server. It uses `CandidateProfileSchema.safeParse`, distinguishes `ENOENT`/missing from invalid JSON/schema content, rejects non-file/path surprises, applies a bounded read, and returns only the discriminated resolution above. It never logs the file body, full validation input, Zod values, candidate fields, or filesystem path. Full candidate data never crosses a server-component/action boundary or enters a client-component import graph/bundle; the UI receives only an allowlisted status DTO such as `{ state, label, evaluationAvailable }`. Referee contact details and all other private fields remain server-side, never enter localStorage/sessionStorage, and are never sent to source detection, splitting, parsing, import records, external services, CI, or cloud systems.

When a valid private profile is used for evaluation, the evaluation service must use the existing local-only `candidate_profiles` and append-only `candidate_profile_versions` tables to store the validated snapshot and content hash before writing `eligibility_results` and `fit_scores`, so every persisted evaluation retains profile-version provenance; this needs no new profile migration. The ignored SQLite database remains local private data. Phase 2.5 adds no profile editor and does not populate any real name, phone, email, address, visa/work-right detail, referee, CV, passport, or identity value in committed source, fixtures, tests, screenshots, or CI. `data/profile.example.json` remains committed, fictional, and demo-only; `data/profile.private.json` remains Git-ignored and is populated later by an explicit local setup step outside Git.

## A. Product goal and planned inputs

All intake modes converge on one `RawImportedJobDocument -> ImportedJobDraft[] -> preview -> confirmed normalization/persistence` pipeline. `detectedSource` describes the record's evidence-based origin; `acquisitionMethod` separately describes how bytes entered ApplyPilot. Neither field may be derived from the other. Planned inputs are:

1. A pasted single job advertisement in plain text, Markdown-like text, JSON, JSON-LD, or HTML.
2. Pasted search results containing multiple job cards or repeated structured job records.
3. Pasted HTML copied or saved by the user, parsed inertly and never rendered as supplied markup.
4. Local upload of a compatible `.txt`, `.md`, `.html`, `.htm`, or `.json` file.
5. A job URL only when the URL policy registry says automated retrieval is explicitly supported by an approved source-specific plan; otherwise the UI requires user-supplied content.
6. Future source adapters, email ingestion, browser extensions, CLI commands, and mobile share flows that construct the same validated raw-document contract rather than inventing parallel pipelines.

The immediate Phase 2.5 implementation target is real user-supplied paste and upload. The URL input and registry are planned as a safe decision surface. The production Phase 2.5 registry contains exactly zero `FETCH_ALLOWED` entries and no production network content provider. A future reviewed phase may enable a narrowly allowlisted `FETCH_ALLOWED` entry without changing the downstream pipeline.

## B. `/import` user experience

Add a local `/import` route with four explicit entry choices: **Paste one job**, **Paste multiple/search results**, **Upload a file**, and **Job URL**. Paste modes accept a source hint of `Auto-detect` or one of the supported source labels. Upload shows accepted formats and limits before file selection. URL mode evaluates policy before any retrieval and, for the initial registry, explains how to paste or upload content instead.

Submitting content performs validation, inert extraction, deterministic source detection, splitting, and draft parsing, then displays a preview containing:

- detected job count and overall split result;
- per-record title, company, location, source guess, source confidence, stable warnings, and duplicate status;
- whether a source URL/external ID was explicitly found;
- missing required fields and material ambiguities;
- a plain-text excerpt only, escaped by React, never supplied HTML;
- `Import`, `Edit`, and `Skip` actions per record plus a bulk selection control.

The user must explicitly confirm selected records. Confirmation revalidates the staged data and override set, normalizes each record, applies strong duplicate rules, and persists it transactionally. Only after persistence does the evaluation service resolve `CandidateProfileProvider` for `REAL_IMPORTED_JOB`: a valid `PRIVATE_LOCAL_PROFILE` runs eligibility and fit, while `NO_ACTIVE_PROFILE`, `INVALID_PRIVATE_PROFILE`, or any attempted demo-profile fallback leaves both evaluations unavailable. In every case the imported job remains visible and usable in jobs/dashboard views. Confirmation does not shortlist the job, generate documents, prepare an application, change application status beyond the existing initial `NEW` state, or submit anything.

The preview must remain usable by keyboard, associate warnings with their fields, preserve focus after edits, identify destructive/irreversible outcomes before confirmation, and avoid color-only status communication.

## C. Multi-job pasted text and copied search results

Multi-job mode accepts repeated text blocks, JSON arrays/graphs, or HTML job cards. It creates an ordered candidate-record list and never directly imports the entire page as one job when strong repeated structure is present. The preview exposes boundaries as numbered records so the user can inspect each title/company/location and edit, combine, split, or skip uncertain records before confirmation.

Copied search-result cards often omit full descriptions. Such records may still preview, but a missing field required by `JobSchema` remains missing. The UI must request a manual edit or fuller pasted detail; it must not invent a description, company, location, URL, external ID, salary, requirement, or employment type. A structurally sound card without sufficient canonical fields is `REVIEW_REQUIRED`, not silently importable.

Mixed-source input is permitted. Source detection runs per candidate record; the batch-level `detectedSource` becomes `MIXED` only when records have more than one confident source. A batch hint is never applied blindly to every record.

## D. Deterministic source detection

Define `DetectedJobSource` as `SEEK | INDEED | EMPLOYMENT_HERO | GREENHOUSE | LEVER | WORKDAY | GENERIC_COMPANY_SITE | UNKNOWN`, with batch-only `MIXED`. This field means origin/detected source only. Define a separate `AcquisitionMethod` such as `USER_SUPPLIED_CONTENT | FILE_UPLOAD | FIXTURE | APPROVED_SOURCE_FETCH | UNKNOWN`; Phase 2.5 production imports use only the first two, and `UNKNOWN` is reserved for legacy provenance that cannot be established safely. Every source result includes `confidence: HIGH | MEDIUM | LOW`, ordered `ruleIds`, safe evidence paths/tokens, and conflicts. Acquisition method is recorded independently and is never accepted as source evidence: a pasted SEEK advert is `detectedSource: SEEK` plus `acquisitionMethod: USER_SUPPLIED_CONTENT`, while uploaded Greenhouse content is `detectedSource: GREENHOUSE` plus `acquisitionMethod: FILE_UPLOAD`. If origin evidence is insufficient, `UNKNOWN` remains truthful regardless of acquisition method or source hint.

Detection order is deterministic:

1. Explicit structured source values in a validated payload, when consistent with a recognized URL/payload contract.
2. Exact allowlisted host/path shapes and stable identifiers: reviewed exact SEEK hosts plus `/job/<id>`; reviewed exact Indeed country hosts plus job/view-job shapes and explicit job keys; reviewed exact Employment Hero/Swag vendor hosts; exact Greenhouse hosts `boards.greenhouse.io`, `job-boards.greenhouse.io`, and `boards-api.greenhouse.io`; exact Lever hosts `jobs.lever.co`, `api.lever.co`, and `api.eu.lever.co` plus reviewed paths; and Workday hosts validated by `host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com")` plus reviewed job paths.
3. Vendor-specific structured JSON/JSON-LD keys or inert HTML markers that have fictional golden fixtures and at least two independent signals.
4. Generic schema.org `JobPosting` plus an HTTPS employer/careers URL becomes `GENERIC_COMPANY_SITE` only when no vendor rule matches.
5. Everything else is `UNKNOWN`.

`HIGH` requires corroborated structured identity plus a recognized URL/payload shape. `MEDIUM` requires one strong vendor-owned shape or two independent structured markers. Text logos, CSS class names, and a user source hint alone are `LOW` and force review. A conflicting hint adds `SOURCE_HINT_CONFLICT`; it never overrides observed evidence. Detection performs no DNS lookup, HTTP request, authentication, or browser access.

Hostname input is parsed and normalized with the standard URL implementation, including lowercased ASCII/punycode hostname and removal of one terminal root dot before matching. Vendor recognition must use either exact equality or an explicit dot-boundary suffix check; no `includes`, wildcard text such as `indeed.*`, suffix without a leading dot, substring, logo, or registrable-domain guess is allowed. Providers with country-specific domains use a reviewed enumerated host allowlist. Lookalikes such as `indeed.example-attacker.test`, `boards.greenhouse.io.attacker.test`, `lever.co.attacker.test`, prefix/suffix concatenations, userinfo tricks, Unicode confusables, and trailing-dot/port variants must never classify as trusted vendor infrastructure unless normalization yields an exact reviewed host.

Rules are versioned and return evidence so later changes can be fixture-reviewed. One shared safe-host matcher is used by source detection and URL policy so the two cannot drift, but source detection classifies provenance only; it never authorizes retrieval. That separate decision belongs only to section L.

## E. Untrusted-content validation and sanitization

Validate at both the web/server-action boundary and package boundary with Zod. Initial hard limits are:

- maximum input/upload body: 1 MiB of raw UTF-8 bytes;
- maximum URL length: 2,048 characters;
- maximum 100 detected job candidates per batch;
- maximum 128 KiB extracted text per candidate after normalization;
- maximum 25,000 text lines, 256 JSON nesting levels, and 256 HTML tree depth; exceeding a limit fails before preview;
- filename maximum 255 characters after basename extraction; paths, control characters, and NUL bytes are rejected;
- parsing time and memory must be bounded and exercised with adversarial fixtures.

Allow only UTF-8 `text/plain`, `text/markdown`, `text/html`, and `application/json`, with conservative aliases that match an allowed extension and successful content sniff. Hash original bytes before decoding. Reject invalid UTF-8 rather than silently replacing data. Normalize line endings and Unicode only in a derived parser view; raw bytes/text and the original hash remain unchanged locally.

HTML is parsed server-side as an inert tree. Extract text and validated `application/ld+json` data only. Discard `script`, `style`, `noscript`, `template`, `iframe`, `frame`, `object`, `embed`, `applet`, `form`, `input`, `button`, `textarea`, `select`, `option`, `link`, `meta`, `base`, media, SVG/MathML, comments, processing instructions, inline event handlers, `style`, `srcdoc`, and active/remote resource attributes. Do not execute JavaScript, resolve CSS, submit forms, load fonts/images/media, follow links, or preserve executable DOM. Never use `dangerouslySetInnerHTML`; React must render extracted strings as text.

JSON is parsed as data only. Prototype-polluting keys (`__proto__`, `prototype`, `constructor`) are rejected or removed by an explicitly tested recursive sanitizer, and all objects are copied into plain safe records before schema parsing. Parser failures return stable codes and short safe messages without echoing the body.

Credential/session detection is deliberately narrow and structure-aware. Reject before retention only high-confidence material such as an `Authorization: Bearer <token>` header with a token-shaped value, syntactically valid `Cookie:`/`Set-Cookie:` header blocks, recognized browser local/session-storage or session-export formats containing token/cookie material, PEM private-key blocks, or JSON objects whose credential/session keys contain token-shaped values. Do not reject ordinary recruiter email addresses, public URLs, vacancy/reference IDs, prose mentioning API access, tokens, authentication, password policies, cookies, or security responsibilities, or JSON-LD job fields merely because their names contain words such as `id` or `url`. Rejection records only the input hash, length, and stable detector code; it never retains or echoes the matched value. Positive credential fixtures and negative ordinary-job-ad fixtures are mandatory.

## F. `RawImportedJobDocument`

Define the source-neutral boundary as:

```ts
interface RawImportedJobDocument {
  importId: string;
  inputType: "PASTED_SINGLE" | "PASTED_MULTI" | "PASTED_HTML" | "FILE_UPLOAD" | "URL";
  acquisitionMethod: "USER_SUPPLIED_CONTENT" | "FILE_UPLOAD";
  sourceHint: DetectedJobSource | null;
  detectedSource: DetectedJobSource | "MIXED";
  originalFilename: string | null;
  sourceUrl: string | null;
  contentHash: string;
  createdAt: string;
  parserVersion: string;
  contentLength: number;
  detectedJobs: number;
  warnings: ImportWarning[];
  content: string; // LOCAL_PRIVATE; excluded from logs, audit metadata, and client DTOs
}
```

`importId` is a random local UUID. `contentHash` is SHA-256 over the exact accepted bytes. `createdAt` is an injected ISO 8601 clock value. `contentLength` is the pre-decode byte length. `acquisitionMethod` is derived only from the trusted intake route/file boundary, while `detectedSource` is derived only from content/URL evidence. The web preview receives only selected escaped excerpts and typed fields, never the complete `content` field. Raw content remains in the ignored local SQLite database, is never uploaded to CI/cloud/analytics, and never appears in console, error, request-body, or audit logs.

In production Phase 2.5, a URL-policy check that returns anything other than a future approved fetch decision does not create a raw document and does not persist a URL-only pseudo-job. The `URL` input discriminator is reserved for the downstream contract after a later approved provider supplies validated bytes; it cannot be used to treat the URL string itself as job content.

## G. One source-neutral parser contract and expected files

Define one parser contract:

```ts
interface JobImportParser {
  parseDocument(document: RawImportedJobDocument): ImportParseResult;
  parseRecord(record: SplitImportedJobRecord, context: ImportContext): ImportedJobDraft;
}
```

`ImportedJobDraft` carries only explicit extracted values for external ID, source URL, title, company, location, category, description, responsibilities, employment/salary/hours/schedule text, requirements, dates, and cover-letter instruction. Every field has `originalValue`, evidence path/range, extraction rule ID, and confidence. Absent facts are `null`/empty plus warnings. Parser output is validated before preview and again before normalization.

SEEK input should reuse `createSeekRawJobRecord`, `parseUserSuppliedSeekContent`, requirement/date rules, and `normalizeSeekJob` where their validated preconditions are satisfied. Implementation may extract generally useful pure helpers into source-neutral modules with regression tests; it must not weaken the current SEEK URL gate or duplicate rules into a second untracked implementation. Other detected sources initially use generic schema.org/visible-text parsing and preserve the detected source as provenance; source-specific enrichments remain later adapter work.

Expected future implementation files are:

- Create `packages/job-importer/package.json`, `tsconfig.json`, and `src/{index,types,schemas,limits,sanitize,source-detector,multi-job-splitter,single-job-parser,url-policy,identity,import-service}.ts` with colocated unit tests.
- Create `packages/candidate-profile/src/runtime.ts` for the provider/result/context contract and its pure mismatch-policy tests; export it without adding filesystem access to the package root.
- Create `apps/web/lib/candidate-profile-provider.ts` as the `server-only` fixed-path filesystem implementation and add focused missing/invalid/valid/redaction/client-serialization tests. Use the existing candidate-profile tables through a focused local repository only if profile-version result persistence requires it; no profile schema migration or editor is planned.
- Create `packages/database/src/job-import-repository.ts` and its migration/integration tests.
- Conditionally create `packages/database/drizzle/0001_real_world_job_intake.sql` only after this blueprint and its migration recommendation are human-approved.
- Create `apps/web/app/import/page.tsx`, `apps/web/app/import/actions.ts`, and focused `apps/web/components/job-import/*` components; modify navigation, dashboard/jobs data access, and styles minimally.
- Create `fixtures/imports/manifest.ts` and the fictional files in section S.
- Create `tests/integration/real-world-job-intake.test.ts`, `tests/e2e/import.spec.ts`, and `docs/REAL_WORLD_JOB_INTAKE.md`.
- Modify `packages/job-model/src/index.ts`, `packages/job-sources` exports/helpers, `packages/database/src/{schema,index}.ts`, `apps/web/lib/data.ts`, `/profile` or `/settings` for the safe runtime-state indicator, root/workspace TypeScript configuration as required, `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/JOB_SOURCE_ADAPTERS.md`, `docs/JOB_NORMALIZATION.md`, and this plan only to reflect verified implementation.
- Do not create an HTTP content provider, network client, crawler, browser client, application form, document generator, or submission file in Phase 2.5. A future approved `FETCH_ALLOWED` source may add a narrowly scoped content provider.

## H. Deterministic multi-job splitter

`splitImportedJobs` returns ordered records plus one of `CONFIDENT`, `REVIEW_REQUIRED`, or `FAILED`:

- `CONFIDENT`: boundaries come from a JSON array/`@graph` of independently valid `JobPosting` objects, repeated inert HTML job-card structures with explicit per-card title/link/company evidence, or explicit user separators where every segment independently meets the minimum draft shape.
- `REVIEW_REQUIRED`: there are plausible repeated blocks, inconsistent structural markers, overlapping ranges, mixed full ads/cards, or one/more records missing required preview fields. Candidate boundaries are shown and nothing is persisted until the user confirms/edits them.
- `FAILED`: no safe record boundary or viable single-record interpretation exists, the input is empty/disallowed/oversized, or all candidates fail minimum validation.

The splitter uses this order: validated JSON/JSON-LD nodes; repeated HTML container/card structure; explicit delimiter/numbered-record grammar; repeated labelled field grammar; conservative single-record fallback. Blank lines, headings, bullet lists, repeated words such as “About us”, or title-looking sentences inside a description are never sufficient boundaries by themselves. A lower-confidence rule cannot override a higher-confidence structure.

Every segment retains its ordinal, exact original byte/character range where possible, raw-fragment hash, boundary rule IDs, confidence, warnings, and extraction evidence. The parser never manufactures a delimiter, merges non-adjacent spans, or silently drops leftover text; unassigned content becomes a preview warning.

## I. Preview, selection, and confirmation

Each preview record shows title, company, location, detected source and confidence, external ID/URL presence, duplicate decision, split confidence, missing fields, warnings, and an escaped excerpt. Available actions are:

- **Import**: select a reviewable record for the confirmation transaction;
- **Edit**: change extracted fields or approved boundaries while preserving the immutable originals;
- **Skip**: exclude the record and record a safe local reason/code;
- **Bulk import selected** / **Bulk skip selected**: act only on explicitly checked records; no default “select all” when any item is `REVIEW_REQUIRED`.

`CONFIDENT` records may be preselected, but the batch confirmation button remains explicit. `REVIEW_REQUIRED` records are never preselected and require an acknowledged warning after any necessary edit. `FAILED` records cannot import. The confirmation screen states counts for create/update/duplicate/skip/fail before commit. There is no CV, cover letter, shortlist, prepare, apply, or submit action on `/import`.

Preview tokens are random, short-lived, local, and bound to `importId + contentHash + parserVersion + overrideHash`. Confirmation rejects stale/mismatched/replayed tokens and revalidates the stored raw document and selected records server-side.

## J. Strong duplication and local identity

Duplicate evaluation is deterministic and ordered:

1. Exact `(detected source, validated externalId)` when both exist.
2. Exact canonical source URL. Canonicalization requires HTTPS, lowercases only scheme/host, removes fragments/default ports, normalizes dot segments, preserves case-sensitive paths, and removes only an explicit allowlist of tracking parameters such as `utm_*`; unknown/identity query parameters are retained and sorted.
3. Exact segment content hash for repeated identical supplied records.
4. When no external ID or canonical URL exists, a versioned local fingerprint: `sha256("job-import-fingerprint-v1\n" + detectedSource + "\n" + normalizedTitle + "\n" + normalizedCompany + "\n" + normalizedLocation + "\n" + normalizedDescriptionHash)`. Normalization is limited to Unicode NFC, trim, whitespace folding, and locale-stable lowercase; no synonym, stemming, geocoding, or semantic similarity is used.

The local fingerprint is used automatically only when title, company, location, and description are all explicit. Missing fields yield `REVIEW_REQUIRED`, not a partial fingerprint. The persisted record separately identifies whether identity came from `EXTERNAL_ID`, `CANONICAL_URL`, `CONTENT_HASH`, or `LOCAL_FINGERPRINT`; a derived fingerprint is never presented as a vendor external ID.

Same identity plus same content hash is `DUPLICATE_UNCHANGED`. Same external ID/URL plus changed content hash is `UPDATE_REVIEW_REQUIRED` and must be visibly confirmed. Conflicting strong signals are `IDENTITY_CONFLICT` and cannot auto-merge. Cross-source and fuzzy matching remain Phase 6 review work.

## K. Upload policy

Allow only `.txt`, `.md`, `.html`, `.htm`, and compatible `.json` files. Extension, declared MIME, sniffed content, UTF-8 validity, and parser result must agree; a mismatch is rejected. The 1 MiB raw-byte limit applies before buffering/parsing, and the 100-record/128-KiB-per-record limits apply after splitting.

Explicitly reject executables, scripts, installers, archives/compressed files, images, audio/video, fonts, PDFs, RTF, Microsoft Office/OpenDocument packages, email containers, SQLite/databases, unknown MIME, multipart files, encrypted/password-protected files, and binary data. Renaming a disallowed file to an allowed extension must still fail content sniffing. There is no PDF parsing or OCR in Phase 2.5.

Uploaded content is read into local server memory within the bound, hashed, validated, and stored in the ignored local database. It is not written to a web-public directory, temp path with a user filename, Git-tracked path, CI artifact, or cloud service. Original filenames are basenames for display/provenance only and are never used as filesystem paths.

## L. URL policy registry

Define a versioned registry whose only decisions are:

- `FETCH_ALLOWED`: an approved source-specific HTTPS host/path contract may be fetched by a separately reviewed bounded content provider.
- `USER_CONTENT_REQUIRED`: ApplyPilot must not fetch; UI instructs the user to copy/paste or upload content they are entitled to use.
- `UNSUPPORTED`: invalid protocol/host/path/content model or explicitly disallowed category; no fetch and no workaround.
- `REVIEW_REQUIRED`: no current evidence-based policy decision; no fetch until a plan and human review change the registry.

The production Phase 2.5 registry is exhaustive and contains **zero `FETCH_ALLOWED` entries**:

| Detected source / URL class                                               | Production decision     |
| ------------------------------------------------------------------------- | ----------------------- |
| SEEK                                                                      | `USER_CONTENT_REQUIRED` |
| Indeed                                                                    | `REVIEW_REQUIRED`       |
| Greenhouse                                                                | `REVIEW_REQUIRED`       |
| Lever                                                                     | `REVIEW_REQUIRED`       |
| Employment Hero                                                           | `REVIEW_REQUIRED`       |
| Workday                                                                   | `REVIEW_REQUIRED`       |
| Generic company site                                                      | `REVIEW_REQUIRED`       |
| Unknown                                                                   | `REVIEW_REQUIRED`       |
| Invalid, non-HTTPS, credential-bearing, IP-literal, local/private network | `UNSUPPORTED`           |

The registry uses the exact/dot-boundary host matcher from section D; a detected vendor label cannot authorize a URL whose normalized host/path fails its reviewed contract. Phase 2.5 therefore performs no production live URL fetch. The URL UI explains the decision and offers paste/upload; it must not silently fall back to a browser, redirector, alternate endpoint, DNS lookup, or another adapter.

A test-only fictional `FETCH_ALLOWED` provider may exist solely to exercise the future provider interface. It must be isolated from the production registry, accept only an exact reserved host such as `fetch-fixture.example.test`, require an injected in-memory transport, assert that global/network `fetch` and DNS are never called, and reject redirects outside its fictional contract. Its existence must not change the production `FETCH_ALLOWED` count from zero or support a claim of live retrieval.

Any future production `FETCH_ALLOWED` entry requires an evidence-dated source plan, a reviewed exact/dot-boundary hostname and path contract, and human approval in a later phase. Its fetcher must use an exact host/path allowlist, HTTPS only, no userinfo, no credentials/cookies/referrer, an honest fixed user agent, public-IP DNS resolution checked before connection and after every redirect, a maximum three redirects, five-second timeout, 1 MiB streamed response cap, permitted response MIME, conservative source rate limits/`Retry-After`, no JavaScript, and safe terminal errors. DNS rebinding, redirect-to-private-network, authentication, CAPTCHA, bot/access controls, and rate limits fail closed and emit redacted events.

## M. Manual corrections and provenance

Edits occur only in preview. Store immutable `originalExtractedFields`, a separate `editedFields` patch, `editedAt`, `editedBy: LOCAL_USER`, optional reason, acknowledged warning codes, and an `overrideHash`. The effective draft is a deterministic overlay; neither raw document nor original extraction is mutated.

The UI shows original and edited values side-by-side for changed fields and identifies user-supplied corrections in job provenance. Clearing a field produces explicit `null`, not fallback to the original. Edits are revalidated, sanitized as text, and size-limited. Audit metadata records record ID, changed field names, before/after hashes, timestamp, and reason code—not raw field values, descriptions, or the full patch.

Changing a detected source, external ID, URL, title, company, location, or record boundary recalculates identity and duplicate status and requires a fresh confirmation token. The normalized job retains parser version, raw hash, source-detection evidence, extraction evidence, and override provenance.

## N. End-to-end pipeline and exact implementation order

The only approved canonical flow is:

`USER CONTENT -> validate -> inert sanitize -> source detection -> split -> parse -> preview -> edit/review -> explicit confirmation -> normalize -> deduplicate -> persist -> resolve active candidate profile -> if PRIVATE_LOCAL_PROFILE: eligibility -> fit; otherwise: evaluation unavailable -> dashboard`

In expanded implementation terms:

`input -> byte/MIME/credential validation -> raw hash/local staging -> inert sanitize/extract -> evidence-based origin detection + independent acquisition-method assignment -> deterministic split -> per-record parse -> Zod draft validation -> preview + manual edits -> explicit confirmation -> source-specific/generic normalization -> JobSchema validation -> identity/dedup decision -> transactional job/source/import persistence -> CandidateProfileProvider.resolve(REAL_IMPORTED_JOB) -> validated private-profile version + eligibility + fit, or typed NOT_EVALUATED -> dashboard/jobs visibility`

No downstream stage receives executable markup. No persistence of canonical jobs occurs before confirmation. If normalization, identity validation, source-record write, import-record write, or its required audit write fails, the selected persistence transaction rolls back and the preview remains available with a safe error. Candidate-profile resolution occurs only after that transaction. Missing/invalid private profile or an evaluation-engine failure does not roll back or hide a valid imported job; it leaves the job explicitly `NOT_EVALUATED` with nullable eligibility/fit fields and a safe reason. An evaluation-result transaction cannot create only one of eligibility/fit or lose its profile-version link. Batch completion may report per-record results, but canonical job/provenance persistence itself cannot be half-complete.

Exact future implementation steps:

1. Start only after this planning PR is human-approved and merged; create `feat/real-world-job-intake-implementation` from fresh `main`, re-read all instructions/blueprint, and record implementation start in this plan before code.
2. Read applicable Next.js 16 local documentation, inspect package/database boundaries, and pin/audit the minimum inert-parser dependency.
3. Add source-neutral types, independent detected-origin/acquisition-method fields, limits, schemas, safe hashing, structure-aware credential detection, sanitization, and no-body logging tests.
4. Implement and test safe exact/dot-boundary hostname matching, source detection, and the URL policy registry with all production entries fail-closed, a production `FETCH_ALLOWED` count of zero, and no network client.
5. Implement the deterministic splitter and source-neutral single-record parser; reuse/refactor SEEK pure rules with regression coverage.
6. Add identity/canonicalization/duplicate decisions and manual-override provenance.
7. Apply the human-approved `0001` migration with upgrade/foreign-key/backup-restore tests, then add the import repository and transactional confirmation service.
8. Implement the server-only `CandidateProfileProvider`, fixed-path private-profile loader, safe status DTO, and explicit demo-versus-real evaluation context. Integrate eligibility and fit only after confirmed persistence and only for `PRIVATE_LOCAL_PROFILE`; preserve the imported job as `NOT_EVALUATED` when no valid private profile is available.
9. Build the accessible `/import` paste/upload/URL-policy preview and edit/skip/confirm UX plus a non-sensitive profile-state indicator under `/profile` or `/settings`; do not add a profile editor, document, or application action.
10. Add fictional fixtures, unit/property/adversarial/profile-boundary tests, integration tests, E2E tests, regressions, explicit assertions that blocked URLs never call `fetch`, and proof that real imports never reach eligibility/fit with the demo profile.
11. Update actual architecture/security/normalization/adapter/import docs and this plan with verified behaviour, limitations, commands, results, rollback, and unfinished work.
12. Run all quality gates and audits, push the implementation branch, open an unmerged PR into `main`, wait for CI, and stop for human review. Do not begin Phase 3.

## O. Database review, recommendation, migration, and rollback

Database recommendation: **YES — add reviewed staging tables and make imported source identity truthful; no migration is created or run by this blueprint.**

The existing tables are not sufficient by themselves. `job_source_records` requires a normalized `job_id`, non-null vendor `external_id`, non-null `source_url`, and fetched timestamp, so it cannot honestly represent a pre-confirmation batch, multiple candidate records, failed/review/skipped records, manual overrides, or pasted jobs without a URL/vendor ID. Generating fake external IDs/URLs would violate the truth-store principle, and putting staging JSON into `settings` would make lifecycle/query/retention unreliable.

Proposed `0001_real_world_job_intake.sql` schema, subject to blueprint approval:

```text
import_batches
  id TEXT PRIMARY KEY
  input_type TEXT NOT NULL CHECK in the RawImportedJobDocument input types
  acquisition_method TEXT NOT NULL CHECK in USER_SUPPLIED_CONTENT/FILE_UPLOAD
  source_hint TEXT NULL
  detected_source TEXT NOT NULL  # origin only; never derived from acquisition_method
  original_filename TEXT NULL
  source_url TEXT NULL
  content_hash TEXT NOT NULL
  parser_version TEXT NOT NULL
  content_length INTEGER NOT NULL CHECK 0 <= value <= 1048576
  detected_jobs INTEGER NOT NULL DEFAULT 0 CHECK 0 <= value <= 100
  warnings_json TEXT NOT NULL DEFAULT '[]'
  raw_content_text TEXT NOT NULL
  status TEXT NOT NULL CHECK in RECEIVED/PREVIEW_READY/CONFIRMED/COMPLETED/PARTIAL/FAILED
  created_at TEXT NOT NULL
  confirmed_at TEXT NULL
  completed_at TEXT NULL

import_records
  id TEXT PRIMARY KEY
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE
  ordinal INTEGER NOT NULL
  split_status TEXT NOT NULL CHECK in CONFIDENT/REVIEW_REQUIRED/FAILED
  record_status TEXT NOT NULL CHECK in PREVIEW_READY/REVIEW_REQUIRED/SELECTED/SKIPPED/IMPORTED/UPDATED/DUPLICATE/FAILED
  detected_source TEXT NOT NULL  # origin only
  acquisition_method TEXT NOT NULL CHECK in USER_SUPPLIED_CONTENT/FILE_UPLOAD
  source_confidence TEXT NOT NULL CHECK in HIGH/MEDIUM/LOW
  external_id TEXT NULL
  source_url TEXT NULL
  segment_content_hash TEXT NOT NULL
  identity_kind TEXT NULL CHECK in EXTERNAL_ID/CANONICAL_URL/CONTENT_HASH/LOCAL_FINGERPRINT
  identity_value TEXT NULL
  boundary_json TEXT NOT NULL
  original_fields_json TEXT NOT NULL
  edited_fields_json TEXT NULL
  override_metadata_json TEXT NULL
  warnings_json TEXT NOT NULL DEFAULT '[]'
  normalized_job_id TEXT NULL REFERENCES jobs(id)
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  imported_at TEXT NULL
  UNIQUE(batch_id, ordinal)
```

Add indexes on `import_batches(content_hash, created_at)`, `import_batches(status, created_at)`, `import_records(batch_id, record_status)`, `import_records(identity_kind, identity_value)`, and `import_records(normalized_job_id)`. JSON columns are Zod-validated on every read/write. `raw_content_text` and the database are `LOCAL_PRIVATE` and ignored.

Rebuild `job_source_records` in the migration so `external_id`, `source_url`, and `fetched_at` are nullable; add `identity_kind TEXT NOT NULL`, `identity_value TEXT NOT NULL`, and `acquisition_method TEXT NOT NULL`; retain `payload_hash`; and replace the broad required-ID assumption with a unique `(source_id, identity_kind, identity_value)` index plus a partial unique `(source_id, external_id)` index where external ID is non-null. `identity_kind` plus `identity_value` becomes the canonical persistence identity for every source record. Add database checks where SQLite can enforce them and repeat/recompute them in Zod and repository transaction validation:

- `EXTERNAL_ID` requires a non-null validated `external_id` and exact `identity_value === external_id`.
- `CANONICAL_URL` requires a non-null HTTPS `source_url` that has passed the reviewed canonicalizer and exact `identity_value === canonicalSourceUrl`; the original URL remains only in local raw provenance.
- `CONTENT_HASH` requires a lowercase SHA-256 value and exact equality to the validated candidate-segment/payload hash used for that record.
- `LOCAL_FINGERPRINT` requires the lowercase SHA-256 output recomputed from the documented `job-import-fingerprint-v1` inputs; all title/company/location/description inputs must be explicit before this identity is permitted.

The table-level disjunction rejects impossible combinations instead of accepting a non-null pair with unrelated evidence. Application validation recomputes canonical URLs, hashes, and fingerprints because SQLite cannot prove those algorithms. `external_id` and `source_url` remain nullable for legitimate user-supplied records, and no layer may manufacture an ID, URL, placeholder domain, or fetched timestamp to satisfy persistence.

Backfill current Phase 2 rows as `EXTERNAL_ID` only after verifying each existing non-null external ID and equality of the new identity value. Backfill `acquisition_method` only from explicit validated `accessMode`/`retrievalMethod` provenance; use truthful `UNKNOWN` or abort for review when provenance is absent, never infer acquisition from `source_id`. Update `JobSchema.externalId` and `JobSchema.sourceUrl` to nullable, add `UNKNOWN` to `JobSourceSchema`, and persist detected origin separately from acquisition method in import batches, import records, source records, audit metadata, and UI. Existing fixture/SEEK meanings remain unchanged and regression-tested.

Migration procedure: stop the local app; resolve the exact database path; create a timestamped backup beside the ignored database; run `PRAGMA integrity_check`; apply the forward migration in a transaction using a create/copy/verify/rename table-rebuild sequence; restore indexes/foreign keys; run `PRAGMA foreign_key_check` and row-count/hash assertions; start the app only after success. The implementation must not auto-migrate an existing real database at server startup; expose an explicit local migration command and preview/backup confirmation.

Rollback: application code can be reverted normally while leaving additive import tables dormant. Schema reversal is not destructive by default. If no imported rows exist, a reviewed down migration may drop the two new tables and rebuild `job_source_records` to the original constraints after proving all external IDs/URLs are non-null. If any imported data exists, export/backup it and restore the pre-migration database; never silently coerce nulls, manufacture identifiers/URLs, drop imported content, or delete a local database. Any cleanup is a separate explicit user-approved operation.

Privacy implication: this migration stores real supplied ad content locally to preserve provenance and deterministic reprocessing. Phase 2.5 performs no automatic destructive cleanup, including for expired preview tokens or abandoned batches. `/import` and documentation must state clearly that accepted raw content remains in the local ignored database until a future explicit user action exists. Export, per-record/batch delete, and policy-driven purge are required future work with confirmation, dependency handling, backup, and audit design; they are not implemented or simulated automatically in Phase 2.5. Local backups must not be uploaded elsewhere. The schema stores no candidate profile, document, application answer, credential, cookie, or browser session in import tables.

## P. Minimal dashboard changes

- Add `/import` to local navigation and an **Import jobs** entry point on jobs/dashboard.
- Add a compact import summary: last local batch time, imported/updated/duplicate/review/failed counts, and a clear “user-supplied local content” label.
- Add an `Imported` badge and separate safe provenance fields for **Detected source** and **Acquisition method**; never label pasted/uploaded content as adapter-fetched. Include URL only when explicit and non-null, otherwise `No source URL supplied`.
- Link a confirmed job back to a safe import ID/hash prefix and parser version without exposing raw content.
- Add one safe indicator under `/profile` or `/settings`: `Candidate profile: Demo`, `Private profile loaded`, `Private profile missing`, or `Private profile invalid`. The client sees only this status/label and no candidate field, referee contact, validation payload, profile hash, or private path.
- For real imported jobs without a valid private profile, replace score/status presentation with `Not evaluated` and **Private candidate profile required for eligibility and fit analysis.** Do not display zero, a demo-derived status, an empty score badge that implies analysis, or a shortlist recommendation.
- State on `/import` that accepted raw job content is retained in the local ignored database for provenance/reprocessing and that Phase 2.5 has no automatic cleanup/export/delete/purge control.
- Keep all application/document controls unchanged; no profile editor, dashboard redesign, live-source badge, auto-refresh, or submission action.

## Q. Local privacy and content handling

- Raw inputs, parsed fragments, edits, and database backups remain on the user's computer in ignored paths. There is no cloud sync, analytics payload, telemetry body, remote parser, AI provider, or CI artifact.
- Never log request bodies, raw HTML/text/JSON, excerpts, descriptions, filenames containing paths, field values, cookies, headers, or candidate facts. Logs/audit events use IDs, hashes, lengths, counts, enumerated codes, and durations.
- Treat job text as potentially sensitive/copyrighted even if public elsewhere. Display it only to the local user and do not commit real examples, snapshots, or test traces.
- Reject only high-confidence structured authorization headers, cookie/set-cookie headers, bearer-token containers, credential/session JSON or recognized browser storage/session exports, PEM private keys, and equivalent tested credential structures; do not retain a rejected body. Ordinary job-ad email addresses, URLs, IDs, and prose mentioning API, token, passwords, authentication, or policies remain valid input.
- Use `Cache-Control: no-store` for import pages/actions and prevent raw content from entering URLs, server-rendered page source beyond bounded escaped preview fields, React error payloads, source maps, or browser storage.
- `data/profile.private.json` is loaded only by the fixed-path server provider, validated with `CandidateProfileSchema`, and remains covered by `.gitignore`. Its complete contents and validation input never enter logs, audit events, source maps, page source, browser storage, CI/cloud, importer functions, or external services. The UI status DTO never contains referee contacts or other profile fields.
- Candidate profile information never enters validation/sanitization beyond its own loader, source detection, splitting, parsing, source authorization, identity/deduplication, or import records. After confirmed persistence, only the post-import evaluation service may receive the provider's server-internal validated profile. `DEMO_PROFILE` is rejected for real imports.
- Phase 2.5 retains accepted raw content locally without automatic deletion so provenance/reprocessing remain possible. A later approved design must add explicit export, delete, and purge controls; until then the user-facing retention notice is mandatory.
- No actual candidate name, phone, email, address, visa/work-right details, referee, CV, passport, or identity material may be added to Git. Only the fictional example/schema is committed; private setup occurs outside Git.
- Final application submission still requires explicit human confirmation, and Phase 2.5 contains no path toward submission.

## R. Safe audit and observability events

Permit these local events with only `importId`, record ID/ordinal, enum states/codes, source/confidence, hashes or short hash prefixes, counts, sizes, parser/policy versions, durations, and timestamps:

- `job_import.batch.received`
- `job_import.validation.rejected`
- `job_import.source.detected`
- `job_import.split.completed`
- `job_import.preview.ready`
- `job_import.url.policy_blocked`
- `job_import.record.edited`
- `job_import.record.selected`
- `job_import.record.skipped`
- `job_import.batch.confirmed`
- `job_import.record.imported`
- `job_import.record.updated`
- `job_import.record.duplicate`
- `job_import.record.failed`
- `job_import.evaluation.completed`
- `job_import.evaluation.unavailable`
- `job_import.batch.completed`
- `job_import.batch.partial`
- `job_import.batch.failed`

Evaluation events may contain only job/import IDs, engine/profile schema versions, and enumerated profile state/reason codes; they may not contain a candidate-profile snapshot, content hash exposed to the browser, profile path, validation issues with input values, or referee/contact facts. No event may contain raw/edited job fields, content excerpts, full source URLs/query strings, filename paths, request/response bodies, cookies, tokens, credentials, candidate data, or serialized exception objects. Errors are allowlisted stable codes with bounded safe messages.

## S. Fictional fixture matrix

All committed fixtures use invented companies, roles, IDs, and `.example.test` URLs. The manifest must cover:

- one complete pasted plain-text job and one Markdown job;
- one valid pasted SEEK JSON/raw record and one SEEK schema.org HTML record reusing Phase 2 rules;
- copied search results with 2, 10, and exactly 100 distinct cards;
- JSON array and JSON-LD `@graph` with multiple jobs;
- repeated HTML cards, nested cards, adjacent unrelated content, and mixed full-ad/card input;
- deterministic source evidence for SEEK, Indeed, Employment Hero, Greenhouse, Lever, Workday, generic company site, unknown, mixed sources, low-confidence hint, and conflicting hint;
- exact allowed vendor hosts and adversarial lookalikes including `indeed.example-attacker.test`, `boards.greenhouse.io.attacker.test`, `lever.co.attacker.test`, userinfo tricks, suffix concatenations, Unicode/confusable hosts, trailing dots, explicit ports, and valid dot-boundary Workday tenant hosts;
- missing title, company, location, description, external ID, and URL cases;
- same source/external ID with same hash, same ID with changed hash, exact canonical URL duplicate, exact content duplicate, local-fingerprint duplicate, and conflicting strong identities;
- malformed/invalid/deep JSON, malformed/deep HTML, invalid UTF-8, NUL/control bytes, oversized input, 101-record overflow, overlong field, and unassigned trailing content;
- scripts, event handlers, `javascript:` links, forms/password inputs, iframes, embeds, SVG, remote images/styles/fonts, prototype-pollution keys, high-confidence authorization/cookie/session/private-key/credential JSON containers, and token-shaped values;
- negative credential fixtures with recruiter emails, public URLs, vacancy/reference IDs, JSON-LD identifiers, and normal prose about APIs, tokens, authentication, cookies, and password/security policies that must remain accepted;
- allowed `.txt/.md/.html/.htm/.json` MIME matches plus renamed executable, archive, PDF, Office file, image, database, and unknown MIME rejections;
- production URL examples for `USER_CONTENT_REQUIRED`, `UNSUPPORTED`, and `REVIEW_REQUIRED`, plus a count assertion that production has zero `FETCH_ALLOWED` entries; any `FETCH_ALLOWED` fixture is isolated to an exact reserved `.example.test` host and injected transport that can never reach the public network;
- provider fixtures for valid fictional private-profile content created only in temporary ignored test paths, missing and invalid private files, explicit demo context, and client/log/audit serialization checks; no real candidate data appears in fixtures;
- manual edits, cleared fields, stale/replayed preview token, per-record skip, bulk selection, confirmation rollback, concurrent/repeated confirmation, and partial batch results.

## T. Testing and validation plan

- Unit/schema: every Zod boundary, byte/line/depth/count/field limit, UTF-8 handling, raw hash, stable parser version, and no-body error contract.
- Sanitizer/adversarial: every active element/attribute/resource vector in section E, entity/encoding tricks, malformed trees, prototype keys, and assertions that no script executes, no remote resource loads, and preview markup contains only escaped text.
- Source detection: all rule IDs, confidence levels, conflicting hints, mixed batches, ordering, versioning, exact/dot-boundary host matching, reviewed country-host allowlists, adversarial lookalike domains/userinfo/confusables/trailing-dot/port cases, and no network/DNS call.
- Splitter/parser: all `CONFIDENT`/`REVIEW_REQUIRED`/`FAILED` paths, stable boundaries, leftover content, 1/2/10/100 records, missing fields, deterministic repeated execution, and exact evidence ranges/hashes.
- Identity/dedup: external ID, canonical URL edge cases, tracking allowlist, content hash, local fingerprint, changed content, identity conflicts, no fuzzy/cross-source merge, and concurrent confirmation.
- URL policy: every registry state, malformed/private/userinfo/redirect and lookalike-host cases, SEEK fixed to `USER_CONTENT_REQUIRED`, Indeed/Greenhouse/Lever/Employment Hero/Workday/generic/unknown fixed to `REVIEW_REQUIRED`, invalid/private/non-HTTPS/IP/local fixed to `UNSUPPORTED`, production registry count exactly zero `FETCH_ALLOWED`, and the isolated `.example.test` injected future-fetcher contract makes no network/DNS call and stops on size/MIME/timeout/rate/auth/security signals.
- Credential detection: positive high-confidence structured bearer/header/cookie/session-storage/private-key/credential-JSON fixtures are rejected without body retention, while normal recruiter emails, public URLs, job/reference IDs, JSON-LD identifiers, and ordinary job prose mentioning APIs, tokens, authentication, cookies, or password policies are accepted.
- Manual edits: immutable originals, overlay/clear semantics, provenance and hashes, sanitization, identity recalculation, stale token rejection, and redacted audit metadata.
- Database/migration: upgrade a current `0000` database with SEEK rows, empty database, transaction failure, row/index/FK/hash preservation, nullable source identity, every `identity_kind` consistency invariant, invalid combination rejection, canonical URL/hash/fingerprint recomputation, acquisition-method backfill without origin inference, import cascade behaviour, backup/restore instructions, and no automatic startup migration or fabricated ID/URL/timestamp.
- Candidate-profile provider: valid private file -> `PRIVATE_LOCAL_PROFILE`; missing -> `NO_ACTIVE_PROFILE`; malformed JSON/schema -> `INVALID_PRIVATE_PROFILE`; invalid fails closed without demo fallback; demo is returned only for explicit `DEMO_FIXTURE_JOB`; fixed-path/bounded server-only loading; safe UI DTO; private profile absent from page/source, browser storage, logs, audit metadata, importer/parser/source calls, external-service calls, CI, and Git tracking.
- Integration: real imported job + valid private profile -> evaluated with its local profile-version provenance; real imported job + missing private profile -> persisted but `NOT_EVALUATED`; real imported job + demo profile only -> persisted but never scored; fixture/demo job + explicit demo profile -> allowed and labelled; invalid private profile -> persisted but evaluation unavailable. Also cover paste/upload -> preview with no canonical job writes -> confirmed transaction -> source record/job -> profile resolution -> conditional evaluation -> dashboard, including duplicate/update/failure/restart/rollback/partial/concurrency cases and candidate truth regressions.
- Isolation/serialization: spy/assert that candidate profiles are never arguments to validator/sanitizer/source-detector/splitter/parser/URL-policy/dedup functions; no private field or referee contact is serialized beyond approved display values; captured logs and audit events contain no profile data; `git check-ignore data/profile.private.json` succeeds and tracked-file audits reject it and common private variants.
- UI/E2E: all `/import` modes, accessible labels/errors/focus, preview/edit/skip/bulk/confirm, blocked URL guidance, separate detected-source/acquisition labels, nullable source URL rendering, profile-state indicator, evaluated and unavailable imported-job states, dashboard visibility, local raw-retention notice, no raw/private-profile payload in page source, and no profile editor/CV/application/submission action.
- Regression: all 63 Phase 2 unit tests, 3 integration tests, 5 E2E tests, existing fixture counts/SEEK capability states, truth rules, document foundations, and human-confirmation gate remain green.
- Quality/security: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm audit`, `git diff --check`, secret/ignored-artifact audit, migration audit, and GitHub CI. CI must use only fictional fixtures and injected transports.

## U. Acceptance criteria

Phase 2.5 must not be marked `COMPLETE` unless:

- the `/import` workflow accepts pasted single ads, pasted multi-job/search results, pasted HTML, and allowed local files through one source-neutral contract;
- every untrusted boundary is bounded, inert, Zod-validated, and covered by adversarial tests;
- source detection for all named sources is deterministic, evidence-bearing, confidence-rated, and separate from URL authorization;
- the splitter returns only `CONFIDENT`, `REVIEW_REQUIRED`, or `FAILED`, never invents boundaries, and exposes uncertain records for review;
- preview shows count/title/company/location/source guess/confidence/warnings/duplicate status and requires explicit confirmation before canonical persistence;
- manual corrections preserve original extraction, raw content, timestamps, user override provenance, and identity recalculation;
- raw content stays local, never executes, never loads remote assets, and never appears in logs/audit/CI/cloud/browser storage;
- accepted raw content is explicitly documented/displayed as retained in the local ignored database for provenance/reprocessing; Phase 2.5 performs no automatic destructive cleanup, while export/delete/purge remain separately reviewed future work;
- uploads enforce the exact allowlist/limits and reject archives, executables, binary Office files, unknown MIME, PDF, and OCR paths;
- URL policy is default-deny, SEEK is `USER_CONTENT_REQUIRED`, every other named production source is `REVIEW_REQUIRED`, invalid/private/non-HTTPS/IP/local URLs are `UNSUPPORTED`, the production registry contains zero `FETCH_ALLOWED` entries, and blocked decisions never silently fall back;
- hostname classification uses only reviewed exact hosts or validated dot-boundary suffixes and withstands lookalike-domain, userinfo, confusable, trailing-dot, and port tests;
- credential/session rejection is limited to high-confidence structured material; ordinary job-ad email addresses, URLs, IDs, and security/API/password prose are accepted;
- duplicate handling uses only approved strong identities/content hash/local fingerprint, requires review for changed/colliding identities, and performs no fuzzy merge;
- database migration and backup/rollback tests pass, `identity_kind`/`identity_value` are the canonical consistent persistence identity, required source facts can remain null without fabrication, acquisition method never substitutes for origin, and no existing SEEK/provenance row changes meaning;
- detected origin and acquisition method remain separately modeled, persisted, audited, and displayed; user-supplied content is never represented as adapter-fetched and genuinely unknown origin remains `UNKNOWN`;
- selected records normalize and persist transactionally and appear in existing jobs/dashboard views even if evaluation is unavailable;
- real imported jobs never use the fictional candidate profile for eligibility or fit; only a validated private local profile may evaluate them, while absent/invalid/demo-only states remain `NOT_EVALUATED` with no fabricated score;
- private profile loading is fixed-path, Zod-validated, server-only, Git-ignored, absent from browser storage/client source/logs/audits/import functions/external services/CI/cloud, and represented in the UI only by an allowlisted explicit state;
- fixture/demo jobs may use `data/profile.example.json` only through an explicitly labelled demo context, and real/demo evaluation cannot be mixed silently;
- no real candidate name, phone, email, address, visa/work-right details, referee, CV, passport, identity material, or private profile is committed;
- no document generation, application preparation, form filling, status mutation beyond initial job state, or submission capability is added;
- no live job-board access, candidate/private data, credential/session artifact, database, or real advertisement is committed or used in CI;
- all local quality gates, dependency/security audits, and GitHub CI pass; actual results and limitations are recorded in this plan;
- the implementation branch is pushed with an unmerged PR into `main` and stops for human review; Phase 3 remains unstarted.

## V. Future extension points

- Source adapters implement a `RawJobDocumentProvider` that emits the same `RawImportedJobDocument`; they do not bypass validation, preview, deduplication, or confirmation.
- An email forwarder may transform an explicitly selected message/attachment locally, with sender/header/body privacy controls, into the same contract; mailbox-wide scanning is not implied.
- A browser extension may export only user-selected visible content/URL into a local authenticated handoff, never cookies, storage, credentials, hidden network responses, or automated browsing.
- A CLI may support `applypilot import <file>` and stdin with the same limits, preview manifest, and an explicit `--confirm` step; non-interactive auto-import is not the default.
- A mobile share target may send a URL or selected text to the local intake API after pairing/authentication and must receive the same URL-policy result.
- Future Greenhouse/Lever/Employment Hero/Workday/Indeed adapters plug in behind parser/provider registries with versioned capabilities and policy state. They may enrich source-specific fields but cannot weaken unknown handling or create application/submission paths.
- Parser/version migrations may reprocess local raw content into a new preview, but never mutate an existing confirmed job silently; differences require review and auditable update confirmation.

## W. Roadmap recommendation: public ATS discovery before Indeed

Recommendation: **YES — after Phase 2.5 is implemented and reviewed, plan a separate Phase 2.6 for read-only Greenhouse and Lever public job-board adapters before Phase 3 Indeed. Do not add or start Phase 2.6 automatically from this recommendation.**

Evidence reviewed on 2026-09-05, without requesting a live job listing:

- The official [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) states that published job-board data is publicly available and authentication is not required for GET endpoints; it documents list and retrieve job endpoints. Application POST is separately authenticated and remains out of scope.
- The official [Lever Postings API](https://github.com/lever/postings-api) documents unauthenticated read access to a tenant's published postings, including list/detail JSON, while its application POST uses an API key and remains forbidden here.
- Current [Indeed job-posting guidance](https://docs.indeed.com/job-postings/) focuses on ATS, agency, employer, and publishing-partner integrations rather than a general candidate discovery API. The [Indeed Developer Agreement](https://docs.indeed.com/legal-terms/developer-agreement) makes API access and integration approval discretionary and subject to written approval.

Greenhouse and Lever therefore offer narrower, documented, tenant-scoped read interfaces that can validate the URL registry/provider extension with lower access ambiguity and real published data before the broader Indeed research gate. A Phase 2.6 blueprint must still perform current terms, host/tenant discovery, rate-limit, field-completeness, pagination, retention, and security review; use GET only; never call application endpoints; remain local-first; and open its own planning PR for human approval. The historical Phase 3/5 numbering remains unchanged until the owner explicitly approves a roadmap amendment.

## Planning human-review checkpoint (completed)

This blueprint was initially `AWAITING_HUMAN_REVIEW`. The owner approved it on 2026-09-05 after the amendment addressed the real-versus-demo candidate-profile gate, server-only private-profile loader, safe hostname boundaries, zero-fetch production URL registry, narrow credential detection, canonical identity invariants, origin/acquisition separation, and raw-content retention. Planning PR #4 was then merged normally as recorded above; implementation is isolated on `feat/real-world-job-intake-implementation` and its future pull request must remain unmerged for a separate human decision.

## Planning checkpoint execution record

- Phase 2 closeout: PR #3 was verified against the approved head, green CI, private repository, implementation diff, tests, safety boundaries, tracked artifacts, and secret patterns, then merged normally as `cd3e13699cef3e41b8e3edd56239435ca647d66b` at `2026-09-05T06:42:34Z`. Fresh local `main` matched `origin/main`, and `feat/seek-discovery-implementation` was deleted locally and remotely.
- Planning branch: `feat/real-world-job-intake-plan`, created and pushed from the refreshed Phase 2 merge commit at `2026-09-05T16:42:55+10:00`.
- Planning pull request: #4, `https://github.com/adeel1608/applypilot/pull/4`, from `feat/real-world-job-intake-plan` into `main`. It is intentionally open and unmerged for human review.
- Plan content: inserted Phase 2.5 before Phase 3 without renumbering historical phases and added the complete A-W blueprint. Only `PROJECT_PLAN.md` changed; no application code, importer/parser, fixture, database schema/migration, URL fetcher, source adapter, application flow, or submission behaviour was created.
- External research: reviewed only official Greenhouse, Lever, and Indeed interface/legal documentation for section W. No job listing, job-board search page, live adapter endpoint, authenticated resource, browser session, or application endpoint was accessed.
- First planning-branch `npm run format:check`: failed because the fresh Windows checkout marked 48 Phase 2 files with CRLF working-copy differences. `npm run format` normalized those working copies; Git content comparison and staging confirmed that only `PROJECT_PLAN.md` had a substantive diff.
- Successful rerun: `npm run format:check`, `npm run lint`, and `npm run typecheck` passed; `npm test` passed 63 tests across 13 files; `npm run test:integration` passed 3 tests across 2 files; `npm run build` generated 34 pages; `npm run test:e2e` passed 5 tests; `npm audit` reported zero vulnerabilities; and `git diff --check` passed.
- Initial planning PR CI: GitHub Actions run `33951189079` passed every `quality` step in 1m31s, including install, formatting, lint, typecheck, unit/integration tests, production build, Chromium install, and E2E tests. GitHub emitted a non-blocking annotation that `actions/checkout@v4` and `actions/setup-node@v4` currently target a deprecated Node 20 action runtime while the workflow forces Node 24; the run passed and workflow maintenance is deferred to a separately planned change.
- Security/privacy result: repository visibility remained `PRIVATE`; the planning diff contained no credential, private profile, local database, browser/session/cookie state, real job content, generated document, candidate data, or high-confidence secret pattern. No live job-board access or application action occurred.
- Rollback: close PR #4 and delete the planning branch, or normally revert its documentation commit. There is no database, runtime, external job-board, candidate, application, or deployment state to undo.
- Unfinished work: all Phase 2.5 implementation is intentionally unstarted. Required next checkpoint is human review and an explicit decision on PR #4; if approved, merge normally, delete the planning branch, create `feat/real-world-job-intake-implementation` from fresh `main`, and follow section N. Phase 3 and the recommended-but-unapproved Phase 2.6 remain unstarted.

### Human-review amendment checkpoint

- Amendment request: resolve the candidate-profile runtime boundary and the additional hostname, URL-policy, credential-detection, persistence-identity, source/acquisition, retention, testing, and acceptance issues before approval of PR #4.
- Scope guard: documentation only on `feat/real-world-job-intake-plan`; no Phase 2.5 implementation branch, importer, migration, profile loader/provider, `/import` UI, network client, live job-board access, application action, or PR merge is permitted by this checkpoint.
- Baseline at amendment start: working tree clean at `0808f512c66622215e6b772db43bc3d5e75e2081`; PR #4 open from `feat/real-world-job-intake-plan` into `main`, `MERGEABLE`/`CLEAN`, with only `PROJECT_PLAN.md` changed and both existing `quality` checks successful.
- Blueprint result: added the fail-closed `CandidateProfileProvider` design, private-file loading boundary, conditional post-persistence evaluation, source/acquisition separation, safe host matcher, production zero-`FETCH_ALLOWED` policy, structured credential detection, canonical database identity invariants, explicit local raw retention, profile-focused tests, and mandatory acceptance gates. Real candidate content remains forbidden from Git.
- Local validation on Node `v24.18.0`: `npm run format:check`, `npm run lint`, and strict `npm run typecheck` passed; `npm test` passed 63 tests across 13 files; `npm run test:integration` passed 3 tests across 2 files; `npm run build` generated 34 pages; `npm audit` reported 0 vulnerabilities; and `git diff --check`, `git check-ignore data/profile.private.json`, the tracked-private-artifact check, and the changed-file scope check passed. The first `npm run test:e2e` invocation passed all 5 tests but emitted one non-fatal server `Unexpected end of JSON input` diagnostic during parallel navigation; an immediate full rerun passed all 5 tests without that diagnostic. No application code was changed to mask it.
- Amendment-content commit `12c0fc77565760c4b5b7826800f264c083b17810` was pushed to PR #4. GitHub Actions push run `33952285498` and pull-request run `33952287171` both passed every `quality` step in 1m33s, including install, format, lint, typecheck, unit/integration tests, production build, Chromium install, and 5 browser tests. Both retained the known non-blocking annotation that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime while the workflow forces Node 24; no check failed. The final checkpoint-record-only commit is separately required to pass CI before handoff.
- Unfinished work remains the entire Phase 2.5 implementation. PR #4 remains open and unmerged for renewed human approval; Phase 2.6 and Phase 3 remain unstarted.

## Phase 2.5 implementation execution record

- Implementation branch/base: `feat/real-world-job-intake-implementation`, created and pushed from refreshed `main` at approved planning merge `11185763b1679c35fecfcb45fbd9172a4a3a6de2`. The implementation-start checkpoint was committed before application code as `dfbec61`.
- Source-neutral intake: added pinned `@applypilot/job-importer` with 1 MiB/line/depth/count/field bounds, fatal UTF-8 decoding, MIME/extension/magic agreement, structure-aware credential rejection, data-only JSON, inert parse5 HTML/JSON-LD and repeated-card extraction, deterministic splitting, generic/SEEK-compatible parsing, source evidence, independent acquisition method, URL policy, canonicalization, hashing, and versioned local fingerprint support.
- Source and URL safety: named source recognition uses reviewed exact hosts or explicit dot-boundary Workday matching; adversarial lookalikes and credential-bearing URLs do not classify as trusted. SEEK is `USER_CONTENT_REQUIRED`; all other named/generic/unknown production sources are `REVIEW_REQUIRED`; invalid, non-HTTPS, userinfo, IP-literal, single-label, and local/private names are `UNSUPPORTED`. The production registry contains exactly zero `FETCH_ALLOWED` entries and the implementation contains no network/DNS content provider.
- Persistence/migration: added reviewed `0001_real_world_job_intake.sql`, `import_batches`, and `import_records`; rebuilt `job_source_records` with nullable explicit ID/URL/fetch time, canonical identity kind/value, independent acquisition method, consistency checks, and truthful Phase 2 backfill. Added an explicit preview/`--confirm` migration command with fixed resolved path, existing-database backup, integrity/foreign-key checks, source-row count/hash verification, and no startup migration. Raw accepted content remains only in the ignored local database with no automatic destructive cleanup.
- Confirmation and duplication: preview staging cannot write canonical jobs; random 30-minute tokens bind local confirmation and are deleted after use. Confirmed selected records are revalidated and transactionally imported, updated only with explicit acknowledgement, deduplicated by strong evidence, or blocked on external-ID/canonical-URL conflicts. Originals, edit patches, timestamps, parser/hash provenance, source, acquisition, and redacted audit events remain distinct.
- Candidate boundary: added `CandidateProfileProvider`, `DEMO_FIXTURE_JOB`/`REAL_IMPORTED_JOB` contexts, four explicit runtime states, and a fixed-path bounded server-only `data/profile.private.json` loader using `CandidateProfileSchema`. Real imports never receive the committed demo profile. Valid private profiles create/reuse local append-only profile-version provenance before atomic eligibility/fit writes; missing, invalid, demo-only, or failed evaluation leaves the imported job visible with null evaluation fields and no result rows. Browser DTOs contain only the allowlisted profile status.
- Local UI: added dynamic/no-store `/import` paste-one, paste-multiple, pasted-HTML, allowed-file, and URL-policy modes; escaped bounded preview, origin/acquisition labels, warnings, extracted-versus-edited values, import/skip/bulk-selection controls, update acknowledgement, and explicit confirmation. Dashboard/jobs/detail views include local imports and show `Not evaluated` rather than a fabricated score. `/profile` exposes only the safe runtime state. No document, application, status-advance, form-fill, fetch, or submission action was added.
- Fictional tests: added reconstructed import fixtures and unit/adversarial coverage for all named sources, lookalike hosts, zero-fetch policy, narrow credential positives/ordinary-ad negatives, JSON/HTML/file limits, 100/101 record bounds, schema.org and repeated HTML cards, SEEK parser reuse, URL canonicalization, identity, demo-profile mismatch, and safe profile DTOs. Added migration/persistence integration coverage for Phase 2 upgrade, profile/no-profile/demo-only evaluation gates, profile-version linkage, deduplication, token replay, identity conflicts, audit redaction, and database constraints. Added browser coverage for URL blocking without external requests, all paste/HTML/upload modes, preview/confirmation, dashboard/job visibility, not-evaluated messaging, and safe profile status.
- Documentation: updated README, architecture, security, adapter, and normalization guidance and added `docs/REAL_WORLD_JOB_INTAKE.md`, including explicit migration/backup, local retention, private-profile, no-network, and rollback boundaries.
- Local validation on Node `v24.18.0`: after formatting the final small UI text change, `npm run format:check`, `npm run lint`, and strict `npm run typecheck` passed; `npm test` passed 80 tests across 16 files; `npm run test:integration` passed 9 tests across 3 files; `npm run build` compiled all 8 application routes, with import/jobs/profile dynamic as required; `npm run test:e2e` passed 9 browser tests; `npm audit` reported 0 vulnerabilities; explicit migration preview and confirmed fresh-database migration/integrity verification passed; and `git diff --check` plus ignored/private/tracked-artifact audits are required again immediately before the implementation commit. Playwright emitted only its existing non-fatal `NO_COLOR`/`FORCE_COLOR` process warnings.
- Rollback: leave the implementation PR unmerged or revert its commits normally. Disable the `/import` route/navigation to restore the Phase 2 UI. Existing real local databases are never down-migrated or deleted automatically; restore the timestamped pre-migration backup if rollback is required. Imported data must not be coerced or discarded without a separate explicit user decision.
- Historical implementation handoff: complete Phase 2.5 implementation commit `449d3a577ce7f1074452f06cf45e394ef6d6bfe6` was pushed, and PR #5 (`https://github.com/adeel1608/applypilot/pull/5`) was opened from `feat/real-world-job-intake-implementation` into `main`. At that checkpoint the PR was intentionally open/unmerged and `MERGEABLE`; the later merge is recorded in the closeout below.
- Initial implementation CI: GitHub Actions push run `33955352108` passed every `quality` step in 1m51s, and pull-request run `33955358978` passed every `quality` step in 2m7s. Both covered clean install, formatting, lint, typecheck, 80 unit tests, 9 integration tests, production build, Chromium installation, and 9 browser tests. Both retained only the known non-blocking annotation that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime while the workflow forces Node 24.
- Historical handoff checkpoint: this implementation record was committed and pushed as `a688eca26496d386534cd4cc9ee586d73b602ff2`; final push run `33955494472` and pull-request run `33955496392` both passed. PR #5 then remained open for the separate human decision that was supplied before the closeout below. Phase 2.6 and Phase 3 remained unstarted.

## Phase 2.5 closeout

- Final status: `COMPLETE` on 2026-09-05 after explicit owner approval and the merge gate below.
- Pull request #5 (`feat/real-world-job-intake-implementation` -> `main`) was verified `OPEN`, non-draft, `MERGEABLE`, and `CLEAN` at exact head `a688eca26496d386534cd4cc9ee586d73b602ff2`. Its only commits were the implementation-start checkpoint `dfbec6199bc1872287b61d3f25a459b91ce8ca00`, implementation `449d3a577ce7f1074452f06cf45e394ef6d6bfe6`, and final checkpoint `a688eca26496d386534cd4cc9ee586d73b602ff2`; there were no reviews or comments requiring resolution.
- Final GitHub Actions `quality` runs `33955494472` (push) and `33955496392` (pull request) both completed successfully. They covered clean install, format, lint, strict typecheck, unit and integration tests, production build, Chromium setup, and browser tests. The known action-runtime deprecation annotation was non-blocking and did not fail either run.
- Final validated totals were 80 unit tests across 16 files, 9 integration tests across 3 files, all 8 application routes compiled in the production build, and 9 Playwright browser tests. `npm audit` and the production dependency audit reported 0 vulnerabilities. The explicit migration preview and a confirmed fresh test-database migration/integrity check passed during implementation validation.
- Repository visibility remained `PRIVATE`. The final tracked-artifact audit found no `data/profile.private.json`, SQLite database/journal, raw real advertisement, cookie, browser/auth session, generated personal CV/document, or credential. `git diff --check` passed; `git fsck --no-reflogs --full` reported only the already documented benign dangling blob `644a4ebfd0a77e8c168f71681aba74a404195d8a`.
- Production URL policy remained default-deny: SEEK is `USER_CONTENT_REQUIRED`; the other known/generic/unknown sources are `REVIEW_REQUIRED`; invalid/non-HTTPS/credential-bearing/IP/local inputs are `UNSUPPORTED`; `productionFetchAllowedCount()` remains zero. The importer has no production HTTP/DNS provider or live job-board client.
- The private-profile boundary remained fixed-path, bounded, server-only, Git-ignored, and Zod-validated. Real imported jobs require `PRIVATE_LOCAL_PROFILE`; missing/invalid/demo-only resolution leaves eligibility and fit unavailable, with no demo-profile fallback or result rows.
- PR #5 was merged normally at `2026-09-05T08:59:25Z` as merge commit `873a05a1fc6425ccc2e73fcf06448910172ca304`. Refreshed local `main` and `origin/main` both resolved to that SHA with a clean worktree. The fully merged implementation branch was deleted locally and remotely.
- No live source access, application preparation, form filling, status advance, final submission, real candidate profile, or real vacancy was used during implementation or closeout. Phase 2.6 and Phase 3 remain unstarted.
- Rollback remains a normal revert of the Phase 2.5 merge/commits. An existing real local database must not be down-migrated or deleted automatically; restore a separately protected timestamped pre-migration backup only after an explicit reviewed rollback decision. Imported raw content remains local until future reviewed export/delete/purge controls exist.
- Known limitations: no live URL fetching; no PDF/OCR/Office intake; no automatic raw-content cleanup; no standalone re-evaluation action for an already persisted unchanged job; required `CandidateProfileSchema` fact wrappers still require schema-valid values even when unverified; and custom migration path `APPLYPILOT_DB_PATH` and web filename `APPLYPILOT_DB_FILENAME` must be coordinated if the default path is not used.
- Newly identified activation blocker: the migration script currently creates an existing-database backup named `*.sqlite.<timestamp>.backup`, while the current `.gitignore` database rules do not match that exact suffix. No such file is tracked or present at closeout. Phase 2.5A must stop before any real migration until a dedicated reviewed bugfix branch adds/tests the exact backup ignore rule; this planning branch does not change runtime or ignore configuration.

# Phase 2.5A - Local Activation and Real-World Smoke Test

- Status: `AWAITING_HUMAN_REVIEW`
- Objective: prove the complete local real-world workflow using one private candidate profile and one real user-supplied vacancy before adding live public source adapters.
- Prepared on: 2026-09-05
- Planning branch: `chore/phase-2-5a-local-activation-plan`
- Planning base: Phase 2.5 merge commit `873a05a1fc6425ccc2e73fcf06448910172ca304`
- Scope of this checkpoint: blueprint and fictional documentation only. It does not create/read a real private profile, run a real migration, import a real vacancy, access a job board, add source/application behaviour, or start Phase 2.6/3.

## Current state, assumptions, requirements, and architecture

- Phase 2.5 is merged and provides the local `/import` UI, explicit preview/confirmation, conservative normalization/deduplication, SQLite persistence, fixed-path server-only private-profile resolution, conditional eligibility/fit evaluation, and dashboard/job-detail rendering.
- The owner will create or supply the real profile locally only after this blueprint is approved. The owner will separately supply exactly one visible vacancy advertisement they are entitled to use. Neither input is placed in Git, fixtures, chat transcripts intended for publication, issue/PR bodies, CI, screenshots, or cloud services.
- The application remains local-first and network-free for this checkpoint. A pasted SEEK advertisement may be classified as `detectedSource: SEEK` only from evidence in the supplied bytes, while `acquisitionMethod` remains `USER_SUPPLIED_CONTENT`. A URL or source label never authorizes retrieval.
- The activation uses the actual ignored local SQLite database at the migration preview's resolved path. The app remains stopped during migration, never auto-migrates, never deletes an existing database, and uses only migrations `0000_applypilot_foundation.sql` and `0001_real_world_job_intake.sql`.
- Real content follows the existing architecture without shortcuts: package-boundary validation and inert parsing; local staging/preview; explicit confirmation; strong identity and persistence; then the server-only provider and deterministic engines. No candidate data enters the importer, and no raw job body enters candidate evaluation or audit metadata.
- Proposed Phase 2.5A execution changes are limited to a small safe `scripts/validate-private-profile.ts`/`npm run profile:validate` helper and, if needed, a privacy-audit helper that reports only pass/fail sink names. Any such code is written and tested before the real profile exists and is reviewed on the Phase 2.5A execution branch. A defect in existing product behaviour uses the separate bugfix process in section L.
- Dependencies remain Node 24, npm workspaces, the merged local Next.js application, SQLite/Better SQLite3, `CandidateProfileSchema`, deterministic eligibility/fit packages, and a local browser. No paid API, AI provider, geocoder, mailbox, browser extension, public source client, or external service is added.

## A. Private profile setup plan

The real runtime path is exactly `data/profile.private.json`. It is local-only, fixed-path, server-only, bounded to 1 MiB, parsed as JSON, validated with `CandidateProfileSchema`, and never logged or sent externally. Git ignore and untracked-state checks are hard preconditions. It is never used by CI or captured in screenshots/traces. `docs/PRIVATE_PROFILE_SETUP.md` is the schema-derived fictional setup reference.

The current top-level input requires `schemaVersion`, `profileId`, `identity`, `contact`, `location`, `education`, `employment`, `verifiedAchievements`, `skills`, `languages`, `licences`, `certifications`, `workRights`, `availability`, `transport`, `preferences`, `unsupportedExperience`, `forbiddenClaims`, `referees`, and `candidatePreferences`. `displayNameTemplate` and `documentFileNameTemplate` have defaults.

Nested optional/defaulted fields are: `identity.preferredName`; `contact.linkedInUrl`/`portfolioUrl`; education `startDate`/`endDate`; employment `location`/`endDate` and defaulted `achievementIds`; skill `level`/`evidence`; licence `jurisdiction`/`expiresOn`; certification `issuer`/`expiresOn`; work-right `notes`; preference `earliestStartDate`/`salaryExpectation`; referee `contact` and defaulted `private`; and defaulted `candidatePreferences.includeRefereesOnResume`. Fact-wrapper `source` and `verifiedAt` are optional. Required arrays may be empty.

Verification is exactly `VERIFIED`, `USER_CONFIRMATION_REQUIRED`, or `UNKNOWN`. Only `VERIFIED` facts support claims. `verifiedAchievements[*].verification` must be literal `VERIFIED`, and every employment `achievementId` must resolve to one of those achievements. Required wrappers still require a schema-valid `value`; missing truth must not be replaced with an invented value.

Availability uses a non-empty timezone and arrays of recurring windows/fixed commitments. Days are Monday-Sunday enums, and times are 24-hour `HH:mm`. Work rights use a fact wrapper whose value includes country, `UNRESTRICTED | RESTRICTED | NONE | UNKNOWN`, a positive `maximumHoursPerFortnight` or `null`, and optional notes. Transport separately records a boolean vehicle-access fact, explicit modes, and a non-negative maximum-commute fact. Licences are explicit objects and are never inferred from vehicle access or role history. Job preferences record explicit location/work-type/category arrays, positive maximum weekly/fortnightly-hours facts, and optional earliest-start/salary facts. `unsupportedExperience` and `forbiddenClaims` are required negative constraints; they are not suggestion text and should overlap where a dangerous unsupported claim must be prohibited.

## B. Private profile validation procedure

Before real data exists, add and test `npm run profile:validate`. It must use the same fixed path and `CandidateProfileSchema.safeParse` as runtime and print exactly one primary result:

```text
Private candidate profile: VALID
```

or `MISSING` or `INVALID`. `VALID` exits zero; `MISSING` and `INVALID` use documented non-zero exits. Invalid output may include only bounded schema field paths and stable error codes, never candidate values, input fragments, file body, full exception, profile hash, or resolved private path. The command performs no database write, browser start, logging, analytics, or network call.

Before invoking it, `git check-ignore -v data/profile.private.json` must identify the repository ignore rule and `git ls-files --error-unmatch data/profile.private.json` must fail. After the owner creates the file locally from verified facts, run the validator and record only its state and exit code. If it is invalid, do not launch the real import; correct only owner-confirmed local facts or record the schema path as a blocker.

## C. Database activation

1. Resolve the backup-ignore blocker through a dedicated reviewed bugfix PR before touching a real database. The exact migration backup filename `data/applypilot.local.sqlite.<timestamp>.backup` must be ignored and verified with `git check-ignore`.
2. Stop all ApplyPilot development, production, and E2E processes. Use the default database path unless a custom path is explicitly reviewed; the migration's `APPLYPILOT_DB_PATH` and web runtime's `APPLYPILOT_DB_FILENAME` must resolve to the same intended file.
3. Run `npm run db:migrate`. This is preview-only. Record the resolved absolute path without listing directory contents or database data, and confirm it is the intended local file.
4. Confirm whether the file exists. Do not delete, rename, truncate, replace, or down-migrate it. If it exists, confirm the timestamped backup destination will remain ignored and local.
5. Run `npm run db:migrate -- --confirm`. The command checks pre-migration integrity, creates a backup only when a database already exists, recognizes/applies `0000`, applies `0001` when `user_version < 1`, verifies source-record row count/hash, runs `PRAGMA foreign_key_check`, and finishes with `PRAGMA integrity_check`.
6. Record only the database path class (`default local` or approved override), whether a backup was created, `user_version`, migration identifiers `0000`/`0001`, integrity result, foreign-key result, and command exit status. Never print job/profile/raw-content rows.
7. Start the application only after the confirmed migration reports `ApplyPilot local database is migrated and verified.` A failure stops activation; retain the original database and backup and follow the rollback plan.

## D. Real vacancy test input

- Use exactly one real vacancy initially, preferably a normal casual or part-time role relevant to the candidate. The owner explicitly supplies the complete visible advertisement content; ApplyPilot does not search, browse, fetch, follow its URL, or access an authenticated session.
- Do not place the content in Git, a fixture, a test snapshot, command-line history, issue/PR text, or CI. Paste it directly into the local `/import` workflow over loopback.
- For a SEEK vacancy, record `acquisitionMethod: USER_SUPPLIED_CONTENT` and record `detectedSource: SEEK` only when the parsed source URL/structured content supplies valid SEEK evidence. A mere user hint is not enough. Source URL, external ID, posting date, and every other field stay absent when the supplied content does not establish them.
- Keep the original visible advertisement available to the human for side-by-side review, without asking ApplyPilot to retrieve it.

## E. Expected end-to-end flow

`real user content -> bounded validation -> inert parsing -> evidence-based source detection -> deterministic preview -> human field inspection/edit/skip -> explicit confirmation -> strong deduplication -> normalized job/source/import persistence -> resolve REAL_IMPORTED_JOB with PRIVATE_LOCAL_PROFILE -> append/reuse profile version -> eligibility -> fit score -> dashboard/jobs detail`

No canonical job exists before confirmation. No engine runs with `DEMO_PROFILE`. Missing/invalid private state preserves the imported job but writes no eligibility/fit result. Confirmation does not shortlist, generate a document, prepare/form-fill an application, change application status beyond `NEW`, or submit anything.

## F. Manual review checklist

For every item below, compare the original visible advertisement, preview, and persisted job detail. Record `MATCH`, `ABSENT/UNKNOWN`, `USER_CORRECTED`, or `PARSER_DEFECT`, plus a safe field name/reason only; do not copy the real value into the plan or PR:

- job title; company/advertiser; location;
- employment type; hours/ranges; days, times, shifts, and schedule;
- salary text, currency, period, minimum, and maximum where explicitly present;
- required experience separately from preferred experience;
- qualifications/certifications; licences/checks; vehicle requirement;
- work-right wording without strengthening `valid` into `unrestricted`;
- physical requirements without medical inference;
- original posting-date text and normalized posting date;
- detected source, evidence/confidence, and acquisition method.

Any unsupported parser inference, strengthened wording, invented placeholder, incorrect required/preferred classification, or source/acquisition conflation is a failure. UI editing may correct an extraction only from the original visible advert and must preserve override provenance; it must not manufacture missing information.

## G. Eligibility review

Inspect the persisted eligibility status and every stable reason under four headings: positive facts, blocking facts, review-required facts, and rule/source references. Compare each result with the private profile and original vacancy manually. Verify hard blockers such as qualifications, licences, vehicle, work rights, availability/hours, commute, and mandatory experience only use explicit candidate/job evidence. Unknown material facts must produce review rather than eligible. Tests passing is supporting evidence, not proof that this one real decision is correct.

The review record contains only status and stable reason/rule codes or generalized field paths. It must not copy candidate values or the real advertisement. Any materially wrong decision stops Phase 2.5A and enters section L.

## H. Fit-score review

Inspect the 0-100 total, every category contribution, positive reasons, and negative reasons. Check for obviously incorrect weighting, missing verified candidate evidence, misparsed job requirements, false-positive signals, and false-negative signals. Confirm the score does not use unverified/unknown/forbidden facts and does not override an ineligible/review-required decision.

This checkpoint does not tune weights. Record non-blocking calibration observations for Phase 7/8 using safe category/rule labels. A defect that prevents truthful basic use follows section L.

## I. Demo-profile isolation

Before the one real import, prove the invariant without sacrificing the final evaluated state:

1. With the valid real profile backed up only to an ignored `data/private/` location, temporarily remove it from the fixed path using a reversible move; never print/copy its body. Run `npm run profile:validate` and require `MISSING`.
2. Run the focused existing isolated integration case for `REAL_IMPORTED_JOB` with no active profile and the case that rejects `DEMO_PROFILE`; require `NOT_EVALUATED`, null job eligibility/fit, and zero result rows. The test uses fictional data and an isolated in-memory database, not the real vacancy or real profile.
3. Restore the file atomically to `data/profile.private.json`, validate `VALID`, and only then import the sole real vacancy into the actual database.
4. Confirm the real import reports/records `PRIVATE_LOCAL_PROFILE` and its eligibility/fit rows link to a private profile version. Confirm fixture jobs remain explicitly demo-labelled.

The current Phase 2.5 implementation has no standalone re-evaluation command and does not evaluate an unchanged duplicate. Therefore do not use the sole actual vacancy as a missing-profile probe and expect it to become evaluated after restoring the file. If human acceptance requires the same persisted real job to demonstrate both live states, record this as a product gap and open a dedicated bugfix plan/PR; do not edit SQLite or distort the advert to force an update.

## J. Privacy audit

After the smoke test, stop the app and run an audit that reports only sink names and `PASS`/`FAIL`:

- `git status --short` is clean after committing only non-sensitive execution evidence;
- `git ls-files --error-unmatch data/profile.private.json` fails, while `git check-ignore -v` succeeds for the profile, SQLite database, WAL/SHM files, and the exact timestamped migration-backup filename;
- no real/private candidate value appears in captured logs, Playwright traces, screenshots, HTML source, localStorage, sessionStorage, source maps, CI output/artifacts, Git history/diff, or `audit_events.redacted_metadata_json`;
- no private profile path, body, validation input, hash exposed to the browser, referee/contact fact, or candidate field entered importer/parser/source calls;
- no real raw job body exists in Git, fixtures, snapshots, logs, screenshots/traces, CI, or audit bodies; its permitted copies remain only in the ignored local database and the user's original source;
- SQLite and all migration backups remain local and ignored; no database is attached to an issue/PR or uploaded;
- no network request reached a job-board/public source and no application/document action occurred.

The audit may compare in-memory candidate strings/hashes against local sinks, but must never print the needles or matching content. Do not generate screenshots or retain traces during the real-data run. A single privacy failure stops the phase, preserves evidence only in non-sensitive form, and invokes section L.

## K. Success criteria

Phase 2.5A succeeds only when:

- the private profile validates locally and remains untracked, ignored, server-only, absent from CI/external services, and undisclosed in all audited sinks;
- the explicit migration resolves the intended local database, protects an existing database with an ignored backup, applies/verifies `0000` and `0001`, passes integrity/foreign-key checks, and performs no startup auto-migration or deletion;
- exactly one real user-supplied vacancy can be pasted, previewed truthfully, manually reviewed, explicitly confirmed, strongly deduplicated, and displayed in dashboard/job detail;
- source and acquisition method remain truthful, including SEEK plus `USER_SUPPLIED_CONTENT` only when source evidence supports SEEK;
- eligibility uses `PRIVATE_LOCAL_PROFILE`, preserves profile-version provenance, and exposes inspectable correct positive/blocking/review reasons;
- fit produces an inspectable score, category contributions, and positive/negative reasons without unverified or forbidden facts;
- real-import/demo-profile mismatch produces `NOT_EVALUATED` in the isolated proof, never demo evaluation;
- no unsupported parser inference, sensitive-material leak, live source network request, document/application action, form fill, status advance, or submission occurs.

## L. Failure and bug handling

Do not patch `main`, the planning branch, the real database, or a persisted job by hand. For a product defect, create a dedicated branch from fresh `main`. Before code, update `PROJECT_PLAN.md` with the safe symptom, exact reproduction using fictional/redacted data, expected/actual behaviour, root-cause hypothesis, security/privacy impact, test required, migration/data impact, rollback, and acceptance criteria. Add a regression fixture that contains no real profile/job content, implement the smallest fix, run all gates/audits, and open an unmerged PR for human review.

The known timestamped-backup ignore defect is a mandatory pre-activation bugfix. If a candidate schema gap prevents truthful validation, or the same-job live demo-isolation transition is required, those are separate bugfix decisions; never fabricate facts or directly rewrite database state.

## M. Next phase gate

Only after the owner reviews evidence and marks Phase 2.5A `COMPLETE` may ApplyPilot plan Phase 2.6, the read-only Greenhouse + Lever public discovery blueprint. Phase 2.5A approval does not authorize Phase 2.6 implementation, Phase 3 Indeed work, any live job-board request, or application submission.

## Testing, rollback, and exact execution order

Before any real data is created, run the full merged baseline suite. After the smoke test and privacy audit, rerun `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm audit`, and `git diff --check`. Use `npm.cmd`/`npx.cmd` equivalents where PowerShell blocks script shims. Test data remains fictional and E2E must not capture real-data screenshots/traces.

Operational rollback is non-destructive: stop the app; restore the private profile only from its ignored local backup; keep the database and migration backup intact; revert committed helper/documentation code normally; never delete or down-migrate the real database or imported job without a separate explicit owner decision. If migration fails, do not start the app and retain the original/backup for reviewed recovery. If privacy fails, stop and do not push until the leak is removed from all local/Git artifacts without rewriting shared history unless separately authorized.

Exact steps after blueprint approval are:

1. Merge only the approved planning PR normally, refresh `main`, verify `main == origin/main`, and create a dedicated Phase 2.5A execution branch.
2. Re-read repository instructions and this entire plan; record the execution start before changing code or operating on real data.
3. Resolve the timestamped migration-backup ignore defect on a dedicated bugfix branch/PR and obtain human approval; rebase/recreate the execution branch from the fixed fresh `main`.
4. Before any real input, implement/test the safe profile-state validator and any privacy checker, run the full baseline suite, and commit only those non-sensitive helpers/plan records.
5. Have the owner create `data/profile.private.json` locally from `docs/PRIVATE_PROFILE_SETUP.md`; verify ignore/tracking state and run the state-only validator. Do not read it into chat or print values.
6. Perform the reversible missing-profile/provider isolation procedure with fictional in-memory test data, restore the file, and require `VALID` before proceeding.
7. Stop the app, preview and confirm the explicit migration on the intended actual local database, and record only safe metadata/results.
8. Start the local app. The owner supplies exactly one visible vacancy body directly to `/import`; do not use its URL to fetch anything.
9. Inspect every preview field against the original, apply only evidence-backed corrections, then explicitly confirm the selected job once.
10. Verify persisted provenance, dashboard/detail display, `PRIVATE_LOCAL_PROFILE` evaluation, profile-version linkage, eligibility reasons, fit contributions/reasons, and absence of application actions.
11. Run the privacy audit and complete regression/quality gates. Record only safe statuses, counts, codes, timestamps, and SHAs in this plan.
12. Push the execution branch and open an unmerged PR for the final human review. Do not merge it, delete/alter real local data, access a live source, or start Phase 2.6/3.

## Phase 2.5A planning checkpoint execution record

- Phase 2.5 merge: after explicit owner approval, PR #5 was verified at expected head `a688eca26496d386534cd4cc9ee586d73b602ff2` with `OPEN`/`MERGEABLE`/`CLEAN` state, private repository visibility, final successful CI runs `33955494472` and `33955496392`, expected three-commit history, no reviews/comments, and no tracked sensitive/runtime artifact or forbidden network/submission addition. It merged normally as `873a05a1fc6425ccc2e73fcf06448910172ca304` at `2026-09-05T08:59:25Z`.
- Refreshed local `main` exactly matched `origin/main` at the merge SHA with a clean worktree. The fully merged `feat/real-world-job-intake-implementation` branch was deleted locally/remotely. Planning branch `chore/phase-2-5a-local-activation-plan` was created and pushed from that fresh main.
- Intended planning changes are this living-plan closeout/Phase 2.5A blueprint, the fictional schema-derived `docs/PRIVATE_PROFILE_SETUP.md`, and the README status/link update. No application/importer/database/schema/migration/source/application code, ignore rule, real profile, real vacancy, local database, generated document, credential, session, or browser state is part of the planning diff.
- The fictional documentation template was extracted and successfully parsed by the actual `CandidateProfileSchema` without writing a profile file.
- Local validation on Node `v24.18.0`: `npm run lint` and strict `npm run typecheck` passed; `npm test` passed 80 tests across 16 files; `npm run test:integration` passed 9 tests across 3 files; `npm run build` passed and generated 31 static segments across the eight application routes; `npm run test:e2e` passed all 9 browser tests; and `npm audit` reported 0 vulnerabilities.
- The first `npm run format:check` found the known Windows CRLF working-copy mismatch across 52 merged Phase 2.5 files. `npm run format` normalized the worktree; content comparison confirmed that only the intended documentation/plan files changed, and the rerun passed. `git diff --check` passed. Playwright emitted only the existing non-fatal `NO_COLOR`/`FORCE_COLOR` process warnings.
- Security/scope result: the repository remains private; `data/profile.private.json` remains ignored and untracked; no SQLite database/journal, migration backup, raw real advert, private profile, generated personal document, credential, cookie, auth/browser session, or build artifact is present in the planning diff. No job board was accessed and no application action occurred.
- Blocker: the planned exact migration-backup ignore test currently fails because `*.sqlite.<timestamp>.backup` is not matched by `.gitignore`. Activation and real-data handling are not authorized by this blueprint and must wait for the dedicated bugfix/review described above. No real migration was run during this task.
- Rollback: close the unmerged planning PR and delete the planning branch, or normally revert its documentation commit after merge. There is no real profile, vacancy, database, job-board, application, or deployment state to undo.
- Planning commit/pull request: documentation commit `11e4b451c9dabdccee4e71c9975b5a93dbeb85bd` was pushed, and PR #6 (`https://github.com/adeel1608/applypilot/pull/6`) was opened from `chore/phase-2-5a-local-activation-plan` into `main`. At that exact head it was `OPEN`, non-draft, `MERGEABLE`, and `CLEAN`, with no reviews or comments; push run `33957557263` passed in 1m57s and pull-request run `33957578628` passed in 1m52s.
- Final handoff checkpoint: commit and push this PR/CI record, wait for its new push and pull-request `quality` runs, confirm the branch is clean and PR #6 remains open, then stop for human review. The final run IDs belong in the handoff rather than a recursive checkpoint-commit loop. Phase 2.5A operation, the backup-ignore fix, real profile setup, real vacancy import, Phase 2.6, and Phase 3 are not started.

## Exact recommended Phase 2.5A execution prompt

```text
PROJECT: ApplyPilot
PHASE: 2.5A - LOCAL ACTIVATION AND REAL-WORLD SMOKE TEST

The Phase 2.5A blueprint has been approved and merged. Follow AGENTS.md and read PROJECT_PLAN.md, SECURITY.md, docs/REAL_WORLD_JOB_INTAKE.md, docs/PRIVATE_PROFILE_SETUP.md, and the actual CandidateProfileSchema in full. Inspect Git/GitHub state first. Refresh main, require main == origin/main and a clean worktree, then create a dedicated Phase 2.5A execution branch from fresh main. Do not start Phase 2.6 or Phase 3.

Before handling any real data, check whether the known migration-backup ignore defect still exists: the migration creates *.sqlite.<timestamp>.backup. If that exact filename is not ignored, STOP activation, create a dedicated bugfix branch, update PROJECT_PLAN.md first, add a regression check and the narrow ignore fix, run all gates, and open an unmerged bugfix PR for human review. Resume Phase 2.5A only after that PR is explicitly approved/merged and the execution branch is refreshed from fixed main.

Implement only the blueprint's small safe local validation/audit helpers if they are still absent. `npm run profile:validate` must read only data/profile.private.json through CandidateProfileSchema and print `Private candidate profile: VALID`, `MISSING`, or `INVALID`; invalid diagnostics may expose bounded field paths/codes only, never values, body, full exception, hash, or resolved path. Write and test helpers before the real file exists. Run the full baseline gates using fictional data.

Do not create or infer the owner's profile yourself. Ask the owner to create data/profile.private.json locally from docs/PRIVATE_PROFILE_SETUP.md and confirm it is ready. Never paste, echo, log, screenshot, upload, commit, or send its contents externally. Verify `git check-ignore` succeeds, `git ls-files --error-unmatch` fails, and the safe validator returns VALID. If required truthful schema values are unavailable, stop rather than inventing them.

Prove demo isolation before the real import: reversibly move the private file only to an ignored data/private location, require the validator to return MISSING, and run the focused fictional/in-memory integration cases proving REAL_IMPORTED_JOB with missing or DEMO_PROFILE resolution stays NOT_EVALUATED with null eligibility/fit and no result rows. Restore the private file and require VALID. Do not use the sole real job as the missing-profile probe; Phase 2.5 has no standalone re-evaluation for an unchanged duplicate.

Stop the app. Run `npm run db:migrate`, inspect the resolved intended local path, then run `npm run db:migrate -- --confirm`. Do not delete or down-migrate an existing database. Confirm any timestamped backup is ignored/local, migrations 0000 and 0001 are present, user_version is correct, and integrity/foreign-key checks pass. Start the app only after success.

Ask the owner to supply exactly one complete visible casual/part-time vacancy advertisement they are entitled to use and paste it directly into local `/import`. Do not browse, search, fetch, or follow a job-board URL. Do not put the advert in Git, fixtures, test snapshots, logs, screenshots, traces, CI, or PR text. For SEEK, require evidence before `detectedSource: SEEK`; acquisition must remain `USER_SUPPLIED_CONTENT`.

Manually compare preview and persisted detail against the original for title, company, location, employment type, hours, schedule, salary, required/preferred experience, qualifications, licences, vehicle, work rights, physical requirements, posting date, source, and acquisition method. Any unsupported inference is failure. Explicitly confirm only after review. Verify the job appears in dashboard/detail, uses PRIVATE_LOCAL_PROFILE with profile-version provenance, has inspectable and manually correct eligibility status/reasons and fit total/category contributions/positive/negative reasons, and never uses DEMO_PROFILE.

Do not tune scoring during this smoke test. Record non-blocking calibration observations for Phase 7/8. For any defect, do not patch main or edit SQLite: update PROJECT_PLAN.md first with safe reproduction/impact/test/rollback, use fictional regression data on a dedicated bugfix branch, and open an unmerged PR.

Run the blueprint privacy audit without printing candidate/job values: clean Git status; profile/database/WAL/SHM/timestamped backups ignored and untracked; no private profile in logs, traces, screenshots, browser storage, HTML/source maps, Git, CI, or audit bodies; no real raw advert in Git/logs/traces/CI/audits; no job-board request; no document/application/form-fill/status/submission action. Do not retain real-data screenshots or traces.

Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm audit`, and `git diff --check`. Update PROJECT_PLAN.md with safe commands/results, blockers, rollback state, and the next human gate only. Push the execution branch and open an unmerged PR. Do not merge it. Do not start Phase 2.6, Phase 3, live source access, or application submission.
```
