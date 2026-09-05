# ApplyPilot

ApplyPilot is a local-first job discovery, matching, document-preparation, assisted-application, and outcome-tracking platform. It is designed to improve application quality without inventing candidate facts or giving automation control over final submission.

## Current status

Phase 0/1 foundation is complete on `feat/bootstrap-applypilot` and is awaiting human review in pull request #1. The repository provides typed domain contracts, a fictional candidate truth store, fifteen normalized fixture jobs, deterministic eligibility and fit engines, SQLite/Drizzle schema, document-engine foundations, and a local Next.js dashboard.

There are no live job-board connections, deployments, or application-submission capabilities in this phase. LinkedIn is explicitly assisted/manual only.

## Why ApplyPilot exists

Job searches are fragmented across sources, repeated applications are time-consuming, and generic generation tools can overstate a candidate's background. ApplyPilot creates a traceable path from source data to an eligibility decision, explainable score, fact-bound documents, human review, and later outcome tracking.

## Architecture

ApplyPilot uses npm workspaces:

- `apps/web` contains the Next.js App Router dashboard.
- `packages/candidate-profile` owns the verified candidate schema and forbidden-claim rules.
- `packages/job-model`, `job-sources`, and `job-normalizer` own normalized vacancies, source boundaries, provenance, and future deduplication.
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
npm run dev
```

Open `http://localhost:3000`. Only the fictional `data/profile.example.json` is rendered. To prepare for later private local development, copy that shape to `data/profile.private.json`; the private file is ignored and is not yet loaded by the web application.

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

The 21-phase roadmap is maintained in [PROJECT_PLAN.md](PROJECT_PLAN.md). Phase 0/1 establishes the safe foundation. The next planned phase is a policy-reviewed SEEK discovery adapter using fixtures and contract tests; it must not perform live applications or bypass site protections.

## Screenshots

Screenshots will be added after the foundation UI is accepted. The current dashboard is available locally at `/dashboard`.

## Contributing

Every material change is plan-first and must update `PROJECT_PLAN.md` before coding and after validation. Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Use feature branches, keep commits focused, and do not automatically merge pull requests.

## Licence

No open-source licence has been selected. All rights are reserved until the owner chooses one.
