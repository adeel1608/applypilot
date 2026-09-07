import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import profileJson from "../../data/profile.example.json";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];
const connections: Array<{ close(): void }> = [];
let runtime: typeof import("../../apps/web/lib/local-database");
let profiles: typeof import("../../apps/web/lib/candidate-profile-provider");
const migrations = ["0000_applypilot_foundation.sql", "0001_real_world_job_intake.sql"]
  .map((file) =>
    readFileSync(new URL(`../../packages/database/drizzle/${file}`, import.meta.url), "utf8"),
  )
  .join("\n");

beforeAll(async () => {
  profiles = await import("../../apps/web/lib/candidate-profile-provider");
  runtime = await import("../../apps/web/lib/local-database");
}, 30_000);

beforeEach(async () => {
  runtime = await import("../../apps/web/lib/local-database");
});

function fictionalRepository() {
  const root = mkdtempSync(join(tmpdir(), "applypilot-runtime-path-test-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "apps", "web");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "applypilot", private: true, workspaces: ["apps/*", "packages/*"] }),
  );
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "@applypilot/web" }));
  return { root, workspace, data: join(root, "data") };
}

function migrateFictionalDatabase(directory: string, filename = "applypilot.local.sqlite") {
  mkdirSync(directory, { recursive: true });
  const sqlite = new BetterSqlite3(join(directory, filename));
  try {
    sqlite.exec(migrations);
  } finally {
    sqlite.close();
  }
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("repository-root local runtime data", () => {
  it.each(["root", "workspace"] as const)(
    "loads the root profile and migrated database from the %s launch directory",
    async (launch) => {
      const repository = fictionalRepository();
      migrateFictionalDatabase(repository.data);
      writeFileSync(join(repository.data, "profile.private.json"), JSON.stringify(profileJson));
      // A workspace-local decoy must not hide the root profile or select another database.
      const decoy = join(repository.workspace, "data");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "profile.private.json"), "{}");
      writeFileSync(join(decoy, "applypilot.local.sqlite"), "not a database");
      vi.spyOn(process, "cwd").mockReturnValue(repository[launch]);
      vi.stubEnv("APPLYPILOT_DB_FILENAME", "applypilot.local.sqlite");

      const { LocalCandidateProfileProvider } = profiles;
      const profile = await new LocalCandidateProfileProvider().resolve("REAL_IMPORTED_JOB");
      expect(profile.state).toBe("PRIVATE_LOCAL_PROFILE");
      const { getLocalDatabase } = runtime;
      const database = getLocalDatabase();
      if (database) connections.push(database);
      expect(database?.sqlite.name).toBe(join(repository.data, "applypilot.local.sqlite"));
      expect(database?.sqlite.pragma("user_version", { simple: true })).toBe(1);
    },
  );

  it("does not fall back to workspace data when root runtime files are missing", async () => {
    const repository = fictionalRepository();
    const decoy = join(repository.workspace, "data");
    migrateFictionalDatabase(decoy);
    writeFileSync(join(decoy, "profile.private.json"), JSON.stringify(profileJson));
    vi.spyOn(process, "cwd").mockReturnValue(repository.workspace);
    vi.stubEnv("APPLYPILOT_DB_FILENAME", "applypilot.local.sqlite");
    const { LocalCandidateProfileProvider } = profiles;
    const result = await new LocalCandidateProfileProvider().resolve("REAL_IMPORTED_JOB");
    expect(result.state).toBe("NO_ACTIVE_PROFILE");
    const { getLocalDatabase } = runtime;
    const database = getLocalDatabase();
    if (database) connections.push(database);
    expect(database).toBeNull();
    expect(existsSync(repository.data)).toBe(false);
  });

  it("keeps the filename override inside root data and rejects traversal", async () => {
    const repository = fictionalRepository();
    migrateFictionalDatabase(repository.data, "applypilot.e2e.sqlite");
    vi.spyOn(process, "cwd").mockReturnValue(repository.workspace);
    vi.stubEnv("APPLYPILOT_DB_FILENAME", "../outside.sqlite");
    const { getLocalDatabase } = runtime;
    expect(() => getLocalDatabase()).toThrow("INVALID_LOCAL_DATABASE_FILENAME");
    vi.stubEnv("APPLYPILOT_DB_FILENAME", "applypilot.e2e.sqlite");
    const database = getLocalDatabase();
    if (database) connections.push(database);
    expect(database?.sqlite.name).toBe(join(repository.data, "applypilot.e2e.sqlite"));
  });

  it("rejects an unrecognized repository without loading nearby profile data", async () => {
    const repository = fictionalRepository();
    writeFileSync(join(repository.root, "package.json"), JSON.stringify({ name: "unrelated" }));
    mkdirSync(repository.data);
    writeFileSync(join(repository.data, "profile.private.json"), JSON.stringify(profileJson));
    vi.spyOn(process, "cwd").mockReturnValue(repository.root);
    const { LocalCandidateProfileProvider } = profiles;
    const result = await new LocalCandidateProfileProvider().resolve("REAL_IMPORTED_JOB");
    expect(result.state).toBe("INVALID_PRIVATE_PROFILE");
    const { getLocalDatabase } = runtime;
    expect(() => getLocalDatabase()).toThrow("LOCAL_REPOSITORY_ROOT_NOT_FOUND");
  });
});
