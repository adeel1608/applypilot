# ApplyPilot

ApplyPilot is a local-first job discovery, matching, document-preparation, assisted-application, and outcome-tracking platform. It is designed to improve application quality without inventing candidate facts or giving automation control over final submission.

## Current status

Phase 0/1, Phase 2, and Phase 2.5 are merged. Phase 2.5 provides a review-gated real-world intake workflow: bounded local paste/upload parsing, inert HTML handling, preview/edit/skip, explicit confirmation, strong identity, SQLite provenance, and a server-only private-profile evaluation gate. Phase 2.5A local activation and one-vacancy smoke testing is awaiting blueprint review; no real private profile or vacancy is committed.

There are no live job-board connections, deployments, or application-submission capabilities. SEEK public discovery, public job details, URL fetching, and browser automation are disabled after technical/policy review. LinkedIn remains assisted/manual only.

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
npm run dev
```

Open `http://localhost:3000`. Use `/import` for local paste/upload intake. The first migration command previews the path; the confirmed command backs up an existing ignored database, applies the Phase 2.5 migration, and verifies integrity. The app does not auto-migrate at startup.

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

The generated PDF is a local ignored artifact under `output/pdf/`.

## Security model

- Candidate claims must have verified truth-store provenance.
- Unknown or ambiguous eligibility inputs require review.
- Private profiles, databases, generated documents, browser state, credentials, and identity material are ignored by Git.
- Future authenticated browser automation belongs in a local runner.
- CAPTCHA, MFA, access controls, rate limits, bot detection, and website restrictions are stop conditions.
- Final submission always requires explicit human confirmation.

Read [SECURITY.md](SECURITY.md) before handling any real candidate data.

## Development roadmap

The roadmap is maintained in [PROJECT_PLAN.md](PROJECT_PLAN.md). Phase 2.5 makes local real-world intake useful without enabling live source access. Phase 2.5A will validate one private local profile and one user-supplied vacancy only after its planning PR receives human approval.

## Screenshots

Screenshots will be added after the foundation UI is accepted. The current dashboard is available locally at `/dashboard`.

## Contributing

Every material change is plan-first and must update `PROJECT_PLAN.md` before coding and after validation. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Use feature branches, keep commits focused, and do not automatically merge pull requests.

## Licence

No open-source licence has been selected. All rights are reserved until the owner chooses one.
