import {
  isExplicitlyUnsupported,
  type CandidateProfile,
  verifiedLicenceNames,
  verifiedQualificationNames,
  verifiedSkillNames,
} from "@applypilot/candidate-profile";
import type { EligibilityStatus, Job } from "@applypilot/job-model";
import { normalizeText, VerificationStatus } from "@applypilot/shared";

export const ELIGIBILITY_ENGINE_VERSION = "1.0.0";

export type EligibilitySeverity = "BLOCKER" | "REVIEW" | "PASS";

export interface EligibilityReason {
  code: string;
  severity: EligibilitySeverity;
  message: string;
  jobFields: string[];
  profileFields: string[];
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
  ) => reasons.push({ code, severity, message, jobFields, profileFields });

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
      "BLOCKER",
      `The minimum ${weeklyMinimum} hours per week exceeds the verified ${profile.preferences.maximumHoursPerWeek.value}-hour limit.`,
      ["hoursPerWeek"],
      ["preferences.maximumHoursPerWeek"],
    );
  }

  const fortnightMinimum =
    job.hoursPerFortnight?.minimum ??
    (weeklyMinimum === null || weeklyMinimum === undefined ? null : weeklyMinimum * 2);
  const candidateFortnightLimit = Math.min(
    profile.preferences.maximumHoursPerFortnight.value,
    profile.workRights.value.maximumHoursPerFortnight ?? Number.POSITIVE_INFINITY,
  );
  if (
    fortnightMinimum !== null &&
    profile.preferences.maximumHoursPerFortnight.verification === VerificationStatus.VERIFIED &&
    profile.workRights.verification === VerificationStatus.VERIFIED &&
    fortnightMinimum > candidateFortnightLimit
  ) {
    add(
      "FORTNIGHTLY_HOURS_EXCEED_LIMIT",
      "BLOCKER",
      `The minimum ${fortnightMinimum} hours per fortnight exceeds the verified ${candidateFortnightLimit}-hour limit.`,
      ["hoursPerFortnight", "hoursPerWeek"],
      ["preferences.maximumHoursPerFortnight", "workRights"],
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
