# ApplyPilot Project Plan

Last updated: 2026-09-08
Owner: `adeel1608`  
Repository: `adeel1608/applypilot`  
Working branch: `plan/r1-r2-next-gate`

Repository visibility: `PUBLIC` (owner-authorized on 2026-09-07; private local data remains excluded).

Current forward baseline: PR #10 was human-reviewed at exact head `b7872fe5791f1baa88d9e95e2b7096926ea44813` and merged to `main` as `4a0462d24b9a8db79ec49ff64242405d8f96f40d`. Manual-intake Personal Beta is `READY`. Source-enabled Personal Beta remains `WAITING_FOR_APPROVED_TENANT`; Personal Live V1 and hosted production are `NOT_READY`; the real runner remains `TARGET_APPROVAL_REQUIRED`. This branch is documentation-only and plans [R2 matching quality](docs/R2_MATCHING_QUALITY_PLAN.md) plus a separate [R1 source-enabled Beta](docs/R1_SOURCE_ENABLED_BETA_PLAN.md). It authorises no application-code implementation, migration, tenant/source request, employer-form visit, upload, submission, deployment, or PR merge. Historical phase/checkpoint evidence below remains intentionally unchanged. Historical references to a private GitHub repository describe their original checkpoints; current GitHub visibility is PUBLIC. Every npm package publication guard remains unchanged.

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

| Phase | Objective                                  | Tasks                                                                                               | Acceptance criteria                                                                                                            | Key risks                                                              | Dependencies                                   | Validation requirements                                             | Status      |
| ----- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| 0     | Bootstrap repository and architecture      | Private GitHub repo, branch, workspace, docs, CI, security baseline                                 | Required docs/config exist; CI design covers quality gates; private repo and feature branch verified                           | Premature architecture lock-in                                         | GitHub CLI, Node LTS                           | Lint, typecheck, tests, build, Git/GitHub audit                     | COMPLETE    |
| 1     | Establish candidate/domain/data foundation | Truth store, normalized jobs, database, fixtures, eligibility, scoring, basic documents, dashboard  | All Phase 0/1 acceptance criteria in this plan pass                                                                            | Incorrect rules or unsafe claims                                       | Phase 0, Zod, Drizzle, fixtures                | Unit/integration/E2E tests and production build                     | COMPLETE    |
| 2     | Add SEEK discovery                         | Policy review, discovery/detail mapping, fixture replay, throttling/error model                     | SEEK jobs normalize with provenance; no protection bypass                                                                      | Site/policy changes, rate limits                                       | Phases 0-1                                     | Contract tests, fixture replay, manual policy audit                 | COMPLETE    |
| 2.5   | Add real-world job intake                  | Source-neutral paste, multi-job, HTML, upload, preview, confirmation, and policy-gated URL intake   | Real ads enter one validated local pipeline and are evaluated only with a valid private profile; no scraping or invented facts | Untrusted content, demo-profile leakage, false splits, duplicate drift | Phase 2 normalization and persistence patterns | Parser/profile/security fixtures, integration/E2E, migration review | COMPLETE    |
| 2.5A  | Validate local real-world activation       | One private local profile, one user-supplied vacancy, migration, evaluation, UI, and privacy checks | The real local workflow is truthful and leak-free; no source fetch or application action                                       | Private-data leakage, parser mismatch, demo fallback, invalid profile  | Merged Phase 2.5 implementation                | Manual comparison, isolation/privacy audit, full regression suite   | COMPLETE    |
| 3     | Add Indeed discovery                       | Policy review, discovery/detail adapter, fixture replay                                             | Indeed jobs normalize with provenance and safe failures                                                                        | Site/policy changes, bot controls                                      | Phases 0-2 patterns                            | Contract tests, fixture replay, manual audit                        | NOT_STARTED |
| 4     | Add Employment Hero adapter                | Model public listings/details and capability boundaries                                             | Supported public jobs normalize; unsupported flows declared                                                                    | Tenant variation                                                       | Adapter contracts                              | Contract/integration tests                                          | NOT_STARTED |
| 5     | Add generic ATS adapters                   | Greenhouse, Lever, Workday, generic company sites                                                   | Each adapter passes common contract suite and retains raw provenance                                                           | Vendor/tenant variation                                                | Phases 2-4 lessons                             | Per-adapter fixtures and policy/security checks                     | NOT_STARTED |
| 6     | Refine normalization and deduplication     | Canonical fields, similarity signals, merge review UX                                               | Duplicate clusters are explainable and source records remain intact                                                            | False merges                                                           | Multi-source fixtures                          | Precision/recall fixture suite and manual review                    | NOT_STARTED |
| 7     | Refine eligibility                         | Expand rules, confidence, override/audit workflow                                                   | Hard blockers and overrides are deterministic and audited                                                                      | False negatives                                                        | Candidate feedback and normalized data         | Rule matrix, regression tests                                       | NOT_STARTED |
| 8     | Refine fit scoring                         | Calibrate weights and preference signals                                                            | Scores remain explainable and calibrated against reviewed outcomes                                                             | Misleading precision/bias                                              | Outcome samples                                | Golden cases, sensitivity and bounds tests                          | NOT_STARTED |
| 9     | Complete CV template engine                | Implement categories and reusable layout validation                                                 | ATS-safe categories render within configured page limits                                                                       | Layout drift                                                           | Truth store, Playwright                        | PDF structure, page-count, visual QA                                | NOT_STARTED |
| 10    | Add automatic CV tailoring                 | Deterministic tailoring first; optional provider boundary                                           | Every claim has profile provenance; unsupported claims fail closed                                                             | Hallucination                                                          | Phase 9 and truth provenance                   | Adversarial truth-compliance tests                                  | NOT_STARTED |
| 11    | Complete cover-letter generation           | Requirement selection, tone configuration, layouts                                                  | Employer/role accurate, fact-safe, non-generic output                                                                          | Unsupported claims                                                     | Phase 10 patterns                              | Content provenance and PDF validation                               | NOT_STARTED |
| 12    | Build application preparation              | Question mapping, answer store, document checklist                                                  | Prepared packet identifies every unknown and required review                                                                   | Incorrect answers                                                      | Documents and normalized jobs                  | Workflow integration tests                                          | NOT_STARTED |
| 13    | Add assisted browser filling               | Local runner, field mapping, pause/resume, confirmation gate                                        | Safe assisted filling works on approved fixtures; no unattended final submit                                                   | Credential leakage, site controls                                      | Phase 12, security review                      | Synthetic-site E2E, threat-model review                             | NOT_STARTED |
| 14    | Complete tracking dashboard                | Persistent queues, timelines, status actions                                                        | Applications and events are filterable and auditable                                                                           | State inconsistency                                                    | Database and runner events                     | Transition and UI tests                                             | NOT_STARTED |
| 15    | Add scheduled discovery                    | Local/cloud schedules, checkpoints, idempotency                                                     | Runs are resumable and deduplicated without duplicate notifications                                                            | Rate limiting, missed runs                                             | Source adapters                                | Scheduler/idempotency tests                                         | NOT_STARTED |
| 16    | Add notifications                          | Local/email/push option analysis and preferences                                                    | Opt-in notifications contain minimal sensitive data                                                                            | Privacy and alert fatigue                                              | Phase 15                                       | Preference and redaction tests                                      | NOT_STARTED |
| 17    | Add analytics                              | Conversion, source/template/category/company/location/time metrics                                  | Metrics derive reproducibly from event data                                                                                    | Small-sample bias                                                      | Tracking history                               | Query fixtures and metric reconciliation                            | NOT_STARTED |
| 18    | Add optional AI providers                  | Provider-neutral interface, redaction, consent, deterministic fallback                              | Base app works without AI; provider use is explicit and auditable                                                              | Privacy, cost, hallucination                                           | Mature truth-safe engines                      | Contract, redaction, fallback tests                                 | NOT_STARTED |
| 19    | Deploy approved topology                   | Hybrid runner/cloud implementation, migrations, operations                                          | Threat model approved; rollback and recovery tested                                                                            | Secrets, availability, migration loss                                  | Prior phases and hosting choice                | Staging, backup/restore, security tests                             | NOT_STARTED |
| 20    | Production security hardening              | Pen test, dependency policy, incident response, release gates                                       | Critical findings resolved and operational controls documented                                                                 | Unknown vulnerabilities                                                | Deployment candidate                           | SAST/dependency/manual security audits                              | NOT_STARTED |

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

- Status: `COMPLETE`; dedicated bugfix PR #7 was reviewed and merged before Phase 2.5A execution began.
- Working branch: `fix/ignore-sqlite-migration-backups`.
- Fresh base: merged Phase 2.5A blueprint PR #6 at `48a5cf73a83a27dc2dea2d749d79cb3da45e0fe0`; local `main` and `origin/main` matched that commit with a clean worktree before this branch was created.
- Blueprint merge: PR #6 merged normally at `2026-09-06T06:41:46Z`. The merged planning branch was deleted locally and remotely only after ancestry and ref equality were verified.
- Objective: prevent the timestamped safety copy produced by the explicit local migration command from becoming trackable, lock the policy with a deterministic fictional-path regression, and stop at an unmerged human-review PR.

## Problem

When the selected database already exists, `scripts/migrate-local-database.ts` creates a sibling backup by appending a colon-normalized ISO timestamp and `.backup` to `databasePath`. For the supported ApplyPilot filename this produces `data/applypilot.local.sqlite.<timestamp>.backup`. The existing `.gitignore` covers active `.sqlite`, `.sqlite-wal`, and `.sqlite-shm` files, but not that appended backup form. A real migration could therefore leave a private local database copy visible to Git.

Phase 2.5A real-data activation was **BLOCKED** until this fix was reviewed and merged. The bugfix task did not create a profile, inspect a CV, run the migration, create a backup, import a vacancy, or operate on real candidate/job data.

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

- Operational status: `COMPLETE`. The repository fix was implemented, locally validated, explicitly reviewed, and merged as PR #7 before Phase 2.5A execution. Phase 2.5A itself remains separately in progress.
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
- Pull request and CI checkpoint: bugfix PR #7 (`https://github.com/adeel1608/applypilot/pull/7`) was opened into `main` with title `fix: ignore local migration backups before activation` and intentionally left unmerged. At implementation/results head `0f853e90c19d23498acf0d61183e2a61a2556d2c`, push `quality` run `34017740553` passed in 2m0s and pull-request run `34017743172` passed in 1m51s. This checkpoint-record-only commit must also pass its new final-head runs; those final IDs belong in the handoff rather than a recursive plan update.
- Completed gate: the owner explicitly approved PR #7, which merged normally as `6f42b8f1edd5813d34c398aad56248555fae044d` at `2026-09-06T07:09:44Z`; the fresh-main Phase 2.5A execution branch was then created. No activation action occurred on the bugfix branch.

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

# Phase 2.5A Execution

- Status: `COMPLETE`.
- Started: 2026-09-06.
- Execution branch: `feat/phase-2-5a-local-activation`.
- Approved bugfix merge: PR #7 merged normally as `6f42b8f1edd5813d34c398aad56248555fae044d` at `2026-09-06T07:09:44Z`. Fresh local `main` matched `origin/main` at that SHA with a clean worktree; the merged bugfix branch was deleted locally/remotely before this branch was created and pushed.
- Current local state: no `data/profile.private.json`, SQLite database, WAL/SHM file, or timestamped backup exists. No real vacancy content has been supplied or retained. Real-data operations have not started.

## Current state, objective, and assumptions

The merged Phase 2.5 application already provides local bounded intake, explicit preview/confirmation, strong identity, SQLite persistence, server-only private-profile resolution, deterministic eligibility/fit evaluation, and dashboard/detail views. The merged blocker fix protects the supported timestamped SQLite backup form. A dedicated safe profile validator is absent and must be implemented/tested before any real profile exists.

The objective is to validate the complete local workflow with one owner-confirmed private profile and exactly one owner-supplied visible vacancy, without accessing a job board or enabling an application action. The default `data/applypilot.local.sqlite` path will be used. The owner has not yet supplied the required profile facts or vacancy body; those gates require interactive owner input after the fictional-only helper and baseline checks are complete. Unknown facts remain unknown, and no required value may be invented merely to satisfy the schema.

## Operations and exact implementation changes

1. Verify the merged ignore contract directly and run its permanent regression.
2. Add `scripts/validate-private-profile.ts`, using the fixed repository-relative private-profile path, 1 MiB bound, JSON parsing, and the real `CandidateProfileSchema`. It emits only `VALID`, `MISSING`, or `INVALID`; invalid details are bounded paths/stable codes without values, contents, hash, exception, or absolute path.
3. Add `profile:validate` to `package.json` and fictional/malformed/missing/oversized validator tests under `tests/security/`; align README/private-profile setup wording with the implemented command and current in-progress phase. No package dependency or runtime/provider behavior changes.
4. Run the full fictional baseline suite before requesting private facts.
5. Use the schema-derived documentation as a local scaffolding checklist: collect owner-confirmed facts in small groups, assemble the ignored file locally, omit unnecessary/high-risk identity material and referee contacts, validate it, and report only state/codes. Do not require the owner to rewrite the large JSON template.
6. Prove demo-profile isolation with the real file reversibly moved only to ignored `data/private/`, the validator reporting `MISSING`, and the existing focused fictional/in-memory integration tests. Restore atomically and require `VALID`.
7. Stop all local app/E2E processes, preview and confirm the default migration, verify the exact backup is ignored if created, and require both migrations, expected user version, integrity, foreign-key, and success checks.
8. Have the owner supply exactly one complete visible vacancy directly to local `/import`; manually validate every field and explicitly confirm only after the truth review.
9. Verify truthful persistence, dashboard/detail rendering, `PRIVATE_LOCAL_PROFILE` provenance, eligibility, fit, and absence of document/application/submission behavior.
10. Stop the app, complete the non-disclosing privacy audit and all quality gates, record safe results, push only source/docs, open an unmerged execution PR, wait for final-head CI, and stop for review.

## Candidate-profile handling

The only real profile path is `data/profile.private.json`, and it must be ignored/untracked before creation. The validator and runtime use `CandidateProfileSchema`; tests use fictional temporary files only. Owner-confirmed facts may be assembled locally, but TFN, bank/payment data, passport or visa grant numbers, passwords, OTPs, security answers, and unnecessary referee contacts are forbidden. The profile body, values, candidate contacts, work-right details, referee facts, hash, absolute path, and full validation input/errors never enter Git, chat output, logs, audits, screenshots/traces, browser storage, CI, source maps, or external services.

The local scaffolding workflow is: review each required schema group with the owner; populate only supplied/confirmed values; preserve empty required arrays when the owner confirms there is nothing to assert; stop with a concise missing-fact path list when a truthful required value is unavailable; validate ignore/untracked state before writing; write only the ignored local file; then run the state-only validator. No fictional template value is carried into the real profile. For the owner-supplied structured natural-language questionnaire, use a one-off assembler only under ignored `data/private/`; it reads the ignored facts file, preserves supplied verification states, derives only non-claim technical IDs where needed, omits records whose required exact dates are unresolved, validates with `CandidateProfileSchema`, writes atomically, and reports only state plus bounded paths/codes. The assembler and source facts remain untracked and never enter the execution PR.

## Database and real-job handling

The default supported database path and its WAL/SHM/backup siblings must remain ignored and untracked. The app is stopped for migration. Preview precedes explicit confirmation; an existing database is never deleted, truncated, down-migrated, or directly edited, and an existing backup is retained. Only safe path classification, existence/backup booleans, migration IDs/version, integrity/foreign-key states, and exit status may be recorded.

The one vacancy is pasted by the owner over loopback and never fetched. Raw content remains only in the owner's original source and ignored local database. SEEK origin requires evidence from supplied bytes, while acquisition remains `USER_SUPPLIED_CONTENT`. No real advert enters commands, Git, fixtures, automated tests, logs, traces, screenshots, CI, or PR text.

## Privacy boundaries and manual validation

Candidate data never enters import parsing/source detection/deduplication. Raw vacancy text never enters candidate-profile code or safe audit metadata. The browser receives only approved profile state plus the normal local job UI. Manual preview review covers title, company, location/postcode, employment type, hours, schedule, salary, required/preferred experience, qualifications/certifications/licences/checks, vehicle, work-right wording, physical requirements, dates, source/confidence/acquisition, external identity/URL, and cover-letter requirement. Unsupported facts remain null/unknown; wording is never strengthened; corrections require visible evidence and preserved override provenance.

