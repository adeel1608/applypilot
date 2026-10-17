import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { databaseSchemaStatus } from "./lib/database-schema";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";
import { personalLiveV1Readiness } from "./lib/personal-live-readiness";
import { assertHostedQualityEvidence } from "@applypilot/application-runner";
import {
  operationalSourceReadiness,
  sourceEnabledBetaReleaseReadiness,
} from "./lib/source-readiness";
import {
  firstRealTargetValidationReadiness,
  type FirstRealTargetValidationReadiness,
} from "./lib/target-readiness";

async function main(): Promise<void> {
  if (!process.argv.includes("--quality-gates-complete")) {
    throw new Error("RELEASE_QUALITY_GATES_NOT_CONFIRMED");
  }
  const root = repositoryRoot();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  const dirty = git("status", "--porcelain").length > 0;
  let qualityProven = false;
  try {
    assertHostedQualityEvidence(
      readFileSync(join(root, "data", "private", "runtime", "hosted-quality-evidence.json")),
      join(root, "apps", "web", ".next"),
      head,
      tree,
    );
    qualityProven = !dirty;
  } catch {
    /* An operator flag cannot substitute for frozen validation evidence. */
  }
  let schemaVersion = 0;
  let databaseIntegrity = "UNKNOWN";
  let foreignKeyIssues = 0;
  let targetValidation: FirstRealTargetValidationReadiness = {
    state: "REQUIRED",
    completedInspectionCount: 0,
  };
  try {
    const database = new BetterSqlite3(localDatabasePath(), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      schemaVersion = Number(database.pragma("user_version", { simple: true }));
      databaseIntegrity =
        database.pragma("integrity_check", { simple: true }) === "ok" ? "PASS" : "FAIL";
      foreignKeyIssues = (database.pragma("foreign_key_check") as unknown[]).length;
      targetValidation = firstRealTargetValidationReadiness(database);
    } finally {
      database.close();
    }
  } catch {
    schemaVersion = 0;
  }
  const source = await operationalSourceReadiness(root);
  const sourceBeta = await sourceEnabledBetaReleaseReadiness(root);
  const schemaStatus = databaseSchemaStatus(schemaVersion);
  const manualBetaBlockers = [
    ...(schemaStatus.pendingMigrations > 0 ? ["PENDING_DATABASE_MIGRATION"] : []),
    ...(schemaStatus.unsupported ? ["DATABASE_SCHEMA_UNSUPPORTED"] : []),
    ...(databaseIntegrity !== "PASS" ? ["DATABASE_INTEGRITY_FAILED"] : []),
    ...(foreignKeyIssues > 0 ? ["DATABASE_FOREIGN_KEY_ISSUES"] : []),
  ];
  console.log(`RELEASE_HEAD sha=${head}`);
  console.log(`RELEASE_WORKTREE state=${dirty ? "DIRTY" : "CLEAN"}`);
  console.log(
    `RELEASE_PRIVACY status=${qualityProven ? "PROVEN_BY_FROZEN_MATRIX" : "NOT_RECORDED"}`,
  );
  console.log(`RELEASE_QUALITY status=${qualityProven ? "OFFLINE_PROVEN" : "NOT_RECORDED"}`);
  console.log(
    `RELEASE_DATABASE schema_version=${schemaVersion} pending_migrations=${schemaStatus.pendingMigrations} integrity=${databaseIntegrity} foreign_key_issues=${foreignKeyIssues}`,
  );
  console.log(
    `RELEASE_SOURCE state=${source.state} capability_count=${source.configuredCapabilityCount} active_capability_count=${source.activeCapabilityCount}`,
  );
  console.log(
    `RELEASE_RUNNER state=TARGET_APPROVAL_REQUIRED first_real_target_validation=${targetValidation.state} completed_inspection_count=${targetValidation.completedInspectionCount}`,
  );
  console.log(
    `RELEASE_MANUAL_INTAKE_BETA state=${manualBetaBlockers.length === 0 ? "READY" : "NOT_READY"} blockers=${manualBetaBlockers.length ? manualBetaBlockers.join(",") : "none"}`,
  );
  console.log(
    `RELEASE_SOURCE_ENABLED_BETA state=${sourceBeta.state} active_capability_count=${source.activeCapabilityCount}`,
  );
  const personalLiveBlockers = [
    ...(() => {
      let db: BetterSqlite3.Database | null = null;
      try {
        if (schemaVersion > 0)
          db = new BetterSqlite3(localDatabasePath(), { readonly: true, fileMustExist: true });
        return personalLiveV1Readiness(root, db, head, tree, manualBetaBlockers.length === 0)
          .blockers;
      } catch {
        return ["DATABASE_EVIDENCE_READ_FAILED"];
      } finally {
        db?.close();
      }
    })(),
  ];
  console.log(
    `RELEASE_PERSONAL_LIVE_V1 state=${personalLiveBlockers.length ? "NOT_READY" : "PERSONAL_LIVE_V1_READY"} blockers=${personalLiveBlockers.length ? personalLiveBlockers.join(",") : "none"}`,
  );
  console.log(
    `RELEASE_CLASSIFICATION state=${manualBetaBlockers.length === 0 && sourceBeta.state === "READY" ? "SOURCE_ENABLED_PERSONAL_BETA_READY" : manualBetaBlockers.length === 0 ? "MANUAL_INTAKE_BETA_READY" : "NOT_READY"} deferred=REAL_TARGET_APPROVAL`,
  );
}

void main();
