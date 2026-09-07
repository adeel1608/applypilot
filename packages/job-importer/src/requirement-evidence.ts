import { createHash } from "node:crypto";

import {
  RequirementEvidenceSchema,
  type RequirementEvidence,
  type RequirementKind,
  type RequirementModality,
} from "@applypilot/job-model";
import { normalizeText } from "@applypilot/shared";

export const REQUIREMENT_EXTRACTOR_VERSION = "2.0.0";

const kindRules: Array<[RequirementKind, RegExp]> = [
  ["WORK_RIGHTS", /\b(work(?:ing)? rights?|right to work|citizen|permanent resident|visa)\b/i],
  ["LEGAL_HOURS", /\b(hours? per fortnight|fortnightly hours?|visa hours?)\b/i],
  [
    "QUALIFICATION",
    /\b(degree|diploma|certificate iv|certificate iii|qualification|bachelor|master)\b/i,
  ],
  [
    "LICENCE",
    /\b(driver'?s? licence|license|forklift|white card|wwcc|working with children|police check)\b/i,
  ],
  ["CERTIFICATION", /\b(certification|certified|rsa|first aid|food safety)\b/i],
  ["VEHICLE", /\b(own vehicle|reliable vehicle|access to (?:a )?car|personal vehicle)\b/i],
  [
    "AVAILABILITY",
    /\b(available|availability|roster|shift|weekend|weekday|night|morning|evening)\b/i,
  ],
  ["LOCATION", /\b(on[ -]?site|remote|hybrid|travel|commute|location)\b/i],
  ["EXPERIENCE", /\b(experience|years? in|background in|previously worked)\b/i],
  ["PHYSICAL", /\b(lift|lifting|stand|standing|physical|manual handling)\b/i],
  ["AGE", /\b(?:aged?|over|under)\s+\d{1,2}\b/i],
  ["DOCUMENT", /\b(resume|cv|cover letter|portfolio|transcript)\b/i],
  ["SKILL", /\b(skill|proficien|knowledge|ability|communication|customer service|software)\b/i],
];

function classifyModality(text: string): {
  modality: RequirementModality;
  condition: string | null;
  certainty: "HIGH" | "MEDIUM" | "LOW";
  ruleId: string;
} {
  if (
    /\b(no|not)\s+(?:\w+\s+){0,3}(required|necessary|essential)|\bwithout the need for\b/i.test(
      text,
    )
  ) {
    return { modality: "NEGATED", condition: null, certainty: "HIGH", ruleId: "REQ_NEGATED_V2" };
  }
  if (/\b(if|when|where|unless|subject to|depending on|or willing to obtain)\b/i.test(text)) {
    const condition =
      text.match(/\b(if|when|where|unless|subject to|depending on)\b[\s\S]*/i)?.[0] ?? text;
    return {
      modality: "CONDITIONAL",
      condition: condition.slice(0, 1000),
      certainty: "HIGH",
      ruleId: "REQ_CONDITIONAL_V2",
    };
  }
  if (
    /\b(preferred|preferably|desirable|advantage(?:ous)?|nice to have|highly regarded)\b/i.test(
      text,
    )
  ) {
    return {
      modality: "PREFERRED",
      condition: null,
      certainty: "HIGH",
      ruleId: "REQ_PREFERRED_V2",
    };
  }
  if (
    /\b(must|mandatory|required|essential|need(?:ed)? to|you will have|successful candidate will)\b/i.test(
      text,
    )
  ) {
    return { modality: "REQUIRED", condition: null, certainty: "HIGH", ruleId: "REQ_REQUIRED_V2" };
  }
  return {
    modality: "UNKNOWN",
    condition: null,
    certainty: "LOW",
    ruleId: "REQ_MODALITY_UNKNOWN_V2",
  };
}

function classifyKind(text: string): RequirementKind {
  return kindRules.find(([, pattern]) => pattern.test(text))?.[0] ?? "GENERAL";
}

function evidenceId(path: string, start: number, text: string): string {
  return createHash("sha256")
    .update(`${REQUIREMENT_EXTRACTOR_VERSION}\n${path}\n${start}\n${text}`)
    .digest("hex")
    .slice(0, 24);
}

function candidates(text: string): Array<{ text: string; start: number; end: number }> {
  const items: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /(?:^|\n)\s*(?:[-*\u2022]\s*)?([^\n]{3,4096})/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const base = (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
    for (const sentence of raw.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
      const value = sentence.trim();
      if (!value) continue;
      const relative = raw.indexOf(sentence);
      items.push({
        text: value,
        start: base + Math.max(0, relative),
        end: base + Math.max(0, relative) + value.length,
      });
    }
  }
  return items;
}

export function extractRequirementEvidence(
  text: string,
  options: { sourcePath?: string; sourceObservationId?: string | null } = {},
): RequirementEvidence[] {
  const sourcePath = options.sourcePath ?? "visibleText";
  return candidates(text)
    .filter(({ text: item }) => {
      const classified = classifyKind(item) !== "GENERAL";
      return (
        classified ||
        /\b(must|required|essential|preferred|desirable|if|unless|not required)\b/i.test(item)
      );
    })
    .map(({ text: originalText, start, end }) => {
      const modality = classifyModality(originalText);
      return RequirementEvidenceSchema.parse({
        id: evidenceId(sourcePath, start, originalText),
        sourceObservationId: options.sourceObservationId ?? null,
        sourcePath,
        start,
        end,
        originalText,
        normalizedProposition: normalizeText(originalText),
        modality: modality.modality,
        kind: classifyKind(originalText),
        condition: modality.condition,
        certainty: modality.certainty,
        ruleId: modality.ruleId,
        extractorVersion: REQUIREMENT_EXTRACTOR_VERSION,
      });
    });
}

export function requirementCoverage(text: string, evidence: RequirementEvidence[]) {
  const materialLines = candidates(text).filter(
    ({ text: item }) => classifyKind(item) !== "GENERAL",
  );
  const known = evidence.filter(({ modality }) => modality !== "UNKNOWN").length;
  const ambiguous = evidence.filter(({ modality }) => modality === "UNKNOWN").length;
  const unknown = Math.max(0, materialLines.length - known);
  const denominator = Math.max(1, known + unknown + ambiguous);
  const percent = Math.round((known / denominator) * 100);
  return {
    known,
    unknown,
    ambiguous,
    percent,
    confidence:
      percent >= 80 ? ("HIGH" as const) : percent >= 50 ? ("MEDIUM" as const) : ("LOW" as const),
  };
}