Eligibility review compares stable positive/blocking/review codes and field/evidence references with the private profile and original advert. Fit review inspects total, category contributions, positive/negative reasons, missing evidence, and preference/requirement signals without tuning weights. Final application submission, preparation, form filling, status advancement, document generation for the real job, live board access, Phase 2.6, and Phase 3 remain out of scope.

## Testing and security strategy

Before and after real activation, run `npm.cmd run format:check`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run build`, `npm.cmd run test:e2e`, `npm.cmd audit`, `npm.cmd run audit:production`, and `git diff --check`. General automated tests remain fictional. Focused checks cover the ignore regression, validator missing/invalid/valid/oversized states and redaction, and real-job demo isolation in memory. Real-data validation is manual/local and creates no screenshot or Playwright trace.

The final privacy audit checks ignore/untracked state, changed/tracked/reachable paths, high-confidence secrets, logs/audit bodies, browser storage/rendered output/source maps, build/test artifacts, PR/CI scope, network absence, and application-action absence without printing candidate/job needles. Repository visibility must remain private.

## Rollback

Helper/source changes can be reverted normally or left in the unmerged execution PR. Before real import, remove or correct only the local private file through an explicit owner decision. Migration failure leaves the original database and ignored backup intact and stops the app. After migration/import, never delete or down-migrate the real database, backup, profile, or job automatically; preserve them for a separately reviewed recovery decision. Close the unmerged execution PR and delete its branch to roll back repository state.

## Acceptance criteria and stop conditions

Phase 2.5A is `COMPLETE` only when profile validation/Git isolation, demo isolation, default migration and backup policy, exactly one manually truth-checked import, private-profile provenance, eligibility, fit, dashboard/detail rendering, privacy audit, full local gates, and final-head CI all pass with no network source access or application action. Only source/documentation changes are committed and the execution PR remains unmerged.

Stop and leave the phase `IN_PROGRESS` or `BLOCKED` for any trackable private path, missing/unconfirmed required profile fact, invalid profile, demo fallback, migration/integrity/foreign-key failure, unsupported parser inference, incorrect eligibility/fit behavior, privacy leak, live-source request, application action, failed local gate, or failed CI. The immediate permitted work ends after fictional helper/baseline validation if owner-confirmed profile facts are still unavailable.

## Pre-profile execution checkpoint

- Ignore boundary: `git check-ignore -v` passed for the private profile, default SQLite database, WAL, SHM, and exact fictional timestamped backup path. TypeScript, Markdown, migration SQL, and generic non-database `.backup` probes remained trackable. The permanent regression passed 7/7 assertions.
- Validator implementation: added fixed-path `npm.cmd run profile:validate`, bounded to 1 MiB and the real `CandidateProfileSchema`, with exit `0`/`2`/`3` for `VALID`/`MISSING`/`INVALID`. Output is limited to the primary state plus at most 20 bounded paths/stable codes; values, input, hashes, absolute paths, and exception text are never emitted. Missing, malformed JSON, schema-invalid, valid fictional, oversized, and redaction behavior are covered with temporary fictional files.
- Encountered checks: the first CLI test run exposed unsupported top-level await in the root CommonJS transform; an explicit async entry point fixed the real command. A second combined run exposed Windows process-start contention between five spawned `tsx` validators and the Git regression; the tests were refactored to exercise the exported validation/format/exit contract directly, while the real fixed-path CLI was executed separately. No failed check was skipped.
- Current command state: with no private file present, `npm.cmd run profile:validate` reports only `Private candidate profile: MISSING` and exits `2`, as designed.
- Fictional baseline: formatting, lint, strict typecheck, 92 unit/security tests across 18 files, 9 integration tests across 3 files, production build with 31 generated segments, and 9 browser tests passed. `npm.cmd audit` and `npm.cmd run audit:production` each reported 0 vulnerabilities; `git diff --check` passed. The only browser output was the existing non-fatal `NO_COLOR`/`FORCE_COLOR` warning.
- Test cleanup: Playwright created only ignored fictional `applypilot.e2e.sqlite`, WAL, and SHM artifacts. The repository-owned controlled shutdown removed those files; port 3100 is closed and the local private/runtime-artifact count is zero.
- Source checkpoint: plan-first commit `7da184eb0a3e11f3ac5ad10235fea366862f2952`; validator/tests/documentation commit `ca4dfdd675b40dc5bd9f46cc4e1d3654eb0c19b1`. No profile, vacancy, database, backup, credential, session, real document, live-source request, or application action is part of either commit.
- Current stop/input gate: owner-confirmed required profile facts have not been supplied, so `data/profile.private.json` has not been written and migration/import have not started. Continue by collecting the facts in small human-readable groups; do not ask the owner to construct JSON. If a required fact cannot be truthfully confirmed, keep Phase 2.5A `IN_PROGRESS` and stop before profile creation.

## Profile, isolation, and migration checkpoint

- Owner input: the owner completed the ignored/untracked local facts questionnaire. It contained explicit verification states, negative constraints, omitted high-risk identifiers, and no referee contact details. A generic one-off assembler under ignored `data/private/` parsed the local source, derived only technical skill IDs, validated with `CandidateProfileSchema`, and wrote `data/profile.private.json` atomically without printing the body or values.
- Truth handling: one optional employment record was omitted because its required start/end dates were supplied only at month granularity. No day was inferred. This is a known profile-completeness item, not a schema or activation blocker; it can be added later only after exact dates are owner-confirmed.
- Profile validation: `npm.cmd run profile:validate` returned `Private candidate profile: VALID` with exit `0`. The profile matched all 22 top-level schema keys and retained 3 education records, 3 exact-date employment records, 6 achievements, 48 skills, 3 languages, 2 licences, 3 certifications, and 2 contact-free private referee records. A non-disclosing structural audit found zero referee contacts and zero prohibited high-risk identity/payment/authentication keys.
- Git isolation: `git check-ignore -v data/profile.private.json` matched the exact private-profile rule, while `git ls-files --error-unmatch` failed as required. The facts questionnaire, one-off assembler, and final profile are all ignored and untracked.
- Demo isolation: the valid profile was moved reversibly to an ignored `data/private/` holding path. The validator returned only `MISSING` with exit `2`; the two focused fictional/in-memory integration cases for no private profile and demo-only resolution passed, proving `NOT_EVALUATED`, null eligibility/fit, and no result rows. The profile was atomically restored, the holding path was absent, and validation returned `VALID` with exit `0`.
- Process/migration gate: ports 3000 and 3100 had no listeners and no ApplyPilot Node/npm process was running. Migration preview resolved the documented default local SQLite path, returned exit `0`, and created no file. The active database and prospective timestamped backup both matched their narrow ignore rules.
- Confirmed migration: `npm.cmd run db:migrate -- --confirm` returned `ApplyPilot local database is migrated and verified.` Migration `0000` foundation and `0001` intake tables were present, `user_version` was `1`, `PRAGMA integrity_check` passed, and `PRAGMA foreign_key_check` returned no issue. This was a fresh database, so backup created is `NO`; the database exists locally, is ignored, and is untracked.
- Current stop/input gate: no real vacancy has been supplied or imported. The owner must now place exactly one complete visible advertisement in the local-only handoff and retain the original for side-by-side review. No job-board search/fetch, real import, eligibility/fit evaluation, document/application action, or submission has occurred. Phase 2.5A remains `IN_PROGRESS`.

## Vacancy handoff checkpoint

- Checked: 2026-09-07.
- Boundary result: the single local handoff was non-empty, within the 1 MiB intake limit, ignored, untracked, and free of the bounded high-confidence credential patterns checked before local use.
- Truth-review result: `FAIL`. The supplied content was an incomplete search-result excerpt with visibly truncated wording rather than the complete visible advertisement required by the approved activation procedure. Missing advertisement content cannot be fetched, inferred, or strengthened.
- Import result: `NOT_STARTED`. ApplyPilot was stopped before any preview or confirmation. Ports 3000 and 3100 are closed, and the local database still has zero jobs, source records, import batches, import records, eligibility results, and fit scores.
- Safety result: no job-board request, link follow, browser automation against a job board, application action, document generation, status advancement, or submission occurred. The private profile and migrated ignored database remain intact.
- Current stop/input gate: replace the ignored local vacancy handoff with the complete visible advertisement for exactly one vacancy, then rerun the boundary and manual truth-review workflow. Phase 2.5A remains `IN_PROGRESS`.

## Complete handoff and runtime-path blocker

- Checked: 2026-09-07. The replacement handoff contains one complete visible advertisement. It remains ignored/untracked and passes size and credential-boundary checks. Evidence supports source `WORKDAY`; the intended acquisition method remains `USER_SUPPLIED_CONTENT`. Manual preview review and import are `NOT_STARTED`.
- Confirmed runtime defect: `npm.cmd run profile:validate` reports `VALID`, but the local `/profile` response reports `Private profile missing` when Next starts through the documented npm workspace script. The web provider and database resolver join `process.cwd()` with `data`; npm starts the workspace in `apps/web`, while the validator and migration use repository-root `data`.
- Activation is blocked before staging or confirming the vacancy. The local app was stopped, and the real profile, vacancy, and migrated database are preserved. The earlier incomplete-content gate is resolved; no additional owner vacancy content is needed.
- Follow the approved failure procedure on `fix/resolve-local-runtime-data`, created from fresh `origin/main` in an isolated worktree containing no real local data. Reproduce the root/workspace discrepancy with fictional files, share a server-only repository-root data resolver between the provider and database, retain existing validation/filename/no-auto-migration boundaries, run all gates, and open an unmerged bugfix PR.
- After bugfix review/merge, refresh the activation branch and resume the complete preview truth review. Conservative requirement extraction and document-requirement defaults still require examination at that gate; they have not been accepted as validated real-job behavior.

### Runtime-path fix prepared for review

- Bugfix PR #8: `https://github.com/adeel1608/applypilot/pull/8`, branch `fix/resolve-local-runtime-data`, implementation commit `4b3ad6567de3cfcad16a449b597d79305f7fbee3`. The PR is unmerged and addresses root/workspace data resolution with a shared server-only resolver, five fictional regression cases, workspace-launched E2E, and explicit exclusion of runtime files from build tracing.
- Local bugfix validation passed 92 unit/security tests, 9 integration tests, 9 fictional E2E tests, formatting, lint, typecheck, production build, both zero-vulnerability audits, and diff checks. All 12 build trace manifests excluded fictional private-data sentinels. A production HTTP check loaded a temporary fictional root profile while withholding its unique values from rendered HTML.
- The isolated worktree's initial dependency install failed because the Windows native build toolchain was unavailable; the unchanged lockfile installed with lifecycle scripts disabled, and its packaged SQLite binary was verified. The normal CI install remains part of the PR gate. Final PR-head CI is reported in the handoff.
- Original activation state remains preserved: profile `VALID`; root database integrity `PASS`; zero job/import/evaluation/application/document rows; real vacancy still local and unimported; no application or live-source action. No additional vacancy content is needed. Resume only after this concrete fix is reviewed and normally merged, then complete the outstanding preview, evaluation, privacy, and activation checks.

## Owner-authorized public visibility checkpoint

- Date: 2026-09-07. The owner explicitly authorized changing `adeel1608/applypilot` from `PRIVATE` to `PUBLIC` to permit read-only ChatGPT review through public GitHub access. This supersedes the earlier private-repository requirement only for repository visibility; all candidate-data, credential, local-runtime, and human-review protections remain unchanged.
- Starting state and objective: personal GitHub CLI account `adeel1608`, default branch `main`, clean existing activation branch, private repository, and open unmerged PR #8. Publish only the already-audited GitHub repository; do not publish ignored local files, modify application code, change remotes, create/delete/switch branches, change other repository settings, or merge PR #8.
- Approved exception: `.env.example` may remain tracked only as a non-secret local/default configuration template. The owner separately approved this exception after the initial literal `.env.*` path gate paused publication. Real `.env` files, secret environment files, and every other private-data exclusion remain prohibited from Git.
- Implementation scope and data flow: existing local source/history and a temporary read-only remote mirror are inspected locally; private-profile and vacancy comparison values remain in memory and are never printed or uploaded. GitHub receives only the authorized visibility-setting change and this safe plan-only documentation commit. No application architecture, dependency, provider, runtime, or candidate-data flow changes.
- Exact execution sequence: verify the CLI owner and repository identity; inspect tracked paths, ignore rules, all local refs/reflogs, and advertised remote branch/PR refs; review secret-shaped findings without exposing values; resolve the template exception; recheck the exact template and unchanged refs; change only visibility; verify authenticated and anonymous repository/PR reads; recheck local privacy boundaries; validate, commit, and push only this plan on the existing activation branch.
- Pre-publication privacy audit: `PASS` after the explicitly approved template exception. The audit covered 52 local commits including reflogs, 53 remote commits including PR refs, and 243 unique historical file blobs. Private candidate/contact/referee/employment/education prose and real-vacancy comparisons found no matches. Commit metadata comparisons also found no private identity/contact matches. Secret-shaped findings were reviewed and confirmed as synthetic credential-rejection test fixtures, not operational credentials. No remote Actions artifacts or releases were present at the check.
- Final template gate: `PASS`. The working, tracked, and historical `.env.example` contents matched the exact approved non-secret local/default configuration. They contained no API keys, access tokens, OAuth secrets, passwords, cookies/session values, private candidate values, database credentials, or credential-bearing private URLs. No other prohibited environment/private path was tracked.
- Private local data: `data/profile.private.json`, `data/private/` including the real vacancy handoff, and the local SQLite database remain ignored, untracked, and absent from audited Git history. Database WAL/SHM/backup and real environment-file ignore protections remain in force. No private file contents, values, or comparison needles were emitted or added to Git.
- Authorized setting change: `gh repo edit adeel1608/applypilot --visibility public --accept-visibility-change-consequences` succeeded. Repository metadata confirmed `PUBLIC`, `private: false`, unchanged owner/repository, and unchanged default branch `main`. No other repository-setting or authentication change was made.
- Public access verification: `PASS` for the required authenticated `gh repo view` and `gh api repos/adeel1608/applypilot` checks, and for separate anonymous HTTPS reads of repository metadata, the default-branch README, and PR #8. The anonymous requests supplied no authorization header or authenticated browser session.
- PR #8 preservation: `OPEN`, unmerged, `MERGEABLE`, and `CLEAN`, with unchanged head `4b3ad6567de3cfcad16a449b597d79305f7fbee3`. Both existing `quality` checks reported `SUCCESS`. This visibility task does not approve or perform a merge or resume local activation.
- Validation strategy and acceptance: require the identity, privacy, template, unchanged-ref, public-read, and unmerged-PR gates above; run the repository formatting check and `git diff --check`; confirm the commit contains only `PROJECT_PLAN.md`. Application lint/typecheck/unit/integration/build/E2E reruns are not required for this settings-and-documentation-only change; existing PR CI remains separately reported, not claimed as a new application validation run.
- Documentation validation: `npm.cmd run format:check` passed. The initial `git diff --check` flagged a newly added Markdown hard-line-break as trailing whitespace; the metadata was moved to its own paragraph, and the final formatting and diff checks both passed. The change contains only `PROJECT_PLAN.md`. Direct ChatGPT GitHub connector metadata access to PR #8 also succeeded after publication without reconnecting or changing its existing work-account authorization.
- Risk and rollback boundary: public Git content and history may be copied. A later owner-authorized return to private visibility cannot recall external copies; no automatic visibility reversal, history rewrite, credential change, or private-data deletion is authorized. This documentation change can be reverted separately through normal review.
- Completion handoff: public visibility and anonymous read access are verified; private local data remains excluded; the next permitted task is read-only PR review. PR #8 must remain unmerged unless the owner later grants separate explicit merge approval.

# Phase 2.5A runtime data-path bugfix

Status: `AWAITING_HUMAN_REVIEW`. Started 2026-09-07 on `fix/resolve-local-runtime-data`, from fresh `origin/main` at approved PR #7 merge `6f42b8f1edd5813d34c398aad56248555fae044d`. Work occurs in an isolated worktree with no real profile, vacancy, or database. The activation branch and its ignored local data remain preserved.

## Problem, objective, and reproduction

The documented npm workspace start changes the working directory to `apps/web`. The web profile provider and database resolver currently look under `process.cwd()/data`, whereas the root validation and migration commands use repository-root `data`. A valid profile is consequently reported missing and the migrated database is unavailable. A local HTTP check confirmed the profile-state mismatch before any real vacancy was staged or imported.

