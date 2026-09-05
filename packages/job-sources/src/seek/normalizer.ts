import { parseJob, type EmploymentType, type Job } from "@applypilot/job-model";

import { normalizeSeekPostingDate } from "./dates";
import { SeekAdapterError } from "./errors";
import { hashPayload } from "./query";
import { classifyRequirements } from "./requirements";
import {
  SeekRawJobRecordInputSchema,
  SeekRawJobRecordSchema,
  type SeekRawJobRecord,
  type SeekRawJobRecordInput,
} from "./schemas";
import type { NormalizationWarning, RequirementEvidence } from "./types";

const EMPLOYMENT_TYPES: Array<[RegExp, EmploymentType]> = [
  [/\bcasual\b/i, "CASUAL"],
  [/\bpart[ _-]?time\b/i, "PART_TIME"],
  [/\bfull[ _-]?time\b/i, "FULL_TIME"],
  [/\b(?:contract|fixed[ -]?term|temporary)\b/i, "CONTRACT"],
  [/\b(?:intern|internship|graduate placement)\b/i, "INTERNSHIP"],
];

function warning(
  code: NormalizationWarning["code"],
  field: string,
  message: string,
  sourceText: string | null,
): NormalizationWarning {
  return { code, field, message, sourceText };
}

function normalizeEmploymentType(
  text: string | null,
  warnings: NormalizationWarning[],
): EmploymentType {
  if (!text) return "UNKNOWN";
  const match = EMPLOYMENT_TYPES.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  warnings.push(
    warning(
      "UNKNOWN_EMPLOYMENT_TYPE",
      "employmentTypeText",
      "Employment type did not match a supported deterministic mapping",
      text,
    ),
  );
  return "UNKNOWN";
}

function parseMoney(value: string): number {
  return Number(value.replace(/[$,\s]/g, ""));
}

function normalizeSalary(text: string | null, warnings: NormalizationWarning[]): Job["salary"] {
  if (!text) return null;
  const periodMatch = /\b(?:per\s+)?(hour|week|fortnight|month|year|annum)\b/i.exec(text);
  const amountMatches = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)];
  if (!periodMatch || amountMatches.length === 0 || amountMatches.length > 2) {
    warnings.push(
      warning(
        "UNPARSED_SALARY",
        "salaryText",
        "Salary text did not match a supported amount and period form",
        text,
      ),
    );
    return null;
  }
  const periodToken = periodMatch[1].toUpperCase();
  const period = (periodToken === "ANNUM" ? "YEAR" : periodToken) as
    | "HOUR"
    | "WEEK"
    | "FORTNIGHT"
    | "MONTH"
    | "YEAR";
  const amounts = amountMatches.map((match) => parseMoney(match[1]));
  return {
    minimum: amounts[0],
    maximum: amounts[1] ?? amounts[0],
    currency: "AUD",
    period,
    text,
  };
}

