import { createHash } from "node:crypto";

import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  assertSourceRequestBinding,
  sourceRequestBindingDigest,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  type SourceCapabilityV2,
  type SourceOperation,
  type SourceProviderDriftDiagnostic,
  type SourceRecordUnusableDiagnostic,
  type SourceSchemaDiagnostic,
  type SourcePersistenceDiagnostic,
  type SourceTransportLifecycleStage,
} from "./source-capability";
import { SourcePersistenceError } from "./source-capability";
import {
  SecureSourceError,
  type SecureSourceTransportDependencies,
} from "./secure-source-transport";
import {
  readLeverDetailV2WithMetadata,
  readLeverPageV2,
  type LeverPageV2,
  type LeverPostingRecordV2,
} from "./lever/v2-reader";

export interface SourceRunSink {
  start(input: {
    capability: SourceCapabilityV2;
    capabilityDigest: string;
    operation: SourceOperation;
    startedAt: string;
    ownerApprovalReceiptId: string;
    ownerStartReceiptId: string;
  }): Promise<string> | string;
  assertCapabilityCurrent(input: {
    runId: string;
    capabilityId: string;
    capabilityVersion: number;
    capabilityDigest: string;
    requestBindingDigest?: string;
  }): Promise<void> | void;
  persistPage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: LeverPageV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): Promise<void> | void;
  persistDetail?(input: {
    runId: string;
    capability: SourceCapabilityV2;
    externalId: string;
    record: LeverPostingRecordV2;
    pageDigest: string;
    budget: SourceRunBudget;
    observedAt: string;
  }): Promise<void> | void;
  complete(input: {
    runId: string;
    budget: SourceRunBudget;
    completedAt: string;
  }): Promise<void> | void;
  stop(input: {
    runId: string;
    budget: SourceRunBudget;
    code: string;
    retryAfter: string | null;
    transportStage: SourceTransportLifecycleStage | null;
    schemaDiagnostic: SourceSchemaDiagnostic | null;
    persistenceDiagnostic?: SourcePersistenceDiagnostic;
    stoppedAt: string;
  }): Promise<void> | void;
}

export interface LeverSourceRunResult {
  runId: string;
  status: "COMPLETE" | "STOPPED";
  records: LeverPostingRecordV2[];
  requestCount: number;
  pageCount: number;
  recordCount: number;
  providerRecordCount: number;
  acceptedRecordCount: number;
  unusableRecordCount: number;
  stopCode: string | null;
  safeUnusableDiagnostics: readonly SourceRecordUnusableDiagnostic[];
  providerDriftDiagnostics: readonly SourceProviderDriftDiagnostic[];
}

export interface SourceOwnerReceiptChain {
  approvalReceiptId: string;
  startReceiptId: string;
}

