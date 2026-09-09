import { CandidateProfileSchema, isExplicitlyUnsupported } from "@applypilot/candidate-profile";
import {
  R2ANormalizationSchema,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2RequirementEvidence,
} from "@applypilot/job-model";
import {
  R2_MINIMUM_EXTRACTION_COVERAGE,
  type EvaluationEvidenceClass,
  type R2EligibilityResult,
} from "@applypilot/eligibility-engine";
import { clamp, normalizeText, VerificationStatus } from "@applypilot/shared";

export const R2_FIT_SCORER_VERSION = "2.0.0";
export const R2_FIT_WEIGHT_VERSION = "r2-weights-1";
export const R2_RECOMMENDATION_THRESHOLD = 50;

export type R2CalibrationState = "UNCALIBRATED" | "CALIBRATION_PENDING" | "CALIBRATED";

export interface R2FitContribution {
  code: string;
  points: number;
  candidateFactReferences: string[];
  jobEvidenceReferences: string[];
  evidenceClass: EvaluationEvidenceClass;
  scorerVersion: string;
  weightVersion: string;
  safeExplanation: string;
}

export interface R2FitInput {
  profile: unknown;
  normalization: R2ANormalization;
  eligibility: R2EligibilityResult;
  commute?: {
    distanceKm: number | null;
    durationMinutes: number | null;
  };
  recommendationThreshold?: number;
}

export interface R2FitResult {
  score: number;
  contributions: R2FitContribution[];
  scorerVersion: string;
  weightVersion: string;
  calibrationState: R2CalibrationState;
  recommended: boolean;
  recommendationBlockers: string[];
  coveragePercent: number;
}

function usableState(state: R2JobFieldEvidence["state"]): boolean {
  return state === "SOURCE_STATED" || state === "OWNER_CORRECTED" || state === "DERIVED";
}

function matches(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return a.includes(b) || b.includes(a);
}

function minutes(value: string): number {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
}

function intervalContains(
  containerStart: string,
  containerEnd: string,
  intervalStart: string,
  intervalEnd: string,
): boolean {
  const containerFinish =
    minutes(containerEnd) <= minutes(containerStart)
      ? minutes(containerEnd) + 1440
      : minutes(containerEnd);
  const intervalFinish =
    minutes(intervalEnd) <= minutes(intervalStart)
      ? minutes(intervalEnd) + 1440
      : minutes(intervalEnd);
  return minutes(containerStart) <= minutes(intervalStart) && containerFinish >= intervalFinish;
}

function requirementText(evidence: R2RequirementEvidence): string | null {
  const value = evidence.normalizedValue;
  if (value.kind === "TEXT" || value.kind === "PHYSICAL") return value.value;
  if (value.kind === "EXPERIENCE") return value.value.domain;
  if (value.kind === "EDUCATION") {
    return [value.value.level, value.value.field, value.value.equivalence]
      .filter(Boolean)
      .join(" ");
  }
  if (value.kind === "LICENCE_CERTIFICATION") return value.value.name;
  return null;
}

