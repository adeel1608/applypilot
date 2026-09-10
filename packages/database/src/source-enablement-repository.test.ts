import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import {
  SourceCapabilityV2Schema,
  sourceCapabilityDigest,
  type SourceCapabilityV2,
  type SecureSourceTransportDependencies,
} from "@applypilot/job-sources";
import { testProfile } from "../../../tests/fixture-data";

import { R2ARepository } from "./r2a-repository";
import { R2Repository } from "./r2-repository";
import { SourceEnablementRepository, runLeverSourceToQueue } from "./source-enablement-repository";

const instant = new Date("2026-09-10T00:00:00.000Z");

function database() {
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
  ])
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  return sqlite;
}

function capability(overrides: Partial<SourceCapabilityV2> = {}) {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "source-lever-fictional",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional Company",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "fixture-owner-approval",
    approvedAt: "2026-09-01T00:00:00.000Z",
    policyVersion: "fixture-policy-v1",
    policyReviewedAt: "2026-09-01T00:00:00.000Z",
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 3,
    recordCap: 5,
    pageSizeCap: 2,
    responseByteLimit: 100_000,
    requestTimeoutMs: 1_000,
    runTimeoutMs: 10_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2-fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  });
}

function posting(id: number) {
  return {
    id: `fictional-${id}`,
    text: `Fictional Assistant ${id}`,
    hostedUrl: `https://jobs.lever.co/fictional/fictional-${id}`,
    applyUrl: `https://jobs.lever.co/fictional/fictional-${id}/apply`,
    descriptionPlain: "This fictional role requires customer service in Melbourne VIC.",
    categories: {
      location: "Melbourne VIC",
      allLocations: ["Melbourne VIC"],
      commitment: "Part-time",
      department: "Fictional Operations",
    },
    country: "AU",
    workplaceType: "onsite",
    createdAt: 1788998400000,
  };
}

function pagedTransport(): SecureSourceTransportDependencies {
  return {
    resolveHost: vi.fn(async () => ["8.8.8.8"]),
    request: vi.fn(async ({ url, pinnedAddress }) => {
      const skip = Number(new URL(url).searchParams.get("skip"));
      const body = skip === 0 ? [posting(1), posting(2)] : [posting(3)];
      return {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(body)),
        connectedAddress: pinnedAddress,
      };
    }),
  };
}

