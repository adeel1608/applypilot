import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import {
  R2ANormalizationSchema,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2RequirementEvidence,
} from "@applypilot/job-model";
import {
  R2_MINIMUM_EXTRACTION_COVERAGE,
  matchR2Capability,
  r2LiteralSkillOverlap,
  r2FactReference,
  r2SemanticFactKey,
  r2RequirementHasExcludedScope,
  supportsR2CapabilityText,
  isR2ExplicitlyUnsupported as isExplicitlyUnsupported,
  type EvaluationEvidenceClass,
  type R2EligibilityResult,
} from "@applypilot/eligibility-engine";
import { clamp, matchesEvidenceText as matches, VerificationStatus } from "@applypilot/shared";
import { z } from "zod";

import {
  R2CalibrationContextSchema,
  type R2CalibrationContext,
  type R2CalibrationState,
} from "./calibration";

export const R2_FIT_SCORER_VERSION = "2.4.0";
export const R2_FIT_WEIGHT_VERSION = "r2-weights-1";
export const R2_RECOMMENDATION_THRESHOLD = 50;
export const R2_GOLDEN_CORPUS_VERSION = "r2-golden-2";

export const R2FitWeightsSchema = z
  .object({
    version: z.string().min(1).max(100),
    requiredEvidenceMatch: z.number().int(),
    preferredEvidenceMatch: z.number().int(),
    workTypeMatch: z.number().int(),
    workTypeMismatch: z.number().int(),
    locationMatch: z.number().int(),
    commuteMatch: z.number().int(),
    commuteMismatch: z.number().int(),
    scheduleMatch: z.number().int(),
  })
  .strict();

export type R2FitWeights = z.infer<typeof R2FitWeightsSchema>;

export const R2_FIT_WEIGHTS: R2FitWeights = R2FitWeightsSchema.parse({
  version: R2_FIT_WEIGHT_VERSION,
  requiredEvidenceMatch: 7,
  preferredEvidenceMatch: 4,
  workTypeMatch: 10,
  workTypeMismatch: -5,
  locationMatch: 10,
  commuteMatch: 8,
  commuteMismatch: -8,
  scheduleMatch: 10,
});

export const R2_UNREVIEWED_CALIBRATION_CONTEXT: R2CalibrationContext =
  R2CalibrationContextSchema.parse({
    version: "r2-calibration-context-1:unreviewed",
    state: "UNCALIBRATED",
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
    corpusVersion: R2_GOLDEN_CORPUS_VERSION,
    runId: null,
  });

export interface R2FitContribution {
  requirementSupport?: Array<{
    jobEvidenceReference: string;
    scope: "FULL_REQUIREMENT" | "PARTIAL_EVIDENCE";
  }>;
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
  calibrationContext: R2CalibrationContext;
  weights?: R2FitWeights;
  recommendationThreshold?: number;
}

export interface R2FitResult {
  evidenceOpportunity?: {
    current: boolean;
    usableRequirementCount: number;
    fullySupportedRequirementIds: string[];
    partialEvidenceRequirementIds: string[];
    unmatchedUsableRequirementIds: string[];
    excludedRequirementIds: string[];
  };
  score: number;
  contributions: R2FitContribution[];
  scorerVersion: string;
  weightVersion: string;
  calibrationState: R2CalibrationState;
  calibrationContextVersion: string;
  calibrationRunId: string | null;
  recommended: boolean;
  recommendationBlockers: string[];
  coveragePercent: number;
}

