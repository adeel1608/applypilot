import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  R2_CALIBRATION_SAFETY_GATES,
  R2CalibrationSafetyBundleSchema,
  type R2CalibrationSafetyBundle,
} from "../../packages/fit-scorer/src/calibration-safety";
import {
  currentR2CalibrationSafetyEngine,
  R2_SAFETY_TEST_CASES,
  R2_SAFETY_PRIVACY_FILES,
  R2_SAFETY_TEST_COMMAND,
  R2_SAFETY_PRIVACY_COMMAND,
  validateR2CalibrationSafetyBundle,
  readCurrentR2CalibrationSafety,
} from "./r2-calibration-safety";

const roots: string[] = [];
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
function write(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
/** Isolated verifier conformance data, not execution evidence or canonical calibration. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "applypilot-calibration-safety-"));
  roots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "ApplyPilot Fictional Test");
  git(root, "config", "user.email", "fixture@example.invalid");
  write(root, ".gitignore", "data/private/\n");
  const testPaths = [
    ...new Set(Object.values(R2_SAFETY_TEST_CASES).flatMap((items) => items.map((v) => v.file))),
  ];
  const paths = [...testPaths, ...R2_SAFETY_PRIVACY_FILES];
  for (const path of paths)
    write(root, path, "// Fictional verifier fixture, never executable test proof.\n");
  const migration = "packages/database/drizzle/0015_r2_calibration_intake.sql";
  write(root, migration, "-- Fictional schema evidence fixture\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Fictional verifier contract only");
  const head = git(root, "rev-parse", "HEAD"),
    tree = git(root, "rev-parse", "HEAD^{tree}"),
    dir = `data/private/runtime/r2-calibration-safety/${head}/00000000-0000-0000-0000-000000000000`;
  const startedAt = "2026-01-01T00:00:00.000Z",
    completedAt = "2026-01-01T00:01:00.000Z";
  const report = {
    startTime: Date.parse(startedAt) + 1,
    success: true,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    testResults: testPaths.map((file) => ({
      name: join(root, file),
      status: "passed",
      assertionResults: [
        ...new Set(
          Object.values(R2_SAFETY_TEST_CASES).flatMap((items) =>
            items.filter((i) => i.file === file).map((i) => i.title),
          ),
        ),
      ].map((title) => ({ title, status: "passed" })),
    })),
  };
  write(root, `${dir}/tests.json`, JSON.stringify(report));
  write(root, `${dir}/tests.log`, "FICTIONAL_VERIFIER_CONFORMANCE_DATA\n");
  write(
    root,
    `${dir}/privacy.log`,
    "PRIVACY_AUDIT_PASS tracked_files=1 history_paths_checked=1 history_blobs_checked=1 build_test_artifacts_checked=0 private_canaries_checked=0\n",
  );
  const blobs = new Map(paths.map((path) => [path, git(root, "rev-parse", `HEAD:${path}`)]));
  const files = (names: readonly string[]) =>
    names.map((path) => ({ path, gitBlob: blobs.get(path)! }));
  const proofs = R2_CALIBRATION_SAFETY_GATES.map((gate) => {
    const base = { gate, exitCode: 0 as const, startedAt, completedAt };
    if (gate === "privacyAudit")
      return {
        ...base,
        kind: "PRIVACY_AUDIT" as const,
        gate,
        command: R2_SAFETY_PRIVACY_COMMAND,
        logArtifact: `${dir}/privacy.log`,
        logSha256: sha(readFileSync(join(root, `${dir}/privacy.log`))),
        testFiles: files(R2_SAFETY_PRIVACY_FILES),
        marker: "PRIVACY_AUDIT_PASS" as const,
      };
    const required = R2_SAFETY_TEST_CASES[gate];
    return {
      ...base,
      kind: "VITEST" as const,
      command: R2_SAFETY_TEST_COMMAND,
      logArtifact: `${dir}/tests.log`,
      logSha256: sha(readFileSync(join(root, `${dir}/tests.log`))),
      resultArtifact: `${dir}/tests.json`,
      resultSha256: sha(readFileSync(join(root, `${dir}/tests.json`))),
      testFiles: files([...new Set(required.map((v) => v.file))]),
      requiredCases: required.map((v) => v.title),
    };
  });
  const bundle = R2CalibrationSafetyBundleSchema.parse({
    schemaVersion: 1,
    mode: "LOCAL_EXECUTED",
    head,
    tree,
    engine: currentR2CalibrationSafetyEngine(),
    startedAt,
    completedAt,
    proofs,
    migrations: [{ path: migration, sha256: sha(readFileSync(join(root, migration))) }],
  });
  return {
    root,
    bundle,
    dir,
    report,
    validate: (b: R2CalibrationSafetyBundle = bundle) =>
      validateR2CalibrationSafetyBundle({
        root,
        bundle: b,
        expectedHead: head,
        expectedTree: tree,
        expectedEngine: bundle.engine,
      }),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const path = resolve(root),
      rel = relative(resolve(tmpdir()), path);
    if (
      !basename(path).startsWith("applypilot-calibration-safety-") ||
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    )
      throw new Error("FICTIONAL_SAFETY_CLEANUP_ESCAPE");
    rmSync(path, { recursive: true, force: true });
  }
});
describe("calibration safety artifact verifier (isolated fictional artifacts)", () => {
  it("checks all eight proofs and derives version-bound gates", () => {
    const f = fixture(),
      r = f.validate();
    expect(r.gates).toMatchObject({
      executableGoldenCorpus: true,
      determinism: true,
      monotonicity: true,
      ablation: true,
      bounds: true,
      recommendationInvariants: true,
      privacyAudit: true,
      migrationIntegrity: true,
    });
    expect(r.gates.version).toBe(`r2-safety-v1:${r.bundleDigest}`);
  }, 30_000);
  it.each([
    "result",
    "log",
    "migration",
    "dirty-source",
    "wrong-engine",
    "wrong-head",
    "missing-case",
    "skipped-case",
    "stale-time",
    "bad-marker",
  ])(
    "rejects %s evidence rather than trusting booleans",
    (reason) => {
      const f = fixture(),
        b = structuredClone(f.bundle);
      const test = b.proofs.find((p) => p.kind === "VITEST")!;
      if (reason === "result" && test.kind === "VITEST") write(f.root, test.resultArtifact, "{}");
      if (reason === "log") write(f.root, test.logArtifact, "changed");
      if (reason === "migration") b.migrations[0]!.sha256 = "0".repeat(64);
      if (reason === "dirty-source") write(f.root, R2_SAFETY_PRIVACY_FILES[0]!, "changed source\n");
      if (reason === "wrong-engine") b.engine.scorerVersion = "wrong";
      if (reason === "wrong-head") b.head = "0".repeat(40);
      if (["missing-case", "skipped-case", "stale-time"].includes(reason)) {
        if (reason === "missing-case") f.report.testResults[0]!.assertionResults = [];
        if (reason === "skipped-case")
          f.report.testResults[0]!.assertionResults[0]!.status = "pending";
        if (reason === "stale-time") f.report.startTime = Date.parse(b.startedAt) - 1;
        const body = JSON.stringify(f.report);
        write(f.root, `${f.dir}/tests.json`, body);
        for (const p of b.proofs) if (p.kind === "VITEST") p.resultSha256 = sha(body);
      }
      if (reason === "bad-marker") {
        const p = b.proofs.find((p) => p.kind === "PRIVACY_AUDIT")!,
          body = "PRIVACY_AUDIT_PASS_FAIL\n";
        write(f.root, p.logArtifact, body);
        p.logSha256 = sha(body);
      }
      expect(() => f.validate(b)).toThrow("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
    },
    30_000,
  );
  it("rejects a symlink artifact after hashing its target", () => {
    const f = fixture(),
      p = f.bundle.proofs[0]!;
    const path = join(f.root, p.logArtifact),
      target = join(f.root, f.dir, "target.log");
    writeFileSync(target, readFileSync(path));
    rmSync(path);
    try {
      symlinkSync(target, path);
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM")
        throw error;
      // Windows may deny file symlinks; a directory junction is equally forbidden.
      symlinkSync(dirname(target), path, "junction");
    }
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(() => f.validate()).toThrow("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
  }, 30_000);
  it("normalizes missing runtime-file errors without exposing a private path", () => {
    const f = fixture();
    expect(() => readCurrentR2CalibrationSafety(f.root)).toThrow(
      /^R2_CALIBRATION_SAFETY_EVIDENCE_INVALID$/,
    );
  });
});
