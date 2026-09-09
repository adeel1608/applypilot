import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { scoreR2JobFit } from "@applypilot/fit-scorer";
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
  return { eligibility, fit: scoreR2JobFit({ profile: testProfile, normalization, eligibility }) };
}

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("R2 persistence", () => {
  it("backs up schema v3, migrates additively to v4, preserves history, and restores", async () => {
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
      duplicateResolutionVersion: "r2-duplicate-1",
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
        duplicateResolutionVersion: "r2-duplicate-1",
        actor: "OWNER",
        reasonCode: "OWNER_PREPARED",
      }),
    ).toThrow("R2_QUEUE_PREPARING_NOT_READY");
    expect(sqlite.prepare("SELECT count(*) FROM r2_queue_decision_versions").pluck().get()).toBe(0);
  });

  it("downgrades a stale PREPARING projection and preserves its immutable decision", () => {
    const { sqlite, job } = setup();
    const normalization = r2TestNormalization({
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
      duplicateResolutionVersion: "r2-duplicate-1",
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
