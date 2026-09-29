import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  readLeverPageV2,
  sourceCapabilityDigest,
  type SourceCapabilityV2,
  type SourceOperation,
  type SourceOwnerReceiptChain,
  type SecureSourceTransportDependencies,
} from "@applypilot/job-sources";
import { testProfile } from "../../../tests/fixture-data";

import { R2ARepository } from "./r2a-repository";
import { BetaRepository } from "./beta-repository";
import { R2Repository } from "./r2-repository";
import {
  SourceEnablementRepository,
  runLeverDetailToQueue as runLeverDetailToQueueWithOwnerReceipts,
  runLeverSourceToQueue as runLeverSourceToQueueWithOwnerReceipts,
} from "./source-enablement-repository";

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
    "0008_real_target_inspection_scope.sql",
    "0009_green_banner_session_grant.sql",
    "0010_verified_source_packet_binding.sql",
    "0011_immutable_r2a_derivation_bindings.sql",
    "0012_source_owner_action_receipts.sql",
  ])
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  return sqlite;
}

function fictionalGateProof(
  action: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START",
  consumedAt: string,
) {
  return {
    action,
    consumedAt,
    loopbackValidated: true as const,
    localSessionValidated: true as const,
    nonceConsumed: true as const,
  };
}

function fictionalOwnerReceiptChain(
  repository: SourceEnablementRepository,
  sourceCapability: SourceCapabilityV2,
  operation: SourceOperation,
  consumedAt = instant.toISOString(),
): SourceOwnerReceiptChain {
  repository.persistCapabilityVersion(sourceCapability);
  let approval = repository.getOwnerApprovalStatus(sourceCapability);
  if (approval.state !== "CURRENT") {
    repository.recordOwnerApprovalReceipt({
      capability: sourceCapability,
      gateProof: fictionalGateProof("SOURCE_CAPABILITY_APPROVE", consumedAt),
      ownerConfirmed: true,
    });
    approval = repository.getOwnerApprovalStatus(sourceCapability);
  }
  if (approval.state !== "CURRENT" || !approval.receiptId) {
    throw new Error("TEST_FICTIONAL_OWNER_APPROVAL_REQUIRED");
  }
  return repository.createOwnerStartReceipt({
    capability: sourceCapability,
    operation,
    gateProof: fictionalGateProof("SOURCE_RUN_START", consumedAt),
    ownerConfirmed: true,
  });
}

type SourceRunInput = Parameters<typeof runLeverSourceToQueueWithOwnerReceipts>[0];
async function runLeverSourceToQueue(
  input: Omit<SourceRunInput, "ownerReceiptChain"> & {
    ownerReceiptChain?: SourceRunInput["ownerReceiptChain"];
  },
) {
  return runLeverSourceToQueueWithOwnerReceipts({
    ...input,
    ownerReceiptChain:
      input.ownerReceiptChain ??
      fictionalOwnerReceiptChain(
        input.repository,
        input.capability,
        "LIST_JOBS",
        (input.now?.() ?? instant).toISOString(),
      ),
  });
}

type DetailRunInput = Parameters<typeof runLeverDetailToQueueWithOwnerReceipts>[0];
async function runLeverDetailToQueue(
  input: Omit<DetailRunInput, "ownerReceiptChain"> & {
    ownerReceiptChain?: DetailRunInput["ownerReceiptChain"];
  },
) {
  return runLeverDetailToQueueWithOwnerReceipts({
    ...input,
    ownerReceiptChain:
      input.ownerReceiptChain ??
      fictionalOwnerReceiptChain(
        input.repository,
        input.capability,
        "GET_JOB",
        (input.now?.() ?? instant).toISOString(),
      ),
  });
}

