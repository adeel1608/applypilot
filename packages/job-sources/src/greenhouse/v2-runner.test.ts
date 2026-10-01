import { describe, expect, it, vi } from "vitest";

import {
  SecureSourceError,
  SourceCapabilityV2Schema,
  SourcePersistenceError,
  type SourceCapabilityV2,
  type SourcePersistenceDiagnostic,
  type GreenhouseSourceRunSink,
  type SecureSourceTransportDependencies,
} from "../index";
import { runGreenhouseSourceDiscovery } from "./v2-runner";

const instant = new Date("2026-09-10T00:00:00.000Z");

function capability(overrides: Partial<SourceCapabilityV2> = {}): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "greenhouse-runner-fixture",
    version: 1,
    predecessorVersion: null,
    source: "GREENHOUSE",
    alias: "Fictional Greenhouse",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "boards-api.greenhouse.io",
    allowedPathPrefix: "/v1/boards/fictional/",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "fixture-approval",
    approvedAt: instant.toISOString(),
    policyVersion: "fixture-policy",
    policyReviewedAt: instant.toISOString(),
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 1,
    pageSizeCap: 1,
    responseByteLimit: 100_000,
    requestTimeoutMs: 1_000,
    runTimeoutMs: 10_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "greenhouse-v2-fixture",
    createdAt: instant.toISOString(),
    updatedAt: instant.toISOString(),
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  });
}

function dependencies(): SecureSourceTransportDependencies {
  const body = Buffer.from(
    JSON.stringify({
      jobs: [
        {
          id: 42,
          title: "Fictional Data Analyst",
          absolute_url: "https://boards.greenhouse.io/fictional/jobs/42",
          location: { name: "Melbourne VIC" },
          content: "<p>Fictional role description.</p>",
          updated_at: "2026-09-09T00:00:00Z",
          departments: [],
          offices: [],
          metadata: [],
        },
      ],
    }),
  );
  return {
    resolveHost: vi.fn(async () => ["8.8.8.8"]),
    request: vi.fn(async ({ pinnedAddress }) => ({
      status: 200,
      headers: { "content-type": "application/json", "content-encoding": "identity" },
      body,
      connectedAddress: pinnedAddress,
    })),
  };
}

describe("Greenhouse v2 source runner", () => {
  it("preserves only the safe persistence diagnostic through stop", async () => {
    const persistenceDiagnostic: SourcePersistenceDiagnostic = {
      phase: "JOB_UPSERT",
      recordIndex: 0,
      externalIdHashPrefix: "0123456789ab",
      provider: "GREENHOUSE",
      sqliteCodeClass: "SQLITE_CONSTRAINT_UNIQUE",
      safeDomainCode: null,
      transactionRolledBack: true,
      pageProviderRecordCount: 1,
      acceptedRecordCount: 1,
      unusableRecordCount: 0,
    };
    const stop = vi.fn();
    const sink: GreenhouseSourceRunSink = {
      start: vi.fn(() => "run:greenhouse-fixture"),
      assertCapabilityCurrent: vi.fn(),
      persistGreenhousePage: vi.fn(() => {
        throw new SourcePersistenceError(persistenceDiagnostic);
      }),
      complete: vi.fn(),
      stop,
    };

    const result = await runGreenhouseSourceDiscovery({
      capability: capability(),
      sink,
      ownerReceiptChain: {
        approvalReceiptId: "fixture-approval-receipt",
        startReceiptId: "fixture-start-receipt",
      },
      now: () => instant,
      dependencies: dependencies(),
    });

    expect(result).toMatchObject({ status: "STOPPED", stopCode: "PERSISTENCE_FAILED" });
    expect(stop).toHaveBeenCalledOnce();
    expect(stop.mock.calls[0]?.[0]).toMatchObject({
      code: "PERSISTENCE_FAILED",
      persistenceDiagnostic,
    });
    expect(stop.mock.calls[0]?.[0]).not.toHaveProperty("rawError");
    expect(sink.complete).not.toHaveBeenCalled();
  });

  it("does not classify transport errors as persistence diagnostics", async () => {
    const stop = vi.fn();
    const failingDependencies = dependencies();
    vi.mocked(failingDependencies.request).mockRejectedValueOnce(
      new SecureSourceError("CONNECTION_REFUSED"),
    );
    const sink: GreenhouseSourceRunSink = {
      start: vi.fn(() => "run:greenhouse-transport-fixture"),
      assertCapabilityCurrent: vi.fn(),
      persistGreenhousePage: vi.fn(),
      complete: vi.fn(),
      stop,
    };

    const result = await runGreenhouseSourceDiscovery({
      capability: capability(),
      sink,
      ownerReceiptChain: {
        approvalReceiptId: "fixture-approval-receipt",
        startReceiptId: "fixture-start-receipt",
      },
      now: () => instant,
      dependencies: failingDependencies,
    });

    expect(result.stopCode).toBe("CONNECTION_REFUSED");
    expect(stop.mock.calls[0]?.[0]).not.toHaveProperty("persistenceDiagnostic");
  });
});
