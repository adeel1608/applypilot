# Application Runner

## Separate operation lanes

ApplyPilot has three separate runner surfaces:

- `TargetInspectionRunner` accepts only an immutable schema-v2 target capability whose sole operation is `OPEN_AND_INSPECT_ONLY`. It may open the exact approved URL and passively inventory inert DOM metadata. Its API has no map-for-fill, write, upload, authentication, consent, or submit method.
- `TargetIndependentApplicationRunner` is the application lane. It requires the exact canonical operation set `MAP_FOR_FILL`, `FILL`, `UPLOAD`, and `SUBMIT`, a ready frozen packet, and all later disclosure and final-consent gates. An inspection capability cannot construct or operate this runner.
- `HostedApplicationService` is the new production native-form lane for exact Greenhouse and Lever targets. It has separate additive capability/session/claim/consent tables, a reviewed-build gate, and explicit REAL/FICTIONAL modes. Its current readiness and validation are recorded in `PROJECT_PLAN.md`; fictional acceptance is not real application acceptance.

The separation is machine-enforced in the Zod capability contract, immutable capability digest, frozen binding, persisted capability version, repository checks, and runner constructors. The legacy `REAL_TARGET` capability continues to grant only `OPEN_AND_INSPECT_ONLY`. Real native application operations require the separate reviewed hosted capability and each owner gate below.

## Hosted native-form workflow and local runbook

`hosted-native-v1` supports one native server-rendered form on an exact Greenhouse `/{tenant}/jobs/{post}` or Lever `/{tenant}/{post}/apply` URL. The immutable capability binds provider/region/tenant/post, current source verification/job/profile, adapter/head/tree/compiled build, form/question/packet digests, exact HTTPS GET/POST destinations, bounds, policy review and expiry. Migration 0013 binds the exact source detail request; migration 0014 adds hosted workflow tables. Migrations 0000–0012 and historical authority remain unchanged.

Page scripts stay disabled and service workers are blocked in both modes. The browser has a fresh nonpersistent context and a denying proxy; intercepted traffic uses one public DNS-pinned HTTPS attempt without redirects or retries. Anonymous CSRF cookies issued inside that context can be forwarded only on approved requests and are never logged or persisted. Script-generated forms, authentication, protections, custom widgets, unknown factual questions, external form overrides, required remote upload acknowledgements and unapproved destinations stop the workflow. Ordinary native controls alone do not establish that an employer's whole form is supported.

The production sequence is:

1. **INSPECT:** one exact owner action opens the target with zero candidate disclosure. Read bounded native controls twice and persist the form/question fingerprint. Exact retained Greenhouse `GET_JOB` with explicitly bound `questions=true` can discover questions before a packet, without another request.
2. **Local question and packet review:** retain required alternatives such as CV upload OR resume text. Select only server-derived VERIFIED facts or explicit nonfactual owner consent. Unselected optional questions remain unanswered; an unknown required fact blocks readiness. A required privacy checkbox is an owner decision, not a candidate fact. Persist the review nonce even if it has zero consent choices. The actual current ELIGIBLE/recommended/duplicate-resolved PREPARING gate and approved documents remain mandatory.
3. **DISCLOSE AND PREPARE:** show the exact private answers, files and destinations plus the conservative early-disclosure warning. One fresh owner action authorizes MAP/FILL/UPLOAD/VERIFY/FILL_PREVIEW in the same owned context. Validate approved PDF path, bytes, parseability and digest; verify actual browser-attached bytes. `LOCAL_ATTACHED` does not mean remote upload succeeded. Bind native constraints, encoding, required controls, mapping and values; native validity must pass.
4. **Final review:** `REVIEW_READY` is an inactive checkpoint. Show the frozen private preview, approved document filenames, unanswered optional fields, consent selections and zero material diff. No submission has occurred.
5. **SUBMIT:** require a new exact owner checkbox, phrase and one-use nonce for that server-derived preview. Recheck source/profile/job/packet/form/artifacts/build and browser bytes. Atomically consume final consent, claim SUBMIT and establish the unique provider/region/tenant/post guard before one native click. Reliable exact response/destination/confirmation text plus response digest establishes `CONFIRMED_SUBMITTED`. Any uncertain acknowledgement remains `OUTCOME_UNKNOWN`; never retry.

The source combined action remains one displayed `APPROVE AND RUN <capability-id>` confirmation for one bounded run, with distinct durable APPROVE and START receipts. List authority cannot authorize detail; hidden operation/ID/query fields are not authority. On a failed click, inspect existing durable state before another action. `SCHEMA_CHANGED` and partial/capped reads are not evidence of an empty board. Culture Amp and ROLLER's historical schema causes remain unknown.

### Review, migration, build and startup

Before merge, record exact-head CI, resolve every change request, and obtain the documented human review. Agent self-review is not human approval. A formal current-head GitHub APPROVED review counts; where remote rules allow, the PR owner may instead leave a COMMENTED review whose body is exactly `APPROVE RELEASE REVIEW <exact-head-sha>`. Human and independent review counts are separate. Required GitHub review rules still apply.

On the compatible clean reviewed head, use the established local commands:

```powershell
npm.cmd run hosted:validate-release
npm.cmd run backup
npm.cmd run db:migrate -- --confirm
npm.cmd run db:status
npm.cmd run hosted:seal-build -- --pr <reviewed-merged-pr-number>
npm.cmd run local:start
```

The seal requires the selected human-reviewed PR's exact merge commit as the current build head, exact-current-head successful CI, the actual frozen full release matrix, and unchanged compiled server bytes/manifests/BUILD_ID. An older reviewed ancestor cannot authorize a later unreviewed commit. All PR review pages are checked; comments cannot clear a change request. The seal creates no source or target receipt. The UI and proposal CLI recheck this evidence; missing or changed evidence disables execution. Use the actual `LOCAL_START_PASS` URL/port and owned process readback, never a guessed port.

`npm.cmd run hosted:stage -- --proposal data/private/<proposal>.json` accepts only a confined strictly parsed REAL proposal for that reviewed build and current exact subject. It atomically stages inert capability metadata and creates zero owner receipts, browser contexts, requests or submissions. No REAL proposal is staged by the offline fixture suite.

### Stop, recovery and rollback

Use `npm.cmd run local:stop` to stop only the recorded owned application process. Restart recovery marks lost nonterminal hosted sessions STOPPED or OUTCOME_UNKNOWN according to their durable claims; it never reopens a target or repeats a fill/upload/submit. The target-post submit guard survives stop/restart, capability versions and packet changes. A terminal run or receipt is never recreated. Preserve unknown outcomes for read-only/manual reconciliation.

For a separately authorized restore, first stop the owned app and use `npm.cmd run restore -- --preview <backup-id>`, then the established exact `--confirm <backup-id> RESTORE:<backup-id>` action. Restore and matching code rollback must preserve containment and unknown outcomes; database rollback is not permission to replay an external mutation. The task's disposable schema-12 and schema-14 production backup/restore proofs are recorded in the plan. No canonical rollback is performed by fictional tests.

Personal Live V1 remains a separate R0–R6/R11/full-matrix and owner-release decision. A fictional submit or one real submit does not certify it. The read-only official evaluator checks current reviewed executable evidence, matching calibration qualification, real journey proof, database health, unresolved operations and the exact owner-release decision; missing evidence remains `NOT_READY`.

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
