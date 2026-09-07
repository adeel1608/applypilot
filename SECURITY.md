# ApplyPilot Security

## Local-first design

Current GitHub visibility is PUBLIC by explicit owner authorisation on 2026-09-07. Historical private-repository checkpoints do not change the current setting. Private profile, real input, SQLite/WAL/backups, personal documents and sessions remain local/ignored. Keep npm `"private": true` unchanged.

The [V1 threat model](docs/THREAT_MODEL_V1.md) distinguishes existing controls from missing release gates. Current supervised intake is not hosted-production readiness. Known gaps include local-origin/session hardening, all-field semantic claim validation, verified-only fit evidence, explicit audit provenance, preview retention and tested recovery. They must be addressed before their affected V1 capabilities are enabled; no future train is implemented by this review.

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

Authenticated Playwright state, cookies, browser profiles, MFA artifacts, and downloads belong only to the future local runner. They must never enter Git, CI, cloud logs, or a hosted dashboard database. Encrypt sensitive state at rest when persistent browser sessions are introduced.

## Safe job-board automation

Automation must respect applicable terms, access boundaries, and rate limits. CAPTCHA, MFA, bot detection, login challenges, rate limits, access-control responses, site restrictions, or unexpected form changes stop automation and create a human-action event. ApplyPilot must not evade, solve, suppress, or route around these protections.

LinkedIn remains assisted/manual discovery until its policy and technical constraints are explicitly reviewed. The Phase 2 SEEK research gate permits only local fixture discovery and explicit user-supplied-content parsing. Public discovery, public details, URL fetch, and automated browser modes fail closed. See `docs/SEEK_ADAPTER.md`.

User-supplied content is parsed locally and never fetched from a supplied URL in Phase 2.5. Exact/dot-boundary host recognition classifies origin but never authorizes retrieval; the production registry has zero `FETCH_ALLOWED` entries.

Credential rejection is narrow and structure-aware: bearer authorization/cookie headers, recognized credential or browser-session containers, and PEM private keys fail before retention. Ordinary recruiter email addresses, URLs, vacancy IDs, and job prose about APIs, authentication, tokens, cookies, passwords, or security policies are accepted. Raw accepted content is retained only in the ignored local database for provenance/reprocessing; only safe IDs, hashes/counts, enums, timestamps, and stable codes enter audit metadata. There is no automatic cleanup in this phase.

The fixed server-only candidate provider validates `data/profile.private.json` and distinguishes missing from invalid content without logging either. Real imports never fall back to `data/profile.example.json`. Candidate data is not passed to validation, sanitization, source detection, parsing, URL policy, identity, or import staging, and the browser receives only an allowlisted profile-state label.

## Candidate claim safety

Generated content uses only facts marked `VERIFIED`. Missing facts are omitted. Unknown eligibility inputs become `REVIEW_REQUIRED`. Forbidden claims and unsupported experience are negative constraints, not text suggestions. Generated document data carries fact references and is validated before rendering.

## Human confirmation

Final application submission always requires explicit human confirmation. Phase 2 contains no submit method and keeps preparation controls disabled. A future implementation must separate form filling, preview, confirmation, and the final submit action in both code and UI.

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
