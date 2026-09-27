import { describe, expect, it, vi } from "vitest";

import {
  SecureSourceError,
  SourceCapabilityV2Schema,
  type SourceCapabilityV2,
  type SourceRunSink,
  type SecureSourceTransportDependencies,
} from "./index";
import { runLeverDetailSourceDiscovery } from "./source-runner";

const instant = new Date("2026-09-10T00:00:00.000Z");

function capability(overrides: Partial<SourceCapabilityV2> = {}): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "detail-fixture-cap",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional Company",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional",
    allowedOperations: ["GET_JOB"],
    approvalState: "APPROVED",
    approvalReference: "fixture-detail-approval",
    approvedAt: "2026-09-01T00:00:00.000Z",
    policyVersion: "detail-fixture-policy",
    policyReviewedAt: "2026-09-01T00:00:00.000Z",
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
    parserVersion: "lever-v2-detail-fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  });
}

function posting(id = "fixture-1") {
  return {
    id,
    text: "Fictional Detail Role",
    hostedUrl: `https://jobs.lever.co/fictional/${id}`,
    applyUrl: `https://jobs.lever.co/fictional/${id}/apply`,
    descriptionPlain: "Fictional detail evidence only.",
    categories: { location: "Melbourne VIC", allLocations: ["Melbourne VIC"] },
    country: "AU",
    workplaceType: "hybrid",
  };
}

function transport(payload: unknown, status = 200): SecureSourceTransportDependencies {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    resolveHost: vi.fn(async () => ["8.8.8.8"]),
    request: vi.fn(async ({ pinnedAddress }) => ({
      status,
      headers: { "content-type": "application/json", "content-encoding": "identity" },
      body,
      connectedAddress: pinnedAddress,
    })),
  };
}

function sink() {
  const calls = { start: 0, persisted: 0, complete: 0, stopped: 0 };
  const implementation: SourceRunSink & {
    persistDetail: NonNullable<SourceRunSink["persistDetail"]>;
  } = {
    start: vi.fn(() => {
      calls.start += 1;
      return "run:detail";
    }),
    assertCapabilityCurrent: vi.fn(),
    persistPage: vi.fn(),
    persistDetail: vi.fn(() => {
      calls.persisted += 1;
    }),
    complete: vi.fn(() => {
      calls.complete += 1;
    }),
    stop: vi.fn(() => {
      calls.stopped += 1;
    }),
  };
  return { implementation, calls };
}

describe("durable Lever GET_JOB source runner", () => {
  it("uses one exact request and completes with one persisted record", async () => {
    const target = sink();
    const dependencies = transport(posting());
    const result = await runLeverDetailSourceDiscovery({
      capability: capability(),
      sink: target.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies,
    });
    expect(result).toMatchObject({
      operation: "GET_JOB",
      status: "COMPLETE",
      terminalState: "COMPLETE",
      externalId: "fixture-1",
      requestCount: 1,
      pageCount: 1,
      recordCount: 1,
      acceptedRecordCount: 1,
    });
    expect(vi.mocked(dependencies.request)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dependencies.request).mock.calls[0]?.[0].url.toString()).toBe(
      "https://api.lever.co/v0/postings/fictional/fixture-1?mode=json",
    );
    expect(target.calls).toEqual({ start: 1, persisted: 1, complete: 1, stopped: 0 });
  });

  it("fails closed without transport when GET_JOB is not approved", async () => {
    const target = sink();
    const dependencies = transport(posting());
    const result = await runLeverDetailSourceDiscovery({
      capability: capability({ allowedOperations: ["LIST_JOBS"] }),
      sink: target.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies,
    });
    expect(result.status).toBe("STOPPED");
    expect(result.stopCode).toBe("OPERATION_NOT_APPROVED");
    expect(result.terminalState).toBe("STOPPED");
    expect(dependencies.request).not.toHaveBeenCalled();
    expect(target.calls.persisted).toBe(0);
  });

  it("classifies not-found, redirect, and response identity failures without retry", async () => {
    const notFound = sink();
    const missing = await runLeverDetailSourceDiscovery({
      capability: capability(),
      sink: notFound.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies: transport({}, 404),
    });
    expect(missing.terminalState).toBe("NOT_FOUND");
    expect(missing.stopCode).toBe("DETAIL_NOT_FOUND");
    expect(notFound.calls.persisted).toBe(0);

    const redirected = sink();
    const redirectResult = await runLeverDetailSourceDiscovery({
      capability: capability(),
      sink: redirected.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies: transport({}, 302),
    });
    expect(redirectResult.stopCode).toBe("REDIRECT_FORBIDDEN");
    expect(redirected.calls.persisted).toBe(0);

    const mismatch = sink();
    const mismatchResult = await runLeverDetailSourceDiscovery({
      capability: capability(),
      sink: mismatch.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies: transport(posting("other-id")),
    });
    expect(mismatchResult.stopCode).toBe("SOURCE_DETAIL_ID_MISMATCH");
    expect(mismatch.calls.persisted).toBe(0);
  });

  it("does not retry an ambiguous transport failure", async () => {
    const target = sink();
    const request = vi.fn(async () => {
      throw new SecureSourceError("NETWORK_OUTCOME_UNKNOWN", null, "REQUEST_CREATED");
    });
    const result = await runLeverDetailSourceDiscovery({
      capability: capability(),
      sink: target.implementation,
      externalId: "fixture-1",
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request,
      },
    });
    expect(result.stopCode).toBe("NETWORK_OUTCOME_UNKNOWN");
    expect(request).toHaveBeenCalledTimes(1);
    expect(target.calls.persisted).toBe(0);
  });
});
