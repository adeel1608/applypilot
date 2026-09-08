import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalizeJobUrl } from "@applypilot/job-importer";
import { normalizeText } from "@applypilot/shared";

export const ObservationIdentitySchema = z.object({
  observationId: z.string().min(1),
  source: z.string().min(1),
  tenant: z.string().min(1).nullable(),
  externalId: z.string().min(1).nullable(),
  applicationUrl: z.url().nullable(),
  requisitionId: z.string().min(1).nullable(),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().min(1),
  employmentType: z.string().min(1),
  datePosted: z.iso.datetime().nullable(),
  description: z.string().min(1),
});

export type ObservationIdentity = z.infer<typeof ObservationIdentitySchema>;

export interface CrossSourceDuplicateDecision {
  leftObservationId: string;
  rightObservationId: string;
  decision: "SAME_OBSERVATION" | "SUGGEST_LINK" | "KEEP_SEPARATE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedSignals: string[];
  conflictingSignals: string[];
  requiresHumanReview: boolean;
}

function descriptionFingerprint(value: string): string {
  return createHash("sha256").update(normalizeText(value)).digest("hex");
}

function equivalent(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

export function compareCrossSourceObservations(
  leftInput: ObservationIdentity,
  rightInput: ObservationIdentity,
): CrossSourceDuplicateDecision {
  const left = ObservationIdentitySchema.parse(leftInput);
  const right = ObservationIdentitySchema.parse(rightInput);
  const matchedSignals: string[] = [];
  const conflictingSignals: string[] = [];

  if (
    left.source === right.source &&
    left.tenant === right.tenant &&
    left.externalId &&
    left.externalId === right.externalId
  ) {
    return {
      leftObservationId: left.observationId,
      rightObservationId: right.observationId,
      decision: "SAME_OBSERVATION",
      confidence: "HIGH",
      matchedSignals: ["source", "tenant", "externalId"],
      conflictingSignals,
      requiresHumanReview: false,
    };
  }

  if (
    left.externalId &&
    right.externalId &&
    left.externalId === right.externalId &&
    left.tenant !== right.tenant
  ) {
    conflictingSignals.push("tenant_external_id_collision");
  }
  const leftUrl = left.applicationUrl ? canonicalizeJobUrl(left.applicationUrl) : null;
  const rightUrl = right.applicationUrl ? canonicalizeJobUrl(right.applicationUrl) : null;
  if (leftUrl && rightUrl) {
    if (leftUrl === rightUrl) matchedSignals.push("applicationUrl");
    else conflictingSignals.push("applicationUrl");
  }
  if (left.requisitionId && right.requisitionId) {
    if (left.requisitionId === right.requisitionId) matchedSignals.push("requisitionId");
    else conflictingSignals.push("requisitionId");
  }
  for (const key of ["company", "title", "location", "employmentType"] as const) {
    if (equivalent(left[key], right[key])) matchedSignals.push(key);
    else conflictingSignals.push(key);
  }
  if (descriptionFingerprint(left.description) === descriptionFingerprint(right.description)) {
    matchedSignals.push("descriptionFingerprint");
  }

  const strong =
    matchedSignals.includes("applicationUrl") || matchedSignals.includes("requisitionId");
  const corroborated = ["company", "title", "location"].every((signal) =>
    matchedSignals.includes(signal),
  );
  if (strong && corroborated && !conflictingSignals.includes("tenant_external_id_collision")) {
    return {
      leftObservationId: left.observationId,
      rightObservationId: right.observationId,
      decision: "SUGGEST_LINK",
      confidence: "HIGH",
      matchedSignals,
      conflictingSignals,
      requiresHumanReview: true,
    };
  }
  return {
    leftObservationId: left.observationId,
    rightObservationId: right.observationId,
    decision: "KEEP_SEPARATE",
    confidence: corroborated ? "MEDIUM" : "LOW",
    matchedSignals,
    conflictingSignals,
    requiresHumanReview: matchedSignals.length > 0,
  };
}
