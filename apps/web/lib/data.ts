import "server-only";

import profileJson from "../../../data/profile.example.json";
import { fixtureJobs } from "../../../fixtures/jobs";
import { seekFixtureCases } from "../../../fixtures/seek/manifest";

import { parseCandidateProfile } from "@applypilot/candidate-profile";
import { evaluateEligibility, type EligibilityResult } from "@applypilot/eligibility-engine";
import { scoreJobFit, type FitScoreResult } from "@applypilot/fit-scorer";
import type { Job } from "@applypilot/job-model";
import { normalizeSeekJob } from "@applypilot/job-sources";
import { selectResumeTemplate } from "@applypilot/resume-engine";
import { getJobImportRepository } from "@web/lib/local-database";

export const exampleProfile = parseCandidateProfile(profileJson);

export interface EvaluatedJob {
  job: Job;
  eligibility: EligibilityResult;
  fit: FitScoreResult;
  recommendedTemplate: ReturnType<typeof selectResumeTemplate>;
  recommendedAction: "SKIP" | "REVIEW" | "SHORTLIST";
}

const seekFixtureJobs: Job[] = [];
const seenSeekExternalIds = new Set<string>();
let seekDuplicateCount = 0;
let seekFailureCount = 0;
for (const fixture of seekFixtureCases) {
  if (fixture.record.status === "REMOVED") continue;
  try {
    const job = normalizeSeekJob(fixture.record);
    if (!job.externalId) {
      seekFailureCount += 1;
      continue;
    }
    if (seenSeekExternalIds.has(job.externalId)) {
      seekDuplicateCount += 1;
      continue;
    }
    seenSeekExternalIds.add(job.externalId);
    seekFixtureJobs.push(job);
  } catch {
    seekFailureCount += 1;
  }
}

const allFixtureJobs = [...fixtureJobs, ...seekFixtureJobs];

export const evaluatedJobs: EvaluatedJob[] = allFixtureJobs.map((job) => {
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

export const seekDiscoverySummary = {
  source: "SEEK",
  mode: "Fixture only",
  status: "Complete",
  counts: {
    discovered: seekFixtureCases.filter(({ record }) => record.status === "ACTIVE").length,
    added: seekFixtureJobs.length,
    updated: 0,
    duplicates: seekDuplicateCount,
    failed: seekFailureCount,
  },
  lastSuccessfulFetchAt: seekFixtureCases
    .filter(({ record }) => record.status === "ACTIVE")
    .map(({ record }) => record.fetchedAt)
    .sort()
    .at(-1)!,
  partial: false,
  liveModesEnabled: false,
} as const;

export function formatDiscoveryDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

export function getEvaluatedJob(id: string): EvaluatedJob | undefined {
  return evaluatedJobs.find(({ job }) => job.id === id);
}

export function getImportedJobs(): Job[] {
  return getJobImportRepository()?.listImportedJobs() ?? [];
}

export function getImportedJob(id: string): Job | undefined {
  return getImportedJobs().find((job) => job.id === id);
}

export function getImportSummary() {
  return (
    getJobImportRepository()?.latestSummary() ?? {
      lastBatchAt: null,
      imported: 0,
      updated: 0,
      duplicates: 0,
      review: 0,
      failed: 0,
    }
  );
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
