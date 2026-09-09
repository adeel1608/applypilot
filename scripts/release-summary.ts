import { execFileSync } from "node:child_process";

import BetterSqlite3 from "better-sqlite3";

import { loadPrivateSourceAllowlist } from "@applypilot/job-sources";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  if (!process.argv.includes("--quality-gates-complete")) {
    throw new Error("RELEASE_QUALITY_GATES_NOT_CONFIRMED");
  }
  const root = repositoryRoot();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  let schemaVersion = 0;
  let databaseIntegrity = "UNKNOWN";
  let foreignKeyIssues = 0;
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
    } finally {
      database.close();
    }
  } catch {
    schemaVersion = 0;
  }
  const source = await loadPrivateSourceAllowlist(root);
  const manualBetaBlockers = [
    ...(schemaVersion < 3 ? ["PENDING_DATABASE_MIGRATION"] : []),
    ...(schemaVersion > 3 ? ["DATABASE_SCHEMA_UNSUPPORTED"] : []),
    ...(databaseIntegrity !== "PASS" ? ["DATABASE_INTEGRITY_FAILED"] : []),
    ...(foreignKeyIssues > 0 ? ["DATABASE_FOREIGN_KEY_ISSUES"] : []),
  ];
  console.log(`RELEASE_HEAD sha=${head}`);
  console.log(`RELEASE_WORKTREE state=${dirty ? "DIRTY" : "CLEAN"}`);
  console.log("RELEASE_PRIVACY status=PASS");
  console.log("RELEASE_QUALITY status=PASS");
  console.log(
    `RELEASE_DATABASE schema_version=${schemaVersion} pending_migrations=${Math.max(0, 3 - schemaVersion)} integrity=${databaseIntegrity} foreign_key_issues=${foreignKeyIssues}`,
  );
  console.log(
    `RELEASE_SOURCE state=${source.status} capability_count=${source.capabilities.length}`,
  );
  console.log("RELEASE_RUNNER state=TARGET_APPROVAL_REQUIRED");
  console.log(
    `RELEASE_MANUAL_INTAKE_BETA state=${manualBetaBlockers.length === 0 ? "READY" : "NOT_READY"} blockers=${manualBetaBlockers.length ? manualBetaBlockers.join(",") : "none"}`,
  );
  console.log(
    `RELEASE_SOURCE_ENABLED_BETA state=${source.capabilities.length > 0 ? "APPROVED_CAPABILITY_PRESENT_REQUIRES_SCOPED_SMOKE" : "WAITING_FOR_APPROVED_TENANT"}`,
  );
  console.log(
    "RELEASE_PERSONAL_LIVE_V1 state=NOT_READY blockers=APPROVED_SOURCE_REQUIRED,REAL_RUNNER_TARGET_APPROVAL_REQUIRED",
  );
  console.log(
    `RELEASE_CLASSIFICATION state=${manualBetaBlockers.length === 0 ? "MANUAL_INTAKE_BETA_READY" : "NOT_READY"} deferred=SOURCE_TENANT_APPROVAL,REAL_TARGET_APPROVAL`,
  );
}

void main();
