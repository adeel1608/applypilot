import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPrivateSourceAllowlistV2: vi.fn(),
  getLocalDatabase: vi.fn(),
  getSourceEnablementRepository: vi.fn(),
  persistCapabilityVersion: vi.fn(),
  createOwnerApprovalAndStartReceipt: vi.fn(),
  createOwnerStartReceipt: vi.fn(),
  runGreenhouseSourceToQueue: vi.fn(),
  runLeverSourceToQueue: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@applypilot/job-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@applypilot/job-sources")>();
  return { ...actual, loadPrivateSourceAllowlistV2: mocks.loadPrivateSourceAllowlistV2 };
});
vi.mock("@applypilot/database", () => ({
  runGreenhouseSourceToQueue: mocks.runGreenhouseSourceToQueue,
  runLeverSourceToQueue: mocks.runLeverSourceToQueue,
}));
vi.mock("./beta-workspace", () => ({
  reevaluateBetaJob: vi.fn(),
  setBetaQueueState: vi.fn(),
}));
vi.mock("./local-database", () => ({
  getLocalDatabase: mocks.getLocalDatabase,
  getSourceEnablementRepository: mocks.getSourceEnablementRepository,
}));
vi.mock("./local-data-directory", () => ({
  resolveLocalDataDirectory: () => "C:/fictional/applypilot/data/private",
}));

import {
  SourceCapabilityV2Schema,
  sourceCapabilityDigest,
  type SourcePersistenceDiagnostic,
} from "@applypilot/job-sources";

import {
  approveAndRunOwnerSource,
  getSourceEnablementView,
  revokeSourceCapability,
  runOwnerApprovedSource,
} from "./source-workspace";

function capability(version: number, state: "APPROVED" | "REVOKED") {
  const approved = state === "APPROVED";
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "fixture-source-family",
    version,
    predecessorVersion: version === 1 ? null : version - 1,
    source: "GREENHOUSE",
    alias: `Fictional Board v${version}`,
    tenant: "fictional-board",
    region: "GLOBAL",
    allowedHost: "boards-api.greenhouse.io",
    allowedPathPrefix: "/v1/boards/fictional-board/",
    allowedOperations: ["LIST_JOBS"],
    approvalState: state,
    approvalReference: approved ? `owner:fixture-v${version}` : null,
    approvedAt: approved ? "2026-09-30T00:00:00.000Z" : null,
    policyVersion: "fixture-policy-v1",
    policyReviewedAt: "2026-09-30T00:00:00.000Z",
    policyExpiresAt: "2099-09-30T00:00:00.000Z",
    capabilityExpiresAt: "2099-09-30T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 100,
    pageSizeCap: 100,
    responseByteLimit: 2_000_000,
    requestTimeoutMs: 30_000,
    runTimeoutMs: 120_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "greenhouse-v2-fixture",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    revokedAt: approved ? null : "2026-09-30T00:00:00.000Z",
    revocationReason: approved ? null : "OWNER_REVOKED",
  });
}

