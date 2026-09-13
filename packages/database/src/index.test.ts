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
        "sourceObservations",
        "jobVersions",
        "requirementEvidence",
        "evaluationVersions",
        "jobQueueEntries",
        "documentArtifacts",
        "applicationPackets",
        "applicationRuns",
        "finalActionConsents",
        "capabilityConfigs",
        "discoveryRuns",
        "jobFieldEvidenceV2",
        "requirementEvidenceV2",
        "evidenceDerivations",
        "jobNormalizationCoverage",
        "r2EvaluationVersions",
        "r2DuplicateCandidates",
        "r2DuplicateDecisionVersions",
        "r2QueueDecisionVersions",
        "r2CorrectionOverlayBindings",
        "r2CalibrationRuns",
        "r2CalibrationQualifications",
        "r2AuditEvents",
        "sourceCapabilityVersions",
        "sourceRunCheckpoints",
        "sourceRunPages",
        "sourceObservationPayloads",
        "runnerTargetCapabilityVersions",
        "runnerRunBindings",
        "runnerRecoveryEvents",
        "runnerInspectionBindings",
      ]),
    );
  });

  it("upgrades an existing intake database additively with observation and job history", () => {
    const foundation = readFileSync(
      new URL("../drizzle/0000_applypilot_foundation.sql", import.meta.url),
      "utf8",
    );
    const intake = readFileSync(
      new URL("../drizzle/0001_real_world_job_intake.sql", import.meta.url),
      "utf8",
    );
    const beta = readFileSync(
      new URL("../drizzle/0002_personal_live_beta_core.sql", import.meta.url),
      "utf8",
    );
    const sqlite = new BetterSqlite3(":memory:");
    sqlite.exec(foundation);
    sqlite
      .prepare(
        "INSERT INTO job_sources (id,name,capabilities_json,enabled,created_at,updated_at) VALUES ('source:fixture','FIXTURE','{}',1,'now','now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job:1','Role','Company','Category','Sydney','PART_TIME','{}','NEW','now','now','now')",
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO job_source_records
          (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,discovered_at,fetched_at)
         VALUES ('record:1','job:1','source:fixture','fixture-1','https://careers.example.test/job/1',?,?,'now','now')`,
      )
      .run(JSON.stringify({ accessMode: "FIXTURE_ONLY" }), "b".repeat(64));

    sqlite.exec(intake);
    sqlite.exec(beta);

    expect(sqlite.pragma("user_version", { simple: true })).toBe(2);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 1,
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("applies all migrations to a fresh empty database", () => {
    const sqlite = new BetterSqlite3(":memory:");
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
      "0005_r2_matching_quality_hardening.sql",
      "0006_r2_calibration_qualification.sql",
      "0007_personal_live_v1_enablement.sql",
      "0008_real_target_inspection_scope.sql",
    ]) {
      sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "source_observations",
        "job_versions",
        "evaluation_versions",
        "document_artifacts",
        "application_packets",
        "application_runs",
        "capability_configs",
        "job_field_evidence_v2",
        "requirement_evidence_v2",
        "evidence_derivations",
        "job_normalization_coverage",
        "r2_evaluation_versions",
        "r2_duplicate_candidates",
        "r2_duplicate_decision_versions",
        "r2_queue_decision_versions",
        "r2_correction_overlay_bindings",
        "r2_calibration_runs",
        "r2_calibration_qualifications",
        "r2_audit_events",
        "source_capability_versions",
        "source_run_checkpoints",
        "source_run_pages",
        "source_observation_payloads",
        "runner_target_capability_versions",
        "runner_run_bindings",
        "runner_recovery_events",
        "runner_inspection_bindings",
      ]),
    );
    expect(sqlite.pragma("user_version", { simple: true })).toBe(8);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("upgrades schema v6 to v7 additively without changing historical rows", () => {
    const sqlite = new BetterSqlite3(":memory:");
    const previousMigrations = [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
      "0005_r2_matching_quality_hardening.sql",
      "0006_r2_calibration_qualification.sql",
    ];
    for (const name of previousMigrations) {
      sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
    const timestamp = "2026-09-10T00:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO jobs
         (id,title,company,category,location,employment_type,normalized_json,
          application_status,date_discovered,created_at,updated_at)
         VALUES ('v6-job','Fictional','Fictional','Fixture','Melbourne VIC','PART_TIME',
          '{}','NEW',?,?,?)`,
      )
      .run(timestamp, timestamp, timestamp);
    const historicalCounts = Object.fromEntries(
      (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      ).map(({ name }) => [
        name,
        Number(sqlite.prepare(`SELECT count(*) FROM "${name}"`).pluck().get()),
      ]),
    );
    sqlite.exec(
      readFileSync(
        new URL("../drizzle/0007_personal_live_v1_enablement.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const [table, count] of Object.entries(historicalCounts)) {
      expect(Number(sqlite.prepare(`SELECT count(*) FROM "${table}"`).pluck().get())).toBe(count);
    }
    for (const table of [
      "source_capability_versions",
      "source_run_checkpoints",
      "source_run_pages",
      "source_observation_payloads",
      "runner_target_capability_versions",
      "runner_run_bindings",
      "runner_recovery_events",
    ]) {
      expect(sqlite.prepare(`SELECT count(*) AS count FROM "${table}"`).get()).toEqual({
        count: 0,
      });
    }
    expect(sqlite.pragma("user_version", { simple: true })).toBe(7);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("upgrades schema v7 to v8 with explicit operation scope and preserved capability history", () => {
    const sqlite = new BetterSqlite3(":memory:");
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
      "0005_r2_matching_quality_hardening.sql",
      "0006_r2_calibration_qualification.sql",
      "0007_personal_live_v1_enablement.sql",
    ]) {
      sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
    sqlite
      .prepare(
        `INSERT INTO runner_target_capability_versions
         (id,capability_id,version,predecessor_id,target_kind,alias,allowed_origin,
          allowed_path_prefix,form_version,adapter_version,approval_state,approval_reference,
          approved_at,policy_version,policy_expires_at,capability_expires_at,
          configuration_digest,revoked_at,created_at)
         VALUES ('capability-version:1','legacy-synthetic',1,NULL,'SYNTHETIC_LOCAL','Fixture',
          'http://127.0.0.1:4123','/synthetic','synthetic-form-v1','synthetic-adapter-v1',
          'DRAFT',NULL,NULL,'fixture-policy','2027-01-01T00:00:00.000Z',
          '2027-01-01T00:00:00.000Z',?,NULL,'2026-09-10T00:00:00.000Z')`,
      )
      .run("a".repeat(64));
    const before = sqlite.prepare("SELECT * FROM runner_target_capability_versions").get();
    sqlite.exec(
      readFileSync(
        new URL("../drizzle/0008_real_target_inspection_scope.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(sqlite.pragma("user_version", { simple: true })).toBe(8);
    expect(
      sqlite
        .prepare(
          "SELECT allowed_operations_json AS operations FROM runner_target_capability_versions",
        )
        .get(),
    ).toEqual({ operations: '["MAP_FOR_FILL","FILL","UPLOAD","SUBMIT"]' });
    expect(sqlite.prepare("SELECT * FROM runner_target_capability_versions").get()).toMatchObject(
      before as object,
    );
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='runner_inspection_bindings'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
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
