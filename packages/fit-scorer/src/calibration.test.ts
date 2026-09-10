import { describe, expect, it } from "vitest";

import { r2GoldenCorpus } from "../../../fixtures/r2/manifest";

import {
  R2CalibrationContextSchema,
  assessR2Calibration,
  createR2CalibrationContext,
  evaluateR2GoldenRanking,
  r2AblationDelta,
  r2CalibrationState,
  type R2CalibrationGateInput,
} from "./calibration";
import { assessR2GoldenExecution, executeR2GoldenCase, executeR2GoldenCorpus } from "./golden";
import { R2_FIT_SCORER_VERSION, R2_FIT_WEIGHTS, R2_GOLDEN_CORPUS_VERSION } from "./r2";

describe("R2 executable golden corpus and calibration", () => {
  const emptyPrivateGate: R2CalibrationGateInput = {
    sourceLabelCount: 0,
    sourcePairCount: 0,
    labels: [],
    pairs: [],
    performanceThresholds: null,
    safetyGates: null,
    ownerApproval: null,
  };

  const qualifiedPrivateGate = (): R2CalibrationGateInput => {
    const labels = Array.from({ length: 30 }, (_, index) => {
      const common = { id: `private-label-${index}`, roleFamily: `family-${index % 4}` };
      if (index % 3 === 0) {
        return {
          ...common,
          ownerLabel: "GOOD_MATCH" as const,
          eligibility: "ELIGIBLE" as const,
          ordinalBand: "STRONG_REVIEW" as const,
          recommended: true,
        };
      }
      if (index % 3 === 1) {
        return {
          ...common,
          ownerLabel: "AMBIGUOUS" as const,
          eligibility: "REVIEW_REQUIRED" as const,
          ordinalBand: "POSSIBLE_REVIEW" as const,
          recommended: false,
        };
      }
      return {
        ...common,
        ownerLabel: "POOR_MATCH" as const,
        eligibility: "INELIGIBLE" as const,
        ordinalBand: "DO_NOT_RECOMMEND" as const,
        recommended: false,
      };
    });
    const pairs = Array.from({ length: 5 }, (_, index) => ({
      id: `private-pair-${index}`,
      preferredScore: 80 - index,
      otherScore: 40 + index,
    }));
    return {
      sourceLabelCount: labels.length,
      sourcePairCount: pairs.length,
      labels,
      pairs,
      performanceThresholds: {
        version: "owner-thresholds-1",
        minimumLabelAgreementBasisPoints: 10_000,
        minimumPairComparisons: 5,
        minimumPairAgreementBasisPoints: 10_000,
      },
      safetyGates: {
        version: "r2-safety-gates-1",
        executableGoldenCorpus: true,
        determinism: true,
        monotonicity: true,
        ablation: true,
        bounds: true,
        recommendationInvariants: true,
        privacyAudit: true,
        migrationIntegrity: true,
      },
      ownerApproval: {
        approvalId: "owner-approval-fictional",
        approvedAt: "2026-09-10T00:00:00.000Z",
        performanceThresholdVersion: "owner-thresholds-1",
        safetyGateVersion: "r2-safety-gates-1",
        approved: true,
      },
    };
  };

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

  it("keeps current state uncalibrated and count-qualified evidence pending approval", () => {
    expect(r2CalibrationState(emptyPrivateGate)).toBe("UNCALIBRATED");
    const qualified = qualifiedPrivateGate();
    const countsOnly = {
      ...qualified,
      performanceThresholds: null,
      safetyGates: null,
      ownerApproval: null,
    };
    expect(r2CalibrationState(countsOnly)).toBe("CALIBRATION_PENDING");
    expect(assessR2Calibration(countsOnly).blockerCodes).toEqual(
      expect.arrayContaining([
        "PRIVATE_PERFORMANCE_THRESHOLDS_NOT_APPROVED",
        "CALIBRATION_SAFETY_GATES_NOT_APPROVED",
        "CALIBRATION_OWNER_APPROVAL_REQUIRED",
      ]),
    );
    expect(() =>
      createR2CalibrationContext({
        version: "calibration-context:qualified",
        scorerVersion: R2_FIT_SCORER_VERSION,
        weightVersion: R2_FIT_WEIGHTS.version,
        corpusVersion: R2_GOLDEN_CORPUS_VERSION,
        runId: null,
        gate: qualified,
      }),
    ).toThrow();
    expect(
      R2CalibrationContextSchema.parse(
        createR2CalibrationContext({
          version: "calibration-context:qualified",
          scorerVersion: R2_FIT_SCORER_VERSION,
          weightVersion: R2_FIT_WEIGHTS.version,
          corpusVersion: R2_GOLDEN_CORPUS_VERSION,
          runId: "calibration-run:qualified",
          gate: qualified,
        }),
      ).state,
    ).toBe("CALIBRATED");
  });

  it("rejects inconsistent private contents and premature safety or owner approval", () => {
    const qualified = qualifiedPrivateGate();
    expect(assessR2Calibration({ ...qualified, labels: qualified.labels.slice(1) })).toMatchObject({
      state: "CALIBRATION_PENDING",
      blockerCodes: expect.arrayContaining(["PRIVATE_LABEL_ROWS_INCONSISTENT"]),
    });
    expect(
      assessR2Calibration({
        ...qualified,
        labels: qualified.labels.map((label, index) =>
          index === 0 ? { ...label, ownerLabel: "POOR_MATCH" as const } : label,
        ),
      }),
    ).toMatchObject({
      state: "CALIBRATION_PENDING",
      blockerCodes: expect.arrayContaining(["PRIVATE_LABEL_PERFORMANCE_BELOW_THRESHOLD"]),
    });
    expect(
      assessR2Calibration({
        ...qualified,
        pairs: qualified.pairs.map((pair, index) =>
          index === 0 ? { ...pair, preferredScore: 20, otherScore: 80 } : pair,
        ),
      }),
    ).toMatchObject({
      state: "CALIBRATION_PENDING",
      blockerCodes: expect.arrayContaining(["PRIVATE_PAIR_PERFORMANCE_BELOW_THRESHOLD"]),
    });
    expect(
      assessR2Calibration({
        ...qualified,
        safetyGates: { ...qualified.safetyGates!, privacyAudit: false },
      }),
    ).toMatchObject({
      state: "CALIBRATION_PENDING",
      blockerCodes: expect.arrayContaining(["CALIBRATION_SAFETY_GATE_FAILED"]),
    });
    expect(
      assessR2Calibration({
        ...qualified,
        ownerApproval: {
          ...qualified.ownerApproval!,
          performanceThresholdVersion: "different-thresholds",
        },
      }),
    ).toMatchObject({
      state: "CALIBRATION_PENDING",
      blockerCodes: expect.arrayContaining(["CALIBRATION_OWNER_APPROVAL_INCONSISTENT"]),
    });
  });

  it("executes actual eligibility and scorer inputs twice with matching golden outcomes", () => {
    const first = executeR2GoldenCorpus();
    const second = executeR2GoldenCorpus();
    expect(first).toEqual(second);
    expect(first.flatMap(assessR2GoldenExecution)).toEqual([]);
    expect(
      first.find(({ fixture }) => fixture.scenario === "DUPLICATE_AMBIGUITY")?.duplicateState,
    ).toBe("SUGGESTED");

    const metrics = evaluateR2GoldenRanking(
      first.map(({ fixture, eligibility, fit }) => ({
        id: fixture.id,
        roleFamily: fixture.roleFamily,
        eligibility: eligibility.status,
        score: fit.score,
        expectedBand: fixture.expectedBand,
      })),
      emptyPrivateGate,
    );
    expect(metrics).toMatchObject({
      total: 12,
      ordinalAgreement: 1,
      boundsPass: true,
      calibrationState: "UNCALIBRATED",
    });
  });

  it("detects an actual scorer-weight regression and an altered eligibility result", () => {
    const engineering = r2GoldenCorpus.find(({ id }) => id === "engineering-verified")!;
    const changedWeights = {
      ...R2_FIT_WEIGHTS,
      version: "r2-weights-mutant",
      requiredEvidenceMatch: 6,
    };
    expect(
      assessR2GoldenExecution(executeR2GoldenCase(engineering, { weights: changedWeights })),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ caseId: engineering.id, field: "band" })]),
    );

    const actual = executeR2GoldenCase(engineering);
    const altered = {
      ...actual,
      eligibility: { ...actual.eligibility, status: "REVIEW_REQUIRED" as const },
    };
    expect(assessR2GoldenExecution(altered)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ caseId: engineering.id, field: "eligibility" }),
      ]),
    );
  });

  it("never recommends review-required/ineligible cases and ablates unusable evidence", () => {
    const executions = executeR2GoldenCorpus();
    expect(
      executions
        .filter(({ eligibility }) => eligibility.status !== "ELIGIBLE")
        .every(({ fit }) => !fit.recommended),
    ).toBe(true);
    for (const id of [
      "retail-unknown-roster",
      "admin-conditional-certificate",
      "automation-conflict",
      "robotics-stale-evaluation",
    ]) {
      expect(executions.find(({ fixture }) => fixture.id === id)?.fit.contributions).toEqual([]);
    }
  });

  it("uses actual scorer runs for monotonicity, ablation, and bounds", () => {
    const template = r2GoldenCorpus.find(({ id }) => id === "engineering-verified")!;
    const base = executeR2GoldenCase({ ...template, verifiedSignalCount: 1 });
    const enhanced = executeR2GoldenCase({ ...template, verifiedSignalCount: 2 });
    const repeated = executeR2GoldenCase({ ...template, verifiedSignalCount: 2 });
    expect(enhanced.fit).toEqual(repeated.fit);
    expect(enhanced.fit.score).toBeGreaterThan(base.fit.score);
    expect(r2AblationDelta(enhanced.fit.score, base.fit.score)).toBe(
      R2_FIT_WEIGHTS.requiredEvidenceMatch,
    );
    expect(executeR2GoldenCorpus().every(({ fit }) => fit.score >= 0 && fit.score <= 100)).toBe(
      true,
    );
  });
});
