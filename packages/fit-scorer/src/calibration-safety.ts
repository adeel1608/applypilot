import { createHash } from "node:crypto";
import { z } from "zod";
import type { R2CalibrationSafetyGates } from "./calibration";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const version = z.string().min(1).max(100);
export const R2_CALIBRATION_SAFETY_GATES = [
  "executableGoldenCorpus",
  "determinism",
  "monotonicity",
  "ablation",
  "bounds",
  "recommendationInvariants",
  "privacyAudit",
  "migrationIntegrity",
] as const;
export const R2CalibrationSafetyEngineSchema = z
  .object({
    parserVersion: version,
    normalizationVersion: version,
    evidenceContractVersion: version,
    eligibilityEngineVersion: version,
    scorerVersion: version,
    weightVersion: version,
    goldenCorpusVersion: version,
  })
  .strict();
export type R2CalibrationSafetyEngine = z.infer<typeof R2CalibrationSafetyEngineSchema>;
const artifactPath = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^data\/private\/runtime\/r2-calibration-safety\/[a-f0-9]{40}\/[a-f0-9-]{36}\/[a-z0-9.-]+$/,
  );
const common = {
  gate: z.enum(R2_CALIBRATION_SAFETY_GATES),
  command: z.string().min(1).max(2000),
  exitCode: z.literal(0),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  logArtifact: artifactPath,
  logSha256: digest,
};
const testFile = z
  .object({
    path: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[A-Za-z0-9_./-]+$/),
    gitBlob: commit,
  })
  .strict();
const testProof = z
  .object({
    ...common,
    kind: z.literal("VITEST"),
    resultArtifact: artifactPath,
    resultSha256: digest,
    testFiles: z.array(testFile).min(1).max(20),
    requiredCases: z.array(z.string().min(1).max(500)).min(1).max(40),
  })
  .strict();
const auditProof = z
  .object({
    ...common,
    kind: z.literal("PRIVACY_AUDIT"),
    gate: z.literal("privacyAudit"),
    marker: z.literal("PRIVACY_AUDIT_PASS"),
    testFiles: z.array(testFile).min(1).max(20),
  })
  .strict();
export const R2CalibrationSafetyBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("LOCAL_EXECUTED"),
    head: commit,
    tree: commit,
    engine: R2CalibrationSafetyEngineSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    proofs: z.array(z.discriminatedUnion("kind", [testProof, auditProof])).length(8),
    migrations: z
      .array(
        z
          .object({
            path: z.string().regex(/^packages\/database\/drizzle\/\d{4}_[a-z0-9_]+\.sql$/),
            sha256: digest,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.proofs.map((p) => p.gate)).size !== 8)
      ctx.addIssue({
        code: "custom",
        path: ["proofs"],
        message: "all eight distinct gates are required",
      });
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt))
      ctx.addIssue({ code: "custom", path: ["completedAt"], message: "completion precedes start" });
    for (const [i, p] of value.proofs.entries())
      if (
        Date.parse(p.completedAt) < Date.parse(p.startedAt) ||
        Date.parse(p.startedAt) < Date.parse(value.startedAt) ||
        Date.parse(p.completedAt) > Date.parse(value.completedAt)
      )
        ctx.addIssue({
          code: "custom",
          path: ["proofs", i],
          message: "invalid execution interval",
        });
  });
export type R2CalibrationSafetyBundle = z.infer<typeof R2CalibrationSafetyBundleSchema>;
export interface ValidatedR2CalibrationSafety {
  bundle: R2CalibrationSafetyBundle;
  bundleDigest: string;
  engineDigest: string;
  gates: R2CalibrationSafetyGates;
  head: string;
  tree: string;
}

/** Consistency digest, not a signature or independent proof of execution. */
export function r2CalibrationSafetyDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, canonical(v)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
