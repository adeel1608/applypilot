# Job Source Adapters

## Common contract

Every source implements `JobSourceAdapter` from `packages/job-sources`:

```ts
interface JobSourceAdapter {
  sourceName: JobSource;
  capabilities(): readonly AdapterCapability[];
  discoverJobs(query: DiscoveryQuery): Promise<DiscoveryPage>;
  fetchJob(externalId: string): Promise<DiscoveredJobRecord>;
  normalizeJob(record: DiscoveredJobRecord): Promise<Job>;
}
```

Capabilities are `DISCOVERY`, `JOB_DETAILS`, `ASSISTED_APPLICATION`, `FORM_FILLING`, `APPLICATION_STATUS`, and `MANUAL_ONLY`. A capability is returned only when it works in the adapter's configured mode.

## Phase 2 SEEK adapter

SEEK supports two explicit, network-free paths:

- `FIXTURE_ONLY` reports `DISCOVERY` and `JOB_DETAILS` and replays injected fictional records.
- `USER_SUPPLIED_CONTENT` parses content the user deliberately supplies and normalizes it locally. It does not report discovery and never fetches a URL.

`PUBLIC_DISCOVERY`, `PUBLIC_JOB_DETAILS`, `USER_SUPPLIED_URL`, and `ASSISTED_BROWSER` are disabled and fail with a typed `ACCESS_DENIED`. There is no `public-client.ts`. The evidence and re-review triggers are in [SEEK_ADAPTER.md](SEEK_ADAPTER.md).

Indeed, LinkedIn, Employment Hero, Workday, Greenhouse, Lever, and generic company sites remain offline placeholders. Calling their target operations throws `AdapterNotImplementedError`.

LinkedIn exposes `MANUAL_ONLY` and `ASSISTED_APPLICATION`; it does not expose form filling or discovery. This remains unchanged until a documented policy/technical review.

The SEEK query contract supports keywords, structured Australian location/radius, employment type, date window, stable sorting, page size, and an opaque query-bound cursor. Checkpoints are Zod-validated, expire after 24 hours by default, and advance only within the successful page persistence transaction.

## Adapter implementation checklist

- Update the phase blueprint before implementation.
- Review applicable source terms, robots guidance, authentication boundaries, and allowed use.
- Capture fictional/redacted fixtures without committing credentials or personal data.
- Validate raw records before normalization.
- Retain source URL, external ID, timestamps, raw payload hash, and provenance.
- Implement throttling, idempotency, error classification, and observability without sensitive logs.
- Stop on CAPTCHA, MFA, bot detection, rate limits, access controls, or restrictions.
- Pass the common adapter contract suite and source-specific fixture replay.
- Never imply final submission support without an independently reviewed confirmation gate.
