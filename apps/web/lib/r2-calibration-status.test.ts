import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  hash: vi.fn(),
  safety: vi.fn(),
  profile: vi.fn(),
  assert: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@applypilot/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@applypilot/database")>()),
  readR2CalibrationProfile: boundary.profile,
  assertCurrentCalibrationQualification: boundary.assert,
}));
vi.mock("../../../scripts/lib/r2-calibration-safety", () => ({
  readCurrentR2CalibrationProfileHash: boundary.hash,
  readCurrentR2CalibrationSafety: boundary.safety,
}));
import { createCurrentR2CalibrationStatusReader } from "./r2-calibration-status";
const databases: BetterSqlite3.Database[] = [];
function reader() {
  const sqlite = new BetterSqlite3(":memory:");
  databases.push(sqlite);
  return { sqlite, current: createCurrentR2CalibrationStatusReader(sqlite, "fictional-root") };
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.hash.mockReturnValue("a".repeat(64));
  boundary.profile.mockReturnValue({
    profileVersionId: "fictional-profile:v1",
    profileHash: "a".repeat(64),
  });
  // Deliberately opaque trusted-boundary mock; this is not an artifact shape or execution proof.
  boundary.safety.mockReturnValue({ bundle: { engine: { opaque: "fictional-trusted-engine" } } });
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
describe("current calibration badge bridge", () => {
  it("does not read private profile or safety when no stored calibration run is presented", () => {
    const f = reader();
    expect(f.current(null)).toBe(false);
    expect(f.current(undefined)).toBe(false);
    for (const mock of [boundary.hash, boundary.profile, boundary.safety, boundary.assert])
      expect(mock).not.toHaveBeenCalled();
  });
  it.each(["private-file", "profile", "safety"])(
    "fails closed once for unavailable %s context",
    (part) => {
      const mock = {
        "private-file": boundary.hash,
        profile: boundary.profile,
        safety: boundary.safety,
      }[part]!;
      mock.mockImplementation(() => {
        throw new Error("fictional-private-error");
      });
      const f = reader();
      expect(f.current("run-1")).toBe(false);
      expect(f.current("run-2")).toBe(false);
      expect(mock).toHaveBeenCalledTimes(1);
      expect(boundary.assert).not.toHaveBeenCalled();
    },
  );
  it("memoizes exact-run results within a view and loads profile/safety once", () => {
    const f = reader();
    boundary.assert.mockImplementation((_db, input) => {
      if (input.runId === "stale") throw new Error("R2_CALIBRATION_QUALIFICATION_STALE");
    });
    expect(f.current("valid")).toBe(true);
    expect(f.current("valid")).toBe(true);
    expect(f.current("stale")).toBe(false);
    expect(f.current("stale")).toBe(false);
    expect(f.current("another-valid")).toBe(true);
    expect(boundary.assert).toHaveBeenCalledTimes(3);
    expect(boundary.profile).toHaveBeenCalledWith(f.sqlite, "a".repeat(64));
    expect(boundary.safety).toHaveBeenCalledTimes(1);
    expect(boundary.assert).toHaveBeenCalledWith(f.sqlite, {
      runId: "valid",
      expectedEngine: boundary.safety().bundle.engine,
      profileVersionId: "fictional-profile:v1",
      profileHash: "a".repeat(64),
      safetyEvidence: boundary.safety(),
    });
  });
  it("revalidates on the next view after a stored run becomes stale", () => {
    const first = reader();
    expect(first.current("run")).toBe(true);
    boundary.assert.mockImplementation(() => {
      throw new Error("R2_CALIBRATION_QUALIFICATION_STALE");
    });
    expect(createCurrentR2CalibrationStatusReader(first.sqlite, "fictional-root")("run")).toBe(
      false,
    );
    expect(boundary.assert).toHaveBeenCalledTimes(2);
  });
});
