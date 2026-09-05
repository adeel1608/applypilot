# Application Runner

## Modes

The runner contract recognizes `DISCOVERY_ONLY`, `ASSISTED_FILL`, `HUMAN_REVIEW_REQUIRED`, and `SUBMISSION_SUPPORTED`. Phase 0/1 implements only `PhaseOnePreparationRunner`, which reports `HUMAN_REVIEW_REQUIRED`, lists missing documents, returns no guessed answers, and hard-codes `finalSubmissionEnabled: false`.

## Answer store

Future common answers use `VERIFIED_ANSWER`, `USER_CONFIRMATION_REQUIRED`, or `UNKNOWN`, with profile fact references and confirmation timestamps. Work rights, availability, education, experience, salary expectation, start date, driver licence, vehicle, weekend availability, and physical-requirement answers must never be guessed.

## Security stops

The contract enumerates CAPTCHA, MFA, authentication required, bot detection, rate limit, access control, website restriction, and unexpected page change. A future runner must stop, audit the event without secrets, request legitimate human action, and continue only after the user resolves the boundary.

## Confirmation invariant

Form filling and final submission are separate operations. Assisted filling may prepare a form, but the user must see the destination, employer, role, documents, answers, and unresolved questions before explicitly confirming final submission. No background retry may cross that gate.
