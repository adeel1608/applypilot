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
        message: "a calibrated context must bind a durable calibration run",
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

export interface R2CalibrationGateInput {
  independentlyReviewedPrivateJobs: number;
  roleFamilies: number;
  statuses: Array<"ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE">;
}

export interface R2GoldenMetrics {
  total: number;
  ordinalAgreement: number;
  topK: number;
  topKReviewUtility: number;
  boundsPass: boolean;
  calibrationState: R2CalibrationState;
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

export function r2CalibrationState(input: R2CalibrationGateInput): "CALIBRATED" | "UNCALIBRATED" {
  const statuses = new Set(input.statuses);
  return input.independentlyReviewedPrivateJobs >= 30 &&
    input.roleFamilies >= 4 &&
    statuses.has("ELIGIBLE") &&
    statuses.has("REVIEW_REQUIRED") &&
    statuses.has("INELIGIBLE")
    ? "CALIBRATED"
    : "UNCALIBRATED";
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
