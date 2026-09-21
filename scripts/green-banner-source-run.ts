import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import {
  GreenBannerGrantRepository,
  R2ARepository,
  R2Repository,
  SourceEnablementRepository,
  runLeverSourceToQueue,
  openApplyPilotDatabase,
  type R2QueueDecisionInput,
} from "@applypilot/database";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import {
  deriveGreenBannerChildCapability,
  type GreenBannerChildCapability,
} from "@applypilot/application-runner";
import { SourceCapabilityV2Schema, type SourceCapabilityV2 } from "@applypilot/job-sources";

import { execFileSync } from "node:child_process";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const STALE_CHILD_ID = "green_source_shieldai_227df70";
const CHILD_ID = "green_source_shieldai_227df70_r2";

function currentMainSha(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function makeCapability(child: GreenBannerChildCapability, now: string): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: child.childId,
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Shield AI",
    tenant: "shieldai",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/shieldai",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: child.parentGrantId,
    approvedAt: now,
    policyVersion: "green-banner-source-v1",
    policyReviewedAt: now,
    policyExpiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    capabilityExpiresAt: child.expiresAt,
    requestBudget: 4,
    recordCap: 100,
    pageSizeCap: 25,
    responseByteLimit: 2_000_000,
    requestTimeoutMs: 30_000,
    runTimeoutMs: 120_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: `lever-v2:${child.mainSha}`,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    revocationReason: null,
  });
}

function revokeCapability(capability: SourceCapabilityV2, now: string): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    ...capability,
    version: 2,
    predecessorVersion: 1,
    approvalState: "REVOKED",
    approvalReference: null,
    approvedAt: null,
    updatedAt: now,
    revokedAt: now,
    revocationReason: "OWNER_REVOKED",
  });
}

