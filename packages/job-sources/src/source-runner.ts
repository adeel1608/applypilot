import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  type SourceCapabilityV2,
  type SourceProviderDriftDiagnostic,
  type SourceSchemaDiagnostic,
  type SourceTransportLifecycleStage,
} from "./source-capability";
import {
  SecureSourceError,
  type SecureSourceTransportDependencies,
} from "./secure-source-transport";
import { readLeverPageV2, type LeverPageV2, type LeverPostingRecordV2 } from "./lever/v2-reader";

export interface SourceRunSink {
  start(input: {
    capability: SourceCapabilityV2;
    capabilityDigest: string;
    operation: "LIST_JOBS";
    startedAt: string;
  }): Promise<string> | string;
  assertCapabilityCurrent(input: {
    runId: string;
    capabilityId: string;
    capabilityVersion: number;
    capabilityDigest: string;
  }): Promise<void> | void;
  persistPage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: LeverPageV2;
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

export interface LeverSourceRunResult {
  runId: string;
  status: "COMPLETE" | "STOPPED";
  records: LeverPostingRecordV2[];
  requestCount: number;
  pageCount: number;
  recordCount: number;
  stopCode: string | null;
  providerDriftDiagnostics: readonly SourceProviderDriftDiagnostic[];
}

function safeStopCode(error: unknown): string {
  if (error instanceof SecureSourceError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message)) return error.message;
  return "PERSISTENCE_FAILED";
}

export async function runLeverSourceDiscovery(input: {
  capability: SourceCapabilityV2;
  sink: SourceRunSink;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
  startCursor?: number;
}): Promise<LeverSourceRunResult> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  if (capability.source !== "LEVER") throw new SecureSourceError("SOURCE_MISMATCH");
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
  });
  const records: LeverPostingRecordV2[] = [];
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
      } catch {
        throw new SecureSourceError("PERSISTENCE_FAILED", null, "PERSISTENCE");
      }
      records.push(...page.records);
      providerDriftDiagnostics.push(...page.providerDriftDiagnostics);
      if (page.nextCursor === null) break;
      if (page.nextCursor <= cursor) throw new SecureSourceError("CURSOR_REVERSED");
      cursor = page.nextCursor;
    }
    budget.assertCurrent(now());
    try {
      await input.sink.complete({ runId, budget, completedAt: now().toISOString() });
    } catch {
      throw new SecureSourceError("PERSISTENCE_FAILED", null, "PERSISTENCE");
    }
    return {
      runId,
      status: "COMPLETE",
      records,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      stopCode: null,
      providerDriftDiagnostics,
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
      status: "STOPPED",
      records,
      requestCount: budget.attempts,
      pageCount: budget.pages,
      recordCount: budget.records,
      stopCode: code,
      providerDriftDiagnostics,
    };
  }
}
