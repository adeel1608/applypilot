# Job Normalization

## Canonical model

`packages/job-model` defines the normalized `Job` schema. It captures identity and provenance; company/title/location; employment flags; salary and hours; schedule; description and responsibilities; required/preferred skills, experience, education, licences, work rights, vehicle and physical requirements; posting/discovery timestamps; source metadata; eligibility/fit outputs; document requirements; and application state.

All adapter output must pass `JobSchema` before reaching evaluation or persistence.

## Source records

A source record preserves the original source, external ID, URL, discovery/fetch timestamps, raw payload, and hash. Normalization creates or updates a canonical job without discarding source evidence. Multiple source records may link to one job after a reviewed deduplication decision.

## Deduplication foundation

Phase 0/1 defines signals and candidates, not a production matcher. Planned signals are canonical URL, source/external ID, normalized company, normalized title, normalized location, posting date, and a future description fingerprint. A possible duplicate carries confidence, matching signals, and `requiresHumanReview: true`.

This conservative shape prevents an early fuzzy matcher from silently merging distinct vacancies. Phase 6 will calibrate matching with multi-source fixtures and precision/recall review.

## Unknown fields

Null, `UNKNOWN`, and empty arrays have distinct meanings. Normalizers must not fabricate precision. Material unknown work-right or vehicle requirements are routed to eligibility review. Raw source text remains available for future re-normalization as parsers improve.