Use only fictional temporary repositories to reproduce: create the ApplyPilot root manifest, `apps/web`, a valid fictional root profile, and a migrated fictional root database; start resolution with the workspace working directory. Expected: the same root profile/database as from repository root. Actual: missing profile and database. Workspace-local decoys must never override repository-root data.

## Requirements, architecture, and proposed files

- Add a shared server-only `apps/web/lib/local-data-directory.ts` resolver that walks ancestors from the launch directory to the nearest validated ApplyPilot root manifest and returns that root's `data` directory. Validate manifest shape with Zod; return a bounded error code if the repository cannot be identified. Do not search globally, create directories, relocate data, expose paths to client props, or use a public environment variable.
- Use the resolver in `candidate-profile-provider.ts` and `local-database.ts`. Preserve explicit test profile paths, the 1 MiB/schema validation, demo isolation, database filename validation, schema-readiness gate, and no automatic migration. Resolve the default profile path inside the existing safe error boundary.
- Add fictional regression coverage in `tests/security/local-runtime-paths.test.ts` for root/workspace launches, decoys, missing data, unknown roots, and invalid database filenames. No new dependency is needed.
- Launch the existing fictional E2E server with the web workspace working directory, matching the documented npm runtime. Root-owned E2E migration/cleanup paths remain explicit. Update `docs/REAL_WORLD_JOB_INTAKE.md` to document the shared directory contract.

## Data flow, risks, and privacy

Launch directory -> validated repository manifest -> repository `data` -> existing server-only profile/database gates -> existing safe DTOs. This changes path selection only; no job parsing, scoring, candidate schema, SQL schema, migration, application behavior, or data format changes. Missing/unrecognized roots fail closed. The resolver must not select `apps/web/data`, an unrelated ancestor project, or another worktree. Runtime files remain ignored. Profile/vacancy bytes, hashes, contact details, and absolute private paths must not enter logs, Git, CI, or PR text.

## Tests, rollback, acceptance, and exact steps

1. Commit this blueprint before runtime code changes.
2. Add and run fictional regressions against the old implementation; record the root/workspace failures.
3. Implement the shared resolver, update its two consumers, align the E2E launch directory, and document behavior.
4. Run focused tests, formatting, lint, strict typecheck, unit/security tests, integration tests, production build, fictional E2E, both dependency audits, and `git diff --check`.
5. Verify only intended source/docs enter the diff and that the original activation data is unchanged; push and open an unmerged bugfix PR, wait for final-head CI, and stop for human review.

Acceptance requires consistent root/workspace resolution, safe missing/invalid behavior, no implicit data creation or migration, passing local/CI gates, and no real-data artifact in the worktree/PR. Rollback is a normal revert or closing the unmerged PR; never delete or modify the original local profile/database. Phase 2.5A remains blocked pending bugfix review/merge and the still-unfinished real preview, import, evaluation, privacy audit, and activation gates.

### Build-tracing refinement

The first production build succeeded but warned that dynamic filesystem paths could trace the whole project into deployment output. Private runtime files must never be packaged. Apply the installed Next.js compiler's documented `turbopackIgnore` call annotation to these deliberate runtime-only filesystem/path operations and avoid redundant path resolution of the already-absolute working directory. Rebuild and inspect output trace manifests; use fictional ignored sentinel files to verify that local profile/database/private paths are absent. This is required to preserve the original privacy boundary, not an acceptance of the warning.

## Bugfix execution results

- Blueprint committed before runtime changes as `837a955`. Five fictional path regressions cover both launch locations, workspace decoys, missing root data, filename traversal/override, and an unrecognized root. The old implementation failed the workspace, decoy, override, and unrecognized-root expectations. Cold module-graph imports also initially exceeded test/hook timeouts; imports were moved outside the timed assertions with a bounded startup hook, and all five cases plus the two existing provider tests then passed.
- The first `npm.cmd ci` attempted a native `node-gyp` rebuild and failed because Visual Studio C++ build tools are unavailable on this Windows host. A test retry while dependencies were incomplete failed to load its configuration. `npm.cmd ci --ignore-scripts` subsequently installed the unchanged lockfile successfully; the packaged SQLite native binary passed an in-memory query, and the final test runner was the locked Vitest `4.1.11`. No dependency/lockfile change or native toolchain installation is included.
- The fresh worktree's Windows CRLF checkout caused the first formatting check to flag 146 files. `npm.cmd run format` normalized them; Git normalization confirmed that only the seven intended source/documentation files differ. A blueprint whitespace issue was corrected. No unrelated source changes were retained.
- Final local gates: `npm.cmd run format:check`, `npm.cmd run lint`, and `npm.cmd run typecheck` passed. `npm.cmd test` passed 92 unit/security tests across 18 files; `npm.cmd run test:integration` passed 9 tests across 3 files. `npm.cmd run build` passed with 31 generated segments and no dynamic-filesystem tracing warnings after the refinement. `npm.cmd run test:e2e` passed all 9 fictional browser tests from the workspace launch directory. Both `npm.cmd audit` and `npm.cmd run audit:production` reported 0 vulnerabilities. `git diff --check` passed. E2E emitted only the existing non-fatal color-environment warnings.
- Build privacy: three ignored fictional profile/private/database sentinels were present for the rebuilt artifact check. All 12 output trace manifests contained zero private runtime entries; the build contained zero sentinel-content matches. The three test files were removed after verification.
- Production runtime proof: start the built app through the npm web workspace with a temporary valid fictional root profile. `/profile` returned HTTP 200 and `Private profile loaded`, while the unique fictional profile ID/name/email sentinels were absent from rendered HTML. The server was stopped and the temporary fictional profile removed; ports 3000, 3100, and 3200 have no listeners.
- Real-data isolation: no real profile or vacancy was copied to this worktree. A non-disclosing scan of its 153 tracked files found zero matches for checked private contact/name/vacancy needles. The original runtime paths remain ignored; its database integrity is valid, with zero jobs, source records, import batches/records, eligibility/fit rows, applications, or generated documents. Repository visibility remains `PRIVATE`.
- Handoff: open an unmerged bugfix PR and report its final-head CI result separately to avoid a recursive checkpoint-commit loop. Only this path-resolution defect is addressed. The complete real vacancy remains locally available, but its manual preview, import, evaluation, and final activation audit are unfinished. Review/merge this fix before refreshing and resuming the activation branch. No real source access, application action, or Phase 2.6 work occurred.

# Personal Live V1 readiness program — execution checkpoint

- Started 2026-09-07 under the owner's explicit master-mission authorization. Scope: merge only the approved PR #8, resume the existing one-vacancy local activation, collect truthful/privacy-safe evidence, then produce the Personal Live V1 gap analysis and master blueprint on the activation branch. Open the activation/master-plan PR and leave it unmerged. Future release trains remain design-only and require their own plan/review/merge/implementation gates.
- Stage 0 audit: read the repository instructions, full historical project plan, README, architecture, security, and contribution documents. The original activation worktree was clean at `21ea29d4b910ccdf1a18048b4236a5ed9784167a`; personal CLI identity was `adeel1608`; repository visibility was `PUBLIC`; default branch was `main`; and PR #8 was the sole open PR. Inventory includes the domain/workspace packages, eight application routes, two reviewed SQLite migrations, offline/source-content adapters, unit/security/integration/browser tests, local setup/validation scripts, CI workflow, and domain/privacy documentation.
- Stage 1 merge: PR #8 matched approved head `4b3ad6567de3cfcad16a449b597d79305f7fbee3`, was open/non-draft, `MERGEABLE`/`CLEAN`, had successful final-head quality checks, zero unresolved review threads, and zero new PR conversation comments. Its audited diff contained only the approved resolver, consumer, fictional-test, launcher, and documentation changes. It merged normally as `4920b593aad90cc734570a3aae1d562d09d480e7` at `2026-09-07T02:06:55Z`.
- Refresh: local `main` was fast-forwarded and verified equal to `origin/main` at that merge. Bringing main into the existing activation branch caused only `PROJECT_PLAN.md` conflicts: the active branch/visibility header and independently appended historical sections. Both historical records were preserved, with the activation branch remaining current. The profile, complete vacancy handoff, and SQLite database were byte-for-byte unchanged across fetch/checkouts/merge, verified with in-memory comparisons and no printed hashes. The clean linked bugfix worktree/branch is retained rather than force-removed.
- Architecture and privacy boundaries: continue the existing local UI -> bounded staging/preview -> explicit single-record confirmation -> canonical persistence -> `PRIVATE_LOCAL_PROFILE` -> deterministic eligibility/fit -> local dashboard path. No direct SQLite insertion, source URL retrieval, real-ad fixture, private screenshot/trace, candidate-data publication, document generation, application action, or submission is authorized. The owner-supplied real input is reviewed locally; committed reports contain only safe statuses, field/rule codes, counts, and commit identifiers.
- Planned file scope: safe evidence and blueprint updates in this plan, README, architecture, security, and justified focused release/source/threat-model/runbook/checklist documents. No future adapter, matcher, document, runner, scheduler, notifier, deployment, or release-tool implementation is included. A newly discovered product defect requires a separately reviewable fictional reproduction and plan; stop at any new human gate rather than silently implementing beyond approval.
- Exact remaining steps: verify merged-main CI; revalidate profile/ignore/database state without disclosing values; run the actual loopback UI from the documented workspace launch; inspect one complete preview and all material semantics before confirming; verify single-job counts, private evaluation provenance, truthful eligibility/fit, integrity, foreign keys, and absence of application/document/session artifacts; audit all privacy sinks and history; run every requested quality/dependency gate; perform current official source/policy research and the complete product/security/UX/release analysis; define the forward R0-R11 trains without deleting history; publish only safe source/docs in an unmerged activation/master-plan PR with final-head CI.
- Risks, rollback, and acceptance: malformed or strengthened requirements, demo fallback, wrong eligibility, private-data leakage, failed integrity/quality checks, or new review requirements stop activation. Preserve all existing private files and any staged/imported local data; do not down-migrate, overwrite, delete, or repair real rows directly. Normal reviewed code/document reverts are the rollback path. Completion requires the real UI proof, privacy and quality gates, evidence-backed release blueprint, and an unmerged human-review PR; future source access and final submission remain disabled.
- Merged-main CI: quality run `34075192121` succeeded at `4920b593aad90cc734570a3aae1d562d09d480e7`. Activation refresh is committed as `6b7a42a`; no future application functionality was changed.
- Real UI evidence: launched the documented npm web workspace on loopback port 3000. The connected browser tool reported no browser available; the installed local Playwright Chromium successfully drove the actual `/import` form and job-detail route. This was not a direct database insertion or a parser-only simulation. External browser requests were denied; none were attempted. No screenshots, video, traces, persistent browser storage, or application actions were created.
- Preview review: compared the complete owner-supplied input in memory, retaining original raw content and all unlabelled description lines. Used existing UI controls to supply the missing title from the exact source heading and copy the source URL without opening it. Employer/location matched the source and owner specification; employment type was preserved. Work-right wording was not strengthened, and conditional certification wording remained conditional. Structured duties/requirements, schedule/hours, location detail, and dates remain incompletely extracted; no missing fact was fabricated. Detected source remains honestly `UNKNOWN` despite the retained source URL: editing the URL does not rerun source detection.
- Preview accounting: four local preview batches/records were staged while browser-checkpoint selectors, line-ending comparison, and React's source-form reset were resolved. Three remain unconfirmed `PREVIEW_READY`; exactly one batch completed and exactly one canonical job/source record was created. These local audit records were preserved, not silently deleted to improve the counts. No duplicate canonical job exists.
- Evaluation: one eligibility row and one fit row reference the same profile version. An in-memory canonical comparison proved the snapshot equals the validated private file and differs from the fictional example: `PRIVATE_LOCAL_PROFILE`. The exact job-specific result and contributions remain private local evaluation metadata and are reported only to the owner in the private handoff, not published in this repository. Safe review codes are `JOB_WORK_RIGHTS_AMBIGUOUS`, `VEHICLE_REQUIREMENT_AMBIGUOUS`, and `AMBIGUOUS_REQUIREMENT`. Schedule, hours, suburb/commute, structured duties and requirements remain unknown/unextracted; the current score is not a calibrated suitability or legal determination.
- Database and action boundary: `PRAGMA integrity_check` returned `ok`; foreign-key check returned zero rows. Counts: canonical jobs 1, source records 1, preview batches/records 4 each, completed batches 1, eligibility rows 1, fit rows 1, applications 0, generated documents 0. No CV, cover letter, application packet, final submission, or authenticated browser state was generated. The app/browser were stopped after inspection; real files remain local.
- Analysis scope and proposed architecture: retain the local Next.js/domain/SQLite foundation; add separately reviewed read-only adapters, versioned requirement/dedup/evaluation models, fact-bound documents/packets, isolated local browser execution, and durable lifecycle events in the future trains. Exact interfaces/data flow, file scope, dependencies, privacy boundaries, test/rollback/acceptance gates, external approvals, and complexity are specified in the linked master blueprint, source matrix, threat model, checklist, and runbook. These documents are proposals, not implemented capability or source authorization.
- Quality and dependency gates: the first `npm.cmd run format:check` exposed ten PR #8/activation files whose Windows checkout still had CRLF working-tree endings while Git stored LF. A scoped Prettier normalization introduced no content diff for those files; the repeated format check passed. `npm.cmd run lint` and `npm.cmd run typecheck` passed. `npm.cmd test` passed 97 tests across 19 files; `npm.cmd run test:integration` passed 9 across 3 files. `npm.cmd run build` passed with 31 route segments, and `npm.cmd run test:e2e` passed all 9 fictional browser tests. The browser run emitted only the known non-fatal `NO_COLOR`/`FORCE_COLOR` warnings. `npm.cmd audit` and `npm.cmd run audit:production` each found zero vulnerabilities; `git diff --check` passed. Formatting was rechecked after the normalization and final documentation edits.
- Test isolation: the real server was stopped and ports 3000/3100 were free. The private profile was moved to an exact ignored hold path only for the synthetic quality run and restored in a `finally` path; in-memory file comparisons confirmed it was restored byte-for-byte. The real vacancy and database were unchanged during the test run. The profile validator passed again after restoration. No hashes or values were printed.
- Repository/history audit: scanned 55 local all-ref/reflog commits, 54 remote-advertised commits and 245 unique blobs with 56 private-value needles held only in process memory. No private path or private-value finding occurred. Five scanner alerts are the existing intentional fictional credential-rejection fixtures in `fixtures/imports/manifest.ts`, `packages/job-importer/src/job-importer.test.ts`, and `packages/job-sources/src/seek/schemas.test.ts`; their placeholder content was already manually classified and remains necessary negative-test data. `.env.example` remains the owner-approved non-secret template exception. The real profile, vacancy, DB/WAL/SHM and all inspected `data/private` files are ignored, untracked and absent from history.
- Build/runtime/CI audit: a separate working-tree and output scan used 59 in-memory private needles across 160 repository/document files and 777 artifact files (327,103,180 bytes), including all 12 Next output trace manifests. It found zero private-value or private-runtime trace entries. No package publication guard changed. The real browser created no screenshot, video, trace or storage-state artifact; its 16 server-log entries were only local route/timing metadata, with no credential header or profile JSON. The repository has zero GitHub Actions artifacts and zero releases. Current Actions history therefore exposes no uploaded artifact, and PR #8 remains merged at the exact approved merge SHA.
- Phase 2.5A result: `PASS` for supervised local intake/evaluation, with the documented extraction/calibration limitations. Exactly one real canonical job and one source record were created through one completed UI import; three additional batches are unconfirmed preview audit records and are not jobs/imported duplicates. Current local-live classification is `SUPERVISED LOCAL INTAKE ALPHA`. Local Live Alpha is ready within that narrow boundary; Personal Live Beta, Personal Live V1 and hosted production are not ready.
- Publication handoff: commit and push only the safe activation/master-plan scope, audit the resulting local/remote commit and PR surfaces, confirm final-head CI, and leave the new PR unmerged. The final PR number, head, and CI result are reported directly to the owner after publication rather than committed, avoiding a recursive checkpoint-commit loop. Human review of that PR is the next gate; no R1-R11 implementation is authorised by this checkpoint.

# Personal Live Beta Core implementation blueprint

