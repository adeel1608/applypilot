import { z } from "zod";

const MutableInvalidationSchema = z.object({
  status: z.string().min(1),
  blockers: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});

/**
 * Update only mutable readiness fields.  Frozen packet data and provenance are
 * intentionally carried forward byte-for-byte at the value level; this helper
 * never recalculates or synthesizes a historical digest.
 */
export function mergePacketReadinessJson(
  readinessJson: string,
  mutation: z.input<typeof MutableInvalidationSchema>,
): string {
  const parsedMutation = MutableInvalidationSchema.parse(mutation);
  let existing: unknown;
  try {
    existing = JSON.parse(readinessJson) as unknown;
  } catch {
    throw new Error("PACKET_READINESS_CORRUPT");
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error("PACKET_READINESS_CORRUPT");
  }
  return JSON.stringify({
    ...(existing as Record<string, unknown>),
    ...parsedMutation,
  });
}
