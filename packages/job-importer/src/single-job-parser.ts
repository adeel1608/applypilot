import { ParsedJobFieldsSchema } from "./schemas";
import { extractInertHtmlText } from "./sanitize";
import type {
  ImportedJobDraft,
  ParsedJobFields,
  SourceDetection,
  SplitImportedJobRecord,
} from "./types";
import { normalizeSeekJob, parseUserSuppliedSeekContent } from "@applypilot/job-sources";
import { extractBetaJobFields } from "./beta-extraction";

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return /<[A-Za-z!/]/.test(value) ? extractInertHtmlText(value) || null : value.trim();
  }
  if (typeof value === "number") return String(value);
  return null;
}

function nestedText(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const result = asText(record[key]);
    if (result) return result;
  }
  return null;
}

function label(text: string, names: string[]): string | null {
  const alternation = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`^\\s*(?:${alternation})\\s*:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() || null;
}

function section(text: string, names: string[]): string[] {
  const alternation = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:${alternation})\\s*:\\s*\\n?([\\s\\S]*?)(?=\\n\\s*[A-Za-z][A-Za-z ]{1,30}\\s*:|$)`,
      "i",
    ),
  );
  if (!match?.[1]) return [];
  return match[1]
    .split(/\n|[;•]/)
    .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function organizationName(value: unknown): string | null {
  return nestedText(value, ["name", "legalName"]);
}

function locationText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(locationText).filter(Boolean).join("; ") || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const explicitText = asText(record.text);
  if (explicitText) return explicitText;
  const address =
    record.address && typeof record.address === "object"
      ? (record.address as Record<string, unknown>)
      : record;
  const parts = [
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry,
  ]
    .map(asText)
    .filter((item): item is string => Boolean(item));
  return parts.join(", ") || null;
}

function descriptionFromText(text: string): string | null {
  const labelled = label(text, ["description", "summary", "job description"]);
  if (labelled) return labelled;
  const withoutLabels = text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*(?:title|job title|role|company|employer|location|salary|url|source url|external id|job id)\s*:/i.test(
          line,
        ),
    )
    .join("\n")
    .trim();
  return withoutLabels.length >= 20 ? withoutLabels : null;
}

