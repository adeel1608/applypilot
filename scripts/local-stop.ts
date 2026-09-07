import { rmSync } from "node:fs";

import {
  inspectProcess,
  localRuntimePaths,
  processMatchesMetadata,
  readOwnedProcessMetadata,
  waitForPort,
} from "./lib/local-process";
import { repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const paths = localRuntimePaths(root);
  const metadata = readOwnedProcessMetadata(paths.metadata);
  if (!metadata) {
    console.log("LOCAL_STOP_PASS state=already_stopped");
  } else {
    const observed = inspectProcess(metadata.pid);
    if (!observed) {
      rmSync(paths.metadata, { force: true });
      console.log(`LOCAL_STOP_PASS state=stale_metadata_cleared pid=${metadata.pid}`);
    } else {
      if (!processMatchesMetadata(metadata, observed, root)) {
        throw new Error("PROCESS_IDENTITY_MISMATCH_REFUSING_TERMINATION");
      }
      process.kill(metadata.pid, "SIGTERM");
      if (!(await waitForPort(metadata.port, false))) throw new Error("LOCAL_SERVER_STOP_TIMEOUT");
      rmSync(paths.metadata, { force: true });
      console.log(`LOCAL_STOP_PASS state=stopped pid=${metadata.pid} port=${metadata.port}`);
    }
  }
}

void main();