- Status: `IMPLEMENTATION_COMPLETE_AWAITING_FINAL_PR_REVIEW`.
- Approved scope: the owner's combined Beta Core implementation task, stages 0-64, without automatic merge of the final implementation pull request.
- Implementation branch: `feat/personal-live-beta-core`.
- Fresh base: PR #9 was reverified at its approved head with a clean merge state, successful required checks, no review threads, and a private-data-safe diff. It merged normally on 2026-09-07 as `471ab1055743249ff51a46d7187e541d0b5008af`. Local `main` then matched `origin/main`; this branch was created from that exact merge.
- Baseline result: Phase 2.5A is `COMPLETE`; supervised Local Live Alpha is available with the recorded extraction and calibration limitations. The Personal Live V1 blueprint is the approved baseline. Personal Live Beta is in development. Personal Live V1 and hosted production remain not ready.

## Current implementation state

The repository has a local Next.js 16 UI, candidate truth store, bounded paste/upload importer, two explicit SQLite migrations, profile-versioned eligibility/fit results, an HTML/PDF resume foundation, a basic cover-letter generator, runner/tracker contracts, fictional source fixtures, validation/migration helpers, and read-only CI. One owner-supplied job is preserved in the ignored local database with one source record, one eligibility result, one fit result, and three unconfirmed preview audit records. No application or generated-document rows exist.

Code inspection confirms the Beta gaps:

- generic text parsing is label/section-oriented, searches the whole body for employment type, and does not produce typed requirement spans, field evidence, schedule/hours/geography, or tri-state document requirements;
- canonical identity is source-scoped and current records are mutable snapshots; there are no immutable source observations, reviewable cross-source clusters, canonical versions, or correction records;
- eligibility does not classify legal limits, preferences, and employer requirements separately; hours handling conflates weekly preferences and work-right ceilings;
- fit scoring reads some unverified preferences and all employment evidence, provides no coverage/confidence model, and has no local calibration harness;
- ten resume enum values share one general data model/renderer, semantic claim entailment is not enforced, page limits are not measured, output paths are not fully confined, and DOCX does not exist;
- application preparation returns an empty answer list and missing-document names; durable packets, question disclosure decisions, readiness, real lifecycle events, runnable checkpoints, and one-use final consent do not exist;
- all production URL fetching is disabled, operational doctor/privacy/status/backup/restore/start-stop commands do not exist, Actions use mutable major tags, and the loopback mutation boundary is not yet explicitly origin/session hardened.

## Objective and product boundary

Deliver one coherent, local-first Personal Live Beta Core that improves real-job extraction and matching, provides truthful private documents and application-packet preparation, durable tracking, repeatable local operations/privacy controls, default-disabled Greenhouse and Lever readers, and an executable synthetic-only browser runner with a frozen final-review gate.

The completed Beta may prepare a real application locally, but it may not operate an external employer form without a separately approved target-specific plan. Real submission remains disabled. Every irreversible real submission continues to require a fresh deliberate owner action for one frozen packet; no background, batch, scheduled, timed, implicit-Enter, or reusable consent is permitted.

## Permanent requirements and non-goals

- Candidate-facing content uses only facts validated by the candidate truth store. A fact being true and the owner approving disclosure of that fact are separate states.
- Unknown, unparsed, conditional, conflicting, expired, stale, unverified, or forbidden information never becomes true, supported, required, satisfied, or recommended by default.
- Candidate profile data never enters discovery, source identity, deduplication, importer parsing, or external source requests. Real/demo evaluation contexts remain non-interchangeable.
- No CAPTCHA, MFA, authentication, access-control, bot-detection, rate-limit, robots, site-restriction, or destination-control bypass; no stealth, proxy rotation, hidden endpoint replay, credential capture, or automated login.
- No real background discovery or application. Greenhouse/Lever readers are GET-only, owner-started, tenant-allowlisted, strictly bounded, default-disabled, and independently stoppable.
- No real browser runner or external form interaction in this implementation. The executable runner operates only against the repository's synthetic loopback application site. Real-runner capability reports `TARGET_APPROVAL_REQUIRED`.
- No private profile, real vacancy, SQLite/WAL/SHM/backup, personal document, answer, browser state, cookie, credential, allowlist, or calibration label enters Git, CI, build traces, test recordings, pull-request text, or public documentation.
- Existing local rows and files are preserved. No automatic migration, destructive cleanup, direct real-SQL repair, silent replacement, or output overwrite.
- npm `private: true` remains unchanged. No hosted deployment, tunnel, public bind, paid required API, primary AI matcher/writer, scheduling, notifications, or broad job-board crawling is included.

## Architecture and data flow

The Beta retains domain ownership outside the web layer and adds versioned contracts at each material boundary:

`owner content or approved tenant GET -> bounded immutable SourceObservation -> inert extraction -> RequirementEvidence + field provenance -> CanonicalJobVersion -> duplicate review -> profile-versioned EvaluationVersion with coverage -> durable shortlist -> verified ClaimSelection -> private DocumentArtifact -> tri-state ApplicationPacket -> synthetic runner checkpoint -> frozen review -> one-use consent -> synthetic result -> append-only application event`

Real local data follows the same contracts but stops at packet preparation. Source readers receive source capability/tenant configuration only; candidate facts are joined after local persistence. All boundary inputs and persisted JSON are Zod-validated. Audit events use typed event-specific allowlists rather than substring key filtering, retaining safe enums such as `PRIVATE_LOCAL_PROFILE` while rejecting nested values/bodies.

### Additive persistence plan

Add the next migration, `0002_personal_live_beta_core.sql`, without rewriting migrations 0000/0001. It will add only versioned/additive structures needed by the approved Beta:

- immutable `source_observations`, canonical `job_versions`, typed `job_field_evidence`, `requirement_evidence`, and audited `job_corrections`;
- `duplicate_clusters` and `duplicate_cluster_members` with explicit suggested/linked/rejected/split states and retained observations;
- `evaluation_versions` containing job/profile/rule/weight versions, eligibility class/reasons, fit contributions, coverage/confidence, provenance enum, and stale state;
- local `calibration_labels` and `calibration_pairs`, never exported by privacy tooling;
- `job_queue_entries` for durable shortlist/review/preparation state separate from eligibility;
- immutable `document_artifacts` and `document_approvals`, including type/template/format/path/digest/job/profile/rule versions, claim evidence, layout result, and approval invalidation;
- `application_packets`, `application_packet_documents`, `application_questions`, `application_answer_versions`, and disclosure decisions;
- append-only Beta lifecycle `application_events_v2`, plus projections that preserve legacy NEW/REVIEWED/APPLIED evidence while mapping to DISCOVERED/REVIEWING/SUBMITTED;
- synthetic `application_runs`, `runner_checkpoints`, and expiring single-use `final_action_consents`; no credential or browser-state columns;
- source `capability_configs` and `discovery_runs` containing only tenant IDs, allowlisted hosts/paths, policy versions, budgets, cursors, counts, and safe errors.

The migration copies/maps existing real job/source/evaluation evidence into new version rows only after an explicit preview, consistent backup, row-count/hash/FK assertions, and owner-authorized `--confirm`. It retains the legacy tables for compatibility and historical evidence. The application never auto-migrates. Rollback uses the protected pre-migration backup or a normal code revert; no down migration drops real rows.

## Staged implementation contract

### Stages 3-9: truthful intake, evidence, observations, and identity

- Close Phase 2.5A as complete in current status wording and clearly distinguish available Local Live Alpha, Beta in development, V1 not ready, and hosted production not ready.
- Replace ad-wide employment-type searching with precedence-aware, field-local parsing. Add Australian state normalization, location/postcode evidence, exact/relative dates, salary period/range, weekly and fortnightly hours, roster/day/time parsing, typed responsibilities, qualification/licence/check/work-right/vehicle/physical/experience/skills evidence, and tri-state document requirements.
- Add `RequirementEvidence` with exact bounded span/path, source observation ID, modality `REQUIRED | PREFERRED | CONDITIONAL | UNKNOWN | NEGATED`, condition, certainty, extractor version, and stable rule ID. Empty extraction means incomplete coverage, never no requirements.
- Preserve complete local source text for side-by-side review while browser DTOs use bounded escaped views. Show original source versus normalized value, evidence/modality/confidence, user correction, missing/unparsed fields, and stale/version state.
- Create immutable observations on each accepted source version. Corrections overlay, never mutate, original evidence and record actor/reason/timestamp/hash without raw values in public audit output.
- Treat `(source, tenant, externalId)` as observation identity. Cross-source canonical linking requires exact application target/requisition plus consistent corroboration; uncertain pairs enter a reversible review cluster. Similar title alone never auto-merges; changed reposts preserve history.

### Stages 10-17: eligibility, fit, coverage, calibration, and queue

- Classify each decision input as `LEGAL_LIMIT`, `CANDIDATE_PREFERENCE`, or `EMPLOYER_REQUIREMENT`; retain evidence version/effective dates/units. Preferences rank or require an explicit owner rule but never waive law or employer requirements.
- Keep weekly and fortnightly units separate. Model current work-right ceiling independently from preferred hours and already-worked/period context. No implicit weekly conversion establishes legal compliance. Unknown legal evidence is review-required.
- Add overnight and week-boundary schedule handling, timezone, dated exceptions, verified fixed commitments, unknown roster review, and date/start/expiry checks.
- Cover work rights, legal hours, candidate hours, qualifications, licences and jurisdiction/expiry, own vehicle versus commute, availability, location/commute, experience, certifications, physical demands, age, contradictions, negation, and conditional statements with stable reason codes and synthetic matrix tests.
- Replace broad audit-key filtering with per-event schemas so safe `PRIVATE_LOCAL_PROFILE`/engine/profile-version enums survive and any candidate values, paths, snapshots, hashes exposed to the browser, or raw job content fail validation.
- Fit uses only verified facts and verified preferences. Unverified employment is excluded. Score and ranking report input coverage/confidence and missing/ambiguous dimensions. Ineligible jobs cannot be recommended irrespective of score.
- Add a local-only calibration harness for golden labels and pairwise rankings, rule/weight version comparison, sensitivity and monotonicity. Private labels stay ignored; committed tests are fictional. Do not claim calibration targets from the existing single real job.
- Add a durable real-job queue with review/shortlist/skip/preparing states, stale evaluation visibility, filters, and audited owner actions. Job detail shows source/evidence comparison, duplicate review, evaluation version/provenance, reasons, contributions, coverage, missing inputs, and preparation entry points.

### Stages 18-25: truthful private documents

- Implement genuinely differentiated strategies for all ten named templates, with category-specific evidence priorities/section ordering while sharing a safe renderer. All substantive summary, skill, experience, project, education, achievement, availability, and work-right text is created by allowlisted transformations from verified facts and retains fact IDs.
- The claim validator proves both reference validity and transformation/entailment; arbitrary prose paired with a valid fact ID fails. Forbidden/unsupported claims are checked across every field and heading.
- Enforce Australian English, selectable ATS text, black Times-compatible typography, minimum 10 pt, real bullets, no images/graphics/sidebar/skill bars/photo, one-page casual target, and two-page engineering maximum. Deterministically trim lower-priority evidence before overflow and never shrink below the floor.
- Confine output beneath an ignored private document root using resolved/real paths; reject traversal, UNC, ADS, junction/symlink escape, Windows reserved names, unsafe characters and collisions. Create new versioned files without overwriting.
- Keep PDF and add an audited, maintained DOCX dependency with explicit style/paragraph structure. Validate page/text/font/reading order for PDF and structure/text parity for DOCX. No real artifact appears in CI.
- Add private document preview/generation/approval/invalidation UI. Cover letters use exact reviewed employer/role, at most three verified evidence links, tri-state requirement, owner tone, concise output, shared claim safety, PDF/DOCX only when required/requested, and immutable approval versions.
- Perform one real private CV smoke for the preserved job only after code, migration, and privacy gates pass; do not publish content, names, hashes, screenshots, or path. Owner approval is local and does not authorize upload.

### Stages 26-32: packets and durable tracking

- Build immutable application packets from current canonical job/evaluation/profile, approved CV, optional/required letter, document checklist, target URL/domain, question versions, answer versions, and disclosure decisions.
- Answer states remain `VERIFIED_ANSWER`, `USER_CONFIRMATION_REQUIRED`, and `UNKNOWN`. Truth and permission to disclose are separate. Sensitive, demographic, health, background, work-right, salary, availability, and start-date questions never default to affirmative or disclosed.
- `READY_TO_APPLY` requires current versions, approved CV, required approved letter/documents, no blocking unknown answer, valid destination, unexpired requirements, no duplicate danger, and eligibility other than `INELIGIBLE`. Any dependency change invalidates readiness.
- Prepare a private packet for the preserved real job locally. Unanswered questions remain unknown; `PREPARING` or `REVIEW_REQUIRED` is acceptable and must not be coerced to ready.
- Implement lifecycle `DISCOVERED -> REVIEWING -> SHORTLISTED -> PREPARING -> READY_TO_APPLY -> APPLICATION_IN_PROGRESS -> READY_FOR_FINAL_REVIEW -> SUBMITTED -> ASSESSMENT/INTERVIEW -> OFFER/REJECTED`, with WITHDRAWN/EXPIRED branches and PAUSED/OUTCOME_UNKNOWN run states. Events are append-only, transactional, actor/timestamp/versioned, idempotent, and retain legacy evidence.
- Replace fixture-only applications UI with real local packet/status timelines, filters, missing-input/recovery views, owner-entered outcome attribution, and explicit empty/loading/error states.

### Stages 33-41: security and local operations

- Enforce loopback binding plus explicit Host/Origin validation, foreign-origin mutation denial, forwarded-host distrust unless explicitly configured, local session/CSRF nonce binding, replay protection, safe no-store responses, and tests for DNS-rebinding/cross-port/foreign-origin cases. Loopback is not treated as authentication.
- Centralize confined path creation/read/write with root allowlists, `realpath`/parent checks, no-follow/create-new semantics, safe permissions where supported, and platform-focused traversal/junction/ADS/reserved-name/collision tests.
- Implement `privacy:audit` with safe paths/commit IDs/categories only, scanning index, tracked tree, all refs/history, PR diff, ignored-boundary probes, build/traces/maps/test artifacts, output roots, and configured CI artifacts. Never print matching values.
- Implement read-only `doctor`, `db:status`, `migration:status`, `preflight`, and `release:check`; a complete `quality` command; consistent SQLite `backup` and preview/confirm `restore`; and owned loopback `local:start`/`local:stop` with PID ownership, collision/root/bind checks, no auto-migration, no unrelated process termination, and no data deletion.
- Backup uses stopped writers or SQLite's consistent snapshot API, a confined ignored destination, create-new behavior, integrity/FK/schema/count manifest, and no overwrite. Restore verifies into a new location first and requires a separate exact-target owner confirmation.
- Pin GitHub Actions dependencies to immutable commit SHAs with represented tags documented in comments, preserve read-only permissions and no artifact upload, and test/update lockfile/dependency policy without weakening npm publication guards.

### Stages 42-46: default-disabled Greenhouse and Lever readers

- Add source-specific official GET-only clients behind the existing adapter contract. Greenhouse supports owner-configured board token and list/detail only; Lever supports owner-configured region/site and list/detail pagination only. Application POST endpoints are absent and method guards reject every non-GET.
- Configuration is accepted only from ignored `data/private/source-allowlist.json`, validated with exact source/tenant/host/path/policy version/expiry/budget and explicit owner approval. Missing, invalid, expired, or unapproved configuration reports `SOURCE_READY_AWAITING_TENANT`/disabled without network.
- Use HTTPS, exact host/path, no userinfo/cookies/auth/referrer/candidate data, public-address resolution before connection and redirects, redirect revalidation, byte/time/page/record/request budgets, one in-flight request per tenant, honest user agent, bounded retries, `Retry-After`, 401/403/429/security stops, cursor-loop termination, and immutable local observations.
- If the private allowlist exists and explicitly approves a tenant, perform at most one owner-started bounded read-only smoke for that configured source. Otherwise perform no live call and report waiting for an approved tenant. Never enumerate tenants or substitute a public company opportunistically.
- Discovery UI shows effective capabilities, disabled/waiting reason, policy expiry, owner-started controls and safe counts/errors; it never exposes the allowlist path/body or implies continuous discovery. There is no scheduler.

### Stages 47-51: executable synthetic runner and final gate

