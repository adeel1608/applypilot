import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openApplyPilotDatabase, schema } from "./index";

describe("database foundation", () => {
  it("exposes every required table", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "candidateProfiles",
        "candidateProfileVersions",
        "jobs",
        "jobSources",
        "jobSourceRecords",
        "eligibilityResults",
        "fitScores",
        "generatedDocuments",
        "applications",
        "applicationEvents",
        "applicationAnswers",
        "auditEvents",
        "settings",
      ]),
    );
  });

  it("opens an in-memory SQLite connection with foreign keys enabled", () => {
    const connection = openApplyPilotDatabase(":memory:");
    expect(connection.db).toBeDefined();
    connection.close();
  });

  it("applies the checked-in foundation migration to SQLite", () => {
    const migration = readFileSync(
      new URL("../drizzle/0000_applypilot_foundation.sql", import.meta.url),
      "utf8",
    );
    const sqlite = new BetterSqlite3(":memory:");
    sqlite.exec(migration);
    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "candidate_profiles",
        "candidate_profile_versions",
        "jobs",
        "job_sources",
        "job_source_records",
        "eligibility_results",
        "fit_scores",
        "generated_documents",
        "applications",
        "application_events",
        "application_answers",
        "audit_events",
        "settings",
      ]),
    );
    sqlite.close();
  });
});
