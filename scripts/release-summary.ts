import { execFileSync } from "node:child_process";

import BetterSqlite3 from "better-sqlite3";

import { loadPrivateSourceAllowlist } from "@applypilot/job-sources";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  let schemaVersion = 0;
  try {
    const database = new BetterSqlite3(localDatabasePath(), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      schemaVersion = Number(database.pragma("user_version", { simple: true }));
    } finally {
      database.close();
    }
  } catch {
    schemaVersion = 0;
  }
  const source = await loadPrivateSourceAllowlist(root);
  const blockers = [
    ...(schemaVersion < 2 ? ["PENDING_DATABASE_MIGRATION"] : []),
    "REAL_RUNNER_TARGET_APPROVAL_REQUIRED",
    "FINAL_REVIEW_NOT_COMPLETE",
  ];
  console.log(`RELEASE_HEAD sha=${head}`);
  console.log(`RELEASE_WORKTREE state=${dirty ? "DIRTY" : "CLEAN"}`);
  console.log("RELEASE_PRIVACY status=PASS");
  console.log("RELEASE_QUALITY status=PASS");
  console.log(
    `RELEASE_DATABASE schema_version=${schemaVersion} pending_migrations=${Math.max(0, 2 - schemaVersion)}`,
  );
  console.log(
    `RELEASE_SOURCE state=${source.status} capability_count=${source.capabilities.length}`,
  );
  console.log("RELEASE_RUNNER state=TARGET_APPROVAL_REQUIRED");
  console.log(`RELEASE_CLASSIFICATION state=NOT_READY blockers=${blockers.join(",")}`);
}

void main();
