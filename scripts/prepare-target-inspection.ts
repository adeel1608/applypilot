import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  LEVER_APPLICATION_INSPECTION_FORM_VERSION,
  LEVER_REAL_INSPECTION_ADAPTER_VERSION,
  RunnerTargetCapabilitySchema,
  deriveDuplicatePacketState,
  deriveJobExpiryState,
  deterministicRunnerTargetCapabilityId,
  freezeInspectionBinding,
  packetDigest,
  runnerTargetCapabilityDigest,
} from "@applypilot/application-runner";
import { BetaRepository } from "@applypilot/database";
import { JobSchema } from "@applypilot/job-model";

import { CURRENT_DATABASE_SCHEMA_VERSION } from "./lib/database-schema";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const ReadinessReportSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    createdFromRunId: z.string().uuid(),
    employer: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    sourceExternalId: z.string().uuid(),
    sourceApplicationUrl: z.url(),
  })
  .passthrough();

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function main(): void {
  if (!process.argv.includes("--confirm-offline-private-preparation")) {
    throw new Error("OFFLINE_PRIVATE_PREPARATION_CONFIRMATION_REQUIRED");
  }
  const reportFilename = argument("--readiness-report");
  if (!/^[A-Za-z0-9._-]+\.json$/.test(reportFilename)) {
    throw new Error("READINESS_REPORT_FILENAME_INVALID");
  }
  const root = repositoryRoot();
  const expectedTarget = z
    .object({
      employer: z.string().min(1).max(200),
      title: z.string().min(1).max(500),
      externalId: z.string().uuid(),
      source: z.literal("LEVER"),
      tenant: z.string().regex(/^[a-z0-9-]{1,100}$/),
      sourceHost: z.string().min(1).max(253),
      sourcePath: z.string().startsWith("/").max(300),
    })
    .strict()
    .parse({
      employer: argument("--expected-employer"),
      title: argument("--expected-title"),
      externalId: argument("--expected-external-id"),
      source: argument("--expected-source"),
      tenant: argument("--expected-tenant"),
      sourceHost: argument("--expected-source-host"),
      sourcePath: argument("--expected-source-path"),
    });
  const reportPath = join(root, "data", "private", "reports", reportFilename);
  const report = ReadinessReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  if (
    report.employer !== expectedTarget.employer ||
    report.title !== expectedTarget.title ||
    report.sourceExternalId !== expectedTarget.externalId
  ) {
    throw new Error("PRIVATE_TARGET_APPROVAL_SCOPE_MISMATCH");
  }
  const databasePath = localDatabasePath();
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });
  try {
    const schemaVersion = Number(sqlite.pragma("user_version", { simple: true }));
    const integrity = sqlite.pragma("integrity_check", { simple: true });
    const foreignKeyIssues = (sqlite.pragma("foreign_key_check") as unknown[]).length;
    if (
      schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION ||
      integrity !== "ok" ||
      foreignKeyIssues !== 0
    ) {
      throw new Error("PRIVATE_DATABASE_NOT_READY");
    }
    const source = sqlite
      .prepare(
        `SELECT r.job_id AS jobId,j.normalized_json AS normalizedJson,
                o.run_id AS runId,o.expires_at AS expiresAt,
                c.source,c.tenant,c.allowed_host AS sourceHost,
                c.allowed_path_prefix AS sourcePath
         FROM job_source_records r
         JOIN jobs j ON j.id=r.job_id
         JOIN source_observations o ON o.source_record_id=r.id
         JOIN source_run_checkpoints cp ON cp.id=o.run_id
         JOIN source_capability_versions c ON c.id=cp.capability_version_id
         WHERE r.external_id=? ORDER BY o.observed_at DESC LIMIT 1`,
      )
      .get(report.sourceExternalId) as
      | {
          jobId: string;
          normalizedJson: string;
          runId: string;
          expiresAt: string | null;
          source: string;
          tenant: string;
          sourceHost: string;
          sourcePath: string;
        }
      | undefined;
    if (
      !source ||
      source.runId !== report.createdFromRunId ||
      source.source !== expectedTarget.source ||
      source.tenant !== expectedTarget.tenant ||
      source.sourceHost !== expectedTarget.sourceHost ||
      source.sourcePath !== expectedTarget.sourcePath
    ) {
      throw new Error("PRIVATE_TARGET_SOURCE_BINDING_MISMATCH");
    }
    const job = JobSchema.parse(JSON.parse(source.normalizedJson));
    if (job.externalId !== report.sourceExternalId || job.title !== report.title) {
      throw new Error("PRIVATE_TARGET_JOB_BINDING_MISMATCH");
    }
    const target = new URL(report.sourceApplicationUrl);
    if (
      target.protocol !== "https:" ||
      target.hostname !== "jobs.lever.co" ||
      target.username ||
      target.password ||
      target.hash ||
      target.pathname !== `/${expectedTarget.tenant}/${report.sourceExternalId}/apply`
    ) {
      throw new Error("PRIVATE_TARGET_DESTINATION_INVALID");
    }
    const jobVersionId = sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(source.jobId) as string | undefined;
    const profileVersionId = sqlite
      .prepare("SELECT active_version_id FROM candidate_profiles ORDER BY created_at LIMIT 1")
      .pluck()
      .get() as string | undefined;
    if (!jobVersionId || !profileVersionId) throw new Error("CURRENT_PRIVATE_VERSIONS_REQUIRED");
    const evaluation = sqlite
      .prepare(
        `SELECT id,eligibility_status AS eligibilityStatus FROM evaluation_versions
         WHERE job_id=? AND job_version_id=? AND profile_version_id=? AND stale=0
         ORDER BY evaluated_at DESC,rowid DESC LIMIT 1`,
      )
      .get(source.jobId, jobVersionId, profileVersionId) as
      | { id: string; eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED" }
      | undefined;
    if (!evaluation) throw new Error("CURRENT_PRIVATE_EVALUATION_REQUIRED");
    const duplicateStates = (
      sqlite
        .prepare(
          `SELECT DISTINCT c.state FROM duplicate_clusters c
           LEFT JOIN duplicate_cluster_members m ON m.cluster_id=c.id
           WHERE c.canonical_job_id=? OR m.source_observation_id IN (
             SELECT id FROM source_observations WHERE run_id=? AND job_id=?)`,
        )
        .all(source.jobId, report.createdFromRunId, source.jobId) as Array<{ state: string }>
    ).map(({ state }) => state);
    const packetId = `inspection_packet_${sha256(
      `${jobVersionId}|${profileVersionId}|${evaluation.id}|${target.href}`,
    ).slice(0, 24)}`;
    const packet = ApplicationPacketSchema.parse({
      id: packetId,
      jobId: source.jobId,
      jobVersionId,
      profileVersionId,
      evaluationVersionId: evaluation.id,
      eligibilityStatus: evaluation.eligibilityStatus,
      targetUrl: target.href,
      targetHost: target.hostname,
      jobExpiryState: deriveJobExpiryState(source.expiresAt),
      duplicateState: deriveDuplicatePacketState(duplicateStates),
      versionsCurrent: true,
      documents: [],
      answers: [],
    });
    const existing = sqlite
      .prepare(
        `SELECT id,job_version_id AS jobVersionId,profile_version_id AS profileVersionId,
                evaluation_version_id AS evaluationVersionId,target_url AS targetUrl
         FROM application_packets WHERE id=?`,
      )
      .get(packet.id) as
      | {
          id: string;
          jobVersionId: string;
          profileVersionId: string;
          evaluationVersionId: string;
          targetUrl: string;
        }
      | undefined;
    if (existing) {
      if (
        existing.jobVersionId !== packet.jobVersionId ||
        existing.profileVersionId !== packet.profileVersionId ||
        existing.evaluationVersionId !== packet.evaluationVersionId ||
        existing.targetUrl !== packet.targetUrl
      ) {
        throw new Error("EXISTING_INSPECTION_PACKET_MISMATCH");
      }
    } else {
      new BetaRepository(sqlite).persistApplicationPacket(packet);
    }
    const recordedAt = new Date();
    const packetHash = packetDigest(packet);
    const capabilityId = deterministicRunnerTargetCapabilityId({
      targetKind: "REAL_TARGET",
      allowedOrigin: target.origin,
      allowedPathPrefix: target.pathname,
      operation: "OPEN_AND_INSPECT_ONLY",
      formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
      adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
      packetDigest: packetHash,
    });
    const capability = RunnerTargetCapabilitySchema.parse({
      schemaVersion: 2,
      capabilityId,
      version: 1,
      predecessorVersion: null,
      targetKind: "REAL_TARGET",
      alias: `${report.employer} ${report.title} read-only inspection`,
      allowedOrigin: target.origin,
      allowedPathPrefix: target.pathname,
      formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
      adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
      allowedOperations: ["OPEN_AND_INSPECT_ONLY"],
      approvalState: "DRAFT",
      approvalReference: null,
      approvedAt: null,
      policyVersion: "real-target-inspection-v1",
      policyExpiresAt: new Date(recordedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      capabilityExpiresAt: new Date(recordedAt.getTime() + 30 * 60 * 1000).toISOString(),
      revokedAt: null,
    });
    const binding = freezeInspectionBinding(packet, capability);
    const outputPath = join(
      root,
      "data",
      "private",
      "reports",
      "real-target-inspection-proposal.json",
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    if (existsSync(outputPath)) throw new Error("INSPECTION_PROPOSAL_ALREADY_EXISTS");
    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          status: "DRAFT_OWNER_APPROVAL_REQUIRED",
          recordedAt: recordedAt.toISOString(),
          reviewedSourceRunId: report.createdFromRunId,
          employer: report.employer,
          role: report.title,
          externalId: report.sourceExternalId,
          packet,
          packetDigest: packetHash,
          proposedCapability: capability,
          proposedCapabilityDigest: runnerTargetCapabilityDigest(capability),
          frozenInspectionBinding: binding,
          activeCapability: false,
          authorizedNetworkActions: 0,
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    console.log(
      `TARGET_INSPECTION_PROPOSAL status=DRAFT packet_id=${packet.id} packet_digest=${packetHash} capability_id=${capability.capabilityId} capability_version=${capability.version} unresolved_count=${binding.unresolvedCount} active_capability=false network_actions=0`,
    );
  } finally {
    sqlite.close();
  }
}

main();
