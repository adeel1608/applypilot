import { describe, expect, it } from "vitest";

import { evaluateEligibility } from "@applypilot/eligibility-engine";
import { scoreJobFit } from "@applypilot/fit-scorer";
import { JobArraySchema } from "@applypilot/job-model";
import { fixtureJobs } from "../../fixtures/jobs";
import { testProfile } from "../fixture-data";

describe("fixture evaluation pipeline", () => {
  it("validates and evaluates all fifteen normalized fixtures", () => {
    expect(JobArraySchema.parse(fixtureJobs)).toHaveLength(15);
    const results = fixtureJobs.map((job) => {
      const eligibility = evaluateEligibility(job, testProfile);
      const fit = scoreJobFit(job, testProfile, eligibility);
      return { id: job.id, eligibility: eligibility.status, score: fit.score };
    });
    expect(results).toHaveLength(15);
    expect(results.filter(({ eligibility }) => eligibility === "ELIGIBLE")).toHaveLength(6);
    expect(results.filter(({ eligibility }) => eligibility === "REVIEW_REQUIRED")).toHaveLength(1);
    expect(results.filter(({ eligibility }) => eligibility === "INELIGIBLE")).toHaveLength(8);
  });
});
