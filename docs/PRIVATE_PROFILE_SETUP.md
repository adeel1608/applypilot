# Private Profile Setup

> Phase 2.5A planning document. Do not create `data/profile.private.json` until the
> Phase 2.5A planning pull request is approved and the owner is ready to supply the
> facts locally. The example below is entirely fictional.

ApplyPilot reads one fixed local file, `data/profile.private.json`, only on the
server. The file is Git-ignored, is not used by CI, and must never be copied into
issues, pull requests, screenshots, browser storage, logs, or external services.
Real imported jobs may be evaluated only when this file passes
`CandidateProfileSchema`; `data/profile.example.json` is never a fallback.

## Fact wrapper and verification states

Many scalar fields use this shape:

```json
{
  "value": "a schema-valid value",
  "verification": "VERIFIED",
  "source": "local evidence description",
  "verifiedAt": "2026-09-05T00:00:00.000Z"
}
```

`value` and `verification` are required. `source` and `verifiedAt` are optional;
when present, `verifiedAt` must be an ISO 8601 date-time. The allowed verification
states are:

- `VERIFIED`: supported by evidence the candidate accepts as correct. Only these
  facts may support candidate-facing claims.
- `USER_CONFIRMATION_REQUIRED`: plausible local information that the candidate
  still needs to confirm. It must not be treated as verified.
- `UNKNOWN`: not established. It must not be inferred as true.

The current schema still requires a schema-valid `value` for every required fact
wrapper, even when its verification state is not `VERIFIED`. Never invent a value
to make the file validate. If a required truthful value is unavailable, stop and
record that as a schema/setup blocker.

## Exact schema fields

Unless marked optional or defaulted, each object and array is required. Required
arrays may be empty.

