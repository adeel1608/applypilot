import { describe, expect, it } from "vitest";

import { r2GoldenCorpus } from "../../../fixtures/r2/manifest";

import {
  R2CalibrationContextSchema,
  createR2CalibrationContext,
  evaluateR2GoldenRanking,
  r2AblationDelta,
  r2CalibrationState,
} from "./calibration";
import { assessR2GoldenExecution, executeR2GoldenCase, executeR2GoldenCorpus } from "./golden";
import { R2_FIT_SCORER_VERSION, R2_FIT_WEIGHTS, R2_GOLDEN_CORPUS_VERSION } from "./r2";

describe("R2 executable golden corpus and calibration", () => {
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

  it("keeps current state uncalibrated but can bind a qualifying durable calibration run", () => {
    const belowThreshold = {
      independentlyReviewedPrivateJobs: 29,
      roleFamilies: 12,
      statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"] as Array<
        "ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE"
      >,
    };
    expect(r2CalibrationState(belowThreshold)).toBe("UNCALIBRATED");
    expect(
      r2CalibrationState({
        independentlyReviewedPrivateJobs: 30,
        roleFamilies: 4,
        statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"],
      }),
    ).toBe("CALIBRATED");
    expect(() =>
      createR2CalibrationContext({
        version: "calibration-context:qualified",
        scorerVersion: R2_FIT_SCORER_VERSION,
        weightVersion: R2_FIT_WEIGHTS.version,
        corpusVersion: R2_GOLDEN_CORPUS_VERSION,
        runId: null,
        gate: {
          independentlyReviewedPrivateJobs: 30,
          roleFamilies: 4,
          statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"],
        },
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
          gate: {
            independentlyReviewedPrivateJobs: 30,
            roleFamilies: 4,
            statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"],
          },
        }),
      ).state,
    ).toBe("CALIBRATED");
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
      { independentlyReviewedPrivateJobs: 0, roleFamilies: 0, statuses: [] },
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
