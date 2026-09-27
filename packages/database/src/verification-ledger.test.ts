import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { BetaRepository } from "./beta-repository";

function migratedDatabase(): BetterSqlite3.Database {
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

function seedQualifiedVerification(sqlite: BetterSqlite3.Database): void {
  const now = "2026-09-22T00:00:00.000Z";
  const digest = "a".repeat(64);
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES ('job:verification','Fictional Role','Fictional Employer','Engineering','Melbourne VIC',
         'FULL_TIME','{}','NEW',?,?,?)`,
    )
    .run(now, now, now);
  sqlite
    .prepare(
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version:verification','job:verification',1,'{}',?,NULL,?)`,
    )
    .run(digest, now);
  sqlite
    .prepare(
      `INSERT INTO source_observations
        (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
         content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
         policy_version,run_id)
       VALUES ('observation:verification','job:verification',NULL,'LEVER','fictional','external-1',
         'https://api.lever.co/v0/postings/fictional/external-1','FIXTURE',?,?,?,?,?,?,?,?)`,
    )
    .run(
      digest,
      "fixture://observation:verification",
      now,
      null,
      null,
      "lever-v2",
      "fixture-policy",
      "run:verification",
    );
  sqlite
    .prepare(
      "UPDATE job_versions SET source_observation_id='observation:verification' WHERE id='job-version:verification'",
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO source_capability_versions
        (id,capability_id,version,predecessor_id,source,alias,tenant,region,allowed_host,
         allowed_path_prefix,allowed_operations_json,approval_state,approval_reference,approved_at,
         policy_version,policy_reviewed_at,policy_expires_at,capability_expires_at,request_budget,
         record_cap,page_size_cap,response_byte_limit,request_timeout_ms,run_timeout_ms,max_redirects,
         max_retries,max_concurrency,parser_version,configuration_digest,created_at)
       VALUES ('capability:verification','capability:verification',1,NULL,'LEVER','Fixture','fictional',
         'GLOBAL','api.lever.co','/v0/postings/fictional','["LIST_JOBS"]','APPROVED','fixture-approval',
         ?, 'fixture-policy','2026-09-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',
         '2026-10-01T00:00:00.000Z',1,1,1,2000000,30000,60000,0,0,1,'lever-v2',?,?)`,
    )
    .run(now, digest, now);
  sqlite
    .prepare(
      `INSERT INTO source_run_checkpoints
        (id,capability_version_id,capability_digest,operation,status,current_cursor,next_cursor,
         seen_page_digests_json,request_count,page_count,record_count,byte_count,retry_count,
         redirect_count,owner_started_at,completed_at,created_at,updated_at)
       VALUES ('run:verification','capability:verification',?,'LIST_JOBS','COMPLETE',NULL,NULL,'[]',
         1,1,1,100,0,0,?,?,?,?)`,
    )
    .run(digest, now, now, now, now);
  sqlite
    .prepare(
      `INSERT INTO source_run_pages
        (id,run_id,page_number,cursor,next_cursor,page_digest,request_count,record_count,byte_count,created_at)
       VALUES ('page:verification','run:verification',1,'skip=0',NULL,?,1,1,100,?)`,
    )
    .run(digest, now);
  sqlite
    .prepare(
      `INSERT INTO source_record_verifications
        (id,run_id,capability_version_id,page_id,source,tenant,external_id,record_index,
         page_digest,content_hash,source_observation_id,job_version_id,disposition,
         qualification_state,parser_version,policy_version,verified_at,created_at)
       VALUES ('verification:qualified','run:verification','capability:verification','page:verification',
         'LEVER','fictional','external-1',0,?,?,?,?, 'ACCEPTED','QUALIFIED','lever-v2',?, ?, ?)`,
    )
    .run(
      digest,
      digest,
      "observation:verification",
      "job-version:verification",
      "fixture-policy",
      now,
      now,
    );
}

function seedFreshVerificationReusingHistoricalObservation(sqlite: BetterSqlite3.Database): void {
  seedQualifiedVerification(sqlite);
  const historicalAt = "2026-09-22T00:00:00.000Z";
  const currentAt = "2026-09-22T00:00:01.000Z";
  const currentDigest = "b".repeat(64);
  sqlite
    .prepare(
      `UPDATE source_capability_versions
       SET parser_version='lever-v2:old-main', policy_version='old-source-policy'
       WHERE id='capability:verification'`,
    )
    .run();
  sqlite
    .prepare(
      `UPDATE source_observations
       SET parser_version='lever-v2:old-main', policy_version='old-source-policy'
       WHERE id='observation:verification'`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO source_capability_versions
        (id,capability_id,version,predecessor_id,source,alias,tenant,region,allowed_host,
         allowed_path_prefix,allowed_operations_json,approval_state,approval_reference,approved_at,
         policy_version,policy_reviewed_at,policy_expires_at,capability_expires_at,request_budget,
         record_cap,page_size_cap,response_byte_limit,request_timeout_ms,run_timeout_ms,max_redirects,
         max_retries,max_concurrency,parser_version,configuration_digest,created_at)
       VALUES ('capability:verification:new','capability:verification',2,'capability:verification',
         'LEVER','Fixture','fictional','GLOBAL','api.lever.co','/v0/postings/fictional',
         '["LIST_JOBS"]','APPROVED','fixture-approval-new',?, 'new-source-policy',
         '2026-09-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',
         1,1,1,2000000,30000,60000,0,0,1,'lever-v2:new-main',?,?)`,
    )
    .run(currentAt, currentDigest, currentAt);
  sqlite
    .prepare(
      `INSERT INTO source_run_checkpoints
        (id,capability_version_id,capability_digest,operation,status,current_cursor,next_cursor,
         seen_page_digests_json,request_count,page_count,record_count,byte_count,retry_count,
         redirect_count,owner_started_at,completed_at,created_at,updated_at)
       VALUES ('run:verification:new','capability:verification:new',?,'LIST_JOBS','COMPLETE',
         NULL,NULL,'[]',1,1,1,100,0,0,?,?,?,?)`,
    )
    .run(currentDigest, currentAt, currentAt, currentAt, currentAt);
  sqlite
    .prepare(
      `INSERT INTO source_run_pages
        (id,run_id,page_number,cursor,next_cursor,page_digest,request_count,record_count,byte_count,created_at)
       VALUES ('page:verification:new','run:verification:new',1,'skip=0',NULL,?,1,1,100,?)`,
    )
    .run(currentDigest, currentAt);
  sqlite
    .prepare(
      `INSERT INTO source_record_verifications
        (id,run_id,capability_version_id,page_id,source,tenant,external_id,record_index,
         page_digest,content_hash,source_observation_id,job_version_id,disposition,
         qualification_state,parser_version,policy_version,verified_at,created_at)
       VALUES ('verification:fresh','run:verification:new','capability:verification:new',
         'page:verification:new','LEVER','fictional','external-1',0,?,?,?,?,
         'ACCEPTED','QUALIFIED','lever-v2:new-main','new-source-policy',?,?)`,
    )
    .run(
      currentDigest,
      "a".repeat(64),
      "observation:verification",
      "job-version:verification",
      currentAt,
      currentAt,
    );
  // Keep the historical run timestamp explicit so the test proves the reader
  // chooses the fresh verification while validating the older chain internally.
  sqlite
    .prepare("UPDATE source_run_checkpoints SET owner_started_at=? WHERE id='run:verification'")
    .run(historicalAt);
}

