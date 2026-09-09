import { describe, expect, it } from "vitest";

import {
  r2FieldEvidence,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import { fixtureJob } from "../../../tests/fixture-data";

import { ownerCorrectedR2Normalization } from "./r2-corrections";

describe("R2 typed owner-correction overlay", () => {
  it("creates typed owner evidence and retains unrelated source evidence", () => {
    const unchangedField = r2FieldEvidence("source-date", "DATES", {
      kind: "DATE",
      value: "2026-09-01T00:00:00.000Z",
    });
    const unchangedRequirement = r2RequirementEvidence(
      "source-experience",
      "EXPERIENCE",
      "GENERAL",
      {
        kind: "TEXT",
        value: "Unrelated source requirement",
      },
    );
    const prior = r2TestNormalization({
      fields: [unchangedField],
      requirements: [unchangedRequirement],
    });
    const base = fixtureJob("job-retail-sales-assistant");
    const job = {
      ...base,
      location: "Melbourne VIC 3000",
      suburb: "Melbourne",
      state: "VIC" as const,
      postcode: "3000",
      country: "Australia",
      employmentType: "PART_TIME" as const,
      hoursPerWeek: { minimum: 12, maximum: 20 },
      hoursPerFortnight: { minimum: 24, maximum: 40 },
      salary: {
        minimum: 30,
        maximum: 35,
        currency: "AUD",
        period: "HOUR" as const,
        text: null,
      },
      schedule: {
        summary: "Fixed weekend shift",
        fixed: true,
        rosterType: "FIXED" as const,
        timezone: "Australia/Melbourne",
        shifts: [
          {
            day: "SATURDAY" as const,
            startTime: "09:00",
            endTime: "17:00",
            mandatory: true,
          },
        ],
      },
      trainingProvided: true,
      documentRequirements: { resumeRequired: true, coverLetterRequired: false, other: [] },
      coverLetterRequired: false,
      requirements: ["Customer service"],
      preferredRequirements: ["Communication"],
      requiredSkills: ["Teamwork"],
      workRightsRequirement: "VALID_AUSTRALIA" as const,
      vehicleRequirement: "NOT_REQUIRED" as const,
    };
    const changedFields = new Set([
      "location",
      "employmentType",
      "hoursPerWeek",
      "hoursPerFortnight",
      "salary",
      "schedule",
      "trainingProvided",
      "documentRequirements",
      "coverLetterRequired",
      "requirements",
      "preferredRequirements",
      "requiredSkills",
      "workRightsRequirement",
      "vehicleRequirement",
    ]);

    const result = ownerCorrectedR2Normalization({
      prior,
      job,
      changedFields,
      correctionId: "correction:typed",
    });

    expect(result.fieldEvidence).toContainEqual(unchangedField);
    expect(result.requirementEvidence).toContainEqual(unchangedRequirement);
    for (const kind of [
      "LOCATION",
      "EMPLOYMENT_TYPE",
      "HOURS",
      "SALARY",
      "SCHEDULE",
      "TRAINING",
      "DOCUMENT",
    ]) {
      expect(
        result.fieldEvidence.some(
          ({ state, normalizedValue }) =>
            state === "OWNER_CORRECTED" && normalizedValue.kind === kind,
        ),
      ).toBe(true);
    }
    expect(
      result.fieldEvidence.filter(({ normalizedValue }) => normalizedValue.kind === "HOURS"),
    ).toHaveLength(2);
    expect(result.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "OWNER_CORRECTED", modality: "REQUIRED" }),
        expect.objectContaining({ state: "OWNER_CORRECTED", modality: "PREFERRED" }),
        expect.objectContaining({
          state: "OWNER_CORRECTED",
          family: "WORK_RIGHTS",
          modality: "REQUIRED",
        }),
        expect.objectContaining({
          state: "OWNER_CORRECTED",
          family: "VEHICLE",
          modality: "NEGATED",
        }),
      ]),
    );
    expect(
      result.fieldEvidence
        .filter(({ state }) => state === "OWNER_CORRECTED")
        .every(({ ownerCorrectionId }) => ownerCorrectionId === "correction:typed"),
    ).toBe(true);
  });
});
