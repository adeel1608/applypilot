import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  SyntheticApplicationRunner,
  packetDigest,
  type NonSubmitRunnerCheckpoint,
} from "@applypilot/application-runner";
import { extractRequirementEvidence } from "@applypilot/job-importer";
import { fixtureJob } from "../../../tests/fixture-data";
import { BetaRepository } from "./beta-repository";
import { SqliteNonSubmitRunStore } from "./non-submit-run-store";
import { loadPersistedApplicationPacket } from "./persisted-packet";
import { R2Repository } from "./r2-repository";

function migratedDatabase(): BetterSqlite3.Database {
  const sqlite = new BetterSqlite3(":memory:");
  for (const name of [
    "0000_applypilot_foundation.sql",
    "0001_real_world_job_intake.sql",
    "0002_personal_live_beta_core.sql",
  ]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  return sqlite;
}

function migratedR2Database(path = ":memory:"): BetterSqlite3.Database {
  const sqlite = new BetterSqlite3(path);
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

describe("Beta repository", () => {
  it("round-trips a current R2 packet without treating a legacy evaluation as current", () => {
    const databasePath = join(tmpdir(), `applypilot-r46-08-${randomUUID()}.sqlite`);
    const sqlite = migratedR2Database(databasePath);
    const now = "2026-09-22T00:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES ('job:r2-packet','Fictional Robotics Engineer','Fictional Robotics','Engineering',
           'Melbourne VIC','FULL_TIME','{}','NEW',?,?,?)`,
      )
      .run(now, now, now);
    sqlite
      .prepare(
        `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
         VALUES ('profile:r2-packet','profile:r2-packet:v2',?,?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
         (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
         VALUES ('profile:r2-packet:v2','profile:r2-packet',2,1,'{}',?,?)`,
      )
      .run("a".repeat(64), now);
    sqlite
      .prepare(
        `INSERT INTO job_versions
         (id,job_id,version,normalized_json,content_digest,created_at)
         VALUES ('job:r2-packet:v1','job:r2-packet',1,'{}',?,?)`,
      )
      .run("b".repeat(64), now);
    sqlite
      .prepare(
        `INSERT INTO evaluation_versions
         (id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,
          eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,
          eligibility_engine_version,fit_engine_version,weight_version,stale,evaluated_at)
         VALUES ('legacy:r2-packet','job:r2-packet','job:r2-packet:v1','profile:r2-packet:v2',
          'DEMO_PROFILE','ELIGIBLE','[]',40,'[]','{}','legacy-v1','legacy-v1','legacy-v1',1,?)`,
      )
      .run(now);
    sqlite
      .prepare(
        `INSERT INTO r2_evaluation_versions
         (id,job_id,job_version_id,profile_version_id,evidence_contract_version,normalization_version,
          coverage_version,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,
          eligibility_engine_version,fit_scorer_version,weight_version,calibration_state,
          calibration_context_version,calibration_run_id,recommended,coverage_percent,
          unresolved_unknown_count,unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at)
         VALUES ('r2:current','job:r2-packet','job:r2-packet:v1','profile:r2-packet:v2','r2-contract-v1',
          'r2-normalization-v1','r2-coverage-v1','ELIGIBLE','[]',90,'[]','r2-eligibility-v1',
          'r2-fit-v1','r2-weight-v1','UNCALIBRATED','r2-calibration-context-v1',NULL,1,100,0,0,0,0,?)`,
      )
      .run(now);
    sqlite
      .prepare(
        `INSERT INTO r2_queue_decision_versions
         (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,
          evidence_contract_version,duplicate_resolution_version,coverage_version,actor,reason_code,
          supersedes_decision_id,created_at)
         VALUES ('queue:r2-current','job:r2-packet',1,'PREPARING','CURRENT','job:r2-packet:v1',
          'profile:r2-packet:v2','r2:current','r2-contract-v1',?,'r2-coverage-v1',
          'OWNER','OWNER_PREPARING',NULL,?)`,
      )
      .run(new R2Repository(sqlite).duplicateResolutionVersion("job:r2-packet"), now);
    const repository = new BetaRepository(sqlite, () => new Date(now));
    repository.recordDocumentArtifact({
      id: "document:r2-packet",
      jobId: "job:r2-packet",
      jobVersionId: "job:r2-packet:v1",
      profileVersionId: "profile:r2-packet:v2",
      type: "CV",
      template: "fictional",
      format: "PDF",
      fileName: "fictional-r2.pdf",
      localPath: "documents/fictional-r2.pdf",
      contentDigest: "c".repeat(64),
      claimEvidence: ["fictional:evidence"],
      layoutResult: { pageCount: 1 },
    });
    repository.approveDocument({
      documentArtifactId: "document:r2-packet",
      contentDigest: "c".repeat(64),
    });
    repository.recordDocumentArtifact({
      id: "document:r2-packet:letter",
      jobId: "job:r2-packet",
      jobVersionId: "job:r2-packet:v1",
      profileVersionId: "profile:r2-packet:v2",
      type: "COVER_LETTER",
      template: "fictional-letter",
      format: "PDF",
      fileName: "fictional-r2-letter.pdf",
      localPath: "documents/fictional-r2-letter.pdf",
      contentDigest: "d".repeat(64),
      claimEvidence: ["fictional:evidence"],
      layoutResult: { pageCount: 1 },
    });
    repository.approveDocument({
      documentArtifactId: "document:r2-packet:letter",
      contentDigest: "d".repeat(64),
    });
    const packet = ApplicationPacketSchema.parse({
      id: "packet:r2-current",
      jobId: "job:r2-packet",
      jobVersionId: "job:r2-packet:v1",
      profileVersionId: "profile:r2-packet:v2",
      evaluationVersionId: "legacy:r2-packet",
      r2EvaluationId: "r2:current",
      eligibilityStatus: "ELIGIBLE",
      targetUrl: "http://127.0.0.1:4123/synthetic-application",
      targetHost: "127.0.0.1",
      jobExpiryState: "ACTIVE",
      duplicateState: "CLEAR",
      versionsCurrent: true,
      documents: [
        {
          id: "document:r2-packet",
          type: "CV",
          fileName: "fictional-r2.pdf",
          digest: "c".repeat(64),
          approved: true,
          stale: false,
          required: true,
        },
        {
          id: "document:r2-packet:letter",
          type: "COVER_LETTER",
          fileName: "fictional-r2-letter.pdf",
          digest: "d".repeat(64),
          approved: true,
          stale: false,
          required: false,
        },
      ],
      answers: [
        {
          questionId: "question-z",
          questionText: "Fictional answer Z",
          required: true,
          sensitive: false,
          value: "z",
          truthState: "VERIFIED_ANSWER",
          disclosureState: "APPROVED",
          factReferences: ["fictional:z"],
        },
        {
          questionId: "question-a",
          questionText: "Fictional answer A",
          required: false,
          sensitive: false,
          value: "a",
          truthState: "VERIFIED_ANSWER",
          disclosureState: "APPROVED",
          factReferences: ["fictional:a"],
        },
        {
          questionId: "question-m",
          questionText: "Fictional answer M",
          required: true,
          sensitive: true,
          value: "m",
          truthState: "VERIFIED_ANSWER",
          disclosureState: "APPROVED",
          factReferences: ["fictional:m"],
        },
      ],
    });
    expect(
      sqlite.prepare("SELECT id FROM r2_evaluation_versions WHERE id='r2:current'").get(),
    ).toEqual({
      id: "r2:current",
    });
    expect(repository.persistApplicationPacket(packet)).toMatchObject({
      packetId: "packet:r2-current",
      status: "READY_TO_APPLY",
    });
    expect(
      sqlite
        .prepare(
          "SELECT r2_evaluation_id AS id FROM application_packets WHERE id='packet:r2-current'",
        )
        .get(),
    ).toEqual({ id: "r2:current" });
    expect(() =>
      repository.persistApplicationPacket({
        ...packet,
        id: "packet:r2-fabricated",
        r2EvaluationId: "r2:nope",
      }),
    ).toThrow("PACKET_R2_BINDING_MISMATCH");
    sqlite.prepare("UPDATE r2_evaluation_versions SET stale=1 WHERE id='r2:current'").run();
    expect(() => repository.persistApplicationPacket({ ...packet, id: "packet:r2-stale" })).toThrow(
      "PACKET_R2_BINDING_MISMATCH",
    );
    const frozenBeforeSupersession = loadPersistedApplicationPacket({
      sqlite,
      packetId: "packet:r2-current",
    });
    repository.recordDocumentArtifact({
      id: "document:r2-packet:new",
      jobId: "job:r2-packet",
      jobVersionId: "job:r2-packet:v1",
      profileVersionId: "profile:r2-packet:v2",
      type: "CV",
      template: "fictional",
      format: "PDF",
      fileName: "fictional-r2-new.pdf",
      localPath: "documents/fictional-r2-new.pdf",
      contentDigest: "a".repeat(64),
      claimEvidence: ["fictional:evidence"],
      layoutResult: { pageCount: 1 },
    });
    const frozenAfterSupersession = loadPersistedApplicationPacket({
      sqlite,
      packetId: "packet:r2-current",
    });
    expect(frozenAfterSupersession.packet).toEqual(frozenBeforeSupersession.packet);
    expect(frozenAfterSupersession.digest).toBe(frozenBeforeSupersession.digest);
    expect(
      JSON.parse(
        sqlite
          .prepare("SELECT readiness_json FROM application_packets WHERE id='packet:r2-current'")
          .pluck()
          .get() as string,
      ).frozenPacket,
    ).toEqual(frozenBeforeSupersession.packet);
    const runId = repository.registerApplicationRun({
      packetId: "packet:r2-current",
      targetKind: "SYNTHETIC_LOCAL",
      targetHost: "127.0.0.1",
      formVersion: "fixture-form-v1",
    });
    const durable = new SqliteNonSubmitRunStore(
      sqlite,
      runId,
      packetDigest(packet),
      () => new Date(now),
    );
    const bindingDigest = "d".repeat(64);
    const checkpoint = (
      sequence: number,
      state: NonSubmitRunnerCheckpoint["state"],
      uploadEvidence: NonSubmitRunnerCheckpoint["uploadEvidence"] = null,
      previewDigest: string | null = null,
    ): NonSubmitRunnerCheckpoint => ({
      sequence,
      state,
      stopReason: null,
      occurredAt: now,
      targetUrl: packet.targetUrl!,
      formVersion: "fixture-form-v1",
      adapterVersion: "fixture-adapter-v1",
      fieldReadBack: [],
      uploadEvidence,
      previewDigest,
    });
    const mapClaim = durable.claim(bindingDigest, "MAP_FOR_FILL");
    expect(mapClaim).toMatchObject({ operation: "MAP_FOR_FILL", bindingDigest });
    expect(durable.claim(bindingDigest, "FILL")).toBeNull();
    expect(durable.claim(bindingDigest, "FILL_PREVIEW")).toBeNull();
    expect(() => durable.load("f".repeat(64))).toThrow("BINDING_DIGEST_MISMATCH");
    expect(
      () => new SqliteNonSubmitRunStore(sqlite, runId, "f".repeat(64), () => new Date(now)),
    ).toThrow("PACKET_BINDING_MISMATCH");
    const competingSqlite = new BetterSqlite3(databasePath);
    competingSqlite.pragma("foreign_keys = ON");
    expect(
      new SqliteNonSubmitRunStore(
        competingSqlite,
        runId,
        packetDigest(packet),
        () => new Date(now),
      ).claim(bindingDigest, "MAP_FOR_FILL"),
    ).toBeNull();
    competingSqlite.close();
    durable.save(
      bindingDigest,
      {
        state: "MAPPED",
        sequence: 1,
        claimedOperations: ["MAP_FOR_FILL"],
        checkpoints: [checkpoint(1, "MAPPED")],
      },
      mapClaim!,
    );
    expect(durable.load(bindingDigest)).toMatchObject({ state: "MAPPED", sequence: 1 });
    expect(durable.checkpoints()).toHaveLength(1);
    const previewBindingDigest = bindingDigest;
    const fillClaim = durable.claim(previewBindingDigest, "FILL");
    expect(fillClaim).toMatchObject({ operation: "FILL" });
    durable.save(
      previewBindingDigest,
      {
        state: "FILLED",
        sequence: 2,
        claimedOperations: ["MAP_FOR_FILL", "FILL"],
        checkpoints: [checkpoint(1, "MAPPED"), checkpoint(2, "FILLED")],
      },
      fillClaim!,
    );
    const uploadClaim = durable.claim(previewBindingDigest, "UPLOAD");
    expect(uploadClaim).toMatchObject({ operation: "UPLOAD" });
    durable.save(
      previewBindingDigest,
      {
        state: "UPLOADED",
        sequence: 3,
        claimedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD"],
        checkpoints: [
          checkpoint(1, "MAPPED"),
          checkpoint(2, "FILLED"),
          checkpoint(3, "UPLOADED", {
            documentId: "document:r2-packet",
            expectedDigest: "c".repeat(64),
            receivedDigest: "c".repeat(64),
            acknowledgementId: "ack:fixture",
          }),
        ],
      },
      uploadClaim!,
    );
    const verifyClaim = durable.claim(previewBindingDigest, "VERIFY");
    expect(verifyClaim).toMatchObject({ operation: "VERIFY" });
    durable.save(
      previewBindingDigest,
      {
        state: "VERIFIED",
        sequence: 4,
        claimedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY"],
        checkpoints: [
          checkpoint(1, "MAPPED"),
          checkpoint(2, "FILLED"),
          checkpoint(3, "UPLOADED", {
            documentId: "document:r2-packet",
            expectedDigest: "c".repeat(64),
            receivedDigest: "c".repeat(64),
            acknowledgementId: "ack:fixture",
          }),
          checkpoint(4, "VERIFIED"),
        ],
      },
      verifyClaim!,
    );
    const previewClaim = durable.claim(previewBindingDigest, "FILL_PREVIEW");
    expect(previewClaim).toMatchObject({ operation: "FILL_PREVIEW" });
    expect(() =>
      durable.save(
        previewBindingDigest,
        {
          state: "FILL_PREVIEW",
          sequence: 2,
          claimedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"],
          checkpoints: [checkpoint(2, "FILL_PREVIEW", null, "e".repeat(64))],
        },
        previewClaim!,
      ),
    ).toThrow("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
    sqlite.exec(`
      CREATE TRIGGER synthetic_preview_persistence_failure
      BEFORE INSERT ON application_run_previews
      BEGIN SELECT RAISE(ABORT, 'synthetic preview persistence interruption'); END;
    `);
    const previewSnapshot = {
      state: "FILL_PREVIEW" as const,
      sequence: 5,
      claimedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"],
      checkpoints: [
        checkpoint(1, "MAPPED"),
        checkpoint(2, "FILLED"),
        checkpoint(3, "UPLOADED", {
          documentId: "document:r2-packet",
          expectedDigest: "c".repeat(64),
          receivedDigest: "c".repeat(64),
          acknowledgementId: "ack:fixture",
        }),
        checkpoint(4, "VERIFIED"),
        checkpoint(5, "FILL_PREVIEW", null, "e".repeat(64)),
      ],
    };
    expect(() => durable.save(previewBindingDigest, previewSnapshot, previewClaim!)).toThrow(
      "synthetic preview persistence interruption",
    );
    expect(
      sqlite
        .prepare(
          `SELECT state, effect_json AS effectJson FROM application_run_operations
           WHERE run_id=? AND binding_digest=? AND operation_key='FILL_PREVIEW'`,
        )
        .get(runId, previewBindingDigest),
    ).toEqual({ state: "CLAIMED", effectJson: "{}" });
    sqlite.exec("DROP TRIGGER synthetic_preview_persistence_failure");
    durable.save(previewBindingDigest, previewSnapshot, previewClaim!);
    expect(
      sqlite
        .prepare(
          "SELECT packet_digest AS packetDigest, preview_digest AS previewDigest FROM application_run_previews WHERE run_id=?",
        )
        .get(runId),
    ).toEqual({ packetDigest: packetDigest(packet), previewDigest: "e".repeat(64) });
    const recoveryRunId = repository.registerApplicationRun({
      packetId: "packet:r2-current",
      targetKind: "SYNTHETIC_LOCAL",
      targetHost: "127.0.0.1",
      formVersion: "fixture-form-v1",
    });
    const recoveryStore = new SqliteNonSubmitRunStore(
      sqlite,
      recoveryRunId,
      packetDigest(packet),
      () => new Date(now),
    );
    const recoveryBinding = "f".repeat(64);
    const recoveryClaim = recoveryStore.claim(recoveryBinding, "MAP_FOR_FILL");
    expect(recoveryClaim).toMatchObject({ operation: "MAP_FOR_FILL" });
    recoveryStore.save(
      recoveryBinding,
      {
        state: "MAPPED",
        sequence: 1,
        claimedOperations: ["MAP_FOR_FILL"],
        checkpoints: [checkpoint(1, "MAPPED")],
      },
      recoveryClaim!,
    );
    const recoveryUploadClaim = recoveryStore.claim(recoveryBinding, "FILL");
    expect(recoveryUploadClaim).toMatchObject({ operation: "FILL" });
    recoveryStore.save(
      recoveryBinding,
      {
        state: "FILLED",
        sequence: 2,
        claimedOperations: ["MAP_FOR_FILL", "FILL"],
        checkpoints: [checkpoint(1, "MAPPED"), checkpoint(2, "FILLED")],
      },
      recoveryUploadClaim!,
    );
    const recoveryClaimUpload = recoveryStore.claim(recoveryBinding, "UPLOAD");
    expect(recoveryClaimUpload).toMatchObject({ operation: "UPLOAD" });
    sqlite.close();
    const reopenedSqlite = new BetterSqlite3(databasePath);
    reopenedSqlite.pragma("foreign_keys = ON");
    expect(
      new SqliteNonSubmitRunStore(
        reopenedSqlite,
        recoveryRunId,
        packetDigest(packet),
        () => new Date(now),
      ).load(recoveryBinding),
    ).toMatchObject({
      state: "PAUSED",
      recoveryRequired: true,
      recoveryReason: "UPLOAD_OUTCOME_UNKNOWN",
      activeOperation: "UPLOAD",
    });
    expect(
      new SqliteNonSubmitRunStore(
        reopenedSqlite,
        recoveryRunId,
        packetDigest(packet),
        () => new Date(now),
      ).claim(recoveryBinding, "VERIFY"),
    ).toBeNull();
    reopenedSqlite.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  });

  it("supersedes prior artifact approvals without overwriting either version", () => {
    const sqlite = migratedDatabase();
    const job = fixtureJob("job-retail-sales-assistant");
    const now = "2026-09-07T04:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
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
        "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:1','profile-version:1',?,?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
          (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
         VALUES ('profile-version:1','profile:1',1,1,'{}',?,?)`,
      )
      .run("c".repeat(64), now);
    sqlite
      .prepare(
        `INSERT INTO job_versions
          (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
         VALUES ('job-version:1',?,1,?, ?,NULL,?)`,
      )
      .run(job.id, JSON.stringify(job), "d".repeat(64), now);
    let sequence = 0;
    const repository = new BetaRepository(
      sqlite,
      () => new Date(now),
      () => `supersede:${++sequence}`,
    );
    const artifact = (id: string, digest: string) => ({
      id,
      jobId: job.id,
      jobVersionId: "job-version:1",
      profileVersionId: "profile-version:1",
      type: "CV" as const,
      template: "casual-general",
      format: "PDF" as const,
      fileName: `${id}.pdf`,
      localPath: `documents/${id}.pdf`,
      contentDigest: digest,
      claimEvidence: ["fictional:skill"],
      layoutResult: { pageCount: 1 },
    });
    expect(repository.recordDocumentArtifact(artifact("document:1", "a".repeat(64)))).toEqual({
      id: "document:1",
      version: 1,
    });
    repository.approveDocument({
      documentArtifactId: "document:1",
      contentDigest: "a".repeat(64),
    });
    sqlite
      .prepare(
        `INSERT INTO application_packets
          (id,job_id,job_version_id,profile_version_id,evaluation_version_id,target_url,target_host,
           status,readiness_json,version,created_at,updated_at)
         VALUES ('packet:superseded',?,'job-version:1','profile-version:1',NULL,NULL,NULL,
           'READY_TO_APPLY','{"status":"READY_TO_APPLY","blockers":[],"warnings":[]}',1,?,?)`,
      )
      .run(job.id, now, now);
    sqlite
      .prepare(
        `INSERT INTO application_packet_documents (packet_id,document_artifact_id,required)
         VALUES ('packet:superseded','document:1',1)`,
      )
      .run();
    expect(repository.recordDocumentArtifact(artifact("document:2", "b".repeat(64)))).toEqual({
      id: "document:2",
      version: 2,
    });
    expect(
      sqlite.prepare("SELECT id, version, stale FROM document_artifacts ORDER BY version").all(),
    ).toEqual([
      { id: "document:1", version: 1, stale: 1 },
      { id: "document:2", version: 2, stale: 0 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT invalidation_reason AS reason FROM document_approvals WHERE document_artifact_id = 'document:1'",
        )
        .get(),
    ).toEqual({ reason: "DOCUMENT_SUPERSEDED" });
    expect(
      sqlite
        .prepare(
          "SELECT status,readiness_json AS readinessJson FROM application_packets WHERE id = 'packet:superseded'",
        )
        .get(),
    ).toEqual({
      status: "INVALIDATED",
      readinessJson: JSON.stringify({
        status: "REVIEW_REQUIRED",
        blockers: ["DOCUMENT_SUPERSEDED"],
        warnings: [],
      }),
    });
    expect(() =>
      repository.approveDocument({
        documentArtifactId: "document:1",
        contentDigest: "a".repeat(64),
      }),
    ).toThrow("STALE_DOCUMENT_CANNOT_BE_APPROVED");
    sqlite.close();
  });

  it("persists immutable observations, job versions, evidence, evaluations, and queue state", () => {
    const sqlite = migratedDatabase();
    const job = fixtureJob("job-retail-sales-assistant");
    const now = "2026-09-07T04:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
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
        "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:1','profile-version:1',?,?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
          (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
         VALUES ('profile-version:1','profile:1',1,1,'{}',?,?)`,
      )
      .run("c".repeat(64), now);

    let sequence = 0;
    const repository = new BetaRepository(
      sqlite,
      () => new Date(now),
      () => `generated:${++sequence}`,
    );
    repository.recordSourceObservation({
      id: "observation:1",
      canonicalJobId: job.id,
      source: "USER_IMPORT",
      tenant: null,
      externalId: null,
      sourceUrl: null,
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      contentHash: "d".repeat(64),
      rawSnapshotReference: "import_batches:fixture-safe",
      observedAt: now,
      postedAt: null,
      expiresAt: null,
      parserVersion: "2.0.0",
      policyVersion: null,
      runId: null,
    });
    const requirementEvidence = extractRequirementEvidence("A driver's licence is required.", {
      sourceObservationId: "observation:1",
    });
    const version = repository.recordJobVersion({
      job,
      sourceObservationId: "observation:1",
      requirementEvidence,
    });
    const repeated = repository.recordJobVersion({
      job,
      sourceObservationId: "observation:1",
      requirementEvidence,
    });
    const evaluationId = repository.recordEvaluationVersion({
      jobId: job.id,
      jobVersionId: version.id,
      profileVersionId: "profile-version:1",
      evaluationContext: "DEMO_PROFILE",
      eligibilityStatus: "ELIGIBLE",
      eligibilityReasons: [],
      fitScore: 80,
      fitContributions: [],
      coverage: {
        known: 8,
        unknown: 1,
        ambiguous: 1,
        notApplicable: 0,
        percent: 80,
        confidence: "HIGH",
        missingDimensions: ["salary"],
      },
      eligibilityEngineVersion: "2.0.0",
      fitEngineVersion: "2.0.0",
      weightVersion: "beta-default-v1",
    });
    repository.setQueueState({
      jobId: job.id,
      state: "SHORTLISTED",
      evaluationVersionId: evaluationId,
      reasonCode: "LOCAL_USER_SHORTLISTED",
    });
    expect(
      repository.recordDocumentArtifact({
        id: "document:cv",
        jobId: job.id,
        jobVersionId: version.id,
        profileVersionId: "profile-version:1",
        type: "CV",
        template: "CLASSIC",
        format: "DOCX",
        fileName: "safe-example.docx",
        localPath: "documents/fixture/safe-example.docx",
        contentDigest: "a".repeat(64),
        claimEvidence: ["fictional:skill"],
        layoutResult: { structureValidated: true },
      }),
    ).toEqual({ id: "document:cv", version: 1 });
    const approvalId = repository.approveDocument({
      documentArtifactId: "document:cv",
      contentDigest: "a".repeat(64),
    });
    expect(
      repository.approveDocument({
        documentArtifactId: "document:cv",
        contentDigest: "a".repeat(64),
      }),
    ).toBe(approvalId);
    const packet = ApplicationPacketSchema.parse({
      id: "packet:1",
      jobId: job.id,
      jobVersionId: version.id,
      profileVersionId: "profile-version:1",
      evaluationVersionId: evaluationId,
      eligibilityStatus: "ELIGIBLE",
      targetUrl: "http://127.0.0.1:4123/synthetic-application",
      targetHost: "127.0.0.1",
      jobExpiryState: "ACTIVE",
      duplicateState: "CLEAR",
      versionsCurrent: true,
      documents: [
        {
          id: "document:cv",
          type: "CV",
          fileName: "safe-example.docx",
          digest: "a".repeat(64),
          approved: true,
          stale: false,
          required: true,
        },
      ],
      answers: [
        {
          questionId: "question:availability",
          questionText: "Are you available?",
          required: true,
          sensitive: false,
          value: true,
          truthState: "VERIFIED_ANSWER",
          disclosureState: "APPROVED",
          factReferences: ["fact:availability"],
        },
      ],
    });
    expect(repository.persistApplicationPacket(packet)).toMatchObject({
      packetId: "packet:1",
      version: 1,
      status: "READY_TO_APPLY",
    });
    expect(() =>
      repository.persistApplicationPacket({
        ...packet,
        id: "packet:r2-evaluation-cannot-cross-legacy-boundary",
        evaluationVersionId: "r2-evaluation:fictional-current",
      }),
    ).toThrow("PACKET_VERSION_STATE_MISMATCH");
    const runId = repository.registerApplicationRun({
      packetId: packet.id,
      targetKind: "SYNTHETIC_LOCAL",
      targetHost: "127.0.0.1",
      formVersion: "synthetic-form-v1",
    });
    const runner = new SyntheticApplicationRunner(packet, "synthetic-form-v1", () => new Date(now));
    repository.recordRunnerCheckpoint(runId, runner.open());
    runner.map();
    runner.fill({
      host: "127.0.0.1",
      formVersion: "synthetic-form-v1",
      documentDigests: ["a".repeat(64)],
    });
    repository.recordRunnerCheckpoint(runId, runner.readyForFinalReview());
    const consent = runner.createConsent();
    repository.persistFinalActionConsent(runId, consent);
    const discoveredEvent = repository.appendApplicationEvent({
      applicationId: null,
      packetId: packet.id,
      toStatus: "DISCOVERED",
      eventType: "APPLICATION_DISCOVERED",
      actor: "SYSTEM",
      idempotencyKey: "packet:1:discovered",
      metadata: { packetVersion: 1 },
      occurredAt: now,
    });
    const repeatedEvent = repository.appendApplicationEvent({
      applicationId: null,
      packetId: packet.id,
      toStatus: "DISCOVERED",
      eventType: "APPLICATION_DISCOVERED",
      actor: "SYSTEM",
      idempotencyKey: "packet:1:discovered",
      metadata: { packetVersion: 1 },
      occurredAt: now,
    });
    repository.appendApplicationEvent({
      applicationId: null,
      packetId: packet.id,
      toStatus: "REVIEWING",
      eventType: "APPLICATION_REVIEWING",
      actor: "LOCAL_USER",
      idempotencyKey: "packet:1:reviewing",
      metadata: { reasonCode: "LOCAL_USER_REVIEW" },
      occurredAt: "2026-09-07T04:00:01.000Z",
    });

    expect(version).toMatchObject({ version: 1, created: true });
    expect(repeated).toMatchObject({ id: version.id, version: 1, created: false });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM requirement_evidence").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite.prepare("SELECT state FROM job_queue_entries WHERE job_id = ?").get(job.id),
    ).toEqual({ state: "SHORTLISTED" });
    expect(
      sqlite.prepare("SELECT status FROM application_packets WHERE id = 'packet:1'").get(),
    ).toEqual({ status: "READY_TO_APPLY" });
    const storedConsent = sqlite
      .prepare("SELECT token_hash AS tokenHash FROM final_action_consents WHERE run_id = ?")
      .get(runId) as { tokenHash: string };
    expect(storedConsent.tokenHash).toBe(consent.tokenHash);
    expect(JSON.stringify(storedConsent)).not.toContain(consent.token);
    expect(packetDigest(packet)).toHaveLength(64);
    const capabilityId = repository.persistCapabilityConfig({
      source: "LEVER",
      tenant: "fictional",
      region: "GLOBAL",
      allowedHost: "api.lever.co",
      allowedPathPrefix: "/v0/postings/fictional",
      policyVersion: "fixture-policy-1",
      approved: true,
      expiresAt: "2026-10-01T00:00:00.000Z",
      requestBudget: 2,
      recordBudget: 20,
    });
    repository.recordDiscoveryRun({
      capabilityConfigId: capabilityId,
      status: "PARTIAL",
      cursor: { version: 1, next: "2" },
      requestCount: 1,
      recordCount: 2,
      safeErrorCode: null,
      startedAt: now,
      completedAt: "2026-09-07T04:00:02.000Z",
    });
    expect(
      sqlite.prepare("SELECT status, cursor_json AS cursorJson FROM discovery_runs").get(),
    ).toEqual({
      status: "PARTIAL",
      cursorJson: JSON.stringify({ version: 1, next: "2" }),
    });
    expect(discoveredEvent.created).toBe(true);
    expect(repeatedEvent).toMatchObject({ created: false, eventId: discoveredEvent.eventId });
    expect(sqlite.prepare("SELECT count(*) AS count FROM application_events_v2").get()).toEqual({
      count: 2,
    });
    const changedVersion = repository.recordJobVersion({
      job: { ...job, description: `${job.description} Updated.` },
      sourceObservationId: "observation:1",
      fieldEvidence: [
        {
          field: "title",
          sourceObservationId: "observation:1",
          sourcePath: "visibleText.title",
          originalText: job.title,
          normalizedValueJson: JSON.stringify(job.title),
          certainty: "HIGH",
          ruleId: "FIXTURE_SOURCE_TITLE",
          extractorVersion: "fixture-extractor-v1",
        },
        {
          field: "company",
          sourceObservationId: "observation:1",
          sourcePath: "visibleText.company",
          originalText: job.company,
          normalizedValueJson: JSON.stringify(job.company),
          certainty: "HIGH",
          ruleId: "FIXTURE_SOURCE_COMPANY",
          extractorVersion: "fixture-extractor-v1",
        },
      ],
      requirementEvidence,
    });
    expect(
      repository.invalidateStaleDependencies({
        jobId: job.id,
        currentJobVersionId: changedVersion.id,
        currentProfileVersionId: "profile-version:1",
        reasonCode: "JOB_VERSION_CHANGED",
      }),
    ).toEqual({ evaluations: 1, documents: 1, packets: 1 });
    expect(
      sqlite.prepare("SELECT stale FROM document_artifacts WHERE id = 'document:cv'").get(),
    ).toEqual({ stale: 1 });
    expect(
      sqlite.prepare("SELECT status FROM application_packets WHERE id = 'packet:1'").get(),
    ).toEqual({ status: "INVALIDATED" });
    const corrected = repository.recordOwnerCorrection({
      job: { ...job, title: "Corrected Fictional Role", dateUpdated: now },
      reasonCode: "OWNER_REVIEWED_FIELDS",
      changedFields: ["title"],
    });
    expect(corrected.created).toBe(true);
    expect(
      sqlite.prepare("SELECT actor, changed_fields_json AS fields FROM job_corrections").get(),
    ).toEqual({ actor: "OWNER", fields: JSON.stringify(["title"]) });
    expect(
      sqlite
        .prepare(
          `SELECT field_name AS field, source_observation_id AS sourceObservationId,
                  rule_id AS ruleId
           FROM job_field_evidence WHERE job_version_id = ? ORDER BY field_name`,
        )
        .all(corrected.id),
    ).toEqual([
      { field: "company", sourceObservationId: "observation:1", ruleId: "FIXTURE_SOURCE_COMPANY" },
      { field: "title", sourceObservationId: null, ruleId: "OWNER_CORRECTED" },
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT source_observation_id AS sourceObservationId, rule_id AS ruleId
           FROM requirement_evidence WHERE job_version_id = ?`,
        )
        .all(corrected.id),
    ).toEqual([{ sourceObservationId: "observation:1", ruleId: "REQ_REQUIRED_V2" }]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
