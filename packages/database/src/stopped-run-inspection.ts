import { createHash } from "node:crypto";

import {
  CandidateProfileSchema,
  candidateProfileContentHash,
  type CandidateProfile,
} from "@applypilot/candidate-profile";
import {
  evaluateR2Eligibility,
  R2_ELIGIBILITY_ENGINE_VERSION,
  R2_MINIMUM_EXTRACTION_COVERAGE,
} from "@applypilot/eligibility-engine";
import {
  R2_FIT_SCORER_VERSION,
  R2_FIT_WEIGHT_VERSION,
  R2_RECOMMENDATION_THRESHOLD,
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  scoreR2JobFit,
} from "@applypilot/fit-scorer";
import {
  JobSchema,
  R2A_EVIDENCE_CONTRACT_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_PARSER_VERSION,
  R2ANormalizationSchema,
} from "@applypilot/job-model";

import type { PersistedSourceInspection } from "./source-enablement-repository";

export type InspectionDuplicateState =
  | "CLEAR"
  | "SUGGESTED"
  | "LINKED"
  | "REJECTED"
  | "SPLIT"
  | "UNKNOWN";

export interface PersistedSourceInspectionDiagnostic {
  readonly marker: "PAGE_PERSISTED_INSPECTION_ONLY";
  readonly inspectionOnly: true;
  readonly inspectionKind: "CURRENT_R2_ENGINE_DIAGNOSTIC";
  readonly verificationId: string;
  readonly runId: string;
  readonly jobId: string;
  readonly title: string;
  readonly location:
    | "Melbourne, Victoria"
    | "Victoria, Australia"
    | "Australia"
    | "Outside Australia"
    | "Unknown";
  readonly sourceQualificationState: "PAGE_PERSISTED";
  readonly sourceRunStatus: "STOPPED";
  readonly sourceStopCode: "RUN_TIMEOUT";
  readonly providerDriftWarningCount: number;
  readonly parserVersion: string;
  readonly normalizationVersion: string;
  readonly evidenceContractVersion: string;
  readonly eligibilityEngineVersion: string;
  readonly eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED";
  readonly score: number;
  readonly scoreThreshold: number;
  readonly minimumCoverageThreshold: number;
  readonly recommendedByCurrentR2Logic: boolean;
  readonly coveragePercent: number;
  readonly materialFamilyCounts: {
    readonly complete: number;
    readonly partial: number;
    readonly unknown: number;
  };
  readonly scorerVersion: string;
  readonly weightVersion: string;
  readonly positiveContributionCodes: readonly string[];
  readonly positiveContributionCount: number;
  readonly blockerCodes: readonly string[];
  readonly duplicateState: InspectionDuplicateState;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeLocation(
  job: ReturnType<typeof JobSchema.parse>,
): PersistedSourceInspectionDiagnostic["location"] {
  const text =
    `${job.location} ${job.suburb ?? ""} ${job.state ?? ""} ${job.country}`.toLocaleLowerCase(
      "en-AU",
    );
  const state = job.state ?? (/\b(vic|victoria)\b/.test(text) ? "VIC" : null);
  const isAustralia = job.country === "Australia" || Boolean(state);
  if (!isAustralia) return job.country === "Unknown" ? "Unknown" : "Outside Australia";
  if (state === "VIC") {
    return /\bmelbourne\b/.test(text) ? "Melbourne, Victoria" : "Victoria, Australia";
  }
  return "Australia";
}

/**
 * Run the canonical current eligibility and fit logic in memory for an
 * inspection-only reconstruction. It does not accept or return durable R2
 * evaluation/queue evidence and performs no database access.
 */
export function evaluatePersistedSourceInspection(input: {
  inspection: PersistedSourceInspection;
  profile: CandidateProfile;
  profileVersionId: string;
  activeProfileVersionId: string;
  activeProfileContentHash: string;
  duplicateState?: InspectionDuplicateState;
}): PersistedSourceInspectionDiagnostic {
  const profile = CandidateProfileSchema.parse(input.profile);
  const inspection = input.inspection;
  if (
    inspection.marker !== "PAGE_PERSISTED_INSPECTION_ONLY" ||
    inspection.inspectionOnly !== true ||
    inspection.sourceQualificationState !== "PAGE_PERSISTED" ||
    inspection.sourceRunStatus !== "STOPPED" ||
    inspection.sourceStopCode !== "RUN_TIMEOUT"
  ) {
    throw new Error("STOPPED_RUN_INSPECTION_MARKER_REQUIRED");
  }
  if (
    !input.profileVersionId ||
    input.profileVersionId !== input.activeProfileVersionId ||
    candidateProfileContentHash(profile) !== input.activeProfileContentHash
  ) {
    throw new Error("STOPPED_RUN_INSPECTION_ACTIVE_PROFILE_REQUIRED");
  }
  const job = JobSchema.parse(inspection.job);
  const normalization = R2ANormalizationSchema.parse(inspection.normalization);
  if (
    normalization.sourceObservationId !== inspection.sourceObservationId ||
    normalization.parserVersion !== R2A_PARSER_VERSION ||
    normalization.normalizationVersion !== R2A_NORMALIZATION_VERSION ||
    normalization.evidenceContractVersion !== R2A_EVIDENCE_CONTRACT_VERSION
  ) {
    throw new Error("STOPPED_RUN_INSPECTION_CURRENT_NORMALIZATION_REQUIRED");
  }
  const evaluationVersionId = `inspection-r2-${sha256(
    JSON.stringify({
      verificationId: inspection.verificationId,
      jobVersionId: inspection.parentJobVersionId,
      profileVersionId: input.profileVersionId,
      normalization,
    }),
  ).slice(0, 32)}`;
  const eligibility = evaluateR2Eligibility({
    profile,
    normalization,
    bindings: {
      jobVersionId: inspection.parentJobVersionId,
      currentJobVersionId: inspection.parentJobVersionId,
      profileVersionId: input.profileVersionId,
      currentProfileVersionId: input.activeProfileVersionId,
      evidenceContractVersion: normalization.evidenceContractVersion,
      currentEvidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
      evaluationVersionId,
    },
    evaluatedAt: inspection.verifiedAt,
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
  const positiveContributionCodes = fit.contributions
    .filter(({ points }) => points > 0)
    .map(({ code }) => code)
    .sort();
  const blockerCodes = [
    ...eligibility.reasons.filter(({ severity }) => severity === "BLOCKER").map(({ code }) => code),
    ...fit.recommendationBlockers,
  ];
  return {
    marker: "PAGE_PERSISTED_INSPECTION_ONLY",
    inspectionOnly: true,
    inspectionKind: "CURRENT_R2_ENGINE_DIAGNOSTIC",
    verificationId: inspection.verificationId,
    runId: inspection.runId,
    jobId: inspection.jobId,
    title: job.title,
    location: safeLocation(job),
    sourceQualificationState: "PAGE_PERSISTED",
    sourceRunStatus: "STOPPED",
    sourceStopCode: "RUN_TIMEOUT",
    providerDriftWarningCount: inspection.providerDriftWarnings.length,
    parserVersion: normalization.parserVersion,
    normalizationVersion: normalization.normalizationVersion,
    evidenceContractVersion: normalization.evidenceContractVersion,
    eligibilityEngineVersion: R2_ELIGIBILITY_ENGINE_VERSION,
    eligibilityStatus: eligibility.status,
    score: fit.score,
    scoreThreshold: R2_RECOMMENDATION_THRESHOLD,
    minimumCoverageThreshold: R2_MINIMUM_EXTRACTION_COVERAGE,
    recommendedByCurrentR2Logic: fit.recommended,
    coveragePercent: eligibility.coveragePercent,
    materialFamilyCounts: {
      complete: eligibility.resolvedObservedMaterialFamilyCount,
      partial: eligibility.partialMaterialFamilyCount,
      unknown: eligibility.unobservedMaterialFamilyCount,
    },
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
    positiveContributionCodes,
    positiveContributionCount: positiveContributionCodes.length,
    blockerCodes: [...new Set(blockerCodes)].sort(),
    duplicateState: input.duplicateState ?? "UNKNOWN",
  };
}
