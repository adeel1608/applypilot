import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  R2_CALIBRATION_SAFETY_GATES,
  R2CalibrationSafetyBundleSchema,
} from "@applypilot/fit-scorer";
import { repositoryRoot } from "./lib/runtime-safety";
import {
  createCalibrationEvidenceDirectory,
  writeCalibrationEvidenceFile,
  installCurrentCalibrationEvidence,
  readCalibrationEvidenceFile,
} from "./lib/r2-calibration-evidence-files";
import {
  currentR2CalibrationSafetyEngine,
  R2_SAFETY_TEST_CASES,
  R2_SAFETY_TEST_FILES,
  R2_SAFETY_TEST_COMMAND,
  R2_SAFETY_PRIVACY_COMMAND,
  R2_SAFETY_PRIVACY_FILES,
  validateR2CalibrationSafetyBundle,
} from "./lib/r2-calibration-safety";

/** Technical evidence only: never opens the canonical DB or records an owner judgment. */
function main(): void {
  const root = repositoryRoot();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  if (git("status", "--porcelain")) throw new Error("R2_CALIBRATION_SAFETY_FROZEN_HEAD_REQUIRED");
  const head = git("rev-parse", "HEAD"),
    tree = git("rev-parse", "HEAD^{tree}"),
    startedAt = new Date().toISOString();
  const relativeDirectory = `data/private/runtime/r2-calibration-safety/${head}/${randomUUID()}`;
  createCalibrationEvidenceDirectory(root, relativeDirectory);
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const fileRecords = (paths: readonly string[]) =>
    paths.map((path) => ({ path, gitBlob: git("rev-parse", `HEAD:${path}`) }));
  const execute = (args: string[], name: string) => {
    const start = new Date().toISOString();
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 20_000_000,
      env: { ...process.env, VITEST_MAX_WORKERS: "1" },
    });
    const body = [
      result.stdout ?? "",
      result.stderr ?? "",
      result.error ? "CHILD_PROCESS_ERROR" : "",
    ].join("\n");
    writeCalibrationEvidenceFile(root, `${relativeDirectory}/${name}`, body);
    const observed = {
      startedAt: start,
      completedAt: new Date().toISOString(),
      exitCode: result.status,
      logArtifact: `${relativeDirectory}/${name}`,
      logSha256: sha(body),
    };
    if (result.error || result.status !== 0)
      throw new Error("R2_CALIBRATION_SAFETY_COMMAND_FAILED");
    return { evidence: { ...observed, exitCode: 0 as const }, stdout: result.stdout };
  };
  const test = execute(
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...R2_SAFETY_TEST_FILES,
      "--maxWorkers=1",
      "--reporter=json",
    ],
    "tests.log",
  );
  JSON.parse(test.stdout); // A polluted or incomplete reporter stream is never repaired into PASS.
  writeCalibrationEvidenceFile(root, `${relativeDirectory}/tests.json`, test.stdout);
  const audit = execute(
    ["node_modules/tsx/dist/cli.mjs", "scripts/privacy-audit.ts"],
    "privacy.log",
  );
  const resultSha256 = sha(
    readCalibrationEvidenceFile(root, `${relativeDirectory}/tests.json`, 10_000_000),
  );
  const proofs = R2_CALIBRATION_SAFETY_GATES.map((gate) => {
    if (gate === "privacyAudit")
      return {
        kind: "PRIVACY_AUDIT" as const,
        gate,
        command: R2_SAFETY_PRIVACY_COMMAND,
        ...audit.evidence,
        marker: "PRIVACY_AUDIT_PASS" as const,
        testFiles: fileRecords(R2_SAFETY_PRIVACY_FILES),
      };
    const required = R2_SAFETY_TEST_CASES[gate];
    return {
      kind: "VITEST" as const,
      gate,
      command: R2_SAFETY_TEST_COMMAND,
      ...test.evidence,
      resultArtifact: `${relativeDirectory}/tests.json`,
      resultSha256,
      testFiles: fileRecords([...new Set(required.map((c) => c.file))]),
      requiredCases: required.map((c) => c.title),
    };
  });
  const migrations = readdirSync(join(root, "packages/database/drizzle"))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort()
    .map((name) => ({
      path: `packages/database/drizzle/${name}`,
      sha256: sha(
        readCalibrationEvidenceFile(root, `packages/database/drizzle/${name}`, 10_000_000),
      ),
    }));
  const bundle = R2CalibrationSafetyBundleSchema.parse({
    schemaVersion: 1,
    mode: "LOCAL_EXECUTED",
    head,
    tree,
    engine: currentR2CalibrationSafetyEngine(),
    startedAt,
    completedAt: new Date().toISOString(),
    proofs,
    migrations,
  });
  const validated = validateR2CalibrationSafetyBundle({
    root,
    bundle,
    expectedHead: head,
    expectedTree: tree,
    expectedEngine: bundle.engine,
  });
  if (git("status", "--porcelain") || git("rev-parse", "HEAD") !== head)
    throw new Error("R2_CALIBRATION_SAFETY_FROZEN_HEAD_CHANGED");
  const bytes = JSON.stringify(bundle, null, 2) + "\n";
  writeCalibrationEvidenceFile(root, `${relativeDirectory}/bundle.json`, bytes);
  writeCalibrationEvidenceFile(root, `${relativeDirectory}/current.tmp`, bytes);
  installCurrentCalibrationEvidence(root, `${relativeDirectory}/current.tmp`);
  console.log(
    JSON.stringify({
      state: "R2_CALIBRATION_TECHNICAL_SAFETY_PROVEN",
      head,
      tree,
      engine: bundle.engine,
      bundleDigest: validated.bundleDigest,
      gates: validated.gates.version,
      artifacts: relativeDirectory,
      ownerJudgmentsCreated: 0,
      canonicalDatabaseOpened: false,
    }),
  );
}
try {
  main();
} catch (error) {
  console.error(
    error instanceof Error && /^R2_CALIBRATION_SAFETY_[A-Z_]+$/.test(error.message)
      ? error.message
      : "R2_CALIBRATION_SAFETY_COLLECTION_FAILED",
  );
  process.exitCode = 1;
}
