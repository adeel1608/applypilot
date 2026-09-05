# Contributing to ApplyPilot

## Required workflow

1. Read `AGENTS.md` and `PROJECT_PLAN.md` completely.
2. Inspect the repository, current branch, Git status, and related code.
3. Update the relevant implementation blueprint in `PROJECT_PLAN.md` before application-code changes.
4. Work on a focused feature branch; do not develop directly on `main`.
5. Keep source boundaries and safety invariants explicit.
6. Add or update fixtures and tests with the implementation.
7. Run formatting, lint, typecheck, unit, integration, E2E, and build checks as applicable.
8. Record actual validation and unfinished work in `PROJECT_PLAN.md`.
9. Open a pull request and obtain human review. Do not automatically merge it.

## Commit guidance

Use small conventional commits such as:

```text
chore: bootstrap ApplyPilot workspace
docs: add project architecture and roadmap
feat: add candidate truth store
feat: add normalized job model
test: add eligibility and scoring fixtures
ci: add quality checks
```

Never rewrite or discard another contributor's work without agreement.

## Code standards

- Use strict TypeScript and validate external data with Zod.
- Keep pure domain logic out of React components.
- Provide stable reason codes for decisions and user-readable explanations.
- Treat unknown as unknown; never convert absence to a positive claim.
- Put source-specific behavior behind `JobSourceAdapter`.
- Use Australian English in user-facing copy.
- Keep the base product functional without paid APIs.

## Test expectations

Bug fixes need regression tests. Eligibility and truth-store changes need positive, negative, and ambiguous cases. Adapter changes require contract tests and captured fictional/redacted fixtures. Document changes require content provenance checks, PDF structural checks, and visual review.

## Sensitive data

Never commit real personal profiles, CVs, cover letters, referee contacts, identity documents, credentials, cookies, browser storage, or databases. Stop and notify the owner if sensitive data appears in Git history.
