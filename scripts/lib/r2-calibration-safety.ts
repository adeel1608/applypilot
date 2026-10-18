import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readCalibrationEvidenceFile as boundedFile } from "./r2-calibration-evidence-files";
import { z } from "zod";
import {
  R2A_PARSER_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_EVIDENCE_CONTRACT_VERSION,
} from "@applypilot/job-model";
import { R2_ELIGIBILITY_ENGINE_VERSION } from "@applypilot/eligibility-engine";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import {
  R2_FIT_SCORER_VERSION,
  R2_FIT_WEIGHT_VERSION,
  R2_GOLDEN_CORPUS_VERSION,
} from "@applypilot/fit-scorer";
import {
  R2CalibrationSafetyBundleSchema,
  R2CalibrationSafetyEngineSchema,
  r2CalibrationSafetyDigest,
  type R2CalibrationSafetyEngine,
  type ValidatedR2CalibrationSafety,
} from "../../packages/fit-scorer/src/calibration-safety";

const calibration = "packages/fit-scorer/src/calibration.test.ts";
const scorer = "packages/fit-scorer/src/r2.test.ts";
const migration = "tests/integration/calibration-migration.test.ts";
export const R2_SAFETY_TEST_CASES = {
  executableGoldenCorpus: [
    {
      file: calibration,
      title: "executes actual eligibility and scorer inputs twice with matching golden outcomes",
    },
    {
      file: calibration,
      title: "detects an actual scorer-weight regression and an altered eligibility result",
    },
  ],
  determinism: [
    {
      file: calibration,
      title: "executes actual eligibility and scorer inputs twice with matching golden outcomes",
    },
    {
      file: scorer,
      title: "is deterministic, bounded, and monotonic for an added verified signal",
    },
  ],
  monotonicity: [
    { file: calibration, title: "uses actual scorer runs for monotonicity, ablation, and bounds" },
    {
      file: scorer,
      title: "is deterministic, bounded, and monotonic for an added verified signal",
    },
  ],
  ablation: [
    {
      file: calibration,
      title: "never recommends review-required/ineligible cases and ablates unusable evidence",
    },
    { file: calibration, title: "uses actual scorer runs for monotonicity, ablation, and bounds" },
    {
      file: scorer,
      title: "ablates stale, unknown, conditional, and conflicting job evidence to zero",
    },
    { file: scorer, title: "gives a stale profile/job binding zero candidate-fact contributions" },
  ],
  bounds: [
    { file: calibration, title: "uses actual scorer runs for monotonicity, ablation, and bounds" },
    {
      file: scorer,
      title: "is deterministic, bounded, and monotonic for an added verified signal",
    },
  ],
  recommendationInvariants: [
    {
      file: calibration,
      title: "never recommends review-required/ineligible cases and ablates unusable evidence",
    },
    {
      file: scorer,
      title: "never recommends review-required or ineligible work regardless of score",
    },
    { file: scorer, title: "blocks recommendation when observed material scope is partial" },
  ],
  migrationIntegrity: [
    {
      file: migration,
      title: "preserves all historical rows through schema15 and production backup restore",
    },
    { file: migration, title: "rolls back a failed schema15 transaction without changing history" },
  ],
} as const;
export const R2_SAFETY_TEST_FILES = [calibration, scorer, migration];
export const R2_SAFETY_TEST_COMMAND = `node node_modules/vitest/vitest.mjs run ${R2_SAFETY_TEST_FILES.join(" ")} --maxWorkers=1 --reporter=json`;
export const R2_SAFETY_PRIVACY_COMMAND =
  "node node_modules/tsx/dist/cli.mjs scripts/privacy-audit.ts";
export const R2_SAFETY_PRIVACY_FILES = [
  "scripts/privacy-audit.ts",
  "scripts/lib/privacy-canary.ts",
];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const requireSafe = (condition: unknown): void => {
  if (!condition) throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
};
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 2_000_000,
  }).trim();
