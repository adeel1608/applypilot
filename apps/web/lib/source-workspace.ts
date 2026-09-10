import "server-only";

import { dirname } from "node:path";

import {
  SourceCapabilityV2Schema,
  loadPrivateSourceAllowlistV2,
  sourceCapabilityReadiness,
  type SourceCapabilityV2,
} from "@applypilot/job-sources";
import { runLeverSourceToQueue } from "@applypilot/database";

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
    source: string;
    alias: string;
    tenant: string;
    host: string;
    pathPrefix: string;
    operations: string[];
    readiness: string;
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
    safeErrorCode: string | null;
    retryAfter: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
}

export async function getSourceEnablementView(): Promise<SourceEnablementView> {
  const local = getLocalDatabase();
  if (!local || !getSourceEnablementRepository()) {
    return { status: "DATABASE_MIGRATION_REQUIRED", capabilities: [], recentRuns: [] };
  }
  let allowlist: Awaited<ReturnType<typeof loadPrivateSourceAllowlistV2>>;
  try {
    allowlist = await loadPrivateSourceAllowlistV2(repositoryRoot(), allowlistFilename());
  } catch {
    return { status: "CONFIGURATION_REJECTED", capabilities: [], recentRuns: [] };
  }
  const capabilities = allowlist.capabilities.map((capability) => ({
    capabilityId: capability.capabilityId,
    version: capability.version,
    source: capability.source,
    alias: capability.alias,
    tenant: capability.tenant,
    host: capability.allowedHost,
    pathPrefix: capability.allowedPathPrefix,
    operations: [...capability.allowedOperations],
    readiness: sourceCapabilityReadiness(capability).status,
    policyExpiresAt: capability.policyExpiresAt,
    capabilityExpiresAt: capability.capabilityExpiresAt,
    requestBudget: capability.requestBudget,
    recordCap: capability.recordCap,
    pageSizeCap: capability.pageSizeCap,
    responseByteLimit: capability.responseByteLimit,
  }));
  const recentRuns = local.sqlite
    .prepare(
      `SELECT r.id,r.status,c.source,c.alias,r.request_count AS requestCount,
     r.page_count AS pageCount,r.record_count AS recordCount,r.safe_error_code AS safeErrorCode,
     r.retry_after AS retryAfter,r.owner_started_at AS startedAt,r.completed_at AS completedAt
     FROM source_run_checkpoints r JOIN source_capability_versions c ON c.id=r.capability_version_id
     ORDER BY r.owner_started_at DESC LIMIT 20`,
    )
    .all() as SourceEnablementView["recentRuns"];
  return { status: allowlist.status, capabilities, recentRuns };
}

async function exactPrivateCapability(capabilityId: string): Promise<SourceCapabilityV2> {
  const value = SourceCapabilityV2Schema.shape.capabilityId.parse(capabilityId);
  const allowlist = await loadPrivateSourceAllowlistV2(repositoryRoot(), allowlistFilename());
  if (allowlist.status !== "SOURCE_ALLOWLIST_V2_READY") throw new Error("APPROVED_TENANT_REQUIRED");
  const matches = allowlist.capabilities.filter(({ capabilityId: id }) => id === value);
  if (matches.length !== 1) throw new Error("SOURCE_CAPABILITY_NOT_UNIQUE");
  return SourceCapabilityV2Schema.parse(matches[0]);
}

export async function runOwnerApprovedLeverSource(capabilityId: string) {
  const capability = await exactPrivateCapability(capabilityId);
  if (capability.source !== "LEVER") throw new Error("LEVER_CAPABILITY_REQUIRED");
  if (sourceCapabilityReadiness(capability).status !== "SOURCE_ENABLED")
    throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
  const repository = getSourceEnablementRepository();
  if (!repository) throw new Error("DATABASE_MIGRATION_REQUIRED");
  repository.persistCapabilityVersion(capability);
  return runLeverSourceToQueue({
    capability,
    repository,
    evaluateJob: reevaluateBetaJob,
    queueJob: (jobId) => setBetaQueueState(jobId, "REVIEWING", "SOURCE_R2_READY"),
  });
}

export async function revokeSourceCapability(capabilityId: string): Promise<void> {
  const capability = await exactPrivateCapability(capabilityId);
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
