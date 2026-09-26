import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  InMemoryNonSubmitDurableStore,
  InMemoryFinalConsentStore,
  RunnerTargetCapabilitySchema,
  TargetIndependentApplicationRunner,
  TargetIndependentNonSubmitRunner,
  assertRunnerTargetCapabilityIdentity,
  deriveNextRunnerTargetCapability,
  deterministicRunnerTargetCapabilityId,
  freezeRunnerBinding,
  loadPrivateRunnerTargetAllowlist,
  runnerTargetCapabilityIdentity,
  runnerTargetReadiness,
  validateRunnerAuditMetadata,
  type ApplicationPacket,
  type ApplicationTargetAdapter,
  type NonSubmitTargetAdapter,
  type RunnerTargetCapability,
  type TargetObservation,
} from "./index";

const now = new Date("2026-09-10T02:00:00.000Z");

function packet(overrides: Partial<ApplicationPacket> = {}) {
  return ApplicationPacketSchema.parse({
    id: "packet:fictional",
    jobId: "job:fictional",
    jobVersionId: "job-version:1",
    profileVersionId: "profile-version:1",
    evaluationVersionId: "evaluation:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: "http://127.0.0.1:4123/synthetic-application",
    targetHost: "127.0.0.1",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "doc:fictional",
        type: "CV",
        fileName: "fictional.pdf",
        digest: "a".repeat(64),
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "fictional-answer",
        questionText: "Fictional verified answer",
        required: true,
        sensitive: true,
        value: true,
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:fictional"],
      },
    ],
    ...overrides,
  });
}

function capability(overrides: Partial<RunnerTargetCapability> = {}) {
  return RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: "runner:synthetic-fixture",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local form",
    allowedOrigin: "http://127.0.0.1:4123",
    allowedPathPrefix: "/synthetic-application",
    formVersion: "synthetic-form-v1",
    adapterVersion: "synthetic-adapter-v1",
    allowedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "SUBMIT"],
    approvalState: "APPROVED",
    approvalReference: "SYNTHETIC_FIXTURE_APPROVAL",
    approvedAt: "2026-09-10T00:00:00.000Z",
    policyVersion: "offline-fixture-v1",
    policyExpiresAt: "2027-09-10T00:00:00.000Z",
    capabilityExpiresAt: "2027-09-10T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  });
}

function nonSubmitCapability(overrides: Partial<RunnerTargetCapability> = {}) {
  return capability({
    capabilityId: "runner:synthetic-non-submit-fixture",
    allowedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"],
    ...overrides,
  });
}

class FixtureAdapter implements ApplicationTargetAdapter {
  readonly targetKind = "SYNTHETIC_LOCAL" as const;
  signal: TargetObservation["protectionSignals"] = [];
  outcome: "CONFIRMED" | "OUTCOME_UNKNOWN" = "CONFIRMED";
  submissions = 0;

  constructor(
    private readonly value: ReturnType<typeof packet>,
    private readonly target: ReturnType<typeof capability>,
  ) {}

  private observation(): TargetObservation {
    return {
      targetUrl: this.value.targetUrl!,
      formVersion: this.target.formVersion,
      adapterVersion: this.target.adapterVersion,
      documentDigests: this.value.documents.map(({ digest }) => digest),
      protectionSignals: this.signal,
      fieldReadBack: [],
      uploadEvidence: null,
      previewDigest: null,
    };
  }

  async open() {
    return this.observation();
  }
  async map() {
    return this.observation();
  }
  async fill() {
    return this.observation();
  }
  async submit() {
    this.submissions += 1;
    return this.outcome;
  }
}

class NonSubmitFixtureAdapter implements NonSubmitTargetAdapter {
  readonly targetKind = "SYNTHETIC_LOCAL" as const;
  readonly writes: string[] = [];
  signal: TargetObservation["protectionSignals"] = [];

  constructor(
    private readonly value: ReturnType<typeof packet>,
    private readonly target: ReturnType<typeof nonSubmitCapability>,
  ) {}

