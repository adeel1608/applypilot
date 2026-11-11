import { describe, expect, it } from "vitest";
import { assessR2Calibration, type R2CalibrationGateInput } from "./calibration";
const base: R2CalibrationGateInput = {
  sourceLabelCount: 0,
  sourcePairCount: 0,
  labels: [],
  pairs: [],
  performanceThresholds: {
    version: "fictional",
    minimumLabelAgreementBasisPoints: 7500,
    minimumPairComparisons: 9,
    minimumPairAgreementBasisPoints: 7500,
  },
  safetyGates: null,
  ownerApproval: null,
};
function assess(scores: Array<[number | null, number | null]>, threshold = 7500, minimum = 9) {
  return assessR2Calibration({
    ...base,
    sourcePairCount: scores.length,
    pairs: scores.map(([preferredScore, otherScore], i) => ({
      id: `fictional-${i}`,
      preferredScore,
      otherScore,
    })),
    performanceThresholds: {
      ...base.performanceThresholds!,
      minimumPairAgreementBasisPoints: threshold,
      minimumPairComparisons: minimum,
    },
  });
}
describe("observed calibration pair diagnostics", () => {
  it("reports a fictional low measured result independently from insufficient sample", () => {
    const a = assess([
      [7, 0],
      [8, 0],
      [9, 0],
      [1, 1],
      [2, 2],
      [0, 9],
      [0, 8],
    ]);
    expect(a.pairAgreementBasisPoints).toBe(4286);
    expect(a.pairDiagnostics).toEqual({
      agrees: 3,
      ties: 2,
      opposite: 2,
      incomplete: 0,
      sample: "INSUFFICIENT",
      performance: "FAIL",
      requiredComparisons: 9,
      requiredAgreementsAtObservedSample: 6,
      requiredAgreementsAtMinimumSample: 7,
    });
    expect(a.blockerCodes).toContain("PRIVATE_PAIR_SAMPLE_INSUFFICIENT");
    expect(a.blockerCodes).toContain("PRIVATE_PAIR_PERFORMANCE_BELOW_THRESHOLD");
    expect(a.state).toBe("UNCALIBRATED");
  });
  it("distinguishes no sample and incomplete comparisons from measured failure", () => {
    for (const a of [assess([]), assess([[null, 7]])]) {
      expect(a.pairDiagnostics.performance).toBe("NO_SAMPLE");
      expect(a.pairDiagnostics.requiredAgreementsAtObservedSample).toBeNull();
      expect(a.blockerCodes).not.toContain("PRIVATE_PAIR_PERFORMANCE_BELOW_THRESHOLD");
      expect(a.blockerCodes).toContain("PRIVATE_PAIR_SAMPLE_INSUFFICIENT");
    }
    expect(assess([[null, 7]]).pairDiagnostics.incomplete).toBe(1);
  });
  it("does not confuse a passing small sample with sufficient qualification", () => {
    const a = assess([[1, 0]]);
    expect(a.pairDiagnostics).toMatchObject({ performance: "PASS", sample: "INSUFFICIENT" });
    expect(a.blockerCodes).toContain("PRIVATE_PAIR_SAMPLE_INSUFFICIENT");
    expect(assess([[0, 0]], 0, 1).pairDiagnostics).toMatchObject({
      performance: "PASS",
      agrees: 0,
      ties: 1,
      requiredAgreementsAtObservedSample: 0,
    });
    expect(
      assessR2Calibration({ ...base, performanceThresholds: null }).pairDiagnostics,
    ).toMatchObject({ sample: "THRESHOLDS_MISSING", performance: "NO_SAMPLE" });
  });
  it("uses the same rounding at the agreement boundary as the assessor", () => {
    const scores: Array<[number, number]> = Array.from({ length: 20001 }, (_, i) =>
      i < 10000 ? [1, 0] : [0, 1],
    );
    const a = assess(scores, 5000, 20001);
    expect(a.pairAgreementBasisPoints).toBe(5000);
    expect(a.pairDiagnostics).toMatchObject({
      performance: "PASS",
      requiredAgreementsAtObservedSample: 10000,
      requiredAgreementsAtMinimumSample: 10000,
    });
  });
});
