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

Capabilities are `DISCOVERY`, `JOB_DETAILS`, `ASSISTED_APPLICATION`, `FORM_FILLING`, `APPLICATION_STATUS`, and `MANUAL_ONLY`. A capability is a declared design target, not proof that Phase 0/1 performs it.

## Phase 0/1 adapters

Offline placeholders exist for SEEK, Indeed, LinkedIn, Employment Hero, Workday, Greenhouse, Lever, and generic company sites. Calling live discovery, details, or normalization throws `AdapterNotImplementedError`. Tests verify this explicit failure.

LinkedIn exposes `MANUAL_ONLY` and `ASSISTED_APPLICATION`; it does not expose form filling or discovery. This remains unchanged until a documented policy/technical review.

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
