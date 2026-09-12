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
  r2RequirementPolarity,
  r2RequirementPropositionKey,
  type JobFieldFamily,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2NormalizedValue,
  type R2RequirementEvidence,
  type RequirementKind,
  type RequirementModality,
  type SourceEvidencePointer,
} from "@applypilot/job-model";

import { extractInertHtmlText } from "./sanitize";

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

function clauseSpans(span: Span): Span[] {
  if (span.sourcePath.startsWith("structured.")) return [span];
  const results: Span[] = [];
  const pattern = /[^;.]+[;.]?/g;
  for (const match of span.text.matchAll(pattern)) {
    const raw = match[0];
    const trimmed = raw.replace(/[;.]\s*$/, "").trim();
    if (!trimmed) continue;
    const relative = (match.index ?? 0) + raw.indexOf(trimmed);
    results.push({
      text: trimmed,
      start: span.start + relative,
      end: span.start + relative + trimmed.length,
      sourcePath: span.sourcePath,
    });
  }
  return results.length ? results : [span];
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

function indexStructuredSpans(
  source: string,
  structured: Record<string, unknown>,
): Map<string, Span> {
  const spans = new Map<string, Span>();
  if (JSON.stringify(structured) !== source) return spans;
  const walk = (value: unknown, path: string, start: number): number => {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return start;
    const end = start + encoded.length;
    if (encoded.length <= 1000) {
      spans.set(path, {
        text: typeof value === "string" ? value : encoded,
        start,
        end,
        sourcePath: path,
      });
    }
    if (Array.isArray(value)) {
      let cursor = start + 1;
      value.forEach((item, index) => {
        if (index > 0) cursor += 1;
        cursor = walk(item, `${path}[${index}]`, cursor);
      });
    } else if (value && typeof value === "object") {
      let cursor = start + 1;
      Object.entries(value as Record<string, unknown>).forEach(([key, item], index) => {
        if (item === undefined) return;
        if (index > 0) cursor += 1;
        cursor += JSON.stringify(key).length + 1;
        cursor = walk(item, `${path}.${key}`, cursor);
      });
    }
    return end;
  };
  walk(JSON.parse(source) as Record<string, unknown>, "structured", 0);
  return spans;
}

function materialFamilies(text: string): JobFieldFamily[] {
  const rules: Array<[JobFieldFamily, RegExp]> = [
    ["GEOGRAPHY", /\b(?:location|postcode|suburb|state|remote|hybrid|on-site)\b/i],
    [
      "EMPLOYMENT",
      /\b(?:employment type|work type|job type|full[ -]?time|part[ -]?time|casual|contract|internship)\b/i,
    ],
    ["HOURS", /\bhours?\b/i],
    ["SCHEDULE", /\b(?:shift|roster|weekday|weekend|overnight|am|pm|\d{1,2}:\d{2})\b/i],
    ["COMPENSATION", /\b(?:salary|remuneration|AUD|super|bonus)\b|\$/i],
    ["DATES", /\b(?:date|posted|closing|close|valid through|start)\b/i],
    ["EXPERIENCE", /\bexperience\b/i],
    ["EDUCATION", /\b(?:degree|diploma|qualification|education|studying)\b/i],
    ["LICENCES", /\blicen[cs]e\b/i],
    ["CERTIFICATIONS", /\b(?:RSA|first aid|certification|certificate|WWCC)\b/i],
    ["WORK_RIGHTS", /\b(?:work rights?|visa|sponsorship)\b/i],
    ["VEHICLE", /\b(?:vehicle|driver|travel|commute)\b/i],
    ["PHYSICAL_REQUIREMENTS", /\b(?:lift|standing|physical|age)\b/i],
    ["TRAINING", /\btraining\b/i],
    ["DOCUMENTS", /\b(?:CV|resume|cover letter|portfolio|transcript|selection criteria)\b/i],
    ["SKILLS", /\b(?:skill|proficien|knowledge|ability)\b/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([family]) => family);
}

type StructuredLocation = {
  label: string;
  path: string;
  components: Array<{ canonicalField: string; value: string; path: string }>;
};

function collectStructuredLocations(value: unknown, path: string): StructuredLocation[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStructuredLocations(item, `${path}[${index}]`));
  }
  const direct = structuredText(value);
  if (direct) return [{ label: direct, path, components: [] }];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (structuredText(record.text)) {
    return [{ label: structuredText(record.text)!, path: `${path}.text`, components: [] }];
  }
  const addressValue =
    record.address && typeof record.address === "object" ? record.address : record;
  const address = addressValue as Record<string, unknown>;
  const descriptors = [
    ["location.locality", "addressLocality"],
    ["location.state", "addressRegion"],
    ["location.postcode", "postalCode"],
    ["location.country", "addressCountry"],
  ] as const;
  const components = descriptors.flatMap(([canonicalField, key]) => {
    const nested =
      key === "addressCountry" && address[key] && typeof address[key] === "object"
        ? nestedStructured(address[key], ["name", "identifier"])
        : structuredText(address[key]);
    return nested
      ? [
          {
            canonicalField,
            value: nested,
            path: `${path}${addressValue === record ? "" : ".address"}.${key}${typeof address[key] === "object" ? ".name" : ""}`,
          },
        ]
      : [];
  });
  return components.length
    ? [{ label: components.map(({ value: item }) => item).join(" "), path, components }]
    : [];
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
  state?: "SOURCE_STATED" | "DERIVED";
  derivationInputIds?: string[];
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
    state: input.state ?? "SOURCE_STATED",
    modality: input.modality ?? null,
    source: pointer(input.source, input.span),
    normalizedValue: input.normalizedValue,
    extractorVersion: R2A_PARSER_VERSION,
    ruleId: input.ruleId,
    derivationInputIds: input.derivationInputIds ?? [],
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
      domain: text.slice(0, 500),
      minimum: noExperience ? 0 : minimum?.[1] ? Number(minimum[1]) : null,
      maximum: range?.[2] ? Number(range[2]) : null,
      unit: /months?/i.test(range?.[3] ?? minimum?.[2] ?? "")
        ? "MONTH"
        : /years?/i.test(range?.[3] ?? minimum?.[2] ?? "")
          ? "YEAR"
          : "UNKNOWN",
      recency: text.match(/\b(?:within|in the last)\s+[^,.]+/i)?.[0]?.slice(0, 300) ?? null,
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
  const explicitName =
    text.match(
      /\b(?:RSA|responsible service of alcohol|first aid|food safety|WWCC|working with children check|police check|white card|forklift licence|driver'?s? licence|class\s+(?:C|LR|MR|HR|HC|MC) licence)\b/i,
    )?.[0] ?? text.slice(0, 500);
  return {
    kind: "LICENCE_CERTIFICATION",
    value: {
      name: explicitName,
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
            .map((value) => value.slice(0, 500))
        : [],
      condition: modality(text).condition,
    },
  };
}

function workRightsValues(text: string): R2NormalizedValue[] {
  type WorkRightKind =
    | "VALID_AUSTRALIAN_WORK_RIGHTS"
    | "UNRESTRICTED_WORK_RIGHTS"
    | "SPONSORSHIP_AVAILABLE"
    | "SPONSORSHIP_NOT_AVAILABLE"
    | "VISA_REQUIREMENT"
    | "HOURS_CONDITION"
    | "EXPIRY_CONDITION"
    | "UNKNOWN";
  const kinds: WorkRightKind[] = [];
  if (/\bunrestricted (?:Australian )?work rights\b/i.test(text))
    kinds.push("UNRESTRICTED_WORK_RIGHTS");
  else if (/\bvalid Australian work rights\b/i.test(text))
    kinds.push("VALID_AUSTRALIAN_WORK_RIGHTS");
  if (/\b(?:sponsorship (?:is )?available|visa sponsorship offered)\b/i.test(text))
    kinds.push("SPONSORSHIP_AVAILABLE");
  if (/\b(?:no|not)\s+(?:visa )?sponsorship|sponsorship (?:is )?not available\b/i.test(text))
    kinds.push("SPONSORSHIP_NOT_AVAILABLE");
  if (
    /\b(?:visa|work)\s+hours?|hours?\s+(?:limit|condition|restriction)\b|\b(?:maximum|up to|limited to)\s+\d+(?:\.\d+)?\s+hours?\b/i.test(
      text,
    )
  )
    kinds.push("HOURS_CONDITION");
  if (/\bexpir(?:y|es|ation)\b/i.test(text)) kinds.push("EXPIRY_CONDITION");
  if (/\b(?:visa type|visa class|subclass|holder)\b/i.test(text)) kinds.push("VISA_REQUIREMENT");
  if (kinds.length === 0) kinds.push("UNKNOWN");
  return [...new Set(kinds)].map((kind) => ({
    kind: "WORK_RIGHTS" as const,
    value: { kind, wording: text.slice(0, 1000), condition: modality(text).condition },
  }));
}

const documentKinds = [
  ["CV_RESUME", /\b(?:cv|resume)\b/i],
  ["COVER_LETTER", /\bcover letter\b/i],
  ["SELECTION_CRITERIA", /\bselection criteria\b/i],
  ["PORTFOLIO", /\bportfolio\b/i],
  ["TRANSCRIPT", /\btranscript\b/i],
  ["LICENCE_CERTIFICATE_COPY", /\b(?:licence|certificate) copy\b/i],
] as const;

function normalizedRequirementValues(
  kind: RequirementKind,
  text: string,
  statement: ReturnType<typeof modality>,
): R2NormalizedValue[] {
  if (kind === "EXPERIENCE") return [experienceValue(text)];
  if (kind === "QUALIFICATION") return [educationValue(text)];
  if (kind === "LICENCE") return [licenceValue(text, "LICENCE")];
  if (kind === "CERTIFICATION") return [licenceValue(text, "CERTIFICATION")];
  if (kind === "WORK_RIGHTS") return workRightsValues(text);
  if (kind === "DOCUMENT") {
    return documentKinds.flatMap(([documentKind, pattern]) =>
      pattern.test(text)
        ? [
            {
              kind: "DOCUMENT" as const,
              value: {
                documentKind,
                state:
                  statement.modality === "NEGATED"
                    ? ("NOT_REQUIRED" as const)
                    : statement.modality === "REQUIRED"
                      ? ("REQUIRED" as const)
                      : ("UNKNOWN" as const),
                name: null,
              },
            },
          ]
        : [],
    );
  }
  if (kind === "VEHICLE") {
    return [
      {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: /access/i.test(text) ? "VEHICLE_ACCESS" : "OWN_VEHICLE",
          percentage: null,
          location: null,
          distanceKm: null,
          durationMinutes: null,
        },
      },
    ];
  }
  if (kind === "PHYSICAL" || kind === "AGE")
    return [{ kind: "PHYSICAL", value: text.slice(0, 4096) }];
  return [{ kind: "TEXT", value: text.slice(0, 4096) }];
}

