# Local release and recovery runbook

Status: executable **offline Personal Live V1 enablement READY** local operations. These commands do not activate an R1 tenant, a real application target, scheduling, hosting, upload, submission, or deployment. Source-enabled Personal Beta remains `WAITING_FOR_APPROVED_TENANT` and the real runner remains `TARGET_APPROVAL_REQUIRED`. Follow the separate exact approvals in [OFFLINE_GO_LIVE_ENABLEMENT](OFFLINE_GO_LIVE_ENABLEMENT.md).

## Current local commands

Use repository root, Node 24, reviewed lockfile and personal account `adeel1608`. Read `AGENTS.md` and `PROJECT_PLAN.md`, inspect Git state and do not silently ignore failed native dependency installation.

```powershell
gh api user --jq ".login"
git status --short --branch
npm.cmd run profile:validate
npm.cmd run doctor
npm.cmd run preflight
npm.cmd run db:migrate
```

Migration previews the exact path and pending versions. `npm.cmd run db:migrate -- --confirm` creates and verifies a consistent ignored backup before applying additive migrations, then verifies schema, integrity, and foreign keys. No startup migration occurs. Never put private values in command arguments/output.

```powershell
npm.cmd run local:start
# use the loopback URL reported by the command
npm.cmd run local:stop
```

Use `/profile`, `/import`, `/jobs` and detail, `/applications`, and `/sources` for supervised local intake. Source URLs do not authorise fetching. Missing/invalid private profile never falls back to demo. `local:start` binds only `127.0.0.1`, disables synthetic routes, does not migrate or call a source, and records ownership metadata below ignored `data/private/runtime`. `local:stop` terminates only the verified owned process. No public bind/tunnel; local-first does not mean internet-safe. Do not delete runtime files to reset state.

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run privacy:audit
npm.cmd run release:check
npm.cmd audit
npm.cmd run audit:production
git diff --check
```

CI runs install, format, lint, typecheck, unit/integration, build, and browser checks with read-only permissions and immutable action revisions. Local private-profile/database smoke and local history/artifact/privacy evidence remain additional because CI never receives those private assets.

### Private-data isolation during local tests

E2E uses a fictional DB on port 3100 but its default profile provider still resolves root `data/profile.private.json`. Prefer a clean synthetic worktree. In an approved temporary hold workflow, stop the real app, validate exact source/destination inside ignored `data/private`, require absent destination, compare bytes in memory, use native PowerShell move, and restore in `finally`. No printed values/hashes. On interruption, stop tests and restore the held file without overwriting another file; verify equality/schema. Never delete the held profile, vacancy or real DB.

Real acceptance must not use the recording-enabled E2E config. Use a separate context with screenshot/video/trace capture off and no saved authentication state. Scan test/build artifacts for private content before publication. All original runtime paths must remain ignored/untracked afterward.

## Implemented tool acceptance contracts

| Command                        | Safe output / effects                                                         | Acceptance and failure behavior                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run doctor`               | Versions, root/path consistency, profile/DB/port/capability status; read-only | No config/profile/token values; wrong root/missing dependency/unsafe binding -> stable nonzero code     |
| `npm run preflight`            | Mode checklist and policy expiry; read-only                                   | Missing gate blocks; never enables a provider implicitly                                                |
| `npm run db:status`            | Schema/counts/integrity/FKs; read-only                                        | No rows; distinguish locked/corrupt/unknown schema                                                      |
| `npm run migration:status`     | Applied/pending versions/rollback compatibility                               | No mutation; actual migration requires backup/confirmation                                              |
| `npm run privacy:audit`        | File/commit/category findings only                                            | Scan index/tracked/all refs/history/build/maps/traces/static/tests/PR/CI; unavailable scope is not PASS |
| `npm run quality`              | Named gates, exit codes, exact counts                                         | Run all gates with synthetic isolation; do not suppress failures                                        |
| `npm run release:check`        | Exact head, approved capabilities, blockers                                   | Stale CI/missing review/unverified privacy -> not ready                                                 |
| `npm run local:start`          | Owned PID/loopback URL/status                                                 | Fail unsafe binding/root/port collision; no auto-migrate                                                |
| `npm run local:stop`           | Owned shutdown/checkpoint status                                              | No unrelated process kill or data deletion                                                              |
| `npm run backup`               | Backup ID/time/schema/count/integrity                                         | Consistent protected snapshot; no overwrite; retention requires owner choice                            |
| `npm run restore -- --preview` | Compatibility/destination status                                              | Separate restore verification first; replacement requires owner confirmation                            |

