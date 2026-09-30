import { z } from "zod";

import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  type SourceCapabilityV2,
  type SourceOperation,
  type SourceSchemaDiagnostic,
  type SourceTransportLifecycleStage,
} from "../source-capability";
import {
  SecureSourceError,
  type SecureSourceTransportDependencies,
} from "../secure-source-transport";
import {
  readGreenhouseDetailV2,
  readGreenhousePageV2,
  type GreenhouseDetailV2,
  type GreenhousePageV2,
  type GreenhousePostingRecordV2,
} from "./v2-reader";

export interface GreenhouseSourceRunSink {
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
  }): Promise<void> | void;
  persistGreenhousePage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: GreenhousePageV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): Promise<void> | void;
  persistGreenhouseDetail?(input: {
    runId: string;
    capability: SourceCapabilityV2;
    externalId: string;
    detail: GreenhouseDetailV2;
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
    stoppedAt: string;
  }): Promise<void> | void;
}

export interface GreenhouseSourceOwnerReceiptChain {
  approvalReceiptId: string;
  startReceiptId: string;
}

export interface GreenhouseSourceRunResult {
  readonly runId: string;
  readonly operation: "LIST_JOBS";
  readonly status: "COMPLETE" | "STOPPED";
  readonly records: readonly GreenhousePostingRecordV2[];
  readonly requestCount: number;
  readonly pageCount: number;
  readonly recordCount: number;
  readonly providerRecordCount: number;
  readonly acceptedRecordCount: number;
  readonly unusableRecordCount: number;
  readonly stopCode: string | null;
  readonly safeUnusableDiagnostics: GreenhousePageV2["safeUnusableDiagnostics"];
}

export type GreenhouseDetailTerminalState =
  | "COMPLETE"
  | "NOT_FOUND"
  | "STOPPED"
  | "SOURCE_RECORD_UNUSABLE"
  | "PERSISTENCE_FAILED";

export interface GreenhouseDetailSourceRunResult {
  readonly runId: string;
  readonly operation: "GET_JOB";
  readonly status: "COMPLETE" | "STOPPED";
  readonly terminalState: GreenhouseDetailTerminalState;
  readonly externalId: string;
  readonly record: GreenhousePostingRecordV2 | null;
  readonly pageDigest: string | null;
  readonly requestCount: number;
  readonly pageCount: number;
  readonly recordCount: number;
  readonly providerRecordCount: number;
  readonly acceptedRecordCount: number;
  readonly unusableRecordCount: number;
  readonly stopCode: string | null;
}