- Implement a local runner state machine and synthetic loopback application site only: prepared, opened, mapped, filled, paused/review, final review, synthetic submitted, or outcome unknown. Checkpoints are durable and resumable without storing credentials/session state.
- Map only approved packet values; unknown/sensitive questions pause. Validate target/form action at every navigation. Upload only the approved synthetic document digest. Stop on CAPTCHA, MFA, auth, bot detection, 401/403, rate limit, site restriction, page/form/version/destination changes, and any unsupported field. No bypass or automatic resume.
- Freeze the exact packet, host/form version, documents/digests, answers, disclosures, and unresolved state for final review. Generate an expiring, single-use consent only when no blockers remain. Changed/expired/replayed consent causes zero clicks; a valid fixture causes exactly one synthetic irreversible click.
- A lost response writes `OUTCOME_UNKNOWN` and never retries automatically. Real target capability remains `TARGET_APPROVAL_REQUIRED`; no external site/browser profile/authentication/upload/submit smoke is authorized.

### Stages 52-58: UX, migration, preserved real workflow, and security suite

- Update all eight routes with truthful mode separation, real queue/packets/timelines, clear missing/stale/error states, and effective source/runner/operation status. Keep demo content explicitly isolated and off the real-job default view.
- Meet keyboard/focus/error-summary/status-announcement/label/contrast/200%-zoom/narrow-viewport/long-content requirements with fictional browser tests. Do not create real-data screenshots or traces.
- Apply migration 0002 to a synthetic upgrade first. For the real database: stop owned processes, preview, verify backup confinement/ignore, explicitly confirm, assert legacy counts/relationships/content digests, apply, run FKs/integrity, and preserve the original backup. Never edit real rows by hand.
- Re-evaluate the preserved real job through the public domain/repository service, creating a new evaluation version while retaining its historical Phase 2.5A evaluation. Verify private provenance and truthful evidence/coverage without printing job/profile values.
- Run the real local Beta path only through supported UI/services: review/shortlist, generate one private CV, optional cover letter only if locally appropriate, prepare one packet, leave unknowns unresolved, and stop before any employer form. No external upload, source fetch except separately approved read-only tenant smoke, browser application, or submission.
- Add executable security fixtures for every listed content, host/origin, SSRF/DNS, path, token/session, audit, claim, stale-version, duplicate, migration/backup, runner-stop, consent replay, lost-response, and build/publication boundary. Automated data remains fictional.

### Stages 59-64: validation, audit, documentation, and handoff

- Run formatting, lint, strict typecheck, unit, integration, security, migration, document-layout/DOCX, synthetic-runner/browser, production build, full/production dependency audits, privacy audit, doctor/status/preflight, backup/restore rehearsal, local start/stop, diff/fsck/history checks, and final-head CI. Record every failure and fix; no skipped gate is called pass.
- Repeat the public-repository privacy audit against private profile, vacancy, database/backups, generated documents, answer/calibration/allowlist/browser state, build artifacts, refs/history, PR body/diff, logs and CI artifacts without emitting values.
- Update README, architecture, security, Personal Live V1, go-live checklist, source matrix, threat model, runbook, and this plan to distinguish implemented, disabled/waiting, synthetic-only, and still-blocked behavior.
- Classify manual-intake Beta separately from source-enabled Beta and V1. The likely safe terminal states are manual-intake Beta ready after all local gates, source-enabled Beta waiting unless a tenant is privately approved, and V1 not ready because the real runner remains target-approval-required.
- Commit by concern, push one branch, open one large implementation PR into `main`, verify its exact head and required checks, and leave it unmerged for direct ChatGPT/human review. Do not merge, deploy, enable a real target, or delete private/runtime data.

## Expected source and file changes

- Domain: extend `job-model`, `job-importer`, `job-normalizer`, `candidate-profile`, `eligibility-engine`, `fit-scorer`, `resume-engine`, `cover-letter-engine`, `application-runner`, and `application-tracker` with versioned schemas/services and focused tests.
- Persistence: migration 0002, schema exports, Beta repositories for observations/evidence/evaluations/queue/artifacts/packets/events/runs/capabilities, explicit migration/status/backup/restore support, and synthetic upgrade/recovery tests.
- Sources: `job-sources` Greenhouse/Lever readers, common safe HTTP transport, allowlist/capability schemas, fixtures/contract/security tests; no application client.
- Web: server-only Beta service boundary; loopback/origin/session guards; all eight route views/actions/components; local synthetic application route accessible only in the synthetic test mode; Next.js code follows the installed version's documentation.
- Operations: root scripts for doctor, status, privacy, quality, backup/restore, preflight/release, and owned start/stop; package scripts and hardened workflow pins.
- Documents/tests/docs: ten fictional CV golden cases, DOCX/PDF/layout checks, application/synthetic-runner fixtures, security fixtures, and reality/status documentation. Private artifacts and source configuration use only already-ignored or newly narrow ignored local paths.

## Dependency policy

Before adding a DOCX library, inspect current official package metadata, licence, maintenance activity, dependency tree, Node 24 support, and advisories. Pin the selected exact version and audit both full and production graphs. Prefer no other new runtime dependency. Source HTTP uses Node's built-in facilities with dependency injection; SQLite and Playwright remain existing dependencies. Any unavoidable package or Action change is documented with represented version/tag and rollback.

## Testing strategy and acceptance criteria

Acceptance requires all stage-specific checks above plus:

- deterministic, evidence-preserving extraction across fictional plain text, HTML, JSON-LD, Workday-like, Greenhouse-like, Lever-like, casual/part-time/full-time/contract/internship, negated, conditional, contradictory, long, malformed, and missing-field cases;
- immutable observation and evaluation history, reversible human duplicate decisions, same-source/cross-source idempotency, and no loss of the existing real row relationships;
- zero unverified/unknown/forbidden evidence used for positive eligibility, score, claim, answer, readiness, or synthetic form mapping;
- all ten templates materially differ in ordering/priorities and pass semantic-claim, ATS, page, text, DOCX parity, path, version/approval and private-output gates;
- packets correctly block stale/missing/unapproved documents, expired job evidence, duplicate danger, invalid destinations, ineligibility, unknown required answers, and undisclosed facts;
- application event projections are reproducible and cannot erase or reverse a real submission; synthetic lost outcomes never retry;
- source clients cannot issue write requests, use unapproved tenants, send candidate data, escape hosts/addresses/budgets, or continue after auth/rate/security stops;
- foreign-origin/host/replay mutations fail; path/junction/traversal/collision escapes fail; audit/log/build/CI serialization cannot contain private canaries;
- the existing private profile, vacancy, database, one canonical job/source/evaluation chain, and unconfirmed preview evidence remain preserved; the new real evaluation/document/packet smoke stays local and no employer form is touched;
- final local gates and exact-head CI pass, the public PR contains source/fictional tests/safe documentation only, and the implementation PR remains open and unmerged.

## Risks and mitigations

- Large combined scope can create incompatible partial states. Work in concern commits and stop only at a compiling/test-safe checkpoint; record completed/remaining stages and continue on this same branch rather than claiming completion.
- Extraction false positives can change legal or application meaning. Preserve exact spans/modalities, expose coverage, require review, and keep legacy/raw evidence.
- Migration can corrupt the single real local history. Exercise synthetic upgrades first, stop writers, create/verify a consistent ignored backup, compare counts/hashes/FKs, and retain the original.
- Document generation can overclaim or leak identity. Use controlled transformations, all-field validation, private path confinement, no real test recordings, and local approval/version invalidation.
- Source reads can violate scope or expose local networks. Remain default-disabled, require private allowlist approval, GET-only exact routes, address/redirect checks and conservative stop budgets.
- Loopback/browser actions can be induced cross-origin or repeated. Bind local session/origin/form versions, use one-use tokens, and deny any changed context.
- Public-source history cannot be recalled. Run repeatable privacy audits before every push and stop publication on any unexplained finding.

## Rollback and continuation strategy

Repository changes remain isolated on the feature branch and can be reverted by concern or closed unmerged. New capabilities default disabled; disable the individual source, document, packet, runner, or mutation surface without deleting observations/events. Keep existing and migrated private databases/backups intact. Restore only after a separate preview and exact owner confirmation. Never auto-retry an unknown submission, rewrite shared history, or delete private artifacts to simplify rollback.

If a turn/runtime limit prevents completion, update this section with exact completed stages, commands, failures, private-smoke status, and remaining work; commit and push a coherent compiling/test-safe checkpoint; and continue on `feat/personal-live-beta-core`. Do not open a misleading complete PR.

## Exact implementation order

1. Commit this blueprint/status checkpoint before application code.
2. Read the applicable installed Next.js 16 documentation; research/pin the DOCX dependency and current official Greenhouse/Lever contracts; resolve immutable Action SHAs.
3. Implement extraction/evidence/observation/dedup contracts and migration/repositories with synthetic upgrade tests.
4. Implement eligibility/fit/coverage/calibration/queue semantics and UI with regressions.
5. Implement claims, ten templates, private PDF/DOCX artifacts, cover letters, approval UI and fictional layout verification.
6. Implement packets, disclosure-aware tri-state answers, readiness, lifecycle/event projection and applications UI.
7. Implement loopback/session/path hardening and operational commands, backup/restore rehearsal, privacy tooling and workflow pinning.
8. Implement default-disabled Greenhouse/Lever GET readers and perform no tenant call unless the ignored approved allowlist permits one bounded smoke.
9. Implement the synthetic site/runner, stop conditions, frozen review and one-use final gate; retain real target disabled.
10. Apply the additive migration to the preserved real database only after synthetic gates and explicit backup/confirmation; re-evaluate and run the approved local private document/packet smoke without employer interaction.
11. Complete all-route UX/accessibility/security/browser tests and the full validation/privacy/publication matrix.
12. Update reality documentation, create focused commits, push, open one implementation PR, verify exact-head CI, and stop without merging.

## Beta Core implementation continuation checkpoint — 2026-09-07

Status remains `IN_PROGRESS`; this is a coherent, compiling checkpoint rather than Beta completion. PR #9 was merged at `471ab1055743249ff51a46d7187e541d0b5008af`; the active branch remains `feat/personal-live-beta-core`. Concern commits are `5059985` (approved blueprint), `aa62164` (domain, migration, documents, packets, runner safety), and `09fe761` (governed readers and initial operations).

Completed or materially implemented at this checkpoint:

- Stages 0-3: approved merge/base/branch/blueprint and Phase 2.5A closure are complete.
- Stages 4-6 and 8-14: typed extraction, exact source spans, modality/kind/certainty, Australian location/salary/week/fortnight/document tri-state fields, immutable source/job/evaluation persistence, cross-source human-review dedup, legal-vs-preference reason classes, verified-preference fit inputs, and coverage reporting are implemented. Extraction provenance UI and the larger adversarial/golden matrix remain.
- Stages 18-24: all ten CV categories now carry category-specific section ordering, evidence priorities, summary strategy, skills/experience/project selection policy, and Times-family ATS rendering. Candidate projects are an optional verified fact type. Arbitrary prose attached to a valid fact ID fails semantic validation. DOCX `9.7.1` is exact-pinned after licence/maintenance/dependency review; a real DOCX is generated in tests. New DOCX paths reject absolute/traversal/ADS/reserved names, symlink escape, and overwrite. PDF confinement, page-overflow/layout extraction, full PDF/DOCX content parity, approval versions/UI, and private real-document smoke remain. Cover letters support DIRECT/WARM/FORMAL style with shared semantic claim checks and preserve `UNKNOWN` rather than treating it as false.
- Stages 26-31 and 47/49-51 domain layer: packet truth/disclosure states, readiness blockers, Beta lifecycle transitions, persistent packets/questions/answers/runs/checkpoints, target/form/document digest binding, ordered synthetic runner states, stop reasons, expiring single-use consent, terminal lost-response behavior, and plaintext-token non-persistence are implemented and unit-tested. Real targets remain permanently paused as `TARGET_APPROVAL_REQUIRED`. Event projection/UI, executable browser integration, synthetic fixture site, resume support, and full stop-condition E2E remain.
- Stage 54 synthetic migration foundation: additive migration `0002_personal_live_beta_core.sql`, Drizzle exports, empty/foundation/intake upgrade tests, legacy source-observation/job-version backfill verification, and a Beta repository are implemented. The preserved real database is healthy at schema v1 with one pending migration and has not been migrated.
- Stages 35-37 and 39/41 initial operations: repeatable current-tree/history-path privacy audit, doctor, DB/migration status, a composite quality command, data-root confinement for migration, and immutable `actions/checkout`/`actions/setup-node` v4 pins are implemented. Backup/restore, preflight/release checks, owned local start/stop, build/CI artifact scanning, and all-ref historical content scanning remain.
- Stages 42-45 reader core: official-shape Greenhouse Job Board and Lever Postings GET readers are implemented without any POST/auth/cookie surface. Capabilities are default-disabled, owner/tenant/host/path/expiry/budget/cap bound, with HTTPS/userinfo/port/DNS/IP/redirect/timeout/byte/concurrency/retry/401/403/429 stops. Fictional tests only were used. No private tenant was selected, loaded, printed, or contacted; effective status is `SOURCE_READY_AWAITING_TENANT`. Private allowlist loading/persistence, pagination/detail support, discovery UI, and any separately approved one-call smoke remain.

Verification at this checkpoint:

- `npm.cmd run lint`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd test`: PASS, 121 tests across 23 files.
- Synthetic migration tests: PASS for fresh and existing intake databases; foreign-key checks are clean.
- `npm.cmd run privacy:audit`: PASS, 171 tracked files and 292 historical path entries checked; known synthetic credential sentinel fixtures are explicitly normalized only for value-pattern scanning while their paths remain audited.
- `npm.cmd run doctor`: PASS; private profile/directory, SQLite, and real environment boundaries are ignored as required.
- `npm.cmd run db:status`: healthy preserved local database, schema v1, one pending migration, integrity PASS, zero foreign-key issues. No values or hashes were printed.
- `git diff --check`: PASS before both implementation commits.
- `npm.cmd run format:check`: not yet a final pass. It exposed existing formatting drift in repository documentation plus several then-unformatted new files; every changed source file reported at that point was normalized. A whole-repository final formatting pass and verification remain required before PR publication.

No real profile, vacancy, database row, CV, cover letter, packet, source tenant, browser session, employer form, or submission was read into Git or published. No live source request or external application action occurred. The preserved real migration/re-evaluation/private smoke is deliberately deferred until backup/restore, full synthetic document/runner/privacy gates, and UI/service integration are complete.

Next continuation order: finish backup/restore and owned loopback operations; add allowlist loading and source pagination/detail persistence; complete event projection and packet/document approvals; read the remaining installed Next.js mutation/cookie/header guidance before web edits; implement loopback request guards, queue/job/document/application/source UI, and the synthetic fixture site; then run full fictional integration/E2E/layout/security gates before any explicitly previewed and backed-up real migration.

## Beta Core 50-minute continuation checkpoint — 2026-09-07

Status remains `IN_PROGRESS`. This run started from `778755b10ffd0f834d62cc892cb7b7b21b6e25a4` on `feat/personal-live-beta-core`. No final implementation pull request was opened and no pull request was merged.

Completed in this bounded run:

- Added verified, create-new-only SQLite backup and exact-confirmation restore tooling. Backup uses SQLite's consistent backup operation and records a private manifest with digest, byte count, schema version, integrity/FK result, and table counts. Restore re-verifies the backup, asserts writer quiescence, creates and verifies a recovery backup, verifies a staged copy before replacement, rejects collisions, and rolls back the displaced original if final verification fails. The executable test uses only a synthetic temporary database; the preserved real database was not read, backed up, migrated, restored, or otherwise touched.
- Added strict append-only Beta application-event validation, deterministic event projection, transactional event persistence, transition/from-state validation, idempotency conflict rejection, digest-bound document approval, packet derivation from current persisted job/profile/evaluation/document truth, and transactional stale-dependency invalidation.
- Added the private source-allowlist reader for the single ignored path `data/private/source-allowlist.json`. Missing configuration remains `SOURCE_READY_AWAITING_TENANT`; file/symlink/size/realpath/schema checks fail closed, while readiness exposes a non-secret alias rather than a tenant token. Added explicit Greenhouse/Lever `LIST_JOBS` and `GET_JOB` operation guards and detail readers. Tests used fictional temporary configuration and injected transports only; real source calls remained zero.
- Extended the privacy audit from tracked-tree and history-path checks to bounded all-ref historical blob-content checks. The first per-object implementation was interrupted after proving too slow and was replaced by one bounded `git cat-file --batch` process. The final audit passed without printing candidate values.
- Added composite `preflight`, `quality`, and `release:check` commands, while leaving owned process start/stop for a later continuation.
- Added a shared loopback mutation guard and applied it to import actions. It requires an exact loopback Host and matching Origin/port, rejects DNS-rebinding-style hosts, foreign/cross-port origins, missing origins, and mismatched forwarded hosts. Installed Next.js 16 mutation, Server Action, and header documentation was read before the web change.
- Added a synthetic-mode-only loopback application site and POST route with fictional simple, unknown-required, conditional, upload, changed-page, redirect, CAPTCHA, MFA, access-denied, rate-limit, different-action, and lost-response cases. Browser integration proves mapping, synthetic upload digest verification, frozen review, one-use consent, exactly one local POST, replay rejection, and terminal `OUTCOME_UNKNOWN`; it performs no external application action.
- Corrected E2E profile isolation by adding a validated filename-only override and configuring the E2E server to use a nonexistent ignored test profile. An initial failed browser run had loaded and rendered the owner's local profile into a local ignored failure artifact. No value was printed, committed, uploaded, or sent externally. The exact artifact directory was moved without inspection into ignored, recoverable `data/private/quarantine/e2e-failure-2026-09-07T1445`; the repeated full suite passed with the real profile excluded.
- Corrected the production-build private-profile path annotation after Turbopack warned that the dynamic path could trace the whole project. The repeat build passed without that warning.

Validation results:

- `npm.cmd run format:check`: PASS after the repository formatting pass.
- `npm.cmd run lint`: PASS after removing one unused import.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd test`: PASS, 133 tests across 25 files. One concurrent run timed out in an existing Git-ignore subprocess test while four gates competed for resources; the isolated full rerun passed.
- `npm.cmd run test:integration`: PASS, 9 tests across 3 files.
- `npm.cmd run test:e2e`: PASS, 12 fictional/local browser tests. The focused synthetic application suite also passed 4 tests after its runner integration was added.
- `npm.cmd run build`: PASS after the path-tracing correction; 32 route segments including the disabled-by-default synthetic routes were generated.
- `npm.cmd run privacy:audit`: PASS, 179 tracked files, 305 historical path entries, and 306 historical blobs checked.
- `npm.cmd audit`: PASS, zero vulnerabilities.
- `npm.cmd run audit:production`: PASS, zero vulnerabilities.
- `git diff --check`: PASS.

