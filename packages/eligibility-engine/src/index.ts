import {
  isExplicitlyUnsupported,
  type CandidateProfile,
  verifiedLicenceNames,
  verifiedQualificationNames,
  verifiedSkillNames,
} from "@applypilot/candidate-profile";
import type { EligibilityStatus, Job } from "@applypilot/job-model";
import { normalizeText, VerificationStatus } from "@applypilot/shared";
import type { EvaluationEvidenceClass } from "./types";

export * from "./types";
export * from "./r2";

export const ELIGIBILITY_ENGINE_VERSION = "1.0.0";

export type EligibilitySeverity = "BLOCKER" | "REVIEW" | "PASS";

export interface EligibilityReason {
  code: string;
  severity: EligibilitySeverity;
  message: string;
  jobFields: string[];
  profileFields: string[];
  evidenceClass: EvaluationEvidenceClass;
  evidenceReferences: string[];
}

export interface EligibilityResult {
  status: EligibilityStatus;
  reasons: EligibilityReason[];
  engineVersion: string;
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
  return minutes(leftStart) < minutes(rightEnd) && minutes(rightStart) < minutes(leftEnd);
}

function containsMatch(haystack: readonly string[], needle: string): boolean {
  const normalizedNeedle = normalizeText(needle);
  return haystack.some((item) => {
    const normalizedItem = normalizeText(item);
    return normalizedItem.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedItem);
  });
}

