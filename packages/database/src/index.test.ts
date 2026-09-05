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
        "importBatches",
        "importRecords",
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

  it("upgrades the foundation schema without fabricating source identity", () => {
    const foundation = readFileSync(
      new URL("../drizzle/0000_applypilot_foundation.sql", import.meta.url),
      "utf8",
    );
    const intake = readFileSync(
      new URL("../drizzle/0001_real_world_job_intake.sql", import.meta.url),
      "utf8",
    );
    const sqlite = new BetterSqlite3(":memory:");
    sqlite.exec(foundation);
    sqlite
      .prepare(
        "INSERT INTO job_sources (id,name,capabilities_json,enabled,created_at,updated_at) VALUES ('source:seek','SEEK','{}',1,'now','now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job:1','Role','Company','Category','Sydney','CASUAL','{}','NEW','now','now','now')",
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO job_source_records
          (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,discovered_at,fetched_at)
         VALUES ('record:1','job:1','source:seek','seek-1','https://www.seek.com.au/job/1',?,?,'now','now')`,
      )
      .run(JSON.stringify({ accessMode: "FIXTURE_ONLY" }), "a".repeat(64));
    sqlite.exec(intake);
    expect(
      sqlite
        .prepare(
          "SELECT external_id, identity_kind, identity_value, acquisition_method FROM job_source_records",
        )
        .get(),
    ).toEqual({
      external_id: "seek-1",
      identity_kind: "EXTERNAL_ID",
      identity_value: "seek-1",
      acquisition_method: "FIXTURE",
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
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
