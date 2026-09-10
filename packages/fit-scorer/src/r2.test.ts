import { describe, expect, it } from "vitest";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  currentR2Bindings,
  r2FieldEvidence,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";

import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit, type R2FitInput } from "./r2";

function score(input: Omit<R2FitInput, "calibrationContext">) {
  return scoreR2JobFit({ ...input, calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT });
}

function eligible(normalization: ReturnType<typeof r2TestNormalization>, profile = testProfile) {
  return evaluateR2Eligibility({
    profile,
    normalization,
    bindings: currentR2Bindings,
    evaluatedAt: "2026-09-09T00:00:00.000Z",
  });
}

describe("R2 fit scoring", () => {
  it("awards positive points only from verified candidate facts with evidence references", () => {
    const skill = r2RequirementEvidence("skill-customer", "SKILLS", "SKILL", {
      kind: "TEXT",
      value: "Customer service",
    });
    const normalization = r2TestNormalization({ requirements: [skill] });
    const result = score({
      profile: testProfile,
      normalization,
      eligibility: eligible(normalization),
    });
    expect(result.contributions).toContainEqual(
      expect.objectContaining({
        code: "R2_REQUIRED_SKILL_VERIFIED_MATCH",
        points: 7,
        candidateFactReferences: ["skills.skill-customer-service"],
        jobEvidenceReferences: ["skill-customer"],
      }),
    );
    expect(
      result.contributions
        .filter(({ points }) => points > 0)
        .every(({ candidateFactReferences }) => candidateFactReferences.length > 0),
    ).toBe(true);
  });

  it("gives unverified commute limits zero positive and zero negative points", () => {
    const commute = r2FieldEvidence(
      "commute-distance",
      "GEOGRAPHY",
      {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: 60,
          durationMinutes: null,
        },
      },
      { canonicalField: "commute.distance" },
    );
    const normalization = r2TestNormalization({ fields: [commute] });
    const profile = CandidateProfileSchema.parse({
      ...testProfile,
      transport: {
        ...testProfile.transport,
        maximumCommuteKm: {
          value: 30,
          verification: "USER_CONFIRMATION_REQUIRED",
        },
      },
    });
    const result = score({
      profile,
      normalization,
      eligibility: eligible(normalization, profile),
      commute: { distanceKm: 60, durationMinutes: null },
    });
    expect(result.contributions.filter(({ code }) => code.includes("COMMUTE_DISTANCE"))).toEqual(
      [],
    );
  });

  it("never recommends review-required or ineligible work regardless of score", () => {
    const unknown = r2RequirementEvidence(
      "unknown-material",
      "WORK_RIGHTS",
      "WORK_RIGHTS",
      { kind: "UNKNOWN", value: null },
      { state: "UNKNOWN" },
    );
    const normalization = r2TestNormalization({ requirements: [unknown] });
    const eligibility = eligible(normalization);
    expect(eligibility.status).toBe("REVIEW_REQUIRED");
    const result = score({
      profile: testProfile,
      normalization,
      eligibility,
      recommendationThreshold: 0,
    });
    expect(result.recommended).toBe(false);
    expect(result.recommendationBlockers).toContain("ELIGIBILITY_NOT_ELIGIBLE");
  });

  it("keeps commute time and distance independent", () => {
    const commute = r2FieldEvidence(
      "commute-time",
      "GEOGRAPHY",
      {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: null,
          durationMinutes: 50,
        },
      },
      { canonicalField: "commute.duration" },
    );
    const normalization = r2TestNormalization({ fields: [commute] });
    const result = score({
      profile: testProfile,
      normalization,
      eligibility: eligible(normalization),
      commute: { distanceKm: null, durationMinutes: 50 },
    });
    expect(result.contributions.filter(({ code }) => code.includes("COMMUTE_"))).toEqual([]);
  });

  it("consumes actual R2A commute fields without crossing time and distance units", () => {
    const profile = CandidateProfileSchema.parse({
      ...testProfile,
      transport: {
        ...testProfile.transport,
        maximumCommuteMinutes: { value: 45, verification: "VERIFIED" },
      },
    });
    const distance = r2FieldEvidence(
      "commute-field-distance",
      "GEOGRAPHY",
      {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: 25,
          durationMinutes: null,
        },
      },
      { canonicalField: "commute.distance" },
    );
    const duration = r2FieldEvidence(
      "commute-field-duration",
      "GEOGRAPHY",
      {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "COMMUTE",
          percentage: null,
          location: null,
          distanceKm: null,
          durationMinutes: 40,
        },
      },
      { canonicalField: "commute.duration" },
    );
    const normalization = r2TestNormalization({ fields: [distance, duration] });
    const run = (distanceKm: number | null, durationMinutes: number | null) =>
      score({
        profile,
        normalization,
        eligibility: eligible(normalization, profile),
        commute: { distanceKm, durationMinutes },
      });
    expect(run(25, null).contributions).toContainEqual(
      expect.objectContaining({ code: "R2_COMMUTE_DISTANCE_VERIFIED_MATCH", points: 8 }),
    );
    expect(run(40, null).contributions).toContainEqual(
      expect.objectContaining({ code: "R2_COMMUTE_DISTANCE_VERIFIED_MISMATCH", points: -8 }),
    );
    expect(run(null, 40).contributions).toContainEqual(
      expect.objectContaining({ code: "R2_COMMUTE_TIME_VERIFIED_MATCH", points: 8 }),
    );
    expect(run(null, 60).contributions).toContainEqual(
      expect.objectContaining({ code: "R2_COMMUTE_TIME_VERIFIED_MISMATCH", points: -8 }),
    );
    expect(run(25, null).contributions.some(({ code }) => code.includes("COMMUTE_TIME"))).toBe(
      false,
    );
    expect(run(null, 40).contributions.some(({ code }) => code.includes("COMMUTE_DISTANCE"))).toBe(
      false,
    );
  });

  it("is deterministic, bounded, and monotonic for an added verified signal", () => {
    const baseNormalization = r2TestNormalization({});
    const matchedSkill = r2RequirementEvidence("skill-teamwork", "SKILLS", "SKILL", {
      kind: "TEXT",
      value: "Teamwork",
    });
    const enhancedNormalization = r2TestNormalization({ requirements: [matchedSkill] });
    const base = score({
      profile: testProfile,
      normalization: baseNormalization,
      eligibility: eligible(baseNormalization),
    });
    const enhancedInput = {
      profile: testProfile,
      normalization: enhancedNormalization,
      eligibility: eligible(enhancedNormalization),
    };
    const first = score(enhancedInput);
    const second = score(enhancedInput);
    expect(first).toEqual(second);
    expect(first.score).toBeGreaterThanOrEqual(base.score);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.score - base.score).toBe(7);
  });

  it("ablates stale, unknown, conditional, and conflicting job evidence to zero", () => {
    for (const [state, modality] of [
      ["UNKNOWN", "REQUIRED"],
      ["CONDITIONAL", "REQUIRED"],
      ["SOURCE_STATED", "CONDITIONAL"],
    ] as const) {
      const evidence = r2RequirementEvidence(
        `skill-${state}-${modality}`,
        "SKILLS",
        "SKILL",
        { kind: "TEXT", value: "Teamwork" },
        {
          state,
          modality,
          condition: modality === "CONDITIONAL" ? "Owner confirmation required" : null,
        },
      );
      const normalization = r2TestNormalization({ requirements: [evidence] });
      expect(
        score({
          profile: testProfile,
          normalization,
          eligibility: eligible(normalization),
        }).contributions,
      ).toEqual([]);
    }

    const conflicting = ["required", "negated"].map((suffix, index) =>
      r2RequirementEvidence(
        `skill-conflicting-${suffix}`,
        "SKILLS",
        "SKILL",
        { kind: "TEXT", value: "Teamwork" },
        {
          state: "CONFLICTING",
          modality: index === 0 ? "REQUIRED" : "NEGATED",
          conflictSetId: "conflict:teamwork",
        },
      ),
    );
    const conflictingNormalization = r2TestNormalization({
      requirements: conflicting,
      conflicts: [
        {
          id: "conflict:teamwork",
          canonicalField: "requirement:SKILL:teamwork",
          evidenceIds: conflicting.map(({ id }) => id),
        },
      ],
    });
    expect(
      score({
        profile: testProfile,
        normalization: conflictingNormalization,
        eligibility: eligible(conflictingNormalization),
      }).contributions,
    ).toEqual([]);
  });

  it("gives a stale profile/job binding zero candidate-fact contributions", () => {
    const skill = r2RequirementEvidence("stale-skill", "SKILLS", "SKILL", {
      kind: "TEXT",
      value: "Teamwork",
    });
    const normalization = r2TestNormalization({ requirements: [skill] });
    const staleEligibility = evaluateR2Eligibility({
      profile: testProfile,
      normalization,
      bindings: { ...currentR2Bindings, currentProfileVersionId: "new-profile-version" },
      evaluatedAt: "2026-09-09T00:00:00.000Z",
    });
    const result = score({
      profile: testProfile,
      normalization,
      eligibility: staleEligibility,
    });
    expect(result.score).toBe(0);
    expect(result.contributions).toEqual([]);
    expect(result.recommended).toBe(false);
  });
});
