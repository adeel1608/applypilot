import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";

const mocks = vi.hoisted(() => ({
  sqlite: null as unknown,
  beta: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@web/lib/local-database", async (importOriginal) => {
  const database = await importOriginal<typeof import("@applypilot/database")>();
  return {
    getLocalDatabase: () =>
      mocks.sqlite ? { sqlite: mocks.sqlite as BetterSqlite3.Database } : null,
    getBetaRepository: () =>
      (mocks.beta as InstanceType<typeof database.BetaRepository> | null) ??
      (mocks.sqlite ? new database.BetaRepository(mocks.sqlite as BetterSqlite3.Database) : null),
    getR2Repository: () => ({ available: () => false }),
    getJobImportRepository: () => null,
    getSourceEnablementRepository: () => null,
    getRunnerEnablementRepository: () => null,
    hasBetaSchema: () => true,
  };
});

import { BetaRepository } from "@applypilot/database";
import { preparePrivatePacket } from "@web/lib/beta-workspace";

const migrationNames = [
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
  "0011_immutable_r2a_derivation_bindings.sql",
  "0012_source_owner_action_receipts.sql",
  "0013_exact_source_request_binding.sql",
  "0014_hosted_application_workflow.sql",
] as const;

let sqlite: BetterSqlite3.Database | undefined;

function fixtureDatabase(): BetterSqlite3.Database {
  const db = new BetterSqlite3(":memory:");
  for (const name of migrationNames) {
    db.exec(
      readFileSync(new URL(`../../../packages/database/drizzle/${name}`, import.meta.url), "utf8"),
    );
  }
  db.pragma("foreign_keys = ON");
  const now = "2026-09-30T00:00:00.000Z";
  const job = {
    ...fixtureJob("job-retail-sales-assistant"),
    id: "job-persisted-inspection-packet-gate",
  };
  const profile = { ...testProfile, profileId: "profile-persisted-inspection-packet-gate" };
  const jobVersionId = "job-version-persisted-inspection-packet-gate";
  const profileVersionId = "profile-version-persisted-inspection-packet-gate";

  db.prepare(
    `INSERT INTO jobs
       (id,title,company,category,location,employment_type,normalized_json,application_status,
        date_discovered,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
  ).run(
    job.id,
    job.title,
    job.company,
    job.category,
    job.location,
    job.employmentType,
    JSON.stringify(job),
    now,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO job_versions
       (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
     VALUES (?, ?, 1, ?, ?, NULL, ?)`,
  ).run(jobVersionId, job.id, JSON.stringify(job), "a".repeat(64), now);
  db.prepare(
    `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(profile.profileId, profileVersionId, now, now);
  db.prepare(
    `INSERT INTO candidate_profile_versions
       (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
     VALUES (?, ?, 1, 1, ?, ?, ?)`,
  ).run(profileVersionId, profile.profileId, JSON.stringify(profile), "b".repeat(64), now);
  db.prepare(
    `INSERT INTO evaluation_versions
       (id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,
        eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,
        eligibility_engine_version,fit_engine_version,weight_version,stale,evaluated_at)
     VALUES ('legacy-evaluation:inspection-packet-gate',?,?,?,'PRIVATE_LOCAL_PROFILE','ELIGIBLE',
        '[]',80,'[]',?,'1.0.0','1.0.0','fixture-weights',0,?)`,
  ).run(
    job.id,
    jobVersionId,
    profileVersionId,
    JSON.stringify({
      known: 1,
      unknown: 0,
      ambiguous: 0,
      notApplicable: 0,
      percent: 100,
      confidence: "HIGH",
      missingDimensions: [],
    }),
    now,
  );
  db.prepare(
    `INSERT INTO r2_evaluation_versions
       (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
        normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
        fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
        weight_version,calibration_state,calibration_context_version,calibration_run_id,
        recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,
        unresolved_conflict_count,stale,evaluated_at)
     VALUES ('r2-evaluation:inspection-packet-gate',?,?,?,'3.1.0','3.1.0','3.1.0:3.1.0',
        'ELIGIBLE','[]',80,'[]','1.0.0','2.2.0','r2-weights-1','UNCALIBRATED',
        'r2-calibration-context-1:unreviewed',NULL,1,100,0,0,0,0,?)`,
  ).run(job.id, jobVersionId, profileVersionId, now);
  return db;
}

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
  mocks.sqlite = null;
  mocks.beta = null;
  vi.restoreAllMocks();
});

describe("private packet preparation verification gate", () => {
  it("propagates the existing verification-required error before packet creation", async () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const repository = new BetaRepository(sqlite);
    const requiredVerification = vi
      .spyOn(repository, "requireLatestQualifiedVerification")
      .mockImplementation(() => {
        throw new Error("PREPARATION_VERIFICATION_REQUIRED");
      });
    mocks.beta = repository;

    await expect(preparePrivatePacket("job-persisted-inspection-packet-gate")).rejects.toThrow(
      "PREPARATION_VERIFICATION_REQUIRED",
    );
    expect(requiredVerification).toHaveBeenCalledWith(
      "job-persisted-inspection-packet-gate",
      "job-version-persisted-inspection-packet-gate",
    );
    expect(sqlite.prepare("SELECT count(*) AS count FROM application_packets").get()).toEqual({
      count: 0,
    });
  });
});
