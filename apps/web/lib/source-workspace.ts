import "server-only";

import { dirname } from "node:path";

import {
  SourceSchemaDiagnosticSchema,
  SourcePersistenceDiagnosticSchema,
  SourceTransportLifecycleStageSchema,
  loadPrivateSourceAllowlistV2,
  latestSourceCapabilityHeads,
  resolveCurrentSourceCapabilityHead,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  type SourceCapabilityV2,
  type SourceCapabilityViewBinding,
  type SourceSchemaDiagnostic,
  type SourcePersistenceDiagnostic,
} from "@applypilot/job-sources";
import {
  runGreenhouseSourceToQueue,
  runLeverSourceToQueue,
  type SourceOwnerActionGateProof,
} from "@applypilot/database";

import { reevaluateBetaJob, setBetaQueueState } from "./beta-workspace";
import { getLocalDatabase, getSourceEnablementRepository } from "./local-database";
import { resolveLocalDataDirectory } from "./local-data-directory";

const repositoryRoot = () => dirname(resolveLocalDataDirectory());
const allowlistFilename = () =>
  process.env.APPLYPILOT_SOURCE_ALLOWLIST_FILENAME ?? "source-allowlist.json";

export interface SourceEnablementView {
  status:
    | "WAITING_FOR_APPROVED_TENANT"
    | "SOURCE_ALLOWLIST_V2_READY"
    | "CONFIGURATION_REJECTED"
    | "DATABASE_MIGRATION_REQUIRED";
  capabilities: Array<{
    capabilityId: string;
    version: number;
    configurationDigest: string;
    source: string;
    alias: string;
    tenant: string;
    host: string;
    pathPrefix: string;
    operations: string[];
    readiness: string;
    ownerApprovalState: string;
    ownerApprovalReceiptId: string | null;
    canOwnerStart: boolean;
    policyExpiresAt: string;
    capabilityExpiresAt: string;
    requestBudget: number;
    recordCap: number;
    pageSizeCap: number;
    responseByteLimit: number;
  }>;
  recentRuns: Array<{
    id: string;
    status: string;
    source: string;
    alias: string;
    requestCount: number;
    pageCount: number;
    recordCount: number;
    providerRecordCount: number;
    acceptedRecordCount: number;
    unusableRecordCount: number;
    providerDriftWarningCount: number;
    persistedObservationCount: number;
    safeErrorCode: string | null;
    transportStage: string | null;
    schemaDiagnostic: SourceSchemaDiagnostic | null;
    persistenceDiagnostic: SourcePersistenceDiagnostic | null;
    retryAfter: string | null;
    startedAt: string;
    completedAt: string | null;
    ownerProvenance:
      | "OWNER_RECEIPTS_BOUND"
      | "LEGACY_OWNER_PROVENANCE_UNVERIFIED"
      | "OWNER_RECEIPT_BINDING_INVALID";
  }>;
}

