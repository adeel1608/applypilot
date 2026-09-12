# ApplyPilot Security

## Local-first design

Current GitHub visibility is PUBLIC by explicit owner authorisation on 2026-09-07. Historical private-repository checkpoints do not change the current setting. Private profile, real input, SQLite/WAL/backups, personal documents and sessions remain local/ignored. Keep npm `"private": true` unchanged.

The [V1 threat model](docs/THREAT_MODEL_V1.md) distinguishes implemented controls from activation authority. Offline enablement now adds immutable source/target capability versions, exact HTTPS host/path/query operations, public-address DNS validation with connection pinning, bounded source requests/pages/records/bytes/time/retries/redirects, fictional Lever parsing, frozen runner bindings, one-use consent, protection stops, and terminal unknown-outcome recovery. Lever additionally requires exactly one `mode=json`, canonical bounded `skip`/`limit`, and zero redirects. Official list/description HTML is parser-converted to inert text with active elements discarded; only immutable raw observation storage retains the original bounded payload and it is never rendered. It does not activate a source, establish hosted-production, or approve a real target.

Production source transport classifies only a closed set of stable Node network error codes plus trusted local socket lifecycle state. DNS failure, unavailable route, refused/reset connection, TLS handshake failure, request timeout, and residual unknown outcome are safe diagnostic labels; raw exception messages, DNS addresses, certificates, headers, and response content are not persisted. These labels never authorize a retry. The deepest closed lifecycle stage may be retained in strict redacted audit metadata and displayed for owner recovery, but it contains no network value. All resolved addresses must remain public, the request stays pinned to one validated address, and the actual response socket address must match that pin while TLS SNI and hostname verification remain bound to the approved host. The custom Node lookup sets the pin's explicit family and honors both single-address and `all=true` callback shapes with only that same address, so family autoselection cannot add a fallback connection.

ApplyPilot treats candidate profiles, personal documents, application answers, user-supplied job content, and authenticated browser sessions as sensitive. The preferred design keeps these artifacts on the user's computer. Phase 2 commits only fictional source fixtures and makes no live job-board requests.

## Personal-data isolation

- Commit only `data/profile.example.json` and keep it fictional.
- Store real structured data in `data/profile.private.json` or a future encrypted local store.
- Store local databases and generated documents only in ignored paths.
- Do not put private candidate data into screenshots, issue reports, test snapshots, logs, analytics, or CI artifacts.
- Referee contact details are private even when other candidate fields are shareable.

The `.gitignore` covers environment files, credentials, databases and journals, browser profiles, cookies, storage state, downloads, generated application documents, identity/visa/tax/bank material, and private referee files. Ignore rules are defense in depth, not authorization to place secrets in the repository.

## Secret handling

- Use local environment files or an approved secret manager; never hard-code keys or tokens.
- Never print tokens, cookies, complete private profiles, or full application answers.
- Scope credentials to the minimum required service and rotate suspected exposures immediately.
- Do not store job-board passwords in application settings or SQLite.

## Browser-session handling

Authenticated Playwright state, cookies, browser profiles, MFA artifacts, and downloads belong only to a future approved local runner. The current executable runner uses fictional loopback fixtures only and persists no browser authentication. Such state must never enter Git, CI, cloud logs, or a hosted dashboard database. Encrypt sensitive state at rest if persistent browser sessions are introduced.

## Safe job-board automation

Automation must respect applicable terms, access boundaries, and rate limits. CAPTCHA, MFA, bot detection, login challenges, rate limits, access-control responses, site restrictions, or unexpected form changes stop automation and create a human-action event. ApplyPilot must not evade, solve, suppress, or route around these protections.

LinkedIn remains assisted/manual discovery. The SEEK gate permits only local fixture discovery and explicit user-supplied-content parsing. Default-disabled Greenhouse and Lever GET readers require a narrowly scoped, ignored owner-approved capability and never receive candidate data. No private capability was configured and the completed Beta Core made zero real source calls. See `docs/SOURCE_CAPABILITY_MATRIX.md`.

User-supplied content is parsed locally and never fetched from a supplied URL in Phase 2.5. Exact/dot-boundary host recognition classifies origin but never authorizes retrieval; the production registry has zero `FETCH_ALLOWED` entries.

Credential rejection is narrow and structure-aware: bearer authorization/cookie headers, recognized credential or browser-session containers, and PEM private keys fail before retention. Ordinary recruiter email addresses, URLs, vacancy IDs, and job prose about APIs, authentication, tokens, cookies, passwords, or security policies are accepted. Raw accepted content is retained only in the ignored local database for provenance/reprocessing; only safe IDs, hashes/counts, enums, timestamps, and stable codes enter audit metadata. There is no automatic cleanup in this phase.

The fixed server-only candidate provider validates `data/profile.private.json` and distinguishes missing from invalid content without logging either. Real imports never fall back to `data/profile.example.json`. Candidate data is not passed to validation, sanitization, source detection, parsing, URL policy, identity, or import staging, and the browser receives only an allowlisted profile-state label.

## Candidate claim safety

Generated content uses only facts marked `VERIFIED`. Missing facts are omitted. Unknown eligibility inputs become `REVIEW_REQUIRED`. Forbidden claims and unsupported experience are negative constraints, not text suggestions. Generated document data carries fact references and is validated before rendering.

## Human confirmation

Final application submission always requires explicit human confirmation. The target-independent framework has no configured real adapter or target. Synthetic tests separate mapping, frozen review, consent, and one final action; changed packets/forms/domains/adapters/documents/disclosures, stale or replayed consent, CAPTCHA, MFA, authentication, bot detection, access denial, rate limits, unsupported controls, and lost responses all stop safely. A lost or ambiguous response becomes terminal `OUTCOME_UNKNOWN` and is never blindly retried.

## GitHub expectations

- The owner deliberately authorised the PUBLIC source repository; keep all candidate/runtime data excluded and audit every publication. Do not change visibility or other settings without new authority.
- Require pull requests and passing CI before merge when branch protection is configured.
- Review dependency alerts and workflow permission changes.
- Pin action major versions and grant workflows only required permissions.
- Never upload sensitive local artifacts as CI artifacts.

## Deployment security

No deployment is approved in Phase 0/1. Before deployment, complete data classification, threat modeling, encryption design, authentication/authorization, audit retention, backup/restore, incident response, dependency policy, and local-runner pairing review. The cloud component must not receive browser credentials or personal documents by default.

## Reporting a vulnerability

Do not open a public issue containing sensitive details. Contact the repository owner privately with the affected component, reproduction steps, impact, and suggested mitigation. Do not include real candidate data or credentials in the report.