| Path                                                                      | Requirement and type                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                                           | Required literal `1`.                                                                                                                                                                                                               |
| `profileId`                                                               | Required non-empty string; stable local identifier.                                                                                                                                                                                 |
| `displayNameTemplate`                                                     | Optional input; defaults to `{firstName} {lastName}`.                                                                                                                                                                               |
| `documentFileNameTemplate`                                                | Optional input; defaults to `{firstNameUpper} CV ({company}).pdf`.                                                                                                                                                                  |
| `identity.firstName`, `identity.lastName`                                 | Required non-empty string fact wrappers.                                                                                                                                                                                            |
| `identity.preferredName`                                                  | Optional string fact wrapper; its value may be empty.                                                                                                                                                                               |
| `contact.email`                                                           | Required email fact wrapper.                                                                                                                                                                                                        |
| `contact.phone`                                                           | Required non-empty string fact wrapper.                                                                                                                                                                                             |
| `contact.linkedInUrl`, `contact.portfolioUrl`                             | Optional URL fact wrappers.                                                                                                                                                                                                         |
| `location.suburb`, `location.country`                                     | Required non-empty string fact wrappers.                                                                                                                                                                                            |
| `location.postcode`                                                       | Required fact wrapper containing exactly four digits.                                                                                                                                                                               |
| `location.state`                                                          | Required fact wrapper: `ACT`, `NSW`, `NT`, `QLD`, `SA`, `TAS`, `VIC`, or `WA`.                                                                                                                                                      |
| `education`                                                               | Required array. Each item requires `id`, `institution`, `qualification`, `field`, `status`, and `verification`; `startDate` and `endDate` are optional ISO dates. Status is `COMPLETED`, `IN_PROGRESS`, `DEFERRED`, or `WITHDRAWN`. |
| `employment`                                                              | Required array. Each item requires `id`, `employer`, `title`, ISO `startDate`, `responsibilities`, and `verification`; `location` and ISO `endDate` are optional; `achievementIds` defaults to `[]`.                                |
| `verifiedAchievements`                                                    | Required array. Each item requires `id`, `statement`, `evidence`, and literal `VERIFIED`. Every employment `achievementId` must refer to an ID in this array.                                                                       |
| `skills`                                                                  | Required array. Each item requires `id`, `name`, and `verification`; optional `level` is `FOUNDATIONAL`, `WORKING`, `PROFICIENT`, or `ADVANCED`; `evidence` is optional.                                                            |
| `languages`                                                               | Required array. Each item requires `id`, `name`, `verification`, and `proficiency`: `BASIC`, `CONVERSATIONAL`, `PROFESSIONAL`, or `NATIVE`.                                                                                         |
| `licences`                                                                | Required array. Each item requires `id`, `name`, and `verification`; `jurisdiction` and ISO `expiresOn` are optional. An empty array means no licence is asserted.                                                                  |
| `certifications`                                                          | Required array. Each item requires `id`, `name`, and `verification`; `issuer` and ISO `expiresOn` are optional.                                                                                                                     |
| `workRights`                                                              | Required fact wrapper. Its value requires `country`, `status`, and `maximumHoursPerFortnight`; `notes` is optional. Status is `UNRESTRICTED`, `RESTRICTED`, `NONE`, or `UNKNOWN`; maximum hours is a positive number or `null`.     |
| `availability.timezone`                                                   | Required non-empty string. Use the truthful IANA zone, for example `Australia/Sydney`; the current schema checks only that it is non-empty.                                                                                         |
| `availability.recurring`                                                  | Required array. Each item requires `day`, `startTime`, `endTime`, `available`, and `verification`. Times use 24-hour `HH:mm`; days are `MONDAY` through `SUNDAY`.                                                                   |
| `availability.fixedCommitments`                                           | Required array. Each item requires `id`, `label`, `day`, `startTime`, `endTime`, and `verification`, using the same day/time format.                                                                                                |
| `transport.vehicleAccess`                                                 | Required boolean fact wrapper. Do not infer a licence from vehicle access or vehicle access from a licence.                                                                                                                         |
| `transport.modes`                                                         | Required array of `WALK`, `BICYCLE`, `PUBLIC_TRANSPORT`, `CAR`, or `OTHER`.                                                                                                                                                         |
| `transport.maximumCommuteKm`                                              | Required non-negative-number fact wrapper.                                                                                                                                                                                          |
| `preferences.preferredLocations`                                          | Required array of non-empty strings.                                                                                                                                                                                                |
| `preferences.preferredWorkTypes`                                          | Required array of `CASUAL`, `PART_TIME`, `FULL_TIME`, `CONTRACT`, or `INTERNSHIP`.                                                                                                                                                  |
| `preferences.preferredCategories`                                         | Required array of non-empty strings.                                                                                                                                                                                                |
| `preferences.maximumHoursPerWeek`, `preferences.maximumHoursPerFortnight` | Required positive-number fact wrappers.                                                                                                                                                                                             |
| `preferences.earliestStartDate`                                           | Optional ISO-date fact wrapper.                                                                                                                                                                                                     |
| `preferences.salaryExpectation`                                           | Optional non-empty-string fact wrapper.                                                                                                                                                                                             |
| `unsupportedExperience`                                                   | Required array of non-empty strings naming experience the candidate does not have or cannot substantiate.                                                                                                                           |
| `forbiddenClaims`                                                         | Required array of non-empty strings that generated content must never claim. Keep this explicit even where it overlaps unsupported experience.                                                                                      |
| `referees`                                                                | Required array. Each item requires `id`, `name`, `relationship`, and `verification`; `contact` is optional; `private` defaults to `true`. Referee contacts remain server-only and should normally be omitted until needed.          |
| `candidatePreferences.coverLetterTone`                                    | Required: `DIRECT`, `WARM`, or `FORMAL`.                                                                                                                                                                                            |
| `candidatePreferences.includeRefereesOnResume`                            | Optional input; defaults to `false`.                                                                                                                                                                                                |
| `candidatePreferences.requireDocumentPreview`                             | Required literal `true`.                                                                                                                                                                                                            |
| `candidatePreferences.requireFinalSubmissionConfirmation`                 | Required literal `true`.                                                                                                                                                                                                            |

The schema does not infer chronology, time ordering, licence equivalence, work
rights, transport, experience, or qualifications. Use accurate values and
conservative verification states.

## Fictional minimal template