function safeStopCode(error: unknown): string {
  if (error instanceof SecureSourceError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return "PERSISTENCE_FAILED";
}

function assertEnabledGreenhouse(input: unknown, operation: SourceOperation, now: Date) {
  const capability = SourceCapabilityV2Schema.parse(input);
  if (capability.source !== "GREENHOUSE") throw new SecureSourceError("SOURCE_MISMATCH");
  if (!capability.allowedOperations.includes(operation)) {
    throw new SecureSourceError("OPERATION_NOT_APPROVED");
  }
  const readiness = sourceCapabilityReadiness(capability, now);
  if (readiness.status !== "SOURCE_ENABLED") {
    throw new SecureSourceError(
      readiness.status === "SOURCE_DISABLED" ? readiness.reason : "NOT_APPROVED",
    );
  }
  return capability;
}

export async function runGreenhouseSourceDiscovery(input: {
  capability: SourceCapabilityV2;
  sink: GreenhouseSourceRunSink;
  ownerReceiptChain: GreenhouseSourceOwnerReceiptChain;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<GreenhouseSourceRunResult> {
  const now = input.now ?? (() => new Date());
  const capability = assertEnabledGreenhouse(input.capability, "LIST_JOBS", now());
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
  let page: GreenhousePageV2 | null = null;
  try {
    if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
    await input.sink.assertCapabilityCurrent({
      runId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      capabilityDigest: digest,
    });
    page = await readGreenhousePageV2({
      capability,
      budget,
      now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
    await input.sink.persistGreenhousePage({
      runId,
      capability,
      page,
      budget,
      observedAt: now().toISOString(),
    });
    budget.assertCurrent(now());
    await input.sink.complete({ runId, budget, completedAt: now().toISOString() });
    return {
      runId,
      operation: "LIST_JOBS",
      status: "COMPLETE",
      records: page.acceptedRecords,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: page.providerRecordCount,
      acceptedRecordCount: page.acceptedRecords.length,
      unusableRecordCount: page.unusableRecordCount,
      stopCode: null,
      safeUnusableDiagnostics: page.safeUnusableDiagnostics,
    };
  } catch (error) {
    const code = safeStopCode(error);
    await input.sink.stop({
      runId,
      budget,
      code,
      retryAfter: error instanceof SecureSourceError ? error.retryAfter : null,
      transportStage: error instanceof SecureSourceError ? error.lifecycleStage : null,
      schemaDiagnostic: error instanceof SecureSourceError ? error.schemaDiagnostic : null,
      stoppedAt: now().toISOString(),
    });
    return {
      runId,
      operation: "LIST_JOBS",
      status: "STOPPED",
      records: page?.acceptedRecords ?? [],
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: page?.providerRecordCount ?? 0,
      acceptedRecordCount: page?.acceptedRecords.length ?? 0,
      unusableRecordCount: page?.unusableRecordCount ?? 0,
      stopCode: code,
      safeUnusableDiagnostics: page?.safeUnusableDiagnostics ?? [],
    };
  }
}

export async function runGreenhouseDetailSourceDiscovery(input: {
  capability: SourceCapabilityV2;
  sink: GreenhouseSourceRunSink & {
    persistGreenhouseDetail: NonNullable<GreenhouseSourceRunSink["persistGreenhouseDetail"]>;
  };
  ownerReceiptChain: GreenhouseSourceOwnerReceiptChain;
  externalId: string;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<GreenhouseDetailSourceRunResult> {
  const externalId = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .safeParse(input.externalId);
  if (!externalId.success) throw new SecureSourceError("SOURCE_DETAIL_ID_INVALID");
  const now = input.now ?? (() => new Date());
  const capability = assertEnabledGreenhouse(input.capability, "GET_JOB", now());
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
  let detail: GreenhouseDetailV2 | null = null;
  try {
    if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
    await input.sink.assertCapabilityCurrent({
      runId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      capabilityDigest: digest,
    });
    detail = await readGreenhouseDetailV2({
      capability,
      budget,
      externalId: externalId.data,
      now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
    await input.sink.persistGreenhouseDetail({
      runId,
      capability,
      externalId: externalId.data,
      detail,
      budget,
      observedAt: now().toISOString(),
    });
    budget.assertCurrent(now());
    await input.sink.complete({ runId, budget, completedAt: now().toISOString() });
    return {
      runId,
      operation: "GET_JOB",
      status: "COMPLETE",
      terminalState: "COMPLETE",
      externalId: externalId.data,
      record: detail.record,
      pageDigest: detail.pageDigest,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: 1,
      acceptedRecordCount: 1,
      unusableRecordCount: 0,
      stopCode: null,
    };
  } catch (error) {
    const code = safeStopCode(error);
    await input.sink.stop({
      runId,
      budget,
      code,
      retryAfter: error instanceof SecureSourceError ? error.retryAfter : null,
      transportStage: error instanceof SecureSourceError ? error.lifecycleStage : null,
      schemaDiagnostic: error instanceof SecureSourceError ? error.schemaDiagnostic : null,
      stoppedAt: now().toISOString(),
    });
    const terminalState: GreenhouseDetailTerminalState =
      code === "HTTP_404"
        ? "NOT_FOUND"
        : code === "SOURCE_RECORD_UNUSABLE"
          ? "SOURCE_RECORD_UNUSABLE"
          : code === "PERSISTENCE_FAILED"
            ? "PERSISTENCE_FAILED"
            : "STOPPED";
    return {
      runId,
      operation: "GET_JOB",
      status: "STOPPED",
      terminalState,
      externalId: externalId.data,
      record: null,
      pageDigest: detail?.pageDigest ?? null,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      providerRecordCount: detail ? 1 : 0,
      acceptedRecordCount: 0,
      unusableRecordCount: terminalState === "SOURCE_RECORD_UNUSABLE" ? 1 : 0,
      stopCode: code,
    };
  }
}