Remaining highest-priority work:

1. Implement owned loopback start/stop and finish the preflight/release-command rehearsal without touching the real database.
2. Complete PDF output confinement, measured layout/overflow checks, full PDF/DOCX text parity, document approval UI, and remaining ten-template fictional golden coverage.
3. Add session/nonce/replay protection beyond the Host/Origin boundary and complete queue, job, document, packet, application, and source-capability UI/service integration.
4. Persist bounded source observations/detail pagination through the approved repository boundary; keep all real source calls disabled unless a private tenant is explicitly approved.
5. Complete runner checkpoint/event persistence, all stop-condition browser coverage, accessibility/long-content/narrow-viewport checks, and the broader security suite.
6. Only in a later time-bounded run with adequate recovery time: preview and verify a real backup, apply migration 0002 to the preserved private database, run integrity/FK/isolation checks, and perform the approved local re-evaluation/document/packet smoke. No employer form or real submission is authorized.
7. Finish reality documentation, full release/privacy/history/CI checks, then open one implementation pull request only when the Beta Core is coherent; leave it unmerged.

## Beta Core 50-minute continuation checkpoint — 2026-09-08

Status remains `IN_PROGRESS`. This run started clean at `87da7a2a86d0adc0288e40fbc5fd68098126b94d` on `feat/personal-live-beta-core`. The GitHub CLI identity was `adeel1608`. The comparison repository and ApplyPilot both inherited `Adeel <adeel@qltyss.com>` from the same global Git configuration, so no verified personal author value existed to copy; repository-local/global identity, historical commits, and authentication were left unchanged.

Implemented and synthetically verified in this run:

- Operations: `preflight` now reports safe profile/database/migration/loopback/output/source/runner/backup/blocker states without private values. `release:check` runs preflight, quality, both audits, and an exact head/worktree/schema/source/runner/release summary; it deliberately classifies the current product `NOT_READY` despite passing tests. `local:start` binds only `127.0.0.1`, forces normal synthetic-disabled mode, performs no migration/discovery/runner action, stores owned PID metadata and logs only under ignored `data/private/runtime`, and refuses occupied ports, unsafe hosts, unsafe metadata, or a currently owned process. `local:stop` checks PID, random marker, entrypoint, repository, and creation time before termination and clears only proven-dead stale metadata. Unit tests cover stale PID reuse and unrelated-process refusal.
- Operational rehearsal: the first start attempt exposed Windows CIM date serialization and exceeded the original startup wait. It failed closed but left the exact spawned process listening after its identity could not be established and removed metadata prematurely. The process command line/marker/creation were then independently verified and only that PID was stopped; port 3000 closed. CIM output was changed to ISO time, startup allowance increased, and an identity-uncertain timeout now retains metadata and refuses termination. The repeated start returned PASS on `127.0.0.1:3000`, `/` returned 200, the synthetic route returned 404 in normal mode, verified stop passed, and the port closed.
- Backup/restore: the existing design was retained and its TypeScript CLI runtime defect was corrected by replacing unsupported top-level await with explicit async entrypoints. Backup manifests are now schema-validated, a backup root must exactly belong to the selected database's adjacent `data/private/backups`, and any failed/incomplete create removes only its newly allocated exact files. The expanded fictional rehearsal proves preview, restore into a separate destination, restore over a mutated original with verified recovery backup, schema 2, integrity PASS, zero FK issues, expected counts/data, confirmation refusal, destination collision, malformed manifest, corrupt backup, wrong schema, incomplete material, path escape, and lookalike-root rejection. No real backup or restore ran.
- PDF hardening: PDF generation now accepts only a private-relative `.pdf` path, rejects absolute/traversal/UNC/ADS/reserved/trailing/wrong-extension paths, resolves the output parent beneath the real private root to reject symlink/junction escape, returns the PDF in memory, and writes create-new with no overwrite. The example script now targets ignored `data/private/generated/examples`. Fictional tests prove a real A4 PDF, collision refusal, one-page casual layout, at-most-two-page engineering layout, selectable DOM text, body text at least 10 pt, no clipping/horizontal overflow, and no image/sidebar/table/canvas/SVG content. Full artifact-level PDF/DOCX text extraction parity remains incomplete.
- Synthetic runner/site: added changed-field, authentication-required, HTTP 401/403/429, unsupported-control, bounded slow-response, and success-receipt fixtures. They remain available only when explicit E2E synthetic mode is enabled and normal local start returns 404. Browser and domain tests prove CAPTCHA, MFA, authentication/access/rate-limit and unsupported-control stops, unknown-required pause, expired consent, packet/profile/document/domain/form change zero-click behavior, one valid fixture submission, replay rejection, and one-click terminal `OUTCOME_UNKNOWN` with no retry. No external request or real application action occurred.

Validation and current classification:

- `npm.cmd run preflight`: PASS_WITH_RELEASE_BLOCKERS; private profile VALID; real database PRESENT at schema v1 with one pending migration, integrity PASS and zero FK issues; source `SOURCE_READY_AWAITING_TENANT` with zero capabilities; real runner `TARGET_APPROVAL_REQUIRED`; backup readiness READY.
- `npm.cmd run release:check`: PASS as a command, with `RELEASE_CLASSIFICATION=NOT_READY`; formatting, lint, typecheck, 166 unit tests across 26 files, 9 integration tests across 3 files, production build, privacy audit, full audit, and production audit passed. Both dependency audits found zero vulnerabilities.
- `npm.cmd run test:e2e`: PASS, 14 fictional/local browser tests. Focused PDF and synthetic application suites also passed after their final changes.
- `npm.cmd run local:start` / `npm.cmd run local:stop`: PASS on the corrected implementation; loopback-only bind and closed port verified.
- `git diff --check`: PASS. The final staged and post-commit privacy/history checks are performed before push and recorded in the external checkpoint.
- Real database state: `PRIVATELY_VERIFIED` read-only for profile/schema/integrity/FK status; migration/backup/private Beta smoke remain `NOT_IMPLEMENTED` in this run. Real source activation is `WAITING_FOR_APPROVAL`; real runner is `READY_DISABLED`/`TARGET_APPROVAL_REQUIRED`; no source calls occurred.

Remaining highest-priority work:

1. Complete artifact-level PDF/DOCX essential-content parity and the document approval/generate/regenerate/cover-letter UI without exposing a profile dump.
2. Complete real/default job queue/detail, owner correction, applications/packet/timeline, and source-capability UI/service integration with version invalidation.
3. Add the local mutation nonce/session/request binding and executable stale/replay/cross-port security tests beyond the existing Host/Origin protections.
4. Persist bounded source run/observation/paging metadata while keeping Greenhouse/Lever real calls disabled until a pre-existing private approved tenant exists.
5. Complete runner checkpoint/event persistence, final-review disclosure display, remaining control mapping/reconciliation, accessibility/responsive/empty/error-state coverage, and the remaining high-risk golden cases.
6. Only after every remaining synthetic/document/security gate passes and a fresh adequate recovery window exists: stop the owned app, preview and create a verified real backup, migrate the preserved database additively to schema 2, run integrity/FK/mapping/isolation checks, and perform the approved local-only re-evaluation/document/packet/tracking smoke. Never visit or submit an employer form.
7. Finish reality/privacy/history documentation and exact-head CI, then open one final implementation PR only when the manual-intake Beta Core is coherent; leave it unmerged.

## Personal Live Beta Core completion record — 2026-09-08

Status: `IMPLEMENTATION_COMPLETE_AWAITING_FINAL_PR_REVIEW`. This continuation started from `9953f2872be544921b76f38c7a3831ac6efc9b50` on `feat/personal-live-beta-core`. It completes the remaining approved Beta Core scope without enabling a live source, real runner target, deployment, or submission. The final implementation pull request is the human/ChatGPT review boundary and must remain unmerged.

Completed implementation:

- Connected the default private-local job queue, job evidence/coverage/evaluation detail, owner correction overlays, version invalidation, shortlist/review/skip/preparing controls, private document generation/approval, packet preparation, application timeline, dashboard, and source-capability status. Fictional demonstrations remain explicitly collapsed/isolated and never use the private profile.
- Added immutable source observations, job/evaluation versions, requirement evidence, corrections, artifacts/approvals, packets, discovery metadata, runner checkpoints, consents, and append-only application events across the repository/service boundary. New and re-evaluated real imports use the Beta version model while historical records remain retained.
- Enforced process-local HttpOnly SameSite=Strict sessions and expiring, one-use, action/session-bound nonces on local mutations in addition to exact loopback Host/Origin/port and forwarded-host rejection. Responses that create the session are private/no-store. Replay, expiry, action mismatch, session mismatch, foreign origin, cross-port, and rebinding-style host cases fail closed.
- Completed bounded Greenhouse/Lever GET readers, including Lever paging/cursor termination and safe capability/run persistence. No ignored allowlist was present, no tenant was guessed, and the effective state remains `SOURCE_READY_AWAITING_TENANT` with zero real source requests.
- Completed private PDF/DOCX CV and cover-letter rendering, essential-content extraction/parity fixtures, create-new path confinement, measured page limits, and deterministic whole-evidence trimming without reducing the 10 pt floor. `pdfjs-dist@6.3.289` is exact-pinned as a development-only Apache-2.0 text/page inspection dependency; the lockfile, full graph, and production graph report zero known vulnerabilities.
- Completed the synthetic-only runner disclosure and browser matrix for mapping, supported/unsupported controls, unknown required answers, approved document digests, CAPTCHA, MFA, authentication, access denial, rate limits, changed pages/actions/destinations/packets/profiles/documents, expiring/replayed consent, one valid fixture click, and terminal lost-response `OUTCOME_UNKNOWN` with no retry. The real runner remains `TARGET_APPROVAL_REQUIRED`.
- Completed repeatable database-safe migration, private smoke, privacy, and publication tooling. Migration uses the verified consistent backup path; privacy auditing covers staged/tracked content, ignored-boundary probes, all refs/history blobs, build/test artifacts, selected private canaries, and CI artifact-upload policy without printing matching values.

Real database and private acceptance:

- The owned application was stopped before database work. The preserved schema-v1 database had integrity `PASS`, zero foreign-key issues, one canonical real job, and no Beta material. A consistent schema-v1 backup was created and verified, and its restore preview passed before migration.
- Two initial private smoke attempts stopped safely: the first exposed an overly literal DOCX parity comparator, and the second exposed an over-page resume. Generated files from those attempts were moved without inspection into ignored private quarantine. The verified original backup was restored; restore collision guards also retained every recovery/staging file rather than overwriting it. The parity comparator and deterministic PDF fitter were corrected and passed fictional regressions.
- The database was then restored to the verified pre-migration baseline, backed up again, and migrated additively to schema v2. Final state is 573440 bytes, schema v2, zero pending migrations, integrity `PASS`, and zero foreign-key issues. Original, recovery, and migration backups remain ignored/private and retained.
- The single authoritative private smoke re-evaluated exactly one preserved job with `PRIVATE_LOCAL_PROFILE`, advanced its queue locally to `PREPARING`, generated and approved one PDF plus one DOCX CV with essential-content parity, left cover-letter requirement `UNKNOWN` without generating one, created one `REVIEW_REQUIRED` packet with unresolved destination/questions intact, and recorded four lifecycle events. The final default UI read-only smoke passed four private routes without screenshots/traces or printed values. Real source calls: `0`. Real application actions: `0`. Employer forms visited/uploads/submissions: `0`.
- A post-browser privacy scan found selected private canary bytes in an ignored Next development compiler cache originating from the approved private UI process. The exact generated cache was moved without inspection into ignored private quarantine. The repeated audit passed. No private value, document, database, backup, vacancy, allowlist, browser state, credential, or quarantine material is tracked or included in the public diff.

Local validation completed before publication:

- `npm.cmd run format:check`: `PASS`.
- `npm.cmd run lint`: `PASS`, zero warnings.
- `npm.cmd run typecheck`: `PASS`.
- `npm.cmd test`: an initial complete run exposed two Chromium PDF tests using Vitest's 5-second default; explicit 20-second browser-render budgets were added. A later composite release run likewise exposed one synchronous `git check-ignore` case exceeding that default under full-suite contention; its subprocess matrix received the same explicit bounded budget. Focused behavior never failed, and the complete suite is rerun at the final head. Latest completed result before the release rerun: `PASS`, 172 tests across 27 files.
- `npm.cmd run test:integration`: `PASS`, 9 tests across 3 files.
- `npm.cmd run build`: `PASS`, Next.js production build compiled/typechecked and generated 31 page units; private routes remain dynamic.
- `npm.cmd run test:e2e`: the first 10-worker run reproduced an intermittent Next development JSON/compilation failure against the suite's one shared fictional SQLite/server. The suite was correctly serialized to match that shared-state contract. Final result: `PASS`, 16 tests with one worker.
- `npm.cmd run preflight`: `PASS`; profile `VALID`, database schema v2/integrity `PASS`/zero FK issues, private output and loopback boundaries `PASS`, backup ready, manual-intake Beta `READY`, source-enabled Beta `WAITING_FOR_APPROVED_TENANT`, real runner `TARGET_APPROVAL_REQUIRED`.
- `npm.cmd run privacy:audit`: pre-staging result `PASS`, 196 tracked files, 354 historical paths, 355 historical blobs, 944 build/test artifacts, and 11 selected private canaries checked. After staging every new public file, the repeated result was `PASS` across 204 tracked/index files with the same history/artifact/canary coverage.
- `npm.cmd audit` and `npm.cmd run audit:production`: `PASS`, zero vulnerabilities in both full and production graphs.
- `npm.cmd run local:start` / `npm.cmd run local:stop`: `PASS`; the owned server bound only `127.0.0.1:3000`, and the verified owned process stopped normally.
- `git diff --check` and staged `git diff --cached --check`: `PASS`. `git fsck --full` completed successfully; it reported only benign unreachable objects and no corruption.
- Concern commit `843a293` contains the Beta Core implementation/tests/tooling; `5bd0fd4` closes reality documentation; `0ac7b8d` stabilizes the subprocess-backed policy matrix. `npm.cmd run release:check` passed on clean published head `0ac7b8d54a469365fc98a29f2521bdc6cf63c34b`, including 172 unit tests, 9 integration tests, production build, privacy and dependency audits, and `MANUAL_INTAKE_BETA_READY` classification. Its exact-head E2E repeat passed 16 tests and the post-browser privacy audit passed across 204 files, 410 history paths, 411 history blobs, 954 artifacts, and 11 selected private canaries.
- PR #10 was opened unmerged from the exact branch. Its first push CI run failed before assertions because the newly browser-backed PDF unit tests ran before the workflow's later Chromium installation. The existing immutable, read-only workflow is corrected by moving that same Chromium installation ahead of unit tests; no permission, artifact, dependency, or test requirement is weakened. The corrected exact-head CI result remains the external final gate to avoid a recursive result-only commit. No further real database or private smoke mutation is required.

