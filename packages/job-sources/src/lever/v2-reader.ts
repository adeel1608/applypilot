import { createHash } from "node:crypto";

import { z } from "zod";

import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  type SourceCapabilityV2,
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
    allLocations: z.array(z.string()).max(100).optional(),
  })
  .passthrough();

const LeverListV2Schema = z
  .object({
    text: z.string().max(5_000).default(""),
    content: z.string().max(500_000).default(""),
  })
  .passthrough();

export const LeverPostingV2Schema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    text: z.string().min(1).max(1_000),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    description: z.string().max(500_000).optional(),
    descriptionPlain: z.string().max(500_000).default(""),
    additional: z.string().max(500_000).optional(),
    additionalPlain: z.string().max(500_000).optional(),
    lists: z.array(LeverListV2Schema).max(100).default([]),
    categories: LeverCategoriesV2Schema.optional(),
    country: z.string().max(100).nullable().optional(),
    workplaceType: z.enum(["on-site", "remote", "hybrid", "unspecified"]).optional(),
    salaryRange: z
      .object({
        min: z.number().finite().nonnegative().optional(),
        max: z.number().finite().nonnegative().optional(),
        currency: z.string().max(10).optional(),
        interval: z.string().max(50).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const LeverPageV2Schema = z.array(LeverPostingV2Schema).max(100);
export type LeverPostingV2 = z.infer<typeof LeverPostingV2Schema>;

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

function mapPosting(posting: LeverPostingV2, capability: SourceCapabilityV2): LeverPostingRecordV2 {
  const raw = JSON.stringify(posting);
  const title = extractInertLeverText(posting.text);
  if (!title) throw new SecureSourceError("SCHEMA_CHANGED");
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
  return {
    source: "LEVER",
    region: capability.region,
    tenant: capability.tenant,
    externalId: posting.id,
    title,
    description,
    location: extractInertLeverText(posting.categories?.location ?? "") || null,
    allLocations: [
      ...new Set(
        (posting.categories?.allLocations ?? [])
          .map(extractInertLeverText)
          .filter((value) => Boolean(value)),
      ),
    ],
    country: extractInertLeverText(posting.country ?? "") || null,
    commitment: extractInertLeverText(posting.categories?.commitment ?? "") || null,
    department: extractInertLeverText(posting.categories?.department ?? "") || null,
    team: extractInertLeverText(posting.categories?.team ?? "") || null,
    workplaceType: posting.workplaceType === "on-site" ? "onsite" : (posting.workplaceType ?? null),
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

function responseBodyFailure(error: unknown): never {
  if (error instanceof SecureSourceError) {
    throw error.lifecycleStage
      ? error
      : new SecureSourceError(error.code, error.retryAfter, "RESPONSE_BODY");
  }
  throw new SecureSourceError("SCHEMA_CHANGED", null, "RESPONSE_BODY");
}

function parseLeverPage(input: unknown, capability: SourceCapabilityV2): LeverPostingRecordV2[] {
  try {
    return LeverPageV2Schema.parse(input).map((posting) => mapPosting(posting, capability));
  } catch (error) {
    responseBodyFailure(error);
  }
}

function parseLeverPosting(input: unknown, capability: SourceCapabilityV2): LeverPostingRecordV2 {
  try {
    return mapPosting(LeverPostingV2Schema.parse(input), capability);
  } catch (error) {
    responseBodyFailure(error);
  }
}

export interface LeverPageV2 {
  records: LeverPostingRecordV2[];
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
  const records = parseLeverPage(response.body, capability);
  if (records.length > pageSize) {
    throw new SecureSourceError("PAGE_SIZE_EXCEEDED", null, "RESPONSE_BODY");
  }
  const pageDigest = createHash("sha256")
    .update(
      records.map(({ externalId, contentDigest }) => `${externalId}:${contentDigest}`).join("\n"),
    )
    .digest("hex");
  input.budget.consumePage(String(cursor), records.length, response.byteCount);
  const next = records.length === pageSize ? cursor + records.length : null;
  return {
    records,
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
