# Real-World Job Intake

Phase 2.5 adds a local, source-neutral way to import job advertisements without accessing a job board. The implementation accepts pasted text, pasted multi-job text, inert pasted HTML, and UTF-8 `.txt`, `.md`, `.html`, `.htm`, or `.json` files. It also exposes a URL policy check, but the production registry contains zero fetch-enabled sources.

## Local setup

Create or upgrade the ignored local database explicitly while the application is stopped:

```bash
npm run db:migrate
npm run db:migrate -- --confirm
```

The first command previews the resolved path. The confirmed command checks database integrity, creates a timestamped backup when a database already exists, applies pending checked-in migrations, and runs integrity and foreign-key checks. The web application never migrates an existing database during startup.

Run the setup commands from the repository root. The web application resolves that same root `data` directory when started through the npm web workspace, so `data/profile.private.json` and `data/applypilot.local.sqlite` do not move when the working directory is `apps/web`. Workspace-local `apps/web/data` files are not used. An unrecognized repository root fails closed; no data directory or database is created implicitly. The existing filename override remains limited to a SQLite basename within root `data`.

Start the application and open `/import`. A preview is staged locally, but canonical jobs are not created until the user selects records and presses **Import selected**. Inferred splits require a separate acknowledgement. Changed content with an existing strong identity requires explicit update confirmation. Preview tokens expire after 30 minutes and cannot be replayed after confirmation.

## Pipeline and trust boundaries

```text
user content
  -> bounded UTF-8/MIME/credential validation
  -> inert HTML or data-only JSON parsing
  -> evidence-based detected origin
  -> deterministic split and field extraction
  -> local preview/edit/skip
  -> explicit confirmation
  -> strong identity and SQLite persistence
  -> server-only candidate profile resolution
  -> eligibility/fit only with PRIVATE_LOCAL_PROFILE
  -> jobs/dashboard
```

The importer never receives a candidate profile. `detectedSource` says where evidence indicates the job originated; `acquisitionMethod` independently says whether the bytes were pasted or uploaded. Pasted SEEK content is therefore `SEEK` plus `USER_SUPPLIED_CONTENT`, never adapter-fetched.

HTML is parsed as an inert tree. Scripts, styles, forms, inputs, frames, embeds, media, SVG/MathML, active attributes, and remote resources are neither executed nor loaded. Only visible text, HTTPS link strings, and data-only schema.org JSON-LD are considered. JSON prototype-pollution keys and excessive nesting are rejected.

Credential detection is intentionally narrow. Structured bearer authorization headers, cookie headers, recognized credential/session JSON containers, and PEM private keys are rejected before retention. Ordinary recruiter emails, public URLs, vacancy IDs, and prose about APIs, authentication, tokens, cookies, passwords, or security policies remain valid job content.

## URL policy

- SEEK: `USER_CONTENT_REQUIRED`
- Indeed, Greenhouse, Lever, Employment Hero, Workday, generic sites, and unknown sites: `REVIEW_REQUIRED`
- invalid, non-HTTPS, credential-bearing, IP-literal, and local/private targets: `UNSUPPORTED`
- production `FETCH_ALLOWED` entries: **0**

Host recognition uses reviewed exact hosts or explicit dot-boundary subdomains. A source guess never authorizes retrieval. There is no HTTP content provider, crawler, browser automation, DNS lookup, redirect handling, or live job-board request in this phase.

## Candidate profiles

`data/profile.example.json` is fictional and demo-only. Real imported jobs can be evaluated only when the server-only provider loads and validates `data/profile.private.json` with `CandidateProfileSchema`. Missing or invalid files leave the imported job available with nullable eligibility and fit fields and no result rows. The demo profile is never a fallback for a real import.

The UI receives only the profile state label. It does not receive profile fields, validation input, file paths, hashes, or referee contacts. The private file is ignored by Git and must not be uploaded to CI or an external service.

## Identity and retention

Identity is deterministic and ordered: external ID, canonical HTTPS URL, exact segment content hash, then a versioned local fingerprint built only when title, company, location, and description are explicit. The database stores the identity kind and value and enforces their relationship to explicit source evidence. It does not manufacture external IDs, URLs, or fetched timestamps.

Accepted raw content, extracted fields, edits, and provenance remain in the ignored local SQLite database. There is no automatic destructive cleanup. Export, per-record/batch delete, and purge controls require a later reviewed design. Until then, retain backups with the same local/private protections as the database.

## Limits

- 1 MiB raw input or file
- 2,048-character URL
- 100 candidate jobs per batch
- 128 KiB extracted text per candidate
- 25,000 text lines
- 256 JSON and HTML nesting levels
- 255-character basename-only filename

PDF/OCR, Office files, archives, images, executables, unknown MIME types, document generation, application preparation, and submission are out of scope.
