import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  R2CalibrationSafetyBundleSchema,
  R2_CALIBRATION_SAFETY_GATES,
  type ValidatedR2CalibrationSafety,
} from "@applypilot/fit-scorer";
import { currentR2CalibrationEngine } from "@applypilot/database";
import { currentPrivateMatchingQualified } from "./personal-live-readiness";

const boundary = vi.hoisted(() => ({
  profileHash: vi.fn(),
  safety: vi.fn(),
  qualification: vi.fn(),
}));
vi.mock("./r2-calibration-safety", () => ({
  readCurrentR2CalibrationSafety: boundary.safety,
  readCurrentR2CalibrationProfileHash: boundary.profileHash,
}));
vi.mock("@applypilot/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@applypilot/database")>()),
  readCurrentCalibrationQualification: boundary.qualification,
}));
const databases: BetterSqlite3.Database[] = [],
  hash = "a".repeat(64),
  at = "2026-01-01T00:00:00.000Z";
/** Fictional trusted-boundary return only; actual artifact verification is tested separately. */
function fictionalSafety(): ValidatedR2CalibrationSafety {
  const head = "b".repeat(40),
    path = `data/private/runtime/r2-calibration-safety/${head}/00000000-0000-4000-8000-000000000000`,
    engine = currentR2CalibrationEngine();
  const bundle = R2CalibrationSafetyBundleSchema.parse({
    schemaVersion: 1,
    mode: "LOCAL_EXECUTED",
    head,
    tree: "c".repeat(40),
    engine,
    startedAt: at,
    completedAt: at,
    migrations: [
      { path: "packages/database/drizzle/0015_r2_calibration_intake.sql", sha256: hash },
    ],
    proofs: R2_CALIBRATION_SAFETY_GATES.map((gate) =>
      gate === "privacyAudit"
        ? {
            gate,
            kind: "PRIVACY_AUDIT",
            command: "fictional-boundary",
            exitCode: 0,
            startedAt: at,
            completedAt: at,
            logArtifact: `${path}/privacy.log`,
            logSha256: hash,
            testFiles: [{ path: "scripts/privacy-audit.ts", gitBlob: head }],
            marker: "PRIVACY_AUDIT_PASS",
          }
        : {
            gate,
            kind: "VITEST",
            command: "fictional-boundary",
            exitCode: 0,
            startedAt: at,
            completedAt: at,
            logArtifact: `${path}/tests.log`,
            logSha256: hash,
            resultArtifact: `${path}/tests.json`,
            resultSha256: hash,
            testFiles: [{ path: "fictional.test.ts", gitBlob: head }],
            requiredCases: ["fictional boundary"],
          },
    ),
  });
  return {
    bundle,
    bundleDigest: hash,
    engineDigest: hash,
    head,
    tree: bundle.tree,
    gates: {
      version: `r2-safety-v1:${hash}`,
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
function database(withIntake = true) {
  const sqlite = new BetterSqlite3(":memory:");
  databases.push(sqlite);
  sqlite.exec(
    "CREATE TABLE candidate_profiles(id,active_version_id);CREATE TABLE candidate_profile_versions(id,content_hash);CREATE TABLE r2_calibration_runs(state);INSERT INTO r2_calibration_runs VALUES ('CALIBRATED');",
  );
  if (withIntake)
    sqlite.exec(
      "CREATE TABLE r2_calibration_intake_qualifications(id);INSERT INTO r2_calibration_intake_qualifications VALUES ('fictional-intake-link');",
    );
  sqlite.prepare("INSERT INTO candidate_profiles VALUES ('profile','profile:v1')").run();
  sqlite.prepare("INSERT INTO candidate_profile_versions VALUES ('profile:v1',?)").run(hash);
  return sqlite;
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.profileHash.mockReturnValue(hash);
  boundary.safety.mockReturnValue(fictionalSafety());
  boundary.qualification.mockReturnValue({
    runId: "fictional-run",
    campaignId: "fictional-campaign",
    assessmentDigest: hash,
    engineDigest: hash,
    memberDigest: hash,
  });
});
afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});
describe("official matching qualification currentness", () => {
  it("refuses aggregate-only history and empty intake without reading private files", () => {
    const sqlite = database(false);
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(false);
    sqlite.exec("CREATE TABLE r2_calibration_intake_qualifications(id)");
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(false);
    expect(boundary.profileHash).not.toHaveBeenCalled();
    expect(boundary.safety).not.toHaveBeenCalled();
    expect(boundary.qualification).not.toHaveBeenCalled();
  });
  it("requires exactly one active profile and its actual current private-file hash", () => {
    const sqlite = database();
    boundary.profileHash.mockReturnValue("d".repeat(64));
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(false);
    boundary.profileHash.mockReturnValue(hash);
    sqlite.exec("INSERT INTO candidate_profiles VALUES ('second','profile:v1')");
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(false);
    expect(boundary.qualification).not.toHaveBeenCalled();
  });
  it.each([
    "missing-safety",
    "invalid-safety",
    "stale-qualification",
    "absent-qualification",
    "private-file-error",
  ])("fails closed for %s", (reason) => {
    const sqlite = database();
    if (reason === "missing-safety" || reason === "invalid-safety")
      boundary.safety.mockImplementation(() => {
        throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
      });
    if (reason === "private-file-error")
      boundary.profileHash.mockImplementation(() => {
        throw new Error("R2_CALIBRATION_PROFILE_BINDING_INVALID");
      });
    if (reason === "stale-qualification")
      boundary.qualification.mockImplementation(() => {
        throw new Error("R2_CALIBRATION_CURRENT_QUALIFICATION_REQUIRED");
      });
    if (reason === "absent-qualification") boundary.qualification.mockReturnValue(null);
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(false);
  });
  it("delegates only the exact active profile and validated installed engine to the durable checker", () => {
    const sqlite = database(),
      safety = boundary.safety();
    expect(currentPrivateMatchingQualified("fictional-root", sqlite)).toBe(true);
    expect(boundary.qualification).toHaveBeenCalledWith(sqlite, {
      expectedEngine: safety.bundle.engine,
      profileVersionId: "profile:v1",
      profileHash: hash,
      safetyEvidence: safety,
    });
    expect(
      sqlite.prepare("SELECT count(*) FROM r2_calibration_intake_qualifications").pluck().get(),
    ).toBe(1);
  });
});
