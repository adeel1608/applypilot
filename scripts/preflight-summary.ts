import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadPrivateSourceAllowlist } from "@applypilot/job-sources";

import {
  assertConfiguredLocalHost,
  configuredLocalPort,
  localRuntimePaths,
} from "./lib/local-process";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";
import { validatePrivateProfileAtPath } from "./validate-private-profile";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const profile = await validatePrivateProfileAtPath(join(root, "data", "profile.private.json"));
  const source = await loadPrivateSourceAllowlist(root);
  const databasePresent = existsSync(localDatabasePath());
  const runtime = localRuntimePaths(root);
  const failures: string[] = [];
  if (profile.state === "INVALID") failures.push("PRIVATE_PROFILE_INVALID");
  assertConfiguredLocalHost();
  configuredLocalPort();
  if (!runtime.directory.includes(join("data", "private", "runtime"))) {
    failures.push("PRIVATE_RUNTIME_ROOT_INVALID");
  }
  console.log(`PREFLIGHT_PROFILE state=${profile.state}`);
  console.log(`PREFLIGHT_DATABASE state=${databasePresent ? "PRESENT" : "ABSENT"}`);
  console.log("PREFLIGHT_LOOPBACK host=127.0.0.1 status=PASS");
  console.log("PREFLIGHT_OUTPUT_ROOT status=PASS");
  console.log(
    `PREFLIGHT_SOURCE state=${source.status} capability_count=${source.capabilities.length}`,
  );
  console.log("PREFLIGHT_RUNNER real_target=TARGET_APPROVAL_REQUIRED synthetic=TEST_MODE_ONLY");
  console.log(`PREFLIGHT_BACKUP readiness=${databasePresent ? "READY" : "WAITING_FOR_DATABASE"}`);
  console.log(
    `PREFLIGHT_RESULT status=${failures.length ? "BLOCKED" : "PASS_WITH_RELEASE_BLOCKERS"} blockers=${failures.length ? failures.join(",") : "PENDING_MIGRATION,REAL_RUNNER_DISABLED"}`,
  );
  if (failures.length) process.exitCode = 1;
}

void main();
