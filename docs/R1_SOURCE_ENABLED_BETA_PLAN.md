# R1 source-enabled Personal Beta implementation blueprint

Status: `PLAN_ONLY_WAITING_FOR_APPROVED_TENANT`

Reviewed evidence date: 2026-09-08

Current authority: documentation research and fictional transport tests only. No real source request or tenant activation is authorised.

## Scope and non-goals

R1 adds one narrowly approved, candidate-blind, read-only public-posting tenant to the Manual-intake Personal Beta. It does not enumerate employers, scrape career pages, use browser/session state, fetch an application form, send candidate data, upload a document, call an application endpoint, schedule discovery, or submit anything. Greenhouse and Lever readers remain disabled until a separate owner decision supplies and approves one exact tenant capability.

Success means one owner-started, bounded GET-only discovery run for one approved tenant can create immutable local observations, normalize them through R2 evidence contracts, stop safely, and be disabled without deleting history. It does not make Personal Live V1 ready; the real application runner remains `TARGET_APPROVAL_REQUIRED`.

## Current official evidence

This comparison uses vendor-controlled documentation, not live job endpoints:

| Property                      | Greenhouse Job Board API                                                                                                                                                                    | Lever Postings API                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intended public read surface  | Published jobs and public job-board data; GET endpoints need no authentication.                                                                                                             | Published postings on one site; official docs describe public postings and a careers-site use case.                                                  |
| List/detail                   | `GET /v1/boards/{board_token}/jobs` and `/jobs/{job_id}`; `content=true` includes description.                                                                                              | `GET /v0/postings/{SITE}?skip=X&limit=Y&mode=json` and `/v0/postings/{SITE}/{POSTING-ID}`.                                                           |
| Bounding                      | List response is all jobs; the page documents no list pagination or numeric GET quota. ApplyPilot must stop if its response/record cap is exceeded.                                         | Explicit `skip`/`limit` pagination permits a small first page and a deterministic local record ceiling; no numeric GET quota is documented.          |
| Useful normalization evidence | ID, requisition ID, title, update time, location, URL, HTML-encoded content; detail can expose pay transparency and application questions, but questions are outside first discovery scope. | ID, title, plaintext description, structured categories/all locations, country, workplace type, salary range, hosted/apply URLs.                     |
| Write boundary                | Application submission is POST on the job path and requires Basic Auth. R1 forbids POST and credentials.                                                                                    | Application submission is POST on the same postings family and requires an API key. R1 forbids POST and credentials.                                 |
| Policy uncertainty            | Vendor documents public GET use, but employer-specific context/restrictions and an undocumented numeric GET ceiling still require review.                                                   | Vendor documents published/public postings, but employer-specific context/restrictions and an undocumented numeric GET ceiling still require review. |
| Implementation/usefulness     | Simple one-response reader; HTML-like content and no list pagination reduce first-smoke bounding and structured evidence.                                                                   | Moderate paged reader; plaintext plus location/workplace/salary fields improves R2 provenance and small-run usefulness.                              |
| Primary source                | [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) and [Greenhouse API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview) | [Lever Postings API](https://github.com/lever/postings-api/blob/master/README.md)                                                                    |

The existence of a public GET interface is technical evidence, not blanket permission for every employer or use. Before activation the owner must review the vendor documentation, the chosen employer's public-board context and applicable restrictions, and record a dated approval reference. Robots rules are checked if an employer-controlled path is ever involved, but robots alone neither grants permission nor overrides vendor/employer terms. Any unclear authority keeps the capability disabled.

## Source-family recommendation

Recommend **Lever Postings API for the first one-tenant R1 smoke**, subject to owner selection and policy approval. Its official JSON list supports `skip`/`limit`, returns plaintext description plus structured location/workplace/salary fields, and separates published postings from hidden ones. That lets the first smoke request one small page and exercises the R2 structured-evidence model without fetching detail pages.

Greenhouse remains the supported second candidate, not rejected. Its unauthenticated Job Board GET is well documented and simple, but the list is not documented as paginated; `content=true` can return every post and HTML-like content. It is therefore less tightly bounded for a first unknown-size tenant. This recommendation is not activation and makes no claim about which family has better Australian coverage.

## Exact capability contract

The ignored local capability file is the authority presented to runtime. The durable database stores its safe operational projection and approval linkage, not secrets. Proposed `SourceCapabilityV2` fields are exact and closed to extras:

- `schemaVersion`: literal `2`.
- `capabilityId`: owner-generated opaque local ID; never inferred from a tenant.
- `source`: `LEVER` or `GREENHOUSE`.
- `alias`: bounded owner display label; no candidate data.
- `tenant`: exact owner-supplied Lever site or Greenhouse board token; regex/length constrained, no enumeration.
- `region`: Lever `GLOBAL` or `EU`; Greenhouse `GLOBAL`.
- `allowedHost`: exact official ASCII hostname derived from source/region: `api.lever.co`, `api.eu.lever.co`, or `boards-api.greenhouse.io`.
- `allowedPathPrefix`: exact segment-bound tenant root: Lever `/v0/postings/{tenant}`; Greenhouse `/v1/boards/{tenant}/`. Sibling prefixes fail.
- `allowedOperations`: non-empty subset of `LIST_JOBS` and `GET_JOB`; first smoke is exactly `LIST_JOBS`. These map only to HTTP GET.
- `approvalState`: `DRAFT`, `APPROVED`, `REVOKED`, or `EXPIRED`; only current `APPROVED` is executable.
- `approvalReference`: bounded opaque owner decision/change ID; no free-form policy text, token, URL credentials, or candidate data.
- `approvedAt`: ISO timestamp required for approved state.
- `policyVersion`, `policyReviewedAt`, `policyExpiresAt`: exact evidence version and independent policy review/expiry timestamps.
- `capabilityExpiresAt`: timestamp independently ending runtime authority; the earliest policy/capability expiry wins.
- `requestBudget`: total HTTP attempts including redirects/retries/pages; first smoke `1`, hard schema maximum `30`.
- `recordCap`: total parsed postings; first smoke `25`, hard maximum `500`.
- `pageSizeCap`: per-page requested/accepted records; first smoke `25`, hard maximum `100`.
- `responseByteLimit`: decoded bytes per response; first smoke at most `2,000,000`, hard maximum `5,000,000`.
- `requestTimeoutMs`: DNS/connect/headers/body deadline, at most `30,000`; `runTimeoutMs`: bounded whole-run deadline greater than the request timeout.
- `maxRedirects`: first smoke `0`, later maximum `3` only after same-capability review; `maxRetries`: first smoke `0`, later at most `2` idempotent GET retries inside the same budget.
- `maxConcurrency`: literal `1` per tenant for Personal Beta.
- `parserVersion`: exact parser version persisted with observations.
- `createdAt` and `updatedAt`: ISO local configuration timestamps.

Runtime readiness is owner-facing `WAITING_FOR_APPROVED_TENANT | SOURCE_DISABLED | SOURCE_ENABLED`; the current internal `SOURCE_READY_AWAITING_TENANT` may remain as a compatibility code but must not be presented as an enabled/readied source.

Approval workflow:

1. Owner names one tenant and source/region; code never guesses or searches for it.
2. A documentation-only policy review records official API surface, employer context, restrictions, requested operations/budgets, review/expiry, and residual risk.
3. Owner explicitly approves the exact capability record. Any field change creates a new version and returns the old version to disabled/superseded.
4. A preflight validates file ownership/path/no symlink, strict schema, exact host/path, both expiries, approval reference, operation, parser compatibility, and zero candidate/private fields.
5. Runtime presents a one-run summary and requires a fresh local owner action. No scheduler/startup fetch exists.
6. Revocation, expiry, policy change, 401/403/429, unexpected redirect, schema drift, or security stop disables the capability. Resume requires another owner action and, where material, a new approval.

The owner review screen/record must show these labels before the first GET, with values sourced from the exact immutable capability version:

```text
SOURCE:
TENANT:
ALIAS:
REGION:
HOST:
PATH PREFIX:
OPERATIONS:
REQUEST BUDGET:
RECORD CAP:
PAGE / BYTE / TIME LIMITS:
POLICY REVIEW:
POLICY EXPIRES:
CAPABILITY EXPIRES:
APPROVAL REFERENCE:
OWNER APPROVED:
```

Approving a family never fills `TENANT` and never authorises all tenants. A missing field, changed value, or family-only approval cannot pass preflight.

## Network and tenant threat design

### Request construction and SSRF/DNS rebinding

- Adapters construct URLs from typed source/tenant/operation fields; callers cannot supply an arbitrary URL. Parse once with WHATWG `URL`, require HTTPS, port 443/empty, no username/password/fragment, exact lowercase ASCII host, exact tenant path-segment boundary, and an allowlist of expected query keys/values.
- Resolve every A/AAAA answer before connection and reject the entire set if any address is loopback, private, link-local, carrier-grade NAT, multicast, documentation/reserved, unspecified, or other non-public destination, including IPv4-mapped IPv6.
- The current pre-resolution followed by ordinary `fetch` has a DNS time-of-check/time-of-use gap. R1A must use a connection transport that pins one validated public answer for that request while retaining TLS verification/SNI for the original hostname, or the capability stays disabled. Re-resolve and revalidate for every new connection/redirect.
- Redirects are manual. First smoke denies all redirects. A later capability may allow only bounded redirects whose scheme, host, port, path tenant boundary, query, and pinned destination pass the same checks. Cross-host and credential-bearing redirects always stop.
- Returned `sourceUrl`/`applicationUrl` values are inert data. Never dereference them during discovery or normalization and never treat them as an approved request destination.

### Bounds, retries, cancellation, and crash recovery

- The request budget counts initial requests, redirects, retries, details, and pages. Byte caps apply to decoded streamed bytes even when `Content-Length` is missing or compressed. Require an allowed JSON content type and UTF-8/JSON parse within schema/depth/string/array bounds.
- One abort signal covers DNS/connection, headers, and complete body consumption. A separate run deadline and owner cancellation signal stop the active body read and mark the run `STOPPED`, never silently complete it later.
- First smoke has no automatic retry. Later, only idempotent GET may retry a bounded transient network/5xx failure with capped exponential backoff and jitter while capability/run deadlines and request budgets remain current. Never retry 400/401/403/404/409/429, policy/security/schema/size failures, or an unknown response outcome automatically. `Retry-After` is recorded as a safe bounded delay suggestion, not automatic authority.
- Lever cursor/offset progress stores every requested page key and rejects repeats, reversals, gaps outside policy, or a page that exceeds caps. Greenhouse is one list response and fails closed if record/byte caps are exceeded; it does not fetch details to work around the cap.
- Persist `RUNNING` before network access and checkpoint request/page counts transactionally with observation writes. Crash leaves `PARTIAL/UNKNOWN`; there is no startup resume. Owner-requested resume revalidates current capability/policy and uses idempotency keys so accepted observations are not duplicated.

### Tenant isolation, logging, and storage

- Tenant identity is `(source, region, tenant)` throughout capability, run, page, observation, uniqueness, and audit records. IDs never match across tenants by themselves.
- Candidate profile, preferences, evaluation text, documents, answers, cookies, browser state, auth headers, referrer, and private paths are absent from request construction. Fetch uses GET, `credentials: omit`, no referrer, JSON accept header, and no source/apply API key.
- Raw response snapshots are untrusted private local data: bounded, hashed, immutable, never rendered as HTML, never logged, and never committed. Normalization receives parsed Zod data and treats all prose as inert.
- Audit/log schemas allow only capability/run IDs, source enum, safe tenant alias (not arbitrary URL), operation, versions, counts, timestamps, state, and stable error/stop codes. No response body, full URL/query, headers, DNS answers, tenant secret-like value, candidate content, or free-form exception string.
- Persistent capability projections must match the active private file version exactly. A source/tenant mismatch, multiple active versions, or stale policy/capability expiry stops before DNS.

## Stop, throttle, and revocation rules

Stop immediately and perform no further request on:

- missing/revoked/expired/malformed capability or changed approval/policy evidence;
- unapproved operation, host/path/query/region/tenant, redirect, DNS result, port, or credential-bearing URL;
- 400/401/403/404/409/429; CAPTCHA/bot/access interstitial; unexpected HTML/content type; malformed/schema-drift/oversized response;
- request/run timeout, cancellation, request/record/page/byte/concurrency limit, cursor loop, inconsistent identity, or persistence failure;
- any indication candidate data, cookies, auth material, application operation, or employer form would be involved.

For 429, preserve the safe run checkpoint, set capability state `SOURCE_DISABLED_RATE_LIMITED`, record only a stable code and optional bounded retry time, and require policy/owner review before a later run. No proxy rotation, identity change, account use, stealth, header spoofing, budget increase, or rapid retry. For 401/403 or access-control evidence, disable and require new documented authority rather than adding credentials. Revocation blocks new runs immediately; an active run checks capability version before each request and cancels if it changed.

## First controlled one-tenant smoke

This is a future human-gated R1C operation, not authorised by approval of this plan.

Prerequisites:

- R2A evidence model merged and the R1A network/persistence gates green at an exact reviewed head;
- owner supplies one Lever site + region and a dated policy/employer-context review, then explicitly approves capability `LIST_JOBS` only;
- ignored private allowlist passes privacy/tracking checks; no source/apply credential exists;
- local database is backed up and current, the owned app is stopped if required, and an observation rollback/disable procedure is rehearsed;
- owner sees expected endpoint family, one-request/25-record/2 MB limits, zero redirects/retries, candidate-blind outbound contract, and stop rules.

Procedure:

1. Run read-only doctor, database status, privacy preflight, and confirm the real runner is disabled.
2. Display and verify the exact immutable capability/approval record above; refuse family-only authority.
3. Snapshot safe run/capability counters and confirm only that capability becomes `SOURCE_ENABLED` for this owner action.
4. Owner starts exactly one Lever list GET with `mode=json`, `skip=0`, `limit=25`; no detail request follows.
5. Stop network activity immediately after the single response; redirects/retries/details are all zero.
6. Validate content type, decoded byte count, JSON schema, tenant identity, and record count `0..25` before canonical writes.
7. Persist the bounded private run/page/source observations transactionally; never open hosted/apply URLs.
8. Normalize through current R2 evidence rules, preserving field states/spans and material unknowns.
9. Run conservative duplicate comparison; ambiguous candidates remain `SUGGESTED` and are not linked automatically.
10. Evaluate locally against the current private profile only after discovery has ended; no profile fact enters the request or raw source record.
11. Confirm outbound method/header/body telemetry shows one GET, no Authorization/Cookie header, `credentials=omit`, zero candidate fields, and no browser navigation.
12. Repeat normalization/dedup/evaluation from the stored response offline to prove idempotency without another source request.
13. Run database row-count mapping, integrity and foreign-key checks, then repository/history/build/private-canary audit.
14. Run the applicable format/lint/typecheck/unit/integration/build/E2E/dependency gates without regenerating real documents or packets.
15. Disable the capability after the smoke by default and present only safe aggregate evidence for human review. Continued use, polling, another operation, or another tenant needs a separate owner decision.

PASS requires exactly one approved GET; request budget `1`; `0..25` valid records; all source observations retained under the exact tenant; deterministic offline replay; current R2 unknown/conflict behavior; database integrity PASS and zero FK issues; privacy/quality gates PASS; candidate outbound fields, redirects, retries, details, form visits, uploads, submissions, and other application actions all `0`. The run is not PASS merely because it returned HTTP 200.

FAIL is any deviation from the capability, counts, method/headers, schema, provenance, dedup/evaluation, persistence, integrity, privacy, or quality contract. On FAIL, stop, preserve private evidence, disable the capability, report only safe codes/counts, and require review before any repeat.

Any unexpected tenant, record count, redirect, schema/content type, private canary, duplicate ambiguity, policy/access response, or database failure stops the smoke. Preserve evidence privately, disable the capability, do not “try another tenant”, and do not delete observations or repeat until reviewed.

## Implementation slices

### R1A — capability and network enforcement (no tenant activation)

- Dependencies: approved plan; R2A contract available or an adapter DTO that cannot bypass it.
- Expected files: `packages/job-sources/src/public-postings.ts`, `private-allowlist.ts`, source tests, `packages/database/src/schema.ts`, `beta-repository.ts`, the next additive migration if not already owned by R2, `apps/web/app/sources/page.tsx`, workspace/preflight services, and synthetic security docs/tests.
- Schema/data: `SourceCapabilityV2`, immutable capability versions, safe run checkpoints, expiry/revocation, exact parser/policy bindings.
- Tests: URL/path/query/host/region, all blocked IP families, DNS rebinding/pinned connection, redirect chain, full-body timeout/cancel, compressed/streaming size, content type/schema depth, retry budgets, concurrency, expiry/revocation, log allowlists, candidate-data canaries.
- Privacy/rollback: injected transports and fictional tenants only; capability remains absent/disabled. Revert code or disable V2 while retaining safe history.
- Human gate: network design, migration, error policy, and exact schema approval.
- Acceptance: no arbitrary destination/method/credential path; fail-closed exact tests; zero real source calls.

### R1B — one selected family integration (still no real call)

- Dependencies: R1A and R2A; recommendation is Lever.
- Expected files: `packages/job-sources/src/lever/reader.ts` and tests, exports, `packages/database/src/job-discovery-repository.ts`, R2 normalization mapping/evidence repositories, fictional Lever API fixtures, source review UI, and source docs.
- Schema/data: typed Lever categories/allLocations/country/workplace/salary evidence; immutable raw observation digest; page/idempotency links.
- Tests: list/detail fixture contracts but runtime capability for first release remains LIST-only; page ending/cursor loop/record cap, malformed fields, changed/repeated observations, cross-tenant identity, inert hosted/apply URLs, crash replay.
- Privacy/rollback: no network in automated tests; disable the adapter/capability while observations remain readable.
- Human gate: source mapping and fictional output review; re-check current official documentation.
- Acceptance: deterministic candidate-blind normalization, provenance for every field, no form visit/write path, full gates green.

### R1C — one owner-approved tenant smoke and release decision

- Dependencies: R1A/R1B merged and reviewed, R2A merged, exact capability approval, current backups/privacy gates, adequate recovery window.
- Expected files: normally no application-code change; safe project/source/go-live evidence only after the run. Private capability/data never enters Git.
- Data: one private run and observations under the approved caps; no candidate values leave the machine.
- Tests: the smoke procedure above plus database integrity/FKs, offline idempotent replay, private audit, local source disable/revoke, exact-head CI if documentation changes.
- Privacy/rollback: disable capability; restore only from verified backup if persistence fails; do not delete source history to hide a failure.
- Human gate: explicit pre-smoke authority and a separate post-smoke source-enabled Beta release decision.
- Acceptance: all smoke counts/bounds/stop rules pass, public report contains only safe aggregate evidence, and source-enabled Beta remains disabled unless separately released.

## Remaining boundaries

- R1 does not own cross-source link decisions beyond generating R2C suggestions.
- R1 does not own scheduling (R7), application preparation (R4), browser filling (R5), or final submission.
- The PR #10 carryover to re-resolve the current private profile before packet preparation belongs to R4/R11 hardening.
- The cosmetic `Â·` separator in the `apps/web/app/jobs/[id]/page.tsx` document-link block belongs to R8 UI hardening.
- Personal Live V1 remains `NOT_READY` and the real runner remains `TARGET_APPROVAL_REQUIRED` after a source-enabled Beta release.
