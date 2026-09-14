import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { firstRealTargetValidationReadiness } from "./target-readiness";

const databases: BetterSqlite3.Database[] = [];

function databaseWithEvidence(): BetterSqlite3.Database {
  const database = new BetterSqlite3(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE runner_target_capability_versions (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      predecessor_id TEXT,
      target_kind TEXT NOT NULL,
      allowed_origin TEXT NOT NULL,
      allowed_path_prefix TEXT NOT NULL,
      form_version TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      allowed_operations_json TEXT NOT NULL,
      approval_state TEXT NOT NULL,
      approved_at TEXT,
      revoked_at TEXT,
      configuration_digest TEXT NOT NULL
    );
    CREATE TABLE runner_inspection_bindings (
      id TEXT PRIMARY KEY,
      target_capability_version_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_url TEXT NOT NULL,
      target_origin TEXT NOT NULL,
      target_path TEXT NOT NULL,
      allowed_path_prefix TEXT NOT NULL,
      form_version TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      state TEXT NOT NULL,
      safe_stop_reason TEXT,
      field_count INTEGER NOT NULL,
      classification_summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO runner_target_capability_versions
       (id,capability_id,version,predecessor_id,target_kind,allowed_origin,allowed_path_prefix,
        form_version,adapter_version,allowed_operations_json,approval_state,approved_at,revoked_at,
        configuration_digest)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "capability-v1",
      "fictional-family",
      1,
      null,
      "REAL_TARGET",
      "https://jobs.example.test",
      "/fictional/job/apply",
      "fictional-form-v1",
      "fictional-adapter-v1",
      '["OPEN_AND_INSPECT_ONLY"]',
      "APPROVED",
      "2026-01-01T00:00:00.000Z",
      null,
      "a".repeat(64),
    );
  database
    .prepare(
      `INSERT INTO runner_target_capability_versions
       (id,capability_id,version,predecessor_id,target_kind,allowed_origin,allowed_path_prefix,
        form_version,adapter_version,allowed_operations_json,approval_state,approved_at,revoked_at,
        configuration_digest)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "capability-v2",
      "fictional-family",
      2,
      "capability-v1",
      "REAL_TARGET",
      "https://jobs.example.test",
      "/fictional/job/apply",
      "fictional-form-v1",
      "fictional-adapter-v1",
      '["OPEN_AND_INSPECT_ONLY"]',
      "REVOKED",
      null,
      "2026-01-01T00:05:00.000Z",
      "b".repeat(64),
    );
  database
    .prepare(
      `INSERT INTO runner_inspection_bindings
       (id,target_capability_version_id,operation,target_url,target_origin,target_path,
        allowed_path_prefix,form_version,adapter_version,state,safe_stop_reason,field_count,
        classification_summary_json,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "inspection-1",
      "capability-v1",
      "OPEN_AND_INSPECT_ONLY",
      "https://jobs.example.test/fictional/job/apply",
      "https://jobs.example.test",
      "/fictional/job/apply",
      "/fictional/job/apply",
      "fictional-form-v1",
      "fictional-adapter-v1",
      "COMPLETED",
      null,
      5,
      JSON.stringify({
        visibleSectionCount: 1,
        reviewRequiredCount: 1,
        documentRequiredCount: 1,
        unsupportedCount: 2,
      }),
      "2026-01-01T00:00:00.000Z",
    );
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("first real target validation readiness", () => {
  it("fails closed when the inspection schema or completed evidence is absent", () => {
    const database = new BetterSqlite3(":memory:");
    databases.push(database);
    expect(firstRealTargetValidationReadiness(database)).toEqual({
      state: "REQUIRED",
      completedInspectionCount: 0,
    });

    const stopped = databaseWithEvidence();
    stopped
      .prepare(
        "UPDATE runner_inspection_bindings SET state='STOPPED',safe_stop_reason='FORM_CHANGED'",
      )
      .run();
    expect(firstRealTargetValidationReadiness(stopped).state).toBe("REQUIRED");
  });

  it("proves a scope-consistent completed inspection with a revoked successor", () => {
    expect(firstRealTargetValidationReadiness(databaseWithEvidence())).toEqual({
      state: "PROVEN",
      completedInspectionCount: 1,
    });
  });

  it.each([
    [
      "malformed aggregate evidence",
      "UPDATE runner_inspection_bindings SET classification_summary_json='{}'",
    ],
    [
      "an inconsistent adapter binding",
      "UPDATE runner_inspection_bindings SET adapter_version='different-adapter'",
    ],
    [
      "authority broader than passive inspection",
      `UPDATE runner_target_capability_versions SET allowed_operations_json='["OPEN_AND_INSPECT_ONLY","FILL"]' WHERE id='capability-v1'`,
    ],
    [
      "an unbounded classification count",
      `UPDATE runner_inspection_bindings SET classification_summary_json='{"visibleSectionCount":1,"reviewRequiredCount":5,"documentRequiredCount":1,"unsupportedCount":2}'`,
    ],
    [
      "a nonterminal successor",
      "UPDATE runner_target_capability_versions SET approval_state='APPROVED' WHERE id='capability-v2'",
    ],
  ])("fails closed for %s", (_description, mutation) => {
    const database = databaseWithEvidence();
    database.exec(mutation);
    expect(firstRealTargetValidationReadiness(database)).toEqual({
      state: "REQUIRED",
      completedInspectionCount: 0,
    });
  });
});
