# Fit Scorer

Status: the merged deterministic score is an uncalibrated owner-review aid. The verified-only R2 contract is planned in [R2 matching quality plan](R2_MATCHING_QUALITY_PLAN.md).

## Purpose

Eligibility answers whether a known hard condition prevents proceeding. Fit scoring helps order review work. A high score never overrides an eligibility blocker, material review state, stale input, unresolved conflict, or insufficient coverage.

## Deterministic model

`scoreJobFit(job, profile, eligibility)` starts from a neutral baseline and applies bounded contributions for eligibility, preferred location or commute, preferred employment type, verified skill matches, missing skill evidence, experience evidence, education alignment, training, category preference, customer-service relevance, and technical relevance. The merged implementation already filters employment to verified entries and verification-gates preferred location, work-type, category, and the positive within-limit commute branch. Its commute fallback can still subtract points when `maximumCommuteKm` is `USER_CONFIRMATION_REQUIRED` or `UNKNOWN`, and `REVIEW_REQUIRED` can still become recommended at the score threshold; R2B owns both corrections.

The result contains:

- integer score clamped to 0–100;
- positive and negative explanations;
- per-category point contributions; and
- engine/weight version.

Weights are transparent constants, not learned judgments. They are an ordering aid, not a probability of employment success.

## R2 verified-only contract

R2B binds every positive or negative preference contribution to a current verified candidate fact and current supported job evidence. `UNKNOWN`, unverified, stale, unresolved conditional, and conflicting evidence yields no preference points in either direction and remains a visible coverage gap. In particular, `UNVERIFIED`, `USER_CONFIRMATION_REQUIRED`, or `UNKNOWN` `maximumCommuteKm` contributes zero positive and zero negative fit points. Legal status and sensitive/protected identity fields never contribute. Recommendation requires current `ELIGIBLE` status; current job/evidence, candidate-profile, and evaluation versions; no unresolved material conflict or material conditional/unknown blocker; sufficient extraction coverage; and the score threshold. Score can never clear `REVIEW_REQUIRED`.

Every contribution stores a stable reason code, signed points, field/evidence IDs, evidence class, scorer/weight version, and safe explanation template. Missing evidence is not a mismatch. The UI shows coverage and uncertainty beside the score and never calls it a percentage match.

## Calibration

R2D calibrates first against a versioned fictional golden corpus and then, only if available, an ignored owner-labelled set of at least 30 cases spanning four role families and every eligibility status. Only safe aggregate pass/fail and ordinal metrics may be published. Until that gate passes the UI says `UNCALIBRATED` and never describes the score as a probability. Calibration must avoid protected characteristics, tiny-sample optimization, and using hiring outcomes as ground-truth merit.

## Testing

All fixtures remain inside 0–100 and have at least one explanation. Tests verify determinism, bounds, isolated-signal monotonicity, verified/unverified/unknown/stale ablation, no blocker/review override, no cross-category leakage, and reproducible evidence-linked contributions. Any rule/weight change requires golden-case and owner review plus a `PROJECT_PLAN.md` update.
