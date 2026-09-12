import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  SecureSourceError,
  SourceCapabilityV2Schema,
  SourceRunBudget,
  boundedSecureJsonGet,
  classifySecureSourceTransportError,
  createPinnedSourceLookup,
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

  it("classifies DNS resolver failure and an empty answer without exposing resolver errors", async () => {
    const approved = capability();
    const requestUrl = "https://api.lever.co/v0/postings/fictional?mode=json&skip=0&limit=2";
    await expect(
      validateSecureSourceUrl(requestUrl, approved, "LIST_JOBS", async () => {
        throw new Error("arbitrary resolver details must remain private");
      }),
    ).rejects.toMatchObject({ code: "DNS_RESOLUTION_FAILED", lifecycleStage: "DNS" });
    await expect(
      validateSecureSourceUrl(requestUrl, approved, "LIST_JOBS", async () => []),
    ).rejects.toMatchObject({ code: "DNS_RESOLUTION_FAILED", lifecycleStage: "DNS" });
  });

  it.each([
    ["ENOTFOUND", "REQUEST_CREATED", "DNS_RESOLUTION_FAILED"],
    ["EAI_AGAIN", "REQUEST_CREATED", "DNS_RESOLUTION_FAILED"],
    ["ENETUNREACH", "SOCKET_ASSIGNED", "NETWORK_ROUTE_UNAVAILABLE"],
    ["EHOSTUNREACH", "SOCKET_ASSIGNED", "NETWORK_ROUTE_UNAVAILABLE"],
    ["ECONNREFUSED", "SOCKET_ASSIGNED", "CONNECTION_REFUSED"],
    ["ECONNRESET", "REQUEST_FLUSHED", "CONNECTION_RESET"],
    ["EPIPE", "RESPONSE_BODY", "CONNECTION_RESET"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TCP_CONNECTED", "TLS_HANDSHAKE_FAILED"],
    ["EPROTO", "TCP_CONNECTED", "TLS_HANDSHAKE_FAILED"],
    ["ETIMEDOUT", "SOCKET_ASSIGNED", "REQUEST_TIMEOUT"],
    ["PRIVATE_ARBITRARY_CODE", "REQUEST_FLUSHED", "NETWORK_OUTCOME_UNKNOWN"],
  ] as const)("maps stable transport code %s at %s to %s", (code, stage, expected) => {
    const classified = classifySecureSourceTransportError(
      Object.assign(new Error("untrusted raw detail"), { code }),
      stage,
    );
    expect(classified.code).toBe(expected);
    expect(classified.lifecycleStage).toBe(stage);
    expect(classified.message).toBe(expected);
    expect(classified.message).not.toContain("untrusted");
  });

  it("does not relabel a TLS-like error after TLS was established", () => {
    expect(
      classifySecureSourceTransportError(
        Object.assign(new Error("not retained"), { code: "ERR_TLS_PROTOCOL_VERSION_CONFLICT" }),
        "TLS_ESTABLISHED",
      ),
    ).toMatchObject({ code: "NETWORK_OUTCOME_UNKNOWN", lifecycleStage: "TLS_ESTABLISHED" });
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

  it("compares the actual connected IPv6 address canonically", async () => {
    const approved = capability();
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["2001:4860:4860:0:0:0:0:8888"]),
      request: vi.fn(async () => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from("[]"),
        connectedAddress: "2001:4860:4860::8888",
      })),
    };
    await expect(
      boundedSecureJsonGet({
        initialUrl: "https://api.lever.co/v0/postings/fictional?mode=json&skip=0&limit=2",
        capability: approved,
        operation: "LIST_JOBS",
        budget: new SourceRunBudget(approved, instant),
        now: () => instant,
        dependencies,
      }),
    ).resolves.toMatchObject({ requestCount: 1 });
  });

  it("honours both Node pinned lookup callback shapes without resolving or falling back", async () => {
    const pinned = createPinnedSourceLookup("8.8.8.8");
    expect(pinned.family).toBe(4);
    const invoke = (all: boolean) =>
      new Promise<{
        address: string | Array<{ address: string; family: number }>;
        family?: number;
      }>((resolve, reject) => {
        pinned.lookup("ignored.example.test", { all }, (error, address, family) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ address, family });
        });
      });
    await expect(invoke(false)).resolves.toEqual({ address: "8.8.8.8", family: 4 });
    await expect(invoke(true)).resolves.toEqual({
      address: [{ address: "8.8.8.8", family: 4 }],
      family: undefined,
    });
    expect(() => createPinnedSourceLookup("not-an-ip")).toThrow("PINNED_ADDRESS_INVALID");
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

  it("persists safe transport classification semantics without blindly retrying", async () => {
    const approved = capability({ maxRetries: 2 });
    const budget = new SourceRunBudget(approved, instant);
    const refused = transport([]);
    refused.request = vi.fn(async () => {
      throw Object.assign(new Error("raw socket detail must not be retained"), {
        code: "ECONNREFUSED",
      });
    });
    await expect(
      readLeverPageV2({
        capability: approved,
        budget,
        now: () => instant,
        dependencies: refused,
      }),
    ).rejects.toThrow("CONNECTION_REFUSED");
    expect(refused.request).toHaveBeenCalledOnce();
    expect(budget.attempts).toBe(1);
    expect(budget.retries).toBe(0);

    expect(
      validateSourceAuditMetadata("source.run.stopped", {
        runId: "run:transport-classification",
        code: "CONNECTION_REFUSED",
        transportStage: "SOCKET_ASSIGNED",
        requestCount: 1,
        recordCount: 0,
      }),
    ).toBeDefined();
    expect(
      validateSourceAuditMetadata("source.provider.drift", {
        issueCategory: "PROVIDER_ENUM_DRIFT",
        field: "workplaceType",
        expectedStructuralType: "enum",
        recordIndex: 0,
      }),
    ).toBeDefined();
    expect(() =>
      validateSourceAuditMetadata("source.provider.drift", {
        issueCategory: "PROVIDER_ENUM_DRIFT",
        field: "workplaceType",
        expectedStructuralType: "enum",
        recordIndex: 0,
        value: "fictional-provider-mode",
      }),
    ).toThrow();
    expect(
      validateSourceAuditMetadata("source.run.stopped", {
        runId: "run:schema-classification",
        code: "SCHEMA_CHANGED",
        transportStage: "RESPONSE_BODY",
        schemaDiagnostic: {
          field: "salaryRange.min",
          expectedStructuralType: "number",
          issueCategory: "FIELD_TYPE_MISMATCH",
          recordIndex: 0,
        },
        requestCount: 1,
        recordCount: 0,
      }),
    ).toBeDefined();
    expect(() =>
      validateSourceAuditMetadata("source.run.stopped", {
        runId: "run:transport-classification",
        code: "CONNECTION_REFUSED",
        transportStage: "SOCKET_ASSIGNED_AT_PRIVATE_ADDRESS",
        requestCount: 1,
        recordCount: 0,
      }),
    ).toThrow();
    expect(() =>
      validateSourceAuditMetadata("source.run.stopped", {
        runId: "run:schema-classification",
        code: "SCHEMA_CHANGED",
        transportStage: "RESPONSE_BODY",
        schemaDiagnostic: {
          field: "arbitraryProviderKey",
          expectedStructuralType: "string",
          issueCategory: "FIELD_TYPE_MISMATCH",
          value: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST",
        },
        requestCount: 1,
        recordCount: 0,
      }),
    ).toThrow();
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

  it("classifies response schema drift at the response-body boundary without Zod details", async () => {
    const malformed = { ...posting(1), hostedUrl: "not-a-url" };
    const failure = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([malformed]),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SecureSourceError);
    expect(failure).toMatchObject({
      code: "SCHEMA_CHANGED",
      lifecycleStage: "RESPONSE_BODY",
      message: "SCHEMA_CHANGED",
      schemaDiagnostic: {
        field: "hostedUrl",
        expectedStructuralType: "url",
        issueCategory: "INVALID_URL",
        recordIndex: 0,
      },
    });
    expect(String(failure)).not.toMatch(/hostedUrl|invalid_format|not-a-url/i);
  });

  it.each([
    ["number", 1_788_998_400_000],
    ["null", null],
    ["string", "undocumented timestamp extension"],
    ["object", { fictional: true }],
  ])("keeps undocumented createdAt %s inert and out of posting evidence", async (_label, value) => {
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([{ ...posting(1), createdAt: value }]),
    });
    const record = page.records[0]!;
    expect(record.postedAt).toBeNull();
    const rawCreatedAt = (record.rawPayload as Record<string, unknown>).createdAt;
    expect(rawCreatedAt).toEqual(value);
    expect(Object.isFrozen(record.rawPayload)).toBe(true);
    if (rawCreatedAt && typeof rawCreatedAt === "object") {
      expect(Object.isFrozen(rawCreatedAt)).toBe(true);
    }
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
    expect(page.records[0]?.providerDriftDiagnostics).toEqual([]);
    expect(page.providerDriftDiagnostics).toEqual([]);
  });

  it("normalizes absent workplaceType to unknown without reporting provider drift", async () => {
    const value: Record<string, unknown> = { ...posting(1) };
    delete value.workplaceType;
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    expect(page.records[0]?.workplaceType).toBeNull();
    expect(page.providerDriftDiagnostics).toEqual([]);
  });

  it.each([
    ["null", null],
    ["unknown string", "fictional-provider-mode"],
  ] as const)(
    "normalizes workplaceType %s to unknown with a value-free non-fatal warning",
    async (_label, workplaceType) => {
      const page = await readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: transport([{ ...posting(1), workplaceType }]),
      });
      const record = page.records[0]!;
      expect(record.workplaceType).toBeNull();
      expect(record.rawPayload.workplaceType).toBe(workplaceType);
      expect(Object.isFrozen(record.rawPayload)).toBe(true);
      expect(record.providerDriftDiagnostics).toEqual([
        {
          issueCategory: "PROVIDER_ENUM_DRIFT",
          field: "workplaceType",
          expectedStructuralType: "enum",
          recordIndex: 0,
        },
      ]);
      expect(page.providerDriftDiagnostics).toEqual(record.providerDriftDiagnostics);
      expect(Object.keys(page.providerDriftDiagnostics[0] ?? {}).sort()).toEqual(
        ["expectedStructuralType", "field", "issueCategory", "recordIndex"].sort(),
      );
      expect(JSON.stringify(page.providerDriftDiagnostics)).not.toContain(
        "fictional-provider-mode",
      );
    },
  );

  it.each([
    ["object", { fictional: true }],
    ["array", ["fictional"]],
    ["number", 7],
    ["boolean", true],
  ] as const)("fails closed for structural workplaceType %s", async (_label, workplaceType) => {
    const failure = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([{ ...posting(1), workplaceType }]),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SecureSourceError);
    expect(failure).toMatchObject({
      code: "SCHEMA_CHANGED",
      lifecycleStage: "RESPONSE_BODY",
      schemaDiagnostic: {
        field: "workplaceType",
        expectedStructuralType: "enum",
        issueCategory: "FIELD_TYPE_MISMATCH",
        recordIndex: 0,
      },
    });
  });

  it.each([
    ["string", "AU", "AU"],
    ["null", null, null],
  ] as const)("accepts documented Lever country %s", async (_label, wire, internal) => {
    const value = { ...posting(1), country: wire };
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    expect(page.records[0]?.country).toBe(internal);
  });

  it("retains supported absent country normalization", async () => {
    const value: Record<string, unknown> = { ...posting(1) };
    delete value.country;
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    expect(page.records[0]?.country).toBeNull();
  });

  it("treats documented but wholly empty descriptive text as product-unusable", async () => {
    const value = {
      ...posting(1),
      description: "",
      descriptionPlain: "",
      additional: "",
      additionalPlain: "",
      salaryDescription: "",
      salaryDescriptionPlain: "",
      lists: [],
    };
    const failure = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SecureSourceError);
    expect(failure).toMatchObject({
      code: "SOURCE_RECORD_UNUSABLE",
      lifecycleStage: "RESPONSE_BODY",
      schemaDiagnostic: null,
    });
  });

  it("accepts documented values without undocumented per-field or collection bounds", async () => {
    const longTitle = "T".repeat(1_250);
    const longDescription = "D".repeat(600_000);
    const allLocations = Array.from({ length: 101 }, (_, index) => `Fixture location ${index}`);
    const lists = Array.from({ length: 101 }, (_, index) => ({
      text: `Fixture section ${index}`,
      content: `Fixture content ${index}`,
    }));
    const value = {
      ...posting(1),
      id: "urn:lever:fictional/job?ref=one#opaque",
      text: longTitle,
      descriptionPlain: longDescription,
      categories: { ...posting(1).categories, allLocations },
      lists,
      salaryRange: {
        min: -10.5,
        max: -1,
        currency: "FICTIONAL-CURRENCY-CODE-WITHOUT-A-LEVER-LIMIT",
        interval: "fictional interval without a documented Lever character limit".repeat(2),
      },
    };
    const page = await readLeverPageV2({
      capability: capability({ responseByteLimit: 2_000_000 }),
      budget: new SourceRunBudget(capability({ responseByteLimit: 2_000_000 }), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    expect(page.records[0]).toMatchObject({
      externalId: value.id,
      title: longTitle,
      allLocations,
      salaryRange: value.salaryRange,
    });
    expect(page.records[0]?.description).toContain(longDescription);
    expect(page.records[0]?.sections).toHaveLength(101);
    expect(Buffer.byteLength(JSON.stringify([value]))).toBeLessThan(2_000_000);
  });

  it("models documented passthrough fields without promoting them into job evidence", async () => {
    const value = {
      ...posting(1),
      categories: { ...posting(1).categories, level: "Fixture level" },
      opening: "<p>Fixture opening styled marker.</p>",
      openingPlain: "Fixture opening plain marker.",
      descriptionBody: "<p>Fixture body styled marker.</p>",
      descriptionBodyPlain: "Fixture body plain marker.",
      salaryDescription: "<p>Fixture salary styled marker.</p>",
      salaryDescriptionPlain: "Fixture salary plain marker.",
      providerExtension: { arbitraryProviderKey: "fixture-extension-value" },
    };
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([value]),
    });
    const record = page.records[0]!;
    expect(record.description).toBe("Fictional evidence only.");
    expect(record.description).not.toMatch(/opening|body|salary|extension/i);
    expect(record.rawPayload).toMatchObject({
      opening: value.opening,
      openingPlain: value.openingPlain,
      descriptionBody: value.descriptionBody,
      descriptionBodyPlain: value.descriptionBodyPlain,
      salaryDescription: value.salaryDescription,
      salaryDescriptionPlain: value.salaryDescriptionPlain,
      categories: { level: "Fixture level" },
      providerExtension: value.providerExtension,
    });
    expect(Object.isFrozen(record.rawPayload.providerExtension)).toBe(true);
  });

  it.each([
    ["country number", { country: 7 }],
    ["malformed list content", { lists: [{ text: "Requirements", content: null }] }],
  ] as const)("fails closed for malformed Lever %s", async (_label, override) => {
    const failure = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([{ ...posting(1), ...override }]),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SecureSourceError);
    expect(failure).toMatchObject({
      code: "SCHEMA_CHANGED",
      lifecycleStage: "RESPONSE_BODY",
      message: "SCHEMA_CHANGED",
    });
    expect(String(failure)).not.toMatch(/country|workplace|lists|requirements|received|expected/i);
  });

  const malformedContractCases: Array<{
    label: string;
    field: string;
    expectedStructuralType: string;
    issueCategory: string;
    mutate: (value: Record<string, unknown>) => unknown;
  }> = [
    {
      label: "id type",
      field: "id",
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, id: { secret: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" } }),
    },
    {
      label: "missing id",
      field: "id",
      expectedStructuralType: "string",
      issueCategory: "MISSING_REQUIRED",
      mutate: (value) => {
        const { id: _removed, ...rest } = value;
        void _removed;
        return rest;
      },
    },
    {
      label: "text type",
      field: "text",
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, text: 42 }),
    },
    {
      label: "categories type",
      field: "categories",
      expectedStructuralType: "object",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, categories: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    ...["location", "commitment", "team", "department", "level"].map((member) => ({
      label: `categories.${member} type`,
      field: `categories.${member}`,
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        categories: {
          ...(value.categories as Record<string, unknown>),
          [member]: { secret: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" },
        },
      }),
    })),
    {
      label: "allLocations type",
      field: "categories.allLocations",
      expectedStructuralType: "array",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({
        ...value,
        categories: {
          ...(value.categories as Record<string, unknown>),
          allLocations: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST",
        },
      }),
    },
    {
      label: "allLocations member type",
      field: "categories.allLocations[]",
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({
        ...value,
        categories: {
          ...(value.categories as Record<string, unknown>),
          allLocations: [{ secret: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }],
        },
      }),
    },
    {
      label: "country type",
      field: "country",
      expectedStructuralType: "string|null",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, country: 42 }),
    },
    {
      label: "country format",
      field: "country",
      expectedStructuralType: "string|null",
      issueCategory: "INVALID_FORMAT",
      mutate: (value) => ({ ...value, country: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    ...[
      "opening",
      "openingPlain",
      "description",
      "descriptionPlain",
      "descriptionBody",
      "descriptionBodyPlain",
      "additional",
      "additionalPlain",
      "salaryDescription",
      "salaryDescriptionPlain",
    ].map((field) => ({
      label: `${field} type`,
      field,
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value: Record<string, unknown>) => ({ ...value, [field]: 42 }),
    })),
    {
      label: "lists type",
      field: "lists",
      expectedStructuralType: "array",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, lists: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    {
      label: "list member type",
      field: "lists[]",
      expectedStructuralType: "object",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, lists: ["PRIVATE_FIXTURE_VALUE_NEVER_PERSIST"] }),
    },
    {
      label: "list text type",
      field: "lists[].text",
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, lists: [{ text: 42, content: "Fixture content" }] }),
    },
    {
      label: "missing list content",
      field: "lists[].content",
      expectedStructuralType: "string",
      issueCategory: "MISSING_REQUIRED",
      mutate: (value) => ({ ...value, lists: [{ text: "Fixture heading" }] }),
    },
    {
      label: "missing hostedUrl",
      field: "hostedUrl",
      expectedStructuralType: "url",
      issueCategory: "MISSING_REQUIRED",
      mutate: (value) => {
        const { hostedUrl: _removed, ...rest } = value;
        void _removed;
        return rest;
      },
    },
    {
      label: "hostedUrl format",
      field: "hostedUrl",
      expectedStructuralType: "url",
      issueCategory: "INVALID_URL",
      mutate: (value) => ({ ...value, hostedUrl: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    {
      label: "applyUrl format",
      field: "applyUrl",
      expectedStructuralType: "url",
      issueCategory: "INVALID_URL",
      mutate: (value) => ({ ...value, applyUrl: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    {
      label: "workplace structural type",
      field: "workplaceType",
      expectedStructuralType: "enum",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({
        ...value,
        workplaceType: { secret: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" },
      }),
    },
    {
      label: "salaryRange type",
      field: "salaryRange",
      expectedStructuralType: "object",
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value) => ({ ...value, salaryRange: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    },
    ...[
      ["currency", "string"],
      ["interval", "string"],
      ["min", "number"],
      ["max", "number"],
    ].map(([member, expectedStructuralType]) => ({
      label: `salaryRange.${member} type`,
      field: `salaryRange.${member}`,
      expectedStructuralType: expectedStructuralType!,
      issueCategory: "FIELD_TYPE_MISMATCH",
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        salaryRange: {
          ...(value.salaryRange as Record<string, unknown>),
          [member!]: { secret: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" },
        },
      }),
    })),
  ];

  it.each(malformedContractCases)(
    "records only allowlisted structural diagnostics for $label",
    async ({ field, expectedStructuralType, issueCategory, mutate }) => {
      const failure = await readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: transport([mutate(posting(1) as unknown as Record<string, unknown>)]),
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SecureSourceError);
      const diagnostic = (failure as SecureSourceError).schemaDiagnostic;
      expect(diagnostic).toEqual({
        field,
        expectedStructuralType,
        issueCategory,
        recordIndex: 0,
      });
      expect(Object.keys(diagnostic ?? {}).sort()).toEqual(
        ["expectedStructuralType", "field", "issueCategory", "recordIndex"].sort(),
      );
      expect(JSON.stringify(diagnostic)).not.toMatch(
        /PRIVATE_FIXTURE_VALUE_NEVER_PERSIST|secret|arbitraryProviderKey/i,
      );
    },
  );

  it("collapses non-posting and unknown paths to a fixed contract boundary", async () => {
    const failure = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport({ arbitraryProviderKey: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST" }),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SecureSourceError);
    expect((failure as SecureSourceError).schemaDiagnostic).toEqual({
      field: "UNKNOWN_CONTRACT_BOUNDARY",
      expectedStructuralType: "array",
      issueCategory: "UNKNOWN_CONTRACT_BOUNDARY",
    });
    expect(JSON.stringify((failure as SecureSourceError).schemaDiagnostic)).not.toMatch(
      /PRIVATE_FIXTURE_VALUE_NEVER_PERSIST|arbitraryProviderKey/i,
    );
    const guarded = new SecureSourceError("SCHEMA_CHANGED", null, "RESPONSE_BODY", {
      field: "arbitraryProviderKey",
      expectedStructuralType: "string",
      issueCategory: "FIELD_TYPE_MISMATCH",
      value: "PRIVATE_FIXTURE_VALUE_NEVER_PERSIST",
    } as never);
    expect(guarded.schemaDiagnostic).toBeNull();
    expect(JSON.stringify(guarded)).not.toMatch(
      /PRIVATE_FIXTURE_VALUE_NEVER_PERSIST|arbitraryProviderKey/i,
    );
  });

  it.each([
    ["empty id", { id: "" }],
    ["inert-empty title", { text: "<script>PRIVATE_FIXTURE_VALUE_NEVER_PERSIST</script>" }],
    [
      "missing effective location",
      { categories: { commitment: "Full-time", department: "Fictional Engineering" } },
    ],
    [
      "inert-empty description",
      {
        description: "",
        descriptionPlain: "",
        additional: "",
        additionalPlain: "",
        lists: [],
      },
    ],
  ] as const)(
    "separates product-unusable %s from provider schema drift",
    async (_label, override) => {
      const failure = await readLeverPageV2({
        capability: capability(),
        budget: new SourceRunBudget(capability(), instant),
        now: () => instant,
        dependencies: transport([{ ...posting(1), ...override }]),
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SecureSourceError);
      expect(failure).toMatchObject({
        code: "SOURCE_RECORD_UNUSABLE",
        lifecycleStage: "RESPONSE_BODY",
        schemaDiagnostic: null,
      });
      expect(String(failure)).not.toMatch(/PRIVATE_FIXTURE_VALUE_NEVER_PERSIST|script/i);
    },
  );

  it("preserves all-locations and list-content usability fallbacks", async () => {
    const page = await readLeverPageV2({
      capability: capability(),
      budget: new SourceRunBudget(capability(), instant),
      now: () => instant,
      dependencies: transport([
        {
          ...posting(1),
          description: "",
          descriptionPlain: "",
          additional: "",
          additionalPlain: "",
          categories: {
            ...posting(1).categories,
            location: "",
            allLocations: ["Remote Australia"],
          },
          lists: [{ text: "Requirements", content: "<p>Fictional systems evidence.</p>" }],
        },
      ]),
    });
    expect(page.records[0]).toMatchObject({
      location: null,
      allLocations: ["Remote Australia"],
      description: "Requirements\nFictional systems evidence.",
    });
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
