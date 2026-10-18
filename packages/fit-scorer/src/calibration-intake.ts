import { z } from "zod";

import { R2CalibrationPerformanceThresholdsSchema } from "./calibration";
import { r2CalibrationSafetyDigest } from "./calibration-safety";

export const R2_CALIBRATION_INTAKE_VERSION = "r2-intake-1";
export const R2_OCCUPATION_TAXONOMY_VERSION = "r2-occupation-1";
export const R2_CALIBRATION_MAXIMUM_MEMBERS = 300;

/** Occupations describe actual duties; an employer, seniority or work arrangement is not a family. */
export const R2_OCCUPATIONAL_FAMILIES = {
  RETAIL_CUSTOMER_SERVICE: "Retail and customer service",
  HOSPITALITY_FOOD: "Hospitality and food service",
  ADMINISTRATION_OFFICE: "Administration and office support",
  LOGISTICS_WAREHOUSE: "Logistics and warehouse operations",
  SOFTWARE_INFORMATION_TECHNOLOGY: "Software and information technology",
  ENGINEERING_TECHNICAL: "Engineering and technical work",
  TRADES_MAINTENANCE: "Trades and maintenance",
  HEALTH_CARE: "Health and care work",
  EDUCATION_TRAINING: "Education and training",
  BUSINESS_FINANCE: "Business and finance",
  SALES_MARKETING: "Sales and marketing",
  CREATIVE_COMMUNICATIONS: "Creative and communications work",
  UNKNOWN: "Unknown or not represented (does not count toward diversity)",
} as const;

export const R2CalibrationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/)
  .refine((v) => v === v.trim());
export const R2CalibrationDigestSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
export const R2CalibrationVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9:._-]+$/)
  .refine((v) => v === v.trim());
export const R2OccupationalFamilySchema = z.enum(
  Object.keys(R2_OCCUPATIONAL_FAMILIES) as [
    keyof typeof R2_OCCUPATIONAL_FAMILIES,
    ...Array<keyof typeof R2_OCCUPATIONAL_FAMILIES>,
  ],
);
export const R2CalibrationOwnerLabelSchema = z.enum(["GOOD_MATCH", "POOR_MATCH", "AMBIGUOUS"]);

export const R2CalibrationThresholdPrecommitSchema =
  R2CalibrationPerformanceThresholdsSchema.extend({
    version: R2CalibrationVersionSchema,
    minimumPairComparisons: z.number().int().positive().max(44_850),
  }).strict();
export type R2CalibrationThresholdPrecommit = z.infer<typeof R2CalibrationThresholdPrecommitSchema>;

export const R2CalibrationOwnerGateSchema = z
  .object({
    action: z
      .string()
      .regex(/^CAL_(?:CREATE|LABEL|PAIR|QUAL)_[A-F0-9]{64}$/)
      .refine((v) => v === v.trim()),
    consumedAt: z.iso.datetime(),
    loopbackValidated: z.literal(true),
    localSessionValidated: z.literal(true),
    nonceConsumed: z.literal(true),
  })
  .strict();
export type R2CalibrationOwnerGate = z.infer<typeof R2CalibrationOwnerGateSchema>;

export const R2CalibrationOwnerProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    actor: z.literal("LOCAL_OWNER"),
    purpose: z.enum(["CREATE", "LABEL", "PAIR", "QUAL"]),
    bindingDigest: R2CalibrationDigestSchema,
    gate: R2CalibrationOwnerGateSchema,
    recordedAt: z.iso.datetime(),
  })
  .strict();
export type R2CalibrationOwnerProvenance = z.infer<typeof R2CalibrationOwnerProvenanceSchema>;

export const R2CalibrationCampaignRequestSchema = z
  .object({
    jobIds: z.array(R2CalibrationIdSchema).min(1).max(R2_CALIBRATION_MAXIMUM_MEMBERS),
    thresholds: R2CalibrationThresholdPrecommitSchema,
    expectedContextDigest: R2CalibrationDigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.jobIds).size !== value.jobIds.length)
      context.addIssue({ code: "custom", path: ["jobIds"], message: "actual jobs must be unique" });
    if (
      value.thresholds.minimumPairComparisons >
      (value.jobIds.length * (value.jobIds.length - 1)) / 2
    )
      context.addIssue({
        code: "custom",
        path: ["thresholds", "minimumPairComparisons"],
        message: "pair sample exceeds the selected corpus",
      });
  });

