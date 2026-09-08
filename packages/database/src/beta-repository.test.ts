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
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });
});
