import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { aggregateR2BlockerReasonCounts, readR2ReadinessSummary } from "./r2-readiness-summary";
import { currentR2EvaluationVersions } from "./r2-evaluation-currentness";

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
  it.each([
    "evidence_contract_version",
    "normalization_version",
    "coverage_version",
    "eligibility_engine_version",
    "fit_scorer_version",
    "weight_version",
    null,
  ])("requires the installed %s tuple while preserving historical flags", (driftColumn) => {
    const sqlite = database();
    try {
      const current = currentR2EvaluationVersions();
      sqlite.exec(`INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job:current','Fictional','Fictional','Retail','Melbourne','PART_TIME','{}','NEW','2026-10-18','2026-10-18','2026-10-18');
      INSERT INTO job_versions (id,job_id,version,normalized_json,content_digest,created_at) VALUES ('version:current','job:current',1,'{}','fictional','2026-10-18');
      INSERT INTO candidate_profiles(id,active_version_id,created_at,updated_at) VALUES('profile:current','profile-version:current','2026-10-18','2026-10-18');
      INSERT INTO candidate_profile_versions(id,profile_id,version,schema_version,snapshot_json,content_hash,created_at) VALUES('profile-version:current','profile:current',1,1,'{}','fictional','2026-10-18');
      INSERT INTO job_normalization_coverage(id,job_version_id,family,coverage_state,evidence_count,evidence_ids_json,unparsed_spans_json,parser_version,created_at) VALUES('coverage:current','version:current','SKILLS','COMPLETE',1,'["fictional"]','[]','fictional','2026-10-18');`);
      sqlite
        .prepare(
          `INSERT INTO r2_evaluation_versions (id,job_id,job_version_id,profile_version_id,evidence_contract_version,normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,weight_version,calibration_state,calibration_context_version,calibration_run_id,recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at)
        VALUES ('evaluation:current','job:current','version:current','profile-version:current',@evidenceContractVersion,@normalizationVersion,@coverageVersion,'ELIGIBLE','[]',80,'[]',@eligibilityEngineVersion,@scorerVersion,@weightVersion,'UNCALIBRATED','fictional',NULL,1,100,0,0,0,0,'2026-10-18')`,
        )
        .run(current);
      sqlite
        .prepare(
          `INSERT INTO r2_queue_decision_versions (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,evidence_contract_version,duplicate_resolution_version,coverage_version,actor,reason_code,created_at) VALUES ('queue:current','job:current',1,'PREPARING','CURRENT','version:current','profile-version:current','evaluation:current',?,'fictional',?,'OWNER','FICTIONAL','2026-10-18')`,
        )
        .run(current.evidenceContractVersion, current.coverageVersion);
      sqlite.prepare("UPDATE r2_evaluation_versions SET calibration_state='CALIBRATED'").run();
      if (driftColumn) {
        sqlite.prepare(`UPDATE r2_evaluation_versions SET ${driftColumn}='historical'`).run();
        if (driftColumn === "evidence_contract_version" || driftColumn === "coverage_version")
          sqlite.prepare(`UPDATE r2_queue_decision_versions SET ${driftColumn}='historical'`).run();
      }
      const before = JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all());
      const queueBefore = JSON.stringify(
        sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all(),
      );
      sqlite.pragma("query_only=ON");
      const [summary] = readR2ReadinessSummary(sqlite);
      expect(summary).toMatchObject({
        stale: Boolean(driftColumn),
        recommended: !driftColumn,
        queueState: "PREPARING",
        queueFreshness: driftColumn ? "STALE" : "CURRENT",
        calibrationState: "CALIBRATION_PENDING",
        storedCalibrationState: "CALIBRATED",
      });
      if (driftColumn)
        expect(summary?.recommendationBlockers).toContain("EVALUATION_BINDING_STALE");
      expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all())).toBe(
        before,
      );
      expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all())).toBe(
        queueBefore,
      );
    } finally {
      sqlite.close();
    }
  });
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
          `INSERT INTO job_normalization_coverage
             (id,job_version_id,family,coverage_state,evidence_count,evidence_ids_json,
              unparsed_spans_json,parser_version,created_at)
           VALUES
             ('coverage:summary:geo','job-version:summary','GEOGRAPHY','PARTIAL',1,'["geo"]','[]','3.1.0',?),
             ('coverage:summary:skills','job-version:summary','SKILLS','COMPLETE',1,'["skill"]','[]','3.1.0',?),
             ('coverage:summary:experience','job-version:summary','EXPERIENCE','UNKNOWN',0,'[]','[]','3.1.0',?)`,
        )
        .run("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z", "2026-09-10T00:00:00.000Z");
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
        storedCalibrationState: "UNCALIBRATED",
        ownerQuestionIds: ["OWNER_FACT_R2_CANDIDATE_WORK_RIGHTS_UNVERIFIED"],
        observedMaterialFamilyCount: 2,
        resolvedObservedMaterialFamilyCount: 1,
        partialMaterialFamilyCount: 1,
        unobservedMaterialFamilyCount: 8,
        partialMaterialFamilies: ["GEOGRAPHY"],
        unobservedMaterialFamilies: [
          "CERTIFICATIONS",
          "EDUCATION",
          "EXPERIENCE",
          "HOURS",
          "LICENCES",
          "SCHEDULE",
          "VEHICLE",
          "WORK_RIGHTS",
        ],
      });
      expect(summary?.recommendationBlockers).toEqual(
        expect.arrayContaining([
          "ELIGIBILITY_NOT_ELIGIBLE",
          "MATERIAL_UNKNOWN",
          "MATERIAL_SCOPE_PARTIAL",
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
