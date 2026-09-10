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

const LeverCategoriesV2Schema = z
  .object({
    commitment: z.string().optional(),
    department: z.string().optional(),
    location: z.string().optional(),
    team: z.string().optional(),
    allLocations: z.array(z.string()).max(100).optional(),
  })
  .passthrough();

export const LeverPostingV2Schema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    text: z.string().min(1).max(1_000),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    descriptionPlain: z.string().max(500_000).default(""),
    additionalPlain: z.string().max(500_000).optional(),
    categories: LeverCategoriesV2Schema.optional(),
    country: z.string().max(100).optional(),
    workplaceType: z.enum(["onsite", "remote", "hybrid", "unspecified"]).optional(),
    salaryRange: z
      .object({
        min: z.number().finite().nonnegative().optional(),
        max: z.number().finite().nonnegative().optional(),
        currency: z.string().max(10).optional(),
        interval: z.string().max(50).optional(),
      })
      .passthrough()
      .optional(),
    createdAt: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const LeverPageV2Schema = z.array(LeverPostingV2Schema).max(100);
export type LeverPostingV2 = z.infer<typeof LeverPostingV2Schema>;

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
  salaryRange: LeverPostingV2["salaryRange"] | null;
  sourceUrl: string;
  applicationUrl: string;
  postedAt: string | null;
  contentDigest: string;
  rawPayload: LeverPostingV2;
}

function mapPosting(posting: LeverPostingV2, capability: SourceCapabilityV2): LeverPostingRecordV2 {
  const raw = JSON.stringify(posting);
  return {
    source: "LEVER",
    region: capability.region,
    tenant: capability.tenant,
    externalId: posting.id,
    title: posting.text.trim(),
    description: [posting.descriptionPlain, posting.additionalPlain].filter(Boolean).join("\n\n"),
    location: posting.categories?.location?.trim() || null,
    allLocations: [...new Set(posting.categories?.allLocations ?? [])],
    country: posting.country?.trim() || null,
    commitment: posting.categories?.commitment?.trim() || null,
    department: posting.categories?.department?.trim() || null,
    team: posting.categories?.team?.trim() || null,
    workplaceType: posting.workplaceType ?? null,
    salaryRange: posting.salaryRange ?? null,
    sourceUrl: posting.hostedUrl,
    applicationUrl: posting.applyUrl,
    postedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
    contentDigest: createHash("sha256").update(raw).digest("hex"),
    rawPayload: posting,
  };
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
  const page = LeverPageV2Schema.parse(response.body);
  if (page.length > pageSize) throw new SecureSourceError("PAGE_SIZE_EXCEEDED");
  const records = page.map((posting) => mapPosting(posting, capability));
  const pageDigest = createHash("sha256")
    .update(
      records.map(({ externalId, contentDigest }) => `${externalId}:${contentDigest}`).join("\n"),
    )
    .digest("hex");
  input.budget.consumePage(String(cursor), records.length, response.byteCount);
  const next = page.length === pageSize ? cursor + page.length : null;
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
  return mapPosting(LeverPostingV2Schema.parse(response.body), capability);
}
