import { describe, expect, it } from "vitest";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  currentR2Bindings,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";

import { scoreR2JobFit } from "./r2";

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
    const result = scoreR2JobFit({
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
    const commute = r2RequirementEvidence(
      "commute-distance",
      "VEHICLE",
      "LOCATION",
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
      { modality: "PREFERRED" },
    );
    const normalization = r2TestNormalization({ requirements: [commute] });
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
    const result = scoreR2JobFit({
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
    const result = scoreR2JobFit({
      profile: testProfile,
      normalization,
      eligibility,
      recommendationThreshold: 0,
    });
    expect(result.recommended).toBe(false);
    expect(result.recommendationBlockers).toContain("ELIGIBILITY_NOT_ELIGIBLE");
  });

  it("keeps commute time and distance independent", () => {
    const commute = r2RequirementEvidence(
      "commute-time",
      "VEHICLE",
      "LOCATION",
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
      { modality: "PREFERRED" },
    );
    const normalization = r2TestNormalization({ requirements: [commute] });
    const result = scoreR2JobFit({
      profile: testProfile,
      normalization,
      eligibility: eligible(normalization),
      commute: { distanceKm: null, durationMinutes: 50 },
    });
    expect(result.contributions.filter(({ code }) => code.includes("COMMUTE_"))).toEqual([]);
  });

  it("is deterministic, bounded, and monotonic for an added verified signal", () => {
    const baseNormalization = r2TestNormalization({});
    const matchedSkill = r2RequirementEvidence("skill-teamwork", "SKILLS", "SKILL", {
      kind: "TEXT",
      value: "Teamwork",
    });
    const enhancedNormalization = r2TestNormalization({ requirements: [matchedSkill] });
    const base = scoreR2JobFit({
      profile: testProfile,
      normalization: baseNormalization,
      eligibility: eligible(baseNormalization),
    });
    const enhancedInput = {
      profile: testProfile,
      normalization: enhancedNormalization,
      eligibility: eligible(enhancedNormalization),
    };
    const first = scoreR2JobFit(enhancedInput);
    const second = scoreR2JobFit(enhancedInput);
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
        scoreR2JobFit({
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
      scoreR2JobFit({
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
    const result = scoreR2JobFit({
      profile: testProfile,
      normalization,
      eligibility: staleEligibility,
    });
    expect(result.score).toBe(0);
    expect(result.contributions).toEqual([]);
    expect(result.recommended).toBe(false);
  });
});
