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
    workplaceType: "on-site",
    lists: [
      {
        text: "Requirements",
        content: "<ul><li>Customer service experience is required.</li></ul>",
      },
      { text: "Benefits", content: "<p>Fictional mentoring.</p>" },
    ],
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

function installFixtureProfile(sqlite: BetterSqlite3.Database) {
  const profile = CandidateProfileSchema.parse({
    ...testProfile,
    profileId: "profile:source-restart-fixture",
  });
  sqlite
    .prepare(
      `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
       VALUES (?, 'profile-version:source-restart-fixture', ?, ?)`,
    )
    .run(profile.profileId, instant.toISOString(), instant.toISOString());
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions
       (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
       VALUES ('profile-version:source-restart-fixture',?,1,1,?,?,?)`,
    )
    .run(
      profile.profileId,
      JSON.stringify(profile),
      candidateProfileContentHash(profile),
      instant.toISOString(),
    );
  return profile;
}

function fixturePipeline(
  sqlite: BetterSqlite3.Database,
  profile: ReturnType<typeof installFixtureProfile>,
  nextId: () => string,
) {
  const evaluated: string[] = [];
  const queued: Array<[string, string]> = [];
  const r2 = new R2Repository(sqlite, () => instant, nextId);
  return {
    evaluated,
    queued,
    evaluateJob: async (jobId: string) => {
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
      const evaluationId = `evaluation:restart:${jobId}`;
      const eligibility = evaluateR2Eligibility({
        profile,
        normalization,
        bindings: {
          jobVersionId: current.jobVersionId,
          currentJobVersionId: current.jobVersionId,
          profileVersionId: "profile-version:source-restart-fixture",
          currentProfileVersionId: "profile-version:source-restart-fixture",
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
        profileVersionId: "profile-version:source-restart-fixture",
        normalization,
        eligibility,
        fit,
      }).id;
    },
    queueJob: (jobId: string, evaluationId: string) => {
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
    const leverJob = JobSchema.parse(
      JSON.parse(
        (
          sqlite
            .prepare("SELECT normalized_json AS normalizedJson FROM jobs ORDER BY title LIMIT 1")
            .get() as { normalizedJson: string }
        ).normalizedJson,
      ),
    );
    expect(leverJob.description).toContain(
      "Requirements\nCustomer service experience is required.",
    );
    expect(leverJob.description).toContain("Benefits\nFictional mentoring.");
    expect(leverJob.requirements).toContain("Customer service experience is required.");
    expect(leverJob.description).not.toMatch(/<li|<p|<script/i);
    expect(
      (
        sqlite
          .prepare(
            "SELECT payload_json AS payloadJson FROM source_observation_payloads ORDER BY observation_id LIMIT 1",
          )
          .get() as { payloadJson: string }
      ).payloadJson,
    ).toContain("<li>Customer service experience is required.</li>");
    expect(
      (
        sqlite
          .prepare(
            `SELECT count(*) AS count FROM requirement_evidence_v2
             WHERE excerpt LIKE '%Customer service experience is required%'`,
          )
          .get() as { count: number }
      ).count,
    ).toBeGreaterThan(0);
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
      transportStage: null,
    });
    expect(evaluation).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    sqlite.close();
  });

  it("stores a closed transport diagnostic without retaining raw network details", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `transport-stop:${++id}`,
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
        request: async () => {
          throw Object.assign(new Error("private arbitrary socket detail"), {
            code: "ECONNREFUSED",
          });
        },
      },
      evaluateJob: evaluation,
      queueJob: queue,
    });
    expect(result).toMatchObject({
      status: "STOPPED",
      stopCode: "CONNECTION_REFUSED",
      requestCount: 1,
      pageCount: 0,
      recordCount: 0,
    });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "STOPPED",
      safeErrorCode: "CONNECTION_REFUSED",
      transportStage: "REQUEST_CREATED",
    });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_events").all())).not.toContain(
      "private arbitrary",
    );
    sqlite
      .prepare(
        `UPDATE audit_events SET redacted_metadata_json=?
         WHERE event_type='source.run.stopped' AND entity_id=?`,
      )
      .run(
        JSON.stringify({
          runId: result.runId,
          code: "CONNECTION_REFUSED",
          transportStage: "SOCKET_AT_UNTRUSTED_VALUE",
          requestCount: 1,
          recordCount: 0,
        }),
        result.runId,
      );
    expect(repository.recovery(result.runId)).toMatchObject({ transportStage: null });
    expect(evaluation).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    sqlite.close();
  });

  it("records persistence as the deepest safe stage without leaking its exception", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `persist-stop:${++id}`,
    );
    repository.persistCapabilityVersion(capability());
    vi.spyOn(repository, "persistPage").mockImplementation(() => {
      throw new Error("private database implementation detail");
    });
    const result = await runLeverSourceToQueue({
      capability: capability(),
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(JSON.stringify([posting(1)])),
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob: vi.fn(),
      queueJob: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "STOPPED",
      stopCode: "PERSISTENCE_FAILED",
      requestCount: 1,
      pageCount: 1,
      recordCount: 1,
    });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "STOPPED",
      safeErrorCode: "PERSISTENCE_FAILED",
      transportStage: "PERSISTENCE",
    });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_events").all())).not.toContain(
      "private database",
    );
    sqlite.close();
  });

  it("records response-contract drift separately from persistence without raw details", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `schema-stop:${++id}`,
    );
    repository.persistCapabilityVersion(capability());
    const malformed = { ...posting(1), hostedUrl: "private malformed value" };
    const result = await runLeverSourceToQueue({
      capability: capability(),
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(JSON.stringify([malformed])),
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob: vi.fn(),
      queueJob: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "STOPPED",
      stopCode: "SCHEMA_CHANGED",
      requestCount: 1,
      pageCount: 0,
      recordCount: 0,
    });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "STOPPED",
      safeErrorCode: "SCHEMA_CHANGED",
      transportStage: "RESPONSE_BODY",
      schemaDiagnostic: {
        field: "hostedUrl",
        expectedStructuralType: "url",
        issueCategory: "INVALID_URL",
        recordIndex: 0,
      },
    });
    const stoppedAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata
         FROM audit_events WHERE event_type='source.run.stopped' AND entity_id=?`,
      )
      .get(result.runId) as { metadata: string };
    expect(JSON.parse(stoppedAudit.metadata)).toEqual({
      runId: result.runId,
      code: "SCHEMA_CHANGED",
      transportStage: "RESPONSE_BODY",
      schemaDiagnostic: {
        field: "hostedUrl",
        expectedStructuralType: "url",
        issueCategory: "INVALID_URL",
        recordIndex: 0,
      },
      requestCount: 1,
      recordCount: 0,
    });
    expect(stoppedAudit.metadata).not.toMatch(
      /private malformed value|invalid_format|message|stack/i,
    );
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 0,
    });
    sqlite
      .prepare(
        `UPDATE audit_events SET redacted_metadata_json=?
         WHERE event_type='source.run.stopped' AND entity_id=?`,
      )
      .run(
        JSON.stringify({
          runId: result.runId,
          code: "SCHEMA_CHANGED",
          transportStage: "RESPONSE_BODY",
          schemaDiagnostic: {
            field: "arbitraryProviderKey",
            expectedStructuralType: "string",
            issueCategory: "FIELD_TYPE_MISMATCH",
            recordIndex: 0,
          },
          requestCount: 1,
          recordCount: 0,
        }),
        result.runId,
      );
    expect(repository.recovery(result.runId)).toMatchObject({ schemaDiagnostic: null });
    sqlite.close();
  });

  it("persists non-fatal workplace enum drift and continues R2 queue processing idempotently", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const nextId = () => `drift:${++id}`;
    const repository = new SourceEnablementRepository(sqlite, () => instant, nextId);
    const approved = capability();
    repository.persistCapabilityVersion(approved);
    const pipeline = fixturePipeline(sqlite, profile, nextId);
    const drifted = { ...posting(1), workplaceType: "fictional-provider-mode" };
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify([drifted])),
        connectedAddress: pinnedAddress,
      })),
    };

    const first = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(first).toMatchObject({
      status: "COMPLETE",
      stopCode: null,
      recordCount: 1,
      queuedJobIds: [expect.any(String)],
      providerDriftDiagnostics: [
        {
          issueCategory: "PROVIDER_ENUM_DRIFT",
          field: "workplaceType",
          expectedStructuralType: "enum",
          recordIndex: 0,
        },
      ],
    });
    const raw = JSON.parse(
      sqlite.prepare("SELECT raw_payload_json FROM job_source_records").pluck().get() as string,
    ) as Record<string, unknown>;
    expect(raw.workplaceType).toBe("fictional-provider-mode");

    const driftAudits = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.provider.drift' ORDER BY rowid`,
      )
      .all() as Array<{ metadata: string }>;
    expect(driftAudits).toHaveLength(1);
    expect(JSON.parse(driftAudits[0]!.metadata)).toEqual({
      issueCategory: "PROVIDER_ENUM_DRIFT",
      field: "workplaceType",
      expectedStructuralType: "enum",
      recordIndex: 0,
    });
    expect(driftAudits[0]!.metadata).not.toMatch(/fictional-provider-mode|value|title|url/i);

    const jobVersion = sqlite
      .prepare("SELECT id FROM job_versions ORDER BY rowid LIMIT 1")
      .get() as { id: string };
    const normalization = new R2ARepository(sqlite).getNormalization(jobVersion.id);
    expect(normalization).not.toBeNull();
    const locationEvidence = normalization!.fieldEvidence.filter(
      ({ normalizedValue }) => normalizedValue.kind === "LOCATION",
    );
    expect(locationEvidence.length).toBeGreaterThan(0);
    expect(
      locationEvidence.every(
        ({ normalizedValue }) =>
          normalizedValue.kind === "LOCATION" && normalizedValue.value.workplaceType === "UNKNOWN",
      ),
    ).toBe(true);

    const stableCounts = {
      observations: Number(
        sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
      ),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      evaluations: Number(
        sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get(),
      ),
      queues: Number(
        sqlite.prepare("SELECT count(*) FROM r2_queue_decision_versions").pluck().get(),
      ),
    };
    expect(stableCounts).toEqual({ observations: 1, versions: 1, evaluations: 1, queues: 1 });

    const replay = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(replay).toMatchObject({ status: "COMPLETE", queuedJobIds: [] });
    expect({
      observations: Number(
        sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
      ),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      evaluations: Number(
        sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get(),
      ),
      queues: Number(
        sqlite.prepare("SELECT count(*) FROM r2_queue_decision_versions").pluck().get(),
      ),
    }).toEqual(stableCounts);
    expect(pipeline.evaluated).toHaveLength(1);
    expect(pipeline.queued).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM audit_events WHERE event_type='source.provider.drift'",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("reconciles page-one records after page-two failure, restart, and exact replay", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const nextId = () => `restart:${++id}`;
    const repository = new SourceEnablementRepository(sqlite, () => instant, nextId);
    const approved = capability();
    repository.persistCapabilityVersion(approved);
    const pipeline = fixturePipeline(sqlite, profile, nextId);
    const pageTwoFailure: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ url, pinnedAddress }) => {
        const skip = Number(new URL(url).searchParams.get("skip"));
        return skip === 0
          ? {
              status: 200,
              headers: { "content-type": "application/json", "content-encoding": "identity" },
              body: Buffer.from(JSON.stringify([posting(1), posting(2)])),
              connectedAddress: pinnedAddress,
            }
          : {
              status: 500,
              headers: { "content-type": "application/json", "content-encoding": "identity" },
              body: Buffer.from("{}"),
              connectedAddress: pinnedAddress,
            };
      }),
    };
    const stopped = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: pageTwoFailure,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(stopped).toMatchObject({ status: "STOPPED", pageCount: 1, recordCount: 2 });
    expect(pipeline.evaluated).toHaveLength(0);
    expect(pipeline.queued).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
      count: 0,
    });

    const restarted = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: pagedTransport(),
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(restarted).toMatchObject({ status: "COMPLETE", pageCount: 2, recordCount: 3 });
    expect(restarted.queuedJobIds).toHaveLength(3);
    expect(pipeline.evaluated).toHaveLength(3);
    expect(pipeline.queued).toHaveLength(3);
    const stableCounts = {
      observations: (
        sqlite.prepare("SELECT count(*) AS count FROM source_observations").get() as {
          count: number;
        }
      ).count,
      versions: (
        sqlite.prepare("SELECT count(*) AS count FROM job_versions").get() as {
          count: number;
        }
      ).count,
      legacyEvaluations: (
        sqlite.prepare("SELECT count(*) AS count FROM evaluation_versions").get() as {
          count: number;
        }
      ).count,
      r2Evaluations: (
        sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get() as {
          count: number;
        }
      ).count,
      queues: (
        sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get() as {
          count: number;
        }
      ).count,
    };
    expect(stableCounts).toEqual({
      observations: 3,
      versions: 3,
      legacyEvaluations: 0,
      r2Evaluations: 3,
      queues: 3,
    });

    const replayed = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: pagedTransport(),
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(replayed).toMatchObject({ status: "COMPLETE", queuedJobIds: [] });
    expect(pipeline.evaluated).toHaveLength(3);
    expect(pipeline.queued).toHaveLength(3);
    expect({
      observations: (
        sqlite.prepare("SELECT count(*) AS count FROM source_observations").get() as {
          count: number;
        }
      ).count,
      versions: (
        sqlite.prepare("SELECT count(*) AS count FROM job_versions").get() as {
          count: number;
        }
      ).count,
      legacyEvaluations: (
        sqlite.prepare("SELECT count(*) AS count FROM evaluation_versions").get() as {
          count: number;
        }
      ).count,
      r2Evaluations: (
        sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get() as {
          count: number;
        }
      ).count,
      queues: (
        sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get() as {
          count: number;
        }
      ).count,
    }).toEqual(stableCounts);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
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
    await run(pagedTransport());
    await run(pagedTransport());
    expect(sqlite.prepare("SELECT count(*) count FROM source_observations").get()).toEqual({
      count: 3,
    });
    const originalRaw = sqlite
      .prepare(
        `SELECT raw_payload_json AS payload,payload_hash AS digest FROM job_source_records
         WHERE external_id='fictional-1'`,
      )
      .get() as { payload: string; digest: string };
    const changed = posting(1);
    changed.descriptionPlain = "Changed fictional evidence retained as a new observation.";
    const body = Buffer.from(JSON.stringify([changed]));
    await run({
      resolveHost: async () => ["8.8.8.8"],
      request: async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body,
        connectedAddress: pinnedAddress,
      }),
    });
    expect(sqlite.prepare("SELECT count(*) count FROM source_observations").get()).toEqual({
      count: 4,
    });
    expect(
      sqlite
        .prepare(
          `SELECT raw_payload_json AS payload,payload_hash AS digest FROM job_source_records
           WHERE external_id='fictional-1'`,
        )
        .get(),
    ).toEqual(originalRaw);
    expect(
      sqlite
        .prepare(
          `SELECT count(*) AS count FROM source_observation_payloads p
           JOIN source_observations o ON o.id=p.observation_id
           WHERE o.external_id='fictional-1'`,
        )
        .get(),
    ).toEqual({ count: 2 });
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
