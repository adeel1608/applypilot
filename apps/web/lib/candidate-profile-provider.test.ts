import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import profileJson from "../../../data/profile.example.json";

vi.mock("server-only", () => ({}));

import { LocalCandidateProfileProvider } from "./candidate-profile-provider";

const temporaryDirectories: string[] = [];

function temporaryProfilePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "applypilot-profile-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "profile.private.json");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("server-only candidate profile provider", () => {
  it("distinguishes missing, invalid, and valid private profiles", async () => {
    const path = temporaryProfilePath();
    const provider = new LocalCandidateProfileProvider(path);
    await expect(provider.resolve("REAL_IMPORTED_JOB")).resolves.toEqual({
      state: "NO_ACTIVE_PROFILE",
      reasonCode: "PRIVATE_PROFILE_MISSING",
    });
    writeFileSync(path, "{invalid", "utf8");
    await expect(provider.resolve("REAL_IMPORTED_JOB")).resolves.toEqual({
      state: "INVALID_PRIVATE_PROFILE",
      reasonCode: "PRIVATE_PROFILE_INVALID",
    });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, profileId: "incomplete" }), "utf8");
    await expect(provider.resolve("REAL_IMPORTED_JOB")).resolves.toEqual({
      state: "INVALID_PRIVATE_PROFILE",
      reasonCode: "PRIVATE_PROFILE_INVALID",
    });
    writeFileSync(path, JSON.stringify(profileJson), "utf8");
    const result = await provider.resolve("REAL_IMPORTED_JOB");
    expect(result.state).toBe("PRIVATE_LOCAL_PROFILE");
  });

  it("returns demo data only for the explicitly labelled fixture context", async () => {
    const provider = new LocalCandidateProfileProvider(temporaryProfilePath());
    const result = await provider.resolve("DEMO_FIXTURE_JOB");
    expect(result.state).toBe("DEMO_PROFILE");
  });
});
