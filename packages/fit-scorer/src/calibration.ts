import { z } from "zod";

export const R2OrdinalBandSchema = z.enum([
  "STRONG_REVIEW",
  "POSSIBLE_REVIEW",
  "LOW_PRIORITY",
  "DO_NOT_RECOMMEND",
]);

export const R2CalibrationStateSchema = z.enum([
  "UNCALIBRATED",
  "CALIBRATION_PENDING",
  "CALIBRATED",
]);

export const R2CalibrationContextSchema = z
  .object({
    version: z.string().min(1).max(200),
    state: R2CalibrationStateSchema,
    scorerVersion: z.string().min(1).max(100),
    weightVersion: z.string().min(1).max(100),
    corpusVersion: z.string().min(1).max(100),
    runId: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "CALIBRATED" && value.runId === null) {
      context.addIssue({
        code: "custom",
        path: ["runId"],
        message: "a calibrated context must bind a durable qualified calibration run",
      });
    }
  });

export type R2OrdinalBand = z.infer<typeof R2OrdinalBandSchema>;
export type R2CalibrationContext = z.infer<typeof R2CalibrationContextSchema>;
export type R2CalibrationState = z.infer<typeof R2CalibrationStateSchema>;

export interface R2GoldenObservation {
  id: string;
  roleFamily: string;
  eligibility: "ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE";
  score: number;
  expectedBand: R2OrdinalBand;
}

export const R2PrivateCalibrationLabelOutcomeSchema = z
  .object({
    id: z.string().min(1).max(200),
    roleFamily: z.string().min(1).max(100),
    ownerLabel: z.enum(["GOOD_MATCH", "POOR_MATCH", "AMBIGUOUS"]),
    eligibility: z.enum(["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"]).nullable(),
    ordinalBand: R2OrdinalBandSchema.nullable(),
    recommended: z.boolean().nullable(),
  })
  .strict();

export const R2PrivateCalibrationPairOutcomeSchema = z
  .object({
    id: z.string().min(1).max(200),
    preferredScore: z.number().min(0).max(100).nullable(),
    otherScore: z.number().min(0).max(100).nullable(),
  })
  .strict();

export const R2CalibrationPerformanceThresholdsSchema = z
  .object({
    version: z.string().min(1).max(100),
    minimumLabelAgreementBasisPoints: z.number().int().min(0).max(10_000),
    minimumPairComparisons: z.number().int().positive(),
    minimumPairAgreementBasisPoints: z.number().int().min(0).max(10_000),
  })
  .strict();

export const R2CalibrationSafetyGatesSchema = z
  .object({
    version: z.string().min(1).max(100),
    executableGoldenCorpus: z.boolean(),
    determinism: z.boolean(),
    monotonicity: z.boolean(),
    ablation: z.boolean(),
    bounds: z.boolean(),
    recommendationInvariants: z.boolean(),
    privacyAudit: z.boolean(),
    migrationIntegrity: z.boolean(),
  })
  .strict();

export const R2CalibrationOwnerApprovalSchema = z
  .object({
    approvalId: z.string().min(1).max(200),
    approvedAt: z.iso.datetime(),
    performanceThresholdVersion: z.string().min(1).max(100),
    safetyGateVersion: z.string().min(1).max(100),
    approved: z.literal(true),
  })
  .strict();

export const R2CalibrationGateInputSchema = z
  .object({
    sourceLabelCount: z.number().int().nonnegative(),
    sourcePairCount: z.number().int().nonnegative(),
    labels: z.array(R2PrivateCalibrationLabelOutcomeSchema),
    pairs: z.array(R2PrivateCalibrationPairOutcomeSchema),
    performanceThresholds: R2CalibrationPerformanceThresholdsSchema.nullable(),
    safetyGates: R2CalibrationSafetyGatesSchema.nullable(),
    ownerApproval: R2CalibrationOwnerApprovalSchema.nullable(),
  })
  .strict();

export type R2PrivateCalibrationLabelOutcome = z.infer<
  typeof R2PrivateCalibrationLabelOutcomeSchema
>;
export type R2PrivateCalibrationPairOutcome = z.infer<typeof R2PrivateCalibrationPairOutcomeSchema>;
export type R2CalibrationPerformanceThresholds = z.infer<
  typeof R2CalibrationPerformanceThresholdsSchema
