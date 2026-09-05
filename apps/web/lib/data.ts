import "server-only";

import profileJson from "../../../data/profile.example.json";
import { fixtureJobs } from "../../../fixtures/jobs";

import { parseCandidateProfile } from "@applypilot/candidate-profile";
import { evaluateEligibility, type EligibilityResult } from "@applypilot/eligibility-engine";
import { scoreJobFit, type FitScoreResult } from "@applypilot/fit-scorer";
import type { Job } from "@applypilot/job-model";
import { selectResumeTemplate } from "@applypilot/resume-engine";

export const exampleProfile = parseCandidateProfile(profileJson);

export interface EvaluatedJob {
  job: Job;
  eligibility: EligibilityResult;
  fit: FitScoreResult;
  recommendedTemplate: ReturnType<typeof selectResumeTemplate>;
  recommendedAction: "SKIP" | "REVIEW" | "SHORTLIST";
}

export const evaluatedJobs: EvaluatedJob[] = fixtureJobs.map((job) => {
  const eligibility = evaluateEligibility(job, exampleProfile);
  const fit = scoreJobFit(job, exampleProfile, eligibility);
  return {
    job: {
      ...job,
      eligibilityStatus: eligibility.status,
      eligibilityReasons: eligibility.reasons.map(({ message }) => message),
      fitScore: fit.score,
      fitReasons: [...fit.positive, ...fit.negative],
    },
    eligibility,
    fit,
    recommendedTemplate: selectResumeTemplate(job),
    recommendedAction:
      eligibility.status === "INELIGIBLE"
        ? "SKIP"
        : eligibility.status === "REVIEW_REQUIRED"
          ? "REVIEW"
          : fit.score >= 70
            ? "SHORTLIST"
            : "REVIEW",
  };
});

export function getEvaluatedJob(id: string): EvaluatedJob | undefined {
  return evaluatedJobs.find(({ job }) => job.id === id);
}

const preparedStatuses = new Set([
  "CV_READY",
  "COVER_LETTER_READY",
  "READY_TO_APPLY",
  "APPLICATION_IN_PROGRESS",
]);
const submittedStatuses = new Set(["APPLIED", "ASSESSMENT", "INTERVIEW", "REJECTED", "OFFER"]);

export const dashboardMetrics = [
  { label: "Jobs discovered", value: evaluatedJobs.length, tone: "neutral" },
  {
    label: "New jobs",
    value: evaluatedJobs.filter(({ job }) => job.applicationStatus === "NEW").length,
    tone: "neutral",
  },
  {
    label: "Eligible jobs",
    value: evaluatedJobs.filter(({ eligibility }) => eligibility.status === "ELIGIBLE").length,
    tone: "positive",
  },
  {
    label: "Review required",
    value: evaluatedJobs.filter(({ eligibility }) => eligibility.status === "REVIEW_REQUIRED")
      .length,
    tone: "warning",
  },
  {
    label: "Good fits",
    value: evaluatedJobs.filter(
      ({ eligibility, fit }) => eligibility.status === "ELIGIBLE" && fit.score >= 70,
    ).length,
    tone: "positive",
  },
  {
    label: "Applications prepared",
    value: evaluatedJobs.filter(({ job }) => preparedStatuses.has(job.applicationStatus)).length,
    tone: "accent",
  },
  {
    label: "Applications submitted",
    value: evaluatedJobs.filter(({ job }) => submittedStatuses.has(job.applicationStatus)).length,
    tone: "accent",
  },
  {
    label: "Assessments",
    value: evaluatedJobs.filter(({ job }) => job.applicationStatus === "ASSESSMENT").length,
    tone: "neutral",
  },
  {
    label: "Interviews",
    value: evaluatedJobs.filter(({ job }) => job.applicationStatus === "INTERVIEW").length,
    tone: "positive",
  },
  {
    label: "Rejections",
    value: evaluatedJobs.filter(({ job }) => job.applicationStatus === "REJECTED").length,
    tone: "negative",
  },
  {
    label: "Offers",
    value: evaluatedJobs.filter(({ job }) => job.applicationStatus === "OFFER").length,
    tone: "positive",
  },
] as const;
