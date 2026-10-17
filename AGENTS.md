# ApplyPilot Repository Instructions

These instructions apply to every file and directory in this repository.

## Plan-first workflow

Every major task, feature, phase, refactor, integration, or deployment must follow this sequence:

1. Inspect the repository, Git status, current branch, and relevant implementation.
2. Read this file and `PROJECT_PLAN.md` in full.
3. Update the implementation blueprint in `PROJECT_PLAN.md` before changing application code.
4. Record the current state, objective, assumptions, requirements, architecture, proposed file changes, data flow, dependencies, risks, security and privacy concerns, testing strategy, rollback strategy, acceptance criteria, and exact implementation steps.
5. Implement only after the blueprint reflects the intended work.
6. Run the applicable lint, typecheck, unit tests, integration tests, and production build.
7. Update `PROJECT_PLAN.md` with the commands run, actual results, unfinished work, blockers, and the next recommended task.

Never silently change architecture, skip a failed check, or claim unverified behavior. `PROJECT_PLAN.md` is the living source of truth and must be updated by every future Codex task.

## Product safety invariants

- Candidate-facing content may use only facts validated by the candidate truth store.
- Unknown facts remain unknown and must never be inferred as true.
- Forbidden claims must never appear in generated CVs, cover letters, or application answers.
- `profile.private.json`, real application documents, identity documents, secrets, browser sessions, cookies, and local databases must never be committed.
- Final application submission always requires explicit human confirmation unless a future approved phase deliberately changes this invariant.
- Never bypass CAPTCHA, MFA, access controls, bot detection, rate limits, authentication protections, or website restrictions.
- LinkedIn remains assisted/manual discovery until technical and policy review explicitly approves a different mode.
- No live scraping or live job applications are permitted during Phase 0/1.

## Engineering expectations

- Keep the core local-first and usable without a paid service or API.
- Prefer deterministic, explainable domain behavior before optional AI integrations.
- Validate untrusted data at system boundaries with Zod.
- Keep source-specific behavior behind the shared job-source adapter contract.
- Record material state transitions and generated artifacts in the audit model.
- Use fixtures and mocks for job-board behavior until the relevant adapter phase.
- Preserve existing user changes and avoid destructive Git commands.
- Work on a feature branch. For the owner-authorized local release scope, use the versioned owner-delegated AI review policy in `config/owner-delegated-review-policy.json` and `docs/OWNER_DELEGATED_REVIEW_POLICY.md`: two substantive AI passes, complete cumulative coverage, resolved blocking findings, passing quality/CI and guarded PR merge. No human plan, implementation or technical release review is required for that scope. Other scopes retain their existing merge rules.

## Current technical review policy

The owner's 2026-10-17 instruction prospectively supersedes older human-only technical review requirements for PR #79, this policy amendment and fixes needed for the existing local personal release. The lifecycle is PLAN -> OWNER-DELEGATED AI PLAN REVIEW -> IMPLEMENT -> TEST -> AI TECHNICAL REVIEW -> GUARDED MERGE -> FRESH MERGED-BUILD VALIDATION -> SEALED ROLLOUT. Historical reviews are never relabelled as human approvals. AI activity remains explicitly AI-authored, including when published through the owner's GitHub account.

Source reads, candidate truth/choices, target inspection/disclosure, packet/preview authorization, final application-specific one-use submission consent and operational release evidence remain subject to their existing owner gates. Technical review delegation does not authorize these actions.

## Completion gate

A task is not complete until its acceptance criteria and validation requirements in `PROJECT_PLAN.md` are satisfied, or its remaining items are explicitly recorded as blocked. Failed or unavailable checks must be reported with their exact reason.
