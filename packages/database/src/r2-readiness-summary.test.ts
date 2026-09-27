import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { aggregateR2BlockerReasonCounts, readR2ReadinessSummary } from "./r2-readiness-summary";

function database(): BetterSqlite3.Database {
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
    "0009_green_banner_session_grant.sql",
    "0010_verified_source_packet_binding.sql",
  ]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  return sqlite;
}

describe("safe R2 readiness summary", () => {
  it("reports blocker codes and owner-question identifiers without evidence values", () => {
    const sqlite = database();
    try {
      sqlite
        .prepare(
          `INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at)
           VALUES ('job:summary','Fictional Role','Fictional Employer','Engineering','Melbourne','FULL_TIME','{}','NEW',?,?,?)`,
        )
        .run("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
      sqlite
        .prepare(
          `INSERT INTO job_versions (id,job_id,version,normalized_json,content_digest,created_at)
           VALUES ('job-version:summary','job:summary',1,'{}',?,?)`,
        )
        .run("a".repeat(64), "2026-09-10T00:00:00.000Z");
      sqlite
        .prepare(
          `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
           VALUES ('profile:summary','profile-version:summary',?,?)`,
        )
        .run("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
      sqlite
        .prepare(
          `INSERT INTO candidate_profile_versions
           (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
           VALUES ('profile-version:summary','profile:summary',1,1,'{}',?,?)`,
        )
        .run("b".repeat(64), "2026-09-10T00:00:00.000Z");
      sqlite
        .prepare(
          `INSERT INTO r2_evaluation_versions
           (id,job_id,job_version_id,profile_version_id,evidence_contract_version,normalization_version,
            coverage_version,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,
            eligibility_engine_version,fit_scorer_version,weight_version,calibration_state,
            calibration_context_version,calibration_run_id,recommended,coverage_percent,
            unresolved_unknown_count,unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
        )
        .run(
          "evaluation:summary",
          "job:summary",
          "job-version:summary",
          "profile-version:summary",
          "r2",
          "r2",
          "r2",
          "REVIEW_REQUIRED",
          JSON.stringify([
            {
              code: "R2_MATERIAL_REQUIREMENT_UNKNOWN",
              severity: "REVIEW",
              evidenceClass: "EMPLOYER_REQUIREMENT",
              jobEvidenceReferences: ["job-evidence"],
              candidateFactReferences: [],
            },
            {
              code: "R2_CANDIDATE_WORK_RIGHTS_UNVERIFIED",
              severity: "REVIEW",
              evidenceClass: "LEGAL_LIMIT",
              jobEvidenceReferences: ["job-evidence"],
              candidateFactReferences: ["candidate-fact"],
            },
          ]),
          42,
          "[]",
          "engine",
          "scorer",
          "weights",
          "UNCALIBRATED",
          "context",
          null,
          0,
          40,
          2,
          1,
          0,
          "2026-09-10T00:00:00.000Z",
        );
      const [summary] = readR2ReadinessSummary(sqlite, "job:summary");
      expect(summary).toMatchObject({
        jobId: "job:summary",
        eligibilityStatus: "REVIEW_REQUIRED",
        fitScore: 42,
        recommended: false,
        calibrationState: "UNCALIBRATED",
        ownerQuestionIds: ["OWNER_FACT_R2_CANDIDATE_WORK_RIGHTS_UNVERIFIED"],
      });
      expect(summary?.recommendationBlockers).toEqual(
        expect.arrayContaining([
          "ELIGIBILITY_NOT_ELIGIBLE",
          "MATERIAL_UNKNOWN",
          "MATERIAL_CONDITIONAL",
          "EXTRACTION_COVERAGE_INSUFFICIENT",
          "SCORE_BELOW_THRESHOLD",
        ]),
      );
      expect(aggregateR2BlockerReasonCounts([summary!])).toMatchObject({
        R2_MATERIAL_REQUIREMENT_UNKNOWN: 1,
        R2_CANDIDATE_WORK_RIGHTS_UNVERIFIED: 1,
      });
    } finally {
      sqlite.close();
    }
  });
});