function normalizeHours(
  text: string | null,
  warnings: NormalizationWarning[],
): Pick<Job, "hoursPerWeek" | "hoursPerFortnight"> {
  if (!text) return { hoursPerWeek: null, hoursPerFortnight: null };
  const match =
    /\b(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*hours?\s+per\s+(week|fortnight)\b/i.exec(
      text,
    );
  if (!match) {
    warnings.push(
      warning(
        "UNPARSED_HOURS",
        "hoursText",
        "Hours text did not match a supported weekly or fortnightly form",
        text,
      ),
    );
    return { hoursPerWeek: null, hoursPerFortnight: null };
  }
  const range = { minimum: Number(match[1]), maximum: Number(match[2] ?? match[1]) };
  return match[3].toLowerCase() === "week"
    ? { hoursPerWeek: range, hoursPerFortnight: null }
    : { hoursPerWeek: null, hoursPerFortnight: range };
}

function inferLocationParts(record: SeekRawJobRecord, warnings: NormalizationWarning[]) {
  let { suburb, postcode, state } = record.location;
  if ((!suburb || !postcode || !state) && record.location.text) {
    const match = /^(.+?)\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+(\d{4})$/i.exec(record.location.text);
    if (match) {
      suburb ??= match[1].trim();
      state ??= match[2].toUpperCase() as NonNullable<Job["state"]>;
      postcode ??= match[3];
    }
  }
  if (!suburb || !postcode || !state) {
    warnings.push(
      warning(
        "UNKNOWN_LOCATION_PARTS",
        "location",
        "Some structured location parts were not explicitly available",
        record.location.text,
      ),
    );
  }
  return { suburb, postcode, state };
}

function extractMinimumYears(text: string): number | null {
  const match = /\b(\d+(?:\.\d+)?)\+?\s+years?(?:'|’)?\s+(?:of\s+)?experience\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

function qualificationKeywords(text: string): string[] {
  const keywords = ["degree", "diploma", "certificate", "certification", "bachelor", "master"];
  return keywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(text));
}

function hasRule(evidence: RequirementEvidence[], ruleId: string): boolean {
  return evidence.some((item) => item.ruleId === ruleId && !item.negated);
}

export function createSeekRawJobRecord(input: SeekRawJobRecordInput): SeekRawJobRecord {
  const parsed = SeekRawJobRecordInputSchema.parse(input);
  const knownKeys = new Set([...Object.keys(SeekRawJobRecordSchema.shape), "rawPayloadHash"]);
  const capturedUnknownFields = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !knownKeys.has(key)),
  );
  return SeekRawJobRecordSchema.parse({
    ...parsed,
    unknownFields: { ...parsed.unknownFields, ...capturedUnknownFields },
    rawPayloadHash: parsed.rawPayloadHash ?? hashPayload(parsed.rawPayload),
  });
}

