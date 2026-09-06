import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function isIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed with exit ${String(result.status)}`);
  }

  return result.status === 0;
}

describe("repository database ignore policy", () => {
  it.each([
    "data/applypilot.local.sqlite",
    "data/applypilot.local.sqlite-wal",
    "data/applypilot.local.sqlite-shm",
    "data/applypilot.local.sqlite.2026-09-06T12-00-00.000Z.backup",
  ])("ignores local SQLite artifact %s", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each([
    "packages/database/drizzle/0001_real_world_job_intake.sql",
    "packages/database/src/job-import-repository.ts",
    "docs/REAL_WORLD_JOB_INTAKE.md",
  ])("keeps reviewed repository artifact %s trackable", (path) => {
    expect(isIgnored(path)).toBe(false);
  });
});
