# Fit Scorer

Status: the compatibility scorer and verified-only R2 scorer 2.0.0 / `r2-weights-1` are implemented and hardened on unmerged PR #13. R2 remains an `UNCALIBRATED` owner-review ordering aid pending the approved private threshold and final exact-head review. See [R2 matching quality plan](R2_MATCHING_QUALITY_PLAN.md).

## Purpose

Eligibility answers whether a known hard condition prevents proceeding. Fit scoring helps order review work. A high score never overrides an eligibility blocker, material review state, stale input, unresolved conflict, or insufficient coverage.

## Deterministic model

`scoreJobFit(job, profile, eligibility)` remains the compatibility path. `scoreR2JobFit` uses only current evidence-linked inputs: stale candidate bindings and unknown, conditional, conflicting, or unusable job evidence add no contribution. Commute scoring consumes current R2A `commute.distance` and `commute.duration` field records; kilometres and minutes never substitute. Unverified commute preferences produce no positive or negative points, and R2 recommendation cannot bypass review or ineligibility.

The result contains:

- integer score clamped to 0–100;
- positive and negative explanations;
- per-category point contributions; and
- scorer/weight version and exact calibration-context version/run binding.

Weights are transparent constants, not learned judgments. They are an ordering aid, not a probability of employment success.

## R2 verified-only contract

R2B binds every positive or negative preference contribution to a current verified candidate fact and current supported job evidence. `UNKNOWN`, unverified, stale, unresolved conditional, and conflicting evidence yields no preference points in either direction and remains a visible coverage gap. In particular, `UNVERIFIED`, `USER_CONFIRMATION_REQUIRED`, or `UNKNOWN` `maximumCommuteKm` contributes zero positive and zero negative fit points. Legal status and sensitive/protected identity fields never contribute. Recommendation requires current `ELIGIBLE` status; current job/evidence, candidate-profile, and evaluation versions; no unresolved material conflict or material conditional/unknown blocker; sufficient extraction coverage; and the score threshold. Score can never clear `REVIEW_REQUIRED`.

Every contribution stores a stable reason code, signed points, field/evidence IDs, evidence class, scorer/weight version, and safe explanation template. Missing evidence is not a mismatch. The UI shows coverage and uncertainty beside the score and never calls it a percentage match.

## Calibration

R2D first executes the real eligibility/scorer path against a versioned 12-case fictional golden corpus. The manifest contains expected outcomes but no expected scorer output; actual scores drive ordinal metrics. Only an ignored owner-labelled set of at least 30 independently reviewed jobs spanning four role families and every eligibility status can produce a durable `CALIBRATED` context. Each evaluation stores its context version and optional calibration-run foreign key, so promotion never rewrites historical evaluations or collides with an older identity. Only safe aggregate pass/fail and ordinal metrics may be published. Until the private gate passes the UI says `UNCALIBRATED` and never describes the score as a probability.

## Testing

The executable corpus covers all 12 approved role families and obtains outputs from the production R2 engines. Independent executions verify determinism; actual scorer runs verify bounds, isolated-signal monotonicity and ablation; weight and eligibility mutations prove the expectations can fail; and recommendation regressions cover review/ineligible/stale/unresolved cases. Any rule/weight change requires golden-case and owner review plus a `PROJECT_PLAN.md` update.