describe("source workspace current capability lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalDatabase.mockReturnValue({ sqlite: { prepare: () => ({ all: () => [] }) } });
    mocks.getSourceEnablementRepository.mockReturnValue({
      ownerActionReceiptSchemaAvailable: () => true,
      getOwnerApprovalStatus: () => ({
        state: "APPROVAL_REQUIRED",
        receiptId: null,
        canStart: false,
      }),
      getRunOwnerProvenance: () => "OWNER_RECEIPTS_BOUND",
      persistCapabilityVersion: mocks.persistCapabilityVersion,
      createOwnerApprovalAndStartReceipt: mocks.createOwnerApprovalAndStartReceipt,
      createOwnerStartReceipt: mocks.createOwnerStartReceipt,
    });
  });

  it("renders only the latest family head with its canonical digest", async () => {
    const previous = capability(2, "REVOKED");
    const head = capability(3, "APPROVED");
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, head],
    });

    const view = await getSourceEnablementView();

    expect(view.capabilities).toHaveLength(1);
    expect(view.capabilities[0]).toMatchObject({
      capabilityId: "fixture-source-family",
      version: 3,
      configurationDigest: sourceCapabilityDigest(head),
    });
  });

  it("keeps a disabled latest head visible without falling back to an enabled predecessor", async () => {
    const previous = capability(2, "APPROVED");
    const revokedHead = capability(3, "REVOKED");
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, revokedHead],
    });

    const view = await getSourceEnablementView();

    expect(view.capabilities).toHaveLength(1);
    expect(view.capabilities[0]).toMatchObject({ version: 3, readiness: "SOURCE_DISABLED" });
  });

  it("projects only strict safe persistence diagnostics in recent runs", async () => {
    const persistenceDiagnostic: SourcePersistenceDiagnostic = {
      phase: "JOB_UPSERT",
      recordIndex: 5,
      externalIdHashPrefix: "1234567890ab",
      provider: "GREENHOUSE",
      sqliteCodeClass: "SQLITE_CONSTRAINT_UNIQUE",
      safeDomainCode: null,
      transactionRolledBack: true,
      pageProviderRecordCount: 28,
      acceptedRecordCount: 28,
      unusableRecordCount: 0,
    };
    const recentRow = {
      id: "run:persistence",
      status: "STOPPED",
      source: "GREENHOUSE",
      alias: "Fictional Board",
      requestCount: 1,
      pageCount: 1,
      recordCount: 28,
      persistedPageProviderRecordCount: 0,
      unusableRecordCount: 0,
      providerDriftWarningCount: 0,
      persistedObservationCount: 0,
      safeErrorCode: "PERSISTENCE_FAILED",
      transportStage: "PERSISTENCE",
      schemaField: null,
      schemaExpectedType: null,
      schemaIssueCategory: null,
      schemaRecordIndex: null,
      persistenceDiagnosticJson: JSON.stringify(persistenceDiagnostic),
      retryAfter: null,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:00:01.000Z",
    };
    mocks.getLocalDatabase.mockReturnValue({
      sqlite: { prepare: () => ({ all: () => [recentRow] }) },
    });
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [],
    });

    const view = await getSourceEnablementView();

    expect(view.recentRuns[0]?.persistenceDiagnostic).toEqual(persistenceDiagnostic);
    expect(JSON.stringify(view.recentRuns[0]?.persistenceDiagnostic)).not.toContain("SQL ");
  });

  it("atomically approves and starts the exact current Greenhouse head", async () => {
    const previous = capability(2, "REVOKED");
    const head = capability(3, "APPROVED");
    const approvalGateProof = {
      action: "SOURCE_CAPABILITY_APPROVE" as const,
      consumedAt: "2026-10-01T00:00:00.000Z",
      loopbackValidated: true as const,
      localSessionValidated: true as const,
      nonceConsumed: true as const,
    };
    const startGateProof = {
      ...approvalGateProof,
      action: "SOURCE_RUN_START" as const,
    };
    const ownerReceiptChain = {
      approvalReceiptId: "fixture-approval",
      startReceiptId: "fixture-start",
    };
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, head],
    });
    mocks.createOwnerApprovalAndStartReceipt.mockReturnValue(ownerReceiptChain);
    mocks.runGreenhouseSourceToQueue.mockResolvedValue({ status: "COMPLETE" });

    await approveAndRunOwnerSource(
      {
        capabilityId: head.capabilityId,
        version: head.version,
        capabilityDigest: sourceCapabilityDigest(head),
      },
      { approval: approvalGateProof, start: startGateProof },
      `APPROVE AND RUN ${head.capabilityId}`,
    );

    expect(mocks.persistCapabilityVersion).toHaveBeenCalledExactlyOnceWith(head);
    expect(mocks.createOwnerApprovalAndStartReceipt).toHaveBeenCalledExactlyOnceWith({
      capability: head,
      operation: "LIST_JOBS",
      approvalGateProof,
      startGateProof,
      confirmationText: `APPROVE AND RUN ${head.capabilityId}`,
      ownerConfirmed: true,
    });
    expect(mocks.runGreenhouseSourceToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ capability: head, ownerReceiptChain }),
    );
    expect(mocks.runLeverSourceToQueue).not.toHaveBeenCalled();
  });

  it("dispatches the combined current head to the canonical Lever runner", async () => {
    const head = capability(1, "APPROVED");
    const leverHead = SourceCapabilityV2Schema.parse({
      ...head,
      source: "LEVER",
      alias: "Fictional Lever Board",
      tenant: "fictional-lever",
      allowedHost: "api.lever.co",
      allowedPathPrefix: "/v0/postings/fictional-lever",
    });
    const approval = {
      action: "SOURCE_CAPABILITY_APPROVE" as const,
      consumedAt: "2026-10-01T00:00:00.000Z",
      loopbackValidated: true as const,
      localSessionValidated: true as const,
      nonceConsumed: true as const,
    };
    const start = { ...approval, action: "SOURCE_RUN_START" as const };
    const ownerReceiptChain = {
      approvalReceiptId: "fixture-approval-lever",
      startReceiptId: "fixture-start-lever",
    };
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [leverHead],
    });
    mocks.createOwnerApprovalAndStartReceipt.mockReturnValue(ownerReceiptChain);
    mocks.runLeverSourceToQueue.mockResolvedValue({ status: "COMPLETE" });

    await approveAndRunOwnerSource(
      {
        capabilityId: leverHead.capabilityId,
        version: leverHead.version,
        capabilityDigest: sourceCapabilityDigest(leverHead),
      },
      { approval, start },
      `APPROVE AND RUN ${leverHead.capabilityId}`,
    );

    expect(mocks.createOwnerApprovalAndStartReceipt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ capability: leverHead, operation: "LIST_JOBS" }),
    );
    expect(mocks.runLeverSourceToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ capability: leverHead, ownerReceiptChain }),
    );
    expect(mocks.runGreenhouseSourceToQueue).not.toHaveBeenCalled();
  });

  it("creates a mocked START chain only for the exact current Greenhouse head", async () => {
    const previous = capability(2, "REVOKED");
    const head = capability(3, "APPROVED");
    const gateProof = {
      action: "SOURCE_RUN_START" as const,
      consumedAt: "2026-10-01T00:00:00.000Z",
      loopbackValidated: true as const,
      localSessionValidated: true as const,
      nonceConsumed: true as const,
    };
    const ownerReceiptChain = {
      approvalReceipt: { id: "fixture-approval" },
      startReceipt: { id: "fixture-start" },
    };
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, head],
    });
    mocks.createOwnerStartReceipt.mockReturnValue(ownerReceiptChain);
    mocks.runGreenhouseSourceToQueue.mockResolvedValue({ status: "COMPLETE" });

    await runOwnerApprovedSource(
      {
        capabilityId: head.capabilityId,
        version: head.version,
        capabilityDigest: sourceCapabilityDigest(head),
      },
      gateProof,
    );

    expect(mocks.persistCapabilityVersion).toHaveBeenCalledExactlyOnceWith(head);
    expect(mocks.createOwnerStartReceipt).toHaveBeenCalledExactlyOnceWith({
      capability: head,
      operation: "LIST_JOBS",
      gateProof,
      ownerConfirmed: true,
    });
    expect(mocks.runGreenhouseSourceToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ capability: head, ownerReceiptChain }),
    );
    expect(mocks.runLeverSourceToQueue).not.toHaveBeenCalled();
  });

  it("revokes the exact current head by creating its next immutable version", async () => {
    const previous = capability(2, "REVOKED");
    const head = capability(3, "APPROVED");
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, head],
    });

    await revokeSourceCapability({
      capabilityId: head.capabilityId,
      version: head.version,
      capabilityDigest: sourceCapabilityDigest(head),
    });

    expect(mocks.persistCapabilityVersion).toHaveBeenCalledTimes(2);
    expect(mocks.persistCapabilityVersion).toHaveBeenNthCalledWith(1, head);
    expect(mocks.persistCapabilityVersion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capabilityId: head.capabilityId,
        version: 4,
        predecessorVersion: 3,
        approvalState: "REVOKED",
        revocationReason: "OWNER_REVOKED",
      }),
    );
  });

  it("rejects stale v2 approval, RUN, and REVOKE bindings before repository or transport calls", async () => {
    const previous = capability(2, "REVOKED");
    const head = capability(3, "APPROVED");
    const staleBinding = {
      capabilityId: previous.capabilityId,
      version: previous.version,
      capabilityDigest: sourceCapabilityDigest(previous),
    };
    const gateProof = {
      action: "SOURCE_RUN_START" as const,
      consumedAt: "2026-10-01T00:00:00.000Z",
      loopbackValidated: true as const,
      localSessionValidated: true as const,
      nonceConsumed: true as const,
    };
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [previous, head],
    });

    await expect(
      approveAndRunOwnerSource(
        staleBinding,
        {
          approval: {
            ...gateProof,
            action: "SOURCE_CAPABILITY_APPROVE" as const,
          },
          start: gateProof,
        },
        `APPROVE AND RUN ${staleBinding.capabilityId}`,
      ),
    ).rejects.toThrow("SOURCE_CAPABILITY_VIEW_STALE");
    await expect(runOwnerApprovedSource(staleBinding, gateProof)).rejects.toThrow(
      "SOURCE_CAPABILITY_VIEW_STALE",
    );
    await expect(revokeSourceCapability(staleBinding)).rejects.toThrow(
      "SOURCE_CAPABILITY_VIEW_STALE",
    );

    expect(mocks.getSourceEnablementRepository).not.toHaveBeenCalled();
    expect(mocks.persistCapabilityVersion).not.toHaveBeenCalled();
    expect(mocks.createOwnerApprovalAndStartReceipt).not.toHaveBeenCalled();
    expect(mocks.createOwnerStartReceipt).not.toHaveBeenCalled();
    expect(mocks.runGreenhouseSourceToQueue).not.toHaveBeenCalled();
    expect(mocks.runLeverSourceToQueue).not.toHaveBeenCalled();
  });

  it("rejects a tampered current version digest before accessing repository state", async () => {
    const head = capability(3, "APPROVED");
    mocks.loadPrivateSourceAllowlistV2.mockResolvedValue({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [head],
    });

    await expect(
      revokeSourceCapability({
        capabilityId: head.capabilityId,
        version: head.version,
        capabilityDigest: "0".repeat(64),
      }),
    ).rejects.toThrow("SOURCE_CAPABILITY_VIEW_STALE");
    expect(mocks.getSourceEnablementRepository).not.toHaveBeenCalled();
  });
});
