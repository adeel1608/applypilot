import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  SecureSourceError,
  SourceCapabilityV2Schema,
  SourceRunBudget,
  boundedSecureJsonGet,
  loadPrivateSourceAllowlistV2,
  readLeverDetailV2,
  readLeverPageV2,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  validateSecureSourceUrl,
  validateSourceAuditMetadata,
  type SecureSourceTransportDependencies,
  type SourceCapabilityV2,
} from "./index";

const instant = new Date("2026-09-10T00:00:00.000Z");

function capability(overrides: Partial<SourceCapabilityV2> = {}): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "cap-fictional-001",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional tenant",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional",
    allowedOperations: ["LIST_JOBS", "GET_JOB"],
    approvalState: "APPROVED",
    approvalReference: "owner-approval:fictional-001",
    approvedAt: "2026-09-01T00:00:00.000Z",
    policyVersion: "lever-policy-fixture-v1",
    policyReviewedAt: "2026-09-01T00:00:00.000Z",
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 3,
    recordCap: 6,
    pageSizeCap: 2,
    responseByteLimit: 100_000,
    requestTimeoutMs: 1_000,
    runTimeoutMs: 10_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2-fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  });
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

function posting(index: number) {
  return {
    id: `fixture-${index}`,
    text: `Fictional Role ${index}`,
    hostedUrl: `https://jobs.lever.co/fictional/fixture-${index}`,
    applyUrl: `https://jobs.lever.co/fictional/fixture-${index}/apply`,
    descriptionPlain: "Fictional evidence only.",
    categories: {
      location: "Melbourne VIC",
      allLocations: ["Melbourne VIC", "Remote Australia"],
      commitment: "Part-time",
      department: "Example Department",
      team: "Example Team",
    },
    country: "AU",
    workplaceType: "hybrid",
    salaryRange: { min: 30, max: 35, currency: "AUD", interval: "hour" },
    createdAt: 1788998400000,
  };
}