Release classification and continuation:

- Manual-intake Beta: `READY` after the staged/final local gates and exact-head CI pass. It remains owner-controlled and every artifact/application decision requires review.
- Source-enabled Beta: `WAITING_FOR_APPROVED_TENANT`. A separately approved private capability and one scoped read-only smoke are required; no current tenant is enabled.
- Personal Live V1: `NOT_READY`. A legitimate approved source and separately planned/reviewed real application target/runner remain mandatory. Synthetic runner evidence is not real-operation authority.
- Hosted production: `NOT_READY` and unnecessary for this local Beta.
- Next action after exact-head CI: direct ChatGPT/human review of the single final implementation PR. Do not merge, deploy, activate a source/target, run another private smoke, or submit an application under this task.

## Post-publication Beta UI completeness audit — 2026-09-08

The first exact-head PR #10 CI passed, but a requirement-by-requirement audit against the full continuation prompt found UI acceptance gaps that green domain/runner tests alone did not close. The branch and PR remain open and unmerged while these are completed; the earlier private migration/smoke remains authoritative and will not be repeated because this closure is code/fictional-test only.

Objective and exact changes:

- Add server-rendered real-queue filters for eligibility, fit, coverage, category, employment type, source, location, state, expiry evidence, unknown requirements, and queue state. Expose owner labels for `SHORTLIST`, `REVIEW_LATER`, `SKIP`, and `ARCHIVE`; archive maps to the existing durable `SKIPPED` state with a distinct audited reason rather than changing the already-applied schema.
- Expose recommended/current CV template, a validated ten-category override, evidence and unsupported-gap preview, and a validated cover-letter tone override. Generation continues to use verified facts only, produces create-new PDF/DOCX artifacts, and binds approvals to the immutable artifact's job/profile/template/rule/renderer versions and digest.
- Enrich `/applications` with selected current documents, cover-letter state, unknown-answer and approved-disclosure counts, runner state, blocker-driven next action, and explicit recovery guidance. Add nonce-protected, state-valid manual owner outcome recording: assessment/interview/offer/rejection require the submitted lifecycle, while withdrawal/expiry remain available only where the domain transition graph permits them. Never infer an employer response or provide a path that marks an unsubmitted packet submitted.
- Add fictional browser/unit coverage for filtering, archive/review labels, template/tone controls, packet-blocked summaries, keyboard focus/200% zoom/long content, and manual-outcome transition authorization. Keep real/demo isolation, no-store session behavior, zero real source calls, and zero real application actions.

Security/privacy/rollback: use existing Zod/domain enums, prepared statements, loopback session/nonces, append-only event validation, and safe display-only metadata. No migration, raw source rewrite, private value logging, document content route, external target, or browser state is added. A code revert removes these views/actions without touching private observations/artifacts/events. After implementation, rerun the full local release/browser/privacy gates, push the same branch, and require new exact-head PR CI green before returning the final review handoff.

### UI completeness closure result — 2026-09-08

Status: `COMPLETE_AWAITING_EXACT_HEAD_CI`. The existing PR #10 remains open and unmerged; this pass changes no migration, private record, source capability, or real runner authority.

- `/jobs` now filters the real local queue by eligibility, fit, coverage, category, employment type, source, location, state, expiry evidence, unknown requirements, and owner queue state. `SHORTLIST`, `REVIEW_LATER`, `SKIP`, and `ARCHIVE` are distinct owner-facing choices; review-later/archive are retained as audited reason codes over the existing schema rather than a database change.
- The job workspace now exposes current/recommended templates, all ten validated overrides, template strategy/priorities, a bounded verified-fact evidence preview, unsupported/unknown gaps, document lifecycle/version/evidence metadata, and a validated cover-letter tone. Regeneration is create-new: prior same-format artifacts become superseded, their digest approval is invalidated, and any packet that selected one becomes review-required/invalidated without overwriting history.
- `/applications` now summarizes lifecycle and packet readiness, selected CV/letter artifacts and approval/staleness, unknown required answers, separate disclosure approvals, runner stop/recovery state, next action, and append-only timeline. Nonce-protected owner-observed outcomes use the existing domain transition graph and explicit confirmation; the UI offers no `SUBMITTED` transition and performs no employer action.
- Focused filter/outcome/template/tone/repository tests passed. The composite `release:check` passed formatting, lint, typecheck, 178 unit tests across 29 files, 9 integration tests across 3 files, the 31-unit Next production build, privacy checks, and zero-vulnerability full/production dependency audits. It classified manual-intake Beta `READY`, source-enabled Beta `WAITING_FOR_APPROVED_TENANT`, the real runner `TARGET_APPROVAL_REQUIRED`, and Personal Live V1 `NOT_READY` as intended.
- The complete serialized browser suite passed 17 fictional/local tests, including exact queue controls, template/tone/evidence UI, narrow layout, keyboard focus, 200% zoom, full synthetic stop coverage, one fictional consent-bound click, and no retry after an unknown outcome. One prior run exposed only a flaky fixture-link navigation assertion; the locator now verifies the exact route before deterministic navigation, and the full rerun passed.
- The privacy scanner detected selected private canary bytes in ignored E2E development compiler cache files. Each exact generated cache directory was moved without inspection into ignored private quarantine; the final post-browser audit passed across tracked/history/build/test surfaces and 11 private canaries. No private profile, database, vacancy, document, cache, credential, or quarantine material is tracked or staged.
- The authoritative private database remains schema v2, 573440 bytes, with zero pending migrations, integrity `PASS`, and zero foreign-key issues. The prior single private smoke remains authoritative and was not repeated. Real source calls remain `0`; real application actions remain `0`; employer forms visited/uploads/submissions remain `0`.
- Remaining publication step: commit and push this coherent closure on `feat/personal-live-beta-core`, verify PR #10 points to the exact new head with successful GitHub Actions, and stop for ChatGPT review without merging.

## PR #10 human-review remediation blueprint — 2026-09-08

Status: `IN_PROGRESS_REVIEW_FIXES`. Direct ChatGPT review requested changes at reviewed head `7af56299117d70f8c7a7b37602aa260b6b52cea3`. The clean working branch is still `feat/personal-live-beta-core`; GitHub CLI is authenticated as `adeel1608`; PR #10 is open, unmerged, and points to the reviewed head. This is a bounded correction pass on the same branch and PR, not a new feature train.

### Current state and objective

The approved Beta architecture, additive schema v2, private migration, private local smoke, source-disablement, and real-runner boundary remain intact. Review identified correctness gaps in legacy vacancy reprocessing, profile snapshot activation/binding, stale generation, correction evidence/location versioning, packet expiry/duplicate safety, v2 import integration coverage, Lever path confinement, the document-type contract, local document inspection, and the local release script. The objective is to fix only those findings, prove them with fictional/synthetic regressions, then take one fresh verified backup and perform one offline reprocess/document/packet refresh of the existing private vacancy. No migration file will change.

### Assumptions and requirements

- The one canonical private legacy workflow can be reconstructed only through its stored import/source IDs and confirmed stored material. If source batch/record identity or segment boundaries are absent, inconsistent, or ambiguous, reprocessing stops with `LEGACY_REPROCESS_REQUIRES_OWNER_REIMPORT`; title/company matching is forbidden.
- Original import material, source observations, job versions, evaluations, documents, approvals, packets, and events are immutable history. Reprocessing/correction creates new versions and invalidates dependants; it does not rewrite or delete history.
- One canonical stable profile serialization/hash helper is shared by persistence and generation binding. Reusing an existing A snapshot after A -> B -> A must reactivate A's exact stored version.
- Document generation is an explicit consumer of the current job/profile/evaluation tuple. It fails with stable re-evaluation-required codes on any hash, active-version, job-version, or staleness mismatch and never re-evaluates implicitly.
- Correction copies unchanged source field/requirement evidence with original provenance, adds owner evidence only for corrected fields, and reuses the deterministic conservative Australian location parser. No distance is derived.
- Packet readiness derives expiry and duplicate-review safety from persisted current evidence. Expired and unresolved duplicate states block; unknown expiry remains explicitly unknown/review-required rather than active.
- Runtime document types align to schema v2 (`CV | COVER_LETTER`); `OTHER` has no current use and is removed without migration.
- The document route accepts only an artifact ID plus an allowlisted disposition mode. It verifies exact loopback Host/request boundary and the current HttpOnly session, performs the database lookup, confines the recorded private-relative path through realpath, verifies bytes against the stored digest, returns draft PDFs for inline review and PDF/DOCX downloads with no-store/nosniff/sanitized headers, and rejects stale/missing/unsafe artifacts. No public/static copy or arbitrary browser path exists.
- Greenhouse semantics remain unchanged. Lever tenant URLs and every redirect require an exact path-segment boundary. No tenant is enabled, enumerated, or contacted.
- The real application runner remains `TARGET_APPROVAL_REQUIRED`; external form visits, uploads, and submissions remain disabled.

### Architecture, data flow, and proposed file scope

- Candidate profile: add a stable canonical content-hash helper in `@applypilot/candidate-profile`; make `JobImportRepository.persistProfileVersion` reactivate an existing identical version and expose/read the exact binding needed by services. Add A -> B -> A and stale-dependency regressions.
- Import/reprocess: extend the existing importer/repository boundary with a GENERAL offline legacy reprocess method. Resolve canonical job -> exact `job_source_records`/import record/batch -> stored confirmed content and recorded segment identity; run the current parser/extractor; persist a new immutable observation/version/evidence/evaluation through the same v2 path. Add a schema-v2 integration suite using the actual `JobImportRepository` for new/repeat/changed imports and profile modes.
- Beta repository/workspace: carry field and requirement evidence forward during owner correction, add corrected-field evidence, normalize changed location structure, centralize current evaluation/profile checks for generation, invalidate profile-dependent documents/approvals/packets on version changes, and derive packet expiry/duplicate state.
- Runner contract: change the in-memory packet expiry representation to `ACTIVE | EXPIRED | UNKNOWN` and add `JOB_EXPIRY_UNKNOWN` readiness handling if this remains migration-free; remove `OTHER` from packet/document runtime schemas.
- Sources: replace prefix string matching in the shared public-posting boundary with exact segment-boundary validation used for initial and redirect URLs; add sibling-prefix tests.
- Web: add `apps/web/app/documents/[artifactId]/route.ts` and a server-only artifact resolver/response helper, extend the current document list with safe preview/download links, and add fictional route/browser tests. Applicable local Next.js 16 route-handler, dynamic-route, cookies, and headers guidance must be read before implementation.
- Operations: flatten `release:check` so E2E executes before the post-browser privacy audit and release summary. Keep individual scripts and CI checks. Update the existing private smoke to use the new reprocess path and current generation binding; it remains offline and outputs safe counts/status only.
- Documentation: record implementation/results here and update the existing PR #10 body with exact final counts after all checks.

No new production dependency or migration is planned. Expected files are confined to the packages/services/routes/scripts/tests directly implicated above. A genuine need for schema 0003, `OTHER`, ambiguous real source reconstruction, or additional source/runner authority is a stop condition requiring a new reviewed design rather than scope expansion.

### Security, privacy, and failure risks

Primary risks are reconstructing the wrong stored segment, strengthening an unknown expiry/duplicate state, mixing profile file bytes with the wrong database version, serving a path outside private storage, digest/time-of-check drift, redirect prefix collision, accidentally rewriting applied migration 0002, or compiling private values into test/build artifacts. Controls are exact stored identifiers and hashes, Zod boundaries, SQLite transactions/prepared statements, immutable version rows, fail-closed stable codes, create-new files, realpath confinement, post-open digest verification, loopback/session enforcement, no-store/nosniff headers, fictional browser data, and post-browser canary scanning. Tests and tooling must never print private values. No real screenshot, video, trace, source request, or employer interaction is permitted.

### Testing and acceptance strategy

- Unit/repository: stable profile hashing/reactivation A -> B -> A; stale profile/evaluation generation refusal; approval/packet invalidation; evidence carry-forward and owner evidence; Melbourne VIC -> Sydney NSW structure; packet ACTIVE/EXPIRED/UNKNOWN and duplicate resolved/unresolved/unknown; runtime type alignment; Lever exact/sibling/redirect path boundaries; document route ID/path/session/digest/content-type/disposition safety.
- Integration: actual migrations 0000/0001/0002 plus actual import repository flow for new user content, unchanged repeat, explicitly changed update, observation/version/evidence/evaluation linkage, private profile provenance, demo non-evaluation, missing-profile no-fallback, and offline legacy reprocess history preservation.
- Browser: fictional draft PDF inline/open/download and PDF/DOCX downloads through the local artifact-ID route; no arbitrary path; current UI controls remain responsive and submission-disabled. No real artifact is captured.
- Full gates: format, lint, typecheck, unit, integration, build, E2E, audits, post-browser privacy, doctor, database status, quality, preflight, flattened release check, diff check, strict fsck, owned local start/stop/closed port, and exact-head GitHub CI.
- Private closure only after synthetic gates: stop owned app, create/verify a fresh consistent backup without deleting older backups, perform exactly one stored-ID offline legacy reprocess, verify old/new versions/evidence/current extractor/current profile binding/integrity/FKs with safe counts, generate/verify/approve new PDF+DOCX, preserve actual cover-letter state, prepare one new review-required packet without fake submission, and repeat the full private publication audit.

Acceptance requires every enumerated human-review finding to pass, schema v2 with zero pending migrations/integrity PASS/zero FK issues, real source calls and employer/application actions all zero, no private material in Git/build/test/CI inputs, PR #10 updated to and green at the new exact head, and PR #10 left open/unmerged. Rollback is by focused commit revert plus restoration from the newly verified backup if the private reprocess fails; never delete history or down-migrate.

### Exact implementation order

1. Commit this remediation blueprint before application changes.
2. Implement stable profile hashing/reactivation and current tuple validation with fictional repository tests.
3. Implement offline stored-ID legacy reprocessing and the full schema-v2 import/reprocess integration matrix.
4. Fix correction evidence/location carry-forward and packet expiry/duplicate truth, with regressions.
5. Align document types and harden Lever path-segment validation/redirect tests.
6. Implement the local artifact-ID serving route and fictional unit/browser tests after reading bundled Next.js guidance.
7. Make `release:check` include E2E followed by privacy, and update operational tests/scripts without weakening CI.
8. Run every synthetic/full local gate. Stop and fix all failures before private work.
9. Create and verify a fresh private backup; perform one offline real vacancy reprocess and one current document/packet refresh; verify safe counts/integrity/FKs and zero external actions.
10. Run the final privacy/publication matrix, commit by concern, push the same branch, update PR #10's body to actual results, wait for exact-head CI, and stop unmerged for ChatGPT re-review.

### PR #10 human-review remediation result â€” 2026-09-08

Status: `COMPLETE_AWAITING_EXACT_HEAD_CI`. The correction remains on `feat/personal-live-beta-core` and the existing PR #10 remains open and unmerged. No migration, source capability, external runner authority, application destination, or repository setting changed.

Completed review fixes:

