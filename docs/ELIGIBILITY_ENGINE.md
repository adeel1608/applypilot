# Eligibility Engine

## Contract

`evaluateEligibility(job, profile)` returns a status, version, and stable structured reasons. Statuses are:

- `ELIGIBLE`: no verified blocker or material ambiguity was found.
- `INELIGIBLE`: at least one verified hard blocker exists.
- `REVIEW_REQUIRED`: no blocker is proven, but a material fact is unknown or ambiguous.

Blockers take precedence over review reasons. An eligible result includes `NO_HARD_BLOCKERS`; it is not a guarantee that every unstated condition will be satisfied.

## Initial deterministic rules

The Phase 0/1 engine evaluates unrestricted/valid Australian work rights, mandatory licences, mandatory qualifications, required vehicle access, fixed timetable overlap, weekly/fortnightly limits, verified work-right hour restrictions, commute limits, mandatory experience explicitly known to be absent, and job ambiguities.

Every reason contains a stable code, severity, human message, job fields, and profile fields. UI and persistence should use the code for behavior and the message for explanation.

## Unknown handling

A missing mandatory licence/qualification is a blocker only when negative truth explicitly says it is not held. Otherwise it is unconfirmed and needs review. This distinction implements “unknown is not true” without incorrectly declaring every incomplete profile ineligible.

## Testing matrix

Fixtures cover eligible retail, hospitality, receptionist, customer service, engineering internship and administration; missing healthcare qualifications; missing MR licence; own vehicle; unrestricted work rights; timetable conflict; excessive hours; mandatory warehouse experience; and an ambiguous automation requirement. Rule changes require regression coverage for eligible, blocker, and unknown branches.