function dateTime(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function employmentType(value: string | null, text: string): ParsedJobFields["employmentType"] {
  const explicit = (value ?? "").toLowerCase();
  const explicitMatches = [
    ["CASUAL", /\bcasual\b/],
    ["PART_TIME", /\bpart[ -]?time\b/],
    ["FULL_TIME", /\bfull[ -]?time\b/],
    ["CONTRACT", /\bcontract(?:or)?\b/],
    ["INTERNSHIP", /\bintern(?:ship)?\b/],
  ] as const;
  const explicitResult = explicitMatches.find(([, pattern]) => pattern.test(explicit))?.[0];
  if (explicitResult) return explicitResult;
  const bodyMatches = explicitMatches.filter(([, pattern]) => pattern.test(text.toLowerCase()));
  if (bodyMatches.length !== 1) return "UNKNOWN";
  const candidate = text.toLowerCase();
  if (/\bcasual\b/.test(candidate)) return "CASUAL";
  if (/\bpart[ -]?time\b/.test(candidate)) return "PART_TIME";
  if (/\bfull[ -]?time\b/.test(candidate)) return "FULL_TIME";
  if (/\bcontract(?:or)?\b/.test(candidate)) return "CONTRACT";
  if (/\bintern(?:ship)?\b/.test(candidate)) return "INTERNSHIP";
  return "UNKNOWN";
}

export function parseImportedJobRecord(
  record: SplitImportedJobRecord,
  sourceDetection: SourceDetection,
  fallbackUrl: string | null,
  observedAt = new Date().toISOString(),
): ImportedJobDraft {
  const structured = record.structured ?? {};
  const title =
    asText(structured.title) ??
    asText(structured.name) ??
    label(record.text, ["title", "job title", "role"]);
  const company =
    organizationName(structured.hiringOrganization) ??
    asText(structured.company) ??
    label(record.text, ["company", "employer", "organisation", "organization"]);
  const location =
    locationText(structured.jobLocation) ??
    asText(structured.location) ??
    label(record.text, ["location"]);
  const description = asText(structured.description) ?? descriptionFromText(record.text);
  const sourceUrl =
    asText(structured.url) ??
    asText(structured.sourceUrl) ??
    asText(structured.canonicalUrl) ??
    label(record.text, ["url", "source url"]) ??
    fallbackUrl;
  const externalId =
    nestedText(structured.identifier, ["value", "name"]) ??
    asText(structured.externalId) ??
    label(record.text, ["external id", "job id", "reference"]);
  const applicationUrl =
    asText(structured.applicationUrl) ??
    asText(structured.applyUrl) ??
    asText(structured.applicationTargetUrl);
  const requisitionId =
    asText(structured.requisitionId) ??
    asText(structured.jobPostingIdentifier) ??
    label(record.text, ["requisition id", "requisition", "reference"]);
  const typeText =
    asText(structured.employmentType) ?? label(record.text, ["employment type", "work type"]);
  let fields = ParsedJobFieldsSchema.parse({
    externalId,
    sourceUrl,
    applicationUrl,
    requisitionId,
    title,
    company,
    location,
    category: asText(structured.industry) ?? label(record.text, ["category", "classification"]),
    description,
    salaryText: asText(structured.baseSalary) ?? label(record.text, ["salary"]),
    employmentType: employmentType(typeText, record.text),
    requirements: Array.isArray(structured.requirementTexts)
      ? structured.requirementTexts.map(asText).filter((item): item is string => Boolean(item))
      : section(record.text, ["requirements", "required", "what you need"]),
    responsibilities: Array.isArray(structured.responsibilities)
      ? structured.responsibilities.map(asText).filter((item): item is string => Boolean(item))
      : section(record.text, ["responsibilities", "duties", "what you will do"]),
    datePosted: dateTime(structured.datePosted),
    coverLetterRequired: null,
    beta: extractBetaJobFields({
      text: record.text,
      location,
      structured: record.structured,
      sourceObservationId: `preview:${record.id}`,
    }),
  });
  const extractionRuleIds = [record.structured ? "STRUCTURED_JOB_FIELDS" : "LABELLED_VISIBLE_TEXT"];
  if (
    sourceDetection.source === "SEEK" &&
    record.structured &&
    fields.sourceUrl &&
    fields.externalId
  ) {
    try {
      const seekRecord = parseUserSuppliedSeekContent(record.structured, {
        sourceUrl: fields.sourceUrl,
        discoveredAt: observedAt,
        fetchedAt: observedAt,
      });
      const job = normalizeSeekJob(seekRecord);
      fields = ParsedJobFieldsSchema.parse({
        ...fields,
        externalId: job.externalId,
        sourceUrl: job.sourceUrl,
        title: job.title,
        company: job.company,
        location: job.location,
        category: fields.category,
        description: job.description,
        salaryText: job.salary?.text ?? fields.salaryText,
        employmentType: job.employmentType,
        requirements: job.requirements,
        responsibilities: job.responsibilities,
        datePosted: job.datePosted,
        coverLetterRequired:
          typeof job.sourceMetadata.coverLetterRequired === "boolean"
            ? job.sourceMetadata.coverLetterRequired
            : null,
        beta: extractBetaJobFields({
          text: record.text,
          location: job.location,
          structured: record.structured,
          sourceObservationId: `preview:${record.id}`,
        }),
      });
      extractionRuleIds.push("SEEK_PHASE_2_PARSER_REUSE");
    } catch {
      // The generic inert parser remains authoritative when Phase 2 SEEK preconditions do not fit.
    }
  }
  const missing = (["title", "company", "location", "description"] as const).filter(
    (key) => !fields[key],
  );
  const warnings = [
    ...record.warnings,
    ...sourceDetection.conflicts.map((code) => ({
      code,
      message: "The source hint conflicts with detected evidence.",
    })),
    ...missing.map((field) => ({
      code: "MISSING_REQUIRED_FIELD",
      field,
      message: `${field} must be supplied before this record can be imported.`,
    })),
  ];
  return {
    recordId: record.id,
    ordinal: record.ordinal,
    splitStatus: missing.length ? "REVIEW_REQUIRED" : record.status,
    sourceDetection,
    fields,
    originalExtractedFields: structuredClone(fields),
    extractionRuleIds,
    contentHash: record.contentHash,
    excerpt: (description ?? record.text).slice(0, 500),
    warnings,
  };
}