function recoverStaleAttempt(
  sqlite: import("better-sqlite3").Database,
  grantRepository: GreenBannerGrantRepository,
  sourceRepository: SourceEnablementRepository,
  now: string,
): void {
  const child = sqlite
    .prepare("SELECT id FROM green_banner_child_capabilities WHERE id=?")
    .get(STALE_CHILD_ID) as { id: string } | undefined;
  if (!child || grantRepository.latestChildState(STALE_CHILD_ID) !== "ACTIVE") return;
  const row = sqlite
    .prepare(
      `SELECT capability_id AS capabilityId,version,source,alias,
              tenant,region,allowed_host AS allowedHost,allowed_path_prefix AS allowedPathPrefix,
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
    .get(STALE_CHILD_ID) as Record<string, unknown> | undefined;
  if (!row) throw new Error("STALE_SOURCE_CAPABILITY_NOT_FOUND");
  const { allowedOperationsJson, ...capabilityRow } = row;
  const capability = SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    ...capabilityRow,
    predecessorVersion: null,
    allowedOperations: JSON.parse(String(allowedOperationsJson)),
    updatedAt: String(row.createdAt),
  });
  sourceRepository.persistCapabilityVersion(revokeCapability(capability, now));
  grantRepository.transitionChild(STALE_CHILD_ID, "REVOKED");
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const database = openApplyPilotDatabase(localDatabasePath());
  const now = () => new Date();
  const nowIso = () => now().toISOString();
  const mainSha = currentMainSha(root);
  const grantRepository = new GreenBannerGrantRepository(database.sqlite, now);
  const parent = grantRepository.getParentGrant();
  if (grantRepository.latestParentState(parent.grantId) !== "ACTIVE") {
    throw new Error("GREEN_BANNER_PARENT_NOT_ACTIVE");
  }
  if (parent.mainSha !== mainSha) throw new Error("GREEN_BANNER_MAIN_SHA_MISMATCH");

  const sourceRepository = new SourceEnablementRepository(database.sqlite, now);
  recoverStaleAttempt(database.sqlite, grantRepository, sourceRepository, nowIso());

  const createdAt = nowIso();
  const child = deriveGreenBannerChildCapability({
    parent,
    now: now(),
    child: {
      schemaVersion: 1,
      childId: CHILD_ID,
      childType: "SOURCE",
      operation: "SOURCE_LIST_JOBS",
      provider: "LEVER",
      tenant: "shieldai",
      allowedHost: "api.lever.co",
      allowedPathPrefix: "/v0/postings/shieldai",
      targetOrigin: null,
      targetPath: null,
      packetDigest: null,
      adapterVersion: `lever-v2:${mainSha}`,
      formVersion: null,
      documentDigest: null,
      answersDigest: null,
      disclosuresDigest: null,
      mainSha,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString(),
    },
  });
  grantRepository.persistChildCapability(child);
  const capability = makeCapability(child, createdAt);
  sourceRepository.persistCapabilityVersion(capability);

  const profilePath = `${root}/data/profile.private.json`;
  const profile = CandidateProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
  const r2 = new R2Repository(database.sqlite, now);
  const result = await runLeverSourceToQueue({
    capability,
    repository: sourceRepository,
    now,
    evaluateJob: async (jobId) => {
      const jobVersionId = database.sqlite
        .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
        .pluck()
        .get(jobId) as string | undefined;
      if (!jobVersionId) throw new Error("R2_CURRENT_JOB_VERSION_REQUIRED");
      const read = new R2ARepository(database.sqlite, now).getNormalizationResult(jobVersionId);
      if (read.state !== "AVAILABLE") throw new Error(`R2_CURRENT_NORMALIZATION_${read.state}`);
      const profileVersionId = database.sqlite
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
        evaluatedAt: nowIso(),
      });
      const fit = scoreR2JobFit({
        profile,
        normalization: read.normalization,
        eligibility,
        calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
      });
      return r2.recordEvaluation({
        id: evaluationVersionId,
        jobId,
        jobVersionId,
        profileVersionId,
        normalization: read.normalization,
        eligibility,
        fit,
      }).id;
    },
    queueJob: (jobId, evaluationId) => {
      const evaluation = database.sqlite
        .prepare(
          `SELECT eligibility_status AS eligibilityStatus,recommended
           FROM r2_evaluation_versions WHERE id=? AND job_id=?`,
        )
        .get(evaluationId, jobId) as { eligibilityStatus: string; recommended: number } | undefined;
      if (!evaluation) throw new Error("R2_CURRENT_EVALUATION_REQUIRED");
      const state: R2QueueDecisionInput["state"] =
        evaluation.eligibilityStatus === "ELIGIBLE" && evaluation.recommended
          ? "SHORTLISTED"
          : "REVIEWING";
      r2.recordQueueDecision({
        jobId,
        state,
        r2EvaluationId: evaluationId,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(jobId),
        actor: "SYSTEM",
        reasonCode: state === "SHORTLISTED" ? "SOURCE_R2_RECOMMENDED" : "SOURCE_R2_REVIEW_REQUIRED",
      });
    },
  });

  const terminalAt = nowIso();
  sourceRepository.persistCapabilityVersion(revokeCapability(capability, terminalAt));
  grantRepository.transitionChild(
    child.childId,
    result.status === "COMPLETE" ? "CONSUMED" : "REVOKED",
  );

  const jobIds = result.status === "COMPLETE" ? sourceRepository.jobIdsForRun(result.runId) : [];
  const summaries = jobIds.map((jobId) => {
    const row = database.sqlite
      .prepare(
        `SELECT j.title,j.location,e.eligibility_status AS eligibilityStatus,e.recommended,
                e.fit_score AS fitScore
         FROM jobs j LEFT JOIN r2_evaluation_versions e ON e.id=(
           SELECT id FROM r2_evaluation_versions WHERE job_id=j.id AND stale=0
           ORDER BY evaluated_at DESC,rowid DESC LIMIT 1) WHERE j.id=?`,
      )
      .get(jobId) as
      | {
          title: string;
          location: string;
          eligibilityStatus: string | null;
          recommended: number | null;
          fitScore: number | null;
        }
      | undefined;
    return summariesSafe(summariesRow(row));
  });
  console.log(
    JSON.stringify({
      mainSha,
      childId: child.childId,
      childDigest: child.childDigest,
      runId: result.runId,
      status: result.status,
      stopCode: result.stopCode,
      requestCount: result.requestCount,
      pageCount: result.pageCount,
      providerRecordCount: result.providerRecordCount,
      acceptedRecordCount: result.acceptedRecordCount,
      unusableRecordCount: result.unusableRecordCount,
      queuedJobCount: result.queuedJobIds.length,
      sourceCapabilityActive: sourceCapabilityActive(database.sqlite),
      summaries,
    }),
  );
  database.close();
}

function summariesRow(
  row:
    | {
        title: string;
        location: string;
        eligibilityStatus: string | null;
        recommended: number | null;
        fitScore: number | null;
      }
    | undefined,
) {
  if (!row)
    return { title: null, location: null, eligibility: null, recommended: false, fitScore: null };
  return {
    title: row.title,
    location: row.location,
    eligibility: row.eligibilityStatus,
    recommended: Boolean(row.recommended),
    fitScore: row.fitScore,
  };
}

function summariesSafe(row: ReturnType<typeof summariesRow>) {
  return row;
}

function sourceCapabilityActive(sqlite: import("better-sqlite3").Database): number {
  return Number(
    sqlite
      .prepare(
        `SELECT count(*) FROM source_capability_versions c
         WHERE c.approval_state='APPROVED' AND c.capability_expires_at>? AND c.version=(
           SELECT max(latest.version) FROM source_capability_versions latest
           WHERE latest.capability_id=c.capability_id)`,
      )
      .pluck()
      .get(new Date().toISOString()),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GREEN_BANNER_SOURCE_FAILED");
  process.exitCode = 1;
});
