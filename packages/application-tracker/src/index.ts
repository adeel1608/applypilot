import type { ApplicationStatus } from "@applypilot/job-model";
import type { BetaApplicationStatus } from "@applypilot/job-model";

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
