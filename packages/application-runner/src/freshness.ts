import { z } from "zod";

export const VerificationFreshnessPolicySchema = z
  .object({
    version: z.string().min(1).max(100),
    preparationMaxAgeMs: z.number().int().positive().finite(),
    preExternalActionMaxAgeMs: z.number().int().positive().finite(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.preExternalActionMaxAgeMs > policy.preparationMaxAgeMs) {
      context.addIssue({
        code: "custom",
        path: ["preExternalActionMaxAgeMs"],
        message: "PRE_EXTERNAL_ACTION_WINDOW_MUST_NOT_EXCEED_PREPARATION_WINDOW",
      });
    }
  });

export type VerificationFreshnessPolicy = z.infer<typeof VerificationFreshnessPolicySchema>;

export const PROPOSED_LOCAL_VERIFICATION_POLICY: VerificationFreshnessPolicy = {
  version: "local-verification-proposal-v1",
  preparationMaxAgeMs: 24 * 60 * 60 * 1000,
  preExternalActionMaxAgeMs: 15 * 60 * 1000,
};

export const VerificationFreshnessOperationSchema = z.enum(["PREPARATION", "PRE_EXTERNAL_ACTION"]);
export type VerificationFreshnessOperation = z.infer<typeof VerificationFreshnessOperationSchema>;

export const VerificationFreshnessResultSchema = z.object({
  state: z.enum(["FRESH", "STALE", "UNKNOWN", "BLOCKED"]),
  reasonCode: z.enum([
    "VERIFICATION_FRESH",
    "VERIFICATION_STALE",
    "VERIFICATION_UNKNOWN",
    "VERIFICATION_NOT_QUALIFIED",
    "VERIFICATION_FUTURE_TIMESTAMP",
    "PROVIDER_EXPIRY_UNKNOWN",
    "PROVIDER_EXPIRED",
  ]),
  providerExpiry: z.enum(["UNKNOWN", "KNOWN", "EXPIRED"]),
  validUntil: z.iso.datetime().nullable(),
  policyVersion: z.string().min(1),
});
export type VerificationFreshnessResult = z.infer<typeof VerificationFreshnessResultSchema>;

export function assessVerificationFreshness(input: {
  verifiedAt: string | null;
  evidenceQualified: boolean;
  providerExpiresAt: string | null;
  operation: VerificationFreshnessOperation;
  policy?: VerificationFreshnessPolicy;
  now?: Date;
}): VerificationFreshnessResult {
  let policy: VerificationFreshnessPolicy;
  try {
    policy = VerificationFreshnessPolicySchema.parse(
      input.policy ?? PROPOSED_LOCAL_VERIFICATION_POLICY,
    );
  } catch {
    throw new Error("FRESHNESS_POLICY_INVALID");
  }
  const now = input.now ?? new Date();
  const providerExpiry = input.providerExpiresAt ? Date.parse(input.providerExpiresAt) : null;
  if (
    providerExpiry !== null &&
    Number.isFinite(providerExpiry) &&
    providerExpiry <= now.getTime()
  ) {
    return {
      state: "BLOCKED",
      reasonCode: "PROVIDER_EXPIRED",
      providerExpiry: "EXPIRED",
      validUntil: null,
      policyVersion: policy.version,
    };
  }
  if (input.providerExpiresAt && !Number.isFinite(providerExpiry)) {
    return {
      state: "BLOCKED",
      reasonCode: "PROVIDER_EXPIRY_UNKNOWN",
      providerExpiry: "UNKNOWN",
      validUntil: null,
      policyVersion: policy.version,
    };
  }
  if (!input.evidenceQualified || !input.verifiedAt) {
    return {
      state: "UNKNOWN",
      reasonCode: "VERIFICATION_NOT_QUALIFIED",
      providerExpiry: input.providerExpiresAt ? "KNOWN" : "UNKNOWN",
      validUntil: null,
      policyVersion: policy.version,
    };
  }
  const verifiedAt = Date.parse(input.verifiedAt);
  if (!Number.isFinite(verifiedAt)) {
    return {
      state: "UNKNOWN",
      reasonCode: "VERIFICATION_UNKNOWN",
      providerExpiry: input.providerExpiresAt ? "KNOWN" : "UNKNOWN",
      validUntil: null,
      policyVersion: policy.version,
    };
  }
  if (verifiedAt > now.getTime()) {
    return {
      state: "UNKNOWN",
      reasonCode: "VERIFICATION_FUTURE_TIMESTAMP",
      providerExpiry: input.providerExpiresAt ? "KNOWN" : "UNKNOWN",
      validUntil: null,
      policyVersion: policy.version,
    };
  }
  const maxAge =
    input.operation === "PREPARATION"
      ? policy.preparationMaxAgeMs
      : policy.preExternalActionMaxAgeMs;
  const validUntil = new Date(verifiedAt + maxAge).toISOString();
  if (now.getTime() >= verifiedAt + maxAge) {
    return {
      state: "STALE",
      reasonCode: "VERIFICATION_STALE",
      providerExpiry: input.providerExpiresAt ? "KNOWN" : "UNKNOWN",
      validUntil,
      policyVersion: policy.version,
    };
  }
  return {
    state: "FRESH",
    reasonCode: "VERIFICATION_FRESH",
    providerExpiry: input.providerExpiresAt ? "KNOWN" : "UNKNOWN",
    validUntil,
    policyVersion: policy.version,
  };
}
