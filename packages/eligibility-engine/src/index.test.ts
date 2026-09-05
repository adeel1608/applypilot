import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import { evaluateEligibility } from "./index";

describe("eligibility engine", () => {
  it.each([
    "job-retail-sales-assistant",
    "job-fast-food-team-member",
    "job-junior-receptionist",
    "job-customer-service",
    "job-robotics-internship",
    "job-administration",
  ])("marks %s eligible", (id) => {
    expect(evaluateEligibility(fixtureJob(id), testProfile).status).toBe("ELIGIBLE");
  });

  it.each([
    ["job-registered-nurse", "MANDATORY_QUALIFICATION_MISSING"],
    ["job-sonographer", "MANDATORY_QUALIFICATION_MISSING"],
    ["job-truck-driver", "MANDATORY_LICENCE_MISSING"],
    ["job-own-vehicle", "VEHICLE_REQUIRED"],
    ["job-unrestricted-work-rights", "UNRESTRICTED_WORK_RIGHTS_REQUIRED"],
    ["job-timetable-conflict", "FIXED_TIMETABLE_CONFLICT"],
    ["job-excessive-hours", "WEEKLY_HOURS_EXCEED_LIMIT"],
    ["job-warehouse", "MANDATORY_EXPERIENCE_MISSING"],
  ])("marks %s ineligible with %s", (id, expectedCode) => {
    const result = evaluateEligibility(fixtureJob(id), testProfile);
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons.map(({ code }) => code)).toContain(expectedCode);
  });

  it("routes ambiguous requirements to review", () => {
    const result = evaluateEligibility(fixtureJob("job-automation-internship"), testProfile);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasons.map(({ code }) => code)).toContain("AMBIGUOUS_REQUIREMENT");
  });

  it("never treats unknown mandatory licence data as true", () => {
    const job = {
      ...fixtureJob("job-retail-sales-assistant"),
      licences: [{ name: "Forklift licence", mandatory: true }],
    };
    const result = evaluateEligibility(job, testProfile);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasons.map(({ code }) => code)).toContain("MANDATORY_LICENCE_UNCONFIRMED");
  });
});
