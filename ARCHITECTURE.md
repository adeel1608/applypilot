# ApplyPilot Architecture

## Architectural principles

ApplyPilot is local-first, deterministic by default, provenance-aware, and human-controlled. Domain behavior lives outside the web interface. Source adapters are capability-based and cannot imply unsupported automation. Sensitive profiles, documents, and authenticated sessions are local concerns.

## System context

The supported real-data path now covers local import, immutable R2A source evidence, R2B eligibility and verified-only fit, durable duplicate/queue decisions, provenance-valid owner-correction replay, private PDF/DOCX document generation, digest-bound document approval, packet preparation, and durable application tracking. The executable browser runner remains synthetic-test-only; there is no approved real target or submission implementation. The shared server-only root-data resolver makes workspace starts resolve the same ignored root profile/database as validation and migration scripts.

The [Personal Live V1 blueprint](docs/PERSONAL_LIVE_V1.md) remains the forward design baseline: immutable source observations -> typed requirement evidence -> conservative canonical identity -> versioned evaluation -> fact-bound local artifacts/packet -> isolated local runner -> fresh owner final gate -> durable outcome events. The Beta Core implements through local packet/tracking plus a synthetic runner proof. See the [source capability matrix](docs/SOURCE_CAPABILITY_MATRIX.md) and [threat model](docs/THREAT_MODEL_V1.md).

```text
Job source fixture / local user content / future adapter
              |
              v
 bounded raw record + origin/acquisition provenance
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
 verified profile -> private document generation + approval
              |
              v
  packet preparation -> durable local tracking
              |
              v
 synthetic runner proof / future approved real runner
```

## Repository layers

### Presentation

`apps/web` renders local fixture, import, real-job queue/detail, document, packet, application-timeline, and source-status views with Next.js server components. Mutating server actions require an exact loopback Host and matching Origin plus an HttpOnly, SameSite=Strict local session and an expiring, one-use, action-bound nonce. Domain parsing, identity, persistence, eligibility, scoring, and truth rules remain outside presentation code. A fixed-path server-only provider reads the ignored private profile and exposes only safe derived state to the UI.

### Domain

- `candidate-profile`: Zod validation, fact verification states, forbidden claims, and verified-fact selectors.
- `job-model`: normalized job and lifecycle enums.
- `job-importer`: candidate-blind source-neutral validation, inert extraction, source detection, deterministic splitting/parsing, URL policy, and strong identity helpers.
- `job-sources`: common adapter contract, capability flags, offline SEEK supplied-content support, and default-disabled bounded Greenhouse/Lever read clients. A private allowlist must grant an exact source, tenant, host, path, operation, policy expiry, and budget before a network call is possible.
- `job-normalizer`: raw-record and conservative deduplication contracts.
- `eligibility-engine`: hard blockers, ambiguity routing, and stable reason codes.
- `fit-scorer`: bounded weighted contributions with positive/negative explanations.
- `resume-engine`: ten-category template selection, verified evidence ranking, semantic claim validation, ATS HTML, measured Playwright PDF fitting, DOCX rendering, and essential-content extraction/parity.
- `cover-letter-engine`: employer/role-specific verified-evidence generation plus confined PDF/DOCX rendering and parity checks.
- `application-runner`: packet-bound tri-state answers, durable checkpoints, automation stop reasons, frozen review, and expiring one-use consent; executable use is synthetic-only.
- `application-tracker`: validated lifecycle transitions, append-only events, and deterministic timeline projection.
- `shared`: small dependency-free utilities.

### Persistence

`packages/database` is deliberately separate because persistence is shared by the dashboard, future local runner, migrations, tests, and analytics. Drizzle defines an SQLite schema. Raw payload and explanation structures are serialized as JSON text, while query-critical identifiers/statuses remain first-class columns.

The foundation migration is `0000_applypilot_foundation.sql`; Phase 2.5 adds 0001, Beta Core adds 0002, R2A adds immutable 0003, and R2 matching quality adds additive 0004. Migration 0004 contains immutable R2 evaluation, duplicate-decision, queue-freshness, correction-binding, calibration-aggregate, and typed-audit tables. Migrations are explicit, consistently backed up, restored/rehearsed, and integrity/foreign-key checked; the server never auto-migrates a real database. Runtime databases remain ignored.

## Trust boundaries

- Committed fixture boundary: fictional candidate and job data only.
- Local private boundary: real profile and SQLite runtime already used for supervised activation; future generated files, browser state and sessions remain local too. GitHub source visibility is PUBLIC, not runtime-data visibility.
- Source boundary: untrusted fixture or explicitly user-supplied content is validated before normalization. Greenhouse/Lever readers are fail-closed and private-capability gated; the completed Beta Core made zero real source calls.
- Import boundary: raw bytes are bounded and parsed inertly; detected origin is independent from paste/upload acquisition. Canonical job writes require explicit confirmation.
- Candidate runtime boundary: demo profiles can evaluate explicitly labelled fixtures only. Real imports require a validated private local profile after persistence or remain `NOT_EVALUATED`.
- Cloud boundary: no sensitive data crosses it in Phase 0/1. A later hybrid design must classify and encrypt permitted data.
- Human boundary: no real submission path exists. Synthetic final-action tests require a fresh one-use frozen-packet confirmation and prove replay/staleness stops.

## Data provenance

Candidate profile versions are immutable snapshots. Job source records preserve raw source payloads and hashes. Eligibility, scores, and generated documents link to both job and profile version. Application and audit events are append-only representations designed for later analytics and troubleshooting.

## Runtime topology

Manual-intake Beta remains one owned loopback Next.js process plus local SQLite and optional local Chromium for generated PDF rendering. Paste/upload parsing, private-profile evaluation, documents, packets, and tracking are local. Source readers stay disabled without private approval, and the real runner stays target-approval-required. Future deployment needs a separate approved architecture. See `docs/DEPLOYMENT_STRATEGY.md`.

## Deliberate constraints

- No live SEEK adapter mode; `FIXTURE_ONLY` and `USER_SUPPLIED_CONTENT` are the only enabled SEEK modes.
- No required LLM or paid API.
- No final-submit implementation.
- No automatic ambiguous cross-source merge; uncertain duplicate clusters require owner review.
- No client-side private profile loading.
- No enabled production URL fetching; bounded readers require an exact private approved capability.
- No automatic deletion of locally retained raw import provenance.
- No silent fallback from unknown to eligible.

Material changes to these boundaries require a prior `PROJECT_PLAN.md` update.
