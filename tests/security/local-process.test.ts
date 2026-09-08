import { describe, expect, it } from "vitest";

import {
  assertConfiguredLocalHost,
  processMatchesMetadata,
  type OwnedProcessMetadata,
} from "../../scripts/lib/local-process";

const root = "C:\\My Projects\\ApplyPilot";
const metadata: OwnedProcessMetadata = {
  version: 1,
  application: "applypilot",
  pid: 4242,
  ownerMarker: "89a2c154-47ba-4e92-964d-48f130f4f593",
  startedAt: "2026-09-08T00:00:00.000Z",
  repositoryRoot: root,
  entrypoint: "local-server-process.ts",
  host: "127.0.0.1",
  port: 3000,
};

describe("owned local process safety", () => {
  it("accepts only the exact loopback host", () => {
    expect(assertConfiguredLocalHost()).toBe("127.0.0.1");
    expect(() => assertConfiguredLocalHost("0.0.0.0")).toThrow("UNSAFE_LOCAL_HOST");
    expect(() => assertConfiguredLocalHost("localhost")).toThrow("UNSAFE_LOCAL_HOST");
  });

  it("matches the recorded marker, entrypoint, pid, root, and start time", () => {
    expect(
      processMatchesMetadata(
        metadata,
        {
          pid: 4242,
          commandLine: `node local-server-process.ts --owner-marker ${metadata.ownerMarker}`,
          createdAt: "2026-09-08T00:00:01.000Z",
        },
        root,
      ),
    ).toBe(true);
  });

  it("rejects stale PID reuse before any termination", () => {
    expect(
      processMatchesMetadata(
        metadata,
        {
          pid: 4242,
          commandLine: `node local-server-process.ts --owner-marker ${metadata.ownerMarker}`,
          createdAt: "2026-09-08T00:10:00.000Z",
        },
        root,
      ),
    ).toBe(false);
  });

  it("rejects an unrelated process with the same PID", () => {
    expect(
      processMatchesMetadata(
        metadata,
        {
          pid: 4242,
          commandLine: "node unrelated-server.js",
          createdAt: metadata.startedAt,
        },
        root,
      ),
    ).toBe(false);
  });
});
