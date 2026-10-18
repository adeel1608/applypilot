import { describe, expect, it } from "vitest";
import {
  R2CalibrationCampaignRequestSchema,
  R2CalibrationLabelRequestSchema,
  R2CalibrationPairRequestSchema,
  R2CalibrationIdSchema,
  R2CalibrationDigestSchema,
  R2CalibrationOwnerGateSchema,
  R2OccupationalFamilySchema,
  R2_OCCUPATIONAL_FAMILIES,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
  r2CalibrationOwnerAction,
  r2CalibrationOwnerProvenance,
  assertR2CalibrationOwnerProvenance,
} from "./calibration-intake";

const at = "2026-10-18T07:00:00.000Z";
const thresholds = {
  version: "fictional-thresholds-1",
  minimumLabelAgreementBasisPoints: 8000,
  minimumPairComparisons: 1,
  minimumPairAgreementBasisPoints: 8000,
};
const request = { jobIds: ["job-1", "job-2"], expectedContextDigest: "a".repeat(64), thresholds };
const label = {
  campaignId: "campaign-1",
  comparisonId: "comparison-1",
  expectedContextDigest: "b".repeat(64),
  previousEventId: null,
  label: "AMBIGUOUS",
  occupationalFamily: "UNKNOWN",
};
const pair = {
  campaignId: "campaign-1",
  leftComparisonId: "comparison-1",
  rightComparisonId: "comparison-2",
  preferredComparisonId: "comparison-2",
  expectedContextDigest: "c".repeat(64),
  previousEventId: null,
};
const proof = (action: string) => ({
  action,
  consumedAt: at,
  loopbackValidated: true as const,
  localSessionValidated: true as const,
  nonceConsumed: true as const,
});