  private observation() {
    return {
      targetUrl: this.value.targetUrl!,
      formVersion: this.target.formVersion,
      adapterVersion: this.target.adapterVersion,
      documentDigests: this.value.documents.map(({ digest }) => digest),
      protectionSignals: this.signal,
      fieldReadBack: [],
      uploadEvidence: null,
      previewDigest: null,
    } satisfies TargetObservation;
  }

  async map() {
    this.writes.push("MAP_FOR_FILL");
    return this.observation();
  }
  async fill() {
    this.writes.push("FILL");
    return this.observation();
  }
  async upload() {
    this.writes.push("UPLOAD");
    return this.observation();
  }
  async verify() {
    this.writes.push("VERIFY");
    return this.observation();
  }
  async fillPreview() {
    this.writes.push("FILL_PREVIEW");
    return this.observation();
  }
}

function readyRunner() {
  const value = packet();
  const target = capability();
  const binding = freezeRunnerBinding(value, target);
  const adapter = new FixtureAdapter(value, target);
  const store = new InMemoryFinalConsentStore(() => now);
  const runner = new TargetIndependentApplicationRunner(
    value,
    target,
    binding,
    adapter,
    store,
    () => binding,
    () => now,
  );
  return { runner, adapter, binding };
}

describe("target-independent application runner", () => {
  it("runs the dormant synthetic non-submit path without exposing submit", async () => {
    const value = packet();
    const target = nonSubmitCapability();
    const binding = freezeRunnerBinding(value, target);
    const adapter = new NonSubmitFixtureAdapter(value, target);
    const runner = new TargetIndependentNonSubmitRunner(
      value,
      target,
      binding,
      adapter,
      () => binding,
      () => now,
    );
    expect((await runner.map()).state).toBe("MAPPED");
    expect((await runner.fill()).state).toBe("FILLED");
    expect((await runner.upload()).state).toBe("UPLOADED");
    expect((await runner.verify()).state).toBe("VERIFIED");
    expect((await runner.fillPreview()).state).toBe("FILL_PREVIEW");
    expect(adapter.writes).toEqual(["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"]);
    expect(runner.snapshot()).toMatchObject({ state: "FILL_PREVIEW", submitEnabled: false });
    expect((runner as unknown as { submit?: unknown }).submit).toBeUndefined();
  });

  it("durably claims operations so concurrent instances cannot replay a write", async () => {
    const value = packet();
    const target = nonSubmitCapability();
    const binding = freezeRunnerBinding(value, target);
    const store = new InMemoryNonSubmitDurableStore();
    const firstAdapter = new NonSubmitFixtureAdapter(value, target);
    const secondAdapter = new NonSubmitFixtureAdapter(value, target);
    const first = new TargetIndependentNonSubmitRunner(
      value,
      target,
      binding,
      firstAdapter,
      () => binding,
      () => now,
      store,
    );
    const second = new TargetIndependentNonSubmitRunner(
      value,
      target,
      binding,
      secondAdapter,
      () => binding,
      () => now,
      store,
    );
    const [firstResult, secondResult] = await Promise.all([first.map(), second.map()]);
    expect([firstResult.state, secondResult.state].sort()).toEqual(["MAPPED", "PAUSED"]);
    expect([firstResult.stopReason, secondResult.stopReason]).toContain("OPERATION_IN_PROGRESS");
    expect(firstAdapter.writes.concat(secondAdapter.writes)).toEqual(["MAP_FOR_FILL"]);
  });

  it("fails closed when a non-submit capability is real or the packet becomes stale", async () => {
    const value = packet();
    const target = capability({
      targetKind: "REAL_TARGET",
      allowedOrigin: "https://jobs.example.test",
      allowedPathPrefix: "/apply",
      allowedOperations: ["OPEN_AND_INSPECT_ONLY"],
    });
    const binding = freezeRunnerBinding(value, capability());
    const adapter = new NonSubmitFixtureAdapter(value, nonSubmitCapability());
    const runner = new TargetIndependentNonSubmitRunner(
      value,
      target,
      binding,
      adapter,
      () => binding,
      () => now,
    );
    expect(runner.snapshot()).toMatchObject({ state: "PAUSED", submitEnabled: false });
  });

  it("permits only closed safe runner audit metadata", () => {
    expect(
      validateRunnerAuditMetadata("runner.run.bound", {
        runId: "run:1",
        packetId: "packet:1",
        capabilityId: "capability:1",
        capabilityVersion: 1,
        unresolvedCount: 0,
      }),
    ).toBeDefined();
    expect(() =>
      validateRunnerAuditMetadata("runner.run.bound", {
        runId: "run:1",
        packetId: "packet:1",
        capabilityId: "capability:1",
        capabilityVersion: 1,
        unresolvedCount: 0,
        candidate: { email: "forbidden@example.test" },
      }),
    ).toThrow();
    expect(
      validateRunnerAuditMetadata("runner.target.versioned", {
        capabilityId: "capability:1",
        version: 1,
        state: "APPROVED",
        targetKind: "SYNTHETIC_LOCAL",
        operations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "SUBMIT"],
      }),
    ).toBeDefined();
  });

  it("loads target authority only from the confined ignored private file", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-runner-target-"));
    await mkdir(join(root, "data", "private"), { recursive: true });
    try {
      await expect(loadPrivateRunnerTargetAllowlist(root)).resolves.toEqual({
        status: "WAITING_FOR_APPROVED_TARGET",
        capabilities: [],
      });
      await writeFile(
        join(root, "data", "private", "runner-target-allowlist.json"),
        JSON.stringify({ schemaVersion: 2, capabilities: [capability()] }),
      );
      await expect(loadPrivateRunnerTargetAllowlist(root)).resolves.toMatchObject({
        status: "RUNNER_TARGET_ALLOWLIST_READY",
        capabilities: [{ capabilityId: "runner:synthetic-fixture" }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("binds packet, versions, documents, answers, disclosures, target and adapter", () => {
    const value = packet();
    const binding = freezeRunnerBinding(value, capability());
    expect(binding).toMatchObject({
      packetId: value.id,
      unresolvedCount: 0,
      targetPath: "/synthetic-application",
    });
    expect(binding.documentsDigest).toHaveLength(64);
    expect(binding.answersDigest).toHaveLength(64);
    expect(binding.disclosuresDigest).toHaveLength(64);
  });

  it("requires current approved, bounded target capability", () => {
    expect(runnerTargetReadiness(capability(), now).status).toBe("TARGET_ENABLED");
    expect(
      runnerTargetReadiness(
        capability({ approvalState: "DRAFT", approvalReference: null, approvedAt: null }),
        now,
      ),
    ).toMatchObject({ status: "TARGET_DISABLED" });
    expect(
      runnerTargetReadiness(capability({ capabilityExpiresAt: "2026-09-09T00:00:00.000Z" }), now),
    ).toMatchObject({ status: "TARGET_DISABLED", reason: "CAPABILITY_EXPIRED" });
  });

  it("keeps unresolved packets fail-closed in the normal application lane", async () => {
    const value = packet({ documents: [] });
    const target = capability();
    const binding = freezeRunnerBinding(value, target);
    const adapter = new FixtureAdapter(value, target);
    const runner = new TargetIndependentApplicationRunner(
      value,
      target,
      binding,
      adapter,
      new InMemoryFinalConsentStore(() => now),
      () => binding,
      () => now,
    );
    expect(binding.unresolvedCount).toBeGreaterThan(0);
    expect(runner.snapshot()).toMatchObject({
      state: "PAUSED",
      checkpoints: [{ state: "PAUSED", stopReason: "PACKET_NOT_READY" }],
      finalAttempts: 0,
    });
    await expect(runner.open()).rejects.toThrow("RUN_STATE_REQUIRED:PREPARED");
    expect(adapter.submissions).toBe(0);
  });

  it("derives a deterministic target capability id from exact authority and packet binding", () => {
    const input = {
      targetKind: "REAL_TARGET" as const,
      allowedOrigin: "https://jobs.lever.co",
      allowedPathPrefix: "/fictional/00000000-0000-4000-8000-000000000001/apply",
      operation: "OPEN_AND_INSPECT_ONLY" as const,
      formVersion: "lever-application-inspection-v1",
      adapterVersion: "lever-real-inspection-v1",
      packetDigest: "a".repeat(64),
    };
    expect(deterministicRunnerTargetCapabilityId(input)).toMatch(/^runner_[a-f0-9]{24}$/);
    expect(deterministicRunnerTargetCapabilityId(input)).toBe(
      deterministicRunnerTargetCapabilityId({ ...input }),
    );
    expect(
      deterministicRunnerTargetCapabilityId({ ...input, packetDigest: "b".repeat(64) }),
    ).not.toBe(deterministicRunnerTargetCapabilityId(input));
  });

  describe("target capability identity families", () => {
    const baseIdentity = {
      targetKind: "REAL_TARGET" as const,
      allowedOrigin: "https://jobs.lever.co",
      allowedPathPrefix: "/fictional/00000000-0000-4000-8000-000000000001/apply",
      operation: "OPEN_AND_INSPECT_ONLY" as const,
      formVersion: "lever-application-inspection-v1",
      adapterVersion: "lever-real-inspection-v1",
      packetDigest: "a".repeat(64),
    };
    const lifecycle = {
      alias: "Fictional read-only inspection",
      approvalState: "DRAFT" as const,
      approvalReference: null,
      approvedAt: null,
      policyVersion: "fictional-policy-v1",
      policyExpiresAt: "2026-09-11T02:00:00.000Z",
      capabilityExpiresAt: "2026-09-10T03:00:00.000Z",
      revokedAt: null,
    };

    it("derives the independently reviewed adapter-v2 family for the private packet digest", () => {
      expect(
        deterministicRunnerTargetCapabilityId({
          targetKind: "REAL_TARGET",
          allowedOrigin: "https://jobs.lever.co",
          allowedPathPrefix: "/shieldai/ec27312c-b829-42fb-9a1f-e5733b38b0c1/apply",
          operation: "OPEN_AND_INSPECT_ONLY",
          formVersion: "lever-application-inspection-v1",
          adapterVersion: "lever-real-inspection-v2",
          packetDigest: "69cbad61af3830a30ce919cc1d0830696ddc2dbdd043965205c9c166e6196a78",
        }),
      ).toBe("runner_2fb0a3653f3e4337c60abce6");
    });

    it.each([
      ["adapterVersion", { adapterVersion: "lever-real-inspection-v2" }],
      ["formVersion", { formVersion: "lever-application-inspection-v2" }],
      ["packetDigest", { packetDigest: "b".repeat(64) }],
      ["allowedOrigin", { allowedOrigin: "https://example.test" }],
      ["allowedPathPrefix", { allowedPathPrefix: "/fictional/changed/apply" }],
      ["operation", { operation: "MAP_FOR_FILL" as const }],
      ["targetKind", { targetKind: "SYNTHETIC_LOCAL" as const }],
    ])("rotates identity when %s changes", (_field, change) => {
      expect(deterministicRunnerTargetCapabilityId({ ...baseIdentity, ...change })).not.toBe(
        deterministicRunnerTargetCapabilityId(baseIdentity),
      );
    });

    it.each([
      ["alias", { alias: "Renamed fictional inspection" }],
      ["approvalState", { approvalState: "REVOKED" as const, revokedAt: now.toISOString() }],
      [
        "approvalReference",
        {
          approvalState: "APPROVED" as const,
          approvalReference: "fictional-owner-approval",
          approvedAt: now.toISOString(),
        },
      ],
      [
        "approvedAt",
        {
          approvalState: "APPROVED" as const,
          approvalReference: "fictional-owner-approval",
          approvedAt: "2026-09-10T02:01:00.000Z",
        },
      ],
      ["revokedAt", { approvalState: "REVOKED" as const, revokedAt: now.toISOString() }],
      ["policyVersion", { policyVersion: "fictional-policy-v2" }],
      ["policyExpiresAt", { policyExpiresAt: "2026-09-12T02:00:00.000Z" }],
      ["capabilityExpiresAt", { capabilityExpiresAt: "2026-09-10T04:00:00.000Z" }],
    ])("keeps the identity family when %s changes", (_field, change) => {
      const first = deriveNextRunnerTargetCapability({
        previous: null,
        identity: baseIdentity,
        lifecycle,
      });
      const nextLifecycle = { ...lifecycle, ...change };
      const next = deriveNextRunnerTargetCapability({
        previous: first,
        identity: baseIdentity,
        lifecycle: nextLifecycle,
      });
      expect(next).toMatchObject({
        capabilityId: first.capabilityId,
        version: 2,
        predecessorVersion: 1,
      });
    });

    it("aligns preparation and execution identity while starting changed adapter scope at version one", () => {
      const first = deriveNextRunnerTargetCapability({
        previous: null,
        identity: baseIdentity,
        lifecycle,
      });
      const second = deriveNextRunnerTargetCapability({
        previous: first,
        identity: baseIdentity,
        lifecycle,
      });
      const third = deriveNextRunnerTargetCapability({
        previous: second,
        identity: baseIdentity,
        lifecycle,
      });
      expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
      expect([
        first.predecessorVersion,
        second.predecessorVersion,
        third.predecessorVersion,
      ]).toEqual([null, 1, 2]);
      const lifecycleOnlyVersion = RunnerTargetCapabilitySchema.parse({
        ...third,
        version: 9,
        predecessorVersion: 8,
      });
      expect(
        deterministicRunnerTargetCapabilityId(
          runnerTargetCapabilityIdentity(lifecycleOnlyVersion, baseIdentity.packetDigest),
        ),
      ).toBe(first.capabilityId);

      const changedIdentity = { ...baseIdentity, adapterVersion: "lever-real-inspection-v2" };
      const malformed = RunnerTargetCapabilitySchema.parse({
        ...third,
        adapterVersion: changedIdentity.adapterVersion,
      });
      expect(() =>
        assertRunnerTargetCapabilityIdentity(
          malformed,
          runnerTargetCapabilityIdentity(malformed, changedIdentity.packetDigest),
        ),
      ).toThrow("TARGET_CAPABILITY_IDENTITY_MISMATCH");
      expect(() =>
        deriveNextRunnerTargetCapability({
          previous: malformed,
          identity: baseIdentity,
          lifecycle,
        }),
      ).toThrow("TARGET_CAPABILITY_IDENTITY_MISMATCH");

      const changed = deriveNextRunnerTargetCapability({
        previous: third,
        identity: changedIdentity,
        lifecycle,
      });
      expect(changed).toMatchObject({
        capabilityId: deterministicRunnerTargetCapabilityId(changedIdentity),
        version: 1,
        predecessorVersion: null,
      });
      expect(() =>
        assertRunnerTargetCapabilityIdentity(
          changed,
          runnerTargetCapabilityIdentity(changed, changedIdentity.packetDigest),
        ),
      ).not.toThrow();
    });
  });

  it.each([
    "CAPTCHA",
    "MFA",
    "AUTHENTICATION_REQUIRED",
    "BOT_DETECTION",
    "RATE_LIMIT",
    "ACCESS_CONTROL",
    "WEBSITE_RESTRICTION",
    "PAGE_CHANGED",
  ] as const)("stops on %s without a final attempt", async (signal) => {
    const { runner, adapter } = readyRunner();
    adapter.signal = [signal];
    expect(await runner.open()).toMatchObject({ state: "PAUSED", stopReason: signal });
    expect(runner.snapshot().finalAttempts).toBe(0);
  });

  it("fails closed when packet or version binding becomes stale", async () => {
    const value = packet();
    const target = capability();
    const binding = freezeRunnerBinding(value, target);
    const stale = { ...binding, profileVersionId: "profile-version:2" };
    const runner = new TargetIndependentApplicationRunner(
      value,
      target,
      binding,
      new FixtureAdapter(value, target),
      new InMemoryFinalConsentStore(() => now),
      () => stale,
      () => now,
    );
    expect(await runner.open()).toMatchObject({ state: "PAUSED", stopReason: "PAGE_CHANGED" });
  });

  it.each(["open", "map", "fill"] as const)(
    "pauses without retry when the synthetic %s stage is interrupted",
    async (stage) => {
      const { runner, adapter } = readyRunner();
      if (stage !== "open") await runner.open();
      if (stage === "fill") await runner.map();
      let calls = 0;
      adapter[stage] = async () => {
        calls += 1;
        throw new Error("fictional interruption detail");
      };
      expect(await runner[stage]()).toMatchObject({ state: "PAUSED", stopReason: "PAGE_CHANGED" });
      expect(calls).toBe(1);
      await expect(runner[stage]()).rejects.toThrow(/^RUN_STATE_REQUIRED:/);
      expect(calls).toBe(1);
      expect(runner.snapshot().finalAttempts).toBe(0);
    },
  );

  it("rejects malformed adapter observations before advancing", async () => {
    const { runner, adapter } = readyRunner();
    adapter.open = async () =>
      ({
        targetUrl: "not-a-url",
        formVersion: "synthetic-form-v1",
        adapterVersion: "synthetic-adapter-v1",
        documentDigests: [],
        protectionSignals: [],
        privateValue: "must not be accepted",
      }) as never;
    expect(await runner.open()).toMatchObject({ state: "PAUSED", stopReason: "PAGE_CHANGED" });
    expect(runner.snapshot().finalAttempts).toBe(0);
  });

  it("binds in-memory final consent to the complete frozen runner binding", () => {
    const { binding } = readyRunner();
    const store = new InMemoryFinalConsentStore(() => now);
    const consent = store.issue(binding, 60_000);
    expect(consent.bindingDigest).toHaveLength(64);
    expect(
      store.consume({
        id: consent.id,
        token: consent.token,
        binding: { ...binding, adapterVersion: "synthetic-adapter-v2" },
        now,
      }),
    ).toBe(false);
  });

  it("requires one-use exact final consent and performs one synthetic final attempt", async () => {
    const { runner, adapter } = readyRunner();
    await runner.open();
    await runner.map();
    await runner.fill();
    runner.readyForFinalReview();
    const consent = runner.createConsent();
    expect(
      await runner.submit({ consentId: consent.id, token: consent.token, ownerConfirmed: true }),
    ).toMatchObject({ state: "SYNTHETIC_SUBMITTED" });
    expect(adapter.submissions).toBe(1);
    await expect(
      runner.submit({ consentId: consent.id, token: consent.token, ownerConfirmed: true }),
    ).rejects.toThrow("RUN_TERMINAL");
    expect(adapter.submissions).toBe(1);
  });

  it("refuses to reuse an inspection-only real capability in the application lane", () => {
    const value = packet({
      targetUrl: "https://careers.example.test/apply/fictional",
      targetHost: "careers.example.test",
    });
    const target = capability({
      targetKind: "REAL_TARGET",
      allowedOrigin: "https://careers.example.test",
      allowedPathPrefix: "/apply/",
      allowedOperations: ["OPEN_AND_INSPECT_ONLY"],
    });
    expect(() => freezeRunnerBinding(value, target)).toThrow("TARGET_OPERATION_SCOPE_INVALID");
  });

  it("treats a lost or ambiguous response as terminal OUTCOME_UNKNOWN and never retries", async () => {
    const { runner, adapter } = readyRunner();
    adapter.outcome = "OUTCOME_UNKNOWN";
    await runner.open();
    await runner.map();
    await runner.fill();
    runner.readyForFinalReview();
    const consent = runner.createConsent();
    expect(
      await runner.submit({ consentId: consent.id, token: consent.token, ownerConfirmed: true }),
    ).toMatchObject({ state: "OUTCOME_UNKNOWN" });
    await expect(
      runner.submit({ consentId: consent.id, token: consent.token, ownerConfirmed: true }),
    ).rejects.toThrow("RUN_TERMINAL");
    expect(adapter.submissions).toBe(1);
  });

  it("cannot bind a packet to a different host or path", () => {
    expect(() =>
      freezeRunnerBinding(
        packet({ targetUrl: "http://localhost:4123/other", targetHost: "localhost" }),
        capability(),
      ),
    ).toThrow("TARGET_CAPABILITY_MISMATCH");
  });
});
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
