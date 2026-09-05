import {
  type CandidateProfile,
  verifiedQualificationNames,
  verifiedSkillNames,
} from "@applypilot/candidate-profile";
import type { Job } from "@applypilot/job-model";
import { clamp, normalizeText } from "@applypilot/shared";
import type { EligibilityResult } from "@applypilot/eligibility-engine";

export const FIT_SCORER_VERSION = "1.0.0";

export interface FitContribution {
  category: string;
  points: number;
  explanation: string;
}

export interface FitScoreResult {
  score: number;
  positive: string[];
  negative: string[];
  contributions: FitContribution[];
  engineVersion: string;
}

function matchesAny(values: readonly string[], target: string): boolean {
  const normalizedTarget = normalizeText(target);
  return values.some((value) => {
    const normalizedValue = normalizeText(value);
    return normalizedValue.includes(normalizedTarget) || normalizedTarget.includes(normalizedValue);
  });
}

export function scoreJobFit(
  job: Job,
  profile: CandidateProfile,
  eligibility: EligibilityResult,
): FitScoreResult {
  const contributions: FitContribution[] = [];
  const add = (category: string, points: number, explanation: string) =>
    contributions.push({ category, points, explanation });

  if (eligibility.status === "ELIGIBLE") {
    add("eligibility", 10, "No hard eligibility blockers");
  } else if (eligibility.status === "REVIEW_REQUIRED") {
    add("eligibility", -8, "One or more eligibility details require review");
  } else {
    add("eligibility", -35, "Verified eligibility blocker present");
  }

  if (job.suburb && matchesAny(profile.preferences.preferredLocations, job.suburb)) {
    add("location", 8, `${job.suburb} is a preferred location`);
  } else if (
    job.estimatedCommuteKm !== null &&
    job.estimatedCommuteKm <= profile.transport.maximumCommuteKm.value
  ) {
    add("commute", 4, `${job.estimatedCommuteKm} km commute is within the configured limit`);
  } else if (job.estimatedCommuteKm !== null) {
    add("commute", -8, `${job.estimatedCommuteKm} km commute exceeds the configured preference`);
  }

  if (
    job.employmentType !== "UNKNOWN" &&
    profile.preferences.preferredWorkTypes.includes(job.employmentType)
  ) {
    add("employment_type", 8, `${job.employmentType.replaceAll("_", " ")} work is preferred`);
  } else if (job.employmentType !== "UNKNOWN") {
    add("employment_type", -4, `${job.employmentType.replaceAll("_", " ")} work is not preferred`);
  }

  const skills = verifiedSkillNames(profile);
  const matchedSkills = job.requiredSkills.filter((skill) => matchesAny(skills, skill));
  const missingSkills = job.requiredSkills.filter((skill) => !matchesAny(skills, skill));
  if (matchedSkills.length > 0) {
    add(
      "skills",
      Math.min(15, matchedSkills.length * 4),
      `Verified skill match: ${matchedSkills.join(", ")}`,
    );
  }
  if (missingSkills.length > 0) {
    add(
      "skills",
      -Math.min(15, missingSkills.length * 3),
      `No verified match for: ${missingSkills.join(", ")}`,
    );
  }

  const evidence = [
    ...skills,
    ...profile.employment.flatMap(({ title, responsibilities }) => [title, ...responsibilities]),
  ];
  const supportedExperience = job.experienceRequirements.filter((requirement) =>
    matchesAny(evidence, requirement.key),
  );
  const unsupportedExperience = job.experienceRequirements.filter(
    (requirement) => !matchesAny(evidence, requirement.key),
  );
  if (supportedExperience.length > 0) {
    add("experience", 8, "Relevant verified experience evidence is present");
  }
  if (unsupportedExperience.length > 0) {
    add(
      "experience",
      -Math.min(10, unsupportedExperience.length * 4),
      `No direct evidence for ${unsupportedExperience.map(({ key }) => key).join(", ")}`,
    );
  }

  const qualifications = verifiedQualificationNames(profile);
  const educationMatched = job.educationRequirements.some((requirement) =>
    requirement.qualificationKeywords.some((keyword) => matchesAny(qualifications, keyword)),
  );
  if (job.educationRequirements.length > 0) {
    add(
      "education",
      educationMatched ? 8 : -10,
      educationMatched
        ? "Verified education aligns with the role"
        : "Required education is not present in verified qualifications",
    );
  }

  if (job.trainingProvided === true) {
    add("training", 5, "Training is provided");
  }

  if (matchesAny(profile.preferences.preferredCategories, job.category)) {
    add("category", 8, `${job.category} is a preferred category`);
  } else {
    add("category", -3, `${job.category} is outside preferred categories`);
  }

  const customerServiceRelevant = [...job.requiredSkills, job.category, job.title].some((value) =>
    normalizeText(value).includes("customer"),
  );
  if (customerServiceRelevant && matchesAny(skills, "customer service")) {
    add("customer_service", 6, "Verified customer-service capability is relevant");
  }

  const technicalRelevant = [job.category, job.title, ...job.requiredSkills].some((value) =>
    /robot|automation|engineering|technical|programming/.test(normalizeText(value)),
  );
  if (technicalRelevant && skills.some((skill) => /robot|program|automation|cad/i.test(skill))) {
    add("technical", 7, "Verified technical skills are relevant");
  }

  const rawScore = 50 + contributions.reduce((sum, contribution) => sum + contribution.points, 0);
  const score = Math.round(clamp(rawScore, 0, 100));

  return {
    score,
    positive: contributions
      .filter(({ points }) => points > 0)
      .map(({ explanation }) => `+ ${explanation}`),
    negative: contributions
      .filter(({ points }) => points < 0)
      .map(({ explanation }) => `- ${explanation}`),
    contributions,
    engineVersion: FIT_SCORER_VERSION,
  };
}