function requirementEvidence(
  source: string,
  observationId: string,
  span: Span,
): R2RequirementEvidence[] {
  const kind = requirementKind(span.text);
  const statement = modality(span.text);
  if (kind === "GENERAL" && statement.modality === "UNKNOWN") return [];
  const family = familyForKind(kind);
  return normalizedRequirementValues(kind, span.text, statement).map((normalizedValue, index) =>
    R2RequirementEvidenceSchema.parse({
      id: stableId(
        R2A_PARSER_VERSION,
        observationId,
        span.sourcePath,
        String(span.start),
        span.text,
        String(index),
        JSON.stringify(normalizedValue),
      ),
      sourceObservationId: observationId,
      jobVersionId: null,
      family,
      canonicalKind: kind,
      state: "SOURCE_STATED",
      modality: statement.modality,
      condition: statement.condition,
      source: pointer(source, span),
      normalizedValue,
      extractorVersion: R2A_PARSER_VERSION,
      ruleId: `R2A_${kind}_${statement.modality}`,
      derivationInputIds: [],
      ownerCorrectionId: null,
      conflictSetId: null,
    }),
  );
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
  const statePattern =
    "australian capital territory|new south wales|northern territory|queensland|south australia|tasmania|victoria|western australia|ACT|NSW|NT|QLD|SA|TAS|VIC|WA";
  const beforeState =
    label
      .split(new RegExp(`,|\\b(?:${statePattern})\\b|\\b\\d{4}\\b`, "i"))[0]
      ?.replace(/\b(?:location|based in|located in)\s*:?\s*/i, "")
      .trim() ?? "";
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
  const amount = text.match(
    /(?:AUD\s*|A\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*([kK])?(?:\s*(?:-|–|to)\s*(?:(?:AUD\s*|A\$|\$)\s*)?([\d,]+(?:\.\d{1,2})?)\s*([kK])?)?/i,
  );
  const parseAmount = (raw: string | undefined, suffix: string | undefined): number | null => {
    if (!raw) return null;
    const numeric = Number(raw.replaceAll(",", ""));
    return Number.isFinite(numeric) ? numeric * (suffix ? 1000 : 1) : null;
  };
  const numbers = [
    parseAmount(amount?.[1], amount?.[2]),
    parseAmount(amount?.[3], amount?.[4]),
  ].filter((value): value is number => value !== null);
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
      superannuation: /\bplus super\b|\+\s*super\b/i.test(text)
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
  const isoDateTime = text.match(
    /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)\b/i,
  );
  if (isoDateTime?.[1]) {
    const offset = isoDateTime[1].match(/(Z|[+-]\d{2}:\d{2})$/i)?.[1] ?? null;
    return {
      kind: "DATE",
      value: {
        value: isoDateTime[1],
        precision: "DATE_TIME",
        timezone: offset ? "KNOWN" : "UNKNOWN",
        offset: offset?.toUpperCase() ?? null,
      },
    };
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
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
  if (year === null || month === null || day === null)
    return {
      kind: "DATE",
      value: { value: null, precision: "UNKNOWN", timezone: "UNKNOWN", offset: null },
    };
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const valid =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
  const value = valid
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
  return {
    kind: "DATE",
    value: { value, precision: value ? "DATE_ONLY" : "UNKNOWN", timezone: "UNKNOWN", offset: null },
  };
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
  const times = [
    ...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b|\b(1[0-2]|0?[1-9])\s*(am|pm)\b/gi),
  ].map((match) => {
    let hour = Number(match[1] ?? match[4]);
    const marker = (match[3] ?? match[5])?.toLowerCase();
    if (marker === "pm" && hour < 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
  });
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
  return documentKinds.flatMap(([documentKind, pattern]) => {
    if (!pattern.test(text)) return [];
    const state = /\b(?:no|not)\s+(?:required|necessary)|\b(?:is\s+)?not\s+required\b/i.test(text)
      ? "NOT_REQUIRED"
      : /\b(?:optional|may be required|depending on|where applicable)\b/i.test(text)
        ? "UNKNOWN"
        : /\b(?:attach|upload|include|submit|provide|required|must)\b/i.test(text)
          ? "REQUIRED"
          : "UNKNOWN";
    const field =
      documentKind === "CV_RESUME"
        ? "cvResume"
        : documentKind === "COVER_LETTER"
          ? "coverLetter"
          : documentKind === "SELECTION_CRITERIA"
            ? "selectionCriteria"
            : documentKind === "PORTFOLIO"
              ? "portfolio"
              : documentKind === "TRANSCRIPT"
                ? "transcript"
                : "licenceCertificateCopy";
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
  const regionConflictPairs: Array<[R2JobFieldEvidence, R2JobFieldEvidence]> = [];
  const structuredSpans = indexStructuredSpans(source, structured);
  const isCanonicalStructuredSource = structuredSpans.size > 0;
  const sections = isCanonicalStructuredSource ? [] : parseR2ASections(source);
  const standaloneSpans = (isCanonicalStructuredSource ? [] : lineSpans(source))
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
    .filter(({ text }) => text.length <= 1000)
    .flatMap(clauseSpans);
  const descriptionValue = structuredText(structured.description);
  const descriptionSource = structuredSpans.get("structured.description");
  const structuredDescriptionSpans =
    descriptionValue && descriptionSource
      ? lineSpans(
          /<[A-Za-z!/]/.test(descriptionValue)
            ? extractInertHtmlText(descriptionValue)
            : descriptionValue,
        )
          .filter((span) => isHeading(span) === undefined)
          .flatMap(clauseSpans)
          .map((span, index) => ({
            text: span.text.replace(/^[-*•]\s*/, "").trim(),
            start: descriptionSource.start,
            end: descriptionSource.end,
            sourcePath: `structured.description.item.${index}`,
          }))
      : [];
  const candidateSpans = [
    ...sections.flatMap(({ items }) => items.flatMap(clauseSpans)),
    ...standaloneSpans,
    ...structuredDescriptionSpans,
  ];
  const seenSpans = new Set<string>();
  const uniqueSpans = candidateSpans.filter((span) => {
    const key = span.sourcePath.startsWith("structured.")
      ? `${span.start}:${span.end}:${span.sourcePath}:${span.text}`
      : `${span.start}:${span.end}`;
    if (seenSpans.has(key)) return false;
    seenSpans.add(key);
    return true;
  });

  const structuredFields: Array<{
    canonicalField: string;
    family: JobFieldFamily;
    value: string | null;
    paths: string[];
  }> = [
    {
      canonicalField: "title",
      family: "IDENTITY",
      value: structuredText(structured.title) ?? structuredText(structured.name),
      paths: ["structured.title", "structured.name"],
    },
    {
      canonicalField: "company",
      family: "IDENTITY",
      value:
        nestedStructured(structured.hiringOrganization, ["name", "legalName"]) ??
        structuredText(structured.company),
      paths: [
        "structured.hiringOrganization.name",
        "structured.hiringOrganization.legalName",
        "structured.company",
      ],
    },
  ];
  for (const { canonicalField, family, value, paths } of structuredFields) {
    if (!value) continue;
    const span =
      paths.map((path) => structuredSpans.get(path)).find(Boolean) ??
      textSpan(source, value, paths[0]!);
    if (!span) continue;
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family,
        canonicalField,
        span,
        normalizedValue: { kind: "TEXT", value },
        ruleId: "R2A_STRUCTURED_FIELD",
      }),
    );
  }

  const structuredLocations = [
    ...collectStructuredLocations(structured.jobLocation, "structured.jobLocation"),
    ...collectStructuredLocations(structured.location, "structured.location"),
  ];
  for (const location of structuredLocations) {
    if (location.components.length === 0) {
      const span =
        structuredSpans.get(location.path) ?? textSpan(source, location.label, location.path);
      if (!span) continue;
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "GEOGRAPHY",
          canonicalField: "location.alternative",
          span,
          normalizedValue: { kind: "LOCATION", value: parseLocation(location.label) },
          ruleId: "R2A_STRUCTURED_LOCATION",
        }),
      );
      continue;
    }
    const inputs = location.components.flatMap((component) => {
      const span = structuredSpans.get(component.path);
      if (!span) return [];
      const evidence = fieldEvidence({
        source,
        observationId,
        family: "GEOGRAPHY",
        canonicalField: component.canonicalField,
        span,
        normalizedValue: { kind: "TEXT", value: component.value },
        ruleId: "R2A_STRUCTURED_LOCATION_COMPONENT",
      });
      fields.push(evidence);
      return [evidence];
    });
    if (inputs.length !== location.components.length || inputs.length === 0) continue;
    const parsedLocation = parseLocation(location.label);
    if (
      parsedLocation.postcode &&
      parsedLocation.stateOrTerritory &&
      postcodeState(parsedLocation.postcode) &&
      postcodeState(parsedLocation.postcode) !== parsedLocation.stateOrTerritory
    ) {
      const stateEvidence = inputs.find(
        ({ canonicalField }) => canonicalField === "location.state",
      );
      const postcodeEvidence = inputs.find(
        ({ canonicalField }) => canonicalField === "location.postcode",
      );
      if (stateEvidence && postcodeEvidence)
        regionConflictPairs.push([stateEvidence, postcodeEvidence]);
    }
    fields.push(
      fieldEvidence({
        source,
        observationId,
        family: "GEOGRAPHY",
        canonicalField: "location.alternative",
        span: {
          text: location.label,
          start: inputs[0]!.source.start,
          end: inputs[0]!.source.end,
          sourcePath: `${location.path}.derived`,
        },
        normalizedValue: { kind: "LOCATION", value: parsedLocation },
        state: "DERIVED",
        derivationInputIds: inputs.map(({ id }) => id),
        ruleId: "R2A_STRUCTURED_LOCATION_COMPOSITE",
      }),
    );
  }

  for (const [key, canonicalField] of [
    ["datePosted", "dates.posted"],
    ["validThrough", "dates.closing"],
  ] as const) {
    const value = structuredText(structured[key]);
    if (!value) continue;
    const span =
      structuredSpans.get(`structured.${key}`) ?? textSpan(source, value, `structured.${key}`);
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
    const span =
      structuredSpans.get(`structured.${key}`) ?? textSpan(source, value, `structured.${key}`);
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

  const baseSalary = structured.baseSalary;
  if (baseSalary && typeof baseSalary === "object" && !Array.isArray(baseSalary)) {
    const salaryRecord = baseSalary as Record<string, unknown>;
    const valueRecord =
      salaryRecord.value && typeof salaryRecord.value === "object"
        ? (salaryRecord.value as Record<string, unknown>)
        : salaryRecord;
    const minimum = Number(valueRecord.minValue ?? valueRecord.value);
    const maximum = Number(valueRecord.maxValue ?? valueRecord.value);
    const currency = structuredText(salaryRecord.currency);
    const unit = structuredText(valueRecord.unitText)?.toUpperCase();
    const components = [
      ["salary.minimum", "structured.baseSalary.value.minValue", minimum],
      ["salary.maximum", "structured.baseSalary.value.maxValue", maximum],
      ["salary.currency", "structured.baseSalary.currency", currency],
      ["salary.period", "structured.baseSalary.value.unitText", unit],
    ] as const;
    const inputs = components.flatMap(([canonicalField, path, value]) => {
      const span = structuredSpans.get(path) ?? textSpan(source, String(value), path);
      if (!span || value === null || value === undefined || Number.isNaN(value)) return [];
      const evidence = fieldEvidence({
        source,
        observationId,
        family: "COMPENSATION",
        canonicalField,
        span,
        normalizedValue: { kind: "TEXT", value: String(value) },
        ruleId: "R2A_STRUCTURED_SALARY_COMPONENT",
      });
      fields.push(evidence);
      return [evidence];
    });
    if (inputs.length >= 2 && Number.isFinite(minimum)) {
      const period =
        unit === "HOUR" || unit === "DAY" || unit === "WEEK" || unit === "MONTH" || unit === "YEAR"
          ? unit
          : "UNKNOWN";
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "COMPENSATION",
          canonicalField: "salary",
          span: {
            text: "structured salary",
            start: inputs[0]!.source.start,
            end: inputs[0]!.source.end,
            sourcePath: "structured.baseSalary.derived",
          },
          normalizedValue: {
            kind: "SALARY",
            value: {
              shape: Number.isFinite(maximum) && maximum !== minimum ? "RANGE" : "EXACT",
              minimum,
              maximum: Number.isFinite(maximum) ? maximum : minimum,
              currency: currency?.length === 3 ? currency.toUpperCase() : null,
              period,
              superannuation: "UNKNOWN",
              commission: false,
              bonus: false,
            },
          },
          state: "DERIVED",
          derivationInputIds: inputs.map(({ id }) => id),
          ruleId: "R2A_STRUCTURED_SALARY_COMPOSITE",
        }),
      );
    }
  }

  for (const key of ["requirementTexts", "requirements", "skills", "qualifications"] as const) {
    const raw = structured[key];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const [index, item] of values.entries()) {
      const value = structuredText(item);
      if (!value) continue;
      const path = Array.isArray(raw) ? `structured.${key}[${index}]` : `structured.${key}`;
      const span = structuredSpans.get(path) ?? textSpan(source, value, path);
      if (span) uniqueSpans.push(span);
    }
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

  const structuredLocationLabels = new Set(structuredLocations.map(({ label }) => label));
  const labelledLocationSources = uniqueSpans.flatMap((span) => {
    const match = span.text.match(/^(?:location|based in|located in)\s*:\s*(.+)$/i);
    return match?.[1] ? [{ value: match[1].trim(), path: span.sourcePath }] : [];
  });
  const locationSources = [
    ...(input.explicitLocation && !structuredLocationLabels.has(input.explicitLocation)
      ? [{ value: input.explicitLocation, path: "visibleText.location" }]
      : []),
    ...labelledLocationSources,
  ].filter((item, index, all) => all.findIndex(({ value }) => value === item.value) === index);
  for (const locationSource of locationSources) {
    const baseSpan = textSpan(source, locationSource.value, locationSource.path);
    for (const alternative of locationSource.value
      .split(/\s+(?:or)\s+|\s*;\s*/i)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const span = textSpan(source, alternative, baseSpan?.sourcePath ?? "visibleText.location");
      if (!span) continue;
      const parsedLocation = parseLocation(alternative);
      fields.push(
        fieldEvidence({
          source,
          observationId,
          family: "GEOGRAPHY",
          canonicalField: "location.alternative",
          span,
          normalizedValue: { kind: "LOCATION", value: parsedLocation },
          ruleId: "R2A_AU_LOCATION",
        }),
      );
      if (
        parsedLocation.postcode &&
        parsedLocation.stateOrTerritory &&
        postcodeState(parsedLocation.postcode) &&
        postcodeState(parsedLocation.postcode) !== parsedLocation.stateOrTerritory
      ) {
        const stateEvidence = fieldEvidence({
          source,
          observationId,
          family: "GEOGRAPHY",
          canonicalField: "location.state",
          span,
          normalizedValue: { kind: "TEXT", value: parsedLocation.stateOrTerritory },
          ruleId: "R2A_LOCATION_STATE_STATED",
        });
        const postcodeEvidence = fieldEvidence({
          source,
          observationId,
          family: "GEOGRAPHY",
          canonicalField: "location.postcode",
          span,
          normalizedValue: { kind: "TEXT", value: parsedLocation.postcode },
          ruleId: "R2A_LOCATION_POSTCODE_STATED",
        });
        fields.push(stateEvidence, postcodeEvidence);
        regionConflictPairs.push([stateEvidence, postcodeEvidence]);
      }
    }
  }

  const employmentCandidates: Span[] = [];
  for (const key of ["employmentType", "employmentTypeText"] as const) {
    const raw = structured[key];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const [index, item] of values.entries()) {
      const value = structuredText(item);
      const path = Array.isArray(raw) ? `structured.${key}[${index}]` : `structured.${key}`;
      const span = structuredSpans.get(path) ?? (value ? textSpan(source, value, path) : null);
      if (value && span) employmentCandidates.push({ ...span, text: value });
    }
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
      const itemSpan = span.sourcePath.startsWith("structured")
        ? span
        : {
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

    requirements.push(...requirementEvidence(source, observationId, span));
  }

  const conflicts: R2ANormalization["conflicts"] = [];
  const byField = new Map<string, R2JobFieldEvidence[]>();
  for (const item of fields) {
    const existing = byField.get(item.canonicalField) ?? [];
    existing.push(item);
    byField.set(item.canonicalField, existing);
  }
  const conflictingIds = new Map<string, string>();
  for (const pair of regionConflictPairs) {
    const conflictId = stableId("R2A_REGION_CONFLICT", observationId, ...pair.map(({ id }) => id));
    conflicts.push({
      id: conflictId,
      canonicalField: "location.region",
      evidenceIds: pair.map(({ id }) => id),
    });
    for (const item of pair) conflictingIds.set(item.id, conflictId);
  }
  for (const [canonicalField, evidence] of byField) {
    const distinct = new Set(
      evidence.map(({ normalizedValue }) => JSON.stringify(normalizedValue)),
    );
    let materialConflict = distinct.size > 1;
    if (canonicalField === "location.alternative") {
      const structuredProseConflict =
        distinct.size > 1 &&
        evidence.some(({ source }) => source.sourcePath.startsWith("structured")) &&
        evidence.some(({ source }) => !source.sourcePath.startsWith("structured"));
      materialConflict = structuredProseConflict;
    }
    if (canonicalField === "schedule") materialConflict = false;
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
  const requirementGroups = new Map<string, R2RequirementEvidence[]>();
  for (const item of requirements) {
    const key = r2RequirementPropositionKey(item);
    const existing = requirementGroups.get(key) ?? [];
    existing.push(item);
    requirementGroups.set(key, existing);
  }
  for (const [propositionKey, evidence] of requirementGroups) {
    const hasNegative = evidence.some((item) => r2RequirementPolarity(item) === "NEGATED");
    const hasPositive = evidence.some((item) => r2RequirementPolarity(item) === "POSITIVE");
    if (!hasNegative || !hasPositive) continue;
    const conflictId = stableId(
      "R2A_REQUIREMENT_CONFLICT",
      observationId,
      propositionKey,
      ...evidence.map(({ id }) => id),
    );
    conflicts.push({
      id: conflictId,
      canonicalField: `requirement:${propositionKey}`,
      evidenceIds: evidence.map(({ id }) => id),
    });
    for (const item of evidence) conflictingIds.set(item.id, conflictId);
  }
  const resolvedRequirements = requirements.map((item) => {
    const conflictSetId = conflictingIds.get(item.id);
    return conflictSetId
      ? R2RequirementEvidenceSchema.parse({ ...item, state: "CONFLICTING", conflictSetId })
      : item;
  });

  const parsedRangesByFamily = new Map<JobFieldFamily, Set<string>>();
  for (const item of [...resolvedFields, ...resolvedRequirements]) {
    const ranges = parsedRangesByFamily.get(item.family) ?? new Set<string>();
    ranges.add(`${item.source.sourcePath}:${item.source.start}:${item.source.end}`);
    parsedRangesByFamily.set(item.family, ranges);
  }
  const coverage = familyValues.map((family) => {
    const evidenceIds = [
      ...resolvedFields.filter((item) => item.family === family),
      ...resolvedRequirements.filter((item) => item.family === family),
    ].map(({ id }) => id);
    const sectionItems = sections
      .filter((section) => section.family === family)
      .flatMap(({ items }) => items.flatMap(clauseSpans));
    const materialSpans = uniqueSpans.filter((span) =>
      materialFamilies(span.text).includes(family),
    );
    const scopeSpans = [...sectionItems, ...materialSpans].filter(
      (span, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.start === span.start &&
            candidate.end === span.end &&
            candidate.sourcePath === span.sourcePath,
        ) === index,
    );
    const parsed = parsedRangesByFamily.get(family) ?? new Set<string>();
    const unparsedSpans = scopeSpans
      .filter((span) => !parsed.has(`${span.sourcePath}:${span.start}:${span.end}`))
      .map((span) => pointer(source, span));
    const credibleCompleteScope = sectionItems.length > 0;
    return {
      family,
      state:
        evidenceIds.length === 0 && scopeSpans.length === 0
          ? ("UNKNOWN" as const)
          : credibleCompleteScope && evidenceIds.length > 0 && unparsedSpans.length === 0
            ? ("COMPLETE" as const)
            : ("PARTIAL" as const),
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
    requirementEvidence: resolvedRequirements,
    conflicts,
    coverage,
  });
  assertR2ASourcePointers(result, source);
  assertR2AExcerptHashes(result);
  return result;
}

export function assertR2AExcerptHashes(result: R2ANormalization): void {
  const pointers = [
    ...result.fieldEvidence.map(({ source }) => source),
    ...result.requirementEvidence.map(({ source }) => source),
    ...result.coverage.flatMap(({ unparsedSpans }) => unparsedSpans),
  ];
  for (const sourcePointer of pointers) {
    if (digest(sourcePointer.excerpt) !== sourcePointer.excerptHash) {
      throw new Error("R2A_EXCERPT_HASH_MISMATCH");
    }
  }
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
