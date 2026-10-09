import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import BetterSqlite3 from "better-sqlite3";

const root = resolve(process.cwd());
const privateRoot = join(root, "data", "private");
const migrationRoot = join(root, "packages", "database", "drizzle");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const tsxEntry = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const prettierEntry = resolve(root, "node_modules", "prettier", "bin", "prettier.cjs");
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
  "0011_immutable_r2a_derivation_bindings.sql",
  "0012_source_owner_action_receipts.sql",
  "0013_exact_source_request_binding.sql",
  "0014_hosted_application_workflow.sql",
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

function runPrettierCheck(env: NodeJS.ProcessEnv): void {
  // Git's Windows autocrlf checkout can materialize tracked LF files as CRLF.
  // Prettier's structural check remains strict; `auto` only accepts the
  // checkout's existing line-ending convention so fixture release evidence
  // is reproducible locally and on the LF-based CI checkout.
  execFileSync(process.execPath, [prettierEntry, "--check", ".", "--end-of-line", "auto"], {
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
  runPrettierCheck(qualityEnv);
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
    "RELEASE_FIXTURE_CHECK PASS fictional_runtime=disposable schema=14 private_profile_read=0",
  );
} finally {
  try {
    unlinkSync(allowlistPath);
  } catch {
    // The fixture may already have been cleaned up after a failed setup.
  }
  const cleanupPath = resolve(fixtureRoot);
  const cleanupRelative = relative(resolve(privateRoot), cleanupPath);
  if (
    !basename(cleanupPath).startsWith("release-fixture-") ||
    !cleanupRelative ||
    cleanupRelative === ".." ||
    cleanupRelative.startsWith(`..${sep}`) ||
    isAbsolute(cleanupRelative)
  )
    throw new Error("RELEASE_FIXTURE_CLEANUP_ESCAPE");
  rmSync(cleanupPath, { recursive: true, force: true });
}
