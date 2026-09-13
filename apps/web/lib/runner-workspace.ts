import "server-only";

import { dirname } from "node:path";

import {
  RunnerTargetCapabilitySchema,
  loadPrivateRunnerTargetAllowlist,
  runnerTargetReadiness,
  type RunnerTargetCapability,
} from "@applypilot/application-runner";

import { getLocalDatabase, getRunnerEnablementRepository } from "./local-database";
import { resolveLocalDataDirectory } from "./local-data-directory";

const repositoryRoot = () => dirname(resolveLocalDataDirectory());
const allowlistFilename = () =>
  process.env.APPLYPILOT_RUNNER_ALLOWLIST_FILENAME ?? "runner-target-allowlist.json";

export async function getRunnerEnablementView() {
  const local = getLocalDatabase();
  const repository = getRunnerEnablementRepository();
  if (!local || !repository)
    return {
      status: "DATABASE_MIGRATION_REQUIRED" as const,
      capabilities: [],
      recoveries: [],
      inspections: [],
    };
  let allowlist: Awaited<ReturnType<typeof loadPrivateRunnerTargetAllowlist>>;
  try {
    allowlist = await loadPrivateRunnerTargetAllowlist(repositoryRoot(), allowlistFilename());
  } catch {
    return {
      status: "CONFIGURATION_REJECTED" as const,
      capabilities: [],
      recoveries: [],
      inspections: [],
    };
  }
  const capabilities = allowlist.capabilities.map((capability) => ({
    capabilityId: capability.capabilityId,
    version: capability.version,
    targetKind: capability.targetKind,
    alias: capability.alias,
    allowedOrigin: capability.allowedOrigin,
    allowedPathPrefix: capability.allowedPathPrefix,
    formVersion: capability.formVersion,
    adapterVersion: capability.adapterVersion,
    operations: [...capability.allowedOperations],
    readiness: runnerTargetReadiness(capability).status,
    policyExpiresAt: capability.policyExpiresAt,
    capabilityExpiresAt: capability.capabilityExpiresAt,
  }));
  const recoveries = local.sqlite
    .prepare(
      `SELECT e.id,e.decision,e.reason_code AS reasonCode,e.occurred_at AS occurredAt,
     r.state,r.stop_reason AS stopReason FROM runner_recovery_events e
     JOIN application_runs r ON r.id=e.run_id ORDER BY e.occurred_at DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    decision: string;
    reasonCode: string;
    occurredAt: string;
    state: string;
    stopReason: string | null;
  }>;
  const inspections = local.sqlite
    .prepare(
      `SELECT id,operation,state,safe_stop_reason AS stopReason,field_count AS fieldCount,
              unresolved_count AS unresolvedCount,form_version AS formVersion,
              adapter_version AS adapterVersion,updated_at AS updatedAt
       FROM runner_inspection_bindings ORDER BY updated_at DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    operation: string;
    state: string;
    stopReason: string | null;
    fieldCount: number;
    unresolvedCount: number;
    formVersion: string;
    adapterVersion: string;
    updatedAt: string;
  }>;
  return { status: allowlist.status, capabilities, recoveries, inspections };
}

async function exactCapability(capabilityId: string): Promise<RunnerTargetCapability> {
  const id = RunnerTargetCapabilitySchema.shape.capabilityId.parse(capabilityId);
  const allowlist = await loadPrivateRunnerTargetAllowlist(repositoryRoot(), allowlistFilename());
  if (allowlist.status !== "RUNNER_TARGET_ALLOWLIST_READY")
    throw new Error("APPROVED_TARGET_REQUIRED");
  const matches = allowlist.capabilities.filter(({ capabilityId: value }) => value === id);
  if (matches.length !== 1) throw new Error("RUNNER_TARGET_CAPABILITY_NOT_UNIQUE");
  return RunnerTargetCapabilitySchema.parse(matches[0]);
}

export async function persistApprovedRunnerTarget(capabilityId: string): Promise<void> {
  const capability = await exactCapability(capabilityId);
  if (runnerTargetReadiness(capability).status !== "TARGET_ENABLED")
    throw new Error("RUNNER_TARGET_NOT_ENABLED");
  const repository = getRunnerEnablementRepository();
  if (!repository) throw new Error("DATABASE_MIGRATION_REQUIRED");
  repository.persistTargetCapabilityVersion(capability);
  repository.assertTargetCapabilityCurrent(capability);
}

export async function revokeRunnerTarget(capabilityId: string): Promise<void> {
  const capability = await exactCapability(capabilityId);
  const repository = getRunnerEnablementRepository();
  if (!repository) throw new Error("DATABASE_MIGRATION_REQUIRED");
  repository.persistTargetCapabilityVersion(capability);
  const timestamp = new Date().toISOString();
  repository.persistTargetCapabilityVersion({
    ...capability,
    version: capability.version + 1,
    predecessorVersion: capability.version,
    approvalState: "REVOKED",
    approvalReference: null,
    approvedAt: null,
    revokedAt: timestamp,
  });
}
