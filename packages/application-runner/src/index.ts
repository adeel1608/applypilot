import type { CandidateProfile } from "@applypilot/candidate-profile";
import type { Job } from "@applypilot/job-model";

export * from "./beta";
export * from "./inspection-runner";
export * from "./lever-inspection-adapter";
export * from "./target-runner";
export * from "./private-target-allowlist";

export const ApplicationRunnerMode = {
  DISCOVERY_ONLY: "DISCOVERY_ONLY",
  ASSISTED_FILL: "ASSISTED_FILL",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  SUBMISSION_SUPPORTED: "SUBMISSION_SUPPORTED",
} as const;

export type ApplicationRunnerMode =
  (typeof ApplicationRunnerMode)[keyof typeof ApplicationRunnerMode];

export const AnswerCertainty = {
  VERIFIED_ANSWER: "VERIFIED_ANSWER",
  USER_CONFIRMATION_REQUIRED: "USER_CONFIRMATION_REQUIRED",
  UNKNOWN: "UNKNOWN",
} as const;

export type AnswerCertainty = (typeof AnswerCertainty)[keyof typeof AnswerCertainty];

export const AutomationStopReason = {
  CAPTCHA: "CAPTCHA",
  MFA: "MFA",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  BOT_DETECTION: "BOT_DETECTION",
  RATE_LIMIT: "RATE_LIMIT",
  ACCESS_CONTROL: "ACCESS_CONTROL",
  WEBSITE_RESTRICTION: "WEBSITE_RESTRICTION",
  PAGE_CHANGED: "PAGE_CHANGED",
} as const;

export interface ApplicationAnswer {
  questionKey: string;
  questionText: string;
  value: string | number | boolean | null;
  certainty: AnswerCertainty;
  profileFactReferences: string[];
}

export interface AnswerStore {
  get(questionKey: string): Promise<ApplicationAnswer | null>;
  put(answer: ApplicationAnswer): Promise<void>;
}

export interface PreparedApplication {
  mode: ApplicationRunnerMode;
  jobId: string;
  profileId: string;
  answers: ApplicationAnswer[];
  missingDocuments: string[];
  requiresHumanReview: true;
  finalSubmissionEnabled: false;
}

export interface ApplicationRunner {
  readonly mode: ApplicationRunnerMode;
  prepare(job: Job, profile: CandidateProfile): Promise<PreparedApplication>;
}

export class PhaseOnePreparationRunner implements ApplicationRunner {
  readonly mode = ApplicationRunnerMode.HUMAN_REVIEW_REQUIRED;

  async prepare(job: Job, profile: CandidateProfile): Promise<PreparedApplication> {
    const missingDocuments = [
      ...(job.documentRequirements.resumeRequired ? ["RESUME"] : []),
      ...(job.documentRequirements.coverLetterRequired ? ["COVER_LETTER"] : []),
      ...job.documentRequirements.other,
    ];
    return {
      mode: this.mode,
      jobId: job.id,
      profileId: profile.profileId,
      answers: [],
      missingDocuments,
      requiresHumanReview: true,
      finalSubmissionEnabled: false,
    };
  }
}
