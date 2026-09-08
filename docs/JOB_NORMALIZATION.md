# Job Normalization

Status: the merged Beta model is operational for owner-reviewed manual intake; the R2 evidence upgrade is planned, not implemented. See [R2 matching quality plan](R2_MATCHING_QUALITY_PLAN.md).

## Canonical model

`packages/job-model` defines the normalized `Job` schema. It captures identity and provenance; company/title/location; employment flags; salary and hours; schedule; description and responsibilities; required/preferred skills, experience, education, licences, work rights, vehicle and physical requirements; posting/discovery timestamps; source metadata; eligibility/fit outputs; document requirements; and application state.

All adapter output must pass `JobSchema` before reaching evaluation or persistence.

## Source records

A source record preserves detected origin separately from acquisition method, nullable explicit external ID/URL/fetch time, raw payload hash, canonical identity kind/value, parser version, field provenance, warnings, and captured unknown fields. Normalization creates or updates a canonical job without discarding source evidence. Missing required presentation fields produce a typed review state or safe failure; placeholders are never manufactured.

## Current deterministic normalization

The SEEK and manual-intake mappers support narrow deterministic mappings for employment type, AUD salary ranges, weekly/fortnightly hours, Australian location parts, explicit/relative dates, requirements, experience, qualifications, licences, vehicles, work rights, and training. Unsupported syntax remains `null`, `UNKNOWN`, or an ambiguity with a warning.

Requirement evidence retains original text, normalized text, source path/span, rule ID, negation, and modality. Valid Australian work rights never become unrestricted work rights unless the source explicitly says unrestricted; “no experience required” does not become a requirement.

The current Beta extractor already supports immutable evidence spans, requirement modality, full Australian state-name aliases, explicit-period salary extraction, tri-state document evidence, and narrow typed requirements. It remains incomplete for ordinary unpunctuated headings, multi/conflicting/remote location structure, schedule/hours, typed licence/education/experience/skill alternatives, broader work-right conditions, and source-structured salary/workplace fields. Whole-record employment token scanning can also misclassify unrelated prose.

R2A introduces `SOURCE_STATED | OWNER_CORRECTED | DERIVED | UNKNOWN | CONDITIONAL | CONFLICTING` field states, independently preserves `REQUIRED | PREFERRED | CONDITIONAL | NEGATED | UNKNOWN` modality, and carries those states through database, evaluation, fit, and UI. A mentioned salary can have period `UNKNOWN`; document requirements use `REQUIRED | NOT_REQUIRED | UNKNOWN`; empty arrays never prove absence or completeness. Detailed field shapes, precedence, migration, and regressions are normative in the R2 plan.

## Deduplication foundation

Phase 2.5 evaluates identity in order: explicit source/external ID, canonical HTTPS URL, exact segment content hash, then a versioned local fingerprint when title, company, location, and description are all explicit. The database records the selected identity kind/value and validates its evidence. Same identity plus same hash is unchanged; changed content requires explicit update confirmation; conflicting strong signals do not auto-merge. No fuzzy semantic merge is attempted.

The merged cross-source helper already suggests review only for strong corroborated signals and keeps title-only/tenant-collision cases separate. R2C connects it to durable `SUGGESTED | LINKED | REJECTED | SPLIT` decisions while preserving every source observation. Similarity never auto-merges an ambiguous vacancy.

## Unknown fields

Null, `UNKNOWN`, and empty arrays have distinct meanings. Normalizers must not fabricate precision. Material unknown work-right, vehicle, schedule, licence, document, or requirement evidence routes to eligibility or preparation review. Raw source text remains local and available for future re-normalization as parsers improve.
