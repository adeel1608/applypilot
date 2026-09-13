# Application Runner

## Separate operation lanes

ApplyPilot has two deliberately separate runner surfaces:

- `TargetInspectionRunner` accepts only an immutable schema-v2 target capability whose sole operation is `OPEN_AND_INSPECT_ONLY`. It may open the exact approved URL and passively inventory inert DOM metadata. Its API has no map-for-fill, write, upload, authentication, consent, or submit method.
- `TargetIndependentApplicationRunner` is the application lane. It requires the exact canonical operation set `MAP_FOR_FILL`, `FILL`, `UPLOAD`, and `SUBMIT`, a ready frozen packet, and all later disclosure and final-consent gates. An inspection capability cannot construct or operate this runner.

The separation is machine-enforced in the Zod capability contract, immutable capability digest, frozen binding, persisted capability version, repository checks, and runner constructors. A `REAL_TARGET` capability in the current release can grant only `OPEN_AND_INSPECT_ONLY`; real application operations remain disabled.

## Read-only Lever inspection contract

`lever-real-inspection-v1` supports only the form contract `lever-application-inspection-v1`. It launches a fresh isolated local Chromium context with no stored session, permissions, downloads, credentials, or candidate values. The browser permits only `GET` and `HEAD`, blocks every cross-origin request, permits no redirect outside the exact origin/path authority, performs no clicks, and reads only bounded structural attributes and minimum labels needed to classify eligibility questions. It never reads control values, page text, response bodies, cookies, storage, or hidden candidate data.

The inspection inventory classifies contact, document, work-authorisation, sponsorship, citizenship, export-control, clearance, location, relocation, education, experience, free-text, consent, unknown, and final-submit controls. The result records safe counts and classifications only. Browser writes, field changes, uploads, submissions, and candidate-data outbound counts must all remain exactly zero.

Authentication, CAPTCHA, MFA, bot detection, rate limiting, access restrictions, changed destination/page/form, popup/download attempts, write requests, hidden interactive steps, and unsupported widgets stop the inspection. They are never bypassed.

## Frozen binding and persistence

An inspection binding commits to the exact current packet, packet digest, job/profile/evaluation versions, capability ID/version/digest, target URL/origin/path, allowed path prefix, adapter/form versions, and document/answer/disclosure digests. A review-required packet may be inspected because inspection does not fill it, but a stale packet or later-changed capability, packet, job, profile, or evaluation fails before the browser opens.

Migration `0008_real_target_inspection_scope.sql` adds operation scope to target capabilities and a separate inspection lifecycle table. It does not change migrations `0000`–`0007`. Audits record only safe operation, version, stop reason, and aggregate classification counts.

## Answers, disclosure, and final submission

Application answers retain `VERIFIED_ANSWER`, `USER_CONFIRMATION_REQUIRED`, and `UNKNOWN` truth states. Work rights, availability, education, experience, salary, licence, vehicle, schedule, citizenship, export-control, and clearance claims are never guessed.

Inspection authority is not disclosure authority. Upload and fill remain separate from final submission. A future supported application operation must show the destination, employer, role, approved document digests, material answers, and unresolved questions, then require a fresh expiring one-use consent for the exact frozen snapshot immediately before submission. A lost or ambiguous submission response becomes `OUTCOME_UNKNOWN` and is never blindly retried.
