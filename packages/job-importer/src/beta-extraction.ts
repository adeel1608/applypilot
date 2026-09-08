import type { Job } from "@applypilot/job-model";

import { extractRequirementEvidence, requirementCoverage } from "./requirement-evidence";

export interface BetaExtractedFields {
  location: {
    suburb: string | null;
    postcode: string | null;
    state: Job["state"];
    country: string;
  };
  salary: Job["salary"];
  hoursPerWeek: Job["hoursPerWeek"];
  hoursPerFortnight: Job["hoursPerFortnight"];
  schedule: Job["schedule"];
  preferredRequirements: string[];
  requiredSkills: string[];
  experienceRequirements: Job["experienceRequirements"];
  educationRequirements: Job["educationRequirements"];
  licences: Job["licences"];
  vehicleRequirement: Job["vehicleRequirement"];
  workRightsRequirement: Job["workRightsRequirement"];
  physicalRequirements: string[];
  trainingProvided: boolean | null;
  documentRequirements: {
    resume: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";
    coverLetter: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";
    other: string[];
  };
  requirementEvidence: ReturnType<typeof extractRequirementEvidence>;
  extractionCoverage: ReturnType<typeof requirementCoverage>;
  warnings: string[];
}

const stateNames: Record<string, Job["state"]> = {
  "australian capital territory": "ACT",
  "new south wales": "NSW",
  "northern territory": "NT",
  queensland: "QLD",
  "south australia": "SA",
  tasmania: "TAS",
  victoria: "VIC",
  "western australia": "WA",
};

function numeric(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function extractRange(text: string, unit: "week" | "fortnight") {
  const pattern = new RegExp(
    `\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|\\u2013|to)?\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:hours?|hrs?)\\s*(?:per|a|/)\\s*${unit}\\b`,
    "i",
  );
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return { minimum: Number(match[1]), maximum: match[2] ? Number(match[2]) : Number(match[1]) };
}

function extractSalary(text: string): Job["salary"] {
  const match = text.match(
    /(?:AUD\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:-|\u2013|to)\s*(?:AUD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:per|a|\/)\s*(hour|week|fortnight|month|year)\b/i,
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    minimum: numeric(match[1]),
    maximum: numeric(match[2]),
    currency: "AUD",
    period: match[3].toUpperCase() as NonNullable<Job["salary"]>["period"],
    text: match[0].trim(),
  };
}

export function normalizeAustralianLocation(
  location: string | null,
): BetaExtractedFields["location"] {
  if (!location) return { suburb: null, postcode: null, state: null, country: "Unknown" };
  const postcode = location.match(/\b(\d{4})\b/)?.[1] ?? null;
  const abbreviation = location.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)?.[1]?.toUpperCase();
  const lower = location.toLowerCase();
  const state =
    (abbreviation as Job["state"] | undefined) ??
    Object.entries(stateNames).find(([name]) => lower.includes(name))?.[1] ??
    null;
  const beforeState = location
    .split(/,|\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b|\b\d{4}\b/i)[0]
    ?.trim();
  return {
    suburb: beforeState && !/remote|australia/i.test(beforeState) ? beforeState : null,
    postcode,
    state,
    country: state || postcode || /australia/i.test(location) ? "Australia" : "Unknown",
  };
}

function documentState(text: string, name: "resume" | "cv" | "cover letter") {
  const escaped = name.replace(" ", "\\s+");
  if (new RegExp(`\\b(?:no|not)\\s+${escaped}\\s+(?:is\\s+)?required\\b`, "i").test(text))
    return "NOT_REQUIRED" as const;
  if (
    new RegExp(
      `\\b(?:attach|upload|include|submit|provide|required)[^\\n.]{0,50}\\b${escaped}\\b|\\b${escaped}\\s+(?:is\\s+)?required\\b`,
      "i",
    ).test(text)
  )
    return "REQUIRED" as const;
  return "UNKNOWN" as const;
}

export function extractBetaJobFields(input: {
  text: string;
  location: string | null;
}): BetaExtractedFields {
  const evidence = extractRequirementEvidence(input.text);
  const required = evidence.filter(({ modality }) => modality === "REQUIRED");
  const preferred = evidence.filter(({ modality }) => modality === "PREFERRED");
  const workRights = evidence.filter(({ kind }) => kind === "WORK_RIGHTS");
  const ownVehicle = evidence.filter(({ kind }) => kind === "VEHICLE");
  const training = /\btraining (?:is )?provided\b/i.test(input.text)
    ? true
    : /\bno training (?:is )?provided\b/i.test(input.text)
      ? false
      : null;
  const resume =
    documentState(input.text, "resume") === "UNKNOWN"
      ? documentState(input.text, "cv")
      : documentState(input.text, "resume");
  const coverLetter = documentState(input.text, "cover letter");
  const warnings: string[] = [];
  if (evidence.length === 0) warnings.push("REQUIREMENT_COVERAGE_UNKNOWN");
  if (workRights.some(({ originalText }) => /\bunrestricted\b/i.test(originalText))) {
    warnings.push("UNRESTRICTED_WORK_RIGHTS_EXPLICIT");
  }
  return {
    location: normalizeAustralianLocation(input.location),
    salary: extractSalary(input.text),
    hoursPerWeek: extractRange(input.text, "week"),
    hoursPerFortnight: extractRange(input.text, "fortnight"),
    schedule: { summary: null, fixed: null, shifts: [] },
    preferredRequirements: preferred.map(({ originalText }) => originalText),
    requiredSkills: required
      .filter(({ kind }) => kind === "SKILL")
      .map(({ normalizedProposition }) => normalizedProposition),
    experienceRequirements: required
      .filter(({ kind }) => kind === "EXPERIENCE")
      .map(({ id, originalText }) => ({
        key: id,
        description: originalText,
        mandatory: true,
        minimumYears:
          Number(originalText.match(/\b(\d+(?:\.\d+)?)\+?\s+years?\b/i)?.[1] ?? NaN) || null,
      })),
    educationRequirements: required
      .filter(({ kind }) => kind === "QUALIFICATION")
      .map(({ originalText }) => ({
        description: originalText,
        mandatory: true,
        qualificationKeywords:
          originalText.match(
            /\b(?:degree|diploma|certificate iv|certificate iii|bachelor|master)\b/gi,
          ) ?? [],
      })),
    licences: required
      .filter(({ kind }) => kind === "LICENCE" || kind === "CERTIFICATION")
      .map(({ originalText }) => ({ name: originalText, mandatory: true })),
    vehicleRequirement: ownVehicle.some(({ modality }) => modality === "REQUIRED")
      ? "REQUIRED"
      : ownVehicle.some(({ modality }) => modality === "NEGATED")
        ? "NOT_REQUIRED"
        : "UNKNOWN",
    workRightsRequirement: workRights.some(
      ({ originalText, modality }) =>
        modality === "REQUIRED" && /\bunrestricted\b/i.test(originalText),
    )
      ? "UNRESTRICTED_AUSTRALIA"
      : workRights.some(({ modality }) => modality === "REQUIRED")
        ? "VALID_AUSTRALIA"
        : workRights.some(({ modality }) => modality === "NEGATED")
          ? "NOT_SPECIFIED"
          : "UNKNOWN",
    physicalRequirements: required
      .filter(({ kind }) => kind === "PHYSICAL")
      .map(({ originalText }) => originalText),
    trainingProvided: training,
    documentRequirements: { resume, coverLetter, other: [] },
    requirementEvidence: evidence,
    extractionCoverage: requirementCoverage(input.text, evidence),
    warnings,
  };
}
