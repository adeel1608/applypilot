import { createHash } from "node:crypto";

import { z } from "zod";

import {
  SourceCapabilityV2Schema,
  SourceProviderDriftDiagnosticSchema,
  SourceRunBudget,
  type SourceCapabilityV2,
  type SourceProviderDriftDiagnostic,
  SourceSchemaDiagnosticFieldSchema,
  SourceSchemaDiagnosticSchema,
  type SourceSchemaDiagnostic,
  type SourceSchemaDiagnosticField,
  type SourceSchemaExpectedType,
} from "../source-capability";
import {
  SecureSourceError,
  boundedSecureJsonGet,
  type SecureSourceTransportDependencies,
} from "../secure-source-transport";
import { extractInertLeverText } from "./inert-text";

const LeverCategoriesV2Schema = z
  .object({
    commitment: z.string().optional(),
    department: z.string().optional(),
    location: z.string().optional(),
    team: z.string().optional(),
    level: z.string().optional(),
    allLocations: z.array(z.string()).optional(),
  })
  .passthrough();

const LeverListV2Schema = z
  .object({
    text: z.string(),
    content: z.string(),
  })
  .passthrough();

export const LeverOfficialWorkplaceTypeV2Schema = z.enum([
  "on-site",
  "remote",
  "hybrid",
  "unspecified",
]);

export const LeverPostingV2Schema = z
  .object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    opening: z.string().optional(),
    openingPlain: z.string().optional(),
    description: z.string().optional(),
    descriptionPlain: z.string().default(""),
    descriptionBody: z.string().optional(),
    descriptionBodyPlain: z.string().optional(),
    additional: z.string().optional(),
    additionalPlain: z.string().optional(),
    lists: z.array(LeverListV2Schema).default([]),
    categories: LeverCategoriesV2Schema.optional(),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .nullable()
      .optional(),
    workplaceType: z.string().nullable().optional(),
    salaryRange: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        currency: z.string().optional(),
        interval: z.string().optional(),
      })
      .passthrough()
      .optional(),
    salaryDescription: z.string().optional(),
    salaryDescriptionPlain: z.string().optional(),
  })
  .passthrough();

const LeverPageV2Schema = z.array(LeverPostingV2Schema);
export type LeverPostingV2 = z.infer<typeof LeverPostingV2Schema>;

const expectedTypeByField = Object.freeze({
  id: "string",
  text: "string",
  categories: "object",
  "categories.location": "string",
  "categories.commitment": "string",
  "categories.team": "string",
  "categories.department": "string",
  "categories.level": "string",
  "categories.allLocations": "array",
  "categories.allLocations[]": "string",
  country: "string|null",
  opening: "string",
  openingPlain: "string",
  description: "string",
  descriptionPlain: "string",
  descriptionBody: "string",
  descriptionBodyPlain: "string",
  lists: "array",
  "lists[]": "object",
  "lists[].text": "string",
  "lists[].content": "string",
  additional: "string",
  additionalPlain: "string",
  hostedUrl: "url",
  applyUrl: "url",
  workplaceType: "enum",
  salaryRange: "object",
  "salaryRange.currency": "string",
  "salaryRange.interval": "string",
  "salaryRange.min": "number",
  "salaryRange.max": "number",
  salaryDescription: "string",
  salaryDescriptionPlain: "string",
}) satisfies Readonly<
  Record<
    Exclude<SourceSchemaDiagnosticField, "UNKNOWN_CONTRACT_BOUNDARY">,
    SourceSchemaExpectedType
  >
>;