This example is documentation-only and deliberately contains no owner data. Copy
the structure only after Phase 2.5A approval, replace every fictional value
locally, and remove optional fields that do not apply.

```json
{
  "schemaVersion": 1,
  "profileId": "private-candidate-local-001",
  "displayNameTemplate": "{firstName} {lastName}",
  "documentFileNameTemplate": "{firstNameUpper} CV ({company}).pdf",
  "identity": {
    "firstName": {
      "value": "Taylor",
      "verification": "VERIFIED",
      "source": "fictional documentation example"
    },
    "lastName": {
      "value": "Example",
      "verification": "VERIFIED",
      "source": "fictional documentation example"
    }
  },
  "contact": {
    "email": {
      "value": "taylor.candidate@example.test",
      "verification": "VERIFIED",
      "source": "fictional documentation example"
    },
    "phone": {
      "value": "+61 400 000 000",
      "verification": "VERIFIED",
      "source": "fictional documentation example"
    }
  },
  "location": {
    "suburb": {
      "value": "Example Suburb",
      "verification": "VERIFIED"
    },
    "postcode": {
      "value": "2000",
      "verification": "VERIFIED"
    },
    "state": {
      "value": "NSW",
      "verification": "VERIFIED"
    },
    "country": {
      "value": "Australia",
      "verification": "VERIFIED"
    }
  },
  "education": [],
  "employment": [],
  "verifiedAchievements": [],
  "skills": [],
  "languages": [],
  "licences": [],
  "certifications": [],
  "workRights": {
    "value": {
      "country": "Australia",
      "status": "RESTRICTED",
      "maximumHoursPerFortnight": 48,
      "notes": "Fictional constraint for the documentation example"
    },
    "verification": "VERIFIED",
    "source": "fictional documentation example"
  },
  "availability": {
    "timezone": "Australia/Sydney",
    "recurring": [
      {
        "day": "SATURDAY",
        "startTime": "09:00",
        "endTime": "17:00",
        "available": true,
        "verification": "VERIFIED"
      }
    ],
    "fixedCommitments": []
  },
  "transport": {
    "vehicleAccess": {
      "value": false,
      "verification": "VERIFIED"
    },
    "modes": ["PUBLIC_TRANSPORT"],
    "maximumCommuteKm": {
      "value": 20,
      "verification": "VERIFIED"
    }
  },
  "preferences": {
    "preferredLocations": ["Example Suburb"],
    "preferredWorkTypes": ["CASUAL", "PART_TIME"],
    "preferredCategories": ["Customer service"],
    "maximumHoursPerWeek": {
      "value": 20,
      "verification": "VERIFIED"
    },
    "maximumHoursPerFortnight": {
      "value": 40,
      "verification": "VERIFIED"
    }
  },
  "unsupportedExperience": ["forklift operation"],
  "forbiddenClaims": ["forklift licence", "unrestricted work rights"],
  "referees": [],
  "candidatePreferences": {
    "coverLetterTone": "DIRECT",
    "includeRefereesOnResume": false,
    "requireDocumentPreview": true,
    "requireFinalSubmissionConfirmation": true
  }
}
```

## Planned safe validation command

The current Phase 2.5 application exposes only a safe profile-state label; it does
not yet provide a dedicated CLI validator. Phase 2.5A execution should add a small
local-only command:

```bash
npm run profile:validate
```

It must read only the fixed `data/profile.private.json` path, use
`CandidateProfileSchema.safeParse`, and emit exactly one state line:

```text
Private candidate profile: VALID
```

or `MISSING` or `INVALID`. An invalid result may additionally list bounded schema
paths and stable error codes, but never values, input fragments, the file body, a
full exception, or the resolved private path. The command must not write the
profile to SQLite, start the web app, contact a network service, or place it in a
build/test artifact.

Before any real smoke test, also confirm that Git ignores the file:

```bash
git check-ignore -v data/profile.private.json
git ls-files --error-unmatch data/profile.private.json
```

The first command must identify an ignore rule. The second command must fail with
“pathspec did not match”; success would mean the private file is tracked and the
smoke test must stop.