function startFictionalOwnerBoundRun(
  repository: SourceEnablementRepository,
  sourceCapability: SourceCapabilityV2,
  operation: SourceOperation,
  startedAt = instant.toISOString(),
): string {
  const ownerReceiptChain = fictionalOwnerReceiptChain(
    repository,
    sourceCapability,
    operation,
    startedAt,
  );
  return repository.start({
    capability: sourceCapability,
    capabilityDigest: sourceCapabilityDigest(sourceCapability),
    operation,
    startedAt,
    ownerApprovalReceiptId: ownerReceiptChain.approvalReceiptId,
    ownerStartReceiptId: ownerReceiptChain.startReceiptId,
  });
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

function fixedLength(prefix: string, length: number, fill: string): string {
  if (prefix.length > length) throw new Error("TEST_PREFIX_EXCEEDS_LENGTH");
  return `${prefix}${fill.repeat(length - prefix.length)}`;
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
      const evaluationId = `evaluation:restart:${jobId}:${evaluated.length}`;
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
    const normalizedVersion = sqlite
      .prepare("SELECT id FROM job_versions ORDER BY rowid LIMIT 1")
      .get() as { id: string };
    const normalization = new R2ARepository(sqlite).getNormalization(normalizedVersion.id);
    expect(normalization).not.toBeNull();
    expect(normalization!.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "EXPERIENCE",
          modality: "REQUIRED",
          source: expect.objectContaining({ sourcePath: expect.stringContaining("structured") }),
        }),
      ]),
    );
    expect(
      normalization!.requirementEvidence.some(({ source }) => /<li|<p>/i.test(source.excerpt)),
    ).toBe(false);
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "COMPLETE",
      recordCount: 3,
      nextCursor: null,
    });
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM audit_events WHERE event_type LIKE 'source.%'")
        .get(),
    ).toEqual({ count: 10 });
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

  it("keeps an injected SQLite write failure page-fatal and rolls back the page", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `sqlite-stop:${++id}`,
    );
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    repository.persistCapabilityVersion(approved);
    sqlite.exec(`CREATE TRIGGER synthetic_source_observation_failure
      BEFORE INSERT ON source_observations
      BEGIN SELECT RAISE(ABORT, 'synthetic private sqlite detail'); END`);
    const result = await runLeverSourceToQueue({
      capability: approved,
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
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 0 });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_events").all())).not.toContain(
      "synthetic private sqlite detail",
    );
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("persists all 25 accepted records from a structurally valid provider page", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `all-accepted:${++id}`,
    );
    const approved = capability({
      requestBudget: 1,
      recordCap: 25,
      pageSizeCap: 25,
      responseByteLimit: 500_000,
    });
    repository.persistCapabilityVersion(approved);
    const evaluateJob = vi.fn(async () => null);
    const result = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(
            JSON.stringify(Array.from({ length: 25 }, (_, index) => posting(index + 1))),
          ),
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob,
      queueJob: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "COMPLETE",
      providerRecordCount: 25,
      acceptedRecordCount: 25,
      unusableRecordCount: 0,
    });
    expect(result.records).toHaveLength(25);
    expect(evaluateJob).toHaveBeenCalledTimes(25);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 25,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 25,
    });
    expect(sqlite.prepare("SELECT record_count AS count FROM source_run_pages").get()).toEqual({
      count: 25,
    });
    expect(repository.recovery(result.runId)).toMatchObject({
      providerRecordCount: 25,
      acceptedRecordCount: 25,
      unusableRecordCount: 0,
      persistedObservationCount: 25,
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("persists bounded long evidence and rejects an unsafe link without rolling back siblings", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const nextId = () => `bounded-evidence:${++id}`;
    const repository = new SourceEnablementRepository(sqlite, () => instant, nextId);
    const approved = capability({ requestBudget: 1, recordCap: 3, pageSizeCap: 3 });
    repository.persistCapabilityVersion(approved);
    const pipeline = fixturePipeline(sqlite, profile, nextId);
    const longRequirement = `Five years experience ${"x".repeat(580)}`;
    const values = [
      {
        ...posting(1),
        lists: [{ text: "Requirements", content: `<p>${longRequirement}</p>` }],
      },
      posting(2),
      { ...posting(3), applyUrl: "http://jobs.lever.co/fictional/private-fixture" },
    ];
    const result = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(JSON.stringify(values)),
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(result).toMatchObject({
      status: "COMPLETE",
      providerRecordCount: 3,
      acceptedRecordCount: 2,
      unusableRecordCount: 1,
      safeUnusableDiagnostics: [{ reasonCode: "UNUSABLE_LINK_BOUNDARY", recordIndex: 2 }],
    });
    expect(result.queuedJobIds).toHaveLength(2);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
      count: 2,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get(),
    ).toEqual({ count: 2 });
    expect(repository.recovery(result.runId)).toMatchObject({
      providerRecordCount: 3,
      acceptedRecordCount: 2,
      unusableRecordCount: 1,
      persistedObservationCount: 2,
    });
    const unusableAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.record.unusable' AND entity_id=?`,
      )
      .get(result.runId) as { metadata: string };
    expect(JSON.parse(unusableAudit.metadata)).toEqual({
      reasonCode: "UNUSABLE_LINK_BOUNDARY",
      recordIndex: 2,
    });
    expect(unusableAudit.metadata).not.toMatch(/jobs\.lever|private-fixture|http/i);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("closes every accepted provider-controlled boundary across a mixed 25-record page and replay", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const nextId = () => `closure:${++id}`;
    const repository = new SourceEnablementRepository(sqlite, () => instant, nextId);
    const approved = capability({
      requestBudget: 1,
      recordCap: 25,
      pageSizeCap: 25,
      responseByteLimit: 500_000,
    });
    repository.persistCapabilityVersion(approved);
    const pipeline = fixturePipeline(sqlite, profile, nextId);
    const titled = (id: number, length: number) => ({
      ...posting(id),
      text: fixedLength(`Fictional title ${id} `, length, "t"),
    });
    const located = (id: number, length: number) => {
      const location = fixedLength(`Fictional location ${id} `, length, "l");
      return {
        ...posting(id),
        categories: { ...posting(id).categories, location, allLocations: [location] },
      };
    };
    const committed = (id: number, length: number) => ({
      ...posting(id),
      categories: {
        ...posting(id).categories,
        commitment: fixedLength("Full-time ", length, "c"),
      },
    });
    const requirement = (id: number, content: string) => ({
      ...posting(id),
      lists: [{ text: "Requirements", content: `<p>${content}</p>` }],
    });
    const values = [
      { ...titled(1, 999), salaryRange: { min: 30, max: 40, currency: "AUD", interval: "hour" } },
      { ...titled(2, 1000), salaryRange: { min: 0, max: 0, currency: "AUD", interval: "hour" } },
      { ...titled(3, 1001), salaryRange: { min: -1, max: 10, currency: "AUD", interval: "hour" } },
      { ...titled(4, 4096), salaryRange: { min: 1, max: -10, currency: "AUD", interval: "hour" } },
      {
        ...located(5, 199),
        salaryRange: { min: 1e100, max: 1e101, currency: "AUD", interval: "year" },
      },
      {
        ...located(6, 200),
        salaryRange: { min: 1, max: 2, currency: "USD", interval: "fortnight" },
      },
      {
        ...located(7, 201),
        salaryRange: { min: 1, max: 2, currency: "C".repeat(4097), interval: "hour" },
      },
      {
        ...located(8, 1000),
        salaryRange: { min: 1, max: 2, currency: "AUD", interval: "undocumented" },
      },
      {
        ...committed(9, 999),
        salaryRange: { min: 1, max: 2, currency: "AUD", interval: "i".repeat(4097) },
      },
      {
        ...committed(10, 1000),
        lists: [
          { text: "Requirements", content: `<p>Five years experience ${"x".repeat(580)}</p>` },
        ],
      },
      { ...committed(11, 1001), workplaceType: "unspecified" },
      { ...committed(12, 4097), workplaceType: null },
      requirement(13, "Travel up to 0% may be required"),
      requirement(14, "Travel up to 100% may be required"),
      requirement(15, "Travel up to 101% may be required"),
      requirement(16, "Travel up to 150% may be required"),
      requirement(17, "0 hours per week may be required"),
      requirement(18, `${"9".repeat(400)} hours per week may be required`),
      requirement(19, "0 years experience required"),
      requirement(20, `${"9".repeat(400)} years experience required`),
      requirement(21, "Commute 0 km or 0 minutes"),
      requirement(22, "Commute -5 km or -10 minutes"),
      { ...posting(23), text: `${"u".repeat(999)}😀` },
      {
        ...posting(24),
        categories: {
          ...posting(24).categories,
          department: "d".repeat(128 * 1024 + 1),
          team: "Fictional bounded team",
        },
        country: null,
        workplaceType: "hybrid",
      },
      { ...posting(25), applyUrl: "http://jobs.lever.co/fictional/rejected-fixture" },
    ];
    const body = Buffer.from(JSON.stringify(values));
    expect(body.byteLength).toBeLessThanOrEqual(approved.responseByteLimit);
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body,
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
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      safeUnusableDiagnostics: [{ reasonCode: "UNUSABLE_LINK_BOUNDARY", recordIndex: 24 }],
    });
    expect(first.acceptedRecordCount + first.unusableRecordCount).toBe(25);
    expect(first.records.map(({ externalId }) => externalId)).toEqual(
      values.slice(0, 24).map(({ id }) => id),
    );
    expect(
      sqlite
        .prepare(
          `SELECT record_index AS recordIndex,disposition,external_id AS externalId
           FROM source_record_verifications WHERE run_id=? ORDER BY record_index,disposition`,
        )
        .all(first.runId),
    ).toEqual([
      ...values.slice(0, 24).map(({ id }, recordIndex) => ({
        recordIndex,
        disposition: "ACCEPTED",
        externalId: id,
      })),
      { recordIndex: 24, disposition: "UNUSABLE", externalId: null },
    ]);
    expect(first.queuedJobIds).toHaveLength(24);
    expect(pipeline.evaluated).toHaveLength(24);
    expect(pipeline.queued).toHaveLength(24);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
      count: 24,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get(),
    ).toEqual({ count: 24 });
    expect(
      sqlite.prepare("SELECT max(length(excerpt)) AS maximum FROM job_field_evidence_v2").get(),
    ).toEqual({ maximum: 1000 });
    expect(
      sqlite.prepare("SELECT max(length(excerpt)) AS maximum FROM requirement_evidence_v2").get(),
    ).toMatchObject({ maximum: expect.any(Number) });
    const title4096 = JSON.parse(
      (
        sqlite
          .prepare(
            `SELECT j.normalized_json AS normalizedJson FROM jobs j
             JOIN job_source_records r ON r.job_id=j.id WHERE r.external_id='fictional-4'`,
          )
          .get() as { normalizedJson: string }
      ).normalizedJson,
    ) as { title: string };
    expect(title4096.title).toBe(values[3]!.text);
    expect(title4096.title).toHaveLength(4096);
    const location1000 = JSON.parse(
      (
        sqlite
          .prepare(
            `SELECT j.normalized_json AS normalizedJson FROM jobs j
             JOIN job_source_records r ON r.job_id=j.id WHERE r.external_id='fictional-8'`,
          )
          .get() as { normalizedJson: string }
      ).normalizedJson,
    ) as { location: string };
    expect(location1000.location).toBe(values[7]!.categories.location);
    expect(location1000.location).toHaveLength(1000);
    const fieldEvidence = (externalId: string, canonicalField: string) =>
      (
        sqlite
          .prepare(
            `SELECT e.excerpt,e.normalized_value_json AS normalizedValueJson
             FROM job_source_records r JOIN job_versions v ON v.job_id=r.job_id
             JOIN job_field_evidence_v2 e ON e.job_version_id=v.id
             WHERE r.external_id=? AND e.canonical_field=? ORDER BY e.rowid`,
          )
          .all(externalId, canonicalField) as Array<{
          excerpt: string;
          normalizedValueJson: string;
        }>
      ).map((row) => ({ excerpt: row.excerpt, value: JSON.parse(row.normalizedValueJson) }));
    const requirementEvidence = (externalId: string, canonicalKind: string) =>
      (
        sqlite
          .prepare(
            `SELECT e.normalized_value_json AS normalizedValueJson
             FROM job_source_records r JOIN job_versions v ON v.job_id=r.job_id
             JOIN requirement_evidence_v2 e ON e.job_version_id=v.id
             WHERE r.external_id=? AND e.canonical_kind=? ORDER BY e.rowid`,
          )
          .all(externalId, canonicalKind) as Array<{ normalizedValueJson: string }>
      ).map(({ normalizedValueJson }) => JSON.parse(normalizedValueJson));
    for (const externalId of ["fictional-9", "fictional-10", "fictional-11", "fictional-12"]) {
      expect(fieldEvidence(externalId, "employment.type")).toEqual([
        { excerpt: "Full-time", value: { kind: "EMPLOYMENT_TYPE", value: "FULL_TIME" } },
      ]);
    }
    for (const [index, externalId] of [
      [4, "fictional-5"],
      [5, "fictional-6"],
      [6, "fictional-7"],
      [7, "fictional-8"],
    ] as const) {
      const locationEvidence = fieldEvidence(externalId, "location.alternative")[0]?.value;
      expect(locationEvidence).toMatchObject({
        kind: "LOCATION",
        value: { rawLabel: values[index]!.categories.location },
      });
      expect(locationEvidence.value.locality.length).toBeLessThanOrEqual(200);
      expect(locationEvidence.value.suburb.length).toBeLessThanOrEqual(200);
    }
    expect(fieldEvidence("fictional-1", "salary")[0]?.value).toMatchObject({
      value: { minimum: 30, maximum: 40, currency: "AUD", period: "HOUR" },
    });
    expect(fieldEvidence("fictional-2", "salary")[0]?.value).toMatchObject({
      value: { minimum: 0, maximum: 0, currency: "AUD", period: "HOUR" },
    });
    expect(fieldEvidence("fictional-3", "salary")).toEqual([]);
    expect(fieldEvidence("fictional-4", "salary")).toEqual([]);
    expect(fieldEvidence("fictional-7", "salary")[0]?.value).toMatchObject({
      value: { minimum: 1, maximum: 2, currency: null, period: "HOUR" },
    });
    expect(fieldEvidence("fictional-8", "salary")[0]?.value).toMatchObject({
      value: { minimum: 1, maximum: 2, currency: "AUD", period: "UNKNOWN" },
    });
    expect(fieldEvidence("fictional-9", "salary")[0]?.value).toMatchObject({
      value: { minimum: 1, maximum: 2, currency: "AUD", period: "UNKNOWN" },
    });
    expect(fieldEvidence("fictional-13", "travel.percentage")[0]?.value).toMatchObject({
      value: { percentage: 0 },
    });
    expect(fieldEvidence("fictional-14", "travel.percentage")[0]?.value).toMatchObject({
      value: { percentage: 100 },
    });
    expect(fieldEvidence("fictional-15", "travel.percentage")).toEqual([]);
    expect(fieldEvidence("fictional-16", "travel.percentage")).toEqual([]);
    expect(fieldEvidence("fictional-17", "hours.week")[0]?.value).toMatchObject({
      value: { minimum: 0, maximum: 0 },
    });
    expect(fieldEvidence("fictional-18", "hours.week")).toEqual([]);
    expect(requirementEvidence("fictional-19", "EXPERIENCE")[0]).toMatchObject({
      value: { minimum: 0 },
    });
    expect(requirementEvidence("fictional-20", "EXPERIENCE")[0]).toMatchObject({
      value: { minimum: null, maximum: null },
    });
    expect(fieldEvidence("fictional-21", "commute.distance")[0]?.value).toMatchObject({
      value: { distanceKm: 0 },
    });
    expect(fieldEvidence("fictional-22", "commute.distance")).toEqual([]);
    const unicodeTitle = fieldEvidence("fictional-23", "title")[0];
    expect(unicodeTitle?.excerpt).toHaveLength(999);
    expect(unicodeTitle?.excerpt).not.toMatch(/[\uD800-\uDFFF]$/);
    expect(
      JSON.parse(
        (
          sqlite
            .prepare(
              "SELECT raw_payload_json AS payload FROM job_source_records WHERE external_id='fictional-12'",
            )
            .get() as { payload: string }
        ).payload,
      ),
    ).toEqual(values[11]);
    expect(repository.recovery(first.runId)).toMatchObject({
      requestCount: 1,
      pageCount: 1,
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      providerDriftWarningCount: 1,
      persistedObservationCount: 24,
      nextCursor: null,
    });
    const rejectedAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.record.unusable' AND entity_id=?`,
      )
      .get(first.runId) as { metadata: string };
    expect(JSON.parse(rejectedAudit.metadata)).toEqual({
      reasonCode: "UNUSABLE_LINK_BOUNDARY",
      recordIndex: 24,
    });
    expect(rejectedAudit.metadata).not.toMatch(/jobs\.lever|rejected-fixture|http/i);
    const stableCounts = {
      observations: (
        sqlite.prepare("SELECT count(*) AS count FROM source_observations").get() as {
          count: number;
        }
      ).count,
      versions: (
        sqlite.prepare("SELECT count(*) AS count FROM job_versions").get() as { count: number }
      ).count,
      evaluations: (
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
    const replay = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(replay).toMatchObject({
      status: "COMPLETE",
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      queuedJobIds: [],
    });
    expect({
      observations: (
        sqlite.prepare("SELECT count(*) AS count FROM source_observations").get() as {
          count: number;
        }
      ).count,
      versions: (
        sqlite.prepare("SELECT count(*) AS count FROM job_versions").get() as { count: number }
      ).count,
      evaluations: (
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
    expect(pipeline.evaluated).toHaveLength(24);
    expect(pipeline.queued).toHaveLength(24);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("persists 24 accepted siblings, accounts one unusable record, and replays idempotently", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const nextId = () => `unusable-page:${++id}`;
    const repository = new SourceEnablementRepository(sqlite, () => instant, nextId);
    const approved = capability({
      requestBudget: 1,
      recordCap: 25,
      pageSizeCap: 25,
      responseByteLimit: 500_000,
    });
    repository.persistCapabilityVersion(approved);
    const pipeline = fixturePipeline(sqlite, profile, nextId);
    const unusable = {
      ...posting(25),
      description: "",
      descriptionPlain: "",
      additional: "",
      additionalPlain: "",
      lists: [],
    };
    const values = [...Array.from({ length: 24 }, (_, index) => posting(index + 1)), unusable];
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(values)),
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
      requestCount: 1,
      pageCount: 1,
      recordCount: 25,
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      safeUnusableDiagnostics: [{ reasonCode: "MISSING_USABLE_DESCRIPTION", recordIndex: 24 }],
    });
    expect(first.records).toHaveLength(24);
    expect(first.queuedJobIds).toHaveLength(24);
    expect(pipeline.evaluated).toHaveLength(24);
    expect(pipeline.queued).toHaveLength(24);
    expect(repository.recovery(first.runId)).toMatchObject({
      status: "COMPLETE",
      safeErrorCode: null,
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      providerDriftWarningCount: 0,
      persistedObservationCount: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
      count: 24,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get(),
    ).toEqual({
      count: 24,
    });
    const unusableAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.record.unusable' AND entity_id=?`,
      )
      .get(first.runId) as { metadata: string };
    expect(JSON.parse(unusableAudit.metadata)).toEqual({
      reasonCode: "MISSING_USABLE_DESCRIPTION",
      recordIndex: 24,
    });
    expect(unusableAudit.metadata).not.toMatch(/Fictional Assistant|Melbourne VIC|jobs\.lever/i);
    const pageAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.page.persisted' AND entity_id=?`,
      )
      .get(first.runId) as { metadata: string };
    expect(JSON.parse(pageAudit.metadata)).toMatchObject({
      recordCount: 25,
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      providerDriftWarningCount: 0,
      persistedObservationCount: 24,
    });

    const firstDigest = sqlite
      .prepare("SELECT page_digest FROM source_run_pages WHERE run_id=?")
      .pluck()
      .get(first.runId);
    const replay = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(replay).toMatchObject({
      status: "COMPLETE",
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      queuedJobIds: [],
    });
    expect(repository.recovery(replay.runId)).toMatchObject({
      providerRecordCount: 25,
      acceptedRecordCount: 24,
      unusableRecordCount: 1,
      persistedObservationCount: 0,
    });
    expect(
      sqlite
        .prepare("SELECT page_digest FROM source_run_pages WHERE run_id=?")
        .pluck()
        .get(replay.runId),
    ).toBe(firstDigest);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 24,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
      count: 24,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM r2_queue_decision_versions").get(),
    ).toEqual({
      count: 24,
    });
    expect(pipeline.evaluated).toHaveLength(24);
    expect(pipeline.queued).toHaveLength(24);
    sqlite.close();
  });

  it("persists page accounting and completes when all 25 provider records are unusable", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `all-unusable:${++id}`,
    );
    const approved = capability({
      requestBudget: 1,
      recordCap: 25,
      pageSizeCap: 25,
      responseByteLimit: 500_000,
    });
    repository.persistCapabilityVersion(approved);
    const values = Array.from({ length: 25 }, (_, index) => ({
      ...posting(index + 1),
      categories: { commitment: "Part-time" },
      ...(index === 0 ? { workplaceType: "private-fictional-drift-value" } : {}),
    }));
    const result = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(JSON.stringify(values)),
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob: vi.fn(),
      queueJob: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "COMPLETE",
      stopCode: null,
      providerRecordCount: 25,
      acceptedRecordCount: 0,
      unusableRecordCount: 25,
      queuedJobIds: [],
    });
    expect(repository.recovery(result.runId)).toMatchObject({
      status: "COMPLETE",
      safeErrorCode: null,
      providerRecordCount: 25,
      acceptedRecordCount: 0,
      unusableRecordCount: 25,
      providerDriftWarningCount: 1,
      persistedObservationCount: 0,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT record_count AS count FROM source_run_pages").get()).toEqual({
      count: 25,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 0,
    });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM audit_events WHERE event_type='source.record.unusable'",
        )
        .get(),
    ).toEqual({ count: 25 });
    const driftAudit = sqlite
      .prepare(
        `SELECT redacted_metadata_json AS metadata FROM audit_events
         WHERE event_type='source.provider.drift'`,
      )
      .get() as { metadata: string };
    expect(JSON.parse(driftAudit.metadata)).toEqual({
      issueCategory: "PROVIDER_ENUM_DRIFT",
      field: "workplaceType",
      expectedStructuralType: "enum",
      recordIndex: 0,
    });
    expect(driftAudit.metadata).not.toContain("private-fictional-drift-value");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
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
          body: Buffer.from(JSON.stringify([posting(2), malformed])),
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
        recordIndex: 1,
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
        recordIndex: 1,
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
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
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
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE disposition='ACCEPTED' AND qualification_state='PAGE_PERSISTED'",
        )
        .get(),
    ).toEqual({ count: 2 });

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
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE qualification_state='QUALIFIED'",
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE run_id = ? AND qualification_state='QUALIFIED'",
        )
        .get(restarted.runId),
    ).toEqual({ count: 3 });
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
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_record_verifications").get(),
    ).toEqual({ count: 8 });
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

  it("accounts identical content at distinct cursors as distinct page operations", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `cursor:${++id}`,
    );
    const approved = capability({ requestBudget: 3, recordCap: 2, pageSizeCap: 1 });
    repository.persistCapabilityVersion(approved);
    const originalPersistPage = repository.persistPage.bind(repository);
    let conflictChecked = false;
    vi.spyOn(repository, "persistPage").mockImplementation((input) => {
      originalPersistPage(input);
      if (!conflictChecked) {
        conflictChecked = true;
        expect(() =>
          originalPersistPage({
            ...input,
            page: { ...input.page, pageDigest: "f".repeat(64) },
          }),
        ).toThrow("SOURCE_PAGE_REPLAY_CONFLICT");
      }
    });
    const body = Buffer.from(JSON.stringify([posting(1)]));
    const result = await runLeverSourceToQueue({
      capability: approved,
      repository,
      now: () => instant,
      dependencies: {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async ({ url, pinnedAddress }) => ({
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: new URL(url).searchParams.get("skip") === "2" ? Buffer.from("[]") : body,
          connectedAddress: pinnedAddress,
        })),
      },
      evaluateJob: async () => null,
      queueJob: () => undefined,
    });
    expect(result).toMatchObject({ status: "COMPLETE", requestCount: 2, pageCount: 2 });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE run_id=? AND disposition='ACCEPTED'",
        )
        .get(result.runId),
    ).toEqual({ count: 2 });
    sqlite.close();
  });

  it("rolls back terminal completion on qualification interruption and reconciles safely", async () => {
    const sqlite = database();
    let id = 0;
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `qualification:${++id}`,
    );
    repository.persistCapabilityVersion(approved);
    const runId = startFictionalOwnerBoundRun(repository, approved, "LIST_JOBS");
    const budget = new SourceRunBudget(approved, instant);
    const page = await readLeverPageV2({
      capability: approved,
      budget,
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
    });
    repository.persistPage({
      runId,
      capability: approved,
      page,
      budget,
      observedAt: instant.toISOString(),
    });
    const interrupted = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `interrupted:${++id}`,
      {
        beforeQualification: () => {
          throw new Error("QUALIFICATION_INTERRUPTED");
        },
      },
    );
    expect(() =>
      interrupted.complete({ runId, budget, completedAt: instant.toISOString() }),
    ).toThrow("QUALIFICATION_INTERRUPTED");
    expect(
      sqlite.prepare("SELECT status FROM source_run_checkpoints WHERE id=?").get(runId),
    ).toEqual({
      status: "RUNNING",
    });
    expect(
      sqlite
        .prepare(
          "SELECT qualification_state AS state,verified_at AS verifiedAt FROM source_record_verifications WHERE run_id=?",
        )
        .get(runId),
    ).toEqual({ state: "PAGE_PERSISTED", verifiedAt: instant.toISOString() });
    repository.complete({ runId, budget, completedAt: instant.toISOString() });
    expect(repository.reconcileCompletedRun(runId)).toBe(0);
    expect(
      sqlite.prepare("SELECT status FROM source_run_checkpoints WHERE id=?").get(runId),
    ).toEqual({
      status: "COMPLETE",
    });
    expect(
      sqlite
        .prepare(
          "SELECT qualification_state AS state FROM source_record_verifications WHERE run_id=?",
        )
        .get(runId),
    ).toEqual({ state: "QUALIFIED" });
    sqlite.close();
  });

  it("does not treat an unchanged replay as a fresh provider observation", async () => {
    const sqlite = database();
    let id = 0;
    let current = instant;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => current,
      () => `unchanged:${++id}`,
    );
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    repository.persistCapabilityVersion(approved);
    const body = Buffer.from(JSON.stringify([posting(1)]));
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body,
        connectedAddress: pinnedAddress,
      })),
    };
    const run = () =>
      runLeverSourceToQueue({
        capability: approved,
        repository,
        now: () => current,
        dependencies,
        evaluateJob: async (jobId) => `evaluation:${jobId}`,
        queueJob: () => undefined,
      });
    await run();
    const first = sqlite
      .prepare(
        `SELECT observed_at AS observedAt, content_hash AS contentHash
         FROM source_observations WHERE external_id='fictional-1'`,
      )
      .get() as { observedAt: string; contentHash: string };
    current = new Date(instant.getTime() + 24 * 60 * 60 * 1000);
    await run();
    expect(dependencies.request).toHaveBeenCalledTimes(2);
    expect(dependencies.resolveHost).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite
        .prepare(
          `SELECT observed_at AS observedAt, content_hash AS contentHash
           FROM source_observations WHERE external_id='fictional-1'`,
        )
        .get(),
    ).toEqual(first);
    expect(first.contentHash).toHaveLength(64);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE disposition='ACCEPTED' AND qualification_state='QUALIFIED'",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    sqlite.close();
  });

  it("does not duplicate verification when the same page is replayed inside one run", async () => {
    const sqlite = database();
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `same-run:${++id}`,
    );
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    repository.persistCapabilityVersion(approved);
    const originalPersistPage = repository.persistPage.bind(repository);
    let replayed = false;
    const persisted = vi.spyOn(repository, "persistPage").mockImplementation((input) => {
      originalPersistPage(input);
      if (!replayed) {
        replayed = true;
        originalPersistPage(input);
      }
    });
    const result = await runLeverSourceToQueue({
      capability: approved,
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
      evaluateJob: async () => null,
      queueJob: () => undefined,
    });
    expect(result.status).toBe("COMPLETE");
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 1,
    });
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_record_verifications").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.prepare("SELECT qualification_state AS state FROM source_record_verifications").get(),
    ).toEqual({ state: "QUALIFIED" });
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
    const runId = startFictionalOwnerBoundRun(repository, approved, "LIST_JOBS");
    expect(() => startFictionalOwnerBoundRun(repository, approved, "LIST_JOBS")).toThrow(
      "CONCURRENT_RUN",
    );
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

  it("persists exact GET_JOB detail runs and replays unchanged content without duplicate lineage", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const approved = capability({
      allowedOperations: ["GET_JOB"],
      requestBudget: 1,
      recordCap: 1,
      pageSizeCap: 1,
    });
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `detail:${++id}`,
    );
    repository.persistCapabilityVersion(approved);
    let payload: unknown = posting(99);
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ url, pinnedAddress }) => {
        expect(url.pathname).toBe("/v0/postings/fictional/fictional-99");
        expect(url.searchParams.toString()).toBe("mode=json");
        return {
          status: 200,
          headers: { "content-type": "application/json", "content-encoding": "identity" },
          body: Buffer.from(JSON.stringify(payload)),
          connectedAddress: pinnedAddress,
        };
      }),
    };
    const pipeline = fixturePipeline(sqlite, profile, () => `r2:detail:${++id}`);
    const first = await runLeverDetailToQueue({
      capability: approved,
      repository,
      externalId: "fictional-99",
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(first).toMatchObject({
      operation: "GET_JOB",
      status: "COMPLETE",
      terminalState: "COMPLETE",
      requestCount: 1,
      pageCount: 1,
      recordCount: 1,
      acceptedRecordCount: 1,
    });
    expect(first.queuedJobIds).toEqual([expect.stringMatching(/^source-job-/)]);
    expect(
      sqlite
        .prepare(
          "SELECT operation,status,current_cursor,next_cursor,record_count FROM source_run_checkpoints",
        )
        .get(),
    ).toMatchObject({
      operation: "GET_JOB",
      status: "COMPLETE",
      current_cursor: "GET_JOB:fictional-99",
      next_cursor: null,
      record_count: 1,
    });
    expect(
      sqlite.prepare("SELECT qualification_state FROM source_record_verifications").get(),
    ).toEqual({
      qualification_state: "QUALIFIED",
    });
    payload = posting(99);
    const replay = await runLeverDetailToQueue({
      capability: approved,
      repository,
      externalId: "fictional-99",
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(replay.terminalState).toBe("COMPLETE");
    expect(pipeline.evaluated).toHaveLength(1);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 1,
    });
    payload = { ...posting(99), descriptionPlain: "Changed fictional evidence." };
    const changed = await runLeverDetailToQueue({
      capability: approved,
      repository,
      externalId: "fictional-99",
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    expect(changed.terminalState).toBe("COMPLETE");
    expect(pipeline.evaluated).toHaveLength(2);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_pages").get()).toEqual({
      count: 3,
    });
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM source_record_verifications WHERE qualification_state='QUALIFIED'",
        )
        .get(),
    ).toEqual({ count: 3 });
    sqlite.close();
  });

  it("re-derives unchanged immutable content with a new R2A identity and exact binding", async () => {
    const sqlite = database();
    const profile = installFixtureProfile(sqlite);
    let id = 0;
    const approved = capability({
      allowedOperations: ["GET_JOB"],
      requestBudget: 1,
      recordCap: 1,
      pageSizeCap: 1,
    });
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `rederive:${++id}`,
    );
    repository.persistCapabilityVersion(approved);
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(posting(100))),
        connectedAddress: pinnedAddress,
      })),
    };
    const pipeline = fixturePipeline(sqlite, profile, () => `r2:rederive:${++id}`);
    await runLeverDetailToQueue({
      capability: approved,
      repository,
      externalId: "fictional-100",
      now: () => instant,
      dependencies,
      evaluateJob: pipeline.evaluateJob,
      queueJob: pipeline.queueJob,
    });
    const verification = sqlite
      .prepare("SELECT id,job_version_id AS jobVersionId FROM source_record_verifications")
      .get() as { id: string; jobVersionId: string };
    sqlite.prepare("UPDATE job_normalization_coverage SET parser_version='3.1.0'").run();
    sqlite.prepare("UPDATE job_field_evidence_v2 SET extractor_version='3.1.0'").run();
    sqlite.prepare("UPDATE requirement_evidence_v2 SET extractor_version='3.1.0'").run();
    const old = new R2ARepository(sqlite).getNormalization(verification.jobVersionId)!;
    expect(old.parserVersion).toBe("3.1.0");
    const derived = repository.rederiveLeverObservation({ verificationId: verification.id });
    expect(derived.parserVersion).toBe("3.4.0");
    expect(derived.normalizationVersion).toBe("3.4.0");
    expect(derived.parentJobVersionId).toBe(verification.jobVersionId);
    expect(
      new R2ARepository(sqlite).getNormalization(derived.derivedJobVersionId)?.parserVersion,
    ).toBe("3.4.0");
    const jobId = (
      sqlite
        .prepare("SELECT job_id AS jobId FROM job_versions WHERE id=?")
        .get(verification.jobVersionId) as { jobId: string }
    ).jobId;
    expect(
      new BetaRepository(sqlite).getLatestQualifiedVerification(jobId, derived.derivedJobVersionId)
        ?.jobVersionId,
    ).toBe(derived.derivedJobVersionId);
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_derivation_bindings").get(),
    ).toEqual({
      count: 1,
    });
    sqlite.prepare("UPDATE source_observation_payloads SET content_digest=?").run("f".repeat(64));
    expect(() => repository.rederiveLeverObservation({ verificationId: verification.id })).toThrow(
      "R2A_IMMUTABLE_PAYLOAD_IDENTITY_MISMATCH",
    );
    sqlite
      .prepare(
        "UPDATE source_observation_payloads SET content_digest=(SELECT content_hash FROM source_observations LIMIT 1)",
      )
      .run();
    sqlite.prepare("UPDATE source_derivation_bindings SET derivation_digest=?").run("e".repeat(64));
    expect(() => repository.rederiveLeverObservation({ verificationId: verification.id })).toThrow(
      "R2A_DERIVATION_BINDING_CONFLICT",
    );
    sqlite
      .prepare("UPDATE source_derivation_bindings SET derivation_digest=?")
      .run(derived.derivationDigest);
    const replay = repository.rederiveLeverObservation({ verificationId: verification.id });
    expect(replay.created).toBe(false);
    expect(replay.derivedJobVersionId).toBe(derived.derivedJobVersionId);
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_derivation_bindings").get(),
    ).toEqual({
      count: 1,
    });
    sqlite.close();
  });

  it("records separate owner receipts and binds the run before mocked transport", async () => {
    const sqlite = database();
    let id = 0;
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `owner-receipt:${++id}`,
    );
    repository.persistCapabilityVersion(approved);
    const approvalProof = {
      ...fictionalGateProof("SOURCE_CAPABILITY_APPROVE", instant.toISOString()),
      nonce: "nonce-private-sentinel",
      sessionCookie: "session-private-sentinel",
      confirmationText: `APPROVE ${approved.capabilityId}`,
    } as never;
    const approval = repository.recordOwnerApprovalReceipt({
      capability: approved,
      gateProof: approvalProof,
      ownerConfirmed: true,
    });
    expect(() =>
      repository.recordOwnerApprovalReceipt({
        capability: approved,
        gateProof: fictionalGateProof("SOURCE_CAPABILITY_APPROVE", instant.toISOString()),
        ownerConfirmed: true,
      }),
    ).toThrow("SOURCE_OWNER_APPROVAL_ALREADY_ACTIVE");
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_owner_action_receipts").get(),
    ).toEqual({ count: 1 });
    expect(repository.getOwnerApprovalStatus(approved)).toMatchObject({
      state: "CURRENT",
      receiptId: approval.id,
      canStart: true,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
      count: 0,
    });

    const chain = repository.createOwnerStartReceipt({
      capability: approved,
      operation: "LIST_JOBS",
      gateProof: fictionalGateProof("SOURCE_RUN_START", instant.toISOString()),
      ownerConfirmed: true,
    });
    expect(chain.approvalReceiptId).toBe(approval.id);
    expect(repository.getOwnerApprovalStatus(approved).state).toBe("CONSUMED");
    expect(
      sqlite
        .prepare(
          "SELECT state,operation,predecessor_receipt_id FROM source_owner_action_receipts WHERE id=?",
        )
        .get(chain.startReceiptId),
    ).toEqual({
      state: "ACTIVE",
      operation: "LIST_JOBS",
      predecessor_receipt_id: approval.id,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
      count: 0,
    });

    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => {
        expect(
          sqlite.prepare("SELECT count(*) AS count FROM source_run_owner_bindings").get(),
        ).toEqual({ count: 1 });
        return ["8.8.8.8"];
      }),
      request: vi.fn(async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from("[]"),
        connectedAddress: pinnedAddress,
      })),
    };
    const result = await runLeverSourceToQueueWithOwnerReceipts({
      capability: approved,
      repository,
      ownerReceiptChain: chain,
      now: () => instant,
      dependencies,
      evaluateJob: async () => null,
      queueJob: () => undefined,
    });
    expect(result.status).toBe("COMPLETE");
    expect(dependencies.resolveHost).toHaveBeenCalledTimes(1);
    expect(dependencies.request).toHaveBeenCalledTimes(1);
    expect(repository.getRunOwnerProvenance(result.runId)).toBe("OWNER_RECEIPTS_BOUND");
    expect(
      sqlite
        .prepare(
          `SELECT approval_receipt_id AS approvalReceiptId,start_receipt_id AS startReceiptId,
                  capability_digest AS capabilityDigest,operation
           FROM source_run_owner_bindings WHERE run_id=?`,
        )
        .get(result.runId),
    ).toEqual({
      approvalReceiptId: approval.id,
      startReceiptId: chain.startReceiptId,
      capabilityDigest: sourceCapabilityDigest(approved),
      operation: "LIST_JOBS",
    });
    expect(
      sqlite
        .prepare("SELECT action,state,consumed_at FROM source_owner_action_receipts ORDER BY rowid")
        .all(),
    ).toEqual([
      { action: "APPROVE", state: "CONSUMED", consumed_at: instant.toISOString() },
      { action: "START", state: "CONSUMED", consumed_at: instant.toISOString() },
    ]);
    const persistedSafeText = JSON.stringify({
      receipts: sqlite.prepare("SELECT * FROM source_owner_action_receipts").all(),
      audit: sqlite
        .prepare(
          "SELECT redacted_metadata_json FROM audit_events WHERE event_type LIKE 'source.owner.%' OR event_type='source.run.owner-bound'",
        )
        .all(),
    });
    for (const privateSentinel of [
      "nonce-private-sentinel",
      "session-private-sentinel",
      `APPROVE ${approved.capabilityId}`,
      `RUN ${approved.capabilityId}`,
    ]) {
      expect(persistedSafeText).not.toContain(privateSentinel);
    }

    await expect(
      runLeverSourceToQueueWithOwnerReceipts({
        capability: approved,
        repository,
        ownerReceiptChain: chain,
        now: () => instant,
        dependencies,
        evaluateJob: async () => null,
        queueJob: () => undefined,
      }),
    ).rejects.toThrow("SOURCE_OWNER_RECEIPT_CHAIN_INVALID");
    expect(dependencies.resolveHost).toHaveBeenCalledTimes(1);
    expect(dependencies.request).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
      count: 1,
    });
    sqlite.close();
  });

  it("terminalizes expired owner approvals and superseded capability approvals", () => {
    const sqlite = database();
    let now = instant;
    let id = 0;
    const repository = new SourceEnablementRepository(
      sqlite,
      () => now,
      () => `owner-state:${++id}`,
    );
    const approved = capability();
    repository.persistCapabilityVersion(approved);
    const approval = repository.recordOwnerApprovalReceipt({
      capability: approved,
      gateProof: fictionalGateProof("SOURCE_CAPABILITY_APPROVE", now.toISOString()),
      ownerConfirmed: true,
    });

    now = new Date("2026-10-02T00:00:00.000Z");
    expect(repository.getOwnerApprovalStatus(approved)).toMatchObject({
      state: "EXPIRED",
      receiptId: approval.id,
      canStart: false,
    });
    expect(
      sqlite.prepare("SELECT state FROM source_owner_action_receipts WHERE id=?").get(approval.id),
    ).toEqual({ state: "EXPIRED" });

    now = instant;
    const secondCapability = capability({
      capabilityId: "source-second-owner-state",
      tenant: "second-owner-state",
      allowedHost: "api.lever.co",
      allowedPathPrefix: "/v0/postings/second-owner-state",
    });
    repository.persistCapabilityVersion(secondCapability);
    const secondApproval = repository.recordOwnerApprovalReceipt({
      capability: secondCapability,
      gateProof: fictionalGateProof("SOURCE_CAPABILITY_APPROVE", now.toISOString()),
      ownerConfirmed: true,
    });
    repository.persistCapabilityVersion(
      capability({
        capabilityId: secondCapability.capabilityId,
        tenant: secondCapability.tenant,
        allowedPathPrefix: secondCapability.allowedPathPrefix,
        version: 2,
        predecessorVersion: 1,
        approvalState: "REVOKED",
        approvalReference: null,
        approvedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        revokedAt: now.toISOString(),
        revocationReason: "OWNER_REVOKED",
      }),
    );
    expect(repository.getOwnerApprovalStatus(secondCapability).state).toBe("SUPERSEDED");
    expect(
      sqlite
        .prepare("SELECT state FROM source_owner_action_receipts WHERE id=?")
        .get(secondApproval.id),
    ).toEqual({ state: "REVOKED" });
    sqlite.close();
  });

  it("fails closed before DNS for mismatched or replayed receipt identities", async () => {
    const receiptMutations: Array<[string, string, string | number]> = [
      ["wrong version", "capability_version", 2],
      ["wrong digest", "capability_digest", "f".repeat(64)],
      ["wrong reference", "approval_reference", "different-reference"],
      ["wrong source", "source", "GREENHOUSE"],
      ["wrong tenant", "tenant", "different-tenant"],
      ["wrong capability ID", "capability_id", "different-capability"],
      ["wrong operation", "operation", "GET_JOB"],
      ["wrong policy", "policy_version", "different-policy"],
      ["wrong policy expiry", "policy_expires_at", "2026-09-30T00:00:00.000Z"],
      ["wrong capability expiry", "capability_expires_at", "2026-09-30T00:00:00.000Z"],
      ["expired start receipt", "receipt_expires_at", "2026-09-09T23:59:59.000Z"],
    ];
    for (const [name, column, value] of receiptMutations) {
      const sqlite = database();
      let id = 0;
      const approved = capability({
        allowedOperations: ["LIST_JOBS", "GET_JOB"],
        requestBudget: 1,
        recordCap: 1,
        pageSizeCap: 1,
      });
      const repository = new SourceEnablementRepository(
        sqlite,
        () => instant,
        () => `owner-mismatch:${++id}`,
      );
      const chain = fictionalOwnerReceiptChain(repository, approved, "LIST_JOBS");
      sqlite
        .prepare(`UPDATE source_owner_action_receipts SET ${column}=? WHERE id=?`)
        .run(value, chain.startReceiptId);
      const dependencies: SecureSourceTransportDependencies = {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async () => {
          throw new Error("UNEXPECTED_TRANSPORT");
        }),
      };
      await expect(
        runLeverSourceToQueueWithOwnerReceipts({
          capability: approved,
          repository,
          ownerReceiptChain: chain,
          now: () => instant,
          dependencies,
          evaluateJob: async () => null,
          queueJob: () => undefined,
        }),
        name,
      ).rejects.toThrow();
      expect(dependencies.resolveHost, name).not.toHaveBeenCalled();
      expect(dependencies.request, name).not.toHaveBeenCalled();
      expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
        count: 0,
      });
      expect(
        sqlite
          .prepare("SELECT state FROM source_owner_action_receipts WHERE id=?")
          .get(chain.startReceiptId),
      ).toEqual({ state: "FAILED" });
      sqlite.close();
    }

    for (const expiredSnapshot of [
      { policyExpiresAt: "2026-09-10T00:01:00.000Z" },
      { capabilityExpiresAt: "2026-09-10T00:01:00.000Z" },
    ]) {
      const sqlite = database();
      let id = 0;
      const approved = capability({
        requestBudget: 1,
        recordCap: 1,
        pageSizeCap: 1,
        ...expiredSnapshot,
      });
      const repository = new SourceEnablementRepository(
        sqlite,
        () => instant,
        () => `owner-expiry:${++id}`,
      );
      const chain = fictionalOwnerReceiptChain(repository, approved, "LIST_JOBS");
      const dependencies: SecureSourceTransportDependencies = {
        resolveHost: vi.fn(async () => ["8.8.8.8"]),
        request: vi.fn(async () => {
          throw new Error("UNEXPECTED_TRANSPORT");
        }),
      };
      await expect(
        runLeverSourceToQueueWithOwnerReceipts({
          capability: approved,
          repository,
          ownerReceiptChain: chain,
          now: () => new Date("2026-09-10T00:02:00.000Z"),
          dependencies,
          evaluateJob: async () => null,
          queueJob: () => undefined,
        }),
      ).rejects.toThrow();
      expect(dependencies.resolveHost).not.toHaveBeenCalled();
      expect(dependencies.request).not.toHaveBeenCalled();
      expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
        count: 0,
      });
      sqlite.close();
    }
  });

  it("rejects missing receipt links, invalid local gate proof, reused approval, and revoked capability before transport", async () => {
    const sqlite = database();
    let id = 0;
    const approved = capability({ requestBudget: 1, recordCap: 1, pageSizeCap: 1 });
    const repository = new SourceEnablementRepository(
      sqlite,
      () => instant,
      () => `owner-denied:${++id}`,
    );
    repository.persistCapabilityVersion(approved);
    expect(() =>
      repository.recordOwnerApprovalReceipt({
        capability: approved,
        gateProof: {
          ...fictionalGateProof("SOURCE_CAPABILITY_APPROVE", instant.toISOString()),
          nonceConsumed: false,
        } as never,
        ownerConfirmed: true,
      }),
    ).toThrow("LOCAL_MUTATION_GATE_REQUIRED");
    expect(() =>
      repository.recordOwnerApprovalReceipt({
        capability: approved,
        gateProof: fictionalGateProof("SOURCE_CAPABILITY_APPROVE", instant.toISOString()),
        ownerConfirmed: false as never,
      }),
    ).toThrow("EXACT_OWNER_CONFIRMATION_REQUIRED");
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM source_owner_action_receipts").get(),
    ).toEqual({
      count: 0,
    });

    const chain = fictionalOwnerReceiptChain(repository, approved, "LIST_JOBS");
    expect(() =>
      repository.createOwnerStartReceipt({
        capability: approved,
        operation: "LIST_JOBS",
        gateProof: fictionalGateProof("SOURCE_RUN_START", instant.toISOString()),
        ownerConfirmed: true,
      }),
    ).toThrow("SOURCE_OWNER_APPROVAL_REQUIRED");
    const dependencies: SecureSourceTransportDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      request: vi.fn(async () => {
        throw new Error("UNEXPECTED_TRANSPORT");
      }),
    };
    for (const ownerReceiptChain of [
      { ...chain, approvalReceiptId: "missing-approval" },
      { ...chain, startReceiptId: "missing-start" },
    ]) {
      await expect(
        runLeverSourceToQueueWithOwnerReceipts({
          capability: approved,
          repository,
          ownerReceiptChain,
          now: () => instant,
          dependencies,
          evaluateJob: async () => null,
          queueJob: () => undefined,
        }),
      ).rejects.toThrow();
    }
    expect(dependencies.resolveHost).not.toHaveBeenCalled();
    expect(dependencies.request).not.toHaveBeenCalled();

    const revoked = capability({
      version: 2,
      predecessorVersion: 1,
      approvalState: "REVOKED",
      approvalReference: null,
      approvedAt: null,
      createdAt: instant.toISOString(),
      updatedAt: instant.toISOString(),
      revokedAt: instant.toISOString(),
      revocationReason: "OWNER_REVOKED",
    });
    repository.persistCapabilityVersion(revoked);
    await expect(
      runLeverSourceToQueueWithOwnerReceipts({
        capability: approved,
        repository,
        ownerReceiptChain: chain,
        now: () => instant,
        dependencies,
        evaluateJob: async () => null,
        queueJob: () => undefined,
      }),
    ).rejects.toThrow("CAPABILITY_CHANGED");
    expect(dependencies.resolveHost).not.toHaveBeenCalled();
    expect(dependencies.request).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT count(*) AS count FROM source_run_checkpoints").get()).toEqual({
      count: 0,
    });
    sqlite.close();
  });
});
