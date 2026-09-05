# Fit Scorer

## Purpose

Eligibility answers whether a known hard condition prevents proceeding. Fit scoring helps order review work. A high score never overrides an eligibility blocker.

## Deterministic model

`scoreJobFit(job, profile, eligibility)` starts from a neutral baseline and applies bounded contributions for eligibility, preferred location or commute, preferred employment type, verified skill matches, missing skill evidence, experience evidence, education alignment, training, category preference, customer-service relevance, and technical relevance.

The result contains:

- Integer score clamped to 0-100.
- Positive explanations prefixed with `+`.
- Negative explanations prefixed with `-`.
- Per-category point contributions.
- Engine version.

Weights are transparent constants in source, not learned judgments. They are an initial ordering aid, not a probability of employment success.

## Calibration

Phase 8 will review weights against user-reviewed outcomes and sensitivity tests. Future calibration must avoid optimizing on small samples or protected characteristics. Candidate preferences may influence relevance; sensitive identity characteristics must not influence fit.

## Testing

All fixtures must stay inside 0-100 and have at least one explanation. Tests verify positive location/skill signals, negative blocker signals, and retained explanations. Any weight change requires golden-case review and a `PROJECT_PLAN.md` update.
