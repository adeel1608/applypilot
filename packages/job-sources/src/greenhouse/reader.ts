import { z } from "zod";

import {
  PublicPostingCapabilitySchema,
  PublicSourceError,
  boundedPublicGet,
  type PublicGetDependencies,
  type PublicPosting,
  type PublicPostingCapability,
} from "../public-postings";

const GreenhouseResponseSchema = z.object({
  jobs: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string().min(1),
        absolute_url: z.url(),
        location: z.object({ name: z.string() }).optional(),
        content: z.string().default(""),
        updated_at: z.string().nullable().optional(),
      })
      .passthrough(),
  ),
});

export async function readGreenhouseJobs(
  capabilityInput: PublicPostingCapability,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting[]> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "GREENHOUSE") throw new PublicSourceError("SOURCE_MISMATCH");
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
  return response.jobs.map((job) => ({
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
  }));
}
