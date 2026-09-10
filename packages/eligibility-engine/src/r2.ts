import {
  CandidateProfileSchema,
  isExplicitlyUnsupported,
  type CandidateProfile,
} from "@applypilot/candidate-profile";
import {
  R2ANormalizationSchema,
  R2A_EVIDENCE_CONTRACT_VERSION,
  type JobFieldFamily,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2RequirementEvidence,
} from "@applypilot/job-model";
import { normalizeText, VerificationStatus } from "@applypilot/shared";

import type { EvaluationEvidenceClass } from "./types";

export const R2_ELIGIBILITY_ENGINE_VERSION = "2.0.0";
export const R2_MINIMUM_EXTRACTION_COVERAGE = 60;

export interface R2EvaluationBindings {
  jobVersionId: string;
  currentJobVersionId: string;
  profileVersionId: string;
  currentProfileVersionId: string;
  evidenceContractVersion: string;
  currentEvidenceContractVersion: string;
  evaluationVersionId: string;
}

export interface R2EligibilityInput {
  profile: CandidateProfile;
  normalization: R2ANormalization;
  bindings: R2EvaluationBindings;
  evaluatedAt: string;
}

export type R2EligibilitySeverity = "BLOCKER" | "REVIEW" | "PASS";

export interface R2EligibilityReason {
  code: string;
  severity: R2EligibilitySeverity;
  evidenceClass: EvaluationEvidenceClass;
  jobEvidenceReferences: string[];
  candidateFactReferences: string[];
  safeExplanation: string;
}

export interface R2EligibilityResult {
  status: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED";
  reasons: R2EligibilityReason[];
  engineVersion: string;
  bindings: R2EvaluationBindings;
  coveragePercent: number;
  unresolvedMaterialUnknowns: number;
  unresolvedMaterialConditions: number;
  unresolvedMaterialConflicts: number;
  current: boolean;
  disclaimer: "NOT_LEGAL_ADVICE";
}

const materialCoverageFamilies = new Set<JobFieldFamily>([
  "GEOGRAPHY",
  "HOURS",
  "SCHEDULE",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "LICENCES",
  "CERTIFICATIONS",
  "WORK_RIGHTS",
  "VEHICLE",
]);

function currentUsableState(state: R2JobFieldEvidence["state"]): boolean {
  return state === "SOURCE_STATED" || state === "OWNER_CORRECTED" || state === "DERIVED";
}

function requirementIsMaterial(requirement: R2RequirementEvidence): boolean {
  return requirement.modality === "REQUIRED" || requirement.modality === "CONDITIONAL";
}

