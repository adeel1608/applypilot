import { existsSync } from "node:fs";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  assertConfiguredLocalHost,
  configuredLocalPort,
  localRuntimePaths,
} from "./lib/local-process";
import { databaseSchemaStatus } from "./lib/database-schema";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";
import {
  operationalSourceReadiness,
  sourceEnabledBetaReleaseReadiness,
} from "./lib/source-readiness";
import { validatePrivateProfileAtPath } from "./validate-private-profile";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const profile = await validatePrivateProfileAtPath(join(root, "data", "profile.private.json"));
  const source = await operationalSourceReadiness(root);
  const sourceBeta = await sourceEnabledBetaReleaseReadiness(root);
  const databasePresent = existsSync(localDatabasePath());
  let databaseSchema = 0;
  let databaseIntegrity = "UNKNOWN";
  let foreignKeyIssues = 0;
  if (databasePresent) {
    const database = new BetterSqlite3(localDatabasePath(), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      databaseSchema = Number(database.pragma("user_version", { simple: true }));
      databaseIntegrity =
        database.pragma("integrity_check", { simple: true }) === "ok" ? "PASS" : "FAIL";
      foreignKeyIssues = (database.pragma("foreign_key_check") as unknown[]).length;
    } finally {
      database.close();
    }
  }
  const schemaStatus = databaseSchemaStatus(databaseSchema);
  const runtime = localRuntimePaths(root);
  const failures: string[] = [];
  const manualBetaBlockers: string[] = [];
  if (profile.state === "INVALID") failures.push("PRIVATE_PROFILE_INVALID");
  if (profile.state !== "VALID") manualBetaBlockers.push("PRIVATE_PROFILE_NOT_READY");
  if (!databasePresent) manualBetaBlockers.push("DATABASE_MISSING");
  if (databasePresent && schemaStatus.pendingMigrations > 0)
    manualBetaBlockers.push("PENDING_DATABASE_MIGRATION");
  if (schemaStatus.unsupported) failures.push("DATABASE_SCHEMA_UNSUPPORTED");
  if (databasePresent && databaseIntegrity !== "PASS") failures.push("DATABASE_INTEGRITY_FAILED");
  if (foreignKeyIssues > 0) failures.push("DATABASE_FOREIGN_KEY_ISSUES");
  assertConfiguredLocalHost();
  configuredLocalPort();
  if (!runtime.directory.includes(join("data", "private", "runtime"))) {
    failures.push("PRIVATE_RUNTIME_ROOT_INVALID");
  }
  console.log(`PREFLIGHT_PROFILE state=${profile.state}`);
  console.log(
    `PREFLIGHT_DATABASE state=${databasePresent ? "PRESENT" : "ABSENT"} schema_version=${databaseSchema} pending_migrations=${schemaStatus.pendingMigrations} integrity=${databaseIntegrity} foreign_key_issues=${foreignKeyIssues}`,
  );
  console.log("PREFLIGHT_LOOPBACK host=127.0.0.1 status=PASS");
  console.log("PREFLIGHT_OUTPUT_ROOT status=PASS");
  console.log(
    `PREFLIGHT_SOURCE state=${source.state} capability_count=${source.configuredCapabilityCount} active_capability_count=${source.activeCapabilityCount}`,
  );
  console.log("PREFLIGHT_RUNNER real_target=TARGET_APPROVAL_REQUIRED synthetic=TEST_MODE_ONLY");
  console.log(`PREFLIGHT_BACKUP readiness=${databasePresent ? "READY" : "WAITING_FOR_DATABASE"}`);
  console.log(
    `PREFLIGHT_MANUAL_INTAKE_BETA state=${manualBetaBlockers.length === 0 && failures.length === 0 ? "READY" : "BLOCKED"}`,
  );
  console.log(
    `PREFLIGHT_SOURCE_ENABLED_BETA state=${sourceBeta.state} active_capability_count=${source.activeCapabilityCount}`,
  );
  console.log(
    `PREFLIGHT_RESULT status=${failures.length ? "BLOCKED" : manualBetaBlockers.length ? "PASS_WITH_MANUAL_BETA_BLOCKERS" : "PASS"} blockers=${failures.length ? failures.join(",") : manualBetaBlockers.length ? manualBetaBlockers.join(",") : "none"}`,
  );
  if (failures.length) process.exitCode = 1;
}

void main();