describe("R1A source capability and transport", () => {
  it("binds an immutable approved capability and rejects extra or inconsistent fields", () => {
    const approved = capability();
    expect(sourceCapabilityDigest(approved)).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceCapabilityReadiness(approved, instant)).toMatchObject({
      status: "SOURCE_ENABLED",
    });
    expect(
      SourceCapabilityV2Schema.safeParse({ ...approved, candidateName: "Forbidden" }).success,
    ).toBe(false);
    expect(SourceCapabilityV2Schema.safeParse({ ...approved, maxRedirects: 1 }).success).toBe(
      false,
    );
    expect(
      SourceCapabilityV2Schema.safeParse({
        ...approved,
        approvalState: "REVOKED",
        revokedAt: null,
        revocationReason: null,
      }).success,
    ).toBe(false);
  });

  it.each([
    [{ approvalState: "DRAFT", approvalReference: null, approvedAt: null }, "NOT_APPROVED"],
    [
      {
        approvalState: "REVOKED",
        approvalReference: null,
        approvedAt: null,
        revokedAt: "2026-09-09T00:00:00.000Z",
        revocationReason: "OWNER_REVOKED",
      },
      "REVOKED",
    ],
    [{ policyExpiresAt: "2026-09-09T00:00:00.000Z" }, "POLICY_EXPIRED"],
    [{ capabilityExpiresAt: "2026-09-09T00:00:00.000Z" }, "CAPABILITY_EXPIRED"],
  ] as const)("fails closed for capability state %o", (overrides, reason) => {
    expect(sourceCapabilityReadiness(capability(overrides), instant)).toEqual({
      status: "SOURCE_DISABLED",
      reason,
    });
  });

  it("loads only the strict v2 allowlist from the confined private path", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-source-v2-"));
    await mkdir(join(root, "data", "private"), { recursive: true });
    try {
      expect(await loadPrivateSourceAllowlistV2(root)).toEqual({
        status: "WAITING_FOR_APPROVED_TENANT",
        capabilities: [],
      });
      await writeFile(
        join(root, "data", "private", "source-allowlist.json"),
        JSON.stringify({ schemaVersion: 2, capabilities: [capability()] }),
      );
      await expect(loadPrivateSourceAllowlistV2(root)).resolves.toMatchObject({
        status: "SOURCE_ALLOWLIST_V2_READY",
        capabilities: [{ capabilityId: "cap-fictional-001" }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pins a validated public address and rejects host, query, and mixed DNS answers before IO", async () => {
    const approved = capability();
    const valid = await validateSecureSourceUrl(
      "https://api.lever.co/v0/postings/fictional?mode=json&skip=0&limit=2",
      approved,
      "LIST_JOBS",
      async () => ["8.8.8.8"],
    );
    expect(valid.pinnedAddress).toBe("8.8.8.8");
    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional-other?mode=json&skip=0&limit=2",
        approved,
        "LIST_JOBS",
        async () => ["8.8.8.8"],
      ),
    ).rejects.toThrow("PATH_NOT_ALLOWLISTED");
    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional?mode=json&token=nope",
        approved,
        "LIST_JOBS",
        async () => ["8.8.8.8"],
      ),
    ).rejects.toThrow("QUERY_NOT_ALLOWLISTED");
    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional?mode=json&skip=0&limit=2",
        approved,
        "LIST_JOBS",
        async () => ["8.8.8.8", "127.0.0.1"],
      ),
    ).rejects.toThrow("DESTINATION_ADDRESS_FORBIDDEN");
  });

  it("requires exact canonical Lever list and detail query semantics", async () => {
    const approved = capability();
    const resolveHost = vi.fn(async () => ["8.8.8.8"]);
    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional?limit=2&mode=json&skip=0",
        approved,
        "LIST_JOBS",
        resolveHost,
      ),
    ).resolves.toMatchObject({ pinnedAddress: "8.8.8.8" });
    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional?mode=json&skip=5&limit=1",
        approved,
        "LIST_JOBS",
        resolveHost,
      ),
    ).resolves.toMatchObject({ pinnedAddress: "8.8.8.8" });

    const invalidQueries = [
      "skip=0&limit=2",
      "mode=json&mode=json&skip=0&limit=2",
      "mode=JSON&skip=0&limit=2",
      "mode=json&limit=2",
      "mode=json&skip=0",
      "mode=json&skip=0&skip=1&limit=2",
      "mode=json&skip=0&limit=2&limit=1",
      "mode=json&skip=&limit=2",
      "mode=json&skip=-0&limit=2",
      "mode=json&skip=%2B0&limit=2",
      "mode=json&skip=00&limit=2",
      "mode=json&skip=1.0&limit=2",
      "mode=json&skip=1e0&limit=2",
      "mode=json&skip=%200&limit=2",
      "mode=json&skip=0&limit=0",
      "mode=json&skip=0&limit=3",
      "mode=json&skip=5&limit=2",
      "mode=json&skip=6&limit=1",
      "mode=json&skip=9007199254740992&limit=1",
      "mode=json&skip=0&limit=2&unexpected=1",
    ];
    for (const query of invalidQueries) {
      const resolver = vi.fn(async () => ["8.8.8.8"]);
      await expect(
        validateSecureSourceUrl(
          `https://api.lever.co/v0/postings/fictional?${query}`,
          approved,
          "LIST_JOBS",
          resolver,
        ),
        query,
      ).rejects.toThrow("QUERY_NOT_ALLOWLISTED");
      expect(resolver, query).not.toHaveBeenCalled();
    }

    await expect(
      validateSecureSourceUrl(
        "https://api.lever.co/v0/postings/fictional/fixture-1?mode=json",
        approved,
        "GET_JOB",
        resolveHost,
      ),
    ).resolves.toMatchObject({ pinnedAddress: "8.8.8.8" });
    for (const query of ["", "mode=json&mode=json", "mode=json&skip=0", "mode=json&limit=1"]) {
      await expect(
        validateSecureSourceUrl(
          `https://api.lever.co/v0/postings/fictional/fixture-1${query ? `?${query}` : ""}`,
          approved,
          "GET_JOB",
          async () => ["8.8.8.8"],
        ),
      ).rejects.toThrow("QUERY_NOT_ALLOWLISTED");
    }
  });

  it("rejects a connection that does not use the validated pinned address", async () => {
    const deps = transport([]);
    deps.request = vi.fn(async ({ pinnedAddress }) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("[]"),
      connectedAddress: pinnedAddress === "8.8.8.8" ? "1.1.1.1" : pinnedAddress,
    }));
    await expect(
      boundedSecureJsonGet({
        initialUrl: "https://api.lever.co/v0/postings/fictional?mode=json&skip=0&limit=2",
        capability: capability(),
        operation: "LIST_JOBS",
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: deps,
      }),
    ).rejects.toThrow("PINNED_ADDRESS_MISMATCH");
  });

  it("stops on authentication, rate, HTML interstitial, redirect, and unknown network outcome", async () => {
    for (const [status, code] of [
      [401, "AUTHENTICATION_REQUIRED"],
      [403, "ACCESS_DENIED"],
      [429, "RATE_LIMITED"],
    ] as const) {
      await expect(
        readLeverPageV2({
          capability: capability(),
          budget: new SourceRunBudget(capability(), instant),
          now: () => instant,
          dependencies: transport([], status),
        }),
      ).rejects.toThrow(code);
    }
    const html = transport([]);
    html.request = vi.fn(async ({ pinnedAddress }) => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>challenge</html>"),
      connectedAddress: pinnedAddress,
    }));
    await expect(
      readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: html,
      }),
    ).rejects.toThrow("BOT_OR_ACCESS_INTERSTITIAL");
    const redirect = transport([]);
    redirect.request = vi.fn(async ({ pinnedAddress }) => ({
      status: 302,
      headers: { location: "https://api.lever.co/v0/postings/fictional/next" },
      body: Buffer.alloc(0),
      connectedAddress: pinnedAddress,
    }));
    await expect(
      readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: redirect,
      }),
    ).rejects.toThrow("REDIRECT_FORBIDDEN");
    const lost = transport([]);
    lost.request = vi.fn(async () => {
      throw new Error("socket disappeared");
    });
    await expect(
      readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: lost,
      }),
    ).rejects.toThrow("NETWORK_OUTCOME_UNKNOWN");
  });

  it("honours owner cancellation before transport and distinguishes it from timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const dependencies = transport([]);
    await expect(
      readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        signal: controller.signal,
        dependencies,
      }),
    ).rejects.toThrow("OWNER_CANCELLED");
    expect(dependencies.request).not.toHaveBeenCalled();
  });

  it("maps complete fictional Lever pages and enforces monotonic budget/cursors", async () => {
    const approved = capability();
    const budget = new SourceRunBudget(approved, instant);
    const first = await readLeverPageV2({
      capability: approved,
      budget,
      cursor: 0,
      pageSize: 2,
      now: () => instant,
      dependencies: transport([posting(1), posting(2)]),
    });
    expect(first).toMatchObject({ cursor: 0, nextCursor: 2, requestCount: 1 });
    expect(first.records[0]).toMatchObject({
      country: "AU",
      workplaceType: "hybrid",
      allLocations: ["Melbourne VIC", "Remote Australia"],
      salaryRange: { currency: "AUD", interval: "hour" },
    });
    const second = await readLeverPageV2({
      capability: approved,
      budget,
      cursor: 2,
      pageSize: 2,
      now: () => instant,
      dependencies: transport([posting(3)]),
    });
    expect(second.nextCursor).toBeNull();
    await expect(
      readLeverPageV2({
        capability: approved,
        budget,
        cursor: 0,
        pageSize: 2,
        now: () => instant,
        dependencies: transport([]),
      }),
    ).rejects.toThrow(SecureSourceError);
  });

  it.each([
    ["on-site", "onsite"],
    ["remote", "remote"],
    ["hybrid", "hybrid"],
    ["unspecified", "unspecified"],
  ] as const)("accepts official workplaceType %s and maps it to %s", async (wire, internal) => {
    const value = posting(1);
    value.workplaceType = wire;
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    expect(page.records[0]?.workplaceType).toBe(internal);
  });

  it("converts Lever list HTML to inert ordered text while freezing the raw payload", async () => {
    const value = {
      ...posting(1),
      workplaceType: "on-site",
      descriptionPlain: "",
      description: "<p>Fictional &amp; safe overview.</p>",
      additional: "<div>Closing text.<iframe>hidden</iframe></div>",
      lists: [
        {
          text: "<strong>Requirements</strong>",
          content:
            "<ul><li>Customer &amp; visitor support</li><li>Safe systems</li></ul><script>alert('never')</script>",
        },
        {
          text: "Benefits",
          content: "<p>Fictional mentoring</p><img src=x onerror=alert(1)>",
        },
      ],
    };
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    const record = page.records[0]!;
    expect(record.workplaceType).toBe("onsite");
    expect(record.sections).toEqual([
      {
        heading: "Requirements",
        content: "Customer & visitor support\nSafe systems",
        kind: "REQUIREMENTS",
      },
      { heading: "Benefits", content: "Fictional mentoring", kind: "BENEFITS" },
    ]);
    expect(record.description).toContain("Fictional & safe overview.");
    expect(record.description).toContain("Requirements\nCustomer & visitor support\nSafe systems");
    expect(record.description).toContain("Benefits\nFictional mentoring");
    expect(record.description).toContain("Closing text.");
    expect(record.description).not.toMatch(/<|alert|hidden|onerror/i);
    expect(record.rawPayload.lists[0]?.content).toBe(value.lists[0]?.content);
    expect(Object.isFrozen(record.rawPayload)).toBe(true);
    expect(Object.isFrozen(record.rawPayload.lists)).toBe(true);
    expect(Object.isFrozen(record.rawPayload.lists[0])).toBe(true);
    expect(() => {
      (record.rawPayload as unknown as { lists: Array<{ content: string }> }).lists[0]!.content =
        "mutated";
    }).toThrow(TypeError);
    expect(record.rawPayload.lists[0]?.content).toBe(value.lists[0]?.content);
  });

  it("requires explicit GET_JOB authority and keeps application URLs inert", async () => {
    const approved = capability();
    const record = await readLeverDetailV2({
      capability: approved,
      budget: new SourceRunBudget(approved, instant),
      externalId: "fixture-1",
      now: () => instant,
      dependencies: transport(posting(1)),
    });
    expect(record.applicationUrl).toBe("https://jobs.lever.co/fictional/fixture-1/apply");
    await expect(
      readLeverDetailV2({
        capability: capability({ allowedOperations: ["LIST_JOBS"] }),
        budget: new SourceRunBudget(capability({ allowedOperations: ["LIST_JOBS"] }), instant),
        externalId: "fixture-1",
        now: () => instant,
        dependencies: transport(posting(1)),
      }),
    ).rejects.toThrow("OPERATION_NOT_APPROVED");
  });

  it("rejects unknown or nested source audit metadata", () => {
    expect(
      validateSourceAuditMetadata("source.run.started", {
        runId: "run:1",
        capabilityId: "cap:1",
        capabilityVersion: 1,
        operation: "LIST_JOBS",
      }),
    ).toBeDefined();
    expect(() =>
      validateSourceAuditMetadata("source.run.started", {
        runId: "run:1",
        capabilityId: "cap:1",
        capabilityVersion: 1,
        operation: "LIST_JOBS",
        candidate: { name: "must-not-pass" },
      }),
    ).toThrow();
  });
});
