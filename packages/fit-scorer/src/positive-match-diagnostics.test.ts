import { describe, expect, it } from "vitest";
import {
  assessR2Calibration,
  r2CalibrationPositiveMatchDiagnostics,
  type R2PrivateCalibrationLabelOutcome,
} from "./calibration";

const positive = (
  id: string,
  overrides: Partial<R2PrivateCalibrationLabelOutcome> = {},
): R2PrivateCalibrationLabelOutcome => ({
  id,
  roleFamily: "fictional-retail",
  ownerLabel: "GOOD_MATCH",
  eligibility: "ELIGIBLE",
  ordinalBand: "POSSIBLE_REVIEW",
  recommended: true,
  ...overrides,
});

describe("positive owner-label failure diagnostics (inert)", () => {
  it("distinguishes no recorded positives from a measured 0% result", () => {
    expect(r2CalibrationPositiveMatchDiagnostics([])).toEqual({
      recorded: 0,
      compared: 0,
      incomplete: 0,
      agreements: 0,
      missed: 0,
      eligibilityNotEligible: 0,
      notRecommended: 0,
      notInReviewBand: 0,
      measurement: "UNMEASURED",
    });
  });

  it("keeps incomplete positives unmeasured instead of treating them as misses", () => {
    const result = r2CalibrationPositiveMatchDiagnostics([
      positive("pending", { eligibility: null, ordinalBand: null, recommended: null }),
    ]);
    expect(result).toMatchObject({
      recorded: 1,
      compared: 0,
      incomplete: 1,
      missed: 0,
      measurement: "UNMEASURED",
    });
  });

  it("shows missed positives and overlapping failure reasons without double counting", () => {
    const result = r2CalibrationPositiveMatchDiagnostics([
      positive("success"),
      positive("all-three", {
        eligibility: "REVIEW_REQUIRED",
        ordinalBand: "LOW_PRIORITY",
        recommended: false,
      }),
      positive("recommendation-only", { recommended: false }),
      positive("band-only", { ordinalBand: "LOW_PRIORITY" }),
      positive("incomplete", { recommended: null }),
      { ...positive("not-positive"), ownerLabel: "POOR_MATCH" },
    ]);
    expect(result).toEqual({
      recorded: 5,
      compared: 4,
      incomplete: 1,
      agreements: 1,
      missed: 3,
      eligibilityNotEligible: 1,
      notRecommended: 2,
      notInReviewBand: 2,
      measurement: "MEASURED",
    });
  });

  it("shows zero retrieved positives even when aggregate outcomes elsewhere agree", () => {
    const negatives: R2PrivateCalibrationLabelOutcome[] = Array.from({ length: 28 }, (_, i) => ({
      id: `fictional-negative-${i}`,
      roleFamily: `fictional-family-${i % 4}`,
      ownerLabel: i % 2 === 0 ? "AMBIGUOUS" : "POOR_MATCH",
      eligibility: i % 2 === 0 ? "REVIEW_REQUIRED" : "ELIGIBLE",
      ordinalBand: i % 2 === 0 ? "POSSIBLE_REVIEW" : "LOW_PRIORITY",
      recommended: false,
    }));
    const labels = [
      positive("miss-1", { eligibility: "REVIEW_REQUIRED", recommended: false }),
      positive("miss-2", { eligibility: "REVIEW_REQUIRED", recommended: false }),
      ...negatives,
    ];
    const result = r2CalibrationPositiveMatchDiagnostics(labels);
    expect(result).toMatchObject({ recorded: 2, compared: 2, agreements: 0, missed: 2 });
    const assessment = assessR2Calibration({
      sourceLabelCount: labels.length,
      sourcePairCount: 0,
      labels,
      pairs: [],
      performanceThresholds: {
        version: "fictional-exploratory",
        minimumLabelAgreementBasisPoints: 8000,
        minimumPairComparisons: 1,
        minimumPairAgreementBasisPoints: 8000,
      },
      safetyGates: null,
      ownerApproval: null,
    });
    expect(assessment.labelAgreementBasisPoints).toBeGreaterThanOrEqual(8000);
    expect(assessment.state).toBe("CALIBRATION_PENDING");
  });
});