describe("qualified verification lookup", () => {
  it("returns only exact complete qualified lineage and preserves unknown provider expiry", () => {
    const sqlite = migratedDatabase();
    try {
      seedQualifiedVerification(sqlite);
      const repository = new BetaRepository(sqlite);
      expect(
        repository.getLatestQualifiedVerification("job:verification", "job-version:verification"),
      ).toMatchObject({
        verificationId: "verification:qualified",
        jobId: "job:verification",
        jobVersionId: "job-version:verification",
        sourceObservationId: "observation:verification",
        runId: "run:verification",
        pageId: "page:verification",
        contentHash: "a".repeat(64),
        providerExpiresAt: null,
        sourcePolicyVersion: "fixture-policy",
      });
      expect(
        repository.getLatestQualifiedVerification("job:verification", "job-version:other"),
      ).toBeNull();

      sqlite.prepare("UPDATE source_run_checkpoints SET status='PARTIAL'").run();
      expect(
        repository.getLatestQualifiedVerification("job:verification", "job-version:verification"),
      ).toBeNull();
      sqlite.prepare("UPDATE source_run_checkpoints SET status='COMPLETE'").run();

      sqlite
        .prepare("UPDATE source_record_verifications SET qualification_state='PAGE_PERSISTED'")
        .run();
      expect(
        repository.getLatestQualifiedVerification("job:verification", "job-version:verification"),
      ).toBeNull();
      sqlite
        .prepare("UPDATE source_record_verifications SET qualification_state='QUALIFIED'")
        .run();

      sqlite.prepare("UPDATE source_run_pages SET page_digest=?").run("b".repeat(64));
      expect(
        repository.getLatestQualifiedVerification("job:verification", "job-version:verification"),
      ).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("accepts unchanged observation reuse across independent historical and current provenance", () => {
    const sqlite = migratedDatabase();
    try {
      seedFreshVerificationReusingHistoricalObservation(sqlite);
      expect(
        new BetaRepository(sqlite).getLatestQualifiedVerification(
          "job:verification",
          "job-version:verification",
        ),
      ).toMatchObject({
        verificationId: "verification:fresh",
        parserVersion: "lever-v2:new-main",
        sourcePolicyVersion: "new-source-policy",
        sourceObservationId: "observation:verification",
      });

      sqlite.prepare("UPDATE source_observations SET parser_version='historical-corrupt'").run();
      expect(
        new BetaRepository(sqlite).getLatestQualifiedVerification(
          "job:verification",
          "job-version:verification",
        ),
      ).toBeNull();

      sqlite.prepare("UPDATE source_observations SET parser_version='lever-v2:old-main'").run();
      sqlite
        .prepare("UPDATE source_run_checkpoints SET status='PARTIAL' WHERE id='run:verification'")
        .run();
      expect(
        new BetaRepository(sqlite).getLatestQualifiedVerification(
          "job:verification",
          "job-version:verification",
        ),
      ).toBeNull();

      sqlite
        .prepare("UPDATE source_run_checkpoints SET status='COMPLETE' WHERE id='run:verification'")
        .run();
      sqlite
        .prepare(
          "UPDATE source_run_checkpoints SET capability_digest=? WHERE id='run:verification'",
        )
        .run("c".repeat(64));
      expect(
        new BetaRepository(sqlite).getLatestQualifiedVerification(
          "job:verification",
          "job-version:verification",
        ),
      ).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("fails closed when capability, source, tenant, external, parser, or policy lineage drifts", () => {
    const cases: Array<{
      name: string;
      corrupt: (sqlite: BetterSqlite3.Database) => void;
      restore: (sqlite: BetterSqlite3.Database) => void;
    }> = [
      {
        name: "capability identity",
        corrupt: (db) =>
          db.prepare("UPDATE source_capability_versions SET source='GREENHOUSE'").run(),
        restore: (db) => db.prepare("UPDATE source_capability_versions SET source='LEVER'").run(),
      },
      {
        name: "run capability identity",
        corrupt: (db) =>
          db.prepare("UPDATE source_run_checkpoints SET capability_digest=?").run("b".repeat(64)),
        restore: (db) =>
          db.prepare("UPDATE source_run_checkpoints SET capability_digest=?").run("a".repeat(64)),
      },
      {
        name: "source and tenant",
        corrupt: (db) =>
          db
            .prepare("UPDATE source_record_verifications SET source='GREENHOUSE', tenant='other'")
            .run(),
        restore: (db) =>
          db
            .prepare("UPDATE source_record_verifications SET source='LEVER', tenant='fictional'")
            .run(),
      },
      {
        name: "external identity",
        corrupt: (db) =>
          db.prepare("UPDATE source_record_verifications SET external_id='other'").run(),
        restore: (db) =>
          db.prepare("UPDATE source_record_verifications SET external_id='external-1'").run(),
      },
      {
        name: "parser and policy",
        corrupt: (db) =>
          db
            .prepare(
              "UPDATE source_record_verifications SET parser_version='other', policy_version='other'",
            )
            .run(),
        restore: (db) =>
          db
            .prepare(
              "UPDATE source_record_verifications SET parser_version='lever-v2', policy_version='fixture-policy'",
            )
            .run(),
      },
      {
        name: "observation provenance",
        corrupt: (db) =>
          db
            .prepare(
              "UPDATE source_observations SET source='GREENHOUSE', tenant='other', external_id='other', parser_version='other', policy_version='other'",
            )
            .run(),
        restore: (db) =>
          db
            .prepare(
              "UPDATE source_observations SET source='LEVER', tenant='fictional', external_id='external-1', parser_version='lever-v2', policy_version='fixture-policy'",
            )
            .run(),
      },
    ];
    for (const testCase of cases) {
      const sqlite = migratedDatabase();
      try {
        seedQualifiedVerification(sqlite);
        testCase.corrupt(sqlite);
        expect(
          new BetaRepository(sqlite).getLatestQualifiedVerification(
            "job:verification",
            "job-version:verification",
          ),
          testCase.name,
        ).toBeNull();
      } finally {
        sqlite.close();
      }
    }
  });
});
