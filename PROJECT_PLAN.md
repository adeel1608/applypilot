# ApplyPilot Project Plan

Last updated: 2026-09-05  
Owner: `adeel1608`  
Repository: `adeel1608/applypilot`  
Working branch: `feat/seek-discovery-adapter`

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
- GitHub audit: `adeel1608/applypilot` is private, `main` is the default branch, the feature branch is pushed, and PR #1 is open and unmerged.

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

# Phase 2 — SEEK Discovery Adapter Blueprint

- Blueprint status: `AWAITING_HUMAN_REVIEW`
- Phase roadmap status: `NOT_STARTED`
- Prepared on: 2026-09-05
- Implementation branch: `feat/seek-discovery-adapter`

This section is an implementation design only. Preparing it did not access SEEK, fetch a live job page, write browser automation, change submission behaviour, or implement Phase 2 source code.

## A. Current state

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

- Keep all Phase 2 work on `feat/seek-discovery-adapter` and leave its PR unmerged until review and gates pass.
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

Stop after this blueprint is committed, pushed, and opened as an unmerged documentation-only PR. Do not implement Phase 2, access SEEK, fetch public/live source content, write browser automation, change submission behaviour, or merge the Phase 2 PR until the owner approves the blueprint and issues the implementation task.

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
- Phase 2 branch: `feat/seek-discovery-adapter`, created from the merged baseline and pushed.

Unfinished work is the entire Phase 2 implementation described above. It is deliberately not started. No implementation blocker is declared at this planning checkpoint; approval and the access-method research decision are required gates, not assumed outcomes.
