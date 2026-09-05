# Deployment Strategy

## Current state

Phase 0/1 is local-only and is not deployed. The repository must not be deployed until Phase 19 planning, threat modeling, and acceptance criteria are approved.

## Preferred future topology

A hybrid topology separates convenience from sensitive execution:

```text
Cloud dashboard/backend                 Local ApplyPilot Runner
- non-sensitive job index               - authenticated browsers
- reviewed match summaries   <------>    - cookies and session state
- application event metadata            - private candidate profile
- opt-in scheduling                      - CV and cover-letter files
- encrypted coordination                 - assisted form filling
                                         - final human confirmation
```

The connection must be authenticated, encrypted, least privilege, revocable, and explicit about which fields cross the boundary. Browser credentials and personal documents stay local by default.

## Alternatives

- Fully local: strongest privacy and simplest trust model, but remote access, resilient scheduling, and multi-device use are limited.
- Fully cloud-hosted: simplest availability, but centralizes browser credentials and highly sensitive candidate data. This is not preferred without materially stronger isolation, encryption, consent, and operational controls.
- Desktop wrapper: good local integration but adds packaging, signing, auto-update, and platform support work.

## Pre-deployment gates

- Data classification and retention policy.
- Threat model for dashboard, API, runner pairing, update channel, and browser automation.
- Authentication, authorization, encryption in transit/at rest, rotation, and recovery.
- Database migration plus backup/restore rehearsal.
- Secret scanning, dependency policy, SAST, logging redaction, and incident response.
- Staging E2E tests with synthetic identities and approved synthetic sites.
- Explicit rollback and local-runner version compatibility plan.
- Human confirmation UX and audit evidence review.

No paid hosting or provider is required by the base architecture. Provider selection remains an open Phase 19 decision.