function safeStopCode(error: unknown): string {
  if (error instanceof SecureSourceError && error.code === "HTTP_404") return "DETAIL_NOT_FOUND";
  if (error instanceof SecureSourceError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return "PERSISTENCE_FAILED";
}

function detailPageDigest(externalId: string, record: LeverPostingRecordV2): string {
  return createHash("sha256")
    .update(`GET_JOB\n${externalId}\n${record.externalId}\n${record.contentDigest}`)
    .digest("hex");
}

export async function runLeverSourceDiscovery(input: {
  capability: SourceCapabilityV2;
  sink: SourceRunSink;
  ownerReceiptChain: SourceOwnerReceiptChain;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
  startCursor?: number;
}): Promise<LeverSourceRunResult> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  if (capability.source !== "LEVER") throw new SecureSourceError("SOURCE_MISMATCH");
  assertSourceRequestBinding(capability, "LIST_JOBS");
  const now = input.now ?? (() => new Date());
  const readiness = sourceCapabilityReadiness(capability, now());
  if (readiness.status !== "SOURCE_ENABLED") {
    throw new SecureSourceError(
      readiness.status === "SOURCE_DISABLED" ? readiness.reason : "NOT_APPROVED",
    );
  }
  const digest = sourceCapabilityDigest(capability);
  const budget = new SourceRunBudget(capability, now());
  const runId = await input.sink.start({
    capability,
    capabilityDigest: digest,
    operation: "LIST_JOBS",
    startedAt: now().toISOString(),
    ownerApprovalReceiptId: input.ownerReceiptChain.approvalReceiptId,
    ownerStartReceiptId: input.ownerReceiptChain.startReceiptId,
  });
  const records: LeverPostingRecordV2[] = [];
  const safeUnusableDiagnostics: SourceRecordUnusableDiagnostic[] = [];
  const providerDriftDiagnostics: SourceProviderDriftDiagnostic[] = [];
  let cursor = input.startCursor ?? 0;
  try {
    while (true) {
      if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
      await input.sink.assertCapabilityCurrent({
        runId,
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.version,
        capabilityDigest: digest,
        ...(capability.requestBinding
          ? { requestBindingDigest: sourceRequestBindingDigest(capability.requestBinding) }
          : {}),
      });
      const page = await readLeverPageV2({
        capability,
        budget,
        cursor,
        pageSize: capability.pageSizeCap,
        now,
        signal: input.signal,
        dependencies: input.dependencies,
      });
      try {
        await input.sink.persistPage({
          runId,
          capability,
          page,
          budget,
          observedAt: now().toISOString(),
        });
      } catch (error) {
        if (error instanceof SourcePersistenceError) throw error;
        throw new SecureSourceError("PERSISTENCE_FAILED", null, "PERSISTENCE");
      }
      records.push(...page.acceptedRecords);
      safeUnusableDiagnostics.push(...page.safeUnusableDiagnostics);
      providerDriftDiagnostics.push(...page.providerDriftDiagnostics);
      if (page.nextCursor === null) break;
      if (page.nextCursor <= cursor) throw new SecureSourceError("CURSOR_REVERSED");
      cursor = page.nextCursor;
    }
    budget.assertCurrent(now());
    try {
      await input.sink.complete({ runId, budget, completedAt: now().toISOString() });
    } catch (error) {
      if (error instanceof SourcePersistenceError) throw error;
      throw new SecureSourceError("PERSISTENCE_FAILED", null, "PERSISTENCE");
    }
    return {
      runId,
      status: "COMPLETE",
      records,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: budget.records,
      acceptedRecordCount: records.length,
      unusableRecordCount: safeUnusableDiagnostics.length,
      stopCode: null,
      safeUnusableDiagnostics,
      providerDriftDiagnostics,
    };
  } catch (error) {
    const code = safeStopCode(error);
    await input.sink.stop({
      runId,
      budget,
      code,
      retryAfter: error instanceof SecureSourceError ? error.retryAfter : null,
      transportStage:
        error instanceof SecureSourceError
          ? error.lifecycleStage
          : error instanceof SourcePersistenceError
            ? "PERSISTENCE"
            : null,
      schemaDiagnostic: error instanceof SecureSourceError ? error.schemaDiagnostic : null,
      ...(error instanceof SourcePersistenceError
        ? { persistenceDiagnostic: error.persistenceDiagnostic }
        : {}),
      stoppedAt: now().toISOString(),
    });
    return {
      runId,
      status: "STOPPED",
      records,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: budget.records,
      acceptedRecordCount: records.length,
      unusableRecordCount: safeUnusableDiagnostics.length,
      stopCode: code,
      safeUnusableDiagnostics,
      providerDriftDiagnostics,
    };
  }
}

export type LeverDetailTerminalState =
  | "COMPLETE"
  | "NOT_FOUND"
  | "STOPPED"
  | "SOURCE_RECORD_UNUSABLE"
  | "PERSISTENCE_FAILED";

export interface LeverDetailSourceRunResult extends LeverSourceRunResult {
  operation: "GET_JOB";
  externalId: string;
  terminalState: LeverDetailTerminalState;
  record: LeverPostingRecordV2 | null;
  pageDigest: string | null;
}

/**
 * Run exactly one bounded Lever detail request and persist it through the
 * same durable source-run lifecycle used by list discovery. The sink owns
 * the immutable page/observation/verification transaction.
 */