function normalizedIncludes(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function verifiedNames(
  values: Array<{ id: string; name: string; verification: string }>,
): Array<{ id: string; name: string }> {
  return values
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .map(({ id, name }) => ({ id, name }));
}

function hasVerifiedMatch(
  candidates: Array<{ id: string; name: string }>,
  required: string,
): { id: string; name: string } | undefined {
  return candidates.find(({ name }) => normalizedIncludes(name, required));
}

function minutes(value: string): number {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
}

function intervalsOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
): boolean {
  const leftFinish =
    minutes(leftEnd) <= minutes(leftStart) ? minutes(leftEnd) + 1440 : minutes(leftEnd);
  const rightFinish =
    minutes(rightEnd) <= minutes(rightStart) ? minutes(rightEnd) + 1440 : minutes(rightEnd);
  return minutes(leftStart) < rightFinish && minutes(rightStart) < leftFinish;
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

function textFromRequirement(requirement: R2RequirementEvidence): string | null {
  const value = requirement.normalizedValue;
  if (value.kind === "TEXT" || value.kind === "PHYSICAL") return value.value;
  if (value.kind === "EXPERIENCE") return value.value.domain;
  if (value.kind === "LICENCE_CERTIFICATION") return value.value.name;
  if (value.kind === "EDUCATION") {
    return [value.value.level, value.value.field, value.value.equivalence]
      .filter(Boolean)
      .join(" ");
  }
  return null;
}

function legalHoursLimitApplicability(
  profile: CandidateProfile,
  evaluatedAt: Date,
): "APPLIES" | "DOES_NOT_APPLY" | "REVIEW_REQUIRED" {
  const basis = profile.workRights.value.hoursLimitTimeBasis;
  if (!basis || basis.verification !== VerificationStatus.VERIFIED || basis.kind === "UNKNOWN") {
    return "REVIEW_REQUIRED";
  }
  if (basis.kind === "CURRENT") return "APPLIES";
  if (basis.kind === "DATE_WINDOW") {
    const currentDate = evaluatedAt.toISOString().slice(0, 10);
    return currentDate >= basis.startDate && currentDate <= basis.endDate
      ? "APPLIES"
      : "DOES_NOT_APPLY";
  }
  if (basis.appliesNow === null) return "REVIEW_REQUIRED";
  return basis.appliesNow ? "APPLIES" : "DOES_NOT_APPLY";
}

export function evaluateR2Eligibility(input: R2EligibilityInput): R2EligibilityResult {
  const profile = CandidateProfileSchema.parse(input.profile);
  const normalization = R2ANormalizationSchema.parse(input.normalization);
  const bindings = input.bindings;
  const evaluatedAt = new Date(input.evaluatedAt);
  if (Number.isNaN(evaluatedAt.valueOf())) throw new Error("R2_EVALUATED_AT_INVALID");

  const reasons: R2EligibilityReason[] = [];
  const reasonKeys = new Set<string>();
  const add = (
    code: string,
    severity: R2EligibilitySeverity,
    evidenceClass: EvaluationEvidenceClass,
    jobEvidenceReferences: string[],
    candidateFactReferences: string[],
    safeExplanation: string,
  ) => {
    const key = `${code}:${[...jobEvidenceReferences].sort().join(",")}`;
    if (reasonKeys.has(key)) return;
    reasonKeys.add(key);
    reasons.push({
      code,
      severity,
      evidenceClass,
      jobEvidenceReferences: [...jobEvidenceReferences].sort(),
      candidateFactReferences: [...candidateFactReferences].sort(),
      safeExplanation,
    });
  };

  const current =
    bindings.jobVersionId === bindings.currentJobVersionId &&
    bindings.profileVersionId === bindings.currentProfileVersionId &&
    bindings.evidenceContractVersion === bindings.currentEvidenceContractVersion &&
    bindings.evidenceContractVersion === R2A_EVIDENCE_CONTRACT_VERSION;
  if (!current) {
    add(
      "R2_EVALUATION_BINDING_STALE",
      "REVIEW",
      "EMPLOYER_REQUIREMENT",
      [],
      [],
      "The evaluation is not bound to every current job, evidence, and profile version.",
    );
  }

  const knownCoverage = normalization.coverage.filter(({ state }) => state !== "UNKNOWN").length;
  const coveragePercent = Math.round((knownCoverage / normalization.coverage.length) * 100);
  if (coveragePercent < R2_MINIMUM_EXTRACTION_COVERAGE) {
    add(
      "R2_EXTRACTION_COVERAGE_INSUFFICIENT",
      "REVIEW",
      "EMPLOYER_REQUIREMENT",
      normalization.coverage.flatMap(({ evidenceIds }) => evidenceIds),
      [],
      "Material extraction coverage is below the approved review threshold.",
    );
  }

  for (const coverage of normalization.coverage) {
    if (coverage.state === "UNKNOWN" && materialCoverageFamilies.has(coverage.family)) {
      add(
        `R2_MATERIAL_${coverage.family}_UNKNOWN`,
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        coverage.evidenceIds,
        [],
        `Material ${coverage.family.toLocaleLowerCase("en-AU").replaceAll("_", " ")} evidence is unknown.`,
      );
    }
  }

  const materialRequirements = normalization.requirementEvidence.filter(requirementIsMaterial);
  for (const requirement of materialRequirements) {
    if (requirement.state === "CONFLICTING") {
      add(
        "R2_MATERIAL_REQUIREMENT_CONFLICT",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        [],
        "A material employer requirement has unresolved conflicting evidence.",
      );
    } else if (requirement.state === "UNKNOWN" || requirement.modality === "UNKNOWN") {
      add(
        "R2_MATERIAL_REQUIREMENT_UNKNOWN",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        [],
        "A material employer requirement is unknown and was not treated as satisfied.",
      );
    } else if (requirement.modality === "CONDITIONAL" || requirement.state === "CONDITIONAL") {
      add(
        "R2_MATERIAL_CONDITION_UNRESOLVED",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        [],
        "A material condition remains unresolved.",
      );
    }
  }

  for (const field of normalization.fieldEvidence) {
    if (field.state === "CONFLICTING" && materialCoverageFamilies.has(field.family)) {
      add(
        "R2_MATERIAL_FIELD_CONFLICT",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [field.id],
        [],
        "A material normalized field has unresolved conflicting evidence.",
      );
    } else if (field.state === "CONDITIONAL" && materialCoverageFamilies.has(field.family)) {
      add(
        "R2_MATERIAL_FIELD_CONDITIONAL",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [field.id],
        [],
        "A material normalized value is conditional and unresolved.",
      );
    }
  }

  const requiredUsable = materialRequirements.filter(
    (requirement) => requirement.modality === "REQUIRED" && currentUsableState(requirement.state),
  );

  for (const requirement of requiredUsable) {
    const value = requirement.normalizedValue;
    if (value.kind !== "WORK_RIGHTS") continue;
    const factRef = ["workRights"];
    if (profile.workRights.verification !== VerificationStatus.VERIFIED) {
      add(
        "R2_CANDIDATE_WORK_RIGHTS_UNVERIFIED",
        "REVIEW",
        "LEGAL_LIMIT",
        [requirement.id],
        factRef,
        "The candidate work-right fact is not currently verified.",
      );
      continue;
    }
    const status = profile.workRights.value.status;
    if (value.value.kind === "UNRESTRICTED_WORK_RIGHTS" && status !== "UNRESTRICTED") {
      add(
        "R2_UNRESTRICTED_WORK_RIGHTS_MISMATCH",
        status === "NONE" || status === "RESTRICTED" ? "BLOCKER" : "REVIEW",
        "LEGAL_LIMIT",
        [requirement.id],
        factRef,
        "The role requires unrestricted work rights; valid or restricted rights are not equivalent.",
      );
    } else if (
      value.value.kind === "VALID_AUSTRALIAN_WORK_RIGHTS" &&
      (status === "NONE" || status === "UNKNOWN")
    ) {
      add(
        status === "NONE" ? "R2_VALID_WORK_RIGHTS_MISMATCH" : "R2_VALID_WORK_RIGHTS_UNKNOWN",
        status === "NONE" ? "BLOCKER" : "REVIEW",
        "LEGAL_LIMIT",
        [requirement.id],
        factRef,
        status === "NONE"
          ? "Verified candidate work rights do not meet the stated requirement."
          : "The stated work-right requirement cannot be resolved from the current candidate fact.",
      );
    } else if (
      [
        "VISA_REQUIREMENT",
        "HOURS_CONDITION",
        "EXPIRY_CONDITION",
        "SPONSORSHIP_AVAILABLE",
        "SPONSORSHIP_NOT_AVAILABLE",
        "UNKNOWN",
      ].includes(value.value.kind)
    ) {
      add(
        "R2_WORK_RIGHT_CONDITION_REVIEW_REQUIRED",
        "REVIEW",
        "LEGAL_LIMIT",
        [requirement.id],
        factRef,
        "A visa, sponsorship, hour, expiry, teaching-period, or other work-right condition needs current date-bound owner review; no legal conclusion was inferred.",
      );
    }
  }

  const hours = normalization.fieldEvidence.filter(
    (field) => currentUsableState(field.state) && field.normalizedValue.kind === "HOURS",
  );
  for (const field of hours) {
    if (field.normalizedValue.kind !== "HOURS") continue;
    const minimum = field.normalizedValue.value.minimum;
    if (minimum === null) continue;
    if (field.normalizedValue.value.unit === "FORTNIGHT") {
      if (
        profile.workRights.verification === VerificationStatus.VERIFIED &&
        profile.workRights.value.maximumHoursPerFortnight !== null &&
        minimum > profile.workRights.value.maximumHoursPerFortnight
      ) {
        const applicability = legalHoursLimitApplicability(profile, evaluatedAt);
        if (applicability === "APPLIES") {
          add(
            "R2_LEGAL_FORTNIGHT_HOURS_MISMATCH",
            "BLOCKER",
            "LEGAL_LIMIT",
            [field.id],
            ["workRights.maximumHoursPerFortnight", "workRights.hoursLimitTimeBasis"],
            "The stated fortnightly minimum exceeds a verified currently applicable fortnightly legal limit.",
          );
        } else if (applicability === "REVIEW_REQUIRED") {
          add(
            "R2_LEGAL_HOURS_TIME_BASIS_REVIEW_REQUIRED",
            "REVIEW",
            "LEGAL_LIMIT",
            [field.id],
            ["workRights.maximumHoursPerFortnight", "workRights.hoursLimitTimeBasis"],
            "The fortnightly limit has no deterministically resolved current period; no legal blocker was inferred.",
          );
        }
      }
      if (
        profile.preferences.maximumHoursPerFortnight.verification === VerificationStatus.VERIFIED &&
        minimum > profile.preferences.maximumHoursPerFortnight.value
      ) {
        add(
          "R2_FORTNIGHT_HOURS_PREFERENCE_MISMATCH",
          "REVIEW",
          "CANDIDATE_PREFERENCE",
          [field.id],
          ["preferences.maximumHoursPerFortnight"],
          "The stated fortnightly minimum exceeds a verified candidate preference.",
        );
      }
    }
    if (
      field.normalizedValue.value.unit === "WEEK" &&
      profile.preferences.maximumHoursPerWeek.verification === VerificationStatus.VERIFIED &&
      minimum > profile.preferences.maximumHoursPerWeek.value
    ) {
      add(
        "R2_WEEK_HOURS_PREFERENCE_MISMATCH",
        "REVIEW",
        "CANDIDATE_PREFERENCE",
        [field.id],
        ["preferences.maximumHoursPerWeek"],
        "The stated weekly minimum exceeds a verified candidate preference; no fortnightly conversion was used.",
      );
    }
  }

  const licences = verifiedNames(profile.licences);
  const certifications = verifiedNames(profile.certifications);
  for (const requirement of requiredUsable) {
    if (requirement.normalizedValue.kind !== "LICENCE_CERTIFICATION") continue;
    const required = requirement.normalizedValue.value;
    const candidates = required.type === "LICENCE" ? licences : certifications;
    const match = hasVerifiedMatch(candidates, required.name);
    if (!match) {
      const unsupported = isExplicitlyUnsupported(profile, required.name);
      add(
        unsupported
          ? `R2_MANDATORY_${required.type}_MISMATCH`
          : `R2_MANDATORY_${required.type}_UNCONFIRMED`,
        unsupported ? "BLOCKER" : "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        [required.type === "LICENCE" ? "licences" : "certifications"],
        unsupported
          ? `A verified deterministic mismatch exists for the mandatory ${required.type.toLocaleLowerCase("en-AU")}.`
          : `The mandatory ${required.type.toLocaleLowerCase("en-AU")} is not verified as currently held.`,
      );
      continue;
    }
    if (required.jurisdiction) {
      const record =
        required.type === "LICENCE"
          ? profile.licences.find(({ id }) => id === match.id)
          : profile.certifications.find(({ id }) => id === match.id);
      if (!record || !("jurisdiction" in record) || !record.jurisdiction) {
        add(
          "R2_LICENCE_JURISDICTION_UNCONFIRMED",
          "REVIEW",
          "EMPLOYER_REQUIREMENT",
          [requirement.id],
          [required.type === "LICENCE" ? `licences.${match.id}` : `certifications.${match.id}`],
          "The required jurisdiction is explicit but the candidate jurisdiction is not verified.",
        );
      } else if (!normalizedIncludes(record.jurisdiction, required.jurisdiction)) {
        add(
          "R2_LICENCE_JURISDICTION_MISMATCH",
          "REVIEW",
          "EMPLOYER_REQUIREMENT",
          [requirement.id],
          [`licences.${match.id}`],
          "An overseas or different-jurisdiction licence was not treated as the stated licence.",
        );
      }
    }
    if (required.validityRequirement) {
      const record =
        required.type === "LICENCE"
          ? profile.licences.find(({ id }) => id === match.id)
          : profile.certifications.find(({ id }) => id === match.id);
      if (!record?.expiresOn) {
        add(
          "R2_CREDENTIAL_EXPIRY_UNCONFIRMED",
          "REVIEW",
          "EMPLOYER_REQUIREMENT",
          [requirement.id],
          [`${required.type === "LICENCE" ? "licences" : "certifications"}.${match.id}`],
          "The source requires current validity but the candidate expiry is unknown.",
        );
      } else if (new Date(`${record.expiresOn}T23:59:59.999Z`) < evaluatedAt) {
        add(
          "R2_CREDENTIAL_EXPIRED",
          "BLOCKER",
          "EMPLOYER_REQUIREMENT",
          [requirement.id],
          [`${required.type === "LICENCE" ? "licences" : "certifications"}.${match.id}`],
          "The verified credential is expired at the bound evaluation time.",
        );
      }
    }
  }

  for (const requirement of requiredUsable) {
    if (requirement.normalizedValue.kind !== "VEHICLE_TRAVEL") continue;
    const kind = requirement.normalizedValue.value.kind;
    if (kind !== "OWN_VEHICLE" && kind !== "VEHICLE_ACCESS") continue;
    if (profile.transport.vehicleAccess.verification !== VerificationStatus.VERIFIED) {
      add(
        "R2_VEHICLE_ACCESS_UNVERIFIED",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        ["transport.vehicleAccess"],
        "Vehicle access is required but the candidate fact is not verified.",
      );
    } else if (!profile.transport.vehicleAccess.value) {
      add(
        "R2_OWN_VEHICLE_MISMATCH",
        "BLOCKER",
        "EMPLOYER_REQUIREMENT",
        [requirement.id],
        ["transport.vehicleAccess"],
        "The source explicitly requires vehicle access and the verified candidate fact is negative.",
      );
    }
  }

  const candidateEvidence = [
    ...verifiedNames(profile.skills),
    ...profile.employment
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .flatMap((role) => [
        { id: `employment.${role.id}.title`, name: role.title },
        ...role.responsibilities.map((name, index) => ({
          id: `employment.${role.id}.responsibilities.${index}`,
          name,
        })),
      ]),
  ];
  const qualifications = profile.education
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .flatMap((item) => [
      { id: `education.${item.id}.qualification`, name: item.qualification },
      { id: `education.${item.id}.field`, name: item.field },
    ]);
  for (const requirement of requiredUsable) {
    const text = textFromRequirement(requirement);
    if (!text) continue;
    const candidates =
      requirement.normalizedValue.kind === "EDUCATION" ? qualifications : candidateEvidence;
    const match = hasVerifiedMatch(candidates, text);
    if (match) continue;
    if (
      !["TEXT", "PHYSICAL", "EXPERIENCE", "EDUCATION"].includes(requirement.normalizedValue.kind)
    ) {
      continue;
    }
    const unsupported = isExplicitlyUnsupported(profile, text);
    add(
      unsupported ? "R2_MANDATORY_CAPABILITY_MISMATCH" : "R2_MANDATORY_CAPABILITY_UNCONFIRMED",
      unsupported ? "BLOCKER" : "REVIEW",
      "EMPLOYER_REQUIREMENT",
      [requirement.id],
      [requirement.normalizedValue.kind === "EDUCATION" ? "education" : "skills", "employment"],
      unsupported
        ? "A deterministic verified mismatch exists for a mandatory employer capability."
        : "A mandatory employer capability is not supported by a current verified candidate fact.",
    );
  }

  const schedules = normalization.fieldEvidence.filter(
    (field) => currentUsableState(field.state) && field.normalizedValue.kind === "SCHEDULE",
  );
  for (const field of schedules) {
    if (field.normalizedValue.kind !== "SCHEDULE") continue;
    const schedule = field.normalizedValue.value;
    if (schedule.rosterType === "UNKNOWN") {
      add(
        "R2_JOB_ROSTER_UNKNOWN",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [field.id],
        ["availability"],
        "The roster is unknown and was not treated as compatible.",
      );
      continue;
    }
    if (
      (schedule.rosterType === "ROTATING" || schedule.rosterType === "ON_CALL") &&
      (!schedule.startTime || !schedule.endTime || schedule.days.length === 0)
    ) {
      add(
        "R2_VARIABLE_SCHEDULE_REVIEW_REQUIRED",
        "REVIEW",
        "EMPLOYER_REQUIREMENT",
        [field.id],
        ["availability"],
        "A rotating or on-call roster lacks a complete explicit interval and needs owner review.",
      );
      continue;
    }
    if (
      !["FIXED", "ROTATING"].includes(schedule.rosterType) ||
      !schedule.startTime ||
      !schedule.endTime ||
      schedule.days.length === 0
    ) {
      continue;
    }
    for (const day of schedule.days) {
      const commitment = profile.availability.fixedCommitments.find(
        (item) =>
          item.verification === VerificationStatus.VERIFIED &&
          item.day === day &&
          intervalsOverlap(schedule.startTime!, schedule.endTime!, item.startTime, item.endTime),
      );
      if (commitment) {
        add(
          "R2_FIXED_SCHEDULE_CONFLICT",
          "BLOCKER",
          "EMPLOYER_REQUIREMENT",
          [field.id],
          [`availability.fixedCommitments.${commitment.id}`],
          "An explicit fixed employer interval conflicts with a verified fixed commitment.",
        );
        continue;
      }
      const availability = profile.availability.recurring.filter(
        (item) => item.verification === VerificationStatus.VERIFIED && item.day === day,
      );
      if (availability.length === 0) {
        add(
          "R2_FIXED_SCHEDULE_AVAILABILITY_UNKNOWN",
          "REVIEW",
          "EMPLOYER_REQUIREMENT",
          [field.id],
          ["availability.recurring"],
          "No verified availability interval covers an explicit fixed employer interval.",
        );
      } else if (
        availability.every(
          (item) =>
            !item.available ||
            !intervalContains(item.startTime, item.endTime, schedule.startTime!, schedule.endTime!),
        )
      ) {
        add(
          "R2_FIXED_SCHEDULE_MISMATCH",
          "BLOCKER",
          "EMPLOYER_REQUIREMENT",
          [field.id],
          ["availability.recurring"],
          "Verified availability does not cover an explicit fixed employer interval.",
        );
      }
    }
  }

  const status = reasons.some(({ severity }) => severity === "BLOCKER")
    ? "INELIGIBLE"
    : reasons.some(({ severity }) => severity === "REVIEW")
      ? "REVIEW_REQUIRED"
      : "ELIGIBLE";
  if (status === "ELIGIBLE") {
    add(
      "R2_NO_MATERIAL_BLOCKERS",
      "PASS",
      "EMPLOYER_REQUIREMENT",
      [],
      [],
      "No deterministic verified blocker or material unresolved review state was found.",
    );
  }

  const unresolvedMaterialUnknowns = reasons.filter(({ code }) => code.includes("UNKNOWN")).length;
  const unresolvedMaterialConditions = reasons.filter(({ code }) =>
    code.includes("CONDITION"),
  ).length;
  const unresolvedMaterialConflicts = reasons.filter(({ code }) =>
    code.includes("CONFLICT"),
  ).length;

  return {
    status,
    reasons,
    engineVersion: R2_ELIGIBILITY_ENGINE_VERSION,
    bindings,
    coveragePercent,
    unresolvedMaterialUnknowns,
    unresolvedMaterialConditions,
    unresolvedMaterialConflicts,
    current,
    disclaimer: "NOT_LEGAL_ADVICE",
  };
}