>;
export type R2CalibrationSafetyGates = z.infer<typeof R2CalibrationSafetyGatesSchema>;
export type R2CalibrationOwnerApproval = z.infer<typeof R2CalibrationOwnerApprovalSchema>;
export type R2CalibrationGateInput = z.infer<typeof R2CalibrationGateInputSchema>;

export interface R2CalibrationAssessment {
  state: R2CalibrationState;
  sourceLabelCount: number;
  comparedLabelCount: number;
  sourcePairCount: number;
  comparedPairCount: number;
  roleFamilyCount: number;
  statusCount: number;
  labelAgreementBasisPoints: number;
  pairAgreementBasisPoints: number;
  blockerCodes: string[];
}

export interface R2GoldenMetrics {
  total: number;
  ordinalAgreement: number;
  topK: number;
  topKReviewUtility: number;
  boundsPass: boolean;
  calibrationState: R2CalibrationState;
}

function basisPoints(passing: number, total: number): number {
  return total === 0 ? 0 : Math.round((passing / total) * 10_000);
}

function labelOutcomeAgrees(outcome: R2PrivateCalibrationLabelOutcome): boolean {
  if (
    outcome.eligibility === null ||
    outcome.ordinalBand === null ||
    outcome.recommended === null
  ) {
    return false;
  }
  if (outcome.ownerLabel === "GOOD_MATCH") {
    return (
      outcome.eligibility === "ELIGIBLE" &&
      outcome.recommended &&
      (outcome.ordinalBand === "STRONG_REVIEW" || outcome.ordinalBand === "POSSIBLE_REVIEW")
    );
  }
  if (outcome.ownerLabel === "AMBIGUOUS") {
    return outcome.eligibility === "REVIEW_REQUIRED" && !outcome.recommended;
  }
  return (
    !outcome.recommended &&
    (outcome.ordinalBand === "LOW_PRIORITY" || outcome.ordinalBand === "DO_NOT_RECOMMEND")
  );
}

export function assessR2Calibration(input: R2CalibrationGateInput): R2CalibrationAssessment {
  const gate = R2CalibrationGateInputSchema.parse(input);
  const completeLabels = gate.labels.filter(
    ({ eligibility, ordinalBand, recommended }) =>
      eligibility !== null && ordinalBand !== null && recommended !== null,
  );
  const completePairs = gate.pairs.filter(
    ({ preferredScore, otherScore }) => preferredScore !== null && otherScore !== null,
  );
  const roleFamilyCount = new Set(completeLabels.map(({ roleFamily }) => roleFamily)).size;
  const statusCount = new Set(completeLabels.map(({ eligibility }) => eligibility)).size;
  const labelAgreementBasisPoints = basisPoints(
    completeLabels.filter(labelOutcomeAgrees).length,
    completeLabels.length,
  );
  const pairAgreementBasisPoints = basisPoints(
    completePairs.filter(
      ({ preferredScore, otherScore }) =>
        preferredScore !== null && otherScore !== null && preferredScore > otherScore,
    ).length,
    completePairs.length,
  );
  const blockers = new Set<string>();
  const uniqueLabelIds = new Set(gate.labels.map(({ id }) => id));
  const uniquePairIds = new Set(gate.pairs.map(({ id }) => id));
  if (
    gate.labels.length !== gate.sourceLabelCount ||
    completeLabels.length !== gate.sourceLabelCount ||
    uniqueLabelIds.size !== gate.labels.length
  ) {
    blockers.add("PRIVATE_LABEL_ROWS_INCONSISTENT");
  }
  if (
    gate.pairs.length !== gate.sourcePairCount ||
    completePairs.length !== gate.sourcePairCount ||
    uniquePairIds.size !== gate.pairs.length
  ) {
    blockers.add("PRIVATE_PAIR_ROWS_INCONSISTENT");
  }
  if (roleFamilyCount < 4) blockers.add("PRIVATE_ROLE_FAMILY_COVERAGE_INCOMPLETE");
  if (statusCount < 3) blockers.add("PRIVATE_STATUS_COVERAGE_INCOMPLETE");

  if (!gate.performanceThresholds) {
    blockers.add("PRIVATE_PERFORMANCE_THRESHOLDS_NOT_APPROVED");
  } else {
    if (
      completeLabels.length < 30 ||
      labelAgreementBasisPoints < gate.performanceThresholds.minimumLabelAgreementBasisPoints
    ) {
      blockers.add("PRIVATE_LABEL_PERFORMANCE_BELOW_THRESHOLD");
    }
    if (completePairs.length < gate.performanceThresholds.minimumPairComparisons) {
      blockers.add("PRIVATE_PAIR_SAMPLE_INSUFFICIENT");
    } else if (
      pairAgreementBasisPoints < gate.performanceThresholds.minimumPairAgreementBasisPoints
    ) {
      blockers.add("PRIVATE_PAIR_PERFORMANCE_BELOW_THRESHOLD");
    }
  }

  if (!gate.safetyGates) {
    blockers.add("CALIBRATION_SAFETY_GATES_NOT_APPROVED");
  } else if (
    Object.entries(gate.safetyGates).some(([key, value]) => key !== "version" && value !== true)
  ) {
    blockers.add("CALIBRATION_SAFETY_GATE_FAILED");
  }

  if (!gate.ownerApproval) {
    blockers.add("CALIBRATION_OWNER_APPROVAL_REQUIRED");
  } else if (
    !gate.performanceThresholds ||
    !gate.safetyGates ||
    gate.ownerApproval.performanceThresholdVersion !== gate.performanceThresholds.version ||
    gate.ownerApproval.safetyGateVersion !== gate.safetyGates.version
  ) {
    blockers.add("CALIBRATION_OWNER_APPROVAL_INCONSISTENT");
  }

  const state: R2CalibrationState =
    gate.sourceLabelCount < 30
      ? "UNCALIBRATED"
      : blockers.size === 0
        ? "CALIBRATED"
        : "CALIBRATION_PENDING";
  return {
    state,
    sourceLabelCount: gate.sourceLabelCount,
    comparedLabelCount: completeLabels.length,
    sourcePairCount: gate.sourcePairCount,
    comparedPairCount: completePairs.length,
    roleFamilyCount,
    statusCount,
    labelAgreementBasisPoints,
    pairAgreementBasisPoints,
    blockerCodes: [...blockers].sort(),
  };
}

