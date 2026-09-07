import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  SyntheticApplicationRunner,
  packetDigest,
} from "@applypilot/application-runner";
import { extractRequirementEvidence } from "@applypilot/job-importer";
import { fixtureJob } from "../../../tests/fixture-data";
import { BetaRepository } from "./beta-repository";

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

describe("Beta repository", () => {
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
      .prepare("INSERT INTO candidate_profiles (id,created_at,updated_at) VALUES ('profile:1',?,?)")
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
    sqlite
      .prepare(
        `INSERT INTO document_artifacts
          (id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,
           content_digest,claim_evidence_json,layout_result_json,version,stale,created_at)
         VALUES ('document:cv',?,?,?,'CV','CLASSIC','DOCX','safe-example.docx',
           'data/private/generated/safe-example.docx',?,'[]','{}',1,0,?)`,
      )
      .run(job.id, version.id, "profile-version:1", "a".repeat(64), now);
    const packet = ApplicationPacketSchema.parse({
      id: "packet:1",
      jobId: job.id,
      jobVersionId: version.id,
      profileVersionId: "profile-version:1",
      evaluationVersionId: evaluationId,
      eligibilityStatus: "ELIGIBLE",
      targetUrl: "http://127.0.0.1:4123/synthetic-application",
      targetHost: "127.0.0.1",
      jobExpired: false,
      duplicateDanger: false,
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
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