function usableState(state: R2JobFieldEvidence["state"]): boolean {
  return state === "SOURCE_STATED" || state === "OWNER_CORRECTED" || state === "DERIVED";
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
  const weights = R2FitWeightsSchema.parse(input.weights ?? R2_FIT_WEIGHTS);
  const calibrationContext = R2CalibrationContextSchema.parse(input.calibrationContext);
  if (
    calibrationContext.scorerVersion !== R2_FIT_SCORER_VERSION ||
    calibrationContext.weightVersion !== weights.version
  ) {
    throw new Error("R2_CALIBRATION_CONTEXT_VERSION_MISMATCH");
  }
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
      weightVersion: weights.version,
      safeExplanation,
    });
  };

  const usableFields = normalization.fieldEvidence.filter(({ state }) => usableState(state));
  const usableRequirements = normalization.requirementEvidence.filter(
    (evidence) => !r2RequirementHasExcludedScope(evidence),
  );
  const capabilityContributions = new Map<string, R2FitContribution>();
  const fullSupport = new Set<string>(),
    partialSupport = new Set<string>();
  const recordSupport = (
    key: string,
    kind: string,
    references: string[],
    evidence: R2RequirementEvidence,
    scope: "FULL_REQUIREMENT" | "PARTIAL_EVIDENCE",
    weight: number,
  ) => {
    const code =
      scope === "PARTIAL_EVIDENCE"
        ? "R2_LITERAL_SKILL_EVIDENCE_OVERLAP"
        : kind === "SKILL"
          ? evidence.modality === "PREFERRED"
            ? "R2_PREFERRED_SKILL_VERIFIED_MATCH"
            : "R2_REQUIRED_SKILL_VERIFIED_MATCH"
          : "R2_" + kind + "_VERIFIED_MATCH";
    let contribution = capabilityContributions.get(key);
    if (!contribution) {
      contribution = {
        code,
        points: weight,
        candidateFactReferences: [],
        jobEvidenceReferences: [],
        requirementSupport: [],
        evidenceClass: "EMPLOYER_REQUIREMENT",
        scorerVersion: R2_FIT_SCORER_VERSION,
        weightVersion: weights.version,
        safeExplanation:
          "Verified literal evidence is linked per source as full support or partial overlap. Partial overlap does not establish the remaining requirement, years or seniority; repeated use of one fact counts once at its strongest weight.",
      };
      capabilityContributions.set(key, contribution);
    }
    contribution.candidateFactReferences = [
      ...new Set([...contribution.candidateFactReferences, ...references]),
    ].sort();
    contribution.jobEvidenceReferences = [
      ...new Set([...contribution.jobEvidenceReferences, evidence.id]),
    ].sort();
    const prior = contribution.requirementSupport!.find(
      (link) => link.jobEvidenceReference === evidence.id,
    );
    if (prior) {
      if (scope === "FULL_REQUIREMENT") prior.scope = scope;
    } else contribution.requirementSupport!.push({ jobEvidenceReference: evidence.id, scope });
    contribution.requirementSupport!.sort((x, y) =>
      x.jobEvidenceReference.localeCompare(y.jobEvidenceReference),
    );
    if (
      weight > contribution.points ||
      (weight === contribution.points && code < contribution.code)
    ) {
      contribution.points = weight;
      contribution.code = code;
    }
    if (scope === "FULL_REQUIREMENT") fullSupport.add(evidence.id);
    else partialSupport.add(evidence.id);
  };

  for (const evidence of usableRequirements) {
    const text = requirementText(evidence);
    if (!text) continue;
    const weight =
      evidence.modality === "PREFERRED"
        ? weights.preferredEvidenceMatch
        : weights.requiredEvidenceMatch;
    if (evidence.normalizedValue.kind === "LICENCE_CERTIFICATION") {
      const value = evidence.normalizedValue.value;
      // A name alone does not prove separate jurisdiction, class or temporal validity.
      if (
        value.condition ||
        value.jurisdiction ||
        value.class ||
        value.validityRequirement ||
        isExplicitlyUnsupported(profile, value.name)
      )
        continue;
      const records = value.type === "LICENCE" ? profile.licences : profile.certifications;
      const matchesByName = records
        .flatMap((record, index) =>
          record.verification === VerificationStatus.VERIFIED &&
          supportsR2CapabilityText(record.name, value.name)
            ? [{ record, index, key: r2SemanticFactKey(value.type, record) }]
            : [],
        )
        .sort((x, y) => x.key.localeCompare(y.key) || x.index - y.index);
      const match = matchesByName[0];
      if (match)
        recordSupport(
          match.key,
          value.type,
          matchesByName
            .filter((m) => m.key === match.key)
            .map((m) =>
              r2FactReference(
                value.type === "LICENCE" ? "licences" : "certifications",
                records,
                m.index,
              ),
            ),
          evidence,
          "FULL_REQUIREMENT",
          weight,
        );
      continue;
    }
    const match = matchR2Capability(profile, evidence);
    if (match) {
      recordSupport(
        match.semanticKey,
        match.kind,
        match.references,
        evidence,
        "FULL_REQUIREMENT",
        weight,
      );
    } else {
      // Preserve at most the old one-fact weight per requirement. Selection is
      // deterministic, never searched against private outcomes or score targets.
      const overlap = r2LiteralSkillOverlap(profile, evidence).sort(
        (x, y) =>
          x.semanticKey.localeCompare(y.semanticKey) || x.reference.localeCompare(y.reference),
      );
      const first = overlap[0];
      if (first)
        recordSupport(
          first.semanticKey,
          "SKILL",
          overlap.filter((f) => f.semanticKey === first.semanticKey).map((f) => f.reference),
          evidence,
          "PARTIAL_EVIDENCE",
          weight,
        );
      if (isExplicitlyUnsupported(profile, text, evidence.normalizedValue.kind === "EXPERIENCE"))
        add(
          evidence.normalizedValue.kind === "EDUCATION"
            ? "R2_EDUCATION_VERIFIED_MISMATCH"
            : "R2_CAPABILITY_VERIFIED_MISMATCH",
          -weight,
          ["unsupportedExperience"],
          [evidence.id],
          "EMPLOYER_REQUIREMENT",
          "An explicit negative constraint conflicts with the full requirement; any separately linked partial evidence does not remove this conflict.",
        );
    }
  }
  contributions.push(
    ...[...capabilityContributions.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([, contribution]) => contribution),
  );

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
      compatible ? weights.workTypeMatch : weights.workTypeMismatch,
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
        weights.locationMatch,
        ["preferences.signalVerification.preferredLocations"],
        [matchingLocation.id],
        "CANDIDATE_PREFERENCE",
        "A current location alternative matches a verified candidate preference.",
      );
    }
  }

  if (input.commute?.distanceKm !== null && input.commute?.distanceKm !== undefined) {
    if (profile.transport.maximumCommuteKm.verification === VerificationStatus.VERIFIED) {
      const distanceEvidence = normalization.fieldEvidence.find(
        ({ canonicalField, normalizedValue, state }) =>
          usableState(state) &&
          canonicalField === "commute.distance" &&
          normalizedValue.kind === "VEHICLE_TRAVEL" &&
          normalizedValue.value.kind === "COMMUTE" &&
          normalizedValue.value.distanceKm !== null,
      );
      if (distanceEvidence) {
        const within = input.commute.distanceKm <= profile.transport.maximumCommuteKm.value;
        add(
          within ? "R2_COMMUTE_DISTANCE_VERIFIED_MATCH" : "R2_COMMUTE_DISTANCE_VERIFIED_MISMATCH",
          within ? weights.commuteMatch : weights.commuteMismatch,
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
      const timeEvidence = normalization.fieldEvidence.find(
        ({ canonicalField, normalizedValue, state }) =>
          usableState(state) &&
          canonicalField === "commute.duration" &&
          normalizedValue.kind === "VEHICLE_TRAVEL" &&
          normalizedValue.value.kind === "COMMUTE" &&
          normalizedValue.value.durationMinutes !== null,
      );
      if (timeEvidence) {
        const within = input.commute.durationMinutes <= maximumMinutes.value;
        add(
          within ? "R2_COMMUTE_TIME_VERIFIED_MATCH" : "R2_COMMUTE_TIME_VERIFIED_MISMATCH",
          within ? weights.commuteMatch : weights.commuteMismatch,
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
        weights.scheduleMatch,
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
  if (input.eligibility.partialMaterialFamilyCount > 0)
    recommendationBlockers.push("MATERIAL_SCOPE_PARTIAL");
  if (input.eligibility.unresolvedMaterialConditions > 0)
    recommendationBlockers.push("MATERIAL_CONDITIONAL");
  if (input.eligibility.unresolvedMaterialConflicts > 0)
    recommendationBlockers.push("MATERIAL_CONFLICT");
  if (input.eligibility.coveragePercent < R2_MINIMUM_EXTRACTION_COVERAGE)
    recommendationBlockers.push("EXTRACTION_COVERAGE_INSUFFICIENT");
  const threshold = input.recommendationThreshold ?? R2_RECOMMENDATION_THRESHOLD;
  if (score < threshold) recommendationBlockers.push("SCORE_BELOW_THRESHOLD");

  return {
    evidenceOpportunity: input.eligibility.current
      ? {
          current: true,
          usableRequirementCount: usableRequirements.length,
          fullySupportedRequirementIds: [...fullSupport].sort(),
          partialEvidenceRequirementIds: [...partialSupport]
            .filter((id) => !fullSupport.has(id))
            .sort(),
          unmatchedUsableRequirementIds: usableRequirements
            .filter((e) => !fullSupport.has(e.id) && !partialSupport.has(e.id))
            .map((e) => e.id)
            .sort(),
          excludedRequirementIds: normalization.requirementEvidence
            .filter((e) => !usableRequirements.includes(e))
            .map((e) => e.id)
            .sort(),
        }
      : {
          current: false,
          usableRequirementCount: 0,
          fullySupportedRequirementIds: [],
          partialEvidenceRequirementIds: [],
          unmatchedUsableRequirementIds: [],
          excludedRequirementIds: normalization.requirementEvidence.map((e) => e.id).sort(),
        },
    score,
    contributions,
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: weights.version,
    calibrationState: calibrationContext.state,
    calibrationContextVersion: calibrationContext.version,
    calibrationRunId: calibrationContext.runId,
    recommended: recommendationBlockers.length === 0,
    recommendationBlockers,
    coveragePercent: input.eligibility.coveragePercent,
  };
}