export function evaluateEligibility(job: Job, profile: CandidateProfile): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const add = (
    code: string,
    severity: EligibilitySeverity,
    message: string,
    jobFields: string[],
    profileFields: string[],
    evidenceClass: EvaluationEvidenceClass = "EMPLOYER_REQUIREMENT",
    evidenceReferences: string[] = jobFields,
  ) =>
    reasons.push({
      code,
      severity,
      message,
      jobFields,
      profileFields,
      evidenceClass,
      evidenceReferences,
    });

  if (job.workRightsRequirement === "UNRESTRICTED_AUSTRALIA") {
    if (profile.workRights.verification !== VerificationStatus.VERIFIED) {
      add(
        "WORK_RIGHTS_UNKNOWN",
        "REVIEW",
        "The role requires unrestricted Australian work rights, but the candidate's status is not verified.",
        ["workRightsRequirement"],
        ["workRights"],
      );
    } else if (profile.workRights.value.status !== "UNRESTRICTED") {
      add(
        "UNRESTRICTED_WORK_RIGHTS_REQUIRED",
        "BLOCKER",
        "The role requires unrestricted Australian work rights, which the verified profile does not hold.",
        ["workRightsRequirement"],
        ["workRights"],
      );
    }
  } else if (job.workRightsRequirement === "VALID_AUSTRALIA") {
    if (
      profile.workRights.verification !== VerificationStatus.VERIFIED ||
      profile.workRights.value.status === "UNKNOWN"
    ) {
      add(
        "WORK_RIGHTS_UNKNOWN",
        "REVIEW",
        "Australian work-right eligibility requires confirmation.",
        ["workRightsRequirement"],
        ["workRights"],
      );
    } else if (profile.workRights.value.status === "NONE") {
      add(
        "VALID_WORK_RIGHTS_REQUIRED",
        "BLOCKER",
        "The role requires valid Australian work rights, which the verified profile does not hold.",
        ["workRightsRequirement"],
        ["workRights"],
      );
    }
  } else if (job.workRightsRequirement === "UNKNOWN") {
    add(
      "JOB_WORK_RIGHTS_AMBIGUOUS",
      "REVIEW",
      "The job's work-right requirement is ambiguous.",
      ["workRightsRequirement"],
      ["workRights"],
    );
  }

  const licences = verifiedLicenceNames(profile);
  for (const licence of job.licences.filter(({ mandatory }) => mandatory)) {
    if (containsMatch(licences, licence.name)) continue;
    if (isExplicitlyUnsupported(profile, licence.name)) {
      add(
        "MANDATORY_LICENCE_MISSING",
        "BLOCKER",
        `The mandatory licence “${licence.name}” is explicitly not held.`,
        ["licences"],
        ["licences", "forbiddenClaims"],
      );
    } else {
      add(
        "MANDATORY_LICENCE_UNCONFIRMED",
        "REVIEW",
        `The mandatory licence “${licence.name}” is not verified in the profile.`,
        ["licences"],
        ["licences"],
      );
    }
  }

  const qualifications = verifiedQualificationNames(profile);
  for (const requirement of job.educationRequirements.filter(({ mandatory }) => mandatory)) {
    const matched = requirement.qualificationKeywords.some((keyword) =>
      containsMatch(qualifications, keyword),
    );
    if (matched) continue;
    const explicitAbsence = requirement.qualificationKeywords.some((keyword) =>
      isExplicitlyUnsupported(profile, keyword),
    );
    add(
      explicitAbsence ? "MANDATORY_QUALIFICATION_MISSING" : "MANDATORY_QUALIFICATION_UNCONFIRMED",
      explicitAbsence ? "BLOCKER" : "REVIEW",
      explicitAbsence
        ? `The mandatory qualification “${requirement.description}” is explicitly not held.`
        : `The mandatory qualification “${requirement.description}” is not verified in the profile.`,
      ["educationRequirements"],
      ["education", explicitAbsence ? "forbiddenClaims" : "education"],
    );
  }

  if (job.vehicleRequirement === "REQUIRED") {
    if (profile.transport.vehicleAccess.verification !== VerificationStatus.VERIFIED) {
      add(
        "VEHICLE_ACCESS_UNKNOWN",
        "REVIEW",
        "The role requires a vehicle, but vehicle access is not verified.",
        ["vehicleRequirement"],
        ["transport.vehicleAccess"],
      );
    } else if (!profile.transport.vehicleAccess.value) {
      add(
        "VEHICLE_REQUIRED",
        "BLOCKER",
        "The role requires access to a vehicle, and the verified profile states none is available.",
        ["vehicleRequirement"],
        ["transport.vehicleAccess"],
      );
    }
  } else if (job.vehicleRequirement === "UNKNOWN") {
    add(
      "VEHICLE_REQUIREMENT_AMBIGUOUS",
      "REVIEW",
      "The role's vehicle requirement is unclear.",
      ["vehicleRequirement"],
      ["transport.vehicleAccess"],
    );
  }

  for (const shift of job.schedule.shifts.filter(({ mandatory }) => mandatory)) {
    const conflict = profile.availability.fixedCommitments.find(
      (commitment) =>
        commitment.verification === VerificationStatus.VERIFIED &&
        commitment.day === shift.day &&
        intervalsOverlap(shift.startTime, shift.endTime, commitment.startTime, commitment.endTime),
    );
    if (conflict) {
      add(
        "FIXED_TIMETABLE_CONFLICT",
        "BLOCKER",
        `Mandatory ${shift.day.toLocaleLowerCase("en-AU")} shift conflicts with “${conflict.label}”.`,
        ["schedule.shifts"],
        ["availability.fixedCommitments"],
      );
    }
  }

  const weeklyMinimum = job.hoursPerWeek?.minimum;
  if (
    weeklyMinimum !== null &&
    weeklyMinimum !== undefined &&
    profile.preferences.maximumHoursPerWeek.verification === VerificationStatus.VERIFIED &&
    weeklyMinimum > profile.preferences.maximumHoursPerWeek.value
  ) {
    add(
      "WEEKLY_HOURS_EXCEED_LIMIT",
      "REVIEW",
      "The stated weekly minimum exceeds the candidate's verified weekly preference and needs an explicit preference decision.",
      ["hoursPerWeek"],
      ["preferences.maximumHoursPerWeek"],
      "CANDIDATE_PREFERENCE",
    );
  }

  const fortnightMinimum = job.hoursPerFortnight?.minimum ?? null;
  if (
    fortnightMinimum !== null &&
    profile.workRights.verification === VerificationStatus.VERIFIED &&
    profile.workRights.value.maximumHoursPerFortnight !== null &&
    fortnightMinimum > profile.workRights.value.maximumHoursPerFortnight
  ) {
    add(
      "LEGAL_FORTNIGHTLY_HOURS_LIMIT_EXCEEDED",
      "BLOCKER",
      "The stated fortnightly minimum exceeds the verified current work-right hours limit.",
      ["hoursPerFortnight"],
      ["workRights"],
      "LEGAL_LIMIT",
    );
  }
  if (
    fortnightMinimum !== null &&
    profile.preferences.maximumHoursPerFortnight.verification === VerificationStatus.VERIFIED &&
    fortnightMinimum > profile.preferences.maximumHoursPerFortnight.value
  ) {
    add(
      "CANDIDATE_FORTNIGHTLY_HOURS_PREFERENCE_EXCEEDED",
      "REVIEW",
      "The stated fortnightly minimum exceeds the candidate's verified preference and needs an explicit preference decision.",
      ["hoursPerFortnight"],
      ["preferences.maximumHoursPerFortnight"],
      "CANDIDATE_PREFERENCE",
    );
  }
  if (
    profile.workRights.verification === VerificationStatus.VERIFIED &&
    profile.workRights.value.maximumHoursPerFortnight !== null &&
    fortnightMinimum === null
  ) {
    add(
      "JOB_HOURS_UNKNOWN_FOR_LEGAL_LIMIT",
      "REVIEW",
      "The job does not state fortnightly hours, so the verified legal hours limit cannot be assessed.",
      ["hoursPerFortnight"],
      ["workRights"],
      "LEGAL_LIMIT",
    );
  }

  if (
    job.estimatedCommuteKm !== null &&
    profile.transport.maximumCommuteKm.verification === VerificationStatus.VERIFIED &&
    job.estimatedCommuteKm > profile.transport.maximumCommuteKm.value
  ) {
    add(
      "COMMUTE_EXCEEDS_LIMIT",
      "BLOCKER",
      `Estimated commute of ${job.estimatedCommuteKm} km exceeds the verified ${profile.transport.maximumCommuteKm.value} km limit.`,
      ["estimatedCommuteKm"],
      ["transport.maximumCommuteKm"],
      "CANDIDATE_PREFERENCE",
    );
  }

  if (
    job.estimatedCommuteKm === null &&
    profile.transport.maximumCommuteKm.verification === VerificationStatus.VERIFIED
  ) {
    add(
      "COMMUTE_UNKNOWN",
      "REVIEW",
      "Commute distance is unknown and was not inferred from the location.",
      ["estimatedCommuteKm"],
      ["transport.maximumCommuteKm"],
      "CANDIDATE_PREFERENCE",
    );
  }

  if (
    (job.schedule.rosterType === "VARIABLE" || job.schedule.rosterType === "FLEXIBLE") &&
    job.schedule.shifts.length === 0
  ) {
    add(
      "JOB_ROSTER_UNKNOWN",
      "REVIEW",
      "The role describes a variable or flexible roster without enough shift detail to establish compatibility.",
      ["schedule"],
      ["availability"],
      "EMPLOYER_REQUIREMENT",
    );
  }

  const candidateEvidence = [
    ...verifiedSkillNames(profile),
    ...profile.employment
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .flatMap(({ title, responsibilities }) => [title, ...responsibilities]),
  ];
  for (const requirement of job.experienceRequirements.filter(({ mandatory }) => mandatory)) {
    if (containsMatch(candidateEvidence, requirement.key)) continue;
    if (isExplicitlyUnsupported(profile, requirement.key)) {
      add(
        "MANDATORY_EXPERIENCE_MISSING",
        "BLOCKER",
        `Mandatory experience is explicitly absent: ${requirement.description}`,
        ["experienceRequirements"],
        ["employment", "skills", "unsupportedExperience"],
      );
    } else {
      add(
        "MANDATORY_EXPERIENCE_UNCONFIRMED",
        "REVIEW",
        `Mandatory experience is not verified: ${requirement.description}`,
        ["experienceRequirements"],
        ["employment", "skills"],
      );
    }
  }

  for (const ambiguity of job.ambiguities) {
    add("AMBIGUOUS_REQUIREMENT", "REVIEW", ambiguity, ["ambiguities"], []);
  }

  const status: EligibilityStatus = reasons.some(({ severity }) => severity === "BLOCKER")
    ? "INELIGIBLE"
    : reasons.some(({ severity }) => severity === "REVIEW")
      ? "REVIEW_REQUIRED"
      : "ELIGIBLE";

  if (status === "ELIGIBLE") {
    add("NO_HARD_BLOCKERS", "PASS", "No verified hard eligibility blockers were found.", [], []);
  }

  return { status, reasons, engineVersion: ELIGIBILITY_ENGINE_VERSION };
}
