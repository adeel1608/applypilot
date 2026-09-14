# Application Runner

## Separate operation lanes

ApplyPilot has two deliberately separate runner surfaces:

- `TargetInspectionRunner` accepts only an immutable schema-v2 target capability whose sole operation is `OPEN_AND_INSPECT_ONLY`. It may open the exact approved URL and passively inventory inert DOM metadata. Its API has no map-for-fill, write, upload, authentication, consent, or submit method.
- `TargetIndependentApplicationRunner` is the application lane. It requires the exact canonical operation set `MAP_FOR_FILL`, `FILL`, `UPLOAD`, and `SUBMIT`, a ready frozen packet, and all later disclosure and final-consent gates. An inspection capability cannot construct or operate this runner.

The separation is machine-enforced in the Zod capability contract, immutable capability digest, frozen binding, persisted capability version, repository checks, and runner constructors. A `REAL_TARGET` capability in the current release can grant only `OPEN_AND_INSPECT_ONLY`; real application operations remain disabled.

## Read-only Lever inspection contract

`lever-real-inspection-v6` supports only the form contract `lever-application-inspection-v1`. It launches a fresh isolated local Chromium context with no stored session, permissions, downloads, credentials, or candidate values. The browser permits only `GET` and `HEAD`, blocks every cross-origin request, permits no redirect outside the exact origin/path authority, performs no clicks, and reads only bounded structural attributes and minimum labels needed to classify eligibility questions. It never reads control values, page text, response bodies, cookies, storage, or hidden candidate data.

The v6 adapter uses Playwright-owned selector and element-handle reads after one navigation; it does
not execute a snapshot callback in the employer main world. Employer overrides of document query
functions, DOM prototypes, collection iterators, `Array`, `String`, style helpers, labels, or custom
element getters therefore do not become trusted inspection primitives. It performs two bounded
metadata passes, accepts only canonically identical results while the exact destination and main
frame stay stable, and builds the schema-validated snapshot in the trusted Node process. A detached
or individually unreadable structural read fails closed; mutation between passes, more than 200
controls, 400 labels, 20 forms, 100 sections, interactive open shadow DOM, or another incomplete
structure fails closed. A completely readable native control with an unfamiliar type or semantic is
retained as an `UNSUPPORTED` field while the rest of the inventory completes. Waiting for document
`load` is the only bounded structural readiness gate; there is no timer
sleep, second `goto`, reload, automatic retry, fallback fetch, or retained exception text.

CDP DOM snapshots were rejected for this revision: they are Chromium-specific, return substantially
more DOM/text material before filtering, add protocol maintenance surface, and are unnecessary while
Playwright-owned passive reads pass the hostile-page-world matrix. The former v2 main-world reader is
reachable only through a loopback-enforcing regression helper and is never selected by production.

The inspection inventory classifies contact, document, work-authorisation, sponsorship, citizenship, export-control, clearance, location, relocation, education, experience, free-text, consent, unknown, and final-submit controls. The result records safe counts and classifications only. Browser writes, field changes, uploads, submissions, and candidate-data outbound counts must all remain exactly zero.

Authentication, CAPTCHA, MFA, bot detection, rate limiting, access restrictions, changed destination/page/form, popup/download attempts, write requests, hidden interactive steps, opaque custom widgets, and structural uncertainty stop the inspection. They are never bypassed.

Every terminal `UNSUPPORTED_CONTROL` result now carries exactly one fixed value-free diagnostic:
blocked write, download, control/label/form/section limit, unreadable control/label/section metadata,
control-set mismatch, shadow control, hidden interactive step, declared custom widget, explicit
unsupported signal, or unknown unsupported state. The diagnostic contains no label, value, HTML,
URL, selector, employer prose, or exception text. Successful observations retain bounded visible
section and per-field counts, including unsupported fields.

`PAGE_CHANGED` remains the public fail-closed result for a broad inspection failure. Future stopped
inspections additionally retain exactly one value-free diagnostic category when applicable:
`HTTP_ERROR`, `NAVIGATION_EXCEPTION`, `SNAPSHOT_INVALID`, `DOM_INSPECTION_EXCEPTION`,
`ADAPTER_OUTPUT_INVALID`, or `UNKNOWN_INSPECTION_EXCEPTION`. A DOM exception may additionally retain
one fixed stage: `DOM_QUERY`, `DOM_ENUMERATION`, `DOM_CONTROL_READ`, `DOM_PAGE_METADATA`,
`DOM_RESULT_SERIALIZATION`, or `DOM_UNKNOWN`. Only those enums are written to the local audit and
inspection summary. Exception messages, stack traces, response/status text, URLs, selectors, page
content, headers, cookies, storage, and candidate values are not diagnostic metadata.
The historical first real-target stop predates this instrumentation and therefore remains
`UNKNOWN_SAFE_BOUNDARY`; it must not be relabelled as a form change.

