# Offline Personal Live V1 enablement

Status: **OFFLINE FRAMEWORK READY; EXTERNAL ACTIVATION NOT AUTHORISED.**

The versioned R1A source authority, fictional Lever R1B integration, source-to-R2 queue pipeline, target-independent runner framework, durable recovery records, and owner approval surfaces are implemented. Automated validation uses fictional payloads and a loopback synthetic form only. This release does not select a tenant or employer, activate a real adapter, visit an employer form, upload a document, submit an application, or deploy ApplyPilot.

Schema `0007_personal_live_v1_enablement.sql` is additive. It stores immutable source and target capability versions, bounded source checkpoints/pages/raw observation payloads, frozen runner bindings, and safe recovery decisions. Migrations `0000`–`0006` are immutable.

## Approval A — first real Lever tenant GET

Before any real source call, the owner must create one ignored `data/private/source-allowlist.json` that passes schema v2, review the tenant’s current public-board context and applicable policy, and provide this exact approval record outside Git:

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

Before opening any real employer page, a reviewed real adapter and one ignored `data/private/runner-target-allowlist.json` must pass schema v1. The owner must provide this exact approval record outside Git:

```text
OWNER APPROVAL — FIRST REAL EMPLOYER TARGET INTERACTION
Target capability ID: <capabilityId>
Capability version: <version>
Exact origin/path prefix: <allowedOrigin><allowedPathPrefix>
Adapter/form version: <adapterVersion>/<formVersion>
Packet ID and digest: <exact frozen packet binding>
Permitted action for this approval: OPEN AND INSPECT ONLY
I approve one owner-started interaction with this exact target and frozen packet. This does not approve upload or final submission. Any authentication, CAPTCHA, MFA, bot, access, rate, destination, form, field, document, disclosure, or version change must stop.
```

In `/applications`, first persist the exact capability by typing `APPROVE <capabilityId>` and selecting its checkbox. A future reviewed real adapter must still require a separate owner-start control. Upload requires another purpose-specific approval. Final submission always requires immediate owner review of the frozen packet and a fresh, short-lived, one-use consent bound to packet, destination, form, adapter, document, answer, and disclosure digests. A lost or ambiguous response is terminal `OUTCOME_UNKNOWN`; never retry it automatically.

## Offline release boundary

- R1A capability/network enforcement: ready offline.
- Lever reader/pagination/checkpoints: ready with fictional fixtures only.
- Source observation, R2 normalization/evaluation and review-queue wiring: ready offline.
- Target-independent runner, binding, consent and recovery framework: ready with synthetic fixtures only.
- Real source GET, employer visit, upload and submission authority: absent until the exact approvals above and a separately reviewed activation run.
- Hosted production, scheduling, LinkedIn automation, CAPTCHA/MFA bypass, tenant enumeration, employer-form bypass and background submission: not authorised.
