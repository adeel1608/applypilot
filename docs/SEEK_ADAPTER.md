# SEEK Discovery Adapter

- Review date: 2026-09-05
- Review status: `COMPLETE_FOR_PHASE_2`
- Reviewer: ApplyPilot implementation review

## Scope and decision rule

This is an engineering access decision for Phase 2 discovery and job-detail ingestion. It does not approve form filling, application status access, submission, credential storage, protection bypass, or unattended authenticated browsing.

Technical accessibility is not approval. A network-backed mode is enabled only when a documented interface permits this use, any required approval has been obtained, its authentication boundary is compatible with ApplyPilot, and its contract has been validated. No such network mode is approved for Phase 2.

## Access decision summary

| Mode                    | Decision      | Runtime state | Phase 2 basis                                                               |
| ----------------------- | ------------- | ------------- | --------------------------------------------------------------------------- |
| `FIXTURE_ONLY`          | `ALLOWED`     | Enabled       | Local fictional/redacted data; no network                                   |
| `USER_SUPPLIED_CONTENT` | `ALLOWED`     | Enabled       | Local parsing of content deliberately supplied by the user; no fetch        |
| `PUBLIC_DISCOVERY`      | `NOT_ALLOWED` | Disabled      | No approved public API; automated website access is prohibited by the terms |
| `PUBLIC_JOB_DETAILS`    | `NOT_ALLOWED` | Disabled      | No approved public API; automated website access is prohibited by the terms |
| `USER_SUPPLIED_URL`     | `NOT_ALLOWED` | Disabled      | Fetching the URL would still be automated website access                    |
| `ASSISTED_BROWSER`      | `NOT_ALLOWED` | Disabled      | Automated browser collection is not approved; manual copy remains human use |

The official partner API is `CONDITIONAL` as an integration path, not enabled: it requires SEEK approval and OAuth credentials, and no documented candidate-facing public discovery scope was established. A future written approval and verified API scope would require a new plan and security review.

## Primary evidence