export const R2CalibrationLabelRequestSchema = z
  .object({
    campaignId: R2CalibrationIdSchema,
    comparisonId: R2CalibrationIdSchema,
    expectedContextDigest: R2CalibrationDigestSchema,
    previousEventId: R2CalibrationIdSchema.nullable(),
    label: R2CalibrationOwnerLabelSchema,
    occupationalFamily: R2OccupationalFamilySchema,
  })
  .strict();

export const R2CalibrationPairRequestSchema = z
  .object({
    campaignId: R2CalibrationIdSchema,
    leftComparisonId: R2CalibrationIdSchema,
    rightComparisonId: R2CalibrationIdSchema,
    preferredComparisonId: R2CalibrationIdSchema,
    expectedContextDigest: R2CalibrationDigestSchema,
    previousEventId: R2CalibrationIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.leftComparisonId === value.rightComparisonId)
      context.addIssue({
        code: "custom",
        path: ["rightComparisonId"],
        message: "pair jobs must differ",
      });
    if (![value.leftComparisonId, value.rightComparisonId].includes(value.preferredComparisonId))
      context.addIssue({
        code: "custom",
        path: ["preferredComparisonId"],
        message: "preference must be one of the displayed pair",
      });
  });

export type R2CalibrationCampaignRequest = z.infer<typeof R2CalibrationCampaignRequestSchema>;
export type R2CalibrationLabelRequest = z.infer<typeof R2CalibrationLabelRequestSchema>;
export type R2CalibrationPairRequest = z.infer<typeof R2CalibrationPairRequestSchema>;

export function r2CalibrationCreateBinding(
  request: Pick<R2CalibrationCampaignRequest, "jobIds" | "expectedContextDigest">,
) {
  return {
    jobIds: [...request.jobIds].sort(),
    expectedContextDigest: request.expectedContextDigest,
  };
}
export function r2CalibrationLabelBinding(
  request: Omit<R2CalibrationLabelRequest, "label" | "occupationalFamily">,
) {
  return {
    campaignId: request.campaignId,
    comparisonId: request.comparisonId,
    expectedContextDigest: request.expectedContextDigest,
    previousEventId: request.previousEventId,
  };
}
export function r2CalibrationPairBinding(
  request: Omit<R2CalibrationPairRequest, "preferredComparisonId">,
) {
  return {
    campaignId: request.campaignId,
    leftComparisonId: request.leftComparisonId,
    rightComparisonId: request.rightComparisonId,
    expectedContextDigest: request.expectedContextDigest,
    previousEventId: request.previousEventId,
  };
}

/** Purpose and the entire canonical request are bound, without logging the nonce or session. */
export function r2CalibrationOwnerAction(
  purpose: R2CalibrationOwnerProvenance["purpose"],
  binding: unknown,
): string {
  return `CAL_${purpose}_${r2CalibrationSafetyDigest({ domain: "applypilot.calibration.owner.v1", purpose, binding }).toUpperCase()}`;
}

export function r2CalibrationOwnerProvenance(
  purpose: R2CalibrationOwnerProvenance["purpose"],
  binding: unknown,
  gateInput: unknown,
  recordedAt: string,
): R2CalibrationOwnerProvenance {
  const gate = R2CalibrationOwnerGateSchema.parse(gateInput);
  if (
    gate.action !== r2CalibrationOwnerAction(purpose, binding) ||
    Date.parse(gate.consumedAt) > Date.parse(recordedAt) ||
    Date.parse(recordedAt) - Date.parse(gate.consumedAt) > 5 * 60_000
  )
    throw new Error("R2_CALIBRATION_OWNER_GATE_MISMATCH");
  return R2CalibrationOwnerProvenanceSchema.parse({
    schemaVersion: 1,
    actor: "LOCAL_OWNER",
    purpose,
    bindingDigest: r2CalibrationSafetyDigest(binding),
    gate,
    recordedAt,
  });
}

export function assertR2CalibrationOwnerProvenance(
  input: unknown,
  purpose: R2CalibrationOwnerProvenance["purpose"],
  binding: unknown,
): R2CalibrationOwnerProvenance {
  const value = R2CalibrationOwnerProvenanceSchema.parse(input);
  const expected = r2CalibrationOwnerProvenance(purpose, binding, value.gate, value.recordedAt);
  if (r2CalibrationSafetyDigest(value) !== r2CalibrationSafetyDigest(expected))
    throw new Error("R2_CALIBRATION_OWNER_PROVENANCE_INVALID");
  return value;
}
