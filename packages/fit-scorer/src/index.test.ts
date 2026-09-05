import { describe, expect, it } from "vitest";

import { evaluateEligibility } from "@applypilot/eligibility-engine";
import { fixtureJobs } from "../../../fixtures/jobs";
import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import { scoreJobFit } from "./index";

describe("fit scorer", () => {
  it("keeps every fixture within 0-100 and explains every change", () => {
    for (const job of fixtureJobs) {
      const result = scoreJobFit(job, testProfile, evaluateEligibility(job, testProfile));
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.contributions.length).toBeGreaterThan(0);
      expect(result.contributions.every(({ explanation }) => explanation.length > 0)).toBe(true);
    }
  });

  it("explains positive and negative retail signals", () => {
    const job = fixtureJob("job-retail-sales-assistant");
    const result = scoreJobFit(job, testProfile, evaluateEligibility(job, testProfile));
    expect(result.positive.some((reason) => reason.includes("Preston"))).toBe(true);
    expect(result.positive.some((reason) => reason.includes("Customer service"))).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("penalizes a verified blocker without hiding the explanation", () => {
    const job = fixtureJob("job-own-vehicle");
    const result = scoreJobFit(job, testProfile, evaluateEligibility(job, testProfile));
    expect(result.negative).toContain("- Verified eligibility blocker present");
  });
});
