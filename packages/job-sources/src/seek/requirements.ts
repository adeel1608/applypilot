import { RequirementEvidenceSchema } from "./schemas";
import type { RequirementEvidence } from "./types";

interface RequirementRule {
  id: string;
  pattern: RegExp;
  classification: RequirementEvidence["classification"];
  negated?: boolean;
}

const RULES: RequirementRule[] = [
  {
    id: "EXPERIENCE_NOT_REQUIRED",
    pattern: /\b(?:experience\s+(?:is\s+)?not\s+required|no\s+experience\s+required)\b/i,
    classification: "EXPLICIT_REQUIREMENT",
    negated: true,
  },
  {
    id: "TRAINING_PROVIDED",
    pattern: /\btraining\s+(?:is\s+)?provided\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "UNRESTRICTED_WORK_RIGHTS",
    pattern: /\bunrestricted\s+(?:australian\s+)?work(?:ing)?\s+rights\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "VALID_AUSTRALIAN_WORK_RIGHTS",
    pattern: /\bvalid\s+australian\s+work(?:ing)?\s+rights\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "DRIVER_LICENCE_REQUIRED",
    pattern: /\bdriver(?:'s)?\s+licen[cs]e\s+(?:is\s+)?required\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "OWN_VEHICLE_REQUIRED",
    pattern:
      /\b(?:own\s+(?:reliable\s+)?vehicle\s+(?:is\s+)?required|required\s+to\s+have\s+(?:your\s+)?own\s+vehicle)\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "WWCC_REQUIRED",
    pattern: /\b(?:WWCC|working\s+with\s+children\s+check)\s+(?:is\s+)?required\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "POLICE_CHECK_REQUIRED",
    pattern: /\bpolice\s+check\s+(?:is\s+)?required\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
  {
    id: "PREFERRED_MARKER",
    pattern: /\b(?:preferred|desirable)\b/i,
    classification: "PREFERRED_REQUIREMENT",
  },
  {
    id: "EXPLICIT_MARKER",
    pattern: /\b(?:must\s+have|required|essential)\b/i,
    classification: "EXPLICIT_REQUIREMENT",
  },
];

export function normalizeRequirementText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "");
}

export function classifyRequirement(originalText: string, sourcePath: string): RequirementEvidence {
  const normalizedText = normalizeRequirementText(originalText);
  const matched = RULES.find((rule) => rule.pattern.test(normalizedText));
  return RequirementEvidenceSchema.parse({
    classification: matched?.classification ?? "AMBIGUOUS_REQUIREMENT",
    originalText,
    normalizedText,
    ruleId: matched?.id ?? "NO_DETERMINISTIC_MARKER",
    sourcePath,
    negated: matched?.negated ?? false,
  });
}

export function classifyRequirements(
  texts: readonly string[],
  sourcePrefix = "requirementTexts",
): RequirementEvidence[] {
  return texts.map((text, index) => classifyRequirement(text, `${sourcePrefix}[${index}]`));
}