export async function getSourceEnablementView(): Promise<SourceEnablementView> {
  const local = getLocalDatabase();
  const repository = getSourceEnablementRepository();
  if (!local || !repository) {
    return { status: "DATABASE_MIGRATION_REQUIRED", capabilities: [], recentRuns: [] };
  }
  const ownerReceiptSchemaAvailable = repository.ownerActionReceiptSchemaAvailable();
  let allowlist: Awaited<ReturnType<typeof loadPrivateSourceAllowlistV2>>;
  try {
    allowlist = await loadPrivateSourceAllowlistV2(repositoryRoot(), allowlistFilename());
  } catch {
    return { status: "CONFIGURATION_REJECTED", capabilities: [], recentRuns: [] };
  }
  const capabilities = ownerReceiptSchemaAvailable
    ? latestSourceCapabilityHeads(allowlist.capabilities).map((capability) => {
        const ownerApproval = repository.getOwnerApprovalStatus(capability);
        return {
          capabilityId: capability.capabilityId,
          version: capability.version,
          configurationDigest: sourceCapabilityDigest(capability),
          source: capability.source,
          alias: capability.alias,
          tenant: capability.tenant,
          host: capability.allowedHost,
          pathPrefix: capability.allowedPathPrefix,
          operations: [...capability.allowedOperations],
          readiness: sourceCapabilityReadiness(capability).status,
          ownerApprovalState: ownerApproval.state,
          ownerApprovalReceiptId: ownerApproval.receiptId,
          canOwnerStart: ownerApproval.canStart,
          policyExpiresAt: capability.policyExpiresAt,
          capabilityExpiresAt: capability.capabilityExpiresAt,
          requestBudget: capability.requestBudget,
          recordCap: capability.recordCap,
          pageSizeCap: capability.pageSizeCap,
          responseByteLimit: capability.responseByteLimit,
        };
      })
    : [];
  const recentRows = local.sqlite
    .prepare(
      `SELECT r.id,r.status,c.source,c.alias,r.request_count AS requestCount,
     r.page_count AS pageCount,r.record_count AS recordCount,r.safe_error_code AS safeErrorCode,
     (SELECT count(*) FROM audit_events a WHERE a.event_type='source.record.unusable'
       AND a.entity_type='source_run' AND a.entity_id=r.id) AS unusableRecordCount,
     (SELECT count(*) FROM audit_events a WHERE a.event_type='source.provider.drift'
       AND a.entity_type='source_run' AND a.entity_id=r.id) AS providerDriftWarningCount,
     (SELECT coalesce(sum(p.record_count),0) FROM source_run_pages p
       WHERE p.run_id=r.id) AS persistedPageProviderRecordCount,
     (SELECT count(*) FROM source_observations o WHERE o.run_id=r.id) AS persistedObservationCount,
     (SELECT json_extract(a.redacted_metadata_json, '$.transportStage')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS transportStage,
     (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.field')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaField,
     (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.expectedStructuralType')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaExpectedType,
     (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.issueCategory')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaIssueCategory,
     (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.recordIndex')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaRecordIndex,
     (SELECT json_extract(a.redacted_metadata_json, '$.persistenceDiagnostic')
      FROM audit_events a WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
        AND a.entity_id=r.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS persistenceDiagnosticJson,
     r.retry_after AS retryAfter,r.owner_started_at AS startedAt,r.completed_at AS completedAt
     FROM source_run_checkpoints r JOIN source_capability_versions c ON c.id=r.capability_version_id
     ORDER BY r.owner_started_at DESC LIMIT 20`,
    )
    .all() as Array<
    Omit<
      SourceEnablementView["recentRuns"][number],
      | "transportStage"
      | "schemaDiagnostic"
      | "persistenceDiagnostic"
      | "providerRecordCount"
      | "acceptedRecordCount"
    > & {
      transportStage: unknown;
      persistedPageProviderRecordCount: number;
      schemaField: unknown;
      schemaExpectedType: unknown;
      schemaIssueCategory: unknown;
      schemaRecordIndex: unknown;
      persistenceDiagnosticJson: unknown;
    }
  >;
  const recentRuns = recentRows.map((run) => {
    const stage = SourceTransportLifecycleStageSchema.safeParse(run.transportStage);
    const diagnostic = SourceSchemaDiagnosticSchema.safeParse({
      field: run.schemaField,
      expectedStructuralType: run.schemaExpectedType,
      issueCategory: run.schemaIssueCategory,
      ...(run.schemaRecordIndex === null ? {} : { recordIndex: run.schemaRecordIndex }),
    });
    let persistenceDiagnostic: SourcePersistenceDiagnostic | null = null;
    if (run.persistenceDiagnosticJson !== null && run.persistenceDiagnosticJson !== undefined) {
      try {
        const parsed = SourcePersistenceDiagnosticSchema.safeParse(
          typeof run.persistenceDiagnosticJson === "string"
            ? JSON.parse(run.persistenceDiagnosticJson)
            : run.persistenceDiagnosticJson,
        );
        if (parsed.success) persistenceDiagnostic = parsed.data;
      } catch {
        persistenceDiagnostic = null;
      }
    }
    return {
      id: run.id,
      status: run.status,
      source: run.source,
      alias: run.alias,
      requestCount: run.requestCount,
      pageCount: run.pageCount,
      recordCount: run.recordCount,
      providerRecordCount: run.recordCount,
      acceptedRecordCount: Math.max(
        0,
        run.persistedPageProviderRecordCount - run.unusableRecordCount,
      ),
      unusableRecordCount: run.unusableRecordCount,
      providerDriftWarningCount: run.providerDriftWarningCount,
      persistedObservationCount: run.persistedObservationCount,
      safeErrorCode: run.safeErrorCode,
      transportStage: stage.success ? stage.data : null,
      schemaDiagnostic: diagnostic.success ? diagnostic.data : null,
      persistenceDiagnostic,
      retryAfter: run.retryAfter,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      ownerProvenance: repository.getRunOwnerProvenance(run.id),
    };
  });
  return {
    status: ownerReceiptSchemaAvailable ? allowlist.status : "DATABASE_MIGRATION_REQUIRED",
    capabilities,
    recentRuns,
  };
}