`DESTINATION_CHANGED` remains the public fail-closed result for every exact-route mismatch. Adapter
v6 additionally retains at most one fixed value-free cause: `MAIN_NAVIGATION_OUT_OF_SCOPE`,
`FINAL_ORIGIN_CHANGED`, `FINAL_PATH_CHANGED`, `FINAL_QUERY_OR_FRAGMENT_CHANGED`, `POPUP_ATTEMPT`, or
`DESTINATION_STATE_UNKNOWN`. These causes never contain or preserve the observed URL. They do not
expand path authority, permit a retry, or convert any changed destination into an approved target.
`POPUP_ATTEMPT` now requires an observed Playwright popup event, which is closed immediately. An
inert anchor or form that merely declares `target="_blank"` is never activated and does not count as
an attempt.

The second and third real-target attempts reached their exact approved destination but stopped before
a valid inventory with `DOM_INSPECTION_EXCEPTION`. They retained no DOM content and do not prove the
form contract. A fictional stable-URL page that poisons `document.querySelectorAll` reproduces a
compatible v2 failure mechanism; it is not evidence of the historical Shield AI cause. Runtime
extraction changed for v3, so its adapter-bound deterministic identity started a new capability family
at version 1 with no predecessor. The closed v2 family is never reused. The fourth attempt used that
v3 family and stopped with `DESTINATION_CHANGED` before DOM inventory; its historical record cannot
safely distinguish the exact cause. Adapter v4 adds only value-free destination diagnostics and must
therefore start another new capability family at version 1 with no predecessor. No fifth visit is
authorized by this software change.

The fifth attempt used v4 and stopped before inventory as `POPUP_ATTEMPT`. Offline diagnosis proved
that v4 incorrectly combined observed popup events with inert `target="_blank"` declarations, so the
historical stop does not prove that a popup actually opened. Adapter v5 removes only that semantic
conflation and starts a new capability family; it did not authorize a sixth visit. The separately
owner-authorized sixth visit used v5 and stopped before inventory as `UNSUPPORTED_CONTROL`; v5
persisted no subtype, so the exact historical cause is unknowable. Multiple synthetic mechanisms are
compatible with that outcome but do not prove it. Adapter v6 separates harmless readable unsupported
fields from terminal structural uncertainty and records only the fixed causes above. Runtime semantics
changed, so v6 starts a new deterministic capability family at version 1 with no predecessor. This
offline change does not authorize a seventh visit.

## Frozen binding and persistence

An inspection binding commits to the exact current packet, packet digest, job/profile/evaluation versions, capability ID/version/digest, target URL/origin/path, allowed path prefix, adapter/form versions, and document/answer/disclosure digests. A review-required packet may be inspected because inspection does not fill it, but a stale packet or later-changed capability, packet, job, profile, or evaluation fails before the browser opens.

A real-target capability ID is derived only from its target kind, exact origin, exact path, one allowed operation, form contract, adapter, and packet digest. Changing any of those inputs creates a new capability family at version 1 with no predecessor. Alias, lifecycle state and references, timestamps and expiries, version, and predecessor do not rotate identity; unchanged identity advances within the same family. Offline proposal preparation, packet freezing, real-target persistence, inspection binding, and execution all use the same central assertion. A cross-family or malformed lineage therefore fails before persistence or employer access. The deterministic ID function itself is unchanged.

Migration `0008_real_target_inspection_scope.sql` adds operation scope to target capabilities and a separate inspection lifecycle table. It does not change migrations `0000`–`0007`. No migration is needed for v6: the fixed diagnostics use existing JSON audit/summary fields. Audits record only safe operation, version, stop reason, fixed value-free diagnostic enums, and aggregate classification counts.

## Answers, disclosure, and final submission

Application answers retain `VERIFIED_ANSWER`, `USER_CONFIRMATION_REQUIRED`, and `UNKNOWN` truth states. Work rights, availability, education, experience, salary, licence, vehicle, schedule, citizenship, export-control, and clearance claims are never guessed.

Inspection authority is not disclosure authority. Upload and fill remain separate from final submission. The target-independent synthetic lane validates every adapter observation strictly, stops interrupted pre-submit stages without retry, and binds consent to the complete frozen run binding. A future supported real application operation must show the destination, employer, role, approved document digests, material answers, and unresolved questions, then require a fresh expiring one-use consent for the exact frozen snapshot immediately before submission. A lost or ambiguous submission response becomes `OUTCOME_UNKNOWN` and is never blindly retried.
