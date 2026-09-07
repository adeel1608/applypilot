import type { ApplicationStatus } from "@applypilot/job-model";
import { z } from "zod";

import { BetaApplicationStatusSchema, type BetaApplicationStatus } from "@applypilot/job-model";

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  occurredAt: string;
  note?: string;
  actor: "USER" | "SYSTEM" | "SOURCE";
}

const allowedTransitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NEW: ["REVIEWED", "INELIGIBLE", "REVIEW_REQUIRED", "GOOD_FIT", "SHORTLISTED", "WITHDRAWN"],
  REVIEWED: ["INELIGIBLE", "REVIEW_REQUIRED", "GOOD_FIT", "SHORTLISTED", "WITHDRAWN"],
  INELIGIBLE: ["REVIEW_REQUIRED", "WITHDRAWN"],
  REVIEW_REQUIRED: ["REVIEWED", "INELIGIBLE", "GOOD_FIT", "SHORTLISTED", "WITHDRAWN"],
  GOOD_FIT: ["SHORTLISTED", "CV_READY", "WITHDRAWN"],
  SHORTLISTED: ["CV_READY", "COVER_LETTER_READY", "READY_TO_APPLY", "WITHDRAWN"],
  CV_READY: ["COVER_LETTER_READY", "READY_TO_APPLY", "WITHDRAWN"],
  COVER_LETTER_READY: ["CV_READY", "READY_TO_APPLY", "WITHDRAWN"],
  READY_TO_APPLY: ["APPLICATION_IN_PROGRESS", "WITHDRAWN"],
  APPLICATION_IN_PROGRESS: ["READY_TO_APPLY", "APPLIED", "WITHDRAWN"],
  APPLIED: ["ASSESSMENT", "INTERVIEW", "REJECTED", "OFFER", "WITHDRAWN"],
  ASSESSMENT: ["INTERVIEW", "REJECTED", "OFFER", "WITHDRAWN"],
  INTERVIEW: ["ASSESSMENT", "REJECTED", "OFFER", "WITHDRAWN"],
  REJECTED: [],
  OFFER: ["WITHDRAWN"],
  WITHDRAWN: [],
};

export function canTransitionApplication(
  fromStatus: ApplicationStatus,
  toStatus: ApplicationStatus,
): boolean {
  return allowedTransitions[fromStatus].includes(toStatus);
}

export function assertApplicationTransition(
  fromStatus: ApplicationStatus,
  toStatus: ApplicationStatus,
): void {
  if (!canTransitionApplication(fromStatus, toStatus)) {
    throw new Error(`Application cannot transition from ${fromStatus} to ${toStatus}`);
  }
}

const betaTransitions: Record<BetaApplicationStatus, readonly BetaApplicationStatus[]> = {
  DISCOVERED: ["REVIEWING", "SHORTLISTED", "WITHDRAWN", "EXPIRED"],
  REVIEWING: ["DISCOVERED", "SHORTLISTED", "WITHDRAWN", "EXPIRED"],
  SHORTLISTED: ["REVIEWING", "PREPARING", "WITHDRAWN", "EXPIRED"],
  PREPARING: ["SHORTLISTED", "READY_TO_APPLY", "WITHDRAWN", "EXPIRED"],
  READY_TO_APPLY: ["PREPARING", "APPLICATION_IN_PROGRESS", "WITHDRAWN", "EXPIRED"],
  APPLICATION_IN_PROGRESS: ["PREPARING", "READY_FOR_FINAL_REVIEW", "WITHDRAWN"],
  READY_FOR_FINAL_REVIEW: ["APPLICATION_IN_PROGRESS", "SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  ASSESSMENT: ["INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["ASSESSMENT", "OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export function canTransitionBetaApplication(
  fromStatus: BetaApplicationStatus,
  toStatus: BetaApplicationStatus,
): boolean {
  return betaTransitions[fromStatus].includes(toStatus);
}

export function legacyStatusToBeta(status: ApplicationStatus): BetaApplicationStatus {
  if (status === "NEW") return "DISCOVERED";
  if (status === "REVIEWED") return "REVIEWING";
  if (status === "APPLIED") return "SUBMITTED";
  if (status === "CV_READY" || status === "COVER_LETTER_READY") return "PREPARING";
  if (status === "GOOD_FIT" || status === "REVIEW_REQUIRED" || status === "INELIGIBLE") {
    return "REVIEWING";
  }
  return status as BetaApplicationStatus;
}

export const BetaApplicationEventSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1).nullable(),
  packetId: z.string().min(1).nullable(),
  fromStatus: BetaApplicationStatusSchema.nullable(),
  toStatus: BetaApplicationStatusSchema,
  eventType: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
  actor: z.enum(["LOCAL_USER", "SYSTEM", "SOURCE", "RUNNER"]),
  idempotencyKey: z.string().min(1).max(200),
  metadata: z
    .object({
      reasonCode: z.string().min(1).max(100).optional(),
      packetVersion: z.number().int().positive().optional(),
      outcomeSource: z.enum(["LOCAL_USER", "SYNTHETIC_FIXTURE", "SOURCE_STATUS"]).optional(),
    })
    .strict(),
  occurredAt: z.iso.datetime(),
});

export type BetaApplicationEvent = z.infer<typeof BetaApplicationEventSchema>;

export function projectBetaApplicationEvents(events: BetaApplicationEvent[]): {
  status: BetaApplicationStatus | null;
  timeline: BetaApplicationEvent[];
} {
  let status: BetaApplicationStatus | null = null;
  const timeline: BetaApplicationEvent[] = [];
  const idempotency = new Map<string, string>();
  for (const candidate of events) {
    const event = BetaApplicationEventSchema.parse(candidate);
    const serialized = JSON.stringify(event);
    const previous = idempotency.get(event.idempotencyKey);
    if (previous) {
      if (previous !== serialized) throw new Error("APPLICATION_EVENT_IDEMPOTENCY_CONFLICT");
      continue;
    }
    if (status === null) {
      if (event.fromStatus !== null || event.toStatus !== "DISCOVERED") {
        throw new Error("APPLICATION_TIMELINE_MUST_START_DISCOVERED");
      }
    } else {
      if (event.fromStatus !== status) throw new Error("APPLICATION_EVENT_FROM_STATUS_MISMATCH");
      if (!canTransitionBetaApplication(status, event.toStatus)) {
        throw new Error(`Application cannot transition from ${status} to ${event.toStatus}`);
      }
    }
    idempotency.set(event.idempotencyKey, serialized);
    timeline.push(event);
    status = event.toStatus;
  }
  return { status, timeline };
}
