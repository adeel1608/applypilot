import type { ApplicationStatus } from "@applypilot/job-model";

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
