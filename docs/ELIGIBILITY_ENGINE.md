# Eligibility Engine

Status: deterministic Beta compatibility rules and R2 eligibility engine 2.0.0 are implemented and hardened. R2 consumes current R2A 3.1.0 evidence and is pending final exact-head review in unmerged PR #13. See [R2 matching quality plan](R2_MATCHING_QUALITY_PLAN.md).

## Contract

`evaluateEligibility(job, profile)` returns a status, version, and stable structured reasons. Statuses are:

- `ELIGIBLE`: no verified blocker or material ambiguity was found.
- `INELIGIBLE`: at least one verified hard blocker exists.
- `REVIEW_REQUIRED`: no blocker is proven, but a material fact is unknown, conditional, conflicting, or ambiguous.

Blockers take precedence over review reasons. An eligible result includes `NO_HARD_BLOCKERS`; it is not a guarantee that every unstated condition will be satisfied.

## Deterministic rules

The engine evaluates unrestricted/valid Australian work rights, mandatory licences, mandatory qualifications, required vehicle access, fixed timetable overlap, weekly/fortnightly limits, verified work-right hour restrictions, commute limits, mandatory experience explicitly known to be absent, and job ambiguities. It already labels reasons `LEGAL_LIMIT`, `EMPLOYER_REQUIREMENT`, or `CANDIDATE_PREFERENCE`.

Every reason contains a stable code, severity, human message, job fields, profile fields, and evidence class. UI and persistence use the code for behavior and the message for explanation.

## Unknown and class handling

A missing mandatory licence/qualification is a blocker only when negative truth explicitly says it is not held. Otherwise it is unconfirmed and needs review. This implements “unknown is not true” without incorrectly declaring every incomplete profile ineligible.

R2B makes class semantics strict: verified legal/employer-required conflicts may block; material unknown/conditional/conflicting evidence requires review; employer preferences do not block; candidate preferences cannot label the candidate legally or employer-ineligible. A fit score never overrides blocker, review, stale, conflict, or low-coverage state. Work-right results are explicitly not legal advice.

A legal-hours blocker additionally requires an exact-unit fortnight value and a verified, deterministically applicable time basis. `CURRENT` and teaching/break/visa-period assertions require both `asOf` and `validThrough`, in order, with the evaluation date inside that interval; an ordered `DATE_WINDOW` must also be active. Missing, partial, future, expired, unverified, or unresolved applicability yields `REVIEW_REQUIRED`, never a legal conclusion. Weekly evidence never becomes fortnightly evidence.

## Testing matrix

Current fixtures cover eligible retail, hospitality, receptionist, customer service, engineering internship and administration; missing healthcare qualifications; missing MR licence; own vehicle; unrestricted work rights; timetable conflict; excessive hours; mandatory warehouse experience; and an ambiguous automation requirement.

R2 adds class-by-state coverage for conditional certification, sponsorship/work-right expiry and hours, licence jurisdiction/expiry, overnight schedules, multiple location alternatives, weekly versus fortnightly limits, kilometres versus minutes, preference gaps, and unresolved conflicts. Legal-hours regressions include bounded current assertions plus teaching-to-break and stale/unbounded transitions. Rule changes require blocker, review, satisfied, stale, and unrelated-evidence regressions.