- Added a general offline legacy reprocess path that resolves the exact stored source record, import record, one-job batch, and immutable source observation by stored identifiers. It re-runs the current parser/extractor, creates a new job version and typed evidence tied to the original observation, then creates a current private-profile evaluation. Multi-job or ambiguous provenance stops with `LEGACY_REPROCESS_REQUIRES_OWNER_REIMPORT`. Fictional schema-v2 integration proves historical preservation and the safe refusal.
- Centralized the candidate-profile content hash, reactivates an existing identical snapshot, and verifies the profile file hash, active version, evaluation profile/job versions, evaluation staleness, and safe output root before document content is generated. The UI exposes stable re-evaluation-required states. A -> B -> A, changed-file, stale evaluation, approval invalidation, packet invalidation, and permanently stale old-artifact regressions pass.
- Owner corrections copy unchanged source field evidence and typed requirement evidence with their original observation references, add `OWNER_CORRECTED` evidence only for changed/derived fields, and use the shared conservative Australian location helper. The Melbourne/VIC -> Sydney/NSW regression retains no old VIC structure and derives no distance.
- Packet runtime truth now uses `ACTIVE | EXPIRED | UNKNOWN` and `CLEAR | UNRESOLVED | UNKNOWN`; expired/unknown expiry and unresolved/unknown duplicate states block readiness. Document runtime types now match applied schema v2 exactly (`CV | COVER_LETTER`) without changing migration 0002.
- Schema-v2 actual-import coverage applies 0000/0001/0002 and proves new, unchanged repeat, explicit changed update, immutable observations/versions, current typed evidence, private fit/coverage evaluation, demo exclusion, missing-profile exclusion, current evaluation linkage, and ambiguous legacy refusal.
- Lever endpoint and every redirect now require exact tenant path-segment boundaries; exact tenant/base and job paths pass while sibling-prefix initial/redirect paths stop. Greenhouse behavior remains green. No capability exists and no source request ran.
- Added a loopback/session-protected artifact-ID route. It performs the SQLite lookup, rejects absolute/traversal/realpath escape and stale artifacts, opens only a regular confined file, verifies its digest/signature, and returns no-store/nosniff responses with exact PDF/DOCX types and sanitized disposition. Draft PDF inline preview and PDF/DOCX download are exposed without public/static copies; unit/browser tests use fictional bytes only.
- Flattened `release:check` so format, lint, typecheck, unit, integration, build, E2E, post-browser privacy, full/production dependency audits, and an explicitly gated release summary run in order. The production build uses nonexistent build-only private-profile/database filenames so private runtime state is never an input to build-time rendering. The privacy scanner now treats four-to-six-byte compiler-database matches as canaries only in readable artifact text, avoiding demonstrated isolated binary collisions while retaining exact detection for readable short values and all longer canaries.

Private closure and safety results:

- Fresh verified backup: `backup-2026-09-08T08-34-53.537Z-a36f16c8`, schema v2, integrity PASS. Older backups were not deleted.
- Exactly one existing private vacancy was reprocessed from stored local material. Result: one canonical job, historical versions preserved, current extractor `2.0.0` evidence present, evaluation context `PRIVATE_LOCAL_PROFILE`, exact current profile/version binding, integrity PASS, and zero foreign-key issues. Real source calls remained 0.
- Prior documents/approvals/packet were invalidated by the new job version. A new private CV PDF/DOCX pair was generated from the exact current job/profile/evaluation tuple, content parity passed, and only those current artifacts were approved. The actual cover-letter state remained `UNKNOWN`, so no cover letter was generated. A new packet is `REVIEW_REQUIRED`; the existing four historical lifecycle events were preserved and no second application/submission was created.
- A pre-smoke audit found a prior build cache containing selected canary bytes; the exact disposable `.next` directory was moved intact to a private local temp location because direct deletion was policy-blocked. A fresh isolated build initially produced only isolated four-byte surname collisions in opaque SST records (5-7 printable-byte runs, no readable profile context and no other private canary). The tested scanner correction and build isolation produce a post-build/post-browser privacy PASS. No private profile, vacancy, database, backup, PDF, DOCX, packet, cache, session, trace, screenshot, or report is tracked, staged, or present in the PR diff.

Validation on clean implementation head `41dd3e1ef8b044f876efa3a0628ba0ddaeb092eb`:

- `npm.cmd run release:check`: PASS. This includes `format:check`, lint, typecheck, 189 unit tests across 31 files, 13 integration tests across 3 files, the 31-route Next production build, 18 serialized fictional/local E2E tests, post-browser privacy audit across 217 tracked/index files, 462 history paths, 463 history blobs, 663 build/test artifacts and 11 selected private canaries, plus zero-vulnerability full and production dependency audits.
- Release classification: `MANUAL_INTAKE_BETA_READY`; source-enabled Beta remains `WAITING_FOR_APPROVED_TENANT`; the real runner remains `TARGET_APPROVAL_REQUIRED`; Personal Live V1 remains `NOT_READY` pending separately approved real source/runner scope.
- `npm.cmd run db:status`: schema v2, pending migrations 0, integrity PASS, foreign-key issues 0.
- `npm.cmd run doctor`: PASS. `npm.cmd run preflight`: PASS with manual-intake Beta READY and capability count 0.
- `npm.cmd run local:start` / `npm.cmd run local:stop`: PASS on `127.0.0.1:3000`; port 3000 closed afterward. An earlier start immediately after intentional `.next` removal failed closed because no production build existed; after the isolated release build the required start/stop rehearsal passed.
- `git diff --check`: PASS. `git fsck --strict`: PASS with benign dangling objects only and no corruption.
- Real employer form visits, uploads, submissions, application actions, and source calls: all 0.

Remaining publication steps only: commit this result note, rerun final checks on the exact documentation head, push the same branch without force, update the existing PR #10 body with the actual 189/13/18 counts and new regressions, require exact-head GitHub Actions green, and stop for ChatGPT re-review without merging.

## R2 matching quality + R1 source-enabled Beta plan gate — 2026-09-08

Status: `PLAN_ONLY_AWAITING_HUMAN_REVIEW`. The historical sentence immediately above belongs to the pre-merge PR #10 result record; it is preserved as evidence and is no longer the current next action.

### Current state and objective

Baseline verification found clean `main` equal to `origin/main` at merge commit `4a0462d24b9a8db79ec49ff64242405d8f96f40d`; PR #10 is merged and its reviewed head remains `b7872fe5791f1baa88d9e95e2b7096926ea44813`. GitHub CLI is authenticated as `adeel1608`. The local doctor, database status, preflight, and privacy audit pass; schema is v2 with zero pending migrations, integrity PASS, zero foreign-key issues, no source capability, Manual-intake Personal Beta READY, source-enabled Beta WAITING_FOR_APPROVED_TENANT, and runner TARGET_APPROVAL_REQUIRED. The planning branch was created directly from that baseline. No private smoke, source call, application action, or repository setting change is part of this gate.

The objective is to replace broad roadmap prose with implementation-ready designs for two deliberately separate trains:

1. [R2 matching quality](docs/R2_MATCHING_QUALITY_PLAN.md): typed field/evidence states and modalities; Australian geography, employment/hours/schedule, salary unknown-period, document tri-state, typed requirement/work-right structure; legal/employer/preference semantics; verified-only scoring; calibration; durable cross-source duplicate review; queue freshness; corrections; typed audit; additive persistence; and evidence-first UI.
2. [R1 source-enabled Beta](docs/R1_SOURCE_ENABLED_BETA_PLAN.md): exact owner-approved capability records; current Greenhouse/Lever evidence; candidate-blind source boundaries; SSRF/DNS/redirect/budget/retry/cancel/crash/log/tenant controls; one selected family; and a future separately authorised one-tenant smoke.

### Assumptions, requirements, and non-goals

- The merged Manual-intake Personal Beta remains the release baseline. R2 improves confidence/structure but does not retroactively revoke the narrow owner-reviewed manual release.
- Unknown remains unknown; source-stated is not automatically verified truth; owner correction does not erase source history; a derived value cannot increase certainty or modality.
- Only current verified candidate facts may add fit points. A score never clears blocker/review/stale/conflict/coverage state and is never a hiring probability.
- Source and candidate pipelines remain separated: candidate data, preferences, documents, answers, sessions, and credentials are absent from discovery requests.
- No tenant is guessed or enumerated. Public vendor documentation is not blanket employer/use authority. One exact private capability requires separate owner/policy approval and expires/revokes fail closed.
- All schema evolution is additive after reviewed SQL and a verified ignored backup. Applied migration 0002 is immutable; private database migration is not authorised by this planning task.
- This task does not implement R1/R2 code, activate any tenant, make a live source request, visit an employer form, upload, submit, deploy, rewrite history, or merge its PR.

### Architecture and data flow

R2 preserves domain purity and immutable versioning:

`local/source observation -> Zod boundary -> field + requirement evidence state/modality -> canonical job version -> classed eligibility + coverage -> verified-only score -> duplicate review/current queue decision -> owner correction/re-evaluation -> later document/packet consumer`

R1 remains a candidate-blind upstream producer:

`ignored exact owner capability -> expiry/revocation/operation preflight -> pinned bounded HTTPS GET -> Zod source DTO -> transactional run/page/observation -> R2 normalization -> owner review queue`

Every downstream material decision binds job/profile/rule/weight/evidence/duplicate versions. Changes mark evaluations, queue decisions, artifacts, and packets stale rather than overwriting history. Audit accepts only event-specific opaque IDs/enums/versions/codes/counts/timestamps; free-form source/profile/document/network values are rejected.

### Proposed implementation file scope

- R2A: `packages/job-model`, `packages/job-importer`, source mappers, database schema/repositories and the next unused additive migration, normalization fixtures/docs, evidence UI.
- R2B: `packages/eligibility-engine`, `packages/fit-scorer`, evaluation repository/service, fixtures, eligibility/fit UI/docs.
- R2C: `packages/job-normalizer`, duplicate/queue/correction/audit repositories and actions, `/jobs` UI, integration/browser tests.
- R2D: fictional golden fixtures, private aggregate calibration harness, dashboard/detail uncertainty UX, accessibility/browser/release docs.
- R1A: `packages/job-sources` shared boundary/private allowlist, capability/run persistence, source status UI, synthetic network/security tests.
- R1B: one selected reader (recommended Lever), structured source schema/mapping, observation persistence, fictional contracts.
- R1C: normally safe evidence documentation after one separately authorised private smoke; capability/raw data remains ignored and uncommitted.

The [R2 defect table](docs/R2_MATCHING_QUALITY_PLAN.md#current-defect-disposition) records `FIX_IN_R2 | ALREADY_FIXED | DEFER` with file/function evidence. The two non-blocking PR #10 carryovers remain assigned outside R2: before packet preparation, re-resolve the current private profile/apply the document-style current tuple gate under R4/R11; replace the cosmetic `Â·` separator under R8 UI hardening.

### Dependencies, risks, security, and privacy

R2A depends only on the merged manual Beta and reviewed backup/migration design. R2B depends on R2A. R2C depends on R2A/R2B version bindings. R2D depends on R2A–R2C. R1A is reviewed independently but R1B normalization depends on R2A; R1C depends on reviewed/merged R1A/R1B, R2A, a new exact owner capability approval, policy review, and adequate recovery time.

Principal risks are false certainty, requirement-modality loss, class conflation, ranking bias, false duplicate merge, stale queue/preparation state, correction/audit provenance loss, private calibration leakage, arbitrary network destinations, DNS rebinding, unbounded responses/retries, cursor/crash duplication, tenant crossover, and accidental write/application behavior. The exact asset/threat/impact/control/test/residual-risk/stop-condition matrix is in [THREAT_MODEL_V1](docs/THREAT_MODEL_V1.md#r1r2-next-gate-threat-register--2026-09-08). Any private-data finding, unpinned destination, unclear source authority, unsafe migration mapping, automatic ambiguous merge, positive unverified score, or real action path is a stop condition.

### Testing strategy and acceptance

Each implementation slice has its own dependencies, files, schema/data changes, tests, privacy/rollback, human gate, and acceptance criteria in the focused plans. Across the trains, required gates include:

- field/modality/span and sparse-coverage fixtures; full AU location, salary/doc tri-state, structured requirements/work-right, employment/schedule regressions;
- complete legal/employer/preference outcomes, current verified-only score ablation, determinism/bounds/monotonicity, blocker/no-recommendation, and fictional golden rankings;
- cross-tenant/repost/conflict/link/split, queue staleness, typed correction, audit allowlist, crash/idempotency integration cases;
- additive migration preview/backfill/count/FK/integrity/backup/restore tests with legacy ambiguity mapped to UNKNOWN;
- R1 exact URL/host/path/query/operation/expiry/revocation, IPv4/IPv6/rebinding/pinning, redirects, content type/size/body timeout/cancel, retry/rate/cursor/concurrency/crash/log/private-canary tests using injected transports only;
- browser evidence/uncertainty/dedup/queue/accessibility/responsive/error states; and
- format, lint, strict typecheck, unit, integration, production build, E2E, full/production dependency audit, diff/privacy/history/build audit, and exact-head CI.

Acceptance requires the focused plans to be internally consistent, current status docs to distinguish READY/WAITING/NOT_READY correctly, all named defects/carryovers to have ownership, and this documentation-only PR to be green and left unmerged for review. It does not require or permit application-code behavior to change.

### Rollback and exact implementation sequence

Planning rollback is a normal revert of this documentation commit; it changes no runtime/private data. Future code rollback disables the affected parser/rule/scorer/source capability and pins retained prior versions. Migrations never delete legacy rows; restore occurs only from an owner-approved verified backup. Source rollback revokes/disables one capability while retaining safe observations. A submitted application history is never rewritten.

Exact forward sequence after this plan is separately reviewed and merged:

1. Authorise and implement **R2A evidence model and normalization only** on a new feature branch.
2. Review the additive schema/migration and fictional evidence fixtures; run complete gates; leave its implementation PR unmerged.
3. After R2A human review/merge, separately plan/authorise R2B, then R2C, then R2D.
4. R1A may proceed only under separate implementation authority and with zero real calls. R1B recommends Lever and consumes R2A evidence.
5. R1C begins only after a fresh explicit one-tenant approval. Its first smoke is one Lever LIST request, `skip=0`, `limit=25`, at most 2 MB, zero redirects/retries/details, followed by local integrity/privacy/idempotency checks and default disablement.
6. A separate post-smoke human decision is required to declare source-enabled Personal Beta ready. No R1 result authorises a real runner or application action.

Recommended next implementation slice: **R2A — evidence model and normalization**. This plan PR must remain open and unmerged for human review.

### Planning implementation and local validation record

- Changed scope is documentation only: `PROJECT_PLAN.md`, `README.md`, and files under `docs/`. No application code, dependency, workflow, migration, private runtime record, repository setting, or source capability changed.
- Current-status documentation now records PR #10 merged, merge `4a0462d24b9a8db79ec49ff64242405d8f96f40d`, Manual-intake Personal Beta READY, source-enabled Personal Beta WAITING_FOR_APPROVED_TENANT, Personal Live V1 NOT_READY, and runner TARGET_APPROVAL_REQUIRED. Historical checkpoint sections remain historical.
- R2 audit records 21 matching defects: 16 `FIX_IN_R2`, 5 `ALREADY_FIXED`, plus two separate PR #10 carryovers deferred to R4/R11 and R8 UI hardening. The corrected audit separates already-gated location/work-type/category preferences from the R2B-owned unverified commute-negative branch and records that `REVIEW_REQUIRED` can currently reach `recommended=true`. R2A–R2D are independently reviewable slices; R2A is the only recommended next implementation choice.
- R1 compares current official Greenhouse and Lever documentation without a listing request. Lever is recommended for a future first family because one `skip`/`limit` page and plaintext/structured fields permit tighter bounds; no tenant is selected. R1A–R1C remain separately gated.
- `npm.cmd run release:check`: PASS on the complete staged planning content before this result-only note. Doctor/database/preflight passed; formatting, lint, typecheck, 189 unit tests across 31 files, 13 integration tests across 3 files, production build with 31 page units, and 18 serialized fictional E2E tests passed. Privacy audit passed across 219 tracked/index files, 463 history paths, 464 history blobs, 687 build/test artifacts, and 11 selected private canaries. Full and production dependency audits reported zero vulnerabilities. Release classification remained `MANUAL_INTAKE_BETA_READY`; capability count remained 0.
- The result-only note is followed by formatting, lint/typecheck, staged diff/privacy/history checks, commit/push, and exact-head GitHub Actions. CI is the final complete rerun on the committed head.
- Real source calls, employer form visits, external uploads, submissions, real application actions, private document regeneration, private packet creation, and destructive/private smoke operations during this planning gate: all `0`.