Interfaces use bounded schemas, safe enums/counts, and predictable statuses. Missing/malformed/corrupt/collision/interrupted recovery cases are covered with fictional fixtures. No command automatically merges pull requests or submits applications.

### Approved private Beta smoke

`npm.cmd run smoke:private-beta` is a mutating, local-only acceptance command. Run it only after a verified backup and migration, with the owned app stopped and the exact private profile/job already reviewed. It re-evaluates the existing job, generates confined create-new artifacts, prepares a review-required packet, and records timeline events. Its output contains safe counts/statuses only. Do not rerun it casually: each successful run deliberately creates new immutable evaluation, artifact, packet, and event records. It never calls a source or visits/submits an employer form.

## Backup, restore, migration and browser recovery

1. Stop owned app/runner/schedules; record safe versions/counts; preserve pending/OUTCOME_UNKNOWN actions for reconciliation.
2. Use SQLite backup API or consistent stopped/checkpointed snapshot. Copying a lone live DB without WAL is insufficient. Profile/documents need separately consented protected backups; never Git/CI.
3. Verify integrity/FKs/schema/manifest and store in owner-approved encrypted/ACL-protected destination. Retention/deletion needs preview/confirmation. Current migration backups are not a full encrypted restore system.
4. Restore into a new confined ignored location first. Check schema/version/count/FK/integrity/artifact digests and application consistency. Rehearse with synthetic data; do not silently replace live data.
5. Only with owner approval and stopped writers, perform recoverable exact-target replacement retaining the original. No ad hoc SQL repair/down-migration. Keep rollback snapshot until accepted.
6. Restart loopback-only, verify safe status/freshness, do not resume discovery/browser/submission automatically.

Schema mismatch/corruption/disk full: stop writes, preserve files, request reviewed recovery; never create a blank replacement silently. Browser expiry/auth/CAPTCHA/MFA: pause for legitimate manual owner interaction and explicit resume. Lost submit response: OUTCOME_UNKNOWN, owner checks visible receipt/history; never auto-retry. Logical rollback preserves an irreversible submission event even if the owner later withdraws.

For an owner-started source run that stops after one or more committed pages, never delete the stopped run or its observations and never resume automatically. A fresh owner restart begins a new bounded run. Only after that run completes, capability-scoped reconciliation includes current jobs from earlier stopped runs, reuses any current R2 evaluation, creates only missing evaluation/queue state, and leaves an exact replay unchanged. Lever requests remain exact canonical GETs with zero redirects throughout.

## Publication/release and incident boundaries

Verify personal CLI identity, `adeel1608/applypilot`, exact branch/head and PUBLIC visibility. Audit new commits, index, tracked files, advertised refs/history, PR body and CI artifacts/logs. `.env.example` is allowed only as reviewed non-secret local defaults; all npm `private: true` guards stay unchanged. Stage explicit safe paths, inspect staged scope/diff, push feature branch and open PR; final-head CI and human review are separate gates. No private diagnostics in PRs.

Require the [go-live checklist](GO_LIVE_CHECKLIST.md), [threat model](THREAT_MODEL_V1.md), [source approvals](SOURCE_CAPABILITY_MATRIX.md), owner smoke and exact reviewed head. Unavailable checks are blocked. This mission can merge only already-approved PR8; the new activation/master-plan PR stays unmerged.

Suspected leak: halt publication/affected operations, report only safe paths/commits, preserve evidence and seek owner-directed remediation. Credential revocation, visibility reversal, history rewrite, artifact deletion and private-data erasure need appropriate separate authority. Public copies may persist permanently.
