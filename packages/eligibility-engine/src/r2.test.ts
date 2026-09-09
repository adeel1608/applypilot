import { describe, expect, it } from "vitest";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import {
  currentR2Bindings,
  r2FieldEvidence,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";

import { evaluateR2Eligibility } from "./r2";

const evaluatedAt = "2026-09-09T00:00:00.000Z";

function evaluate(normalization: ReturnType<typeof r2TestNormalization>, profile = testProfile) {
  return evaluateR2Eligibility({
    profile,
    normalization,
    bindings: currentR2Bindings,
    evaluatedAt,
  });
}

describe("R2 eligibility", () => {
  it("keeps valid and unrestricted Australian work rights distinct", () => {
    const valid = r2RequirementEvidence("rights-valid", "WORK_RIGHTS", "WORK_RIGHTS", {
      kind: "WORK_RIGHTS",
      value: { kind: "VALID_AUSTRALIAN_WORK_RIGHTS", wording: null, condition: null },
    });
    expect(evaluate(r2TestNormalization({ requirements: [valid] })).status).toBe("ELIGIBLE");

    const unrestricted = r2RequirementEvidence(
      "rights-unrestricted",
      "WORK_RIGHTS",
      "WORK_RIGHTS",
      {
        kind: "WORK_RIGHTS",
        value: { kind: "UNRESTRICTED_WORK_RIGHTS", wording: null, condition: null },
      },
    );
    const result = evaluate(r2TestNormalization({ requirements: [unrestricted] }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons.map(({ code }) => code)).toContain(
      "R2_UNRESTRICTED_WORK_RIGHTS_MISMATCH",
    );
  });

  it("routes unknown and conditional material requirements to review", () => {
    const unknown = r2RequirementEvidence(
      "requirement-unknown",
      "CERTIFICATIONS",
      "CERTIFICATION",
      { kind: "UNKNOWN", value: null },
      { state: "UNKNOWN" },
    );
    const conditional = r2RequirementEvidence(
      "requirement-conditional",
      "CERTIFICATIONS",
      "CERTIFICATION",
      {
        kind: "LICENCE_CERTIFICATION",
        value: {
          name: "Fictional Service Certificate",
          type: "CERTIFICATION",
          class: null,
          jurisdiction: null,
          validityRequirement: null,
          alternatives: [],
          condition: "Only for evening duties",
        },
      },
      { modality: "CONDITIONAL", condition: "Only for evening duties" },
    );
    for (const requirement of [unknown, conditional]) {
      expect(evaluate(r2TestNormalization({ requirements: [requirement] })).status).toBe(
        "REVIEW_REQUIRED",
      );
    }
  });

  it("does not convert weekly hours into fortnightly legal hours", () => {
    const weekly = r2FieldEvidence("hours-week", "HOURS", {
      kind: "HOURS",
      value: { minimum: 30, maximum: 30, unit: "WEEK" },
    });
    const weeklyResult = evaluate(r2TestNormalization({ fields: [weekly] }));
    expect(weeklyResult.reasons.map(({ code }) => code)).not.toContain(
      "R2_LEGAL_FORTNIGHT_HOURS_MISMATCH",
    );
    expect(weeklyResult.reasons.map(({ code }) => code)).toContain(
      "R2_WEEK_HOURS_PREFERENCE_MISMATCH",
    );

    const fortnightly = r2FieldEvidence("hours-fortnight", "HOURS", {
      kind: "HOURS",
      value: { minimum: 76, maximum: 76, unit: "FORTNIGHT" },
    });
    expect(
      evaluate(r2TestNormalization({ fields: [fortnightly] })).reasons.map(({ code }) => code),
    ).toContain("R2_LEGAL_FORTNIGHT_HOURS_MISMATCH");
  });

  it("keeps licences, vehicle access, and commute as separate propositions", () => {
    const vehicle = r2RequirementEvidence("vehicle", "VEHICLE", "VEHICLE", {
      kind: "VEHICLE_TRAVEL",
      value: {
        kind: "OWN_VEHICLE",
        percentage: null,
        location: null,
        distanceKm: null,
        durationMinutes: null,
      },
    });
    const result = evaluate(r2TestNormalization({ requirements: [vehicle] }));
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons.map(({ code }) => code)).toContain("R2_OWN_VEHICLE_MISMATCH");
    expect(result.reasons.map(({ code }) => code)).not.toContain("R2_MANDATORY_LICENCE_MISMATCH");
  });

  it("compares only explicit fixed schedule intervals", () => {
    const conflicting = r2FieldEvidence("schedule-conflict", "SCHEDULE", {
      kind: "SCHEDULE",
      value: {
        days: ["WEDNESDAY"],
        startTime: "10:00",
        endTime: "12:00",
        rosterType: "FIXED",
        overnight: false,
        timezone: "Australia/Melbourne",
        exceptions: [],
      },
    });
    expect(
      evaluate(r2TestNormalization({ fields: [conflicting] })).reasons.map(({ code }) => code),
    ).toContain("R2_FIXED_SCHEDULE_CONFLICT");

    const compatible = r2FieldEvidence("schedule-compatible", "SCHEDULE", {
      kind: "SCHEDULE",
      value: {
        days: ["MONDAY"],
        startTime: "10:00",
        endTime: "12:00",
        rosterType: "FIXED",
        overnight: false,
        timezone: "Australia/Melbourne",
        exceptions: [],
      },
    });
    expect(evaluate(r2TestNormalization({ fields: [compatible] })).status).toBe("ELIGIBLE");
  });

  it("handles rotating, flexible, on-call, overnight, weekday, and weekend schedules conservatively", () => {
    const schedule = (
      id: string,
      value: {
        days: Array<
          "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY"
        >;
        startTime: string | null;
        endTime: string | null;
        rosterType: "FIXED" | "FLEXIBLE" | "ROTATING" | "ON_CALL" | "UNKNOWN";
        overnight: boolean | null;
      },
    ) =>
      r2FieldEvidence(id, "SCHEDULE", {
        kind: "SCHEDULE",
        value: {
          ...value,
          timezone: "Australia/Melbourne",
          exceptions: [],
        },
      });

    const weekdayRotating = schedule("weekday-rotating", {
      days: ["MONDAY", "TUESDAY"],
      startTime: "10:00",
      endTime: "12:00",
      rosterType: "ROTATING",
      overnight: false,
    });
    expect(evaluate(r2TestNormalization({ fields: [weekdayRotating] })).status).toBe("ELIGIBLE");

    const weekendFixed = schedule("weekend-fixed", {
      days: ["SATURDAY", "SUNDAY"],
      startTime: "10:00",
      endTime: "18:00",
      rosterType: "FIXED",
      overnight: false,
    });
    expect(evaluate(r2TestNormalization({ fields: [weekendFixed] })).status).toBe("ELIGIBLE");

    const flexible = schedule("flexible", {
      days: [],
      startTime: null,
      endTime: null,
      rosterType: "FLEXIBLE",
      overnight: null,
    });
    expect(evaluate(r2TestNormalization({ fields: [flexible] })).status).toBe("ELIGIBLE");

    for (const variable of [
      schedule("rotating-unknown", {
        days: [],
        startTime: null,
        endTime: null,
        rosterType: "ROTATING",
        overnight: null,
      }),
      schedule("on-call", {
        days: [],
        startTime: null,
        endTime: null,
        rosterType: "ON_CALL",
        overnight: null,
      }),
      schedule("unknown-roster", {
        days: [],
        startTime: null,
        endTime: null,
        rosterType: "UNKNOWN",
        overnight: null,
      }),
    ]) {
      expect(evaluate(r2TestNormalization({ fields: [variable] })).status).toBe("REVIEW_REQUIRED");
    }

    const overnight = schedule("overnight", {
      days: ["SATURDAY"],
      startTime: "21:00",
      endTime: "02:00",
      rosterType: "FIXED",
      overnight: true,
    });
    const overnightProfile = CandidateProfileSchema.parse({
      ...testProfile,
      availability: {
        ...testProfile.availability,
        recurring: [
          ...testProfile.availability.recurring.filter(({ day }) => day !== "SATURDAY"),
          {
            day: "SATURDAY",
            startTime: "20:00",
            endTime: "06:00",
            available: true,
            verification: "VERIFIED",
          },
        ],
      },
    });
    expect(evaluate(r2TestNormalization({ fields: [overnight] }), overnightProfile).status).toBe(
      "ELIGIBLE",
    );
  });

  it("requires review for date-bound work-right conditions without giving legal advice", () => {
    const condition = r2RequirementEvidence("rights-condition", "WORK_RIGHTS", "WORK_RIGHTS", {
      kind: "WORK_RIGHTS",
      value: {
        kind: "HOURS_CONDITION",
        wording: "Hours depend on the current visa period",
        condition: "Current period must be confirmed",
      },
    });
    const result = evaluate(r2TestNormalization({ requirements: [condition] }));
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.disclaimer).toBe("NOT_LEGAL_ADVICE");
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "R2_WORK_RIGHT_CONDITION_REVIEW_REQUIRED",
        evidenceClass: "LEGAL_LIMIT",
      }),
    );
  });

  it("marks stale version bindings review-required", () => {
    const result = evaluateR2Eligibility({
      profile: CandidateProfileSchema.parse(testProfile),
      normalization: r2TestNormalization({}),
      bindings: { ...currentR2Bindings, currentJobVersionId: "newer-job-version" },
      evaluatedAt,
    });
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.current).toBe(false);
  });
});
