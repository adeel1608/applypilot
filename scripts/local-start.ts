import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  assertConfiguredLocalHost,
  closeRuntimeLog,
  configuredLocalPort,
  inspectProcess,
  isPortOpen,
  localRuntimePaths,
  openPrivateRuntimeLog,
  processMatchesMetadata,
  readOwnedProcessMetadata,
  safeEntrypointName,
  waitForPort,
  writeOwnedProcessMetadata,
} from "./lib/local-process";
import { repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const host = assertConfiguredLocalHost();
  const port = configuredLocalPort();
  const paths = localRuntimePaths(root);
  const existing = readOwnedProcessMetadata(paths.metadata);
  if (existing) {
    const observed = inspectProcess(existing.pid);
    if (observed && processMatchesMetadata(existing, observed, root)) {
      throw new Error("LOCAL_SERVER_ALREADY_RUNNING");
    }
    if (observed) throw new Error("UNSAFE_EXISTING_PROCESS_METADATA");
    rmSync(paths.metadata, { force: true });
  }
  if (await isPortOpen(port)) throw new Error("LOCAL_PORT_ALREADY_IN_USE");

  const ownerMarker = randomUUID();
  const startedAt = new Date().toISOString();
  const entrypoint = join(root, "scripts", "local-server-process.ts");
  const log = openPrivateRuntimeLog(paths.log);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", entrypoint, "--owner-marker", ownerMarker],
    {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        APPLYPILOT_LOCAL_HOST: host,
        APPLYPILOT_LOCAL_PORT: String(port),
        APPLYPILOT_OWNED_PROCESS_MARKER: ownerMarker,
        APPLYPILOT_SYNTHETIC_MODE: "0",
      },
    },
  );
  closeRuntimeLog(log);
  if (!child.pid) throw new Error("LOCAL_SERVER_SPAWN_FAILED");
  writeOwnedProcessMetadata(paths.metadata, {
    version: 1,
    application: "applypilot",
    pid: child.pid,
    ownerMarker,
    startedAt,
    repositoryRoot: root,
    entrypoint: safeEntrypointName(entrypoint) as "local-server-process.ts",
    host,
    port,
  });
  child.unref();

  if (!(await waitForPort(port, true))) {
    const observed = inspectProcess(child.pid);
    const recorded = readOwnedProcessMetadata(paths.metadata);
    if (observed && recorded && processMatchesMetadata(recorded, observed, root)) {
      process.kill(child.pid, "SIGTERM");
      await waitForPort(port, false, 10_000);
      rmSync(paths.metadata, { force: true });
      throw new Error("LOCAL_SERVER_START_TIMEOUT");
    }
    throw new Error("LOCAL_SERVER_START_TIMEOUT_IDENTITY_UNVERIFIED");
  }
  if (!existsSync(paths.metadata)) throw new Error("LOCAL_PROCESS_METADATA_MISSING");
  console.log(`LOCAL_START_PASS host=${host} port=${port} pid=${child.pid}`);
}

void main();
