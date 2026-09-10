import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  scoreR2JobFit,
  type R2CalibrationGateInput,
} from "@applypilot/fit-scorer";
import {
  r2FieldEvidence,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import {
  createDatabaseBackup,
  inspectDatabase,
  restoreDatabase,
} from "../../../scripts/lib/database-maintenance";
import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import { r2GoldenCorpus } from "../../../fixtures/r2/manifest";

import { BetaRepository } from "./beta-repository";
import { R2ARepository } from "./r2a-repository";
import { R2Repository, validateR2AuditMetadata } from "./r2-repository";

const databases: BetterSqlite3.Database[] = [];
const roots: string[] = [];
const now = "2026-09-09T00:00:00.000Z";

function migration(name: string): string {
  return readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
}

function seedBase(sqlite: BetterSqlite3.Database) {
  const job = { ...fixtureJob("job-retail-sales-assistant"), dateUpdated: now };
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
    )
    .run(
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
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:r2',NULL,?,?)",
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions
        (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
       VALUES ('profile-version-current','profile:r2',1,1,?,?,?)`,
    )
    .run(JSON.stringify(testProfile), "a".repeat(64), now);
  sqlite.prepare("UPDATE candidate_profiles SET active_version_id='profile-version-current'").run();
  sqlite
    .prepare(
      `INSERT INTO source_observations
        (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
         content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
         policy_version,run_id,supersedes_observation_id)
       VALUES ('observation-r2-fixture',?,NULL,'FIXTURE',NULL,'fixture-r2',NULL,'FIXTURE',?,
         'fixture:r2',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
    )
    .run(job.id, "b".repeat(64), now);
  sqlite
    .prepare(
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version-current',?,1,?,?,'observation-r2-fixture',?)`,
    )
    .run(job.id, JSON.stringify(job), "c".repeat(64), now);
  const normalization = r2TestNormalization({});
  new R2ARepository(sqlite, () => new Date(now)).recordNormalization(
    "job-version-current",
    normalization,
  );
  return { sqlite, job, normalization };
}

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
  databases.push(sqlite);
  for (const name of [
    "0000_applypilot_foundation.sql",
    "0001_real_world_job_intake.sql",
    "0002_personal_live_beta_core.sql",
    "0003_r2a_evidence_normalization.sql",
    "0004_r2_matching_quality.sql",
    "0005_r2_matching_quality_hardening.sql",
    "0006_r2_calibration_qualification.sql",
  ]) {
    sqlite.exec(migration(name));
  }
  return seedBase(sqlite);
}

function currentEvaluation(normalization: ReturnType<typeof r2TestNormalization>) {
  const eligibility = evaluateR2Eligibility({
    profile: testProfile,
    normalization,
    bindings: {
      jobVersionId: "job-version-current",
      currentJobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      currentProfileVersionId: "profile-version-current",
      evidenceContractVersion: normalization.evidenceContractVersion,
      currentEvidenceContractVersion: normalization.evidenceContractVersion,
      evaluationVersionId: "r2-evaluation-pending",
    },
    evaluatedAt: now,
  });
  return {
    eligibility,
    fit: scoreR2JobFit({
      profile: testProfile,
      normalization,
      eligibility,
      calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
    }),
  };
}

function qualifiedCalibrationGate(): R2CalibrationGateInput {
  const labels = Array.from({ length: 30 }, (_, index) => {
    const common = { id: `label-${index}`, roleFamily: `family-${index % 4}` };
    if (index % 3 === 0) {
      return {
        ...common,
        ownerLabel: "GOOD_MATCH" as const,
        eligibility: "ELIGIBLE" as const,
        ordinalBand: "STRONG_REVIEW" as const,
        recommended: true,
      };
    }
    if (index % 3 === 1) {
      return {
        ...common,
        ownerLabel: "AMBIGUOUS" as const,
        eligibility: "REVIEW_REQUIRED" as const,
        ordinalBand: "POSSIBLE_REVIEW" as const,
        recommended: false,
      };
    }
    return {
      ...common,
      ownerLabel: "POOR_MATCH" as const,
      eligibility: "INELIGIBLE" as const,
      ordinalBand: "DO_NOT_RECOMMEND" as const,
      recommended: false,
    };
  });
  const pairs = Array.from({ length: 5 }, (_, index) => ({
    id: `pair-${index}`,
    preferredScore: 90 - index,
    otherScore: 30 + index,
  }));
  return {
    sourceLabelCount: labels.length,
    sourcePairCount: pairs.length,
    labels,
    pairs,
    performanceThresholds: {
      version: "owner-thresholds-1",
      minimumLabelAgreementBasisPoints: 10_000,
      minimumPairComparisons: 5,
      minimumPairAgreementBasisPoints: 10_000,
    },
    safetyGates: {
      version: "r2-safety-gates-1",
      executableGoldenCorpus: true,
      determinism: true,
      monotonicity: true,
      ablation: true,
      bounds: true,
      recommendationInvariants: true,
      privacyAudit: true,
      migrationIntegrity: true,
    },
    ownerApproval: {
      approvalId: "owner-approval-fictional",
      approvedAt: now,
      performanceThresholdVersion: "owner-thresholds-1",
      safetyGateVersion: "r2-safety-gates-1",
      approved: true,
    },
  };
}

function recommendedNormalization() {
  return r2TestNormalization({
    fields: [
      r2FieldEvidence("work-type", "EMPLOYMENT", {
        kind: "EMPLOYMENT_TYPE",
        value: "PART_TIME",
      }),
      r2FieldEvidence("location", "GEOGRAPHY", {
        kind: "LOCATION",
        value: {
          rawLabel: "Melbourne VIC",
          locality: "Melbourne",
          suburb: "Melbourne",
          stateOrTerritory: "VIC",
          postcode: null,
          countryCode: "AU",
          workplaceType: "ON_SITE",
          remoteScope: "UNKNOWN",
        },
      }),
      r2FieldEvidence("schedule", "SCHEDULE", {
        kind: "SCHEDULE",
        value: {
          days: ["MONDAY"],
          startTime: "10:00",
          endTime: "12:00",
          rosterType: "FIXED",
          overnight: false,
          timezone: "Australia/Melbourne",
          exceptions: [],
        },
      }),
    ],
    requirements: ["Customer service", "Communication", "Teamwork"].map((value, index) =>
      r2RequirementEvidence(`skill-${index}`, "SKILLS", "SKILL", {
        kind: "TEXT",
        value,
      }),
    ),
  });
}

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("R2 persistence", () => {
  it("backs up schema v3, migrates through v4/v5 to v6, preserves history, and restores", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-r2-"));
    roots.push(root);
    const databasePath = join(root, "data", "applypilot.sqlite");
    const backupRoot = join(root, "data", "private", "backups");
    await mkdir(backupRoot, { recursive: true });
    let sqlite = new BetterSqlite3(databasePath);
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
    ]) {
      sqlite.exec(migration(name));
    }
    const seeded = seedBase(sqlite);
    const historical = {
      jobs: Number(sqlite.prepare("SELECT count(*) FROM jobs").pluck().get()),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      fields: Number(sqlite.prepare("SELECT count(*) FROM job_field_evidence_v2").pluck().get()),
      requirements: Number(
        sqlite.prepare("SELECT count(*) FROM requirement_evidence_v2").pluck().get(),
      ),
    };
    sqlite.close();

    const backup = await createDatabaseBackup({
      databasePath,
      backupRoot,
      now: new Date(now),
      randomSuffix: "b1c2d3e4",
    });
    expect(backup.schemaVersion).toBe(3);

    sqlite = new BetterSqlite3(databasePath);
    sqlite.exec(migration("0004_r2_matching_quality.sql"));
    expect(sqlite.pragma("user_version", { simple: true })).toBe(4);
    sqlite.exec(migration("0005_r2_matching_quality_hardening.sql"));
    expect(sqlite.pragma("user_version", { simple: true })).toBe(5);
    sqlite.exec(migration("0006_r2_calibration_qualification.sql"));
    expect(sqlite.pragma("user_version", { simple: true })).toBe(6);
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect({
      jobs: Number(sqlite.prepare("SELECT count(*) FROM jobs").pluck().get()),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      fields: Number(sqlite.prepare("SELECT count(*) FROM job_field_evidence_v2").pluck().get()),
      requirements: Number(
        sqlite.prepare("SELECT count(*) FROM requirement_evidence_v2").pluck().get(),
      ),
    }).toEqual(historical);
    const result = currentEvaluation(seeded.normalization);
    expect(
      new R2Repository(sqlite, () => new Date(now)).recordEvaluation({
        jobId: seeded.job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization: seeded.normalization,
        ...result,
      }).created,
    ).toBe(true);
    sqlite.close();

    const restored = await restoreDatabase({
      databasePath,
      backupRoot,
      backupId: backup.backupId,
      confirmation: `RESTORE:${backup.backupId}`,
      now: new Date("2026-09-09T00:01:00.000Z"),
    });
    expect(restored.restored.schemaVersion).toBe(3);
    expect(inspectDatabase(databasePath).tableCounts.jobs).toBe(historical.jobs);
  });

  it("backs up a v4 database, verifies v5, and restores the exact v4 snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-r2-v4-"));
    roots.push(root);
    const databasePath = join(root, "data", "applypilot.sqlite");
    const backupRoot = join(root, "data", "private", "backups");
    await mkdir(backupRoot, { recursive: true });
    let sqlite = new BetterSqlite3(databasePath);
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
    ]) {
      sqlite.exec(migration(name));
    }
    seedBase(sqlite);
    sqlite.close();
    const backup = await createDatabaseBackup({
      databasePath,
      backupRoot,
      now: new Date(now),
      randomSuffix: "b4c5d6e7",
    });
    expect(backup.schemaVersion).toBe(4);

    sqlite = new BetterSqlite3(databasePath);
    sqlite.exec(migration("0005_r2_matching_quality_hardening.sql"));
    expect(sqlite.pragma("user_version", { simple: true })).toBe(5);
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();

    const restored = await restoreDatabase({
      databasePath,
      backupRoot,
      backupId: backup.backupId,
      confirmation: `RESTORE:${backup.backupId}`,
      now: new Date("2026-09-09T00:02:00.000Z"),
    });
    expect(restored.restored.schemaVersion).toBe(4);
    expect(inspectDatabase(databasePath)).toMatchObject({
      schemaVersion: 4,
      integrity: "PASS",
      foreignKeyIssues: 0,
    });
  });

  it("backs up populated v5, adds only v6 qualification storage, and restores v5", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-r2-v5-"));
    roots.push(root);
    const databasePath = join(root, "data", "applypilot.sqlite");
    const backupRoot = join(root, "data", "private", "backups");
    await mkdir(backupRoot, { recursive: true });
    let sqlite = new BetterSqlite3(databasePath);
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
      "0005_r2_matching_quality_hardening.sql",
    ]) {
      sqlite.exec(migration(name));
    }
    seedBase(sqlite);
    sqlite
      .prepare(
        `INSERT INTO r2_calibration_runs
          (id,scorer_version,weight_version,corpus_version,fictional_case_count,
           private_reviewed_count,role_family_count,status_count,ordinal_agreement_basis_points,
           top_k,top_k_utility_basis_points,state,created_at)
         VALUES ('legacy-count-only','2.0.0','r2-weights-1','r2-golden-2',12,30,4,3,
           10000,5,10000,'CALIBRATED',?)`,
      )
      .run(now);
    sqlite.close();
    const backup = await createDatabaseBackup({
      databasePath,
      backupRoot,
      now: new Date(now),
      randomSuffix: "c5d6e7f8",
    });
    expect(backup.schemaVersion).toBe(5);

    sqlite = new BetterSqlite3(databasePath);
    sqlite.exec(migration("0006_r2_calibration_qualification.sql"));
    expect(sqlite.pragma("user_version", { simple: true })).toBe(6);
    expect(sqlite.prepare("SELECT state FROM r2_calibration_runs").pluck().get()).toBe(
      "CALIBRATED",
    );
    expect(sqlite.prepare("SELECT count(*) FROM r2_calibration_qualifications").pluck().get()).toBe(
      0,
    );
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();

    const restored = await restoreDatabase({
      databasePath,
      backupRoot,
      backupId: backup.backupId,
      confirmation: `RESTORE:${backup.backupId}`,
      now: new Date("2026-09-09T00:03:00.000Z"),
    });
    expect(restored.restored.schemaVersion).toBe(5);
    expect(inspectDatabase(databasePath)).toMatchObject({
      schemaVersion: 5,
      integrity: "PASS",
      foreignKeyIssues: 0,
    });
  });

  it("migrates an existing populated v4 evaluation to v5 without changing its history", () => {
    const sqlite = new BetterSqlite3(":memory:");
    databases.push(sqlite);
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
    ]) {
      sqlite.exec(migration(name));
    }
    const { job } = seedBase(sqlite);
    sqlite
      .prepare(
        `INSERT INTO r2_evaluation_versions
          (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
           normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
           fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
           weight_version,calibration_state,recommended,coverage_percent,unresolved_unknown_count,
           unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at)
         VALUES ('r2-evaluation-v4',?,'job-version-current','profile-version-current','3.1.0',
           '3.1.0','3.1.0:3.1.0','ELIGIBLE','[]',50,'[]','2.0.0','2.0.0',
           'r2-weights-1','UNCALIBRATED',1,100,0,0,0,0,?)`,
      )
      .run(job.id, now);
    sqlite
      .prepare(
        `INSERT INTO r2_queue_decision_versions
          (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,
           evidence_contract_version,duplicate_resolution_version,coverage_version,actor,
           reason_code,supersedes_decision_id,created_at)
         VALUES ('r2-queue-v4',?,1,'REVIEWING','CURRENT','job-version-current',
           'profile-version-current','r2-evaluation-v4','3.1.0','r2-duplicate-1:none',
           '3.1.0:3.1.0','OWNER','OWNER_REVIEWING',NULL,?)`,
      )
      .run(job.id, now);
    const before = sqlite.prepare("SELECT * FROM r2_evaluation_versions").get() as Record<
      string,
      unknown
    >;

    sqlite.exec(migration("0005_r2_matching_quality_hardening.sql"));

    const after = sqlite.prepare("SELECT * FROM r2_evaluation_versions").get() as Record<
      string,
      unknown
    >;
    expect(sqlite.pragma("user_version", { simple: true })).toBe(5);
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(after).toMatchObject(before);
    expect(after).toMatchObject({
      calibration_context_version: "legacy-v4:uncalibrated",
      calibration_run_id: null,
    });
    expect(sqlite.prepare("SELECT count(*) FROM r2_queue_decision_versions").pluck().get()).toBe(1);
  });

  it("rolls back the v5 replacement when an incompatible v4 row cannot be copied", () => {
    const sqlite = new BetterSqlite3(":memory:");
    databases.push(sqlite);
    for (const name of [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
      "0004_r2_matching_quality.sql",
    ]) {
      sqlite.exec(migration(name));
    }
    const { job } = seedBase(sqlite);
    sqlite
      .prepare(
        `INSERT INTO r2_evaluation_versions
          (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
           normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
           fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
           weight_version,calibration_state,recommended,coverage_percent,unresolved_unknown_count,
           unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at)
         VALUES ('incompatible-v4',?,'job-version-current','profile-version-current','3.1.0',
           '3.1.0','3.1.0:3.1.0','REVIEW_REQUIRED','[]',100,'[]','2.0.0','2.0.0',
           'r2-weights-1','UNCALIBRATED',1,100,0,0,0,0,?)`,
      )
      .run(job.id, now);

    expect(() => sqlite.exec(migration("0005_r2_matching_quality_hardening.sql"))).toThrow();
    expect(sqlite.inTransaction).toBe(true);
    sqlite.exec("ROLLBACK; PRAGMA foreign_keys = ON;");
    expect(sqlite.pragma("user_version", { simple: true })).toBe(4);
    expect(sqlite.prepare("SELECT id FROM r2_evaluation_versions").pluck().get()).toBe(
      "incompatible-v4",
    );
    expect(
      sqlite
        .prepare(
          "SELECT count(*) FROM pragma_table_info('r2_evaluation_versions') WHERE name = 'calibration_context_version'",
        )
        .pluck()
        .get(),
    ).toBe(0);
    expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("persists one immutable idempotent evaluation and rejects unsafe audit metadata", () => {
    const { sqlite, job, normalization } = setup();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const result = currentEvaluation(normalization);
    const first = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...result,
    });
    const second = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...result,
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT count(*) FROM r2_audit_events").pluck().get()).toBe(1);
    expect(() =>
      validateR2AuditMetadata("r2.evaluation.stale", {
        reasonCode: "JOB_CHANGED",
        privateCanary: "candidate-private-canary",
      }),
    ).toThrow();
    expect(() =>
      validateR2AuditMetadata("r2.evaluation.stale", {
        reasonCode: "JOB_CHANGED",
        nested: { token: "secret" },
      }),
    ).toThrow();
  });

  it("keys immutable evaluations by every algorithm and calibration identity input", () => {
    const { sqlite, job, normalization } = setup();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const initial = currentEvaluation(normalization);
    const record = (eligibility: typeof initial.eligibility, fit: typeof initial.fit) =>
      repository.recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility,
        fit,
      });

    const first = record(initial.eligibility, initial.fit);
    expect(record(initial.eligibility, initial.fit)).toEqual({ id: first.id, created: false });
    const eligibilityUpgrade = {
      ...initial.eligibility,
      engineVersion: "2.0.1",
    };
    expect(record(eligibilityUpgrade, initial.fit).created).toBe(true);
    const scorerUpgrade = {
      ...initial.fit,
      scorerVersion: "2.0.1",
      calibrationContextVersion: "r2-calibration-context-1:scorer-upgrade",
      contributions: initial.fit.contributions.map((item) => ({
        ...item,
        scorerVersion: "2.0.1",
      })),
    };
    expect(record(initial.eligibility, scorerUpgrade).created).toBe(true);
    const weightUpgrade = {
      ...initial.fit,
      weightVersion: "r2-weights-2",
      calibrationContextVersion: "r2-calibration-context-1:weight-upgrade",
      contributions: initial.fit.contributions.map((item) => ({
        ...item,
        weightVersion: "r2-weights-2",
      })),
    };
    expect(record(initial.eligibility, weightUpgrade).created).toBe(true);
    const calibrationUpgrade = {
      ...initial.fit,
      calibrationContextVersion: "r2-calibration-context-2:unreviewed",
    };
    expect(record(initial.eligibility, calibrationUpgrade).created).toBe(true);

    expect(sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get()).toBe(5);
    expect(
      sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions WHERE stale = 0").pluck().get(),
    ).toBe(1);
    expect(
      sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions WHERE stale = 1").pluck().get(),
    ).toBe(4);
  });

  it("rejects impossible recommendation states at both repository and SQL boundaries", () => {
    const { sqlite, job, normalization } = setup();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const result = currentEvaluation(normalization);
    expect(() =>
      repository.recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility: {
          ...result.eligibility,
          status: "REVIEW_REQUIRED",
          unresolvedMaterialUnknowns: 1,
        },
        fit: {
          ...result.fit,
          recommended: true,
          recommendationBlockers: [],
        },
      }),
    ).toThrow("R2_RECOMMENDATION_INVARIANT_VIOLATION");
    expect(() =>
      repository.recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility: { ...result.eligibility, current: false },
        fit: { ...result.fit, recommended: true, recommendationBlockers: [] },
      }),
    ).toThrow("R2_EVALUATION_BINDING_STALE");
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO r2_evaluation_versions
            (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
             normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
             fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
             weight_version,calibration_state,calibration_context_version,calibration_run_id,
             recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,
             unresolved_conflict_count,stale,evaluated_at)
           VALUES ('invalid-recommendation',?,'job-version-current','profile-version-current',
             '3.1.0','3.1.0','3.1.0:3.1.0','REVIEW_REQUIRED','[]',100,'[]','2.0.0',
             '2.0.0','r2-weights-1','UNCALIBRATED','context:invalid',NULL,1,100,0,0,0,0,?)`,
        )
        .run(job.id, now),
    ).toThrow();
  });

  it("persists a qualified calibration context only when it binds its durable run", () => {
    const { sqlite, job, normalization } = setup();
    let sequence = 0;
    const repository = new R2Repository(
      sqlite,
      () => new Date(now),
      () => `calibration-id-${++sequence}`,
    );
    const gate = qualifiedCalibrationGate();
    const runId = repository.recordCalibrationRun({
      corpusVersion: "r2-golden-2",
      scorerVersion: "2.0.0",
      weightVersion: "r2-weights-1",
      gate,
      evidenceVersion: "r2-private-calibration-evidence-1",
      privateEvidenceDigest: "d".repeat(64),
      metrics: {
        total: 12,
        ordinalAgreement: 1,
        topK: 5,
        topKReviewUtility: 1,
        boundsPass: true,
        calibrationState: "CALIBRATED",
      },
    });
    const result = currentEvaluation(normalization);
    const calibratedFit = {
      ...result.fit,
      calibrationState: "CALIBRATED" as const,
      calibrationContextVersion: `r2-calibration-context-1:${runId}`,
      calibrationRunId: runId,
    };
    expect(
      repository.recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility: result.eligibility,
        fit: calibratedFit,
      }).created,
    ).toBe(true);
    expect(
      sqlite
        .prepare("SELECT calibration_state, calibration_run_id FROM r2_evaluation_versions")
        .get(),
    ).toEqual({ calibration_state: "CALIBRATED", calibration_run_id: runId });
    expect(
      sqlite
        .prepare(
          `SELECT source_label_count, compared_label_count, source_pair_count,
                  compared_pair_count, blocker_codes_json
           FROM r2_calibration_qualifications WHERE run_id = ?`,
        )
        .get(runId),
    ).toEqual({
      source_label_count: 30,
      compared_label_count: 30,
      source_pair_count: 5,
      compared_pair_count: 5,
      blocker_codes_json: "[]",
    });
    expect(() =>
      repository.recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility: { ...result.eligibility, engineVersion: "2.0.1" },
        fit: { ...calibratedFit, calibrationRunId: "missing-run" },
      }),
    ).toThrow("R2_CALIBRATION_RUN_BINDING_MISMATCH");
  });

  it("refuses a legacy count-only calibrated run without a v6 qualification", () => {
    const { sqlite, job, normalization } = setup();
    sqlite
      .prepare(
        `INSERT INTO r2_calibration_runs
          (id,scorer_version,weight_version,corpus_version,fictional_case_count,
           private_reviewed_count,role_family_count,status_count,ordinal_agreement_basis_points,
           top_k,top_k_utility_basis_points,state,created_at)
         VALUES ('count-only-calibrated','2.0.0','r2-weights-1','r2-golden-2',12,30,4,3,
           10000,5,10000,'CALIBRATED',?)`,
      )
      .run(now);
    const result = currentEvaluation(normalization);
    expect(() =>
      new R2Repository(sqlite).recordEvaluation({
        jobId: job.id,
        jobVersionId: "job-version-current",
        profileVersionId: "profile-version-current",
        normalization,
        eligibility: result.eligibility,
        fit: {
          ...result.fit,
          calibrationState: "CALIBRATED",
          calibrationContextVersion: "legacy-count-only-context",
          calibrationRunId: "count-only-calibrated",
        },
      }),
    ).toThrow("R2_CALIBRATION_RUN_NOT_QUALIFIED");
  });

  it("keeps ambiguous duplicate observations and owner link/split decisions immutable", () => {
    const { sqlite, job } = setup();
    const secondJob = { ...job, id: "job-r2-second", title: "Retail Assistant" };
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
      )
      .run(
        secondJob.id,
        secondJob.title,
        secondJob.company,
        secondJob.category,
        secondJob.location,
        secondJob.employmentType,
        JSON.stringify(secondJob),
        now,
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO source_observations
          (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
           content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
           policy_version,run_id,supersedes_observation_id)
         VALUES ('observation-r2-second','job-r2-second',NULL,'FIXTURE',NULL,NULL,NULL,'FIXTURE',?,
           'fixture:r2:second',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
      )
      .run("d".repeat(64), now);
    const repository = new R2Repository(sqlite, () => new Date(now));
    const suggested = repository.suggestDuplicate(
      {
        observationId: "observation-r2-fixture",
        source: "FIXTURE",
        tenant: null,
        externalId: null,
        applicationUrl: "https://example.test/apply/role",
        requisitionId: null,
        company: "Example Retail",
        title: "Retail Assistant",
        location: "Sydney",
        employmentType: "PART_TIME",
        datePosted: null,
        description: "A fictional retail assistant role.",
      },
      {
        observationId: "observation-r2-second",
        source: "UNKNOWN",
        tenant: null,
        externalId: null,
        applicationUrl: "https://example.test/apply/role",
        requisitionId: null,
        company: "Example Retail",
        title: "Retail Assistant",
        location: "Sydney",
        employmentType: "PART_TIME",
        datePosted: null,
        description: "A fictional retail assistant role.",
      },
    );
    expect(suggested.state).toBe("SUGGESTED");
    const linked = repository.decideDuplicate({
      candidateId: suggested.candidateId!,
      decision: "LINKED",
      reasonCode: "OWNER_CONFIRMED_TARGET",
      evidenceVersion: "r2-duplicate-1",
    });
    const split = repository.decideDuplicate({
      candidateId: suggested.candidateId!,
      decision: "SPLIT",
      reasonCode: "OWNER_FOUND_DISTINCT_ROLE",
      evidenceVersion: "r2-duplicate-1",
    });
    expect([linked.version, split.version]).toEqual([1, 2]);
    expect(sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get()).toBe(2);
    expect(
      sqlite.prepare("SELECT count(*) FROM r2_duplicate_decision_versions").pluck().get(),
    ).toBe(2);
  });

  it("executes the golden duplicate ambiguity through production persistence", () => {
    const { sqlite, job } = setup();
    const fixture = r2GoldenCorpus.find(({ scenario }) => scenario === "DUPLICATE_AMBIGUITY")!;
    const observations = fixture.duplicateObservations!;
    const insert = sqlite.prepare(
      `INSERT INTO source_observations
        (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
         content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
         policy_version,run_id,supersedes_observation_id)
       VALUES (?,?,NULL,?,?,?,?,'FIXTURE',?,'fixture:golden-duplicate',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
    );
    for (const identity of [observations.left, observations.right]) {
      insert.run(
        identity.observationId,
        job.id,
        identity.source,
        identity.tenant,
        identity.externalId,
        identity.applicationUrl,
        createHash("sha256").update(identity.observationId).digest("hex"),
        now,
      );
    }
    const result = new R2Repository(sqlite, () => new Date(now)).suggestDuplicate(
      observations.left,
      observations.right,
    );
    expect(result.state).toBe(fixture.expectedDuplicate);
    expect(result.created).toBe(true);
    expect(
      sqlite
        .prepare("SELECT state FROM r2_duplicate_candidates WHERE id = ?")
        .pluck()
        .get(result.candidateId),
    ).toBe("SUGGESTED");
  });

  it("binds queue decisions to the current evaluation and visibly stales readiness", () => {
    const { sqlite, job, normalization } = setup();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const evaluation = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...currentEvaluation(normalization),
    });
    const queue = repository.recordQueueDecision({
      jobId: job.id,
      state: "SHORTLISTED",
      r2EvaluationId: evaluation.id,
      duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
      actor: "OWNER",
      reasonCode: "OWNER_SHORTLISTED",
    });
    expect(queue.version).toBe(1);
    expect(repository.markQueueStale(job.id, "PROFILE_CHANGED")).toBe(1);
    expect(
      sqlite
        .prepare("SELECT freshness FROM r2_queue_decision_versions WHERE id = ?")
        .pluck()
        .get(queue.id),
    ).toBe("STALE");
  });

  it("refuses PREPARING unless the current R2 evaluation is recommended", () => {
    const { job, normalization } = setup();
    const sqlite = databases.at(-1)!;
    const repository = new R2Repository(sqlite, () => new Date(now));
    const evaluation = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...currentEvaluation(normalization),
    });
    expect(() =>
      repository.recordQueueDecision({
        jobId: job.id,
        state: "PREPARING",
        r2EvaluationId: evaluation.id,
        duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
        actor: "OWNER",
        reasonCode: "OWNER_PREPARED",
      }),
    ).toThrow("R2_QUEUE_PREPARING_NOT_READY");
    expect(sqlite.prepare("SELECT count(*) FROM r2_queue_decision_versions").pluck().get()).toBe(0);
  });

  it("downgrades a stale PREPARING projection and preserves its immutable decision", () => {
    const { sqlite, job } = setup();
    const normalization = recommendedNormalization();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const evaluationResult = currentEvaluation(normalization);
    expect(evaluationResult.fit.recommended).toBe(true);
    const evaluation = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...evaluationResult,
    });
    const queue = repository.recordQueueDecision({
      jobId: job.id,
      state: "PREPARING",
      r2EvaluationId: evaluation.id,
      duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
      actor: "OWNER",
      reasonCode: "OWNER_PREPARED",
    });
    expect(repository.markQueueStale(job.id, "PROFILE_CHANGED")).toBe(1);
    expect(
      sqlite.prepare("SELECT state FROM job_queue_entries WHERE job_id = ?").pluck().get(job.id),
    ).toBe("REVIEWING");
    expect(
      sqlite
        .prepare("SELECT state FROM r2_queue_decision_versions WHERE id = ?")
        .pluck()
        .get(queue.id),
    ).toBe("PREPARING");
  });

  it("requires the exact current PREPARING decision before packet persistence", () => {
    const { sqlite, job } = setup();
    const normalization = recommendedNormalization();
    const repository = new R2Repository(sqlite, () => new Date(now));
    const result = currentEvaluation(normalization);
    expect(result.fit.recommended).toBe(true);
    const evaluation = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...result,
    });
    expect(() => repository.assertCurrentPreparing(job.id, evaluation.id)).toThrow(
      "R2_QUEUE_CURRENT_PREPARING_REQUIRED",
    );
    for (const state of ["REVIEWING", "SHORTLISTED"] as const) {
      repository.recordQueueDecision({
        jobId: job.id,
        state,
        r2EvaluationId: evaluation.id,
        duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
        actor: "OWNER",
        reasonCode: `OWNER_${state}`,
      });
      expect(() => repository.assertCurrentPreparing(job.id, evaluation.id)).toThrow(
        "R2_QUEUE_CURRENT_PREPARING_REQUIRED",
      );
    }
    repository.recordQueueDecision({
      jobId: job.id,
      state: "PREPARING",
      r2EvaluationId: evaluation.id,
      duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
      actor: "OWNER",
      reasonCode: "OWNER_PREPARED",
    });
    expect(() => repository.assertCurrentPreparing(job.id, evaluation.id)).not.toThrow();
    expect(repository.markQueueStale(job.id, "PROFILE_CHANGED")).toBe(1);
    expect(() => repository.assertCurrentPreparing(job.id, evaluation.id)).toThrow(
      "R2_QUEUE_CURRENT_PREPARING_REQUIRED",
    );
  });

  it("stales PREPARING and invalidates a packet when a duplicate decision changes", () => {
    const { sqlite, job } = setup();
    const secondJob = { ...job, id: "job-r2-duplicate-second" };
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
      )
      .run(
        secondJob.id,
        secondJob.title,
        secondJob.company,
        secondJob.category,
        secondJob.location,
        secondJob.employmentType,
        JSON.stringify(secondJob),
        now,
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO source_observations
          (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
           content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
           policy_version,run_id,supersedes_observation_id)
         VALUES ('observation-r2-decision-second',?,NULL,'UNKNOWN',NULL,NULL,NULL,'FIXTURE',?,
           'fixture:r2:decision-second',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
      )
      .run(secondJob.id, "e".repeat(64), now);
    const repository = new R2Repository(sqlite, () => new Date(now));
    const candidate = repository.suggestDuplicate(
      {
        observationId: "observation-r2-fixture",
        source: "FIXTURE",
        tenant: null,
        externalId: null,
        applicationUrl: "https://example.test/apply/role",
        requisitionId: null,
        company: job.company,
        title: job.title,
        location: job.location,
        employmentType: job.employmentType,
        datePosted: null,
        description: job.description,
      },
      {
        observationId: "observation-r2-decision-second",
        source: "UNKNOWN",
        tenant: null,
        externalId: null,
        applicationUrl: "https://example.test/apply/role",
        requisitionId: null,
        company: job.company,
        title: job.title,
        location: job.location,
        employmentType: job.employmentType,
        datePosted: null,
        description: job.description,
      },
    );
    repository.decideDuplicate({
      candidateId: candidate.candidateId!,
      decision: "REJECTED",
      reasonCode: "OWNER_CONFIRMED_DISTINCT",
      evidenceVersion: "r2-duplicate-1",
    });
    const normalization = recommendedNormalization();
    const evaluation = repository.recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...currentEvaluation(normalization),
    });
    repository.recordQueueDecision({
      jobId: job.id,
      state: "PREPARING",
      r2EvaluationId: evaluation.id,
      duplicateResolutionVersion: repository.duplicateResolutionVersion(job.id),
      actor: "OWNER",
      reasonCode: "OWNER_PREPARED",
    });
    sqlite
      .prepare(
        `INSERT INTO application_packets
          (id,job_id,job_version_id,profile_version_id,evaluation_version_id,target_url,target_host,
           status,readiness_json,version,created_at,updated_at)
         VALUES ('packet:r2:duplicate',?,'job-version-current','profile-version-current',NULL,
           NULL,NULL,'READY_TO_APPLY','{}',1,?,?)`,
      )
      .run(job.id, now, now);

    repository.decideDuplicate({
      candidateId: candidate.candidateId!,
      decision: "LINKED",
      reasonCode: "OWNER_CONFIRMED_TARGET",
      evidenceVersion: "r2-duplicate-1",
    });

    expect(
      sqlite
        .prepare("SELECT freshness FROM r2_queue_decision_versions ORDER BY version DESC LIMIT 1")
        .pluck()
        .get(),
    ).toBe("STALE");
    expect(sqlite.prepare("SELECT status FROM application_packets").pluck().get()).toBe(
      "INVALIDATED",
    );
  });

  it("invalidates current documents, approvals, and packets when an R2 evaluation changes", () => {
    const { sqlite, job, normalization } = setup();
    sqlite
      .prepare(
        `INSERT INTO document_artifacts
          (id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,
           content_digest,claim_evidence_json,layout_result_json,version,stale,created_at)
         VALUES ('document:r2',?,'job-version-current','profile-version-current','CV','fixture',
           'PDF','fixture.pdf','private/fixture.pdf',?,'[]','{}',1,0,?)`,
      )
      .run(job.id, "d".repeat(64), now);
    sqlite
      .prepare(
        `INSERT INTO document_approvals
          (id,document_artifact_id,content_digest,approved_by,approved_at)
         VALUES ('approval:r2','document:r2',?,'LOCAL_USER',?)`,
      )
      .run("d".repeat(64), now);
    sqlite
      .prepare(
        `INSERT INTO application_packets
          (id,job_id,job_version_id,profile_version_id,evaluation_version_id,target_url,target_host,
           status,readiness_json,version,created_at,updated_at)
         VALUES ('packet:r2',?,'job-version-current','profile-version-current',NULL,NULL,NULL,
           'READY_TO_APPLY','{}',1,?,?)`,
      )
      .run(job.id, now, now);
    new R2Repository(sqlite, () => new Date(now)).recordEvaluation({
      jobId: job.id,
      jobVersionId: "job-version-current",
      profileVersionId: "profile-version-current",
      normalization,
      ...currentEvaluation(normalization),
    });
    expect(sqlite.prepare("SELECT stale FROM document_artifacts").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT invalidation_reason FROM document_approvals").pluck().get()).toBe(
      "R2_EVALUATION_CHANGED",
    );
    expect(sqlite.prepare("SELECT status FROM application_packets").pluck().get()).toBe(
      "INVALIDATED",
    );
  });

  it("replays applicable corrections and requires review when new source content changed", () => {
    const { sqlite, job, normalization } = setup();
    const correctedTitle = "Owner Corrected Fictional Role";
    new BetaRepository(sqlite, () => new Date(now)).recordOwnerCorrection({
      job: { ...job, title: correctedTitle },
      reasonCode: "OWNER_REVIEWED_FIELDS",
      changedFields: ["title"],
    });
    const repository = new R2Repository(sqlite, () => new Date(now));
    const replayed = repository.replayCorrectionOverlay({
      jobId: job.id,
      sourceObservationId: "observation-r2-fixture",
      job,
      normalization,
    });
    expect(replayed.state).toBe("APPLIED");
    expect(replayed.job.title).toBe(correctedTitle);
    expect(
      replayed.normalization.fieldEvidence.find(({ canonicalField }) => canonicalField === "title"),
    ).toMatchObject({ state: "OWNER_CORRECTED" });
    expect(
      sqlite.prepare("SELECT count(*) FROM r2_correction_overlay_bindings").pluck().get(),
    ).toBe(1);

    const changedSource = repository.replayCorrectionOverlay({
      jobId: job.id,
      sourceObservationId: "observation-r2-new-source",
      job: { ...job, title: "Materially Different Source Role" },
      normalization,
    });
    expect(changedSource.state).toBe("REVIEW_REQUIRED");
  });
});
