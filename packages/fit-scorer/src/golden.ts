import { evaluateR2Eligibility, type R2EligibilityResult } from "@applypilot/eligibility-engine";
import { compareCrossSourceObservations } from "@applypilot/job-normalizer";
import { buildR2GoldenInput } from "../../../fixtures/r2/executable-inputs";
import { r2GoldenCorpus, type R2GoldenCase } from "../../../fixtures/r2/manifest";

import { r2OrdinalBand, type R2OrdinalBand } from "./calibration";
import {
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  scoreR2JobFit,
  type R2FitResult,
  type R2FitWeights,
} from "./r2";

export interface R2GoldenExecution {
  fixture: R2GoldenCase;
  eligibility: R2EligibilityResult;
  fit: R2FitResult;
  band: R2OrdinalBand;
  duplicateState: "DISTINCT" | "SUGGESTED";
}

export interface R2GoldenMismatch {
  caseId: string;
  field: string;
  expected: string;
  actual: string;
}

export function executeR2GoldenCase(
  fixture: R2GoldenCase,
  options: { weights?: R2FitWeights } = {},
): R2GoldenExecution {
  const input = buildR2GoldenInput(fixture);
  const eligibility = evaluateR2Eligibility({
    profile: input.profile,
    normalization: input.normalization,
    bindings: input.bindings,
    evaluatedAt: "2026-09-10T00:00:00.000Z",
  });
  const weights = options.weights;
  const calibrationContext = weights
    ? { ...R2_UNREVIEWED_CALIBRATION_CONTEXT, weightVersion: weights.version }
    : R2_UNREVIEWED_CALIBRATION_CONTEXT;
  const fit = scoreR2JobFit({
    profile: input.profile,
    normalization: input.normalization,
    eligibility,
    commute: input.commute,
    calibrationContext,
    weights,
  });
  const duplicateState = fixture.duplicateObservations
    ? compareCrossSourceObservations(
        fixture.duplicateObservations.left,
        fixture.duplicateObservations.right,
      ).decision === "SUGGEST_LINK"
      ? "SUGGESTED"
      : "DISTINCT"
    : "DISTINCT";
  return {
    fixture,
    eligibility,
    fit,
    band: r2OrdinalBand(eligibility.status, fit.score),
    duplicateState,
  };
}

export function assessR2GoldenExecution(execution: R2GoldenExecution): R2GoldenMismatch[] {
  const mismatches: R2GoldenMismatch[] = [];
  const { fixture, eligibility, fit, band, duplicateState } = execution;
  const compare = (field: string, expected: string | boolean, actual: string | boolean) => {
    if (expected !== actual) {
      mismatches.push({
        caseId: fixture.id,
        field,
        expected: String(expected),
        actual: String(actual),
      });
    }
  };
  compare("eligibility", fixture.expectedEligibility, eligibility.status);
  compare("band", fixture.expectedBand, band);
  compare("recommended", fixture.expectedRecommendation, fit.recommended);
  compare("duplicate", fixture.expectedDuplicate, duplicateState);
  for (const expectation of fixture.expectedContributions) {
    const points = fit.contributions
      .filter(({ code }) => code === expectation.code)
      .reduce((total, contribution) => total + contribution.points, 0);
    const actual = points > 0 ? "POSITIVE" : points < 0 ? "NEGATIVE" : "ZERO";
    compare(`contribution:${expectation.code}`, expectation.direction, actual);
  }
  return mismatches;
}

export function executeR2GoldenCorpus(options: { weights?: R2FitWeights } = {}) {
  return r2GoldenCorpus.map((fixture) => executeR2GoldenCase(fixture, options));
}
