import { z } from "zod";

import {
  PublicPostingCapabilitySchema,
  PublicSourceError,
  assertPublicSourceOperation,
  boundedPublicGet,
  type PublicGetDependencies,
  type PublicPosting,
  type PublicPostingPage,
  type PublicPostingCapability,
} from "../public-postings";

const LeverJobSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    descriptionPlain: z.string().default(""),
    categories: z.object({ location: z.string().optional() }).passthrough().optional(),
    createdAt: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const LeverResponseSchema = z.array(LeverJobSchema);

function mapLeverJob(
  job: z.infer<typeof LeverJobSchema>,
  capability: PublicPostingCapability,
): PublicPosting {
  return {
    source: "LEVER",
    tenant: capability.tenant,
    externalId: job.id,
    title: job.text,
    location: job.categories?.location || null,
    description: job.descriptionPlain,
    sourceUrl: job.hostedUrl,
    applicationUrl: job.applyUrl,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    rawPayload: job,
  };
}

export async function readLeverJobs(
  capabilityInput: PublicPostingCapability,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting[]> {
  const page = await readLeverJobsPage(capabilityInput, { ...options });
  if (page.nextCursor) throw new PublicSourceError("RECORD_CAP_EXCEEDED");
  return page.records;
}

export async function readLeverJobsPage(
  capabilityInput: PublicPostingCapability,
  options: {
    now?: Date;
    dependencies?: PublicGetDependencies;
    cursor?: string | null;
    pageSize?: number;
  } = {},
): Promise<PublicPostingPage> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "LEVER") throw new PublicSourceError("SOURCE_MISMATCH");
  assertPublicSourceOperation(capability, "LIST_JOBS");
  const base = capability.region === "EU" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = new URL(`/v0/postings/${encodeURIComponent(capability.tenant)}`, base);
  const skip = options.cursor
    ? z.coerce.number().int().nonnegative().max(capability.recordCap).parse(options.cursor)
    : 0;
  const pageSize = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(options.pageSize ?? Math.min(100, capability.recordCap));
  if (skip + pageSize > capability.recordCap) throw new PublicSourceError("RECORD_CAP_EXCEEDED");
  url.searchParams.set("mode", "json");
  url.searchParams.set("skip", String(skip));
  url.searchParams.set("limit", String(pageSize));
  const response = LeverResponseSchema.parse(
    await boundedPublicGet(url.toString(), capability, { ...options, byteLimit: 2_000_000 }),
  );
  if (response.length > pageSize) throw new PublicSourceError("PAGE_SIZE_EXCEEDED");
  const next = response.length === pageSize ? skip + response.length : null;
  return {
    records: response.map((job) => mapLeverJob(job, capability)),
    nextCursor: next !== null && next < capability.recordCap ? String(next) : null,
    requestCount: 1,
  };
}

export async function readLeverJob(
  capabilityInput: PublicPostingCapability,
  externalId: string,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "LEVER") throw new PublicSourceError("SOURCE_MISMATCH");
  assertPublicSourceOperation(capability, "GET_JOB");
  const id = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(externalId);
  const base = capability.region === "EU" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = new URL(
    `/v0/postings/${encodeURIComponent(capability.tenant)}/${encodeURIComponent(id)}`,
    base,
  );
  url.searchParams.set("mode", "json");
  const job = LeverJobSchema.parse(
    await boundedPublicGet(url.toString(), capability, { ...options, byteLimit: 1_000_000 }),
  );
  return mapLeverJob(job, capability);
}