export function currentR2CalibrationSafetyEngine(): R2CalibrationSafetyEngine {
  return R2CalibrationSafetyEngineSchema.parse({
    parserVersion: R2A_PARSER_VERSION,
    normalizationVersion: R2A_NORMALIZATION_VERSION,
    evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
    eligibilityEngineVersion: R2_ELIGIBILITY_ENGINE_VERSION,
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
    goldenCorpusVersion: R2_GOLDEN_CORPUS_VERSION,
  });
}
function verifyGitFiles(
  root: string,
  files: Array<{ path: string; gitBlob: string }>,
  expectedPaths: readonly string[],
  verified: Map<string, { blob: string; sha256: string }>,
): void {
  requireSafe(
    files.length === expectedPaths.length &&
      new Set(files.map((f) => f.path)).size === files.length,
  );
  for (const path of expectedPaths) {
    const entry = files.find((f) => f.path === path);
    requireSafe(entry);
    const prior = verified.get(path);
    if (prior) {
      requireSafe(prior.blob === entry!.gitBlob);
      continue;
    }
    requireSafe(entry!.gitBlob === git(root, "rev-parse", `HEAD:${path}`));
    const bytes = boundedFile(root, path, 5_000_000);
    // Git hashes checkout text after its declared clean filters; Windows CRLF is intentional.
    const filtered = execFileSync("git", ["hash-object", "--path", path, "--stdin"], {
      cwd: root,
      input: bytes,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    }).trim();
    requireSafe(filtered === entry!.gitBlob);
    verified.set(path, { blob: entry!.gitBlob, sha256: sha(bytes) });
  }
}
const ReportSchema = z.object({
  startTime: z.number().int().positive(),
  success: z.literal(true),
  numFailedTests: z.literal(0),
  numFailedTestSuites: z.literal(0),
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.literal("passed"),
      assertionResults: z.array(z.object({ title: z.string(), status: z.string() })),
    }),
  ),
});

