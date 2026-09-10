# ApplyPilot

ApplyPilot is a local-first job discovery, matching, document-preparation, assisted-application, and outcome-tracking platform. It is designed to improve application quality without inventing candidate facts or giving automation control over final submission.

## Current status

Phase 0/1, Phase 2, Phase 2.5, Phase 2.5A, and the Personal Live Beta Core are merged on `main`. PR #10 was human-reviewed at exact head `b7872fe5791f1baa88d9e95e2b7096926ea44813` and merged as `4a0462d24b9a8db79ec49ff64242405d8f96f40d`. **Manual-intake Personal Beta is ready** for local owner use: bounded paste/upload intake, immutable evidence and evaluation versions, conservative matching, corrections, private PDF/DOCX CV and optional cover-letter generation, digest-bound approvals, packet preparation, and durable application tracking are connected through the default UI. Unknown evidence remains unknown, fit is explainable rather than predictive, and the owner must review every generated artifact. No real private profile, vacancy, database, or generated document is committed.

GitHub repository `adeel1608/applypilot` is PUBLIC by explicit owner authorisation. Candidate/runtime data remains LOCAL and ignored. npm `"private": true` remains unchanged to prevent accidental package publication.

R2A 3.1.0 is merged. R2B eligibility and verified-only scoring, R2C durable duplicate/queue/correction handling, and the R2D executable fictional plus content-qualified private calibration framework are hardened on `feat/r2-matching-quality` pending final review in unmerged PR #13. The ignored local database is schema v6 with preserved history, clean integrity/FKs, and zero qualification rows; calibration truthfully remains `UNCALIBRATED`, and counts alone cannot promote it. This adds no source tenant, real runner, employer-form, upload, submission, or deployment authority.

The [Personal Live V1 blueprint](docs/PERSONAL_LIVE_V1.md) defines R0–R11, [go-live gates](docs/GO_LIVE_CHECKLIST.md), [source strategy](docs/SOURCE_CAPABILITY_MATRIX.md), [threat model](docs/THREAT_MODEL_V1.md), and [local runbook](docs/RELEASE_RUNBOOK.md). The Beta Core implements the manual local path and synthetic safety proofs. Source-enabled Beta remains waiting for an owner-approved private tenant and scoped read-only smoke. Personal Live V1 and hosted production are not ready.

There are no enabled live job-board connections, deployments, real-target browser adapters, or application-submission capabilities. Source-enabled Personal Beta remains `WAITING_FOR_APPROVED_TENANT`; Personal Live V1 remains `NOT_READY`; the real runner remains `TARGET_APPROVAL_REQUIRED`. Default-disabled, bounded Greenhouse and Lever GET readers cannot call a tenant without an ignored owner-approved capability. The next documentation gate plans [R2 matching quality](docs/R2_MATCHING_QUALITY_PLAN.md) and a separate [R1 source-enabled Beta](docs/R1_SOURCE_ENABLED_BETA_PLAN.md). SEEK network modes remain disabled after technical/policy review, and LinkedIn remains assisted/manual only.

## Why ApplyPilot exists

Job searches are fragmented across sources, repeated applications are time-consuming, and generic generation tools can overstate a candidate's background. ApplyPilot creates a traceable path from source data to an eligibility decision, explainable score, fact-bound documents, human review, and later outcome tracking.

## Architecture

ApplyPilot uses npm workspaces:

- `apps/web` contains the Next.js App Router dashboard.
- `packages/candidate-profile` owns the verified candidate schema and forbidden-claim rules.
- `packages/job-model`, `job-sources`, `job-importer`, and `job-normalizer` own normalized vacancies, source boundaries, source-neutral local intake, provenance, and deterministic source identity. The SEEK implementation and Phase 2.5 importer never perform a network request.
- `packages/eligibility-engine` and `fit-scorer` provide pure deterministic decisions.
- `packages/resume-engine` and `cover-letter-engine` build documents from verified facts.
- `packages/application-runner` and `application-tracker` keep preparation, confirmation, and lifecycle state explicit.
- `packages/database` owns SQLite/Drizzle tables and migrations.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [PROJECT_PLAN.md](PROJECT_PLAN.md) for the complete blueprint.

## Local setup

Requirements: Node.js 24 or newer, npm, and Git. The browser test and PDF demonstration also require Playwright Chromium.

```bash
npm install
npx playwright install chromium
npm run db:migrate
npm run db:migrate -- --confirm
npm run dev --workspace @applypilot/web -- --hostname 127.0.0.1
```

Open `http://localhost:3000`. Use `/import` for local paste/upload intake, `/jobs` for the real queue and document workflow, `/applications` for packet/application tracking, and `/sources` for safe capability status. The first migration command previews the path; the confirmed command creates and verifies a consistent ignored backup, applies pending additive migrations, and verifies integrity and foreign keys. The app does not auto-migrate at startup.

Only the fictional `data/profile.example.json` is committed and rendered as demo content. A local `data/profile.private.json` with the same schema is Git-ignored, loaded only on the server, and required to evaluate real imported jobs. Without a valid private profile, imports remain usable but explicitly not evaluated.

The schema-accurate, fictional setup reference for the later local activation checkpoint is [docs/PRIVATE_PROFILE_SETUP.md](docs/PRIVATE_PROFILE_SETUP.md). Do not add real candidate values to Git.

On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd` and `npx.cmd`.

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

Generate the fictional ATS-friendly resume demonstration with:

```bash
npm run generate:example-resume
```

The generated PDF is a local ignored artifact under `data/private/generated/`.

## Security model

- Candidate claims must have verified truth-store provenance.
- Unknown or ambiguous eligibility inputs require review.
- Private profiles, databases, generated documents, browser state, credentials, and identity material are ignored by Git.
- Real authenticated browser automation remains disabled and would belong in a separately approved local runner.
- CAPTCHA, MFA, access controls, rate limits, bot detection, and website restrictions are stop conditions.
- Final submission always requires explicit human confirmation.

Read [SECURITY.md](SECURITY.md) before handling any real candidate data.

## Development roadmap

The roadmap is maintained in [PROJECT_PLAN.md](PROJECT_PLAN.md). Phase 2.5 makes local real-world intake useful without enabling live source access. Phase 2.5A is validating one private local profile and one user-supplied vacancy under the approved local-only execution plan.

## Screenshots

Screenshots will be added after the foundation UI is accepted. The current dashboard is available locally at `/dashboard`.

## Contributing

Every material change is plan-first and must update `PROJECT_PLAN.md` before coding and after validation. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Use feature branches, keep commits focused, and do not automatically merge pull requests.

## Licence

No open-source licence has been selected. All rights are reserved until the owner chooses one.
