# ApplyPilot Architecture

## Architectural principles

ApplyPilot is local-first, deterministic by default, provenance-aware, and human-controlled. Domain behavior lives outside the web interface. Source adapters are capability-based and cannot imply unsupported automation. Sensitive profiles, documents, and authenticated sessions are local concerns.

## System context

The supported real-data path now covers local import, immutable R2A source evidence, R2B eligibility and verified-only fit, durable duplicate/queue decisions, provenance-valid owner-correction replay, private PDF/DOCX document generation, digest-bound document approval, packet preparation, and durable application tracking. Owner-reviewed bounded Lever request #9 proved source-to-R2 persistence for 25 accepted records and established Source-enabled Personal Beta readiness; its capability is revoked and that decision grants no further request. The target layer has two machine-separated lanes: a dedicated real-target `OPEN_AND_INSPECT_ONLY` runner with no mutation API, and the target-independent application runner with packet/disclosure/one-use-submit gates. No real employer page has been opened and no real target capability is active.

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
 operation-scoped target authority
       |                    |
       v                    v
 read-only inspection    application runner
 (no mutation API)       (separate future approval)
```

## Repository layers

### Presentation

`apps/web` renders local fixture, import, real-job queue/detail, document, packet, application-timeline, and source-status views with Next.js server components. Mutating server actions require an exact loopback Host and matching Origin plus an HttpOnly, SameSite=Strict local session and an expiring, one-use, action-bound nonce. Domain parsing, identity, persistence, eligibility, scoring, and truth rules remain outside presentation code. A fixed-path server-only provider reads the ignored private profile and exposes only safe derived state to the UI.

`apps/showcase` is a separate presentation and deployment boundary. It is a static Next.js export built only from committed fictional demo data and framework assets. It imports no domain package or local application module, exposes no route handler or server action, and has no filesystem, database, environment, candidate-profile, source, target, or network access. The public audit verifies its source graph and emitted `out` directory before deployment. It must never be used as a deployment entry point for `apps/web`.

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
- `application-runner`: schema-v2 operation-scoped target capabilities; a dedicated passive Lever inspection adapter with no mutation API; packet-bound tri-state answers; immutable inspection/application bindings; durable checkpoints/recovery; protection stops; frozen review; and expiring one-use submission consent. Real inspection still requires exact owner authority, and real fill/upload/submit remain disabled.
- `application-tracker`: validated lifecycle transitions, append-only events, and deterministic timeline projection.
- `shared`: small dependency-free utilities.

### Persistence

`packages/database` is deliberately separate because persistence is shared by the dashboard, future local runner, migrations, tests, and analytics. Drizzle defines an SQLite schema. Raw payload and explanation structures are serialized as JSON text, while query-critical identifiers/statuses remain first-class columns.

The foundation migration is `0000_applypilot_foundation.sql`; Phase 2.5 adds 0001, Beta Core adds 0002, R2A adds immutable 0003, and R2 matching quality adds immutable 0004. Transactional migration 0005 hardens the R2 evaluation identity; additive 0006 records content-derived calibration qualification. Additive 0007 records immutable source/target capabilities, bounded source pages/checkpoints/raw snapshots, frozen application-runner bindings, and safe recovery decisions. Additive 0008 adds immutable target operation scope and the separate read-only inspection lifecycle without changing 0000–0007. Duplicate comparison reconstructs each observation from its immutable bound job version. Queue PREPARING binds current job/profile/evaluation/evidence/coverage/duplicate versions, and packet persistence requires that exact current decision. Migrations are explicit, consistently backed up, restored/rehearsed, and integrity/foreign-key checked; the server never auto-migrates a real database. Runtime databases remain ignored.

## Trust boundaries

- Committed fixture boundary: fictional candidate and job data only.
- Local private boundary: real profile and SQLite runtime already used for supervised activation; future generated files, browser state and sessions remain local too. GitHub source visibility is PUBLIC, not runtime-data visibility.
- Source boundary: untrusted fixture or explicitly user-supplied content is validated before normalization. Greenhouse/Lever readers are fail-closed and private-capability gated. The approved request #9 evidence is limited to its one revoked capability and does not authorise another call.
- Import boundary: raw bytes are bounded and parsed inertly; detected origin is independent from paste/upload acquisition. Canonical job writes require explicit confirmation.
- Candidate runtime boundary: demo profiles can evaluate explicitly labelled fixtures only. Real imports require a validated private local profile after persistence or remain `NOT_EVALUATED`.
- Cloud boundary: no sensitive data crosses it in Phase 0/1. A later hybrid design must classify and encrypt permitted data.
- Employer boundary: passive real-target inspection and application mutation use separate operation-scoped capabilities and runner APIs. Inspection transmits no candidate data and exposes no fill/upload/submit method. Authentication and protection boundaries stop.
- Human boundary: no real submission path is enabled. Synthetic final-action tests require a fresh one-use frozen-packet confirmation and prove replay/staleness stops.

## Data provenance

Candidate profile versions are immutable snapshots. Job source records preserve raw source payloads and hashes. Eligibility, scores, and generated documents link to both job and profile version. Application and audit events are append-only representations designed for later analytics and troubleshooting.

## Runtime topology

The personal releases remain one owned loopback Next.js process plus local SQLite and optional isolated local Chromium. Paste/upload parsing, private-profile evaluation, documents, packets, and tracking are local. A source request or employer inspection requires a fresh exact private capability and owner-start action; no scheduler or automatic continuation exists. Real application mutation stays disabled. Future deployment needs a separate approved architecture. See `docs/DEPLOYMENT_STRATEGY.md`.

The public showcase has a different topology: immutable static HTML, CSS, JavaScript, and images served by a commodity static host. It has no relationship to the local SQLite process and cannot activate a product capability. Only `apps/showcase/out` may cross that hosting boundary.

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
