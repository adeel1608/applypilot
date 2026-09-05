import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import { ApplicationRunnerMode, PhaseOnePreparationRunner } from "./index";

describe("Phase 0/1 application runner", () => {
  it("prepares required documents but cannot submit", async () => {
    const result = await new PhaseOnePreparationRunner().prepare(
      fixtureJob("job-junior-receptionist"),
      testProfile,
    );
    expect(result.mode).toBe(ApplicationRunnerMode.HUMAN_REVIEW_REQUIRED);
    expect(result.missingDocuments).toEqual(["RESUME", "COVER_LETTER"]);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.finalSubmissionEnabled).toBe(false);
  });
});
