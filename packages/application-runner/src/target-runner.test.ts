import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  InMemoryFinalConsentStore,
  RunnerTargetCapabilitySchema,
  TargetIndependentApplicationRunner,
  freezeRunnerBinding,
  loadPrivateRunnerTargetAllowlist,
  runnerTargetReadiness,
  validateRunnerAuditMetadata,
  type ApplicationPacket,
  type ApplicationTargetAdapter,
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
    schemaVersion: 1,
    capabilityId: "runner:synthetic-fixture",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local form",
    allowedOrigin: "http://127.0.0.1:4123",
    allowedPathPrefix: "/synthetic-application",
    formVersion: "synthetic-form-v1",
    adapterVersion: "synthetic-adapter-v1",
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
        JSON.stringify({ schemaVersion: 1, capabilities: [capability()] }),
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

  it("keeps a real-shaped target behind the same frozen gates using a no-network fixture adapter", async () => {
    const value = packet({
      targetUrl: "https://careers.example.test/apply/fictional",
      targetHost: "careers.example.test",
    });
    const target = capability({
      targetKind: "REAL_TARGET",
      allowedOrigin: "https://careers.example.test",
      allowedPathPrefix: "/apply/",
    });
    const binding = freezeRunnerBinding(value, target);
    let submissions = 0;
    const observation: TargetObservation = {
      targetUrl: value.targetUrl!,
      formVersion: target.formVersion,
      adapterVersion: target.adapterVersion,
      documentDigests: value.documents.map(({ digest }) => digest),
      protectionSignals: [],
    };
    const adapter: ApplicationTargetAdapter = {
      targetKind: "REAL_TARGET",
      open: async () => observation,
      map: async () => observation,
      fill: async () => observation,
      submit: async () => {
        submissions += 1;
        return "CONFIRMED";
      },
    };
    const runner = new TargetIndependentApplicationRunner(
      value,
      target,
      binding,
      adapter,
      new InMemoryFinalConsentStore(() => now),
      () => binding,
      () => now,
    );
    await runner.open();
    await runner.map();
    await runner.fill();
    runner.readyForFinalReview();
    const consent = runner.createConsent();
    expect(
      await runner.submit({
        consentId: consent.id,
        token: consent.token,
        ownerConfirmed: true,
      }),
    ).toMatchObject({ state: "SUBMITTED" });
    expect(submissions).toBe(1);
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
