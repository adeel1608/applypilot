import { describe, expect, it, vi } from "vitest";

import {
  SourceRunBudget,
  readGreenhouseDetailV2,
  readGreenhousePageV2,
  validateSecureSourceUrl,
  type SourceCapabilityV2,
  type SecureSourceTransportDependencies,
} from "../index";

const instant = new Date("2026-09-30T00:00:00.000Z");

function capability(overrides: Partial<SourceCapabilityV2> = {}): SourceCapabilityV2 {
  return {
    schemaVersion: 2,
    capabilityId: "greenhouse-fixture-001",
    version: 1,
    predecessorVersion: null,
    source: "GREENHOUSE",
    alias: "Fictional board",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "boards-api.greenhouse.io",
    allowedPathPrefix: "/v1/boards/fictional/",
    allowedOperations: ["LIST_JOBS", "GET_JOB"],
    approvalState: "APPROVED",
    approvalReference: "fixture.greenhouse.v1",
    approvedAt: instant.toISOString(),
    policyVersion: "fixture-policy-v1",
    policyReviewedAt: instant.toISOString(),
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 10,
    pageSizeCap: 10,
    responseByteLimit: 2_000_000,
    requestTimeoutMs: 30_000,
    runTimeoutMs: 120_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "greenhouse-v2:fixture",
    createdAt: instant.toISOString(),
    updatedAt: instant.toISOString(),
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  };
}

function fixtureJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    title: "Fictional Associate Engineer",
    absolute_url: "https://job-boards.greenhouse.io/fictional/jobs/123",
    location: { name: "Melbourne, VIC" },
    content: "<h2>Requirements</h2><script>must not execute</script><p>Learn safely.</p>",
    updated_at: "2026-09-29T12:00:00Z",
    departments: [{ id: 1, name: "Engineering" }],
    offices: [{ id: 2, name: "Melbourne" }],
    metadata: [{ id: 3, name: "Work type", value: "Unknown" }],
    ...overrides,
  };
}

function dependencies(
  body: unknown,
  options: { status?: number; raw?: string; headers?: Record<string, string> } = {},
): SecureSourceTransportDependencies {
  const bytes = new TextEncoder().encode(options.raw ?? JSON.stringify(body));
  return {
    resolveHost: vi.fn(async () => ["8.8.8.8"]),
    request: vi.fn(async () => ({
      status: options.status ?? 200,
      headers: {
        "content-type": "application/json",
        "content-encoding": "identity",
        ...options.headers,
      },
      body: bytes,
      connectedAddress: "8.8.8.8",
    })),
  };
}

function budget(value = capability()) {
  return new SourceRunBudget(value, instant);
}

