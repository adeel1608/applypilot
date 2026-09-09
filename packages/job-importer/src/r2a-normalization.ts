import { createHash } from "node:crypto";

import {
  JobFieldFamilySchema,
  R2A_EVIDENCE_CONTRACT_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_PARSER_VERSION,
  R2ANormalizationSchema,
  R2JobFieldEvidenceSchema,
  R2RequirementEvidenceSchema,
  assertR2ASourcePointers,
  type JobFieldFamily,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2NormalizedValue,
  type R2RequirementEvidence,
  type RequirementKind,
  type RequirementModality,
  type SourceEvidencePointer,
} from "@applypilot/job-model";

type Span = { text: string; start: number; end: number; sourcePath: string };
type Section = { family: JobFieldFamily | null; heading: string; items: Span[] };

const familyValues = JobFieldFamilySchema.options;
const stateNames: Record<string, "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA"> = {
  "australian capital territory": "ACT",
  "new south wales": "NSW",
  "northern territory": "NT",
  queensland: "QLD",
  "south australia": "SA",
  tasmania: "TAS",
  victoria: "VIC",
  "western australia": "WA",
};
const headingFamilies: Record<string, JobFieldFamily> = {
  requirements: "SKILLS",
  "role requirements": "SKILLS",
  "what you'll need": "SKILLS",
  "what you will need": "SKILLS",
  "about you": "SKILLS",
  skills: "SKILLS",
  qualifications: "EDUCATION",
  experience: "EXPERIENCE",
  responsibilities: "SKILLS",
  "what you'll do": "SKILLS",
  "what you will do": "SKILLS",
  duties: "SKILLS",
  availability: "SCHEDULE",
  roster: "SCHEDULE",
  hours: "HOURS",
  benefits: "COMPENSATION",
  "what we offer": "COMPENSATION",
  "licence / certification": "LICENCES",
  "licence and certification": "LICENCES",
  "work rights": "WORK_RIGHTS",
  documents: "DOCUMENTS",
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pointer(source: string, span: Span): SourceEvidencePointer {
  const excerpt = source.slice(span.start, span.end);
  return {
    sourcePath: span.sourcePath,
    start: span.start,
    end: span.end,
    sourceLength: source.length,
    excerpt,
    excerptHash: digest(excerpt),
  };
}

function lineSpans(source: string): Span[] {
  const result: Span[] = [];
  const pattern = /[^\r\n]+/g;
  for (const match of source.matchAll(pattern)) {
    const whole = match[0];
    const leading = whole.length - whole.trimStart().length;
    const text = whole.trim();
    if (!text) continue;
    const start = (match.index ?? 0) + leading;
    result.push({ text, start, end: start + text.length, sourcePath: "visibleText" });
  }
  return result;
}

function normalizedHeading(text: string): string {
  return text
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isHeading(span: Span): JobFieldFamily | null | undefined {
  const value = normalizedHeading(span.text);
  if (value in headingFamilies) return headingFamilies[value];
  if (/^[A-Za-z][A-Za-z '&/\-]{1,40}:$/.test(span.text)) return null;
  return undefined;
}

export function parseR2ASections(source: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const span of lineSpans(source)) {
    const headingFamily = isHeading(span);
    if (headingFamily !== undefined) {
      current = { family: headingFamily, heading: normalizedHeading(span.text), items: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      const text = span.text.replace(/^[-*•]\s*/, "").trim();
      const offset = span.text.indexOf(text);
      current.items.push({
        text,
        start: span.start + Math.max(0, offset),
        end: span.start + Math.max(0, offset) + text.length,
        sourcePath: `visibleText.sections.${current.heading}`,
      });
    }
  }
  return sections;
}

function textSpan(source: string, value: string, sourcePath: string): Span | null {
  const exact = source.indexOf(value);
  if (exact >= 0) return { text: value, start: exact, end: exact + value.length, sourcePath };
  const lower = source.toLowerCase().indexOf(value.toLowerCase());
  return lower >= 0
    ? {
        text: source.slice(lower, lower + value.length),
        start: lower,
        end: lower + value.length,
        sourcePath,
      }
    : null;
}

function structuredText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function nestedStructured(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const text = structuredText(record[key]);
    if (text) return text;
  }
  return null;
}

function stableId(...values: string[]): string {
  return digest(values.join("\n")).slice(0, 32);
}

function fieldEvidence(input: {
  source: string;
  observationId: string;
  family: JobFieldFamily;
  canonicalField: string;
  span: Span;
  normalizedValue: R2NormalizedValue;
  modality?: RequirementModality | null;
  ruleId: string;
}): R2JobFieldEvidence {
  return R2JobFieldEvidenceSchema.parse({
    id: stableId(
      R2A_PARSER_VERSION,
      input.observationId,
      input.canonicalField,
      String(input.span.start),
      JSON.stringify(input.normalizedValue),
    ),
    sourceObservationId: input.observationId,
    jobVersionId: null,
    family: input.family,
    canonicalField: input.canonicalField,
    state: "SOURCE_STATED",
    modality: input.modality ?? null,
    source: pointer(input.source, input.span),
    normalizedValue: input.normalizedValue,
    extractorVersion: R2A_PARSER_VERSION,
    ruleId: input.ruleId,
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
  });
}

function modality(text: string): { modality: RequirementModality; condition: string | null } {
  if (/\b(desirable|preferred|advantage(?:ous)?)\b[^.\n]{0,80}\bnot essential\b/i.test(text)) {
    return { modality: "PREFERRED", condition: null };
  }
  if (
    /\b(?:no|not)\b[^.\n]{0,40}\b(?:required|necessary|essential)\b|\bwithout the need for\b/i.test(
      text,
    )
  ) {
    return { modality: "NEGATED", condition: null };
  }
  if (
    /\b(?:may be required|where applicable|depending on|subject to|willing to obtain|must (?:be )?obtain(?:ed)? within|if|when|unless)\b/i.test(
      text,
    )
  ) {
    const found = text.match(
      /\b(?:may be required|where applicable|depending on[^.\n]*|subject to[^.\n]*|willing to obtain[^.\n]*|must (?:be )?obtain(?:ed)? within[^.\n]*|if[^.\n]*|when[^.\n]*|unless[^.\n]*)/i,
    )?.[0];
    return { modality: "CONDITIONAL", condition: found?.slice(0, 1000) ?? text.slice(0, 1000) };
  }
  if (
    /\b(?:preferred|preferably|desirable|advantage(?:ous)?|nice to have|highly regarded)\b/i.test(
      text,
    )
  ) {
    return { modality: "PREFERRED", condition: null };
  }
  if (/\b(?:must|required|essential|mandatory|need to|needs to|you will have)\b/i.test(text)) {
    return { modality: "REQUIRED", condition: null };
  }
  return { modality: "UNKNOWN", condition: null };
}

function requirementKind(text: string): RequirementKind {
  if (/\b(?:work rights?|right to work|sponsorship|visa|citizen|permanent resident)\b/i.test(text))
    return "WORK_RIGHTS";
  if (/\b(?:hours? per fortnight|visa hours?)\b/i.test(text)) return "LEGAL_HOURS";
  if (
    /\b(?:degree|diploma|certificate [ivx]+|bachelor|master|qualification|currently studying)\b/i.test(
      text,
    )
  )
    return "QUALIFICATION";
  if (/\b(?:driver'?s? licence|license|forklift licence|white card)\b/i.test(text))
    return "LICENCE";
  if (/\b(?:certification|certified|rsa|first aid|food safety|wwcc|police check)\b/i.test(text))
    return "CERTIFICATION";
  if (/\b(?:own vehicle|access to (?:a )?(?:vehicle|car)|reliable vehicle)\b/i.test(text))
    return "VEHICLE";
  if (/\b(?:availability|roster|shift|overnight|weekend|weekday|on-call)\b/i.test(text))
    return "AVAILABILITY";
  if (/\b(?:on[ -]?site|remote|hybrid|travel|commute|location)\b/i.test(text)) return "LOCATION";
  if (/\b(?:experience|years?|months?|background in)\b/i.test(text)) return "EXPERIENCE";
  if (/\b(?:lift|lifting|stand|standing|physical|manual handling)\b/i.test(text)) return "PHYSICAL";
  if (/\b(?:aged?|over|under)\s+\d{1,2}\b/i.test(text)) return "AGE";
  if (
    /\b(?:resume|cv|cover letter|selection criteria|portfolio|transcript|licence copy|certificate copy)\b/i.test(
      text,
    )
  )
    return "DOCUMENT";
  if (
    /\b(?:skill|proficien|knowledge|ability|communication|customer service|software|programming|embedded|automation|robotics)\b/i.test(
      text,
    )
  )
    return "SKILL";
  return "GENERAL";
}

function familyForKind(kind: RequirementKind): JobFieldFamily {
  const mapping: Partial<Record<RequirementKind, JobFieldFamily>> = {
    WORK_RIGHTS: "WORK_RIGHTS",
    LEGAL_HOURS: "HOURS",
    CANDIDATE_HOURS: "HOURS",
    QUALIFICATION: "EDUCATION",
    LICENCE: "LICENCES",
    CERTIFICATION: "CERTIFICATIONS",
    VEHICLE: "VEHICLE",
    AVAILABILITY: "SCHEDULE",
    LOCATION: "GEOGRAPHY",
    EXPERIENCE: "EXPERIENCE",
    SKILL: "SKILLS",
    PHYSICAL: "PHYSICAL_REQUIREMENTS",
    AGE: "PHYSICAL_REQUIREMENTS",
    DOCUMENT: "DOCUMENTS",
  };
  return mapping[kind] ?? "SKILLS";
}

function experienceValue(text: string): R2NormalizedValue {
  const range = text.match(
    /\b(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(years?|months?)\b/i,
  );
  const minimum = range ?? text.match(/\b(\d+(?:\.\d+)?)\+?\s*(years?|months?)\b/i);
  const noExperience = /\bno experience (?:required|necessary)\b/i.test(text);
  return {
    kind: "EXPERIENCE",
    value: {
      domain: text,
      minimum: noExperience ? 0 : minimum?.[1] ? Number(minimum[1]) : null,
      maximum: range?.[2] ? Number(range[2]) : null,
      unit: /months?/i.test(range?.[3] ?? minimum?.[2] ?? "")
        ? "MONTH"
        : /years?/i.test(range?.[3] ?? minimum?.[2] ?? "")
          ? "YEAR"
          : "UNKNOWN",
      recency: text.match(/\b(?:within|in the last)\s+[^,.]+/i)?.[0] ?? null,
      alternatives: /\bor equivalent\b/i.test(text) ? ["EQUIVALENT"] : [],
      condition: modality(text).condition,
    },
  };
}

function educationValue(text: string): R2NormalizedValue {
  return {
    kind: "EDUCATION",
    value: {
      level: text.match(/\b(?:degree|diploma|certificate [ivx]+|bachelor|master)\b/i)?.[0] ?? null,
      field: text.match(/\b(?:in|of)\s+([A-Za-z][A-Za-z &/-]{2,80})/i)?.[1] ?? null,
      equivalence: /\bor equivalent(?: experience)?\b/i.test(text) ? "OR_EQUIVALENT" : null,
      completionRequired: /\b(?:completed|qualification required|degree required)\b/i.test(text)
        ? true
        : null,
      currentStudyAllowed: /\b(?:currently studying|current students?|students? accepted)\b/i.test(
        text,
      )
        ? true
        : null,
      condition: modality(text).condition,
    },
  };
}

function licenceValue(text: string, type: "LICENCE" | "CERTIFICATION"): R2NormalizedValue {
  return {
    kind: "LICENCE_CERTIFICATION",
    value: {
      name: text,
      type,
      class: text.match(/\b(?:class\s+)?(C|LR|MR|HR|HC|MC)\b/i)?.[1]?.toUpperCase() ?? null,
      jurisdiction:
        text.match(/\b(?:Australian|NSW|VIC|QLD|SA|WA|TAS|NT|ACT|overseas|foreign)\b/i)?.[0] ??
        null,
      validityRequirement:
        text.match(/\b(?:current|valid|unexpired|within \d+ [a-z]+)\b/i)?.[0] ?? null,
      alternatives: /\bor\b/i.test(text)
        ? text
            .split(/\bor\b/i)
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      condition: modality(text).condition,
    },
  };
}

function workRightsValue(text: string): R2NormalizedValue {
  let kind:
    | "VALID_AUSTRALIAN_WORK_RIGHTS"
    | "UNRESTRICTED_WORK_RIGHTS"
    | "SPONSORSHIP_AVAILABLE"
    | "SPONSORSHIP_NOT_AVAILABLE"
    | "VISA_REQUIREMENT"
    | "HOURS_CONDITION"
    | "EXPIRY_CONDITION"
    | "UNKNOWN" = "UNKNOWN";
  if (/\bunrestricted (?:Australian )?work rights\b/i.test(text)) kind = "UNRESTRICTED_WORK_RIGHTS";
  else if (/\bvalid Australian work rights\b/i.test(text)) kind = "VALID_AUSTRALIAN_WORK_RIGHTS";
  else if (/\b(?:sponsorship (?:is )?available|visa sponsorship offered)\b/i.test(text))
    kind = "SPONSORSHIP_AVAILABLE";
  else if (/\b(?:no|not)\s+(?:visa )?sponsorship|sponsorship (?:is )?not available\b/i.test(text))
    kind = "SPONSORSHIP_NOT_AVAILABLE";
  else if (/\bhours?\b/i.test(text)) kind = "HOURS_CONDITION";
  else if (/\bexpir(?:y|es|ation)\b/i.test(text)) kind = "EXPIRY_CONDITION";
  else if (/\bvisa\b/i.test(text)) kind = "VISA_REQUIREMENT";
  return {
    kind: "WORK_RIGHTS",
    value: { kind, wording: text, condition: modality(text).condition },
  };
}

function normalizedRequirementValue(kind: RequirementKind, text: string): R2NormalizedValue {
  if (kind === "EXPERIENCE") return experienceValue(text);
  if (kind === "QUALIFICATION") return educationValue(text);
  if (kind === "LICENCE") return licenceValue(text, "LICENCE");
  if (kind === "CERTIFICATION") return licenceValue(text, "CERTIFICATION");
  if (kind === "WORK_RIGHTS") return workRightsValue(text);
  if (kind === "VEHICLE") {
    return {
      kind: "VEHICLE_TRAVEL",
      value: {
        kind: /access/i.test(text) ? "VEHICLE_ACCESS" : "OWN_VEHICLE",
        percentage: null,
        location: null,
        distanceKm: null,
        durationMinutes: null,
      },
    };
  }
  if (kind === "PHYSICAL" || kind === "AGE") return { kind: "PHYSICAL", value: text };
  return { kind: "TEXT", value: text };
}

function requirementEvidence(
  source: string,
  observationId: string,
  span: Span,
): R2RequirementEvidence | null {
  const kind = requirementKind(span.text);
  const statement = modality(span.text);
  if (kind === "GENERAL" && statement.modality === "UNKNOWN") return null;
  const family = familyForKind(kind);
  return R2RequirementEvidenceSchema.parse({
    id: stableId(R2A_PARSER_VERSION, observationId, span.sourcePath, String(span.start), span.text),
    sourceObservationId: observationId,
    jobVersionId: null,
    family,
    canonicalKind: kind,
    state: statement.modality === "CONDITIONAL" ? "CONDITIONAL" : "SOURCE_STATED",
    modality: statement.modality,
    condition: statement.condition,
    source: pointer(source, span),
    normalizedValue: normalizedRequirementValue(kind, span.text),
    extractorVersion: R2A_PARSER_VERSION,
    ruleId: `R2A_${kind}_${statement.modality}`,
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
  });
}

function parseLocation(label: string) {
  const lower = label.toLowerCase();
  const abbreviation = label.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)?.[1]?.toUpperCase() as
    | keyof typeof postcodeRanges
    | undefined;
  const namedState = Object.entries(stateNames).find(([name]) => lower.includes(name))?.[1];
  const stateOrTerritory = abbreviation ?? namedState ?? null;
  const postcode = label.match(/\b(\d{4})\b/)?.[1] ?? null;
  const workplaceType = /\bremote\b/i.test(label)
    ? "REMOTE"
    : /\bhybrid\b/i.test(label)
      ? "HYBRID"
      : /\bfield[- ]based\b/i.test(label)
        ? "FIELD_BASED"
        : /\bon[- ]site\b/i.test(label)
          ? "ON_SITE"
          : "UNKNOWN";
  const remoteScope = /\b(?:national|anywhere in australia|across australia)\b/i.test(label)
    ? "NATIONAL"
    : stateOrTerritory
      ? "STATE"
      : "UNKNOWN";
  const beforeState =
    label.split(/,|\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b|\b\d{4}\b/i)[0]?.trim() ?? "";
  return {
    rawLabel: label,
    locality: beforeState && !/remote|australia|national/i.test(beforeState) ? beforeState : null,
    suburb: beforeState && !/remote|australia|national/i.test(beforeState) ? beforeState : null,
    stateOrTerritory,
    postcode,
    countryCode:
      stateOrTerritory || postcode || /australia/i.test(label)
        ? ("AU" as const)
        : ("UNKNOWN" as const),
    workplaceType: workplaceType as "REMOTE" | "HYBRID" | "ON_SITE" | "FIELD_BASED" | "UNKNOWN",
    remoteScope: remoteScope as "LOCAL" | "STATE" | "NATIONAL" | "INTERNATIONAL" | "UNKNOWN",
  };
}

const postcodeRanges = {
  ACT: [
    [200, 299],
    [2600, 2618],
    [2900, 2920],
  ],
  NSW: [
    [1000, 2599],
    [2619, 2899],
    [2921, 2999],
  ],
  NT: [[800, 999]],
  QLD: [
    [4000, 4999],
    [9000, 9999],
  ],
  SA: [[5000, 5999]],
  TAS: [[7000, 7999]],
  VIC: [
    [3000, 3999],
    [8000, 8999],
  ],
  WA: [[6000, 6999]],
} as const;

function postcodeState(postcode: string): keyof typeof postcodeRanges | null {
  const value = Number(postcode);
  return (
    (
      Object.entries(postcodeRanges) as Array<
        [keyof typeof postcodeRanges, readonly (readonly [number, number])[]]
      >
    ).find(([, ranges]) =>
      ranges.some(([minimum, maximum]) => value >= minimum && value <= maximum),
    )?.[0] ?? null
  );
}

function employmentValues(
  text: string,
): Array<{ value: R2NormalizedValue; match: string; index: number }> {
  const rules = [
    ["FULL_TIME", /\bfull[ _-]?time\b/gi],
    ["PART_TIME", /\bpart[ _-]?time\b/gi],
    ["CASUAL", /\bcasual\b/gi],
    ["CONTRACT", /\bcontract(?:or)?\b/gi],
    ["TEMPORARY", /\btemporary\b/gi],
    ["FIXED_TERM", /\bfixed[ -]?term\b/gi],
    ["INTERNSHIP", /\bintern(?:ship)?\b/gi],
    ["APPRENTICESHIP", /\bapprentice(?:ship)?\b/gi],
    ["VOLUNTEER", /\bvolunteer\b/gi],
  ] as const;
  const result: Array<{ value: R2NormalizedValue; match: string; index: number }> = [];
  for (const [value, pattern] of rules) {
    for (const match of text.matchAll(pattern)) {
      result.push({
        value: { kind: "EMPLOYMENT_TYPE", value },
        match: match[0],
        index: match.index ?? 0,
      });
    }
  }
  return result;
}

function hoursValues(
  text: string,
): Array<{ value: R2NormalizedValue; match: string; index: number }> {
  const result: Array<{ value: R2NormalizedValue; match: string; index: number }> = [];
  const pattern =
    /\b(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*(day|week|fortnight|month)\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (!match[1] || !match[3]) continue;
    result.push({
      value: {
        kind: "HOURS",
        value: {
          minimum: Number(match[1]),
          maximum: Number(match[2] ?? match[1]),
          unit: match[3].toUpperCase() as "DAY" | "WEEK" | "FORTNIGHT" | "MONTH",
        },
      },
      match: match[0],
      index: match.index ?? 0,
    });
  }
  return result;
}

function salaryValue(text: string): R2NormalizedValue | null {
  if (!/(?:AUD|A\$|\$)\s*\d|\bsalary\b|\bremuneration\b/i.test(text)) return null;
  const numbers = [...text.matchAll(/(?:AUD\s*|A\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((match) =>
    Number(match[1]?.replaceAll(",", "")),
  );
  const shape = /\bfrom\b/i.test(text)
    ? "FROM"
    : /\bup to\b/i.test(text)
      ? "UP_TO"
      : /\b(?:approximately|approx\.?|about)\b/i.test(text)
        ? "APPROXIMATE"
        : numbers.length >= 2 || /\d\s*(?:-|–|to)\s*\d/.test(text)
          ? "RANGE"
          : numbers.length === 1
            ? "EXACT"
            : "UNKNOWN";
  const period = text
    .match(/(?:per|a|\/)\s*(hour|day|week|fortnight|month|year|annum|annual(?:ly)?)/i)?.[1]
    ?.toUpperCase();
  return {
    kind: "SALARY",
    value: {
      shape,
      minimum: numbers[0] ?? null,
      maximum: numbers[1] ?? (shape === "EXACT" ? (numbers[0] ?? null) : null),
      currency: /\bAUD\b|A\$/i.test(text) ? "AUD" : null,
      period:
        period === "ANNUM" || period?.startsWith("ANNUAL")
          ? "YEAR"
          : ((period as "HOUR" | "DAY" | "WEEK" | "FORTNIGHT" | "MONTH" | "YEAR" | undefined) ??
            "UNKNOWN"),
      superannuation: /\bplus super\b/i.test(text)
        ? "PLUS"
        : /\bsuper(?:annuation)? included\b/i.test(text)
          ? "INCLUDED"
          : /\bexcluding super\b/i.test(text)
            ? "EXCLUDED"
            : "UNKNOWN",
      commission: /\bcommission\b/i.test(text),
      bonus: /\bbonus\b/i.test(text),
    },
  };
}

function dateValue(text: string): R2NormalizedValue {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:T[^\s,;]+)?\b/);
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const monthNames: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const named = text.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
  } else if (named?.[1] && named[2] && named[3]) {
    day = Number(named[1]);
    month = monthNames[named[2].toLowerCase()] ?? null;
    year = Number(named[3]);
  }
  if (year === null || month === null || day === null) return { kind: "DATE", value: null };
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const valid =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
  return { kind: "DATE", value: valid ? candidate.toISOString() : null };
}

function scheduleValue(text: string): R2NormalizedValue | null {
  if (
    !/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend|roster|shift|overnight|on-call|flexible)\b/i.test(
      text,
    )
  )
    return null;
  const days = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ].filter((day) => new RegExp(`\\b${day.slice(0, -3)}(?:day)?\\b`, "i").test(text)) as Array<
    "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY"
  >;
  if (/\bweekdays?\b/i.test(text)) {
    for (const day of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const) {
      if (!days.includes(day)) days.push(day);
    }
  }
  if (/\bweekends?\b/i.test(text)) {
    for (const day of ["SATURDAY", "SUNDAY"] as const) {
      if (!days.includes(day)) days.push(day);
    }
  }
  const times = [...text.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/gi)].map(
    (match) => {
      let hour = Number(match[1]);
      if (match[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (match[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
    },
  );
  return {
    kind: "SCHEDULE",
    value: {
      days,
      startTime: times[0] ?? null,
      endTime: times[1] ?? null,
      rosterType: /\brotating\b/i.test(text)
        ? "ROTATING"
        : /\bon-call\b/i.test(text)
          ? "ON_CALL"
          : /\bflexible\b/i.test(text)
            ? "FLEXIBLE"
            : /\bfixed\b/i.test(text)
              ? "FIXED"
              : "UNKNOWN",
      overnight: /\bovernight|night shift\b/i.test(text) ? true : null,
      timezone:
        text.match(/\b(?:AEST|AEDT|ACST|ACDT|AWST|UTC[+-]\d{1,2})\b/i)?.[0]?.toUpperCase() ?? null,
      exceptions: [],
    },
  };
}

function documentValues(text: string): Array<{ field: string; value: R2NormalizedValue }> {
  const documents = [
    ["cvResume", "CV_RESUME", /\b(?:cv|resume)\b/i],
    ["coverLetter", "COVER_LETTER", /\bcover letter\b/i],
    ["selectionCriteria", "SELECTION_CRITERIA", /\bselection criteria\b/i],
    ["portfolio", "PORTFOLIO", /\bportfolio\b/i],
    ["transcript", "TRANSCRIPT", /\btranscript\b/i],
    ["licenceCertificateCopy", "LICENCE_CERTIFICATE_COPY", /\b(?:licence|certificate) copy\b/i],
  ] as const;
  return documents.flatMap(([field, documentKind, pattern]) => {
    if (!pattern.test(text)) return [];
    const state = /\b(?:no|not)\b[^.\n]{0,40}\brequired\b/i.test(text)
      ? "NOT_REQUIRED"
      : /\b(?:attach|upload|include|submit|provide|required|must)\b/i.test(text)
        ? "REQUIRED"
        : "UNKNOWN";
    return [
      { field, value: { kind: "DOCUMENT" as const, value: { documentKind, state, name: null } } },
    ];
  });
}

function vehicleTravelValues(text: string): Array<{
  field: string;
  value: R2NormalizedValue;
}> {
  const values: Array<{ field: string; value: R2NormalizedValue }> = [];
  const duration = text.match(/\bcommut(?:e|ing)\b[^.\n\d]{0,40}(\d+(?:\.\d+)?)\s*minutes?\b/i);
  if (duration?.[1]) {
    values.push({
      field: "commute.duration",
      value: {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: null,
          durationMinutes: Number(duration[1]),
        },
      },
    });
  }
  const distance = text.match(/\bcommut(?:e|ing)\b[^.\n\d]{0,40}(\d+(?:\.\d+)?)\s*km\b/i);
  if (distance?.[1]) {
    values.push({
      field: "commute.distance",
      value: {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: Number(distance[1]),
          durationMinutes: null,
        },
      },
    });
  }
  const travel = text.match(/\btravel\b[^.\n]{0,40}?\b(?:up to\s*)?(\d+(?:\.\d+)?)\s*%/i);
  if (travel?.[1]) {
    values.push({
      field: "travel.percentage",
      value: {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "TRAVEL",
          percentage: Number(travel[1]),
          location: null,
          distanceKm: null,
          durationMinutes: null,
        },
      },
    });
  }
  return values;
}

export function normalizeR2AJobEvidence(input: {
  sourceText: string;
  sourceObservationId: string;
  structured?: Record<string, unknown> | null;
  explicitLocation?: string | null;
}): R2ANormalization {
  const { sourceText: source, sourceObservationId: observationId } = input;
  const structured = input.structured ?? {};
  const fields: R2JobFieldEvidence[] = [];
  const requirements: R2RequirementEvidence[] = [];
  const sections = parseR2ASections(source);
  const standaloneSpans = lineSpans(source)
    .map((span) => {
      const text = span.text.replace(/^[-*â€¢]\s*/, "").trim();
      const offset = span.text.indexOf(text);
      return {
        ...span,
        text,
        start: span.start + Math.max(0, offset),
        end: span.start + Math.max(0, offset) + text.length,
      };
    })
    .filter(({ text }) => text.length <= 1000);
  const candidateSpans = [...sections.flatMap(({ items }) => items), ...standaloneSpans];
  const seenSpans = new Set<string>();
  const uniqueSpans = candidateSpans.filter((span) => {
    const key = `${span.start}:${span.end}`;
    if (seenSpans.has(key)) return false;
    seenSpans.add(key);
    return true;
  });

  const structuredLocation =
    nestedStructured(structured.jobLocation, ["text", "addressLocality"]) ??
    nestedStructured(structured.location, ["text", "addressLocality", "suburb"]) ??
    structuredText(structured.location);
  const structuredFields: Array<[string, JobFieldFamily, string, string | null]> = [
    [
      "title",
      "IDENTITY",
      "title",
      structuredText(structured.title) ?? structuredText(structured.name),
    ],
    [
      "company",
      "IDENTITY",
      "company",
      nestedStructured(structured.hiringOrganization, ["name", "legalName"]) ??
        structuredText(structured.company),
    ],
    ["location", "GEOGRAPHY", "location", structuredLocation],
  ];
  for (const [canonicalField, family, pathName, value] of structuredFields) {
    if (!value) continue;
    const span = textSpan(source, value, `structured.${pathName}`);
    if (!span) continue;
    const normalizedValue: R2NormalizedValue =
      family === "GEOGRAPHY"
        ? { kind: "LOCATION", value: parseLocation(value) }
        : { kind: "TEXT", value };
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family,
        canonicalField,
        span,
        normalizedValue,
        ruleId: "R2A_STRUCTURED_FIELD",
      }),
    );
  }

  for (const [key, canonicalField] of [
    ["datePosted", "dates.posted"],
    ["validThrough", "dates.closing"],
  ] as const) {
    const value = structuredText(structured[key]);
    if (!value) continue;
    const span = textSpan(source, value, `structured.${key}`);
    if (!span) continue;
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family: "DATES",
        canonicalField,
        span,
        normalizedValue: dateValue(value),
        ruleId: "R2A_STRUCTURED_DATE",
      }),
    );
  }

  for (const [key, family, canonicalField, parse] of [
    ["salaryText", "COMPENSATION", "salary", salaryValue],
    [
      "hoursText",
      "HOURS",
      "hours.structured",
      (text: string) => hoursValues(text)[0]?.value ?? null,
    ],
  ] as const) {
    const value = structuredText(structured[key]);
    if (!value) continue;
    const normalizedValue = parse(value);
    const span = textSpan(source, value, `structured.${key}`);
    if (!normalizedValue || !span) continue;
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family,
        canonicalField,
        span,
        normalizedValue,
        ruleId: `R2A_STRUCTURED_${family}`,
      }),
    );
  }
  const structuredRequirements = Array.isArray(structured.requirementTexts)
    ? structured.requirementTexts
    : Array.isArray(structured.requirements)
      ? structured.requirements
      : [];
  for (const [index, item] of structuredRequirements.entries()) {
    const value = structuredText(item);
    if (!value) continue;
    const span = textSpan(source, value, `structured.requirements.${index}`);
    if (span) uniqueSpans.push(span);
  }

  for (const span of lineSpans(source)) {
    const labelled = span.text.match(
      /^\s*(title|job title|role|company|employer|organisation|organization)\s*:\s*(.+)$/i,
    );
    if (!labelled?.[1] || !labelled[2]) continue;
    const canonicalField = /company|employer|organisation|organization/i.test(labelled[1])
      ? "company"
      : "title";
    const value = labelled[2].trim();
    const valueOffset = span.text.indexOf(value);
    const valueSpan = {
      ...span,
      text: value,
      start: span.start + valueOffset,
      end: span.start + valueOffset + value.length,
    };
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family: "IDENTITY",
        canonicalField,
        span: valueSpan,
        normalizedValue: { kind: "TEXT", value },
        ruleId: "R2A_LABELLED_IDENTITY",
      }),
    );
  }

  const locationSources = [
    ...(structuredLocation ? [{ value: structuredLocation, path: "structured.location" }] : []),
    ...(input.explicitLocation && input.explicitLocation !== structuredLocation
      ? [{ value: input.explicitLocation, path: "visibleText.location" }]
      : []),
  ];
  for (const locationSource of locationSources) {
    const baseSpan = textSpan(source, locationSource.value, locationSource.path);
    for (const alternative of locationSource.value
      .split(/\s+(?:or)\s+|\s*;\s*/i)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const span = textSpan(source, alternative, baseSpan?.sourcePath ?? "visibleText.location");
      if (!span) continue;
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "GEOGRAPHY",
          canonicalField: "location.alternative",
          span,
          normalizedValue: { kind: "LOCATION", value: parseLocation(alternative) },
          ruleId: "R2A_AU_LOCATION",
        }),
      );
    }
  }

  const employmentCandidates: Span[] = [];
  const structuredEmployment =
    structuredText(structured.employmentType) ?? structuredText(structured.employmentTypeText);
  if (structuredEmployment) {
    const span = textSpan(source, structuredEmployment, "structured.employmentType");
    if (span) employmentCandidates.push(span);
  }
  for (const span of uniqueSpans) {
    if (
      /^(?:employment type|work type|job type)\s*:/i.test(span.text) ||
      /\b(?:this|the)\s+(?:role|position|job)\s+(?:is|offers?)\b/i.test(span.text)
    )
      employmentCandidates.push(span);
  }
  for (const span of employmentCandidates) {
    for (const item of employmentValues(span.text)) {
      const itemSpan = {
        ...span,
        text: item.match,
        start: span.start + item.index,
        end: span.start + item.index + item.match.length,
      };
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "EMPLOYMENT",
          canonicalField: "employment.type",
          span: itemSpan,
          normalizedValue: item.value,
          ruleId: span.sourcePath.startsWith("structured")
            ? "R2A_STRUCTURED_EMPLOYMENT"
            : "R2A_SCOPED_EMPLOYMENT",
        }),
      );
    }
  }

  for (const span of uniqueSpans) {
    const labelledDate = span.text.match(
      /^(closing date|applications? close|valid through|start date|date posted|posted)\s*:?\s*(.+)$/i,
    );
    if (labelledDate?.[1] && labelledDate[2]) {
      const label = labelledDate[1].toLowerCase();
      const canonicalField = /closing|close|valid/.test(label)
        ? "dates.closing"
        : /start/.test(label)
          ? "dates.start"
          : "dates.posted";
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "DATES",
          canonicalField,
          span,
          normalizedValue: dateValue(labelledDate[2]),
          ruleId: "R2A_LABELLED_DATE",
        }),
      );
    }
    for (const item of hoursValues(span.text)) {
      const itemSpan = {
        ...span,
        text: item.match,
        start: span.start + item.index,
        end: span.start + item.index + item.match.length,
      };
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "HOURS",
          canonicalField: `hours.${item.value.kind === "HOURS" ? item.value.value.unit.toLowerCase() : "unknown"}`,
          span: itemSpan,
          normalizedValue: item.value,
          ruleId: "R2A_HOURS_UNIT",
        }),
      );
    }
    const salary = salaryValue(span.text);
    if (salary)
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "COMPENSATION",
          canonicalField: "salary",
          span,
          normalizedValue: salary,
          ruleId: "R2A_SALARY",
        }),
      );
    const schedule = scheduleValue(span.text);
    if (schedule)
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "SCHEDULE",
          canonicalField: "schedule",
          span,
          normalizedValue: schedule,
          ruleId: "R2A_SCHEDULE",
        }),
      );
    for (const document of documentValues(span.text)) {
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "DOCUMENTS",
          canonicalField: `documents.${document.field}`,
          span,
          normalizedValue: document.value,
          ruleId: "R2A_DOCUMENT_TRI_STATE",
        }),
      );
    }
    for (const vehicleTravel of vehicleTravelValues(span.text)) {
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "VEHICLE",
          canonicalField: vehicleTravel.field,
          span,
          normalizedValue: vehicleTravel.value,
          ruleId: "R2A_VEHICLE_TRAVEL_DISTINCT",
        }),
      );
    }
    if (/\bno training (?:is )?provided\b/i.test(span.text))
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "TRAINING",
          canonicalField: "training",
          span,
          normalizedValue: { kind: "TRAINING", value: { state: "NOT_PROVIDED", name: null } },
          ruleId: "R2A_TRAINING_NOT_PROVIDED",
        }),
      );
    else if (/\btraining (?:is )?provided\b/i.test(span.text))
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "TRAINING",
          canonicalField: "training",
          span,
          normalizedValue: { kind: "TRAINING", value: { state: "PROVIDED", name: null } },
          ruleId: "R2A_TRAINING_PROVIDED",
        }),
      );
    else if (/\btraining (?:is )?(?:required|mandatory)\b/i.test(span.text))
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "TRAINING",
          canonicalField: "training",
          span,
          normalizedValue: { kind: "TRAINING", value: { state: "REQUIRED", name: null } },
          ruleId: "R2A_TRAINING_REQUIRED",
        }),
      );
    else if (/\btraining (?:is )?available\b/i.test(span.text))
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "TRAINING",
          canonicalField: "training",
          span,
          normalizedValue: { kind: "TRAINING", value: { state: "AVAILABLE", name: null } },
          ruleId: "R2A_TRAINING_AVAILABLE",
        }),
      );

    const evidence = requirementEvidence(source, observationId, span);
    if (evidence) requirements.push(evidence);
  }

  const conflicts: R2ANormalization["conflicts"] = [];
  const byField = new Map<string, R2JobFieldEvidence[]>();
  for (const item of fields) {
    const existing = byField.get(item.canonicalField) ?? [];
    existing.push(item);
    byField.set(item.canonicalField, existing);
  }
  const conflictingIds = new Map<string, string>();
  for (const [canonicalField, evidence] of byField) {
    const distinct = new Set(
      evidence.map(({ normalizedValue }) => JSON.stringify(normalizedValue)),
    );
    let materialConflict =
      distinct.size > 1 &&
      [
        "employment.type",
        "salary",
        "location.alternative",
        "dates.closing",
        "dates.start",
        "dates.posted",
      ].includes(canonicalField);
    if (canonicalField === "location.alternative") {
      const postcodeConflict = evidence.some(({ normalizedValue }) => {
        if (normalizedValue.kind !== "LOCATION") return false;
        const { postcode, stateOrTerritory } = normalizedValue.value;
        return Boolean(
          postcode &&
            stateOrTerritory &&
            postcodeState(postcode) &&
            postcodeState(postcode) !== stateOrTerritory,
        );
      });
      const structuredProseConflict =
        distinct.size > 1 &&
        evidence.some(({ source }) => source.sourcePath.startsWith("structured")) &&
        evidence.some(({ source }) => !source.sourcePath.startsWith("structured"));
      materialConflict = postcodeConflict || structuredProseConflict;
    }
    if (!materialConflict) continue;
    const conflictId = stableId(
      "R2A_CONFLICT",
      observationId,
      canonicalField,
      ...evidence.map(({ id }) => id),
    );
    conflicts.push({ id: conflictId, canonicalField, evidenceIds: evidence.map(({ id }) => id) });
    for (const item of evidence) conflictingIds.set(item.id, conflictId);
  }
  const resolvedFields = fields.map((item) => {
    const conflictSetId = conflictingIds.get(item.id);
    return conflictSetId
      ? R2JobFieldEvidenceSchema.parse({ ...item, state: "CONFLICTING", conflictSetId })
      : item;
  });

  const parsedRangesByFamily = new Map<JobFieldFamily, Set<string>>();
  for (const item of [...resolvedFields, ...requirements]) {
    const ranges = parsedRangesByFamily.get(item.family) ?? new Set<string>();
    ranges.add(`${item.source.start}:${item.source.end}`);
    parsedRangesByFamily.set(item.family, ranges);
  }
  const coverage = familyValues.map((family) => {
    const evidenceIds = [
      ...resolvedFields.filter((item) => item.family === family),
      ...requirements.filter((item) => item.family === family),
    ].map(({ id }) => id);
    const sectionItems = sections
      .filter((section) => section.family === family)
      .flatMap(({ items }) => items);
    const parsed = parsedRangesByFamily.get(family) ?? new Set<string>();
    const unparsedSpans = sectionItems
      .filter((span) => !parsed.has(`${span.start}:${span.end}`))
      .map((span) => pointer(source, span));
    return {
      family,
      state:
        evidenceIds.length === 0
          ? ("UNKNOWN" as const)
          : unparsedSpans.length
            ? ("PARTIAL" as const)
            : ("COMPLETE" as const),
      evidenceIds,
      unparsedSpans,
      parserVersion: R2A_PARSER_VERSION,
    };
  });

  const result = R2ANormalizationSchema.parse({
    sourceObservationId: observationId,
    sourceLength: source.length,
    parserVersion: R2A_PARSER_VERSION,
    evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
    normalizationVersion: R2A_NORMALIZATION_VERSION,
    fieldEvidence: resolvedFields,
    requirementEvidence: requirements,
    conflicts,
    coverage,
  });
  assertR2ASourcePointers(result, source);
  return result;
}

export function bindR2ANormalizationObservation(
  input: R2ANormalization,
  sourceObservationId: string,
): R2ANormalization {
  const normalization = R2ANormalizationSchema.parse(input);
  return R2ANormalizationSchema.parse({
    ...normalization,
    sourceObservationId,
    fieldEvidence: normalization.fieldEvidence.map((item) => ({
      ...item,
      sourceObservationId,
    })),
    requirementEvidence: normalization.requirementEvidence.map((item) => ({
      ...item,
      sourceObservationId,
    })),
  });
}
