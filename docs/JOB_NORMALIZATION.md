# Job Normalization

## Canonical model

`packages/job-model` defines the normalized `Job` schema. It captures identity and provenance; company/title/location; employment flags; salary and hours; schedule; description and responsibilities; required/preferred skills, experience, education, licences, work rights, vehicle and physical requirements; posting/discovery timestamps; source metadata; eligibility/fit outputs; document requirements; and application state.

All adapter output must pass `JobSchema` before reaching evaluation or persistence.

## Source records

A source record preserves the original source, external ID, URL, discovery/fetch timestamps, raw payload, hash, parser version, field provenance, warnings, and captured unknown fields. Normalization creates or updates a canonical job without discarding source evidence. Missing required presentation fields produce a typed safe failure.

## SEEK normalization

The Phase 2 SEEK mapper is deterministic. It supports narrow mappings for employment type, AUD salary ranges, weekly/fortnightly hours, Australian location parts, explicit/relative dates, requirements, experience, qualifications, licences, vehicles, work rights, and training. Unsupported syntax remains `null`, `UNKNOWN`, or an ambiguity with a warning.

Requirement evidence retains original text, normalized text, source path, rule ID, negation, and one of `EXPLICIT_REQUIREMENT`, `PREFERRED_REQUIREMENT`, or `AMBIGUOUS_REQUIREMENT`. In particular, valid Australian work rights never become unrestricted work rights unless the source explicitly says unrestricted; “no experience required” does not become a requirement.

## Deduplication foundation

Phase 2 SEEK persistence uses only the strong `source + externalId` key and payload hash. The same hash is unchanged, a changed hash updates the existing source job, and no fuzzy semantic merge is attempted. Broader cross-source deduplication remains a future reviewed phase.

This conservative shape prevents an early fuzzy matcher from silently merging distinct vacancies. Phase 6 will calibrate matching with multi-source fixtures and precision/recall review.

## Unknown fields

Null, `UNKNOWN`, and empty arrays have distinct meanings. Normalizers must not fabricate precision. Material unknown work-right or vehicle requirements are routed to eligibility review. Raw source text remains available for future re-normalization as parsers improve.
