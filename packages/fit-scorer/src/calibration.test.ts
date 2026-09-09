import { describe, expect, it } from "vitest";

import { r2GoldenCorpus } from "../../../fixtures/r2/manifest";

import {
  assertR2Monotonicity,
  evaluateR2GoldenRanking,
  r2AblationDelta,
  r2CalibrationState,
} from "./calibration";

describe("R2 calibration framework", () => {
  it("covers every required role family, matching state, and ordinal class", () => {
    expect(new Set(r2GoldenCorpus.map(({ roleFamily }) => roleFamily))).toEqual(
      new Set([
        "hospitality",
        "retail",
        "admin/reception",
        "warehouse",
        "engineering",
        "robotics",
        "automation",
        "embedded",
        "internship",
        "licensed/regulated",
        "remote",
        "multi-location",
      ]),
    );
    expect(new Set(r2GoldenCorpus.flatMap(({ materialStates }) => materialStates))).toEqual(
      new Set([
        "VERIFIED_MATCH",
        "VERIFIED_MISMATCH",
        "UNKNOWN",
        "CONDITIONAL",
        "CONFLICTING",
        "STALE",
        "SPARSE_COVERAGE",
        "DUPLICATE_AMBIGUITY",
      ]),
    );
    expect(new Set(r2GoldenCorpus.map(({ expectedBand }) => expectedBand))).toEqual(
      new Set(["STRONG_REVIEW", "POSSIBLE_REVIEW", "LOW_PRIORITY", "DO_NOT_RECOMMEND"]),
    );
  });
  it("keeps the public software truthfully uncalibrated before the private threshold", () => {
    expect(
      r2CalibrationState({
        independentlyReviewedPrivateJobs: 29,
        roleFamilies: 12,
        statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"],
      }),
    ).toBe("UNCALIBRATED");
    expect(
      r2CalibrationState({
        independentlyReviewedPrivateJobs: 30,
        roleFamilies: 4,
        statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"],
      }),
    ).toBe("CALIBRATED");
  });

  it("evaluates the fictional corpus deterministically with bounded scores", () => {
    const input = r2GoldenCorpus.map((item) => ({
      id: item.id,
      roleFamily: item.roleFamily,
      eligibility: item.expectedEligibility,
      score: item.expectedScore,
      expectedBand: item.expectedBand,
    }));
    const gate = {
      independentlyReviewedPrivateJobs: 0,
      roleFamilies: 0,
      statuses: [] as Array<"ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE">,
    };
    expect(evaluateR2GoldenRanking(input, gate)).toEqual(evaluateR2GoldenRanking(input, gate));
    const result = evaluateR2GoldenRanking(input, gate);
    expect(result.total).toBe(12);
    expect(result.boundsPass).toBe(true);
    expect(result.ordinalAgreement).toBe(1);
    expect(result.topKReviewUtility).toBe(1);
    expect(result.calibrationState).toBe("UNCALIBRATED");
  });

  it("supports ablation and monotonicity checks", () => {
    expect(r2AblationDelta(75, 68)).toBe(7);
    expect(() => assertR2Monotonicity(60, 67)).not.toThrow();
    expect(() => assertR2Monotonicity(67, 60)).toThrow("R2_MONOTONICITY_VIOLATION");
  });
});