function canonicalIssuePath(path: readonly PropertyKey[]): {
  field: string;
  recordIndex?: number;
} {
  const segments = [...path];
  const first = segments[0];
  const recordIndex = typeof first === "number" ? first : undefined;
  if (recordIndex !== undefined) segments.shift();
  const parts: string[] = [];
  for (const segment of segments) {
    if (typeof segment === "string") {
      parts.push(segment);
      continue;
    }
    if (typeof segment === "number" && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}[]`;
      continue;
    }
    return { field: "UNKNOWN_CONTRACT_BOUNDARY", recordIndex };
  }
  return { field: parts.join("."), recordIndex };
}

function issuePathIsMissing(input: unknown, path: readonly PropertyKey[]): boolean {
  let current = input;
  for (const segment of path) {
    if ((typeof segment !== "string" && typeof segment !== "number") || current === null) {
      return false;
    }
    if (typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return true;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current === undefined;
}

function redactedSchemaDiagnostic(error: z.ZodError, input: unknown): SourceSchemaDiagnostic {
  const issue = error.issues[0];
  if (!issue) {
    return {
      field: "UNKNOWN_CONTRACT_BOUNDARY",
      expectedStructuralType: Array.isArray(input) ? "object" : "array",
      issueCategory: "UNKNOWN_CONTRACT_BOUNDARY",
    };
  }
  const canonical = canonicalIssuePath(issue.path);
  const field = SourceSchemaDiagnosticFieldSchema.safeParse(canonical.field);
  if (!field.success || field.data === "UNKNOWN_CONTRACT_BOUNDARY") {
    return SourceSchemaDiagnosticSchema.parse({
      field: "UNKNOWN_CONTRACT_BOUNDARY",
      expectedStructuralType: Array.isArray(input) ? "object" : "array",
      issueCategory: "UNKNOWN_CONTRACT_BOUNDARY",
      ...(canonical.recordIndex === undefined ? {} : { recordIndex: canonical.recordIndex }),
    });
  }
  const expectedStructuralType = expectedTypeByField[field.data] ?? "object";
  const issueCategory = issuePathIsMissing(input, issue.path)
    ? "MISSING_REQUIRED"
    : expectedStructuralType === "url" && issue.code === "invalid_format"
      ? "INVALID_URL"
      : expectedStructuralType === "enum" && issue.code === "invalid_value"
        ? "INVALID_ENUM"
        : issue.code === "invalid_format"
          ? "INVALID_FORMAT"
          : "FIELD_TYPE_MISMATCH";
  return SourceSchemaDiagnosticSchema.parse({
    field: field.data,
    expectedStructuralType,
    issueCategory,
    ...(canonical.recordIndex === undefined ? {} : { recordIndex: canonical.recordIndex }),
  });
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface LeverSourceSectionV2 {
  heading: string;
  content: string;
  kind: "REQUIREMENTS" | "RESPONSIBILITIES" | "BENEFITS" | "OTHER";
}

export interface LeverPostingRecordV2 {
  source: "LEVER";
  region: "GLOBAL" | "EU";
  tenant: string;
  externalId: string;
  title: string;
  description: string;
  location: string | null;
  allLocations: string[];
  country: string | null;
  commitment: string | null;
  department: string | null;
  team: string | null;
  workplaceType: "onsite" | "remote" | "hybrid" | "unspecified" | null;
  providerDriftDiagnostics: readonly SourceProviderDriftDiagnostic[];
  sections: readonly LeverSourceSectionV2[];
  salaryRange: LeverPostingV2["salaryRange"] | null;
  sourceUrl: string;
  applicationUrl: string;
  postedAt: string | null;
  contentDigest: string;
  rawPayload: DeepReadonly<LeverPostingV2>;
}

function sectionKind(heading: string): LeverSourceSectionV2["kind"] {
  if (/\b(requirements?|qualifications?|what you (?:bring|need)|skills?)\b/i.test(heading)) {
    return "REQUIREMENTS";
  }
  if (/\b(responsibilities|duties|what you(?:'|’)ll do|the role)\b/i.test(heading)) {
    return "RESPONSIBILITIES";
  }
  if (/\b(benefits?|perks?|what we offer)\b/i.test(heading)) return "BENEFITS";
  return "OTHER";
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

function mapPosting(
  posting: LeverPostingV2,
  capability: SourceCapabilityV2,
  recordIndex?: number,
): LeverPostingRecordV2 {
  const raw = JSON.stringify(posting);
  const title = extractInertLeverText(posting.text);
  const location = extractInertLeverText(posting.categories?.location ?? "") || null;
  const allLocations = [
    ...new Set(
      (posting.categories?.allLocations ?? [])
        .map(extractInertLeverText)
        .filter((value) => Boolean(value)),
    ),
  ];
  const sections = Object.freeze(
    posting.lists
      .map(({ text, content }) => {
        const heading = extractInertLeverText(text);
        const inertContent = extractInertLeverText(content);
        return Object.freeze({
          heading,
          content: inertContent,
          kind: sectionKind(heading),
        });
      })
      .filter(({ heading, content }) => Boolean(heading || content)),
  );
  const description = [
    extractInertLeverText(posting.descriptionPlain || posting.description || ""),
    ...sections.map(({ heading, content }) => [heading, content].filter(Boolean).join("\n")),
    extractInertLeverText(posting.additionalPlain || posting.additional || ""),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!posting.id.trim() || !title || !description || !(location ?? allLocations[0])) {
    throw new SecureSourceError("SOURCE_RECORD_UNUSABLE", null, "RESPONSE_BODY");
  }
  const officialWorkplaceType = LeverOfficialWorkplaceTypeV2Schema.safeParse(posting.workplaceType);
  const providerDriftDiagnostics = Object.freeze(
    posting.workplaceType === null ||
      (typeof posting.workplaceType === "string" && !officialWorkplaceType.success)
      ? [
          Object.freeze(
            SourceProviderDriftDiagnosticSchema.parse({
              issueCategory: "PROVIDER_ENUM_DRIFT",
              field: "workplaceType",
              expectedStructuralType: "enum",
              ...(recordIndex === undefined ? {} : { recordIndex }),
            }),
          ),
        ]
      : [],
  );
  return {
    source: "LEVER",
    region: capability.region,
    tenant: capability.tenant,
    externalId: posting.id,
    title,
    description,
    location,
    allLocations,
    country: extractInertLeverText(posting.country ?? "") || null,
    commitment: extractInertLeverText(posting.categories?.commitment ?? "") || null,
    department: extractInertLeverText(posting.categories?.department ?? "") || null,
    team: extractInertLeverText(posting.categories?.team ?? "") || null,
    workplaceType: officialWorkplaceType.success
      ? officialWorkplaceType.data === "on-site"
        ? "onsite"
        : officialWorkplaceType.data
      : null,
    providerDriftDiagnostics,
    sections,
    salaryRange: posting.salaryRange
      ? {
          min: posting.salaryRange.min,
          max: posting.salaryRange.max,
          currency: posting.salaryRange.currency
            ? extractInertLeverText(posting.salaryRange.currency)
            : undefined,
          interval: posting.salaryRange.interval
            ? extractInertLeverText(posting.salaryRange.interval)
            : undefined,
        }
      : null,
    sourceUrl: posting.hostedUrl,
    applicationUrl: posting.applyUrl,
    postedAt: null,
    contentDigest: createHash("sha256").update(raw).digest("hex"),
    rawPayload: freezeDeep(posting),
  };
}

function responseBodyFailure(error: unknown, input: unknown): never {
  if (error instanceof SecureSourceError) {
    throw error.lifecycleStage
      ? error
      : new SecureSourceError(
          error.code,
          error.retryAfter,
          "RESPONSE_BODY",
          error.schemaDiagnostic,
        );
  }
  throw new SecureSourceError(
    "SCHEMA_CHANGED",
    null,
    "RESPONSE_BODY",
    error instanceof z.ZodError ? redactedSchemaDiagnostic(error, input) : null,
  );
}

function parseLeverPage(
  input: unknown,
  capability: SourceCapabilityV2,
  pageSize: number,
): LeverPostingRecordV2[] {
  try {
    const postings = LeverPageV2Schema.parse(input);
    if (postings.length > pageSize) {
      throw new SecureSourceError("PAGE_SIZE_EXCEEDED", null, "RESPONSE_BODY");
    }
    return postings.map((posting, recordIndex) => mapPosting(posting, capability, recordIndex));
  } catch (error) {
    responseBodyFailure(error, input);
  }
}

function parseLeverPosting(input: unknown, capability: SourceCapabilityV2): LeverPostingRecordV2 {
  try {
    return mapPosting(LeverPostingV2Schema.parse(input), capability);
  } catch (error) {
    responseBodyFailure(error, input);
  }
}

export interface LeverPageV2 {
  records: LeverPostingRecordV2[];
  providerDriftDiagnostics: readonly SourceProviderDriftDiagnostic[];
  cursor: number;
  nextCursor: number | null;
  pageDigest: string;
  byteCount: number;
  requestCount: number;
}

export async function readLeverPageV2(input: {
  capability: SourceCapabilityV2;
  budget: SourceRunBudget;
  cursor?: number;
  pageSize?: number;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<LeverPageV2> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  if (capability.source !== "LEVER") throw new SecureSourceError("SOURCE_MISMATCH");
  const cursor = z
    .number()
    .int()
    .nonnegative()
    .max(capability.recordCap)
    .parse(input.cursor ?? 0);
  const requestedPageSize = z
    .number()
    .int()
    .positive()
    .max(capability.pageSizeCap)
    .parse(input.pageSize ?? capability.pageSizeCap);
  const pageSize = Math.min(requestedPageSize, capability.recordCap - cursor);
  if (pageSize < 1) throw new SecureSourceError("RECORD_CAP_EXCEEDED");
  if ([...input.budget.seenCursors].some((seen) => Number(seen) > cursor)) {
    throw new SecureSourceError("CURSOR_REVERSED");
  }
  const host = capability.region === "EU" ? "api.eu.lever.co" : "api.lever.co";
  const url = new URL(`/v0/postings/${encodeURIComponent(capability.tenant)}`, `https://${host}`);
  url.searchParams.set("mode", "json");
  url.searchParams.set("skip", String(cursor));
  url.searchParams.set("limit", String(pageSize));
  const response = await boundedSecureJsonGet({
    initialUrl: url.toString(),
    capability,
    operation: "LIST_JOBS",
    budget: input.budget,
    now: input.now,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  const records = parseLeverPage(response.body, capability, pageSize);
  const providerDriftDiagnostics = Object.freeze(
    records.flatMap(({ providerDriftDiagnostics: diagnostics }) => diagnostics),
  );
  const pageDigest = createHash("sha256")
    .update(
      records.map(({ externalId, contentDigest }) => `${externalId}:${contentDigest}`).join("\n"),
    )
    .digest("hex");
  input.budget.consumePage(String(cursor), records.length, response.byteCount);
  const next = records.length === pageSize ? cursor + records.length : null;
  return {
    records,
    providerDriftDiagnostics,
    cursor,
    nextCursor: next !== null && next < capability.recordCap ? next : null,
    pageDigest,
    byteCount: response.byteCount,
    requestCount: response.requestCount,
  };
}

export async function readLeverDetailV2(input: {
  capability: SourceCapabilityV2;
  budget: SourceRunBudget;
  externalId: string;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<LeverPostingRecordV2> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  if (capability.source !== "LEVER") throw new SecureSourceError("SOURCE_MISMATCH");
  const externalId = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(input.externalId);
  const host = capability.region === "EU" ? "api.eu.lever.co" : "api.lever.co";
  const url = new URL(
    `/v0/postings/${encodeURIComponent(capability.tenant)}/${encodeURIComponent(externalId)}`,
    `https://${host}`,
  );
  url.searchParams.set("mode", "json");
  const response = await boundedSecureJsonGet({
    initialUrl: url.toString(),
    capability,
    operation: "GET_JOB",
    budget: input.budget,
    now: input.now,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  return parseLeverPosting(response.body, capability);
}