export async function runLeverDetailSourceDiscovery(input: {
  capability: SourceCapabilityV2;
  sink: SourceRunSink & {
    persistDetail: NonNullable<SourceRunSink["persistDetail"]>;
  };
  ownerReceiptChain: SourceOwnerReceiptChain;
  externalId: string;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<LeverDetailSourceRunResult> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  if (capability.source !== "LEVER") throw new SecureSourceError("SOURCE_MISMATCH");
  const externalId = /^[A-Za-z0-9_-]{1,100}$/.test(input.externalId)
    ? input.externalId
    : (() => {
        throw new SecureSourceError("SOURCE_DETAIL_ID_INVALID");
      })();
  assertSourceRequestBinding(capability, "GET_JOB", externalId);
  const now = input.now ?? (() => new Date());
  const readiness = sourceCapabilityReadiness(capability, now());
  if (readiness.status !== "SOURCE_ENABLED") {
    throw new SecureSourceError(
      readiness.status === "SOURCE_DISABLED" ? readiness.reason : "NOT_APPROVED",
    );
  }
  const digest = sourceCapabilityDigest(capability);
  const budget = new SourceRunBudget(capability, now());
  const runId = await input.sink.start({
    capability,
    capabilityDigest: digest,
    operation: "GET_JOB",
    startedAt: now().toISOString(),
    ownerApprovalReceiptId: input.ownerReceiptChain.approvalReceiptId,
    ownerStartReceiptId: input.ownerReceiptChain.startReceiptId,
  });
  let record: LeverPostingRecordV2 | null = null;
  let pageDigest: string | null = null;
  let byteCount = 0;
  try {
    if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
    await input.sink.assertCapabilityCurrent({
      runId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      capabilityDigest: digest,
      ...(capability.requestBinding
        ? { requestBindingDigest: sourceRequestBindingDigest(capability.requestBinding) }
        : {}),
    });
    const detail = await readLeverDetailV2WithMetadata({
      capability,
      budget,
      externalId,
      now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
    record = detail.record;
    byteCount = detail.byteCount;
    if (record.externalId !== externalId) {
      throw new SecureSourceError("SOURCE_DETAIL_ID_MISMATCH", null, "RESPONSE_BODY");
    }
    pageDigest = detailPageDigest(externalId, record);
    budget.consumePage(`GET_JOB:${externalId}`, 1, byteCount);
    await input.sink.persistDetail({
      runId,
      capability,
      externalId,
      record,
      pageDigest,
      budget,
      observedAt: now().toISOString(),
    });
    budget.assertCurrent(now());
    await input.sink.complete({ runId, budget, completedAt: now().toISOString() });
    return {
      operation: "GET_JOB",
      runId,
      status: "COMPLETE",
      records: [record],
      record,
      externalId,
      pageDigest,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: 1,
      acceptedRecordCount: 1,
      unusableRecordCount: 0,
      stopCode: null,
      safeUnusableDiagnostics: [],
      providerDriftDiagnostics: [],
      terminalState: "COMPLETE",
    };
  } catch (error) {
    const code = safeStopCode(error);
    await input.sink.stop({
      runId,
      budget,
      code,
      retryAfter: error instanceof SecureSourceError ? error.retryAfter : null,
      transportStage:
        error instanceof SecureSourceError
          ? error.lifecycleStage
          : error instanceof SourcePersistenceError
            ? "PERSISTENCE"
            : null,
      schemaDiagnostic: error instanceof SecureSourceError ? error.schemaDiagnostic : null,
      ...(error instanceof SourcePersistenceError
        ? { persistenceDiagnostic: error.persistenceDiagnostic }
        : {}),
      stoppedAt: now().toISOString(),
    });
    const terminalState: LeverDetailTerminalState =
      code === "DETAIL_NOT_FOUND"
        ? "NOT_FOUND"
        : code === "SOURCE_RECORD_UNUSABLE"
          ? "SOURCE_RECORD_UNUSABLE"
          : code === "PERSISTENCE_FAILED"
            ? "PERSISTENCE_FAILED"
            : "STOPPED";
    return {
      operation: "GET_JOB",
      runId,
      status: "STOPPED",
      records: [],
      record: null,
      externalId,
      pageDigest,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: 0,
      acceptedRecordCount: 0,
      unusableRecordCount: terminalState === "SOURCE_RECORD_UNUSABLE" ? 1 : 0,
      stopCode: code,
      safeUnusableDiagnostics: [],
      providerDriftDiagnostics: [],
      terminalState,
    };
  }
}