describe("calibration intake closed owner contracts", () => {
  it("requires deliberate thresholds without defaults and a feasible positive pair sample", () => {
    expect(R2CalibrationCampaignRequestSchema.parse(request)).toEqual(request);
    for (const thresholds of [
      undefined,
      {},
      { ...request.thresholds, version: "" },
      { ...request.thresholds, minimumPairComparisons: 0 },
      { ...request.thresholds, minimumPairComparisons: 2 },
    ])
      expect(R2CalibrationCampaignRequestSchema.safeParse({ ...request, thresholds }).success).toBe(
        false,
      );
    expect(
      R2CalibrationCampaignRequestSchema.safeParse({ ...request, jobIds: ["job-1", "job-1"] })
        .success,
    ).toBe(false);
    expect(
      R2CalibrationCampaignRequestSchema.safeParse({ ...request, actor: "OWNER" }).success,
    ).toBe(false);
    expect(
      R2CalibrationCampaignRequestSchema.safeParse({
        ...request,
        jobIds: Array.from({ length: 301 }, (_, i) => `job-${i}`),
      }).success,
    ).toBe(false);
  });
  it("uses duties-based closed occupational codes with an explicit incomplete UNKNOWN", () => {
    expect(R2CalibrationLabelRequestSchema.parse(label).occupationalFamily).toBe("UNKNOWN");
    for (const value of ["Fictional Company", "REMOTE", "PART_TIME", "SENIOR", "", "family-1"])
      expect(R2OccupationalFamilySchema.safeParse(value).success).toBe(false);
    expect(Object.keys(R2_OCCUPATIONAL_FAMILIES)).toHaveLength(13);
    expect(R2CalibrationLabelRequestSchema.safeParse({ ...label, label: "" }).success).toBe(false);
    expect(
      R2CalibrationLabelRequestSchema.safeParse({ ...label, eligibility: "ELIGIBLE" }).success,
    ).toBe(false);
  });
  it.each(["\n", "\r", "\0", "\u007f", "\u2028", "\u2029", " "])(
    "rejects control/whitespace subject lookalikes %j",
    (value) => {
      expect(R2CalibrationIdSchema.safeParse(`job-1${value}`).success).toBe(false);
      expect(R2CalibrationIdSchema.safeParse(`job${value}-1`).success).toBe(false);
      expect(R2CalibrationDigestSchema.safeParse("a".repeat(64) + value).success).toBe(false);
    },
  );
  it("requires distinct pair members and preference for an actually displayed side", () => {
    expect(R2CalibrationPairRequestSchema.safeParse(pair).success).toBe(true);
    expect(
      R2CalibrationPairRequestSchema.safeParse({
        ...pair,
        rightComparisonId: pair.leftComparisonId,
      }).success,
    ).toBe(false);
    expect(
      R2CalibrationPairRequestSchema.safeParse({ ...pair, preferredComparisonId: "third-job" })
        .success,
    ).toBe(false);
    expect(R2CalibrationPairRequestSchema.safeParse({ ...pair, preferredScore: 100 }).success).toBe(
      false,
    );
  });
  it("binds complete context, displayed members and previous revision to a bounded legacy-compatible nonce label", () => {
    const bindings = [
      r2CalibrationCreateBinding(request),
      r2CalibrationLabelBinding(label),
      r2CalibrationPairBinding(pair),
      { campaignId: "campaign-1", assessmentDigest: "d".repeat(64) },
    ];
    const purposes = ["CREATE", "LABEL", "PAIR", "QUAL"] as const;
    const actions = purposes.map((purpose, i) => r2CalibrationOwnerAction(purpose, bindings[i]));
    expect(new Set(actions).size).toBe(4);
    for (const action of actions) expect(action).toMatch(/^[A-Z][A-Z0-9_]{2,80}$/);
    expect(
      r2CalibrationOwnerAction(
        "CREATE",
        r2CalibrationCreateBinding({ ...request, jobIds: [...request.jobIds].reverse() }),
      ),
    ).toBe(actions[0]);
    expect(
      r2CalibrationOwnerAction(
        "LABEL",
        r2CalibrationLabelBinding({ ...label, comparisonId: "other" }),
      ),
    ).not.toBe(actions[1]);
    expect(
      r2CalibrationOwnerAction(
        "PAIR",
        r2CalibrationPairBinding({ ...pair, previousEventId: "previous" }),
      ),
    ).not.toBe(actions[2]);
    expect(
      r2CalibrationOwnerAction("QUAL", {
        campaignId: "campaign-1",
        assessmentDigest: "e".repeat(64),
      }),
    ).not.toBe(actions[3]);
  });
  it("accepts only exact server-derived owner proof, without posted actor or blanket approval", () => {
    const binding = r2CalibrationLabelBinding(label),
      gate = proof(r2CalibrationOwnerAction("LABEL", binding));
    const provenance = r2CalibrationOwnerProvenance("LABEL", binding, gate, at);
    expect(assertR2CalibrationOwnerProvenance(provenance, "LABEL", binding)).toEqual(provenance);
    for (const field of ["loopbackValidated", "localSessionValidated", "nonceConsumed"])
      expect(() =>
        r2CalibrationOwnerProvenance("LABEL", binding, { ...gate, [field]: false }, at),
      ).toThrow();
    expect(() => r2CalibrationOwnerProvenance("PAIR", binding, gate, at)).toThrow(
      "R2_CALIBRATION_OWNER_GATE_MISMATCH",
    );
    expect(() =>
      r2CalibrationOwnerProvenance("LABEL", { ...binding, comparisonId: "other" }, gate, at),
    ).toThrow();
    expect(() =>
      r2CalibrationOwnerProvenance("LABEL", binding, gate, "2026-10-18T07:06:00.000Z"),
    ).toThrow();
    expect(() =>
      r2CalibrationOwnerProvenance("LABEL", binding, gate, "2026-10-18T06:59:59.999Z"),
    ).toThrow();
    expect(R2CalibrationOwnerGateSchema.safeParse({ ...gate, actor: "OWNER" }).success).toBe(false);
    expect(
      R2CalibrationOwnerGateSchema.safeParse({ ...gate, action: gate.action + "\n" }).success,
    ).toBe(false);
  });
});
