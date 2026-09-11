import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { operationalSourceReadiness } from "../../scripts/lib/source-readiness";

const roots: string[] = [];
const now = new Date("2026-09-11T00:00:00.000Z");

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "applypilot-source-readiness-"));
  roots.push(directory);
  await mkdir(join(directory, "data", "private"), { recursive: true });
  return directory;
}

function capability(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    capabilityId: "cap-fictional-preflight-001",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional preflight",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "owner-approval:fictional-preflight-001",
    approvedAt: "2026-09-10T00:00:00.000Z",
    policyVersion: "fictional-policy-v1",
    policyReviewedAt: "2026-09-10T00:00:00.000Z",
    policyExpiresAt: "2026-09-12T00:00:00.000Z",
    capabilityExpiresAt: "2026-09-12T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 25,
    pageSizeCap: 25,
    responseByteLimit: 2_000_000,
    requestTimeoutMs: 30_000,
    runTimeoutMs: 60_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2-fictional",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  };
}

async function writeAllowlist(directory: string, value: unknown): Promise<void> {
  await writeFile(
    join(directory, "data", "private", "source-allowlist.json"),
    JSON.stringify(value),
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("operational source readiness", () => {
  it("keeps the absent private authority in the waiting state", async () => {
    await expect(operationalSourceReadiness(await root(), now)).resolves.toEqual({
      state: "WAITING_FOR_APPROVED_TENANT",
      configuredCapabilityCount: 0,
      activeCapabilityCount: 0,
      inactiveReasons: [],
    });
  });

  it("accepts a strict current v2 authority used by the owner source UI", async () => {
    const directory = await root();
    await writeAllowlist(directory, { schemaVersion: 2, capabilities: [capability()] });
    await expect(operationalSourceReadiness(directory, now)).resolves.toMatchObject({
      state: "SOURCE_ALLOWLIST_V2_READY",
      configuredCapabilityCount: 1,
      activeCapabilityCount: 1,
      inactiveReasons: [],
    });
  });

  it.each([
    [{ capabilityExpiresAt: "2026-09-10T23:59:59.000Z" }, "CAPABILITY_EXPIRED"],
    [{ policyExpiresAt: "2026-09-10T23:59:59.000Z" }, "POLICY_EXPIRED"],
    [
      {
        approvalState: "REVOKED",
        approvalReference: null,
        approvedAt: null,
        revokedAt: "2026-09-10T23:00:00.000Z",
        revocationReason: "OWNER_REVOKED",
      },
      "REVOKED",
    ],
  ])("does not count an inactive v2 authority as runnable", async (overrides, reason) => {
    const directory = await root();
    await writeAllowlist(directory, {
      schemaVersion: 2,
      capabilities: [capability(overrides)],
    });
    await expect(operationalSourceReadiness(directory, now)).resolves.toMatchObject({
      configuredCapabilityCount: 1,
      activeCapabilityCount: 0,
      inactiveReasons: [{ status: "SOURCE_DISABLED", reason }],
    });
  });

  it("rejects the legacy or malformed document instead of reporting source authority", async () => {
    const directory = await root();
    await writeAllowlist(directory, { version: 1, capabilities: [] });
    await expect(operationalSourceReadiness(directory, now)).rejects.toThrow();
  });
});
