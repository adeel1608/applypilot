import { existsSync, realpathSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  R2_RECOMMENDATION_THRESHOLD,
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  scoreR2JobFit,
} from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import { R2ARepository, R2Repository, SourceEnablementRepository } from "@applypilot/database";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`ARGUMENT_REQUIRED:${name}`);
  return value;
}

const databasePath = realpathSync(argument("database"));
const verificationId = argument("verification");
if (
  !databasePath.includes("data\\private\\rehearsals\\") &&
  !databasePath.includes("data/private/rehearsals/")
) {
  throw new Error("R2A_REDERIVATION_REHEARSAL_PATH_REQUIRED");
}
if (!existsSync(databasePath)) throw new Error("DATABASE_NOT_FOUND");

const sqlite = new BetterSqlite3(databasePath);
sqlite.pragma("foreign_keys = ON");
try {
  const verification = sqlite
    .prepare("SELECT id,job_version_id AS jobVersionId FROM source_record_verifications WHERE id=?")
    .get(verificationId) as { id: string; jobVersionId: string } | undefined;
  if (!verification) throw new Error("R2A_VERIFICATION_NOT_FOUND");
  const oldNormalization = new R2ARepository(sqlite).getNormalization(verification.jobVersionId);
  if (!oldNormalization) throw new Error("R2A_OLD_NORMALIZATION_NOT_FOUND");
  const jobRow = sqlite
    .prepare(
      "SELECT job_id AS jobId,normalized_json AS normalizedJson FROM job_versions WHERE id=?",
    )
    .get(verification.jobVersionId) as { jobId: string; normalizedJson: string };
  const job = JobSchema.parse(JSON.parse(jobRow.normalizedJson));
  const profileVersion = sqlite
    .prepare(
      "SELECT v.id,v.snapshot_json AS snapshotJson FROM candidate_profiles p JOIN candidate_profile_versions v ON v.id=p.active_version_id LIMIT 1",
    )
    .get() as { id: string; snapshotJson: string } | undefined;
  if (!profileVersion) throw new Error("R2A_PROFILE_VERSION_NOT_FOUND");
  const profile = CandidateProfileSchema.parse(JSON.parse(profileVersion.snapshotJson));
  const safeQueue = () =>
    sqlite
      .prepare(
        `SELECT state,freshness FROM r2_queue_decision_versions
         WHERE job_id=? ORDER BY version DESC LIMIT 1`,
      )
      .get(jobRow.jobId) as { state: string; freshness: string } | undefined;
  const safeMetrics = (normalization: typeof oldNormalization, evaluationId: string) => {
    const eligibility = evaluateR2Eligibility({
      profile,
      normalization,
      bindings: {
        jobVersionId: evaluationId === "before" ? verification.jobVersionId : evaluationId,
        currentJobVersionId: evaluationId === "before" ? verification.jobVersionId : evaluationId,
        profileVersionId: profileVersion.id,
        currentProfileVersionId: profileVersion.id,
        evidenceContractVersion: normalization.evidenceContractVersion,
        currentEvidenceContractVersion: normalization.evidenceContractVersion,
        evaluationVersionId: "rehearsal-" + evaluationId,
      },
      evaluatedAt: "2026-09-27T14:40:00.000Z",
    });
    const fit = scoreR2JobFit({
      profile,
      normalization,
      eligibility,
      calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
      commute: {
        distanceKm: job.estimatedCommuteKm,
        durationMinutes: job.estimatedCommuteMinutes ?? null,
      },
    });
    return {
      eligibility: eligibility.status,
      score: fit.score,
      threshold: R2_RECOMMENDATION_THRESHOLD,
      recommended: fit.recommended,
      eligibilityReasons: eligibility.reasons.map(({ code }) => code),
      fitRecommendationBlockers: fit.recommendationBlockers,
      contributionCount: fit.contributions.length,
      contributionCodes: fit.contributions.map(({ code }) => code),
      contributionPoints: fit.contributions.map(({ code, points }) => ({ code, points })),
      contributionPointTotal: fit.contributions.reduce((total, { points }) => total + points, 0),
      coverage: eligibility.coveragePercent,
      unknown: eligibility.unresolvedMaterialUnknowns,
      conditions: eligibility.unresolvedMaterialConditions,
      conflicts: eligibility.unresolvedMaterialConflicts,
      observed: eligibility.observedMaterialFamilyCount,
      resolved: eligibility.resolvedObservedMaterialFamilyCount,
      partial: eligibility.partialMaterialFamilyCount,
      unobserved: eligibility.unobservedMaterialFamilyCount,
      partialFamilies: eligibility.partialMaterialFamilies,
      unobservedFamilies: eligibility.unobservedMaterialFamilies,
      conditionCount: eligibility.unresolvedMaterialConditions,
      conflictCount: eligibility.unresolvedMaterialConflicts,
      unknownCount: eligibility.unresolvedMaterialUnknowns,
      queue: safeQueue() ?? null,
      calibrationState: fit.calibrationState,
    };
  };
  const beforeMetrics = safeMetrics(oldNormalization, "before");
  const repository = new SourceEnablementRepository(sqlite);
  const derived = repository.rederiveLeverObservation({ verificationId });
  const newNormalization = new R2ARepository(sqlite).getNormalization(derived.derivedJobVersionId);
  if (!newNormalization) throw new Error("R2A_NEW_NORMALIZATION_NOT_FOUND");
  const evaluationId = "rehearsal-r2-after";
  const afterEligibility = evaluateR2Eligibility({
    profile,
    normalization: newNormalization,
    bindings: {
      jobVersionId: derived.derivedJobVersionId,
      currentJobVersionId: derived.derivedJobVersionId,
      profileVersionId: profileVersion.id,
      currentProfileVersionId: profileVersion.id,
      evidenceContractVersion: newNormalization.evidenceContractVersion,
      currentEvidenceContractVersion: newNormalization.evidenceContractVersion,
      evaluationVersionId: evaluationId,
    },
    evaluatedAt: "2026-09-27T14:40:00.000Z",
  });
  const afterFit = scoreR2JobFit({
    profile,
    normalization: newNormalization,
    eligibility: afterEligibility,
    calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
    commute: {
      distanceKm: job.estimatedCommuteKm,
      durationMinutes: job.estimatedCommuteMinutes ?? null,
    },
  });
  const r2 = new R2Repository(sqlite, () => new Date("2026-09-27T14:40:00.000Z"));
  const recorded = r2.recordEvaluation({
    id: evaluationId,
    jobId: jobRow.jobId,
    jobVersionId: derived.derivedJobVersionId,
    profileVersionId: profileVersion.id,
    normalization: newNormalization,
    eligibility: afterEligibility,
    fit: afterFit,
  });
  r2.recordQueueDecision({
    jobId: jobRow.jobId,
    state: "REVIEWING",
    r2EvaluationId: recorded.id,
    duplicateResolutionVersion: r2.duplicateResolutionVersion(jobRow.jobId),
    actor: "SYSTEM",
    reasonCode: "R2A_REDERIVATION_REHEARSAL",
  });
  const afterMetrics = safeMetrics(newNormalization, derived.derivedJobVersionId);
  console.log(
    JSON.stringify({
      verificationId: verification.id,
      parentJobVersionId: verification.jobVersionId,
      oldNormalization: oldNormalization
        ? {
            parserVersion: oldNormalization.parserVersion,
            normalizationVersion: oldNormalization.normalizationVersion,
            evidenceContractVersion: oldNormalization.evidenceContractVersion,
          }
        : null,
      derived,
      newNormalization: newNormalization
        ? {
            parserVersion: newNormalization.parserVersion,
            normalizationVersion: newNormalization.normalizationVersion,
            evidenceContractVersion: newNormalization.evidenceContractVersion,
          }
        : null,
      before: beforeMetrics,
      after: afterMetrics,
      queue: "REVIEWING",
      counts: {
        jobs: sqlite.prepare("SELECT count(*) FROM jobs").pluck().get(),
        jobVersions: sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get(),
        observations: sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
        bindings: sqlite.prepare("SELECT count(*) FROM source_derivation_bindings").pluck().get(),
      },
      health: {
        schema: sqlite.pragma("user_version", { simple: true }),
        integrity: sqlite.pragma("integrity_check", { simple: true }),
        foreignKeys: (sqlite.pragma("foreign_key_check") as unknown[]).length,
      },
    }),
  );
} finally {
  sqlite.close();
}