describe("Greenhouse V2 bounded reader", () => {
  it("reads one exact LIST response, preserves inert content and raw provider metadata", async () => {
    const approved = capability({ allowedOperations: ["LIST_JOBS"] });
    const deps = dependencies({ jobs: [fixtureJob()] });
    const page = await readGreenhousePageV2({
      capability: approved,
      budget: budget(approved),
      now: () => instant,
      dependencies: deps,
    });

    expect(page).toMatchObject({
      providerRecordCount: 1,
      acceptedRecords: [
        {
          source: "GREENHOUSE",
          region: "GLOBAL",
          tenant: "fictional",
          externalId: "123",
          title: "Fictional Associate Engineer",
          location: "Melbourne, VIC",
          description: "Requirements\nLearn safely.",
          updatedAt: "2026-09-29T12:00:00Z",
          sourceUrl: "https://job-boards.greenhouse.io/fictional/jobs/123",
          applicationUrl: "https://job-boards.greenhouse.io/fictional/jobs/123",
          departments: [{ id: 1, name: "Engineering" }],
          offices: [{ id: 2, name: "Melbourne" }],
          metadata: [{ id: 3, name: "Work type", value: "Unknown" }],
        },
      ],
      cursor: "0",
      nextCursor: null,
      requestCount: 1,
    });
    expect(page.acceptedRecords[0]?.rawPayload.content).toContain("<script>");
    expect(Object.isFrozen(page.acceptedRecords[0]?.rawPayload)).toBe(true);
    expect(deps.request).toHaveBeenCalledOnce();
    expect(String(vi.mocked(deps.request).mock.calls[0]?.[0].url)).toBe(
      "https://boards-api.greenhouse.io/v1/boards/fictional/jobs?content=true",
    );
    expect(page.pageDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(page.acceptedRecords[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computes deterministic content digests independent of JSON object key order", async () => {
    const approved = capability({ allowedOperations: ["LIST_JOBS"] });
    const first = fixtureJob();
    const second = {
      metadata: first.metadata,
      offices: first.offices,
      departments: first.departments,
      updated_at: first.updated_at,
      content: first.content,
      location: first.location,
      absolute_url: first.absolute_url,
      title: first.title,
      id: first.id,
    };
    const pageA = await readGreenhousePageV2({
      capability: approved,
      budget: budget(approved),
      now: () => instant,
      dependencies: dependencies({ jobs: [first] }),
    });
    const pageB = await readGreenhousePageV2({
      capability: approved,
      budget: budget(approved),
      now: () => instant,
      dependencies: dependencies({ jobs: [second] }),
    });
    expect(pageB.acceptedRecords[0]?.contentDigest).toBe(pageA.acceptedRecords[0]?.contentDigest);
    expect(pageB.pageDigest).toBe(pageA.pageDigest);
  });

  it("rejects non-Greenhouse hosts, sibling tenants, and altered LIST query semantics before transport", async () => {
    const approved = capability();
    const dns = vi.fn(async () => ["8.8.8.8"]);
    await expect(
      validateSecureSourceUrl(
        "https://example.test/v1/boards/fictional/jobs?content=true",
        approved,
        "LIST_JOBS",
        dns,
      ),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWLISTED" });
    await expect(
      validateSecureSourceUrl(
        "https://boards-api.greenhouse.io/v1/boards/fictional-sibling/jobs?content=true",
        approved,
        "LIST_JOBS",
        dns,
      ),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWLISTED" });
    await expect(
      validateSecureSourceUrl(
        "https://boards-api.greenhouse.io/v1/boards/fictional/jobs?content=false",
        approved,
        "LIST_JOBS",
        dns,
      ),
    ).rejects.toMatchObject({ code: "QUERY_NOT_ALLOWLISTED" });
    await expect(
      validateSecureSourceUrl(
        "https://boards-api.greenhouse.io/v1/boards/fictional/jobs?content=true&other=x",
        approved,
        "LIST_JOBS",
        dns,
      ),
    ).rejects.toMatchObject({ code: "QUERY_NOT_ALLOWLISTED" });
    expect(dns).not.toHaveBeenCalled();
  });

  it("blocks redirects, retries, malformed JSON, unexpected response shapes, and response overflow", async () => {
    const approved = capability({ allowedOperations: ["LIST_JOBS"] });
    await expect(
      readGreenhousePageV2({
        capability: approved,
        budget: budget(approved),
        now: () => instant,
        dependencies: dependencies(
          {},
          { status: 302, headers: { location: "https://other.test/" } },
        ),
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_FORBIDDEN" });
    const retriesAllowed = capability({ allowedOperations: ["LIST_JOBS"], maxRetries: 1 });
    await expect(
      readGreenhousePageV2({
        capability: retriesAllowed,
        budget: budget(retriesAllowed),
        now: () => instant,
        dependencies: dependencies({ jobs: [] }),
      }),
    ).rejects.toMatchObject({ code: "RETRY_FORBIDDEN" });
    await expect(
      readGreenhousePageV2({
        capability: approved,
        budget: budget(approved),
        now: () => instant,
        dependencies: dependencies(null, { raw: "{" }),
      }),
    ).rejects.toMatchObject({ code: "SCHEMA_CHANGED" });
    await expect(
      readGreenhousePageV2({
        capability: approved,
        budget: budget(approved),
        now: () => instant,
        dependencies: dependencies({ unexpected: [] }),
      }),
    ).rejects.toMatchObject({ code: "SCHEMA_CHANGED" });
    const tiny = capability({
      allowedOperations: ["LIST_JOBS"],
      responseByteLimit: 50,
    });
    await expect(
      readGreenhousePageV2({
        capability: tiny,
        budget: budget(tiny),
        now: () => instant,
        dependencies: dependencies({ jobs: [fixtureJob()] }),
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("enforces record caps and rejects invalid absolute URLs from the accepted set", async () => {
    const onePageRecord = capability({
      allowedOperations: ["LIST_JOBS"],
      recordCap: 10,
      pageSizeCap: 1,
    });
    await expect(
      readGreenhousePageV2({
        capability: onePageRecord,
        budget: budget(onePageRecord),
        now: () => instant,
        dependencies: dependencies({ jobs: [fixtureJob(), fixtureJob({ id: 124 })] }),
      }),
    ).rejects.toMatchObject({ code: "PAGE_SIZE_EXCEEDED" });
    const oneRecord = capability({
      allowedOperations: ["LIST_JOBS"],
      recordCap: 1,
      pageSizeCap: 1,
    });
    await expect(
      readGreenhousePageV2({
        capability: oneRecord,
        budget: budget(oneRecord),
        now: () => instant,
        dependencies: dependencies({ jobs: [fixtureJob(), fixtureJob({ id: 124 })] }),
      }),
    ).rejects.toMatchObject({ code: "RECORD_CAP_EXCEEDED" });
    const approved = capability({ allowedOperations: ["LIST_JOBS"] });
    const page = await readGreenhousePageV2({
      capability: approved,
      budget: budget(approved),
      now: () => instant,
      dependencies: dependencies({
        jobs: [
          fixtureJob({ absolute_url: "javascript:alert(1)" }),
          fixtureJob({ id: 124, absolute_url: "https://evil.example/fictional/jobs/124" }),
          fixtureJob({
            id: 125,
            absolute_url: "https://job-boards.greenhouse.io/other/jobs/125",
          }),
        ],
      }),
    });
    expect(page.acceptedRecords).toHaveLength(0);
    expect(page.safeUnusableDiagnostics).toEqual([
      { reasonCode: "UNUSABLE_LINK_BOUNDARY", recordIndex: 0 },
      { reasonCode: "UNUSABLE_LINK_BOUNDARY", recordIndex: 1 },
      { reasonCode: "UNUSABLE_LINK_BOUNDARY", recordIndex: 2 },
    ]);
  });

  it("performs exact GET_JOB and rejects a payload for another external ID", async () => {
    const approved = capability();
    const deps = dependencies(fixtureJob());
    const detail = await readGreenhouseDetailV2({
      capability: approved,
      budget: budget(approved),
      externalId: "123",
      now: () => instant,
      dependencies: deps,
    });
    expect(detail.externalId).toBe("123");
    expect(String(vi.mocked(deps.request).mock.calls[0]?.[0].url)).toBe(
      "https://boards-api.greenhouse.io/v1/boards/fictional/jobs/123",
    );
    await expect(
      readGreenhouseDetailV2({
        capability: approved,
        budget: budget(approved),
        externalId: "123",
        now: () => instant,
        dependencies: dependencies(fixtureJob({ id: 124 })),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_DETAIL_ID_MISMATCH" });
  });

  it("does not put candidate/profile values in the request", async () => {
    const approved = capability({ allowedOperations: ["LIST_JOBS"] });
    const deps = dependencies({ jobs: [] });
    await readGreenhousePageV2({
      capability: approved,
      budget: budget(approved),
      now: () => instant,
      dependencies: deps,
    });
    const request = vi.mocked(deps.request).mock.calls[0]?.[0];
    expect(String(request?.url)).not.toMatch(/candidate|profile|resume|answer/i);
    expect(request).not.toHaveProperty("headers");
    expect(request).not.toHaveProperty("body");
  });
});
