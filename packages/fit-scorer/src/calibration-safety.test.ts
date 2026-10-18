import { describe, expect, it } from "vitest";
import {
  R2_CALIBRATION_SAFETY_GATES,
  R2CalibrationSafetyBundleSchema,
  r2CalibrationSafetyDigest,
} from "./calibration-safety";

function fictionalBundle() {
  const startedAt = "2026-01-01T00:00:00.000Z",
    completedAt = "2026-01-01T00:01:00.000Z",
    path = `data/private/runtime/r2-calibration-safety/${"a".repeat(40)}/00000000-0000-0000-0000-000000000000`;
  return {
    schemaVersion: 1,
    mode: "LOCAL_EXECUTED",
    head: "a".repeat(40),
    tree: "b".repeat(40),
    engine: {
      parserVersion: "fixture",
      normalizationVersion: "fixture",
      evidenceContractVersion: "fixture",
      eligibilityEngineVersion: "fixture",
      scorerVersion: "fixture",
      weightVersion: "fixture",
      goldenCorpusVersion: "fixture",
    },
    startedAt,
    completedAt,
    proofs: R2_CALIBRATION_SAFETY_GATES.map((gate) => ({
      kind: gate === "privacyAudit" ? "PRIVACY_AUDIT" : "VITEST",
      gate,
      command: "fictional contract fixture",
      exitCode: 0,
      startedAt,
      completedAt,
      logArtifact: `${path}/test.log`,
      logSha256: "c".repeat(64),
      testFiles: [{ path: "tests/fictional.test.ts", gitBlob: "d".repeat(40) }],
      ...(gate === "privacyAudit"
        ? { marker: "PRIVACY_AUDIT_PASS" }
        : {
            resultArtifact: `${path}/tests.json`,
            resultSha256: "e".repeat(64),
            requiredCases: ["fictional"],
          }),
    })),
    migrations: [
      { path: "packages/database/drizzle/0015_r2_calibration_intake.sql", sha256: "f".repeat(64) },
    ],
  };
}
describe("calibration safety contract (fictional schema fixtures only)", () => {
  it("accepts the closed eight-proof shape without claiming its execution", () => {
    expect(R2CalibrationSafetyBundleSchema.parse(fictionalBundle()).proofs).toHaveLength(8);
  });
  it("rejects boolean-only, missing, duplicate and extra proof data", () => {
    const bundle = fictionalBundle();
    expect(
      R2CalibrationSafetyBundleSchema.safeParse({ ...bundle, proofs: Array(8).fill(true) }).success,
    ).toBe(false);
    expect(
      R2CalibrationSafetyBundleSchema.safeParse({ ...bundle, proofs: bundle.proofs.slice(1) })
        .success,
    ).toBe(false);
    expect(
      R2CalibrationSafetyBundleSchema.safeParse({
        ...bundle,
        proofs: [bundle.proofs[0], ...bundle.proofs.slice(0, 7)],
      }).success,
    ).toBe(false);
    expect(
      R2CalibrationSafetyBundleSchema.safeParse({ ...bundle, ownerApproved: true }).success,
    ).toBe(false);
    expect(
      R2CalibrationSafetyBundleSchema.safeParse({
        ...bundle,
        proofs: bundle.proofs.map((p) => ({ ...p, rawException: "PRIVATE_CANARY" })),
      }).success,
    ).toBe(false);
  });
  it("rejects failed commands, unconfined artifacts and impossible intervals", () => {
    const bundle = fictionalBundle();
    for (const patch of [
      { exitCode: 1 },
      { logArtifact: "../outside.log" },
      { completedAt: "2025-01-01T00:00:00.000Z" },
    ]) {
      expect(
        R2CalibrationSafetyBundleSchema.safeParse({
          ...bundle,
          proofs: bundle.proofs.map((p, i) => (i === 0 ? { ...p, ...patch } : p)),
        }).success,
      ).toBe(false);
    }
  });
  it("hashes equivalent key orders deterministically and distinguishes changed bindings", () => {
    expect(r2CalibrationSafetyDigest({ a: 1, b: { x: 2, y: 3 } })).toBe(
      r2CalibrationSafetyDigest({ b: { y: 3, x: 2 }, a: 1 }),
    );
    expect(r2CalibrationSafetyDigest({ a: 1, b: 2 })).not.toBe(
      r2CalibrationSafetyDigest({ a: 1, b: 3 }),
    );
  });
});
