import { describe, expect, it } from "vitest";

import { filterJobQueue, ownerQueueLabel, type JobQueueFilterItem } from "./job-filters";

const base: JobQueueFilterItem = {
  eligibilityStatus: "REVIEW_REQUIRED",
  fitScore: 72,
  coverage: { percent: 75, missingDimensions: ["roster"] },
  category: "Hospitality",
  employmentType: "PART_TIME",
  source: "SEEK",
  location: "Sydney NSW",
  state: "NSW",
  expiresAt: null,
  unknownRequirementCount: 1,
  queueState: "REVIEWING",
  queueReason: "OWNER_REVIEW_LATER",
};

describe("real job queue filters", () => {
  it("combines every safety-relevant filter without changing the records", () => {
    const result = filterJobQueue([base], {
      eligibility: "REVIEW_REQUIRED",
      fit: "HIGH",
      coverage: "MEDIUM",
      category: "Hospitality",
      employmentType: "PART_TIME",
      source: "SEEK",
      location: "sydney",
      state: "NSW",
      expiry: "UNKNOWN",
      unknownRequirements: "YES",
      queue: "REVIEW_LATER",
    });
    expect(result).toEqual([base]);
  });

  it("distinguishes archive from skip while preserving the durable schema state", () => {
    expect(ownerQueueLabel({ queueState: "SKIPPED", queueReason: "OWNER_ARCHIVED" })).toBe(
      "ARCHIVE",
    );
    expect(ownerQueueLabel({ queueState: "SKIPPED", queueReason: "OWNER_SKIPPED" })).toBe("SKIP");
    expect(
      filterJobQueue([{ ...base, queueState: "SKIPPED", queueReason: "OWNER_ARCHIVED" }], {
        queue: "SKIP",
      }),
    ).toEqual([]);
  });
});
