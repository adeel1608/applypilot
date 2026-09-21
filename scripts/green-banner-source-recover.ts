import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import {
  GreenBannerGrantRepository,
  R2ARepository,
  R2Repository,
  SourceEnablementRepository,
  openApplyPilotDatabase,
} from "@applypilot/database";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import { SourceCapabilityV2Schema } from "@applypilot/job-sources";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

function rowToCapability(sqlite: import("better-sqlite3").Database, capabilityId: string) {
  const row = sqlite
    .prepare(
      `SELECT capability_id AS capabilityId,version,source,alias,tenant,region,
              allowed_host AS allowedHost,allowed_path_prefix AS allowedPathPrefix,
              allowed_operations_json AS allowedOperationsJson,approval_state AS approvalState,
              approval_reference AS approvalReference,approved_at AS approvedAt,
              policy_version AS policyVersion,policy_reviewed_at AS policyReviewedAt,
              policy_expires_at AS policyExpiresAt,capability_expires_at AS capabilityExpiresAt,
              request_budget AS requestBudget,record_cap AS recordCap,page_size_cap AS pageSizeCap,
              response_byte_limit AS responseByteLimit,request_timeout_ms AS requestTimeoutMs,
              run_timeout_ms AS runTimeoutMs,max_redirects AS maxRedirects,max_retries AS maxRetries,
              max_concurrency AS maxConcurrency,parser_version AS parserVersion,
              revoked_at AS revokedAt,revocation_reason AS revocationReason,created_at AS createdAt
       FROM source_capability_versions WHERE capability_id=? AND version=1`,
    )
    .get(capabilityId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("SOURCE_CAPABILITY_NOT_FOUND");
  const { allowedOperationsJson, ...rest } = row;
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    ...rest,
    predecessorVersion: null,
    allowedOperations: JSON.parse(String(allowedOperationsJson)),
    updatedAt: String(row.createdAt),
    revokedAt: null,
    revocationReason: null,
  });
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const database = openApplyPilotDatabase(localDatabasePath());
  const now = () => new Date();
  try {
    const sqlite = database.sqlite;
    const run = sqlite
      .prepare(
        `SELECT r.id,c.capability_id AS capabilityId FROM source_run_checkpoints r
         JOIN source_capability_versions c ON c.id=r.capability_version_id
         WHERE r.status='COMPLETE' AND c.capability_id='green_source_shieldai_227df70_r2'
         ORDER BY r.created_at DESC LIMIT 1`,
      )
      .get() as { id: string; capabilityId: string } | undefined;
    if (!run) throw new Error("SOURCE_RUN_NOT_FOUND");
    const sourceRepository = new SourceEnablementRepository(sqlite, now);
    const work = sourceRepository.pipelineWorkForCompletedRun(run.id);
    const profile = CandidateProfileSchema.parse(
      JSON.parse(readFileSync(`${root}/data/profile.private.json`, "utf8")),
    );
    const r2 = new R2Repository(sqlite, now);
    const evaluated: string[] = [];
    const queued: string[] = [];
    const failures: Array<{ jobId: string; stage: string; code: string }> = [];
    for (const item of work) {
      let evaluationId = item.evaluationId;
      try {
        if (!evaluationId) {
          const jobVersionId = sqlite
            .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
            .pluck()
            .get(item.jobId) as string | undefined;
          if (!jobVersionId) throw new Error("R2_CURRENT_JOB_VERSION_REQUIRED");
          const read = new R2ARepository(sqlite, now).getNormalizationResult(jobVersionId);
          if (read.state !== "AVAILABLE") throw new Error(`R2_CURRENT_NORMALIZATION_${read.state}`);
          const profileVersionId = sqlite
            .prepare("SELECT active_version_id FROM candidate_profiles ORDER BY created_at LIMIT 1")
            .pluck()
            .get() as string | undefined;
          if (!profileVersionId) throw new Error("R2_CURRENT_PROFILE_REQUIRED");
          const evaluationVersionId = randomUUID();
          const eligibility = evaluateR2Eligibility({
            profile,
            normalization: read.normalization,
            bindings: {
              jobVersionId,
              currentJobVersionId: jobVersionId,
              profileVersionId,
              currentProfileVersionId: profileVersionId,
              evidenceContractVersion: read.normalization.evidenceContractVersion,
              currentEvidenceContractVersion: read.normalization.evidenceContractVersion,
              evaluationVersionId,
            },
            evaluatedAt: now().toISOString(),
          });
          const fit = scoreR2JobFit({
            profile,
            normalization: read.normalization,
            eligibility,
            calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
          });
          const recorded = r2.recordEvaluation({
            id: evaluationVersionId,
            jobId: item.jobId,
            jobVersionId,
            profileVersionId,
            normalization: read.normalization,
            eligibility,
            fit,
          });
          evaluationId = recorded.id;
          evaluated.push(item.jobId);
        }
        if (!evaluationId) {
          failures.push({ jobId: item.jobId, stage: "EVALUATION", code: "NO_CURRENT_EVALUATION" });
          continue;
        }
        const row = sqlite
          .prepare(
            `SELECT eligibility_status AS eligibilityStatus,recommended FROM r2_evaluation_versions
             WHERE id=? AND job_id=?`,
          )
          .get(evaluationId, item.jobId) as
          | { eligibilityStatus: string; recommended: number }
          | undefined;
        if (!row) throw new Error("R2_CURRENT_EVALUATION_REQUIRED");
        const state =
          row.eligibilityStatus === "ELIGIBLE" && row.recommended ? "SHORTLISTED" : "REVIEWING";
        r2.recordQueueDecision({
          jobId: item.jobId,
          state,
          r2EvaluationId: evaluationId,
          duplicateResolutionVersion: r2.duplicateResolutionVersion(item.jobId),
          actor: "SYSTEM",
          reasonCode:
            state === "SHORTLISTED" ? "SOURCE_R2_RECOMMENDED" : "SOURCE_R2_REVIEW_REQUIRED",
        });
        queued.push(item.jobId);
      } catch (error) {
        failures.push({
          jobId: item.jobId,
          stage: evaluationId ? "QUEUE" : "EVALUATION",
          code: error instanceof Error ? error.message : "UNKNOWN",
        });
      }
    }
    const grants = new GreenBannerGrantRepository(sqlite, now);
    const revokedExists = sqlite
      .prepare("SELECT 1 FROM source_capability_versions WHERE capability_id=? AND version=2")
      .get(run.capabilityId);
    if (!revokedExists) {
      const cap = rowToCapability(sqlite, run.capabilityId);
      const revokedAt = now().toISOString();
      const revoked = SourceCapabilityV2Schema.parse({
        ...cap,
        version: 2,
        predecessorVersion: 1,
        approvalState: "REVOKED",
        approvalReference: null,
        approvedAt: null,
        updatedAt: revokedAt,
        revokedAt,
        revocationReason: "OWNER_REVOKED",
      });
      sourceRepository.persistCapabilityVersion(revoked);
    }
    if (grants.latestChildState(run.capabilityId) === "ACTIVE") {
      grants.transitionChild(run.capabilityId, "CONSUMED");
    }
    console.log(
      JSON.stringify({
        runId: run.id,
        work: work.length,
        evaluated: evaluated.length,
        queued: queued.length,
        failures,
      }),
    );
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GREEN_BANNER_SOURCE_RECOVERY_FAILED");
  process.exitCode = 1;
});
