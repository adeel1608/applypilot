# ApplyPilot Project Plan

Last updated: 2026-09-05  
Owner: `adeel1608`  
Repository: `adeel1608/applypilot`  
Working branch: `feat/bootstrap-applypilot`

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

All statuses use `NOT_STARTED`, `IN_PROGRESS`, `COMPLETE`, or `BLOCKED`.

| Phase | Objective                                  | Tasks                                                                                              | Acceptance criteria                                                                                  | Key risks                             | Dependencies                           | Validation requirements                             | Status      |
| ----- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- | --------------------------------------------------- | ----------- |
| 0     | Bootstrap repository and architecture      | Private GitHub repo, branch, workspace, docs, CI, security baseline                                | Required docs/config exist; CI design covers quality gates; private repo and feature branch verified | Premature architecture lock-in        | GitHub CLI, Node LTS                   | Lint, typecheck, tests, build, Git/GitHub audit     | COMPLETE    |
| 1     | Establish candidate/domain/data foundation | Truth store, normalized jobs, database, fixtures, eligibility, scoring, basic documents, dashboard | All Phase 0/1 acceptance criteria in this plan pass                                                  | Incorrect rules or unsafe claims      | Phase 0, Zod, Drizzle, fixtures        | Unit/integration/E2E tests and production build     | COMPLETE    |
| 2     | Add SEEK discovery                         | Policy review, discovery/detail mapping, fixture replay, throttling/error model                    | SEEK jobs normalize with provenance; no protection bypass                                            | Site/policy changes, rate limits      | Phases 0-1                             | Contract tests, fixture replay, manual policy audit | NOT_STARTED |
| 3     | Add Indeed discovery                       | Policy review, discovery/detail adapter, fixture replay                                            | Indeed jobs normalize with provenance and safe failures                                              | Site/policy changes, bot controls     | Phases 0-2 patterns                    | Contract tests, fixture replay, manual audit        | NOT_STARTED |
| 4     | Add Employment Hero adapter                | Model public listings/details and capability boundaries                                            | Supported public jobs normalize; unsupported flows declared                                          | Tenant variation                      | Adapter contracts                      | Contract/integration tests                          | NOT_STARTED |
| 5     | Add generic ATS adapters                   | Greenhouse, Lever, Workday, generic company sites                                                  | Each adapter passes common contract suite and retains raw provenance                                 | Vendor/tenant variation               | Phases 2-4 lessons                     | Per-adapter fixtures and policy/security checks     | NOT_STARTED |
| 6     | Refine normalization and deduplication     | Canonical fields, similarity signals, merge review UX                                              | Duplicate clusters are explainable and source records remain intact                                  | False merges                          | Multi-source fixtures                  | Precision/recall fixture suite and manual review    | NOT_STARTED |
| 7     | Refine eligibility                         | Expand rules, confidence, override/audit workflow                                                  | Hard blockers and overrides are deterministic and audited                                            | False negatives                       | Candidate feedback and normalized data | Rule matrix, regression tests                       | NOT_STARTED |
| 8     | Refine fit scoring                         | Calibrate weights and preference signals                                                           | Scores remain explainable and calibrated against reviewed outcomes                                   | Misleading precision/bias             | Outcome samples                        | Golden cases, sensitivity and bounds tests          | NOT_STARTED |
| 9     | Complete CV template engine                | Implement categories and reusable layout validation                                                | ATS-safe categories render within configured page limits                                             | Layout drift                          | Truth store, Playwright                | PDF structure, page-count, visual QA                | NOT_STARTED |
| 10    | Add automatic CV tailoring                 | Deterministic tailoring first; optional provider boundary                                          | Every claim has profile provenance; unsupported claims fail closed                                   | Hallucination                         | Phase 9 and truth provenance           | Adversarial truth-compliance tests                  | NOT_STARTED |
| 11    | Complete cover-letter generation           | Requirement selection, tone configuration, layouts                                                 | Employer/role accurate, fact-safe, non-generic output                                                | Unsupported claims                    | Phase 10 patterns                      | Content provenance and PDF validation               | NOT_STARTED |
| 12    | Build application preparation              | Question mapping, answer store, document checklist                                                 | Prepared packet identifies every unknown and required review                                         | Incorrect answers                     | Documents and normalized jobs          | Workflow integration tests                          | NOT_STARTED |
| 13    | Add assisted browser filling               | Local runner, field mapping, pause/resume, confirmation gate                                       | Safe assisted filling works on approved fixtures; no unattended final submit                         | Credential leakage, site controls     | Phase 12, security review              | Synthetic-site E2E, threat-model review             | NOT_STARTED |
| 14    | Complete tracking dashboard                | Persistent queues, timelines, status actions                                                       | Applications and events are filterable and auditable                                                 | State inconsistency                   | Database and runner events             | Transition and UI tests                             | NOT_STARTED |
| 15    | Add scheduled discovery                    | Local/cloud schedules, checkpoints, idempotency                                                    | Runs are resumable and deduplicated without duplicate notifications                                  | Rate limiting, missed runs            | Source adapters                        | Scheduler/idempotency tests                         | NOT_STARTED |
| 16    | Add notifications                          | Local/email/push option analysis and preferences                                                   | Opt-in notifications contain minimal sensitive data                                                  | Privacy and alert fatigue             | Phase 15                               | Preference and redaction tests                      | NOT_STARTED |
| 17    | Add analytics                              | Conversion, source/template/category/company/location/time metrics                                 | Metrics derive reproducibly from event data                                                          | Small-sample bias                     | Tracking history                       | Query fixtures and metric reconciliation            | NOT_STARTED |
| 18    | Add optional AI providers                  | Provider-neutral interface, redaction, consent, deterministic fallback                             | Base app works without AI; provider use is explicit and auditable                                    | Privacy, cost, hallucination          | Mature truth-safe engines              | Contract, redaction, fallback tests                 | NOT_STARTED |
| 19    | Deploy approved topology                   | Hybrid runner/cloud implementation, migrations, operations                                         | Threat model approved; rollback and recovery tested                                                  | Secrets, availability, migration loss | Prior phases and hosting choice        | Staging, backup/restore, security tests             | NOT_STARTED |
| 20    | Production security hardening              | Pen test, dependency policy, incident response, release gates                                      | Critical findings resolved and operational controls documented                                       | Unknown vulnerabilities               | Deployment candidate                   | SAST/dependency/manual security audits              | NOT_STARTED |