describe("offline source-to-R2 queue persistence", () => {
  it("persists immutable pages, observations, normalization, evaluation handoff and queue handoff", async () => {
    const sqlite = database();
    const profile = CandidateProfileSchema.parse({
      ...testProfile,
      profileId: "profile:source-fixture",
    });
    sqlite
      .prepare(
        `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
         VALUES (?, 'profile-version:source-fixture', ?, ?)`,
      )
      .run(profile.profileId, instant.toISOString(), instant.toISOString());
    sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
         (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
         VALUES ('profile-version:source-fixture',?,1,1,?,?,?)`,
      )
      .run(
        profile.profileId,
        JSON.stringify(profile),
        candidateProfileContentHash(profile),
        instant.toISOString(),
      );
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `generated:${++id}`,
    );
    expect(repository.persistCapabilityVersion(capability())).toMatchObject({ created: true });
    expect(repository.persistCapabilityVersion(capability())).toMatchObject({ created: false });
    const evaluated: string[] = [];
    const queued: Array<[string, string]> = [];
    const r2 = new R2Repository(
      sqlite,
      () => instant,
      () => `r2:${++id}`,
    );
    const result = await runLeverSourceToQueue({
      capability: capability(),
      repository,
      now: () => instant,
      dependencies: pagedTransport(),
      evaluateJob: async (jobId) => {
        evaluated.push(jobId);
        const current = sqlite
          .prepare(
            `SELECT j.normalized_json AS normalizedJson,v.id AS jobVersionId
             FROM jobs j JOIN job_versions v ON v.id=(SELECT id FROM job_versions
               WHERE job_id=j.id ORDER BY version DESC LIMIT 1) WHERE j.id=?`,
          )
          .get(jobId) as { normalizedJson: string; jobVersionId: string };
        const normalization = new R2ARepository(sqlite).getNormalization(current.jobVersionId);
        if (!normalization) throw new Error("TEST_NORMALIZATION_REQUIRED");
        const evaluationId = `evaluation:source:${evaluated.length}`;
        const eligibility = evaluateR2Eligibility({
          profile,
          normalization,
          bindings: {
            jobVersionId: current.jobVersionId,
            currentJobVersionId: current.jobVersionId,
            profileVersionId: "profile-version:source-fixture",
            currentProfileVersionId: "profile-version:source-fixture",
            evidenceContractVersion: normalization.evidenceContractVersion,
            currentEvidenceContractVersion: normalization.evidenceContractVersion,
            evaluationVersionId: evaluationId,
          },
          evaluatedAt: instant.toISOString(),
        });
        const job = JobSchema.parse(JSON.parse(current.normalizedJson));
        const fit = scoreR2JobFit({
          profile,
          normalization,
          eligibility,
          calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
          commute: {
            distanceKm: job.estimatedCommuteKm,
            durationMinutes: job.estimatedCommuteMinutes ?? null,
          },
        });
        return r2.recordEvaluation({
          id: evaluationId,
          jobId,
          jobVersionId: current.jobVersionId,
          profileVersionId: "profile-version:source-fixture",
          normalization,
          eligibility,
          fit,
        }).id;
      },
      queueJob: (jobId, evaluationId) => {
        r2.recordQueueDecision({
          jobId,
          state: "REVIEWING",
          r2EvaluationId: evaluationId,
          duplicateResolutionVersion: r2.duplicateResolutionVersion(jobId),
          actor: "SYSTEM",
          reasonCode: "SOURCE_R2_READY",
        });
        queued.push([jobId, evaluationId]);
      },
    });
    expect(result).toMatchObject({
      status: "COMPLETE",
      requestCount: 2,
      pageCount: 2,
      recordCount: 3,
    });
    expect(evaluated).toHaveLength(3);
    expect(queued).toHaveLength(3);
    expect(sqlite.prepare("SELECT count(*) count FROM r2_evaluation_versions").get()).toEqual({
      count: 3,
    });
    expect(sqlite.prepare("SELECT count(*) count FROM r2_queue_decision_versions").get()).toEqual({
      count: 3,
    });
    expect(sqlite.prepare("SELECT count(*) count FROM source_run_pages").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) count FROM source_observations").get()).toEqual({
      count: 3,
    });
    expect(sqlite.prepare("SELECT count(*) count FROM source_observation_payloads").get()).toEqual({
      count: 3,
    });
    expect(
      sqlite
        .prepare("SELECT count(DISTINCT job_version_id) count FROM job_normalization_coverage")
        .get(),
    ).toEqual({ count: 3 });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "COMPLETE",
      recordCount: 3,
      nextCursor: null,
    });
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM audit_events WHERE event_type LIKE 'source.%'")
        .get(),
    ).toEqual({ count: 5 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("stops safely on source protection and never calls evaluation or queue", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `stop:${++id}`,
    );
    repository.persistCapabilityVersion(capability());
    const evaluation = vi.fn();
    const queue = vi.fn();
    const result = await runLeverSourceToQueue({
      capability: capability(),
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: async () => ["8.8.8.8"],
        request: async ({ pinnedAddress }) => ({
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "120" },
          body: Buffer.from("{}"),
          connectedAddress: pinnedAddress,
        }),
      },
      evaluateJob: evaluation,
      queueJob: queue,
    });
    expect(result).toMatchObject({ status: "STOPPED", stopCode: "RATE_LIMITED" });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "STOPPED",
      safeErrorCode: "RATE_LIMITED",
    });
    expect(evaluation).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    sqlite.close();
  });

  it("keeps repeated pages idempotent and links a changed observation without rewriting history", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `history:${++id}`,
    );
    const approved = capability();
    repository.persistCapabilityVersion(approved);
    const run = (dependencies: SecureSourceTransportDependencies) =>
      runLeverSourceToQueue({
        capability: approved,
        repository,
        now: () => instant,
        dependencies,
        evaluateJob: async (jobId) => `evaluation:${jobId}`,
        queueJob: () => undefined,
      });
    expect((await run(pagedTransport())).queuedJobIds).toHaveLength(3);
    expect((await run(pagedTransport())).queuedJobIds).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) count FROM source_observations").get()).toEqual({
      count: 3,
    });
    const changed = posting(1);
    changed.descriptionPlain = "Changed fictional evidence retained as a new observation.";
    const body = Buffer.from(JSON.stringify([changed]));
    const result = await run({
      resolveHost: async () => ["8.8.8.8"],
      request: async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body,
        connectedAddress: pinnedAddress,
      }),
    });
    expect(result.queuedJobIds).toHaveLength(1);
    expect(sqlite.prepare("SELECT count(*) count FROM source_observations").get()).toEqual({
      count: 4,
    });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM source_observations WHERE supersedes_observation_id IS NOT NULL",
        )
        .get(),
    ).toEqual({ count: 1 });
    sqlite.close();
  });

  it("rejects changed or out-of-sequence immutable capability versions", () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `cap:${++id}`,
    );
    repository.persistCapabilityVersion(capability());
    expect(() =>
      repository.persistCapabilityVersion({ ...capability(), alias: "Changed in place" }),
    ).toThrow("CAPABILITY_IMMUTABLE_VERSION_CONFLICT");
    expect(() =>
      repository.persistCapabilityVersion({ ...capability(), version: 3, predecessorVersion: 2 }),
    ).toThrow("CAPABILITY_VERSION_SEQUENCE_INVALID");
    sqlite.close();
  });

  it("permits only one active run for an exact capability version", () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `concurrent:${++id}`,
    );
    const approved = capability();
    repository.persistCapabilityVersion(approved);
    const runId = repository.start({
      capability: approved,
      capabilityDigest: sourceCapabilityDigest(approved),
      operation: "LIST_JOBS",
      startedAt: instant.toISOString(),
    });
    expect(() =>
      repository.start({
        capability: approved,
        capabilityDigest: sourceCapabilityDigest(approved),
        operation: "LIST_JOBS",
        startedAt: instant.toISOString(),
      }),
    ).toThrow("CONCURRENT_RUN");
    repository.cancel(runId);
    expect(repository.recovery(runId)).toMatchObject({
      status: "STOPPED",
      safeErrorCode: "OWNER_CANCELLED",
    });
    sqlite.close();
  });

  it("creates review-only duplicate suggestions across fictional tenant observations", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `dedupe:${++id}`,
    );
    const first = capability();
    const second = capability({
      capabilityId: "source-lever-fictional-two",
      tenant: "fictional-two",
      allowedPathPrefix: "/v0/postings/fictional-two",
    });
    for (const approved of [first, second]) {
      repository.persistCapabilityVersion(approved);
      const result = await runLeverSourceToQueue({
        capability: approved,
        repository,
        now: () => instant,
        dependencies: pagedTransport(),
        evaluateJob: async (jobId) => `evaluation:${jobId}`,
        queueJob: () => undefined,
      });
      expect(result.status, result.stopCode ?? "no stop").toBe("COMPLETE");
    }
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM r2_duplicate_candidates WHERE state='SUGGESTED'")
        .get(),
    ).toEqual({ count: 9 });
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM r2_duplicate_candidates WHERE state='LINKED'")
        .get(),
    ).toEqual({ count: 0 });
    sqlite.close();
  });
});
