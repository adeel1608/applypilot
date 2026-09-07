import { z } from "zod";

import {
  PublicPostingCapabilitySchema,
  PublicSourceError,
  boundedPublicGet,
  type PublicGetDependencies,
  type PublicPosting,
  type PublicPostingCapability,
} from "../public-postings";

const LeverResponseSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      text: z.string().min(1),
      hostedUrl: z.url(),
      applyUrl: z.url(),
      descriptionPlain: z.string().default(""),
      categories: z.object({ location: z.string().optional() }).passthrough().optional(),
      createdAt: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
);

export async function readLeverJobs(
  capabilityInput: PublicPostingCapability,
  options: { now?: Date; dependencies?: PublicGetDependencies } = {},
): Promise<PublicPosting[]> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  if (capability.source !== "LEVER") throw new PublicSourceError("SOURCE_MISMATCH");
  const base = capability.region === "EU" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = new URL(`/v0/postings/${encodeURIComponent(capability.tenant)}`, base);
  url.searchParams.set("mode", "json");
  const response = LeverResponseSchema.parse(
    await boundedPublicGet(url.toString(), capability, { ...options, byteLimit: 2_000_000 }),
  );
  if (response.length > capability.recordCap) throw new PublicSourceError("RECORD_CAP_EXCEEDED");
  return response.map((job) => ({
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
  }));
}