- [SEEK API overview](https://developer.seek.com/) — says API access requires SEEK approval and describes hirer-oriented integrations.
- [SEEK integration process](https://developer.seek.com/introduction) — requires an integration request, Developer Dashboard credentials, Playground testing, live-credential approval, and SEEK release coordination. Its test-hirer ads do not appear in search results.
- [SEEK authentication](https://developer.seek.com/auth) — requires OAuth 2.0 partner tokens; browser tokens are derived from partner credentials and scoped to an authorised hirer.
- [SEEK GraphQL documentation](https://developer.seek.com/graphql) — production objects are normally restricted to a hirer or partner; only a version query is documented as unauthenticated.
- [SEEK API Terms of Use](https://au.employer.seek.com/partners/terms-of-use) — last updated 14 April 2026; integration requires consent and compliance with the API and applicable advertising terms.
- [SEEK Website Terms and Conditions](https://au.seek.com/terms/en) — the services are designed for individual human use and automated access, querying, searching, copying, collecting, mining, or harvesting is prohibited unless SEEK provides a specific interface and its terms are followed. The terms also describe rate-limiting, traffic shaping, and device fingerprinting as protective measures that must not be circumvented.
- [Schema.org JobPosting](https://schema.org/JobPosting) — defines a general structured job vocabulary, but does not establish that SEEK exposes it or grant permission to retrieve SEEK pages.

The public `robots.txt` URL could not be reliably retrieved by the research tooling on 2026-09-05. Robots guidance therefore remains `UNKNOWN` and is not treated as permission. The website terms independently provide a clear, more restrictive automation boundary.

## Research assessment in required order

### 1. Official or documented public interface

Decision: `CONDITIONAL`, disabled.

- Evidence: SEEK Developer overview, integration process, authentication, GraphQL documentation, and API terms linked above.
- Authentication: required for meaningful operations. OAuth client credentials create partner tokens; authorised hirer relationships constrain production access.
- Data completeness: the API models positions and related hirer objects, but the reviewed documentation did not establish an approved candidate-facing search of public job listings for ApplyPilot.
- Pagination: GraphQL connection conventions exist, but no permitted public discovery operation was established, so no pagination contract is assumed.
- Stability: versioned, documented, and supported for approved partners, but under continuous development and release coordination.
- Rate limits: no anonymous/public discovery quota was documented. Approved integrations must follow SEEK guidance and operational controls.
- Robots: not applicable to the API; API terms and partner approval govern access.
- Terms/policy: approval is mandatory; production access and permitted purposes depend on SEEK consent and configured relationships.
- Restrictions/protection: requests require scoped tokens. ApplyPilot has no approved credentials and will not request, store, or simulate them.
- Maintenance risk: moderate for an approved integration; unacceptable without an approved use case and credentials.
- Automation suitability: potentially suitable only after a separate SEEK integration approval and scope review. Not suitable for this phase.

### 2. Public listing pages

Decision: `NOT_ALLOWED` for automated access.

- Evidence: SEEK Website Terms and Conditions, especially the fair-use and automated-process provisions linked above.
- Authentication: pages may be human-viewable without authentication, but public visibility does not authorise automated retrieval.
- Data completeness: not evaluated by fetching listings because the access decision failed first.
- Pagination/stability: not evaluated; page markup is not an approved interface and may change without notice.
- Rate limits: SEEK states it may use rate-limiting, traffic shaping, and device fingerprinting to prevent automated access and scraping.
- Robots: unavailable to this review and therefore `UNKNOWN`; it would not override the terms.
- Terms/policy: automated access, query, search, copy, collection, mining, and harvesting are prohibited except through a specific provided interface used according to its terms.
- Restrictions/protection: any access denial, interstitial, challenge, or rate limit is a mandatory stop.
- Maintenance risk: high.
- Automation suitability: not suitable; no HTTP/page client will be created.

### 3. Server-rendered structured data

Decision: `NOT_ALLOWED` for automated retrieval.

- Evidence: no SEEK page was fetched. Structured data embedded in a page remains information accessed through the website.
- Authentication/data completeness/pagination: unknown and deliberately not probed.
- Stability: undocumented and therefore high risk.
- Rate limits/robots/terms/restrictions: identical to public listing pages.
- Protection behaviour: not probed; any observed protection would stop the mode.
- Automation suitability: not suitable without written approval or a documented interface.

### 4. JSON-LD / schema.org `JobPosting`

Decision: `NOT_ALLOWED` for automated retrieval; schema support remains `UNKNOWN`.

- Evidence: Schema.org documents a standard `JobPosting` vocabulary. No SEEK-specific availability was assumed or tested.
- Authentication/data completeness/pagination: unknown; JSON-LD, if present, may omit fields and is not a discovery interface.
- Stability: the standard is stable enough for a generic parser, but SEEK-specific markup would be undocumented.
- Rate limits/robots/terms/restrictions: retrieval would still access public pages and inherits the same prohibition.
- Maintenance risk: medium for generic user-supplied content; high for a SEEK page client.
- Automation suitability: acceptable only as a validated input shape inside `USER_SUPPLIED_CONTENT`, never as authority to fetch SEEK pages.

### 5. Network responses used by public pages

Decision: `NOT_ALLOWED`.

- Evidence: no browser-network response was inspected or replayed. The website terms already disallow automated access outside a provided interface.
- Authentication: unknown; responses may carry session-bound identifiers or tokens, which ApplyPilot forbids collecting.
- Data completeness/pagination/stability: unknown and intentionally not probed.
- Rate limits/robots/terms/restrictions: inherits the website prohibition and protection controls.
- Protection behaviour: replaying or routing around page controls is prohibited.
- Maintenance risk: very high because undocumented endpoints and contracts can change without notice.
- Automation suitability: not suitable; no hidden/public-page network client will be created.

### 6. Legitimate assisted local-browser discovery

Decision: `NOT_ALLOWED` for automation in Phase 2.

- Evidence: website terms permit a candidate limited personal human use, including viewing and downloading a single copy, while prohibiting automated processes outside a provided interface.
- Authentication: human browsing may involve a personal account; ApplyPilot must not receive or persist its credentials, cookies, or state.
- Data completeness/pagination/stability: irrelevant because automated extraction is disabled.
- Rate limits/robots/terms/restrictions: human use does not convert an automated browser into an approved interface.
- Protection behaviour: CAPTCHA, MFA, login, bot protection, access denial, and interstitials are mandatory stops.
- Maintenance risk: high and policy-sensitive.
- Automation suitability: not suitable. A user may manually copy content they are entitled to view and pass that content to the local parser.

### 7. User-supplied URL or content

Decision: URL `NOT_ALLOWED`; content `ALLOWED`.

- Evidence: a supplied URL still requires ApplyPilot to perform network access, so it inherits the public-page decision. Parsing already supplied content performs no SEEK request.
- Authentication: prohibited for the parser. Inputs containing credentials, cookies, authorization headers, or browser state are rejected by policy and must not be logged.
- Data completeness: depends on the supplied content. Missing fields remain unknown; required-field absence returns a typed normalization failure.
- Pagination: local content may contain a validated page envelope and opaque cursor; the fixture/content client never follows a network link.
- Stability: schema-versioned local inputs fail safely when unsupported.
- Rate limits/robots: not applicable to local parsing.
- Terms/policy: the user is responsible for supplying content they are entitled to use. ApplyPilot stores it locally and does not republish it.
- Restrictions/protection: no fallback from a URL to an automated fetch; no browser/session import.
- Maintenance risk: low for the versioned local contract.
- Automation suitability: suitable for deterministic local parsing and fixture replay.

## Enabled Phase 2 capabilities

The SEEK adapter reports `DISCOVERY` and `JOB_DETAILS` only in `FIXTURE_ONLY`. `USER_SUPPLIED_CONTENT` exposes explicit local parse/normalize entry points and does not pretend to discover or fetch URLs. All network-backed mode construction fails closed with a typed access error.

The adapter never reports or implements `ASSISTED_APPLICATION`, `FORM_FILLING`, `APPLICATION_STATUS`, `MANUAL_ONLY`, or submission support.

## Mandatory stops and handling

- `RATE_LIMITED`: stop the run and retain only a safe retry timestamp.
- `AUTH_REQUIRED`, `CAPTCHA_DETECTED`, `BOT_PROTECTION`, and `ACCESS_DENIED`: stop without retry, fallback, or alternate route.
- `PAGE_CHANGED` and `UNSUPPORTED_PAGE`: stop parsing that input; do not guess.
- Never store a password, cookie, token, authorization header, browser profile, storage state, or authenticated response.
- Never use proxy rotation, stealth/fingerprint manipulation, challenge solving, hidden-token replay, or undocumented endpoints.
- CI uses fixtures and mocks and makes no SEEK request.

## Re-review triggers

Re-review and an amended plan are required if SEEK grants written integration approval, documents a candidate job-discovery API, changes its website/API terms, publishes relevant robots guidance, changes authentication requirements, or if a future phase proposes any URL/browser/network mode.
