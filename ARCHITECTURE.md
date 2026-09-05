# ApplyPilot Architecture

## Architectural principles

ApplyPilot is local-first, deterministic by default, provenance-aware, and human-controlled. Domain behavior lives outside the web interface. Source adapters are capability-based and cannot imply unsupported automation. Sensitive profiles, documents, and authenticated sessions are local concerns.

## System context

```text
Job source fixture / future adapter
              |
              v
   raw source record + provenance
              |
              v
       normalized Job schema
              |
       +------+------+
       |             |
       v             v
 eligibility      fit scoring
       |             |
       +------+------+
              v
      human review dashboard
              |
              v
 verified profile -> document preparation
              |
              v
  application preparation -> human confirmation
              |
              v
 future assisted submission + tracking events
```

## Repository layers

### Presentation

`apps/web` renders local fixture views with Next.js server components. It composes the original normalized fixtures with normalized synthetic SEEK fixtures and displays safe source/run provenance. It does not implement eligibility, scoring, source parsing, or truth rules.

### Domain

- `candidate-profile`: Zod validation, fact verification states, forbidden claims, and verified-fact selectors.
- `job-model`: normalized job and lifecycle enums.
- `job-sources`: common adapter contract, capability flags, offline placeholders, and the Phase 2 SEEK fixture/user-content implementation. SEEK source data, queries, cursors, checkpoints, errors, provenance, dates, and requirements are Zod-validated or deterministically classified here.
- `job-normalizer`: raw-record and conservative deduplication contracts.
- `eligibility-engine`: hard blockers, ambiguity routing, and stable reason codes.
- `fit-scorer`: bounded weighted contributions with positive/negative explanations.
- `resume-engine`: template selection, provenance-bound document model, ATS HTML, and Playwright PDF rendering.
- `cover-letter-engine`: employer/role-specific deterministic foundation.
- `application-runner`: preparation contract, tri-state answers, automation stop reasons, and immutable review gate.
- `application-tracker`: lifecycle transition rules and event model.
- `shared`: small dependency-free utilities.

### Persistence

`packages/database` is deliberately separate because persistence is shared by the dashboard, future local runner, migrations, tests, and analytics. Drizzle defines an SQLite schema. Raw payload and explanation structures are serialized as JSON text, while query-critical identifiers/statuses remain first-class columns.

The initial migration is `packages/database/drizzle/0000_applypilot_foundation.sql`. Phase 2 reuses it without a new migration: strong `source + externalId` identity and raw hashes drive transactional add/update/duplicate outcomes, while namespaced `settings` JSON holds validated checkpoints. Runtime databases are ignored.

## Trust boundaries

- Committed fixture boundary: fictional candidate and job data only.
- Local private boundary: future real profile, SQLite database, generated files, browser state, and sessions.
- Source boundary: untrusted fixture or explicitly user-supplied content is validated before normalization. Phase 2 performs no SEEK network access.
- Cloud boundary: no sensitive data crosses it in Phase 0/1. A later hybrid design must classify and encrypt permitted data.
- Human boundary: final submission cannot proceed without explicit confirmation.

## Data provenance

Candidate profile versions are immutable snapshots. Job source records preserve raw source payloads and hashes. Eligibility, scores, and generated documents link to both job and profile version. Application and audit events are append-only representations designed for later analytics and troubleshooting.

## Runtime topology

Phase 2 remains one local Next.js process plus optional local SQLite and Chromium processes. SEEK fixture discovery and pasted-content parsing are local and network-free. Future deployment prefers a cloud dashboard/backend for non-sensitive coordination and a local runner for any separately approved authenticated browser control and personal documents. See `docs/DEPLOYMENT_STRATEGY.md`.

## Deliberate constraints

- No live SEEK adapter mode; `FIXTURE_ONLY` and `USER_SUPPLIED_CONTENT` are the only enabled SEEK modes.
- No required LLM or paid API.
- No final-submit implementation.
- No semantic deduplication yet.
- No client-side private profile loading.
- No silent fallback from unknown to eligible.

Material changes to these boundaries require a prior `PROJECT_PLAN.md` update.
