# Fit Scorer

Status: the compatibility scorer and verified-only R2 scorer 2.0.0 / `r2-weights-1` are implemented. R2 remains an `UNCALIBRATED` owner-review ordering aid pending the approved private threshold and review of the unmerged matching-quality PR. See [R2 matching quality plan](R2_MATCHING_QUALITY_PLAN.md).

## Purpose

Eligibility answers whether a known hard condition prevents proceeding. Fit scoring helps order review work. A high score never overrides an eligibility blocker, material review state, stale input, unresolved conflict, or insufficient coverage.

## Deterministic model

`scoreJobFit(job, profile, eligibility)` remains the compatibility path. `scoreR2JobFit` uses only current evidence-linked inputs: stale candidate bindings and unknown, conditional, conflicting, or unusable job evidence add no contribution. Unverified commute preferences produce no positive or negative points, and R2 recommendation cannot bypass review or ineligibility.

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