## 25. Current phase status

### Phase 0/1 implementation blueprint

**Current state**

- GitHub CLI authenticated as `adeel1608`.
- Private repository `adeel1608/applypilot` created on 2026-09-05.
- `main` contains only the repository initialization commit.
- Work is on `feat/bootstrap-applypilot`.
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

- All work remains isolated on `feat/bootstrap-applypilot`; `main` stays at its initialization commit.
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
- Opened pull request [#1](https://github.com/adeel1608/applypilot/pull/1) into `main`; it remains unmerged.

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
- GitHub audit: `adeel1608/applypilot` is private, `main` is the default branch, the feature branch is pushed, and PR #1 is open and unmerged.

Phase 0/1 acceptance criteria are complete. No live job-board access, deployment, or application submission occurred.

## 27. Blocked work

No Phase 0/1 work is blocked.

Intentional boundaries remain: source adapters are offline placeholders; persistence is schema/migration foundation rather than dashboard-backed CRUD; deduplication is a contract rather than a fuzzy matcher; only one common resume layout is rendered; cover-letter support is basic and deterministic; job actions are disabled; and all discovery, deployment, notification, analytics, AI-provider, and browser-assisted submission work remains assigned to later phases.

## 28. Next recommended task

Phase 2 is the next recommended task: implement a policy-reviewed SEEK discovery adapter using captured fixtures and contract tests, without live application submission or protection bypass.

Exact recommended prompt (do not execute as part of Phase 0/1):

```text
PROJECT: ApplyPilot
PHASE: 2 - SEEK job discovery adapter

Continue from the merged Phase 0/1 foundation. Follow AGENTS.md and read PROJECT_PLAN.md in full. Inspect the repository and current GitHub state, then update the Phase 2 implementation blueprint in PROJECT_PLAN.md before changing application code. Work on a new feature branch named feat/seek-discovery-adapter.

Implement only the SEEK discovery and job-details phase behind the existing JobSourceAdapter contract. First document a current technical and policy assessment of permitted access, authentication boundaries, robots/rate-limit considerations, and failure/stop conditions. Prefer an official/publicly permitted interface if one is available. Do not bypass CAPTCHA, MFA, bot detection, access controls, authentication protections, rate limits, robots guidance, or website restrictions. Do not implement job application submission, unattended form filling, credential storage, or LinkedIn automation.

Use fictional, redacted, or safely captured fixtures and mocks for deterministic development. Add SEEK source-record validation, discovery pagination/checkpoint contracts, job-detail mapping into the normalized Job schema, raw provenance retention, idempotency, conservative retry/error classification, and explicit capability reporting. Unknown or ambiguous source fields must remain unknown and flow to REVIEW_REQUIRED where material; never invent candidate or job information. Keep the core usable without a paid API.

Add contract, unit, integration, and fixture-replay tests for successful discovery, pagination, job details, malformed records, missing/ambiguous requirements, rate limiting, authentication/security stops, duplicates, and normalization provenance. Update relevant adapter/normalization/security documentation and the dashboard only as needed to display fixture-derived SEEK provenance; do not silently change architecture.

Run format check, lint, strict typecheck, unit tests, integration tests, Playwright tests, production build, and npm audit. Update PROJECT_PLAN.md with exact results, limitations, rollback, blocked items, and the next recommended phase. Push the feature branch and open an unmerged pull request into main. Never claim live SEEK support unless it was actually validated within the documented policy boundaries.
```