export function r2OrdinalBand(
  eligibility: R2GoldenObservation["eligibility"],
  score: number,
): R2OrdinalBand {
  if (eligibility === "INELIGIBLE") return "DO_NOT_RECOMMEND";
  if (eligibility === "ELIGIBLE" && score >= 70) return "STRONG_REVIEW";
  if (score >= 45) return "POSSIBLE_REVIEW";
  return "LOW_PRIORITY";
}

export function r2CalibrationState(input: R2CalibrationGateInput): R2CalibrationState {
  return assessR2Calibration(input).state;
}

export function createR2CalibrationContext(input: {
  version: string;
  scorerVersion: string;
  weightVersion: string;
  corpusVersion: string;
  runId: string | null;
  gate: R2CalibrationGateInput;
}): R2CalibrationContext {
  return R2CalibrationContextSchema.parse({
    version: input.version,
    state: r2CalibrationState(input.gate),
    scorerVersion: input.scorerVersion,
    weightVersion: input.weightVersion,
    corpusVersion: input.corpusVersion,
    runId: input.runId,
  });
}

export function evaluateR2GoldenRanking(
  input: R2GoldenObservation[],
  gate: R2CalibrationGateInput,
  topK = 5,
): R2GoldenMetrics {
  const observations = input.map((item) => ({
    ...item,
    score: z.number().min(0).max(100).parse(item.score),
    expectedBand: R2OrdinalBandSchema.parse(item.expectedBand),
  }));
  const agreement = observations.filter(
    (item) => r2OrdinalBand(item.eligibility, item.score) === item.expectedBand,
  ).length;
  const ordered = [...observations].sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
  const selected = ordered.slice(0, Math.max(0, Math.min(topK, ordered.length)));
  const useful = selected.filter(
    ({ expectedBand }) => expectedBand === "STRONG_REVIEW" || expectedBand === "POSSIBLE_REVIEW",
  ).length;
  return {
    total: observations.length,
    ordinalAgreement: observations.length === 0 ? 1 : agreement / observations.length,
    topK: selected.length,
    topKReviewUtility: selected.length === 0 ? 1 : useful / selected.length,
    boundsPass: observations.every(({ score }) => score >= 0 && score <= 100),
    calibrationState: r2CalibrationState(gate),
  };
}

export function assertR2Monotonicity(baseScore: number, addedVerifiedSignalScore: number): void {
  if (addedVerifiedSignalScore < baseScore) throw new Error("R2_MONOTONICITY_VIOLATION");
}

export function r2AblationDelta(fullScore: number, ablatedScore: number): number {
  return (
    z.number().min(0).max(100).parse(fullScore) - z.number().min(0).max(100).parse(ablatedScore)
  );
}