export function scoreR2JobFit(input: R2FitInput): R2FitResult {
  const profile = CandidateProfileSchema.parse(input.profile);
  const normalization = R2ANormalizationSchema.parse(input.normalization);
  const contributions: R2FitContribution[] = [];
  const contributionKeys = new Set<string>();
  const add = (
    code: string,
    points: number,
    candidateFactReferences: string[],
    jobEvidenceReferences: string[],
    evidenceClass: EvaluationEvidenceClass,
    safeExplanation: string,
  ) => {
    if (points > 0 && candidateFactReferences.length === 0) {
      throw new Error("R2_POSITIVE_CONTRIBUTION_REQUIRES_VERIFIED_CANDIDATE_FACT");
    }
    const key = `${code}:${jobEvidenceReferences.join(",")}:${candidateFactReferences.join(",")}`;
    if (contributionKeys.has(key)) return;
    contributionKeys.add(key);
    contributions.push({
      code,
      points,
      candidateFactReferences: [...candidateFactReferences].sort(),
      jobEvidenceReferences: [...jobEvidenceReferences].sort(),
      evidenceClass,
      scorerVersion: R2_FIT_SCORER_VERSION,
      weightVersion: R2_FIT_WEIGHT_VERSION,
      safeExplanation,
    });
  };

  const usableFields = normalization.fieldEvidence.filter(({ state }) => usableState(state));
  const usableRequirements = normalization.requirementEvidence.filter(
    ({ state, modality }) =>
      usableState(state) && modality !== "UNKNOWN" && modality !== "CONDITIONAL",
  );
  const verifiedSkills = profile.skills.filter(
    ({ verification }) => verification === VerificationStatus.VERIFIED,
  );
  const verifiedEmployment = profile.employment.filter(
    ({ verification }) => verification === VerificationStatus.VERIFIED,
  );
  const verifiedEducation = profile.education.filter(
    ({ verification }) => verification === VerificationStatus.VERIFIED,
  );
  const verifiedLicences = profile.licences.filter(
    ({ verification }) => verification === VerificationStatus.VERIFIED,
  );
  const verifiedCertifications = profile.certifications.filter(
    ({ verification }) => verification === VerificationStatus.VERIFIED,
  );

  for (const evidence of usableRequirements) {
    if (evidence.modality === "NEGATED") continue;
    const text = requirementText(evidence);
    if (!text) continue;
    const weight = evidence.modality === "PREFERRED" ? 4 : 7;
    const evidenceClass: EvaluationEvidenceClass = "EMPLOYER_REQUIREMENT";
    if (evidence.normalizedValue.kind === "EDUCATION") {
      const match = verifiedEducation.find(
        ({ qualification, field }) => matches(qualification, text) || matches(field, text),
      );
      if (match) {
        add(
          "R2_EDUCATION_VERIFIED_MATCH",
          weight,
          [`education.${match.id}`],
          [evidence.id],
          evidenceClass,
          "A current verified education fact matches current usable job evidence.",
        );
      } else if (isExplicitlyUnsupported(profile, text)) {
        add(
          "R2_EDUCATION_VERIFIED_MISMATCH",
          -weight,
          ["unsupportedExperience"],
          [evidence.id],
          evidenceClass,
          "A current explicit negative constraint conflicts with the job evidence.",
        );
      }
      continue;
    }
    if (evidence.normalizedValue.kind === "LICENCE_CERTIFICATION") {
      const value = evidence.normalizedValue.value;
      const candidates = value.type === "LICENCE" ? verifiedLicences : verifiedCertifications;
      const match = candidates.find(({ name }) => matches(name, value.name));
      if (match) {
        add(
          `R2_${value.type}_VERIFIED_MATCH`,
          weight,
          [`${value.type === "LICENCE" ? "licences" : "certifications"}.${match.id}`],
          [evidence.id],
          evidenceClass,
          `A current verified ${value.type.toLocaleLowerCase("en-AU")} matches current usable job evidence.`,
        );
      }
      continue;
    }
    const skill = verifiedSkills.find(({ name }) => matches(name, text));
    if (skill) {
      add(
        evidence.modality === "PREFERRED"
          ? "R2_PREFERRED_SKILL_VERIFIED_MATCH"
          : "R2_REQUIRED_SKILL_VERIFIED_MATCH",
        weight,
        [`skills.${skill.id}`],
        [evidence.id],
        evidenceClass,
        "A current verified candidate skill matches current usable job evidence.",
      );
      continue;
    }
    const role = verifiedEmployment.find(
      ({ title, responsibilities }) =>
        matches(title, text) ||
        responsibilities.some((responsibility) => matches(responsibility, text)),
    );
    if (role) {
      add(
        "R2_EXPERIENCE_VERIFIED_MATCH",
        weight,
        [`employment.${role.id}`],
        [evidence.id],
        evidenceClass,
        "A current verified employment fact matches current usable job evidence.",
      );
    } else if (isExplicitlyUnsupported(profile, text)) {
      add(
        "R2_CAPABILITY_VERIFIED_MISMATCH",
        -weight,
        ["unsupportedExperience"],
        [evidence.id],
        evidenceClass,
        "A current explicit negative constraint conflicts with the job evidence.",
      );
    }
  }

  const employmentEvidence = usableFields.find(
    ({ normalizedValue }) => normalizedValue.kind === "EMPLOYMENT_TYPE",
  );
  if (
    employmentEvidence?.normalizedValue.kind === "EMPLOYMENT_TYPE" &&
    employmentEvidence.normalizedValue.value !== "UNKNOWN" &&
    profile.preferences.signalVerification?.preferredWorkTypes === VerificationStatus.VERIFIED
  ) {
    const compatible = profile.preferences.preferredWorkTypes.some(
      (value) => value === employmentEvidence.normalizedValue.value,
    );
    add(
      compatible
        ? "R2_WORK_TYPE_VERIFIED_PREFERENCE_MATCH"
        : "R2_WORK_TYPE_VERIFIED_PREFERENCE_MISMATCH",
      compatible ? 10 : -5,
      ["preferences.signalVerification.preferredWorkTypes"],
      [employmentEvidence.id],
      "CANDIDATE_PREFERENCE",
      compatible
        ? "Current job evidence matches a verified work-type preference."
        : "Current job evidence differs from a verified work-type preference.",
    );
  }

  const locations = usableFields.filter(
    ({ normalizedValue }) => normalizedValue.kind === "LOCATION",
  );
  if (
    profile.preferences.signalVerification?.preferredLocations === VerificationStatus.VERIFIED &&
    locations.length > 0
  ) {
    const matchingLocation = locations.find((evidence) => {
      const normalized = evidence.normalizedValue;
      return (
        normalized.kind === "LOCATION" &&
        profile.preferences.preferredLocations.some((preference) =>
          [
            normalized.value.rawLabel,
            normalized.value.locality,
            normalized.value.suburb,
            normalized.value.stateOrTerritory,
          ]
            .filter((value): value is string => Boolean(value))
            .some((value) => matches(value, preference)),
        )
      );
    });
    if (matchingLocation) {
      add(
        "R2_LOCATION_VERIFIED_PREFERENCE_MATCH",
        10,
        ["preferences.signalVerification.preferredLocations"],
        [matchingLocation.id],
        "CANDIDATE_PREFERENCE",
        "A current location alternative matches a verified candidate preference.",
      );
    }
  }

  if (input.commute?.distanceKm !== null && input.commute?.distanceKm !== undefined) {
    if (profile.transport.maximumCommuteKm.verification === VerificationStatus.VERIFIED) {
      const distanceEvidence = normalization.requirementEvidence.find(
        ({ normalizedValue, state }) =>
          usableState(state) &&
          normalizedValue.kind === "VEHICLE_TRAVEL" &&
          normalizedValue.value.kind === "COMMUTE" &&
          normalizedValue.value.distanceKm !== null,
      );
      if (distanceEvidence) {
        const within = input.commute.distanceKm <= profile.transport.maximumCommuteKm.value;
        add(
          within ? "R2_COMMUTE_DISTANCE_VERIFIED_MATCH" : "R2_COMMUTE_DISTANCE_VERIFIED_MISMATCH",
          within ? 8 : -8,
          ["transport.maximumCommuteKm"],
          [distanceEvidence.id],
          "CANDIDATE_PREFERENCE",
          within
            ? "Verified distance preference and current distance evidence are compatible."
            : "Current distance evidence exceeds a verified distance preference.",
        );
      }
    }
  }
  if (input.commute?.durationMinutes !== null && input.commute?.durationMinutes !== undefined) {
    const maximumMinutes = profile.transport.maximumCommuteMinutes;
    if (maximumMinutes?.verification === VerificationStatus.VERIFIED) {
      const timeEvidence = normalization.requirementEvidence.find(
        ({ normalizedValue, state }) =>
          usableState(state) &&
          normalizedValue.kind === "VEHICLE_TRAVEL" &&
          normalizedValue.value.kind === "COMMUTE" &&
          normalizedValue.value.durationMinutes !== null,
      );
      if (timeEvidence) {
        const within = input.commute.durationMinutes <= maximumMinutes.value;
        add(
          within ? "R2_COMMUTE_TIME_VERIFIED_MATCH" : "R2_COMMUTE_TIME_VERIFIED_MISMATCH",
          within ? 8 : -8,
          ["transport.maximumCommuteMinutes"],
          [timeEvidence.id],
          "CANDIDATE_PREFERENCE",
          within
            ? "Verified time preference and current duration evidence are compatible."
            : "Current duration evidence exceeds a verified time preference; no distance conversion was used.",
        );
      }
    }
  }

  const schedules = usableFields.filter(
    ({ normalizedValue }) => normalizedValue.kind === "SCHEDULE",
  );
  for (const evidence of schedules) {
    if (evidence.normalizedValue.kind !== "SCHEDULE") continue;
    const schedule = evidence.normalizedValue.value;
    if (!schedule.startTime || !schedule.endTime || schedule.days.length === 0) continue;
    const matching = schedule.days.every((day) =>
      profile.availability.recurring.some(
        (item) =>
          item.verification === VerificationStatus.VERIFIED &&
          item.available &&
          item.day === day &&
          intervalContains(item.startTime, item.endTime, schedule.startTime!, schedule.endTime!),
      ),
    );
    if (matching) {
      add(
        "R2_SCHEDULE_VERIFIED_MATCH",
        10,
        ["availability.recurring"],
        [evidence.id],
        "EMPLOYER_REQUIREMENT",
        "Verified recurring availability covers the explicit schedule evidence.",
      );
    }
  }

  if (!input.eligibility.current) contributions.length = 0;

  const score = Math.round(
    clamp(
      contributions.reduce((total, contribution) => total + contribution.points, 0),
      0,
      100,
    ),
  );
  const recommendationBlockers: string[] = [];
  if (input.eligibility.status !== "ELIGIBLE")
    recommendationBlockers.push("ELIGIBILITY_NOT_ELIGIBLE");
  if (!input.eligibility.current) recommendationBlockers.push("EVALUATION_BINDING_STALE");
  if (input.eligibility.unresolvedMaterialUnknowns > 0)
    recommendationBlockers.push("MATERIAL_UNKNOWN");
  if (input.eligibility.unresolvedMaterialConditions > 0)
    recommendationBlockers.push("MATERIAL_CONDITIONAL");
  if (input.eligibility.unresolvedMaterialConflicts > 0)
    recommendationBlockers.push("MATERIAL_CONFLICT");
  if (input.eligibility.coveragePercent < R2_MINIMUM_EXTRACTION_COVERAGE)
    recommendationBlockers.push("EXTRACTION_COVERAGE_INSUFFICIENT");
  const threshold = input.recommendationThreshold ?? R2_RECOMMENDATION_THRESHOLD;
  if (score < threshold) recommendationBlockers.push("SCORE_BELOW_THRESHOLD");

  return {
    score,
    contributions,
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
    calibrationState: "UNCALIBRATED",
    recommended: recommendationBlockers.length === 0,
    recommendationBlockers,
    coveragePercent: input.eligibility.coveragePercent,
  };
}
