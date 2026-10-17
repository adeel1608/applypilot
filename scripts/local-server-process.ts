import { createServer } from "node:http";
import { join } from "node:path";

import next from "next";

import { assertConfiguredLocalHost, configuredLocalPort, localHost } from "./lib/local-process";
import { repositoryRoot, localDatabasePath } from "./lib/runtime-safety";
import { assertHostedOwnedStartup } from "./lib/hosted-startup";

async function main(): Promise<void> {
  const markerIndex = process.argv.indexOf("--owner-marker");
  const marker = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
  if (!marker || marker !== process.env.APPLYPILOT_OWNED_PROCESS_MARKER) {
    throw new Error("OWNED_PROCESS_MARKER_REQUIRED");
  }
  const host = assertConfiguredLocalHost();
  const reviewedBuild = assertHostedOwnedStartup(repositoryRoot(), localDatabasePath()).build;
  const port = configuredLocalPort();
  const app = next({
    dev: false,
    dir: join(repositoryRoot(), "apps", "web"),
    hostname: host,
    port,
  });
  await app.prepare();
  const server = createServer(app.getRequestHandler());

  async function shutdown(): Promise<void> {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await app.close();
  }

  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  server.listen(port, localHost, () =>
    console.log(
      `LOCAL_SERVER_READY host=${localHost} port=${port} head=${reviewedBuild.head} tree=${reviewedBuild.tree} build=${reviewedBuild.buildDigest}`,
    ),
  );
}

void main();
