import { createHash, randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  R2_MINIMUM_EXTRACTION_COVERAGE,
  type R2EligibilityResult,
} from "@applypilot/eligibility-engine";
import {
  assessR2Calibration,
  type R2CalibrationGateInput,
  type R2FitResult,
  type R2GoldenMetrics,
} from "@applypilot/fit-scorer";
import {
  R2ANormalizationSchema,
  JobSchema,
  type Job,
  type R2ANormalization,
} from "@applypilot/job-model";
import {
  compareCrossSourceObservations,
  ObservationIdentitySchema,
  type ObservationIdentity,
} from "@applypilot/job-normalizer";

import { ownerCorrectedR2Normalization, r2CorrectionValueDigest } from "./r2-corrections";

export const R2_DUPLICATE_DETECTOR_VERSION = "r2-duplicate-1";
export const R2_CORRECTION_APPLICABILITY_VERSION = "r2-correction-applicability-1";
const SafeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/);
const SafeCodeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9_]+$/);
const SafeVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9:._-]+$/);

const R2AuditMetadataSchemas = {
  "r2.evaluation.completed": z
    .object({
      eligibilityStatus: z.enum(["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"]),
      recommended: z.boolean(),
      scorerVersion: SafeVersionSchema,
      weightVersion: SafeVersionSchema,
      calibrationState: z.enum(["UNCALIBRATED", "CALIBRATION_PENDING", "CALIBRATED"]),
      unknownCount: z.number().int().nonnegative(),
      conditionCount: z.number().int().nonnegative(),
      conflictCount: z.number().int().nonnegative(),
    })
    .strict(),
  "r2.evaluation.stale": z.object({ reasonCode: SafeCodeSchema }).strict(),
  "r2.duplicate.suggested": z
    .object({
      detectorVersion: SafeVersionSchema,
      matchedCount: z.number().int().nonnegative(),
      conflictCount: z.number().int().nonnegative(),
    })
    .strict(),
  "r2.duplicate.decided": z
    .object({
      decision: z.enum(["LINKED", "REJECTED", "SPLIT"]),
      reasonCode: SafeCodeSchema,
      evidenceVersion: SafeVersionSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  "r2.queue.decided": z
    .object({
      state: z.enum(["REVIEWING", "SHORTLISTED", "SKIPPED", "PREPARING"]),
      freshness: z.literal("CURRENT"),
      reasonCode: SafeCodeSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  "r2.queue.stale": z
    .object({ reasonCode: SafeCodeSchema, count: z.number().int().nonnegative() })
    .strict(),
  "r2.correction.recorded": z
    .object({ changedFieldCount: z.number().int().positive(), reasonCode: SafeCodeSchema })
    .strict(),
  "r2.correction.replayed": z
    .object({
      correctionCount: z.number().int().nonnegative(),
      fieldCount: z.number().int().nonnegative(),
    })
    .strict(),
  "r2.correction.review_required": z
    .object({ reasonCode: SafeCodeSchema, correctionCount: z.number().int().nonnegative() })
    .strict(),
  "r2.calibration.completed": z
    .object({
      fictionalCaseCount: z.number().int().nonnegative(),
      privateReviewedCount: z.number().int().nonnegative(),
      roleFamilyCount: z.number().int().nonnegative(),
      state: z.enum(["UNCALIBRATED", "CALIBRATION_PENDING", "CALIBRATED"]),
    })
    .strict(),
} as const;

export type R2AuditEventType = keyof typeof R2AuditMetadataSchemas;

export function validateR2AuditMetadata(type: R2AuditEventType, metadata: unknown): object {
  return R2AuditMetadataSchemas[type].parse(metadata) as object;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

export interface R2EvaluationRecordInput {
  id?: string;
  jobId: string;
  jobVersionId: string;
  profileVersionId: string;
  normalization: R2ANormalization;
  eligibility: R2EligibilityResult;
  fit: R2FitResult;
}

export interface R2QueueDecisionInput {
  jobId: string;
  state: "REVIEWING" | "SHORTLISTED" | "SKIPPED" | "PREPARING";
  r2EvaluationId: string;
  duplicateResolutionVersion: string;
  actor: "OWNER" | "SYSTEM";
  reasonCode: string;
}

export type R2CorrectionReplayResult =
  | {
      state: "APPLIED";
      job: Job;
      normalization: R2ANormalization;
      correctionIds: string[];
      changedFields: string[];
    }
  | {
      state: "REVIEW_REQUIRED";
      job: Job;
      normalization: R2ANormalization;
      correctionIds: string[];
      changedFields: string[];
      reasonCode: "R2_CORRECTION_SOURCE_CHANGED";
    };

export class R2Repository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  available(): boolean {
    return Boolean(
      this.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='r2_evaluation_versions'")
        .get(),
    );
  }

  duplicateResolutionVersion(jobIdInput: string): string {
    const jobId = SafeIdSchema.parse(jobIdInput);
    const rows = this.sqlite
      .prepare(
        `SELECT c.id, c.state, c.detector_version AS detectorVersion,
                c.evidence_digest AS evidenceDigest,
                (SELECT d.version FROM r2_duplicate_decision_versions d
                 WHERE d.candidate_id = c.id ORDER BY d.version DESC LIMIT 1) AS decisionVersion,
                (SELECT d.decision FROM r2_duplicate_decision_versions d
                 WHERE d.candidate_id = c.id ORDER BY d.version DESC LIMIT 1) AS decision
         FROM r2_duplicate_candidates c
         WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
            OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
         ORDER BY c.id`,
      )
      .all(jobId, jobId);
    return `${R2_DUPLICATE_DETECTOR_VERSION}:${digest(rows)}`;
  }

  assertCurrentPreparing(jobIdInput: string, evaluationIdInput: string): void {
    const jobId = SafeIdSchema.parse(jobIdInput);
    const evaluationId = SafeIdSchema.parse(evaluationIdInput);
    const row = this.sqlite
      .prepare(
        `SELECT q.state, q.freshness, q.job_version_id AS queueJobVersionId,
                q.profile_version_id AS queueProfileVersionId,
                q.r2_evaluation_id AS queueEvaluationId,
                q.evidence_contract_version AS queueEvidenceContractVersion,
                q.coverage_version AS queueCoverageVersion,
                q.duplicate_resolution_version AS queueDuplicateResolutionVersion,
                e.job_version_id AS evaluationJobVersionId,
                e.profile_version_id AS evaluationProfileVersionId,
                e.evidence_contract_version AS evaluationEvidenceContractVersion,
                e.coverage_version AS evaluationCoverageVersion,
                e.eligibility_status AS eligibilityStatus, e.recommended, e.stale,
                (SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1)
                  AS currentJobVersionId,
                EXISTS(SELECT 1 FROM candidate_profiles
                       WHERE active_version_id = e.profile_version_id) AS currentProfile
         FROM r2_queue_decision_versions q
         JOIN r2_evaluation_versions e ON e.id = q.r2_evaluation_id
         WHERE q.job_id = ? ORDER BY q.version DESC LIMIT 1`,
      )
      .get(jobId, jobId) as
      | {
          state: string;
          freshness: string;
          queueJobVersionId: string;
          queueProfileVersionId: string;
          queueEvaluationId: string;
          queueEvidenceContractVersion: string;
          queueCoverageVersion: string;
          queueDuplicateResolutionVersion: string;
          evaluationJobVersionId: string;
          evaluationProfileVersionId: string;
          evaluationEvidenceContractVersion: string;
          evaluationCoverageVersion: string;
          eligibilityStatus: string;
          recommended: number;
          stale: number;
          currentJobVersionId: string | null;
          currentProfile: number;
        }
      | undefined;
    const unresolvedDuplicate = this.sqlite
      .prepare(
        `SELECT 1 FROM r2_duplicate_candidates c
         WHERE c.state = 'SUGGESTED' AND (
           c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?) OR
           c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
         ) LIMIT 1`,
      )
      .get(jobId, jobId);
    if (
      !row ||
      row.state !== "PREPARING" ||
      row.freshness !== "CURRENT" ||
      row.queueEvaluationId !== evaluationId ||
      row.queueJobVersionId !== row.evaluationJobVersionId ||
      row.queueProfileVersionId !== row.evaluationProfileVersionId ||
      row.queueEvidenceContractVersion !== row.evaluationEvidenceContractVersion ||
      row.queueCoverageVersion !== row.evaluationCoverageVersion ||
      row.queueJobVersionId !== row.currentJobVersionId ||
      !row.currentProfile ||
      row.eligibilityStatus !== "ELIGIBLE" ||
      !row.recommended ||
      row.stale !== 0 ||
      row.queueDuplicateResolutionVersion !== this.duplicateResolutionVersion(jobId) ||
      unresolvedDuplicate
    ) {
      throw new Error("R2_QUEUE_CURRENT_PREPARING_REQUIRED");
    }
  }

  private audit(
    type: R2AuditEventType,
    entityType: string,
    entityId: string,
    metadata: unknown,
  ): void {
    const safeEntityType = SafeIdSchema.parse(entityType);
    const safeEntityId = SafeIdSchema.parse(entityId);
    const safe = validateR2AuditMetadata(type, metadata);
    this.sqlite
      .prepare(
        `INSERT INTO r2_audit_events
          (id, event_type, entity_type, entity_id, safe_metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.id(),
        type,
        safeEntityType,
        safeEntityId,
        JSON.stringify(safe),
        this.now().toISOString(),
      );
  }

  recordEvaluation(input: R2EvaluationRecordInput): { id: string; created: boolean } {
    if (!this.available()) throw new Error("R2_SCHEMA_REQUIRED");
    const jobId = SafeIdSchema.parse(input.jobId);
    const jobVersionId = SafeIdSchema.parse(input.jobVersionId);
    const profileVersionId = SafeIdSchema.parse(input.profileVersionId);
    const normalization = R2ANormalizationSchema.parse(input.normalization);
    if (!input.eligibility.current) throw new Error("R2_EVALUATION_BINDING_STALE");
    if (
      input.eligibility.bindings.jobVersionId !== jobVersionId ||
      input.eligibility.bindings.profileVersionId !== profileVersionId ||
      input.eligibility.bindings.evidenceContractVersion !== normalization.evidenceContractVersion
    ) {
      throw new Error("R2_EVALUATION_BINDING_MISMATCH");
    }
    if (input.fit.coveragePercent !== input.eligibility.coveragePercent) {
      throw new Error("R2_EVALUATION_COVERAGE_MISMATCH");
    }
    if (
      input.fit.recommended &&
      (input.eligibility.status !== "ELIGIBLE" ||
        input.eligibility.unresolvedMaterialUnknowns > 0 ||
        input.eligibility.unresolvedMaterialConditions > 0 ||
        input.eligibility.unresolvedMaterialConflicts > 0 ||
        input.eligibility.coveragePercent < R2_MINIMUM_EXTRACTION_COVERAGE ||
        input.fit.recommendationBlockers.length > 0)
    ) {
      throw new Error("R2_RECOMMENDATION_INVARIANT_VIOLATION");
    }
    const calibrationContextVersion = SafeVersionSchema.parse(input.fit.calibrationContextVersion);
    const calibrationRunId = input.fit.calibrationRunId
      ? SafeIdSchema.parse(input.fit.calibrationRunId)
      : null;
    if (input.fit.calibrationState === "CALIBRATED" && !calibrationRunId) {
      throw new Error("R2_CALIBRATION_RUN_REQUIRED");
    }
    if (calibrationRunId) {
      const calibration = this.sqlite
        .prepare(
          `SELECT r.scorer_version AS scorerVersion, r.weight_version AS weightVersion, r.state,
                  q.performance_threshold_version AS performanceThresholdVersion,
                  q.safety_gate_version AS safetyGateVersion,
                  q.owner_approval_id AS ownerApprovalId,
                  q.blocker_codes_json AS blockerCodesJson
           FROM r2_calibration_runs r
           LEFT JOIN r2_calibration_qualifications q ON q.run_id = r.id
           WHERE r.id = ?`,
        )
        .get(calibrationRunId) as
        | {
            scorerVersion: string;
            weightVersion: string;
            state: string;
            performanceThresholdVersion: string | null;
            safetyGateVersion: string | null;
            ownerApprovalId: string | null;
            blockerCodesJson: string | null;
          }
        | undefined;
      if (
        !calibration ||
        calibration.scorerVersion !== input.fit.scorerVersion ||
        calibration.weightVersion !== input.fit.weightVersion ||
        calibration.state !== input.fit.calibrationState
      ) {
        throw new Error("R2_CALIBRATION_RUN_BINDING_MISMATCH");
      }
      if (
        input.fit.calibrationState === "CALIBRATED" &&
        (!calibration.performanceThresholdVersion ||
          !calibration.safetyGateVersion ||
          !calibration.ownerApprovalId ||
          calibration.blockerCodesJson !== "[]")
      ) {
        throw new Error("R2_CALIBRATION_RUN_NOT_QUALIFIED");
      }
    }
    const latestJob = this.sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1")
      .get(jobId) as { id: string } | undefined;
    const activeProfile = this.sqlite
      .prepare("SELECT 1 FROM candidate_profiles WHERE active_version_id = ?")
      .get(profileVersionId);
    if (latestJob?.id !== jobVersionId || !activeProfile) {
      throw new Error("R2_EVALUATION_NOT_CURRENT");
    }
    const existing = this.sqlite
      .prepare(
        `SELECT id, eligibility_status AS eligibilityStatus, eligibility_reasons_json AS reasons,
                fit_score AS fitScore, fit_contributions_json AS contributions,
                calibration_state AS calibrationState,
                calibration_context_version AS calibrationContextVersion,
                calibration_run_id AS calibrationRunId, recommended,
                coverage_percent AS coveragePercent,
                unresolved_unknown_count AS unresolvedUnknownCount,
                unresolved_condition_count AS unresolvedConditionCount,
                unresolved_conflict_count AS unresolvedConflictCount
         FROM r2_evaluation_versions
         WHERE job_version_id = ? AND profile_version_id = ? AND evidence_contract_version = ?
           AND normalization_version = ? AND coverage_version = ?
           AND eligibility_engine_version = ? AND fit_scorer_version = ?
           AND weight_version = ? AND calibration_context_version = ?`,
      )
      .get(
        jobVersionId,
        profileVersionId,
        normalization.evidenceContractVersion,
        normalization.normalizationVersion,
        `${normalization.parserVersion}:${normalization.normalizationVersion}`,
        input.eligibility.engineVersion,
        input.fit.scorerVersion,
        input.fit.weightVersion,
        calibrationContextVersion,
      ) as
      | {
          id: string;
          eligibilityStatus: string;
          reasons: string;
          fitScore: number;
          contributions: string;
          calibrationState: string;
          calibrationContextVersion: string;
          calibrationRunId: string | null;
          recommended: number;
          coveragePercent: number;
          unresolvedUnknownCount: number;
          unresolvedConditionCount: number;
          unresolvedConflictCount: number;
        }
      | undefined;
    if (existing) {
      const same =
        existing.eligibilityStatus === input.eligibility.status &&
        existing.reasons === JSON.stringify(input.eligibility.reasons) &&
        existing.fitScore === input.fit.score &&
        existing.contributions === JSON.stringify(input.fit.contributions) &&
        existing.calibrationState === input.fit.calibrationState &&
        existing.calibrationContextVersion === calibrationContextVersion &&
        existing.calibrationRunId === calibrationRunId &&
        Boolean(existing.recommended) === input.fit.recommended &&
        existing.coveragePercent === input.eligibility.coveragePercent &&
        existing.unresolvedUnknownCount === input.eligibility.unresolvedMaterialUnknowns &&
        existing.unresolvedConditionCount === input.eligibility.unresolvedMaterialConditions &&
        existing.unresolvedConflictCount === input.eligibility.unresolvedMaterialConflicts;
      if (!same) throw new Error("R2_EVALUATION_IDEMPOTENCY_CONFLICT");
      return { id: existing.id, created: false };
    }
    return this.sqlite.transaction(() => {
      const now = this.now().toISOString();
      this.sqlite
        .prepare("UPDATE r2_evaluation_versions SET stale = 1 WHERE job_id = ? AND stale = 0")
        .run(jobId);
      this.markQueueStale(jobId, "R2_EVALUATION_CHANGED", false);
      const id = input.id ? SafeIdSchema.parse(input.id) : this.id();
      const coverageVersion = `${normalization.parserVersion}:${normalization.normalizationVersion}`;
      this.sqlite
        .prepare(
          `INSERT INTO r2_evaluation_versions
            (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
             normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
             fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
             weight_version,calibration_state,calibration_context_version,calibration_run_id,
             recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,
             unresolved_conflict_count,stale,evaluated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
        )
        .run(
          id,
          jobId,
          jobVersionId,
          profileVersionId,
          normalization.evidenceContractVersion,
          normalization.normalizationVersion,
          coverageVersion,
          input.eligibility.status,
          JSON.stringify(input.eligibility.reasons),
          input.fit.score,
          JSON.stringify(input.fit.contributions),
          input.eligibility.engineVersion,
          input.fit.scorerVersion,
          input.fit.weightVersion,
          input.fit.calibrationState,
          calibrationContextVersion,
          calibrationRunId,
          input.fit.recommended ? 1 : 0,
          input.eligibility.coveragePercent,
          input.eligibility.unresolvedMaterialUnknowns,
          input.eligibility.unresolvedMaterialConditions,
          input.eligibility.unresolvedMaterialConflicts,
          now,
        );
      this.sqlite
        .prepare("UPDATE document_artifacts SET stale = 1 WHERE job_id = ? AND stale = 0")
        .run(jobId);
      this.sqlite
        .prepare(
          `UPDATE document_approvals SET invalidated_at = ?, invalidation_reason = 'R2_EVALUATION_CHANGED'
           WHERE invalidated_at IS NULL AND document_artifact_id IN
             (SELECT id FROM document_artifacts WHERE job_id = ? AND stale = 1)`,
        )
        .run(now, jobId);
      this.sqlite
        .prepare(
          `UPDATE application_packets SET status = 'INVALIDATED', readiness_json = ?, updated_at = ?
           WHERE job_id = ? AND status <> 'INVALIDATED'`,
        )
        .run(
          JSON.stringify({
            status: "REVIEW_REQUIRED",
            blockers: ["R2_EVALUATION_CHANGED"],
            warnings: [],
          }),
          now,
          jobId,
        );
      this.audit("r2.evaluation.completed", "job", jobId, {
        eligibilityStatus: input.eligibility.status,
        recommended: input.fit.recommended,
        scorerVersion: input.fit.scorerVersion,
        weightVersion: input.fit.weightVersion,
        calibrationState: input.fit.calibrationState,
        unknownCount: input.eligibility.unresolvedMaterialUnknowns,
        conditionCount: input.eligibility.unresolvedMaterialConditions,
        conflictCount: input.eligibility.unresolvedMaterialConflicts,
      });
      return { id, created: true };
    })();
  }

  suggestDuplicate(
    leftInput: ObservationIdentity,
    rightInput: ObservationIdentity,
  ): { state: "DISTINCT" | "SUGGESTED"; candidateId: string | null; created: boolean } {
    if (!this.available()) throw new Error("R2_SCHEMA_REQUIRED");
    const left = ObservationIdentitySchema.parse(leftInput);
    const right = ObservationIdentitySchema.parse(rightInput);
    const comparison = compareCrossSourceObservations(left, right);
    if (comparison.decision === "SAME_OBSERVATION" || !comparison.requiresHumanReview) {
      return { state: "DISTINCT", candidateId: null, created: false };
    }
    const [leftObservationId, rightObservationId] = [
      left.observationId,
      right.observationId,
    ].sort();
    if (leftObservationId === rightObservationId) {
      return { state: "DISTINCT", candidateId: null, created: false };
    }
    for (const observationId of [leftObservationId, rightObservationId]) {
      if (
        !this.sqlite.prepare("SELECT 1 FROM source_observations WHERE id = ?").get(observationId)
      ) {
        throw new Error("R2_DUPLICATE_OBSERVATION_NOT_FOUND");
      }
    }
    const matched = [...comparison.matchedSignals].sort();
    const conflicting = [...comparison.conflictingSignals].sort();
    const evidenceDigest = digest({ leftObservationId, rightObservationId, matched, conflicting });
    const existing = this.sqlite
      .prepare(
        `SELECT id, evidence_digest AS evidenceDigest FROM r2_duplicate_candidates
         WHERE left_observation_id = ? AND right_observation_id = ? AND detector_version = ?`,
      )
      .get(leftObservationId, rightObservationId, R2_DUPLICATE_DETECTOR_VERSION) as
      | { id: string; evidenceDigest: string }
      | undefined;
    if (existing) {
      if (existing.evidenceDigest !== evidenceDigest)
        throw new Error("R2_DUPLICATE_EVIDENCE_CHANGED");
      return { state: "SUGGESTED", candidateId: existing.id, created: false };
    }
    const id = this.id();
    const now = this.now().toISOString();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO r2_duplicate_candidates
            (id,left_observation_id,right_observation_id,detector_version,state,
             matched_signals_json,conflicting_signals_json,evidence_digest,created_at,updated_at)
           VALUES (?,?,?,?, 'SUGGESTED', ?,?,?,?,?)`,
        )
        .run(
          id,
          leftObservationId,
          rightObservationId,
          R2_DUPLICATE_DETECTOR_VERSION,
          JSON.stringify(matched),
          JSON.stringify(conflicting),
          evidenceDigest,
          now,
          now,
        );
      this.audit("r2.duplicate.suggested", "duplicate", id, {
        detectorVersion: R2_DUPLICATE_DETECTOR_VERSION,
        matchedCount: matched.length,
        conflictCount: conflicting.length,
      });
      const jobs = this.sqlite
        .prepare("SELECT DISTINCT job_id AS jobId FROM source_observations WHERE id IN (?, ?)")
        .all(leftObservationId, rightObservationId) as Array<{ jobId: string }>;
      for (const { jobId } of jobs) {
        this.markQueueStale(jobId, "DUPLICATE_EVIDENCE_CHANGED");
      }
    })();
    return { state: "SUGGESTED", candidateId: id, created: true };
  }

  decideDuplicate(input: {
    candidateId: string;
    decision: "LINKED" | "REJECTED" | "SPLIT";
    reasonCode: string;
    evidenceVersion: string;
  }): { id: string; version: number } {
    const candidateId = SafeIdSchema.parse(input.candidateId);
    const reasonCode = SafeCodeSchema.parse(input.reasonCode);
    const evidenceVersion = SafeVersionSchema.parse(input.evidenceVersion);
    const candidate = this.sqlite
      .prepare(
        `SELECT state, left_observation_id AS leftObservationId,
           right_observation_id AS rightObservationId
         FROM r2_duplicate_candidates WHERE id = ?`,
      )
      .get(candidateId) as
      | {
          state: "SUGGESTED" | "LINKED" | "REJECTED" | "SPLIT";
          leftObservationId: string;
          rightObservationId: string;
        }
      | undefined;
    if (!candidate) throw new Error("R2_DUPLICATE_CANDIDATE_NOT_FOUND");
    const allowed =
      (candidate.state === "SUGGESTED" && ["LINKED", "REJECTED"].includes(input.decision)) ||
      (candidate.state === "LINKED" && input.decision === "SPLIT") ||
      ((candidate.state === "SPLIT" || candidate.state === "REJECTED") &&
        input.decision === "LINKED");
    if (!allowed) throw new Error("R2_DUPLICATE_DECISION_INVALID");
    return this.sqlite.transaction(() => {
      const previous = this.sqlite
        .prepare(
          `SELECT id, version FROM r2_duplicate_decision_versions
           WHERE candidate_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(candidateId) as { id: string; version: number } | undefined;
      const version = (previous?.version ?? 0) + 1;
      const id = this.id();
      const now = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO r2_duplicate_decision_versions
            (id,candidate_id,version,decision,actor,reason_code,evidence_version,
             supersedes_decision_id,created_at)
           VALUES (?,?,?,?,'OWNER',?,?,?,?)`,
        )
        .run(
          id,
          candidateId,
          version,
          input.decision,
          reasonCode,
          evidenceVersion,
          previous?.id ?? null,
          now,
        );
      this.sqlite
        .prepare("UPDATE r2_duplicate_candidates SET state = ?, updated_at = ? WHERE id = ?")
        .run(input.decision, now, candidateId);
      this.audit("r2.duplicate.decided", "duplicate", candidateId, {
        decision: input.decision,
        reasonCode,
        evidenceVersion,
        version,
      });
      const jobs = this.sqlite
        .prepare("SELECT DISTINCT job_id AS jobId FROM source_observations WHERE id IN (?, ?)")
        .all(candidate.leftObservationId, candidate.rightObservationId) as Array<{ jobId: string }>;
      for (const { jobId } of jobs) {
        this.markQueueStale(jobId, "DUPLICATE_RESOLUTION_CHANGED");
      }
      return { id, version };
    })();
  }

  recordQueueDecision(input: R2QueueDecisionInput): { id: string; version: number } {
    const jobId = SafeIdSchema.parse(input.jobId);
    const reasonCode = SafeCodeSchema.parse(input.reasonCode);
    const duplicateResolutionVersion = SafeVersionSchema.parse(input.duplicateResolutionVersion);
    if (duplicateResolutionVersion !== this.duplicateResolutionVersion(jobId)) {
      throw new Error("R2_DUPLICATE_RESOLUTION_BINDING_MISMATCH");
    }
    const evaluation = this.sqlite
      .prepare(
        `SELECT id, job_version_id AS jobVersionId, profile_version_id AS profileVersionId,
                evidence_contract_version AS evidenceContractVersion,
                coverage_version AS coverageVersion, eligibility_status AS eligibilityStatus,
                recommended, stale
         FROM r2_evaluation_versions WHERE id = ? AND job_id = ?`,
      )
      .get(input.r2EvaluationId, jobId) as
      | {
          id: string;
          jobVersionId: string;
          profileVersionId: string;
          evidenceContractVersion: string;
          coverageVersion: string;
          eligibilityStatus: string;
          recommended: number;
          stale: number;
        }
      | undefined;
    if (!evaluation || evaluation.stale) throw new Error("R2_CURRENT_EVALUATION_REQUIRED");
    const currentJobVersion = this.sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(jobId) as string | undefined;
    const currentProfileVersion = this.sqlite
      .prepare("SELECT 1 FROM candidate_profiles WHERE active_version_id = ?")
      .get(evaluation.profileVersionId);
    if (currentJobVersion !== evaluation.jobVersionId || !currentProfileVersion) {
      throw new Error("R2_CURRENT_EVALUATION_REQUIRED");
    }
    const unresolvedDuplicate = this.sqlite
      .prepare(
        `SELECT 1 FROM r2_duplicate_candidates c
         WHERE c.state = 'SUGGESTED' AND (
           c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?) OR
           c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
         ) LIMIT 1`,
      )
      .get(jobId, jobId);
    if (
      input.state === "PREPARING" &&
      (evaluation.eligibilityStatus !== "ELIGIBLE" ||
        !evaluation.recommended ||
        unresolvedDuplicate)
    ) {
      throw new Error("R2_QUEUE_PREPARING_NOT_READY");
    }
    return this.sqlite.transaction(() => {
      const previous = this.sqlite
        .prepare(
          `SELECT id, version FROM r2_queue_decision_versions
           WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(jobId) as { id: string; version: number } | undefined;
      this.sqlite
        .prepare(
          "UPDATE r2_queue_decision_versions SET freshness = 'STALE' WHERE job_id = ? AND freshness = 'CURRENT'",
        )
        .run(jobId);
      const id = this.id();
      const version = (previous?.version ?? 0) + 1;
      const now = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO r2_queue_decision_versions
            (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,
             evidence_contract_version,duplicate_resolution_version,coverage_version,actor,
             reason_code,supersedes_decision_id,created_at)
           VALUES (?,?,?,?,'CURRENT',?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          jobId,
          version,
          input.state,
          evaluation.jobVersionId,
          evaluation.profileVersionId,
          evaluation.id,
          evaluation.evidenceContractVersion,
          duplicateResolutionVersion,
          evaluation.coverageVersion,
          input.actor,
          reasonCode,
          previous?.id ?? null,
          now,
        );
      this.sqlite
        .prepare(
          `INSERT INTO job_queue_entries
            (job_id,state,evaluation_version_id,reason_code,created_at,updated_at)
           VALUES (?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET
             state=excluded.state,evaluation_version_id=NULL,reason_code=excluded.reason_code,
             updated_at=excluded.updated_at`,
        )
        .run(jobId, input.state, null, reasonCode, now, now);
      this.audit("r2.queue.decided", "job", jobId, {
        state: input.state,
        freshness: "CURRENT",
        reasonCode,
        version,
      });
      return { id, version };
    })();
  }

  markQueueStale(jobIdInput: string, reasonCodeInput: string, writeAudit = true): number {
    if (!this.available()) return 0;
    const jobId = SafeIdSchema.parse(jobIdInput);
    const reasonCode = SafeCodeSchema.parse(reasonCodeInput);
    const changed = this.sqlite
      .prepare(
        "UPDATE r2_queue_decision_versions SET freshness = 'STALE' WHERE job_id = ? AND freshness = 'CURRENT'",
      )
      .run(jobId).changes;
    this.sqlite
      .prepare(
        `UPDATE job_queue_entries SET state = 'REVIEWING', reason_code = ?, updated_at = ?
         WHERE job_id = ? AND state = 'PREPARING'`,
      )
      .run(reasonCode, this.now().toISOString(), jobId);
    if (changed > 0) {
      this.sqlite
        .prepare(
          `UPDATE application_packets SET status = 'INVALIDATED', readiness_json = ?, updated_at = ?
           WHERE job_id = ? AND status <> 'INVALIDATED'`,
        )
        .run(
          JSON.stringify({ status: "REVIEW_REQUIRED", blockers: [reasonCode], warnings: [] }),
          this.now().toISOString(),
          jobId,
        );
    }
    if (writeAudit && changed > 0) {
      this.audit("r2.queue.stale", "job", jobId, { reasonCode, count: changed });
    }
    return changed;
  }

  recordCorrectionBindings(correctionIdInput: string): number {
    if (!this.available()) return 0;
    const correctionId = SafeIdSchema.parse(correctionIdInput);
    const correction = this.sqlite
      .prepare(
        `SELECT c.changed_fields_json AS changedFieldsJson, c.from_job_version_id AS fromVersionId,
                c.to_job_version_id AS toVersionId, v.source_observation_id AS sourceObservationId,
                v.normalized_json AS fromJson, t.normalized_json AS toJson
         FROM job_corrections c
         JOIN job_versions v ON v.id = c.from_job_version_id
         JOIN job_versions t ON t.id = c.to_job_version_id
         WHERE c.id = ?`,
      )
      .get(correctionId) as
      | {
          changedFieldsJson: string;
          fromVersionId: string;
          toVersionId: string;
          sourceObservationId: string | null;
          fromJson: string;
          toJson: string;
        }
      | undefined;
    if (!correction || !correction.sourceObservationId)
      throw new Error("R2_CORRECTION_BINDING_SOURCE_REQUIRED");
    const changedFields = z
      .array(SafeIdSchema)
      .min(1)
      .parse(JSON.parse(correction.changedFieldsJson));
    const from = JobSchema.parse(JSON.parse(correction.fromJson)) as unknown as Record<
      string,
      unknown
    >;
    const to = JobSchema.parse(JSON.parse(correction.toJson)) as unknown as Record<string, unknown>;
    const now = this.now().toISOString();
    let created = 0;
    const insert = this.sqlite.prepare(
      `INSERT OR IGNORE INTO r2_correction_overlay_bindings
        (id,correction_id,target_kind,target_key,source_observation_id,source_value_digest,
         corrected_value_json,applicability_rule_version,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    const requirementFields = new Set([
      "requirements",
      "preferredRequirements",
      "requiredSkills",
      "workRightsRequirement",
      "vehicleRequirement",
    ]);
    for (const field of changedFields) {
      created += insert.run(
        this.id(),
        correctionId,
        requirementFields.has(field) ? "REQUIREMENT" : "FIELD",
        field,
        correction.sourceObservationId,
        r2CorrectionValueDigest(from[field]),
        JSON.stringify(to[field] ?? null),
        R2_CORRECTION_APPLICABILITY_VERSION,
        now,
      ).changes;
    }
    return created;
  }

  recordCorrectionChange(input: {
    correctionId: string;
    jobId: string;
    reasonCode: string;
    changedFieldCount: number;
  }): { bindings: number; staleEvaluations: number; staleQueueDecisions: number } {
    if (!this.available()) {
      return { bindings: 0, staleEvaluations: 0, staleQueueDecisions: 0 };
    }
    const jobId = SafeIdSchema.parse(input.jobId);
    const reasonCode = SafeCodeSchema.parse(input.reasonCode);
    const changedFieldCount = z.number().int().positive().parse(input.changedFieldCount);
    return this.sqlite.transaction(() => {
      const bindings = this.recordCorrectionBindings(input.correctionId);
      const staleEvaluations = this.sqlite
        .prepare("UPDATE r2_evaluation_versions SET stale = 1 WHERE job_id = ? AND stale = 0")
        .run(jobId).changes;
      if (staleEvaluations > 0) {
        this.audit("r2.evaluation.stale", "job", jobId, { reasonCode });
      }
      const staleQueueDecisions = this.markQueueStale(jobId, reasonCode);
      this.audit("r2.correction.recorded", "job", jobId, { changedFieldCount, reasonCode });
      return { bindings, staleEvaluations, staleQueueDecisions };
    })();
  }

  replayCorrectionOverlay(input: {
    jobId: string;
    sourceObservationId: string;
    job: Job;
    normalization: R2ANormalization;
  }): R2CorrectionReplayResult {
    const jobId = SafeIdSchema.parse(input.jobId);
    const sourceObservationId = SafeIdSchema.parse(input.sourceObservationId);
    let job = JobSchema.parse(input.job);
    let normalization = R2ANormalizationSchema.parse(input.normalization);
    const rows = this.sqlite
      .prepare(
        `SELECT c.id, c.changed_fields_json AS changedFieldsJson,
                f.normalized_json AS fromJson, t.normalized_json AS toJson,
                f.source_observation_id AS correctionSourceObservationId
         FROM job_corrections c
         JOIN job_versions f ON f.id = c.from_job_version_id
         JOIN job_versions t ON t.id = c.to_job_version_id
         WHERE c.job_id = ? ORDER BY c.created_at, c.rowid`,
      )
      .all(jobId) as Array<{
      id: string;
      changedFieldsJson: string;
      fromJson: string;
      toJson: string;
      correctionSourceObservationId: string | null;
    }>;
    if (rows.length === 0) {
      return { state: "APPLIED", job, normalization, correctionIds: [], changedFields: [] };
    }
    const correctionIds: string[] = [];
    const changedFields = new Set<string>();
    for (const row of rows) {
      if (!row.correctionSourceObservationId) {
        return {
          state: "REVIEW_REQUIRED",
          job: input.job,
          normalization: input.normalization,
          correctionIds: [...correctionIds, row.id],
          changedFields: [...changedFields],
          reasonCode: "R2_CORRECTION_SOURCE_CHANGED",
        };
      }
      const fields = z.array(SafeIdSchema).min(1).parse(JSON.parse(row.changedFieldsJson));
      const from = JobSchema.parse(JSON.parse(row.fromJson)) as unknown as Record<string, unknown>;
      const toJob = JobSchema.parse(JSON.parse(row.toJson));
      const working = job as unknown as Record<string, unknown>;
      const sameSource = row.correctionSourceObservationId === sourceObservationId;
      const applicable = fields.every(
        (field) =>
          sameSource ||
          r2CorrectionValueDigest(working[field]) === r2CorrectionValueDigest(from[field]),
      );
      if (!applicable) {
        this.audit("r2.correction.review_required", "job", jobId, {
          reasonCode: "R2_CORRECTION_SOURCE_CHANGED",
          correctionCount: correctionIds.length + 1,
        });
        return {
          state: "REVIEW_REQUIRED",
          job: input.job,
          normalization: input.normalization,
          correctionIds: [...correctionIds, row.id],
          changedFields: [...new Set([...changedFields, ...fields])].sort(),
          reasonCode: "R2_CORRECTION_SOURCE_CHANGED",
        };
      }
      const next = { ...job } as unknown as Record<string, unknown>;
      const to = toJob as unknown as Record<string, unknown>;
      for (const field of fields) next[field] = to[field];
      job = JobSchema.parse(next);
      normalization = ownerCorrectedR2Normalization({
        prior: normalization,
        job,
        changedFields: new Set(fields),
        correctionId: row.id,
      });
      correctionIds.push(row.id);
      fields.forEach((field) => changedFields.add(field));
      this.recordCorrectionBindings(row.id);
    }
    this.audit("r2.correction.replayed", "job", jobId, {
      correctionCount: correctionIds.length,
      fieldCount: changedFields.size,
    });
    return {
      state: "APPLIED",
      job,
      normalization,
      correctionIds,
      changedFields: [...changedFields].sort(),
    };
  }

  recordCalibrationRun(input: {
    metrics: R2GoldenMetrics;
    gate: R2CalibrationGateInput;
    evidenceVersion: string;
    privateEvidenceDigest: string;
    scorerVersion: string;
    weightVersion: string;
    corpusVersion: string;
  }): string {
    const id = this.id();
    const scorerVersion = SafeVersionSchema.parse(input.scorerVersion);
    const weightVersion = SafeVersionSchema.parse(input.weightVersion);
    const corpusVersion = SafeVersionSchema.parse(input.corpusVersion);
    const evidenceVersion = SafeVersionSchema.parse(input.evidenceVersion);
    const privateEvidenceDigest = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.privateEvidenceDigest);
    const assessment = assessR2Calibration(input.gate);
    if (input.metrics.calibrationState !== assessment.state) {
      throw new Error("R2_CALIBRATION_ASSESSMENT_MISMATCH");
    }
    const performanceThresholdVersion = input.gate.performanceThresholds
      ? SafeVersionSchema.parse(input.gate.performanceThresholds.version)
      : null;
    const safetyGateVersion = input.gate.safetyGates
      ? SafeVersionSchema.parse(input.gate.safetyGates.version)
      : null;
    const ownerApprovalId = input.gate.ownerApproval
      ? SafeIdSchema.parse(input.gate.ownerApproval.approvalId)
      : null;
    const ownerApprovedAt = input.gate.ownerApproval
      ? z.iso.datetime().parse(input.gate.ownerApproval.approvedAt)
      : null;
    const blockerCodes = z.array(SafeCodeSchema).parse(assessment.blockerCodes);
    this.sqlite.transaction(() => {
      const createdAt = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO r2_calibration_runs
            (id,scorer_version,weight_version,corpus_version,fictional_case_count,
             private_reviewed_count,role_family_count,status_count,ordinal_agreement_basis_points,
             top_k,top_k_utility_basis_points,state,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          scorerVersion,
          weightVersion,
          corpusVersion,
          input.metrics.total,
          assessment.sourceLabelCount,
          assessment.roleFamilyCount,
          assessment.statusCount,
          Math.round(input.metrics.ordinalAgreement * 10_000),
          input.metrics.topK,
          Math.round(input.metrics.topKReviewUtility * 10_000),
          assessment.state,
          createdAt,
        );
      this.sqlite
        .prepare(
          `INSERT INTO r2_calibration_qualifications
            (run_id,evidence_version,private_evidence_digest,source_label_count,
             compared_label_count,source_pair_count,compared_pair_count,
             label_agreement_basis_points,pair_agreement_basis_points,
             performance_threshold_version,safety_gate_version,owner_approval_id,
             owner_approved_at,blocker_codes_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          evidenceVersion,
          privateEvidenceDigest,
          assessment.sourceLabelCount,
          assessment.comparedLabelCount,
          assessment.sourcePairCount,
          assessment.comparedPairCount,
          assessment.labelAgreementBasisPoints,
          assessment.pairAgreementBasisPoints,
          performanceThresholdVersion,
          safetyGateVersion,
          ownerApprovalId,
          ownerApprovedAt,
          JSON.stringify(blockerCodes),
          createdAt,
        );
      this.audit("r2.calibration.completed", "calibration", id, {
        fictionalCaseCount: input.metrics.total,
        privateReviewedCount: assessment.sourceLabelCount,
        roleFamilyCount: assessment.roleFamilyCount,
        state: assessment.state,
      });
    })();
    return id;
  }
}
