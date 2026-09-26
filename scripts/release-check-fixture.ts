import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

const root = resolve(process.cwd());
const privateRoot = join(root, "data", "private");
const migrationRoot = join(root, "packages", "database", "drizzle");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const tsxEntry = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const migrationFiles = [
  "0000_applypilot_foundation.sql",
  "0001_real_world_job_intake.sql",
  "0002_personal_live_beta_core.sql",
  "0003_r2a_evidence_normalization.sql",
  "0004_r2_matching_quality.sql",
  "0005_r2_matching_quality_hardening.sql",
  "0006_r2_calibration_qualification.sql",
  "0007_personal_live_v1_enablement.sql",
  "0008_real_target_inspection_scope.sql",
  "0009_green_banner_session_grant.sql",
  "0010_verified_source_packet_binding.sql",
];

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function runNpm(args: string[], env: NodeJS.ProcessEnv): void {
  run(npmExecutable, args, env);
}

function runTsx(args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(process.execPath, [tsxEntry, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
}

const fixtureRoot = mkdtempSync(join(privateRoot, "release-fixture-"));
const databasePath = join(fixtureRoot, "applypilot.fixture.sqlite");
const allowlistFilename = `release-fixture-${process.pid}.json`;
const allowlistPath = join(privateRoot, allowlistFilename);

try {
  mkdirSync(privateRoot, { recursive: true });
  writeFileSync(allowlistPath, JSON.stringify({ schemaVersion: 2, capabilities: [] }) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
  const sqlite = new BetterSqlite3(databasePath);
  try {
    for (const filename of migrationFiles) {
      sqlite.exec(readFileSync(join(migrationRoot, filename), "utf8"));
    }
  } finally {
    sqlite.close();
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APPLYPILOT_DB_PATH: databasePath,
    APPLYPILOT_SOURCE_ALLOWLIST_FILENAME: allowlistFilename,
    APPLYPILOT_SYNTHETIC_MODE: "1",
  };
  const fixtureReadinessEnv = {
    ...env,
    APPLYPILOT_SOURCE_BETA_RELEASE_FILENAME: `release-fixture-${process.pid}.json`,
  };
  const qualityEnv = { ...process.env };
  delete qualityEnv.APPLYPILOT_DB_PATH;
  delete qualityEnv.APPLYPILOT_SOURCE_ALLOWLIST_FILENAME;
  delete qualityEnv.APPLYPILOT_SOURCE_BETA_RELEASE_FILENAME;
  delete qualityEnv.APPLYPILOT_SYNTHETIC_MODE;

  runNpm(["run", "doctor"], env);
  runNpm(["run", "db:status"], env);
  runTsx(["scripts/preflight-summary.ts", "--fixture"], fixtureReadinessEnv);
  runNpm(["run", "format:check"], qualityEnv);
  runNpm(["run", "lint"], qualityEnv);
  runNpm(["run", "typecheck"], qualityEnv);
  runNpm(["test"], qualityEnv);
  runNpm(["run", "test:integration"], qualityEnv);
  runNpm(["run", "build"], qualityEnv);
  runNpm(["run", "test:e2e"], qualityEnv);
  runNpm(["run", "privacy:audit"], qualityEnv);
  runNpm(["audit", "--audit-level=high"], qualityEnv);
  runNpm(["run", "audit:production"], qualityEnv);
  runTsx(["scripts/release-summary.ts", "--quality-gates-complete"], fixtureReadinessEnv);
  run("git", ["diff", "--check"], env);
  run("git", ["fsck", "--strict"], env);
  console.log(
    "RELEASE_FIXTURE_CHECK PASS fictional_runtime=disposable schema=10 private_profile_read=0",
  );
} finally {
  try {
    unlinkSync(allowlistPath);
  } catch {
    // The fixture may already have been cleaned up after a failed setup.
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}
