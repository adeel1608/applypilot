# Candidate Truth Store

## Purpose

The candidate truth store is the only permitted source for candidate claims. It prevents generated resumes, cover letters, eligibility decisions, and application answers from treating plausible information as real information.

## Schema

`packages/candidate-profile` owns `CandidateProfileSchema`. The schema covers identity, contact, location, education, employment, verified achievements, skills, languages, licences, certifications, work rights, recurring availability, university/fixed commitments, transport, driver/vehicle implications, commute limits, preferred locations/work types/categories, hour limits, unsupported experience, forbidden claims, referees, and document preferences.

Material facts carry one of:

- `VERIFIED`: may be used when the specific value is relevant.
- `USER_CONFIRMATION_REQUIRED`: may be displayed as pending but not asserted.
- `UNKNOWN`: must not be inferred.

`verifiedAchievements` accepts only verified records. Employment references to achievement IDs are validated.

## Negative truth

`unsupportedExperience` records experience known to be absent. `forbiddenClaims` records exact claims that document/application engines must never make, including licences, work rights, qualifications, and software exposure. These arrays are used as hard negative evidence for deterministic eligibility when a matching requirement is mandatory.

Negative truth is not proof of every other absence. If a mandatory fact is neither verified nor explicitly absent, the result is review rather than eligible or ineligible.

## Versioning and provenance

The database stores an identity row plus append-only profile snapshots with a schema version and content hash. Eligibility, score, generated document, and application records link to the profile version used. Future profile edits create a new version; historical decisions keep their original provenance.

Generated resume claims contain profile fact references. Validation rejects a claim with no reference or a reference that is not verified.

## Private file handling

`data/profile.example.json` is fictional and safe to commit. Real data belongs in `data/profile.private.json`, which is ignored. The current dashboard intentionally reads only the fictional example; private-profile loading and encryption require a future plan update and threat review.

Before using a real profile, verify the ignore rule with `git check-ignore -v data/profile.private.json` and check staged changes with `git diff --cached --name-only`.
