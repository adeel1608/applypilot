import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  createCalibrationEvidenceDirectory,
  installCurrentCalibrationEvidence,
  readCalibrationEvidenceFile,
  writeCalibrationEvidenceFile,
} from "./r2-calibration-evidence-files";

const hooks = vi.hoisted(() => ({ beforeRead: undefined as (() => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync: vi.fn(
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: number | null,
      ) => {
        const hook = hooks.beforeRead;
        hooks.beforeRead = undefined;
        hook?.();
        return actual.readSync(fd, buffer, offset, length, position);
      },
    ),
  };
});
const roots: string[] = [],
  head = "a".repeat(40),
  directory = `data/private/runtime/r2-calibration-safety/${head}/00000000-0000-4000-8000-000000000000`;
function root() {
  const path = mkdtempSync(join(tmpdir(), "applypilot-evidence-files-"));
  roots.push(path);
  return path;
}
afterEach(() => {
  hooks.beforeRead = undefined;
  for (const path of roots.splice(0)) {
    const actual = resolve(path),
      inside = relative(resolve(tmpdir()), actual);
    if (
      !basename(actual).startsWith("applypilot-evidence-files-") ||
      !inside ||
      inside === ".." ||
      inside.startsWith(`..${sep}`) ||
      isAbsolute(inside)
    )
      throw new Error("EVIDENCE_TEST_CLEANUP_ESCAPE");
    rmSync(actual, { recursive: true, force: true });
  }
});
describe("calibration evidence physical files", () => {
  it("writes once, reads a bounded descriptor and installs an owned current file", () => {
    const r = root();
    createCalibrationEvidenceDirectory(r, directory);
    const path = `${directory}/current.tmp`;
    writeCalibrationEvidenceFile(r, path, "fixture");
    expect(readCalibrationEvidenceFile(r, path, 7).toString()).toBe("fixture");
    expect(() => writeCalibrationEvidenceFile(r, path, "replacement")).toThrow();
    installCurrentCalibrationEvidence(r, path);
    expect(existsSync(join(r, path))).toBe(false);
    expect(readFileSync(join(r, "data/private/runtime/r2-calibration-safety.json"), "utf8")).toBe(
      "fixture",
    );
  });
  it("rejects a linked ancestor before creating any outside output", () => {
    const r = root(),
      outside = root();
    mkdirSync(join(r, "data"));
    symlinkSync(outside, join(r, "data/private"), "junction");
    expect(() => createCalibrationEvidenceDirectory(r, directory)).toThrow();
    expect(readdirSync(outside)).toEqual([]);
    writeFileSync(join(outside, "fixture.log"), "fixture");
    expect(() => readCalibrationEvidenceFile(r, "data/private/fixture.log", 100)).toThrow();
  });
  it("rejects hardlinked reads and current-file replacements", () => {
    const r = root();
    createCalibrationEvidenceDirectory(r, directory);
    const path = `${directory}/proof.log`;
    writeCalibrationEvidenceFile(r, path, "fixture");
    linkSync(join(r, path), join(r, directory, "linked.log"));
    expect(() => readCalibrationEvidenceFile(r, path, 100)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
    writeCalibrationEvidenceFile(r, `${directory}/current.tmp`, "new");
    linkSync(join(r, path), join(r, "data/private/runtime/r2-calibration-safety.json"));
    expect(() => installCurrentCalibrationEvidence(r, `${directory}/current.tmp`)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
  });
  it("rejects growth during descriptor reading without returning oversized bytes", () => {
    const r = root();
    createCalibrationEvidenceDirectory(r, directory);
    const path = `${directory}/proof.log`;
    writeCalibrationEvidenceFile(r, path, "1234");
    hooks.beforeRead = () => appendFileSync(join(r, path), "567890");
    expect(() => readCalibrationEvidenceFile(r, path, 6)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
  });
  it("rejects pathname replacement while an original descriptor is open", () => {
    const r = root();
    createCalibrationEvidenceDirectory(r, directory);
    const path = `${directory}/proof.log`;
    writeCalibrationEvidenceFile(r, path, "fixture");
    hooks.beforeRead = () => {
      renameSync(join(r, path), join(r, directory, "old.log"));
      writeFileSync(join(r, path), "fixture");
    };
    expect(() => readCalibrationEvidenceFile(r, path, 100)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
  });
  it("rejects traversal, oversized files and malformed output roots", () => {
    const r = root();
    createCalibrationEvidenceDirectory(r, directory);
    const path = `${directory}/proof.log`;
    writeCalibrationEvidenceFile(r, path, "fixture");
    expect(() => readCalibrationEvidenceFile(r, path, 3)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
    expect(() => readCalibrationEvidenceFile(r, "../outside", 100)).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
    expect(() => createCalibrationEvidenceDirectory(r, "data/private/runtime/other")).toThrow(
      "R2_CALIBRATION_SAFETY_FILES_INVALID",
    );
  });
});