export function normalizeSeekJob(input: unknown): Job {
  const record = SeekRawJobRecordSchema.parse(input);
  if (record.status === "REMOVED") {
    throw new SeekAdapterError("JOB_REMOVED", {
      message: "The SEEK job record is marked as removed",
      sourceUrl: record.canonicalUrl,
    });
  }

  const company = record.company ?? record.advertiser;
  const requiredFields: Array<[string, string | null]> = [
    ["title", record.title],
    ["company", company],
    ["location.text", record.location.text],
    ["location.country", record.location.country],
    ["classification", record.classification],
    ["description", record.description],
  ];
  const missing = requiredFields.filter(([, value]) => !value).map(([field]) => field);
  if (missing.length > 0) {
    throw new SeekAdapterError("MALFORMED_RESPONSE", {
      message: `Required normalized fields are missing: ${missing.join(", ")}`,
      sourceUrl: record.canonicalUrl,
    });
  }

  const warnings = [...record.normalizationWarnings];
  const date = normalizeSeekPostingDate(
    record.postingDate,
    record.postingText,
    record.discoveredAt,
  );
  if (date.warning) warnings.push(date.warning);
  const employmentType = normalizeEmploymentType(
    record.employmentTypeText ?? record.workType,
    warnings,
  );
  const location = inferLocationParts(record, warnings);
  const salary = normalizeSalary(record.salaryText, warnings);
  const hours = normalizeHours(record.hoursText, warnings);

  const requirementEvidence = classifyRequirements(record.requirementTexts, "requirementTexts");
  const skillEvidence = classifyRequirements(record.requiredSkills, "requiredSkills");
  const evidence = [...requirementEvidence, ...skillEvidence];
  const allRequirementTexts = [...record.requirementTexts, ...record.requiredSkills];
  if (allRequirementTexts.length === 0) {
    warnings.push(
      warning(
        "MISSING_REQUIREMENTS",
        "requirementTexts",
        "No explicit requirements were supplied by the source",
        null,
      ),
    );
  }
  const explicit = evidence.filter(
    (item) => item.classification === "EXPLICIT_REQUIREMENT" && !item.negated,
  );
  const preferred = evidence.filter(
    (item) => item.classification === "PREFERRED_REQUIREMENT" && !item.negated,
  );
  const ambiguous = evidence.filter(
    (item) => item.classification === "AMBIGUOUS_REQUIREMENT" && !item.negated,
  );
  const experienceRequirements = evidence
    .filter((item) => /\bexperience\b/i.test(item.normalizedText) && !item.negated)
    .map((item, index) => ({
      key: `seek-experience-${index + 1}`,
      description: item.normalizedText,
      mandatory: item.classification === "EXPLICIT_REQUIREMENT",
      minimumYears: extractMinimumYears(item.normalizedText),
    }));
  const educationRequirements = evidence
    .map((item) => ({ item, keywords: qualificationKeywords(item.normalizedText) }))
    .filter(({ item, keywords }) => !item.negated && keywords.length > 0)
    .map(({ item, keywords }) => ({
      description: item.normalizedText,
      mandatory: item.classification === "EXPLICIT_REQUIREMENT",
      qualificationKeywords: keywords,
    }));
  const physicalRequirements = evidence
    .filter(
      (item) =>
        !item.negated &&
        /\b(?:lift(?:ing)?|stand(?:ing)?|physical(?:ly)?|manual handling)\b/i.test(
          item.normalizedText,
        ),
    )
    .map((item) => item.normalizedText);
  const workRightsRequirement = hasRule(evidence, "UNRESTRICTED_WORK_RIGHTS")
    ? "UNRESTRICTED_AUSTRALIA"
    : hasRule(evidence, "VALID_AUSTRALIAN_WORK_RIGHTS")
      ? "VALID_AUSTRALIA"
      : "NOT_SPECIFIED";

  return parseJob({
    id: `seek-${record.externalId}`,
    externalId: record.externalId,
    source: "SEEK",
    sourceUrl: record.canonicalUrl,
    title: record.title,
    company,
    category: record.classification,
    location: record.location.text,
    ...location,
    country: record.location.country,
    estimatedCommuteKm: null,
    employmentType,
    casual: employmentType === "CASUAL",
    partTime: employmentType === "PART_TIME",
    fullTime: employmentType === "FULL_TIME",
    contract: employmentType === "CONTRACT",
    internship: employmentType === "INTERNSHIP",
    salary,
    ...hours,
    schedule: { summary: record.scheduleText, fixed: null, shifts: [] },
    description: record.description,
    responsibilities: record.responsibilities,
    requirements: explicit
      .filter((item) => item.ruleId !== "TRAINING_PROVIDED")
      .map((item) => item.normalizedText),
    preferredRequirements: preferred.map((item) => item.normalizedText),
    requiredSkills: skillEvidence
      .filter((item) => item.classification === "EXPLICIT_REQUIREMENT" && !item.negated)
      .map((item) => item.normalizedText),
    experienceRequirements,
    educationRequirements,
    licences: [
      ...(hasRule(evidence, "DRIVER_LICENCE_REQUIRED")
        ? [{ name: "Driver licence", mandatory: true }]
        : []),
      ...(hasRule(evidence, "WWCC_REQUIRED")
        ? [{ name: "Working with Children Check", mandatory: true }]
        : []),
      ...(hasRule(evidence, "POLICE_CHECK_REQUIRED")
        ? [{ name: "Police check", mandatory: true }]
        : []),
    ],
    vehicleRequirement: hasRule(evidence, "OWN_VEHICLE_REQUIRED") ? "REQUIRED" : "UNKNOWN",
    workRightsRequirement,
    physicalRequirements,
    trainingProvided: hasRule(evidence, "TRAINING_PROVIDED") ? true : null,
    ambiguities: [
      ...ambiguous.map((item) => item.normalizedText),
      ...warnings.map((item) => item.message),
    ],
    datePosted: date.datePosted,
    dateDiscovered: record.discoveredAt,
    dateUpdated: null,
    sourceMetadata: {
      schemaVersion: record.schemaVersion,
      parserVersion: record.parserVersion,
      accessMode: record.accessMode,
      rawPayloadHash: record.rawPayloadHash,
      fetchedAt: record.fetchedAt,
      postingText: record.postingText,
      employmentTypeText: record.employmentTypeText,
      workType: record.workType,
      salaryText: record.salaryText,
      hoursText: record.hoursText,
      scheduleText: record.scheduleText,
      coverLetterRequired: record.coverLetterRequired,
      advertiser: record.advertiser,
      subclassification: record.subclassification,
      provenance: record.provenance,
      requirementEvidence: evidence,
      normalizationWarnings: warnings,
      unknownFields: record.unknownFields,
    },
    eligibilityStatus: null,
    eligibilityReasons: [],
    fitScore: null,
    fitReasons: [],
    applicationStatus: "NEW",
    documentRequirements: {
      resumeRequired: true,
      coverLetterRequired: record.coverLetterRequired === true,
      other: [],
    },
    coverLetterRequired: record.coverLetterRequired === true,
  });
}
