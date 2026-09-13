# Offline Personal Live V1 enablement

Status: **SOURCE-ENABLED PERSONAL BETA READY; READ-ONLY TARGET INSPECTION AWAITS EXACT OWNER APPROVAL.**

The owner-reviewed request #9 proved one bounded Lever source-to-R2 run and established Source-enabled Personal Beta readiness. That capability is revoked and authorises no later request. Target operation authority is now machine-separated: `OPEN_AND_INSPECT_ONLY` uses a dedicated passive runner, while map/fill/upload/submit remain in the application runner and cannot use an inspection capability. Automated target validation uses a loopback fictional form only. No employer page has been visited and no candidate data, document, or form value has been sent externally.

Schema `0008_real_target_inspection_scope.sql` is additive. It adds immutable operation scope to target capabilities and stores separate frozen inspection bindings/lifecycle records. Migrations `0000`–`0007` remain immutable.

Final source hardening accepts Lever's official `on-site`, `remote`, `hybrid`, and `unspecified` workplace values and maps `on-site` to the internal `onsite` value. Official `lists[]` sections are parser-converted to inert text, retained in order as typed source sections, and supplied to R2 normalization; active HTML elements are discarded and source HTML is never rendered or executed. The original bounded raw posting remains immutable local observation evidence. Lever list queries require exactly one `mode=json`, canonical bounded `skip`, and canonical bounded `limit`; Lever redirects are always zero. A completed owner restart reconciles current jobs across the durable capability's earlier stopped runs, evaluates missing current tuples, reuses current evaluations when only queueing remains, and makes an exact replay a no-op.

## Approval A — any later real Lever tenant GET

Source-enabled Personal Beta readiness does not authorise another request. Before any later real source call, the owner must create one ignored `data/private/source-allowlist.json` that passes schema v2, review the tenant’s current public-board context and applicable policy, and provide this exact approval record outside Git:

```text
OWNER APPROVAL — FIRST REAL LEVER TENANT GET
Capability ID: <capabilityId>
Capability version: <version>
Tenant: <exact tenant>
Region: <GLOBAL or EU>
Exact host/path: <allowedHost><allowedPathPrefix>
Operation: LIST_JOBS only
Request/page/record/byte/time/retry/redirect caps: <exact configured values>
Policy reference and expiry: <exact reference and timestamp>
Capability expiry: <exact timestamp>
I approve one owner-started bounded GET discovery run for this exact capability. Candidate data outbound is zero fields. Application URLs remain inert.
```

Then, in `/sources`, type `RUN <capabilityId>` and select the explicit owner-confirmation checkbox. Both the external approval record and the fresh UI action are required. A changed, expired, revoked, unapproved, ambiguous, or differently versioned capability fails closed. There is no scheduler, automatic resume, tenant enumeration, credential path, POST, or blind retry.

## Approval B — first real employer target interaction

Before opening any real employer page, the exact private packet and one immutable schema-v2 capability for the reviewed adapter must be prepared offline. The approved capability version must be persisted through the owner surface before an owner-started run. The owner must provide this exact approval record outside Git:

```text
OWNER APPROVAL — FIRST REAL EMPLOYER TARGET INTERACTION
Target capability ID: <capabilityId>
Capability version: <version>
Capability digest: <exact approved configuration digest>
Exact origin/path prefix: <allowedOrigin><allowedPathPrefix>
Adapter/form version: <adapterVersion>/<formVersion>
Packet ID and digest: <packetId>/<packetDigest>
Job/profile/evaluation versions: <exact IDs>
Document/answer/disclosure digests: <exact digests>
Allowed operations: OPEN_AND_INSPECT_ONLY only
Policy/capability expiry: <exact timestamps>
I approve one owner-started read-only inspection with this exact target, capability version/digest, and frozen packet. I understand it may make GET/HEAD requests needed to load that page, but sends zero candidate fields and performs no clicks, writes, uploads, authentication, or submission. Any authentication, CAPTCHA, MFA, bot, access, rate, destination, page, form, popup, download, write request, hidden step, unsupported control, or version change must stop.
```

In `/applications`, first persist the exact approved capability by typing `APPROVE <capabilityId>` and selecting its checkbox. Starting the inspection remains a separate deliberate owner action. The inspection adapter is `lever-real-inspection-v2`, the form contract is `lever-application-inspection-v1`, and the capability operation list must equal `[OPEN_AND_INSPECT_ONLY]`. Upload or fill requires different future code and authority. Final submission always requires immediate owner review of the frozen packet and a fresh, short-lived, one-use consent bound to packet, destination, form, adapter, document, answer, and disclosure digests. A lost or ambiguous response is terminal `OUTCOME_UNKNOWN`; never retry it automatically.

## Offline release boundary

- Source-enabled Personal Beta: ready on the reviewed request #9 evidence; no active source capability or new-request authority.
- Target-independent application runner, binding, consent and recovery framework: ready for controlled synthetic validation only.
- Lever read-only real-target inspection lane: offline-ready; exact target approval and an owner-started validation run remain required.
- Real employer visit, fill, upload and submission authority: absent until separate exact approvals; inspection authority cannot grant application authority.
- Hosted production, scheduling, LinkedIn automation, CAPTCHA/MFA bypass, tenant enumeration, employer-form bypass and background submission: not authorised.
