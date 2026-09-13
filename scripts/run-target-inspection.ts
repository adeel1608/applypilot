import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  RunnerTargetCapabilitySchema,
  deterministicRunnerTargetCapabilityId,
  freezeInspectionBinding,
  loadPrivateRunnerTargetAllowlist,
  packetDigest,
  runLeverInspectionInFreshBrowser,
  runnerTargetCapabilityDigest,
  runnerTargetReadiness,
} from "@applypilot/application-runner";
import { RunnerEnablementRepository } from "@applypilot/database";

import { CURRENT_DATABASE_SCHEMA_VERSION } from "./lib/database-schema";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const ProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("DRAFT_OWNER_APPROVAL_REQUIRED"),
    packet: ApplicationPacketSchema,
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    proposedCapability: RunnerTargetCapabilitySchema,
    activeCapability: z.literal(false),
    authorizedNetworkActions: z.literal(0),
  })
  .passthrough();

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

async function main(): Promise<void> {
  const capabilityId = argument("--capability-id");
  const capabilityVersion = z.coerce
    .number()
    .int()
    .positive()
    .parse(argument("--capability-version"));
  const expectedCapabilityDigest = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(argument("--capability-digest"));
  const packetId = argument("--packet-id");
  const expectedPacketDigest = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(argument("--packet-digest"));
  const ownerConfirmation = argument("--owner-confirmation");
  const expectedConfirmation = `INSPECT ${capabilityId} VERSION ${capabilityVersion} DIGEST ${expectedCapabilityDigest} PACKET ${packetId} DIGEST ${expectedPacketDigest}`;
  if (ownerConfirmation !== expectedConfirmation) {
    throw new Error("EXACT_OWNER_INSPECTION_CONFIRMATION_REQUIRED");
  }

  const root = repositoryRoot();
  const proposal = ProposalSchema.parse(
    JSON.parse(
      readFileSync(
        join(root, "data", "private", "reports", "real-target-inspection-proposal.json"),
        "utf8",
      ),
    ),
  );
  if (
    proposal.packet.id !== packetId ||
    packetDigest(proposal.packet) !== expectedPacketDigest ||
    proposal.packetDigest !== expectedPacketDigest
  ) {
    throw new Error("INSPECTION_PACKET_APPROVAL_MISMATCH");
  }
  const allowlist = await loadPrivateRunnerTargetAllowlist(root);
  if (allowlist.status !== "RUNNER_TARGET_ALLOWLIST_READY") {
    throw new Error("RUNNER_TARGET_ALLOWLIST_NOT_READY");
  }
  const matches = allowlist.capabilities.filter(
    (item) => item.capabilityId === capabilityId && item.version === capabilityVersion,
  );
  if (matches.length !== 1) throw new Error("RUNNER_TARGET_CAPABILITY_NOT_UNIQUE");
  const capability = RunnerTargetCapabilitySchema.parse(matches[0]);
  if (
    runnerTargetCapabilityDigest(capability) !== expectedCapabilityDigest ||
    runnerTargetReadiness(capability).status !== "TARGET_ENABLED" ||
    capability.targetKind !== "REAL_TARGET" ||
    capability.allowedOperations.length !== 1 ||
    capability.allowedOperations[0] !== "OPEN_AND_INSPECT_ONLY"
  ) {
    throw new Error("INSPECTION_CAPABILITY_APPROVAL_MISMATCH");
  }
  const proposed = proposal.proposedCapability;
  const immutableFields = [
    "capabilityId",
    "version",
    "predecessorVersion",
    "targetKind",
    "allowedOrigin",
    "allowedPathPrefix",
    "formVersion",
    "adapterVersion",
    "policyVersion",
    "policyExpiresAt",
    "capabilityExpiresAt",
  ] as const;
  if (
    immutableFields.some((field) => capability[field] !== proposed[field]) ||
    JSON.stringify(capability.allowedOperations) !== JSON.stringify(proposed.allowedOperations) ||
    capability.capabilityId !==
      deterministicRunnerTargetCapabilityId({
        targetKind: capability.targetKind,
        allowedOrigin: capability.allowedOrigin,
        allowedPathPrefix: capability.allowedPathPrefix,
        operation: "OPEN_AND_INSPECT_ONLY",
        formVersion: capability.formVersion,
        adapterVersion: capability.adapterVersion,
        packetDigest: expectedPacketDigest,
      })
  ) {
    throw new Error("INSPECTION_PROPOSAL_SCOPE_CHANGED");
  }

  const database = new BetterSqlite3(localDatabasePath(), { fileMustExist: true });
  try {
    const schemaVersion = Number(database.pragma("user_version", { simple: true }));
    const integrity = database.pragma("integrity_check", { simple: true });
    const foreignKeyIssues = (database.pragma("foreign_key_check") as unknown[]).length;
    if (
      schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION ||
      integrity !== "ok" ||
      foreignKeyIssues !== 0
    ) {
      throw new Error("PRIVATE_DATABASE_NOT_READY");
    }
    const repository = new RunnerEnablementRepository(database);
    repository.assertTargetCapabilityCurrent(capability);
    const binding = freezeInspectionBinding(proposal.packet, capability);
    const runId = `inspection_${randomUUID()}`;
    repository.bindInspection({ runId, binding, targetCapability: capability });
    const result = await runLeverInspectionInFreshBrowser({
      capability,
      binding,
      currentBinding: () => repository.currentInspectionBinding(runId),
      audit: (record) => repository.recordInspectionAudit(runId, record),
    });
    const reportPath = join(root, "data", "private", "reports", `${runId}.json`);
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          runId,
          capabilityId,
          capabilityVersion,
          capabilityDigest: expectedCapabilityDigest,
          packetId,
          packetDigest: expectedPacketDigest,
          operation: "OPEN_AND_INSPECT_ONLY",
          result,
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    const fieldCount = result.state === "COMPLETED" ? result.observation.fields.length : 0;
    console.log(
      `TARGET_INSPECTION_COMPLETE run_id=${runId} state=${result.state} stop_reason=${result.state === "STOPPED" ? result.stopReason : "none"} field_count=${fieldCount} browser_writes=0 form_changes=0 uploads=0 submissions=0 candidate_fields_outbound=0`,
    );
  } finally {
    database.close();
  }
}

void main();
