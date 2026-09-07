import { z } from "zod";

import {
  PublicPostingCapabilitySchema,
  PublicSourceError,
  assertPublicSourceOperation,
  boundedPublicGet,
  type PublicGetDependencies,
  type PublicPosting,
  type PublicPostingCapability,
} from "../public-postings";

const GreenhouseJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().min(1),
    absolute_url: z.url(),
    location: z.object({ name: z.string() }).optional(),
    content: z.string().default(""),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();
const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

function mapGreenhouseJob(
  job: z.infer<typeof GreenhouseJobSchema>,
  capability: PublicPostingCapability,
): PublicPosting {
  return {
    source: "GREENHOUSE",
    tenant: capability.tenant,
    externalId: String(job.id),
    title: job.title,
    location: job.location?.name || null,
    description: job.content,
    sourceUrl: job.absolute_url,
    applicationUrl: job.absolute_url,
    postedAt: job.updated_at ?? null,
    rawPayload: job,
  };
}

export async function readGreenhouseJobs(
  capabilityInput: PublicPostingCapability,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting[]> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "GREENHOUSE") throw new PublicSourceError("SOURCE_MISMATCH");
  assertPublicSourceOperation(capability, "LIST_JOBS");
  const url = new URL(
    `/v1/boards/${encodeURIComponent(capability.tenant)}/jobs`,
    "https://boards-api.greenhouse.io",
  );
  url.searchParams.set("content", "true");
  const response = GreenhouseResponseSchema.parse(
    await boundedPublicGet(url.toString(), capability, { ...options, byteLimit: 2_000_000 }),
  );
  if (response.jobs.length > capability.recordCap) {
    throw new PublicSourceError("RECORD_CAP_EXCEEDED");
  }
  return response.jobs.map((job) => mapGreenhouseJob(job, capability));
}

export async function readGreenhouseJob(
  capabilityInput: PublicPostingCapability,
  externalId: string,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "GREENHOUSE") throw new PublicSourceError("SOURCE_MISMATCH");
  assertPublicSourceOperation(capability, "GET_JOB");
  const id = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(externalId);
  const url = new URL(
    `/v1/boards/${encodeURIComponent(capability.tenant)}/jobs/${encodeURIComponent(id)}`,
    "https://boards-api.greenhouse.io",
  );
  const job = GreenhouseJobSchema.parse(
    await boundedPublicGet(url.toString(), capability, { ...options, byteLimit: 1_000_000 }),
  );
  return mapGreenhouseJob(job, capability);
}