async function exactPrivateCapability(
  binding: SourceCapabilityViewBinding,
): Promise<SourceCapabilityV2> {
  const allowlist = await loadPrivateSourceAllowlistV2(repositoryRoot(), allowlistFilename());
  if (allowlist.status !== "SOURCE_ALLOWLIST_V2_READY") throw new Error("APPROVED_TENANT_REQUIRED");
  return resolveCurrentSourceCapabilityHead(allowlist.capabilities, binding);
}

export async function approveOwnerSourceCapability(
  binding: SourceCapabilityViewBinding,
  gateProof: SourceOwnerActionGateProof,
): Promise<void> {
  const capability = await exactPrivateCapability(binding);
  if (capability.source !== "LEVER" && capability.source !== "GREENHOUSE") {
    throw new Error("SUPPORTED_SOURCE_CAPABILITY_REQUIRED");
  }
  if (sourceCapabilityReadiness(capability).status !== "SOURCE_ENABLED")
    throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
  const repository = getSourceEnablementRepository();
  if (!repository || !repository.ownerActionReceiptSchemaAvailable()) {
    throw new Error("DATABASE_MIGRATION_REQUIRED");
  }
  repository.persistCapabilityVersion(capability);
  repository.recordOwnerApprovalReceipt({
    capability,
    gateProof,
    ownerConfirmed: true,
  });
}

export async function runOwnerApprovedSource(
  binding: SourceCapabilityViewBinding,
  gateProof: SourceOwnerActionGateProof,
) {
  const capability = await exactPrivateCapability(binding);
  if (capability.source !== "LEVER" && capability.source !== "GREENHOUSE") {
    throw new Error("SUPPORTED_SOURCE_CAPABILITY_REQUIRED");
  }
  if (sourceCapabilityReadiness(capability).status !== "SOURCE_ENABLED")
    throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
  const repository = getSourceEnablementRepository();
  if (!repository || !repository.ownerActionReceiptSchemaAvailable()) {
    throw new Error("DATABASE_MIGRATION_REQUIRED");
  }
  repository.persistCapabilityVersion(capability);
  const ownerReceiptChain = repository.createOwnerStartReceipt({
    capability,
    operation: "LIST_JOBS",
    gateProof,
    ownerConfirmed: true,
  });
  const runInput = {
    capability,
    repository,
    ownerReceiptChain,
    evaluateJob: reevaluateBetaJob,
    queueJob: (jobId: string) => setBetaQueueState(jobId, "REVIEWING", "SOURCE_R2_READY"),
  };
  return capability.source === "GREENHOUSE"
    ? runGreenhouseSourceToQueue(runInput)
    : runLeverSourceToQueue(runInput);
}

export async function revokeSourceCapability(binding: SourceCapabilityViewBinding): Promise<void> {
  const capability = await exactPrivateCapability(binding);
  const repository = getSourceEnablementRepository();
  if (!repository) throw new Error("DATABASE_MIGRATION_REQUIRED");
  repository.persistCapabilityVersion(capability);
  const timestamp = new Date().toISOString();
  repository.persistCapabilityVersion({
    ...capability,
    version: capability.version + 1,
    predecessorVersion: capability.version,
    approvalState: "REVOKED",
    approvalReference: null,
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: timestamp,
    revocationReason: "OWNER_REVOKED",
  });
}

export function cancelSourceRun(runId: string): void {
  const repository = getSourceEnablementRepository();
  if (!repository) throw new Error("DATABASE_MIGRATION_REQUIRED");
  repository.cancel(runId);
}