/** Validates actual retained command artifacts; a schema-valid collection of booleans cannot pass. */
function validateBundle(input: {
  root: string;
  bundle: unknown;
  expectedHead: string;
  expectedTree: string;
  expectedEngine: R2CalibrationSafetyEngine;
}): ValidatedR2CalibrationSafety {
  const bundle = R2CalibrationSafetyBundleSchema.parse(input.bundle);
  requireSafe(git(input.root, "status", "--porcelain").length === 0);
  requireSafe(
    bundle.head === input.expectedHead &&
      bundle.tree === input.expectedTree &&
      bundle.head === git(input.root, "rev-parse", "HEAD") &&
      bundle.tree === git(input.root, "rev-parse", "HEAD^{tree}"),
  );
  requireSafe(
    r2CalibrationSafetyDigest(bundle.engine) === r2CalibrationSafetyDigest(input.expectedEngine),
  );
  const prefix = `data/private/runtime/r2-calibration-safety/${bundle.head}/`;
  const reports = new Map<string, z.infer<typeof ReportSchema>>();
  const verified = new Map<string, { blob: string; sha256: string }>();
  for (const proof of bundle.proofs) {
    requireSafe(proof.logArtifact.startsWith(prefix));
    const log = boundedFile(input.root, proof.logArtifact, 20_000_000);
    requireSafe(sha(log) === proof.logSha256);
    if (proof.kind === "PRIVACY_AUDIT") {
      requireSafe(
        proof.command === R2_SAFETY_PRIVACY_COMMAND &&
          log
            .toString("utf8")
            .split(/\r?\n/)
            .some((line) =>
              /^PRIVACY_AUDIT_PASS tracked_files=\d+ history_paths_checked=\d+ history_blobs_checked=\d+ build_test_artifacts_checked=\d+ private_canaries_checked=\d+$/.test(
                line,
              ),
            ),
      );
      verifyGitFiles(input.root, proof.testFiles, R2_SAFETY_PRIVACY_FILES, verified);
    } else {
      requireSafe(
        proof.gate !== "privacyAudit" &&
          proof.command === R2_SAFETY_TEST_COMMAND &&
          proof.resultArtifact.startsWith(prefix),
      );
      const result = boundedFile(input.root, proof.resultArtifact, 10_000_000);
      requireSafe(sha(result) === proof.resultSha256);
      let report = reports.get(proof.resultArtifact);
      if (!report) {
        report = ReportSchema.parse(JSON.parse(result.toString("utf8")));
        reports.set(proof.resultArtifact, report);
      }
      requireSafe(
        report.startTime >= Date.parse(proof.startedAt) &&
          report.startTime <= Date.parse(proof.completedAt),
      );
      const expected = R2_SAFETY_TEST_CASES[proof.gate as keyof typeof R2_SAFETY_TEST_CASES];
      requireSafe(expected);
      requireSafe(
        JSON.stringify(proof.requiredCases) === JSON.stringify(expected.map((c) => c.title)),
      );
      verifyGitFiles(
        input.root,
        proof.testFiles,
        [...new Set(expected.map((c) => c.file))],
        verified,
      );
      for (const item of expected) {
        const files = report.testResults.filter(
          (row) =>
            relative(resolve(input.root), resolve(row.name)).split(sep).join("/") === item.file,
        );
        requireSafe(files.length === 1);
        const cases = files[0]!.assertionResults.filter((row) => row.title === item.title);
        requireSafe(cases.length === 1 && cases[0]!.status === "passed");
      }
    }
  }
  const migrationRoot = join(input.root, "packages/database/drizzle");
  const names = readdirSync(migrationRoot)
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort();
  requireSafe(
    bundle.migrations.length === names.length &&
      new Set(bundle.migrations.map((m) => m.path)).size === names.length,
  );
  for (const name of names) {
    const path = `packages/database/drizzle/${name}`,
      record = bundle.migrations.find((m) => m.path === path);
    requireSafe(record && record.sha256 === sha(boundedFile(input.root, path, 10_000_000)));
  }
  for (const [path, record] of verified)
    requireSafe(record.sha256 === sha(boundedFile(input.root, path, 5_000_000)));
  requireSafe(
    git(input.root, "status", "--porcelain").length === 0 &&
      git(input.root, "rev-parse", "HEAD") === bundle.head &&
      git(input.root, "rev-parse", "HEAD^{tree}") === bundle.tree,
  );
  const bundleDigest = r2CalibrationSafetyDigest(bundle);
  return {
    bundle,
    bundleDigest,
    engineDigest: r2CalibrationSafetyDigest(bundle.engine),
    head: bundle.head,
    tree: bundle.tree,
    gates: {
      version: `r2-safety-v1:${bundleDigest}`,
      executableGoldenCorpus: true,
      determinism: true,
      monotonicity: true,
      ablation: true,
      bounds: true,
      recommendationInvariants: true,
      privacyAudit: true,
      migrationIntegrity: true,
    },
  };
}
export function validateR2CalibrationSafetyBundle(
  input: Parameters<typeof validateBundle>[0],
): ValidatedR2CalibrationSafety {
  try {
    return validateBundle(input);
  } catch {
    throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
  }
}
export function readCurrentR2CalibrationSafety(root: string): ValidatedR2CalibrationSafety {
  try {
    const bytes = boundedFile(root, "data/private/runtime/r2-calibration-safety.json", 1_000_000);
    return validateR2CalibrationSafetyBundle({
      root,
      bundle: JSON.parse(bytes.toString("utf8")),
      expectedHead: git(root, "rev-parse", "HEAD"),
      expectedTree: git(root, "rev-parse", "HEAD^{tree}"),
      expectedEngine: currentR2CalibrationSafetyEngine(),
    });
  } catch {
    throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
  }
}
export function readCurrentR2CalibrationProfileHash(root: string): string {
  try {
    const filename = process.env.APPLYPILOT_PROFILE_FILENAME ?? "profile.private.json";
    requireSafe(/^profile(?:\.[A-Za-z0-9-]+)?\.private\.json$/.test(filename));
    return candidateProfileContentHash(
      CandidateProfileSchema.parse(
        JSON.parse(boundedFile(root, `data/${filename}`, 1_000_000).toString("utf8")),
      ),
    );
  } catch {
    throw new Error("R2_CALIBRATION_PROFILE_BINDING_INVALID");
  }
}
