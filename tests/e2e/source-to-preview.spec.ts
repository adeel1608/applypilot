import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { expect, test } from "@playwright/test";

import {
  ApplicationPacketSchema,
  PROPOSED_LOCAL_VERIFICATION_POLICY,
  InMemoryNonSubmitDurableStore,
  LoopbackNonSubmitAdapter,
  TargetIndependentNonSubmitRunner,
  RunnerTargetCapabilitySchema,
  assessVerificationFreshness,
  packetDigest,
  runnerBindingDigest,
  freezeRunnerBinding,
  type RunnerTargetCapability,
  type NonSubmitDurableSnapshot,
  type NonSubmitDurableStore,
  type RunnerTargetOperation,
} from "@applypilot/application-runner";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import {
  BetaRepository,
  R2ARepository,
  R2Repository,
  SourceEnablementRepository,
  SqliteNonSubmitRunStore,
  runLeverSourceToQueue,
} from "@applypilot/database";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import {
  SourceCapabilityV2Schema,
  type SecureSourceTransportDependencies,
  type SourceCapabilityV2,
} from "@applypilot/job-sources";
import { testProfile } from "../fixture-data";

const fixedNow = new Date("2026-09-22T00:00:00.000Z");

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
] as const;

async function createDiskFixture() {
  const root = await mkdtemp(join(tmpdir(), "applypilot-r46-07-"));
  const databaseRoot = join(root, "database");
  const documentsRoot = join(root, "documents");
  const reportsRoot = join(root, "reports");
  await Promise.all([mkdir(databaseRoot), mkdir(documentsRoot), mkdir(reportsRoot)]);
  const databasePath = join(databaseRoot, "fixture.sqlite");
  if (
    !databasePath.startsWith(root) ||
    !documentsRoot.startsWith(root) ||
    !reportsRoot.startsWith(root)
  ) {
    throw new Error("R46_07_DISPOSABLE_ROOT_INVALID");
  }
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  for (const name of migrationNames) {
    sqlite.exec(
      await readFile(join(process.cwd(), "packages", "database", "drizzle", name), "utf8"),
    );
  }
  if (sqlite.pragma("user_version", { simple: true }) !== 10) {
    throw new Error("R46_07_SCHEMA10_REQUIRED");
  }
  return { root, databasePath, documentsRoot, reportsRoot, sqlite };
}

function installFixtureProfile(sqlite: BetterSqlite3.Database) {
  const profile = CandidateProfileSchema.parse({
    ...testProfile,
    profileId: "profile:r46-07-fictional",
    workRights: {
      ...testProfile.workRights,
      value: {
        ...testProfile.workRights.value,
        hoursLimitTimeBasis: {
          kind: "CURRENT",
          asOf: "2026-09-01",
          validThrough: "2026-12-31",
          verification: "VERIFIED",
        },
      },
    },
  });
  const now = fixedNow.toISOString();
  sqlite
    .prepare(
      `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(profile.profileId, "profile-version:r46-07-fictional", now, now);
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions
       (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
       VALUES (?, ?, 1, 1, ?, ?, ?)`,
    )
    .run(
      "profile-version:r46-07-fictional",
      profile.profileId,
      JSON.stringify(profile),
      candidateProfileContentHash(profile),
      now,
    );
  return { profile, profileVersionId: "profile-version:r46-07-fictional" };
}

function fixtureCapability(): SourceCapabilityV2 {
  return SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "source-r46-07-fictional",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional Melbourne Services",
    tenant: "fictional-r46-07",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional-r46-07",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "R46-07-OFFLINE-FIXTURE",
    approvedAt: "2026-09-01T00:00:00.000Z",
    policyVersion: "r46-07-fictional-policy-v1",
    policyReviewedAt: "2026-09-01T00:00:00.000Z",
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 1,
    pageSizeCap: 1,
    responseByteLimit: 2_000_000,
    requestTimeoutMs: 30_000,
    runTimeoutMs: 60_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2:r46-07-fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null,
    revocationReason: null,
  });
}

function fictionalPosting() {
  const descriptionPlain = `Fictional role overview with training and mentoring.
Hours
18 hours per week
Roster
Fixed Monday-Friday 09:00-13:00 AEST`;
  return {
    id: "fictional-r46-07-job",
    text: "Fictional Customer Experience Assistant",
    hostedUrl: "https://jobs.lever.co/fictional-r46-07/fictional-r46-07-job",
    applyUrl: "https://jobs.lever.co/fictional-r46-07/fictional-r46-07-job/apply",
    descriptionPlain,
    categories: {
      location: "Melbourne VIC 3000",
      allLocations: ["Melbourne VIC 3000"],
      commitment: "Part-time",
      department: "Fictional Operations",
    },
    country: "AU",
    workplaceType: "on-site",
    lists: [
      {
        text: "Requirements",
        content:
          "<ul><li>Customer service experience required</li><li>Communication skills required</li><li>Teamwork required</li><li>No experience necessary</li><li>No degree required</li><li>No licence required</li><li>No certification required</li><li>Unrestricted work rights not required</li><li>Vehicle not required</li><li>CV required</li></ul>",
      },
      { text: "Benefits", content: "<p>Fictional mentoring.</p>" },
    ],
    createdAt: 1788998400000,
  };
}

function fictionalTransport(body: unknown, counters: { dns: number; requests: number }) {
  const dependencies: SecureSourceTransportDependencies = {
    resolveHost: async () => {
      counters.dns += 1;
      return ["8.8.8.8"];
    },
    request: async ({ pinnedAddress }) => {
      counters.requests += 1;
      return {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(body)),
        connectedAddress: pinnedAddress,
      };
    },
  };
  return dependencies;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixtureServer(): Promise<{
  server: Server;
  targetUrl: string;
  counts: { uploads: number; submissions: number };
}> {
  const counts = { uploads: 0, submissions: 0 };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/apply") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html>
          <form data-form-version="fixture-form-v1">
            <input data-question-id="fictional-answer" />
            <input type="file" data-document-id="doc:fictional" />
            <button type="button" data-action="upload">Upload fictional document</button>
            <output data-upload-ack hidden></output>
          </form>
          <script>
            document.querySelector('[data-action=upload]').addEventListener('click', async () => {
              const file = document.querySelector('[data-document-id="doc:fictional"]').files[0];
              const response = await fetch('/__fixture_upload', { method: 'POST', body: await file.arrayBuffer() });
              const payload = await response.json();
              const output = document.querySelector('[data-upload-ack]');
              output.hidden = false;
              output.dataset.uploadAck = payload.acknowledgementId;
              output.dataset.receivedDigest = payload.receivedDigest;
            });
          </script>`);
        return;
      }
      if (request.method === "POST" && request.url === "/__fixture_upload") {
        counts.uploads += 1;
        const receivedDigest = sha256(Buffer.concat(chunks));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ acknowledgementId: `ack-${counts.uploads}`, receivedDigest }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/submit") {
        counts.submissions += 1;
        response.writeHead(200);
        response.end("forbidden");
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_ADDRESS_REQUIRED");
  return { server, targetUrl: `http://127.0.0.1:${address.port}/apply`, counts };
}

function capability(targetUrl: string): RunnerTargetCapability {
  const target = new URL(targetUrl);
  return RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: "runner:offline-source-preview",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local target",
    allowedOrigin: target.origin,
    allowedPathPrefix: "/apply",
    formVersion: "fixture-form-v1",
    adapterVersion: "loopback-non-submit-v1",
    allowedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"],
    approvalState: "APPROVED",
    approvalReference: "OFFLINE_FIXTURE_APPROVAL",
    approvedAt: "2026-09-21T00:00:00.000Z",
    policyVersion: "offline-fixture-v1",
    policyExpiresAt: "2026-09-30T00:00:00.000Z",
    capabilityExpiresAt: "2026-09-30T00:00:00.000Z",
    revokedAt: null,
  });
}

class FailOnceAfterUploadCheckpointStore implements NonSubmitDurableStore {
  private failed = false;

  constructor(private readonly delegate: NonSubmitDurableStore) {}

  load(bindingDigest: string): NonSubmitDurableSnapshot | null {
    return this.delegate.load(bindingDigest);
  }

  claim(bindingDigest: string, operation: RunnerTargetOperation): boolean {
    return this.delegate.claim(bindingDigest, operation);
  }

  save(bindingDigest: string, snapshot: NonSubmitDurableSnapshot): void {
    if (!this.failed && snapshot.state === "UPLOADED") {
      this.failed = true;
      throw new Error("R46_07_CHECKPOINT_INTERRUPTED_AFTER_UPLOAD");
    }
    this.delegate.save(bindingDigest, snapshot);
  }
}

test("proves fictional source-ledger-R2 packet to browser preview without submit", async ({
  browser,
}) => {
  const { server, targetUrl, counts } = await fixtureServer();
  const documentBytes = Buffer.from("fictional approved CV bytes");
  const documentDigest = sha256(documentBytes);
  const target = capability(targetUrl);
  const packet = ApplicationPacketSchema.parse({
    id: "packet:offline-source-preview",
    jobId: "job:fictional-source",
    jobVersionId: "job-version:fictional-source:1",
    profileVersionId: "profile-version:fictional:1",
    evaluationVersionId: "evaluation:fictional:r2:1",
    r2EvaluationId: "r2:fictional:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl,
    targetHost: new URL(targetUrl).hostname,
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "doc:fictional",
        type: "CV",
        fileName: "fictional.pdf",
        digest: documentDigest,
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "fictional-answer",
        questionText: "Fictional verified answer",
        required: true,
        sensitive: false,
        value: "fictional-value",
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:fictional"],
      },
    ],
  });

  // The preceding source/ledger/R2 stages are intentionally value-free fixture
  // evidence. The packet binds those current versions before the browser lane.
  const sourceLedgerEvidence = {
    source: "LEVER",
    externalId: "fictional-source-job-1",
    qualificationState: "QUALIFIED",
    r2EvaluationId: packet.r2EvaluationId,
  };
  expect(sourceLedgerEvidence.qualificationState).toBe("QUALIFIED");
  expect(packet.r2EvaluationId).toBe("r2:fictional:1");

  const binding = freezeRunnerBinding(packet, target);
  const store = new InMemoryNonSubmitDurableStore();
  const adapter = new LoopbackNonSubmitAdapter({
    browser,
    documentBytes: { [documentDigest]: documentBytes },
    operationKey: "offline-source-preview",
  });
  try {
    const runner = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect((await runner.map()).state).toBe("MAPPED");
    expect((await runner.fill()).state).toBe("FILLED");
    const uploaded = await runner.upload();
    expect(uploaded.uploadEvidence?.receivedDigest).toBe(documentDigest);
    expect((await runner.verify()).fieldReadBack).toEqual([
      { questionId: "fictional-answer", value: "fictional-value" },
    ]);
    const preview = await runner.fillPreview();
    expect(preview.state).toBe("FILL_PREVIEW");
    expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(counts).toEqual({ uploads: 1, submissions: 0 });

    const restarted = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect(restarted.snapshot()).toMatchObject({ state: "FILL_PREVIEW", submitEnabled: false });
    expect((restarted as unknown as { submit?: unknown }).submit).toBeUndefined();
    expect(counts).toEqual({ uploads: 1, submissions: 0 });
  } finally {
    await adapter.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("stops after an accepted upload when checkpoint persistence is interrupted", async ({
  browser,
}) => {
  const { server, targetUrl, counts } = await fixtureServer();
  const documentBytes = Buffer.from("fictional interrupted-upload bytes");
  const documentDigest = sha256(documentBytes);
  const target = capability(targetUrl);
  const packet = ApplicationPacketSchema.parse({
    id: "packet:offline-upload-uncertain",
    jobId: "job:fictional-upload-uncertain",
    jobVersionId: "job-version:fictional-upload-uncertain:1",
    profileVersionId: "profile-version:fictional-upload-uncertain:1",
    evaluationVersionId: "evaluation:fictional-upload-uncertain:1",
    r2EvaluationId: "r2:fictional-upload-uncertain:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl,
    targetHost: new URL(targetUrl).hostname,
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "doc:fictional",
        type: "CV",
        fileName: "fictional-upload-uncertain.pdf",
        digest: documentDigest,
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "fictional-answer",
        questionText: "Fictional verified answer",
        required: true,
        sensitive: false,
        value: "fictional-value",
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:fictional-upload-uncertain"],
      },
    ],
  });
  const binding = freezeRunnerBinding(packet, target);
  const store = new FailOnceAfterUploadCheckpointStore(new InMemoryNonSubmitDurableStore());
  const adapter = new LoopbackNonSubmitAdapter({
    browser,
    documentBytes: { [documentDigest]: documentBytes },
    operationKey: "offline-upload-uncertain",
  });
  try {
    const runner = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect((await runner.map()).state).toBe("MAPPED");
    expect((await runner.fill()).state).toBe("FILLED");
    expect(await runner.upload()).toMatchObject({
      state: "PAUSED",
      stopReason: "UPLOAD_OUTCOME_UNKNOWN",
    });
    expect(counts).toEqual({ uploads: 1, submissions: 0 });
    const restarted = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect(restarted.snapshot()).toMatchObject({ state: "PAUSED", submitEnabled: false });
    await expect(restarted.upload()).rejects.toThrow("RUN_PAUSED");
    expect(counts).toEqual({ uploads: 1, submissions: 0 });
  } finally {
    await adapter.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test.describe.configure({ retries: 0 });

test("persists source verification through canonical R2 and packet services to a SQLite-backed browser preview without submit", async ({
  browser,
}) => {
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const fixture = await createDiskFixture();
    const { server, targetUrl, counts } = await fixtureServer();
    const transportCounts = { dns: 0, requests: 0 };
    let sqlite = fixture.sqlite;
    try {
      const { profile, profileVersionId } = installFixtureProfile(sqlite);
      const capabilityValue = fixtureCapability();
      let nextSourceId = 0;
      let nextR2Id = 0;
      const source = new SourceEnablementRepository(
        sqlite,
        () => fixedNow,
        () => `source-r46-07:${++nextSourceId}`,
      );
      expect(source.persistCapabilityVersion(capabilityValue)).toMatchObject({ created: true });
      const r2 = new R2Repository(
        sqlite,
        () => fixedNow,
        () => `r2-r46-07:${++nextR2Id}`,
      );
      const evaluated: string[] = [];
      const queued: string[] = [];
      const evaluateJob = async (jobId: string): Promise<string> => {
        evaluated.push(jobId);
        const current = sqlite
          .prepare(
            `SELECT j.normalized_json AS normalizedJson, v.id AS jobVersionId
             FROM jobs j JOIN job_versions v ON v.id=(SELECT id FROM job_versions
               WHERE job_id=j.id ORDER BY version DESC LIMIT 1) WHERE j.id=?`,
          )
          .get(jobId) as { normalizedJson: string; jobVersionId: string } | undefined;
        if (!current) throw new Error("R46_07_JOB_VERSION_REQUIRED");
        const normalization = new R2ARepository(sqlite).getNormalization(current.jobVersionId);
        if (!normalization) throw new Error("R46_07_NORMALIZATION_REQUIRED");
        const evaluationId = `r2:r46-07:${jobId}`;
        const eligibility = evaluateR2Eligibility({
          profile,
          normalization,
          bindings: {
            jobVersionId: current.jobVersionId,
            currentJobVersionId: current.jobVersionId,
            profileVersionId,
            currentProfileVersionId: profileVersionId,
            evidenceContractVersion: normalization.evidenceContractVersion,
            currentEvidenceContractVersion: normalization.evidenceContractVersion,
            evaluationVersionId: evaluationId,
          },
          evaluatedAt: fixedNow.toISOString(),
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
          profileVersionId,
          normalization,
          eligibility,
          fit,
        }).id;
      };
      const queueJob = (jobId: string, evaluationId: string) => {
        r2.recordQueueDecision({
          jobId,
          state: "REVIEWING",
          r2EvaluationId: evaluationId,
          duplicateResolutionVersion: r2.duplicateResolutionVersion(jobId),
          actor: "SYSTEM",
          reasonCode: "SOURCE_R2_READY",
        });
        queued.push(jobId);
      };
      const first = await runLeverSourceToQueue({
        capability: capabilityValue,
        repository: source,
        now: () => fixedNow,
        dependencies: fictionalTransport([fictionalPosting()], transportCounts),
        evaluateJob,
        queueJob,
      });
      expect(first.status, first.stopCode ?? "no stop").toBe("COMPLETE");
      expect(first).toMatchObject({
        providerRecordCount: 1,
        acceptedRecordCount: 1,
        unusableRecordCount: 0,
      });
      expect(transportCounts).toEqual({ dns: 1, requests: 1 });
      expect(evaluated).toHaveLength(1);
      expect(queued).toHaveLength(1);

      const second = await runLeverSourceToQueue({
        capability: capabilityValue,
        repository: source,
        now: () => fixedNow,
        dependencies: fictionalTransport([fictionalPosting()], transportCounts),
        evaluateJob,
        queueJob,
      });
      expect(second.status, second.stopCode ?? "no stop").toBe("COMPLETE");
      expect(second.queuedJobIds).toEqual([]);
      expect(transportCounts).toEqual({ dns: 2, requests: 2 });
      expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
        count: 1,
      });
      expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
        count: 1,
      });
      expect(sqlite.prepare("SELECT count(*) AS count FROM r2_evaluation_versions").get()).toEqual({
        count: 1,
      });
      expect(
        sqlite
          .prepare(
            `SELECT count(*) AS count FROM source_record_verifications
           WHERE qualification_state='QUALIFIED' AND disposition='ACCEPTED'`,
          )
          .get(),
      ).toEqual({ count: 2 });

      const lineage = sqlite
        .prepare(
          `SELECT o.id AS observationId, v.id AS verificationId, v.content_hash AS contentHash,
                  jv.id AS jobVersionId, e.id AS r2EvaluationId,
                  o.expires_at AS providerExpiresAt, v.verified_at AS verifiedAt,
                  e.job_id AS jobId
           FROM source_observations o
           JOIN source_record_verifications v ON v.source_observation_id=o.id
           JOIN job_versions jv ON jv.id=v.job_version_id
           JOIN r2_evaluation_versions e ON e.job_version_id=jv.id
           WHERE v.qualification_state='QUALIFIED' AND v.disposition='ACCEPTED'
           ORDER BY v.created_at LIMIT 1`,
        )
        .get() as
        | {
            observationId: string;
            verificationId: string;
            contentHash: string;
            jobVersionId: string;
            r2EvaluationId: string;
            providerExpiresAt: string | null;
            verifiedAt: string;
            jobId: string;
          }
        | undefined;
      if (!lineage) throw new Error("R46_07_LINEAGE_REQUIRED");
      expect(lineage.providerExpiresAt).toBeNull();
      expect(lineage.contentHash).toMatch(/^[a-f0-9]{64}$/);
      const r2State = sqlite
        .prepare(
          `SELECT profile_version_id AS profileVersionId, eligibility_status AS eligibilityStatus,
                  recommended, stale FROM r2_evaluation_versions WHERE id=?`,
        )
        .get(lineage.r2EvaluationId) as {
        profileVersionId: string;
        eligibilityStatus: string;
        recommended: number;
        stale: number;
      };
      expect(r2State).toMatchObject({
        profileVersionId,
        eligibilityStatus: "ELIGIBLE",
        recommended: 1,
        stale: 0,
      });
      r2.recordQueueDecision({
        jobId: lineage.jobId,
        state: "PREPARING",
        r2EvaluationId: lineage.r2EvaluationId,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(lineage.jobId),
        actor: "OWNER",
        reasonCode: "OWNER_PREPARING",
      });
      r2.assertCurrentPreparing(lineage.jobId, lineage.r2EvaluationId);

      let nextBetaId = 0;
      const beta = new BetaRepository(
        sqlite,
        () => fixedNow,
        () => `beta-r46-07:${++nextBetaId}`,
      );
      const legacyEvaluationId = beta.recordEvaluationVersion({
        id: `evaluation-compat:r46-07:${repetition}`,
        jobId: lineage.jobId,
        jobVersionId: lineage.jobVersionId,
        profileVersionId,
        evaluationContext: "PRIVATE_LOCAL_PROFILE",
        eligibilityStatus: "ELIGIBLE",
        eligibilityReasons: [],
        fitScore: 80,
        fitContributions: [],
        coverage: {
          known: 17,
          unknown: 0,
          ambiguous: 0,
          notApplicable: 0,
          percent: 100,
          confidence: "HIGH",
          missingDimensions: [],
        },
        eligibilityEngineVersion: "r46-07-compatibility",
        fitEngineVersion: "r46-07-compatibility",
        weightVersion: "r46-07-compatibility",
      });
      const freshness = assessVerificationFreshness({
        verifiedAt: lineage.verifiedAt,
        evidenceQualified: true,
        providerExpiresAt: lineage.providerExpiresAt,
        operation: "PREPARATION",
        policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
        now: fixedNow,
      });
      expect(freshness).toMatchObject({ state: "FRESH", providerExpiry: "UNKNOWN" });
      const documentBytes = Buffer.from(`fictional-r46-07-document-${repetition}`);
      const documentDigest = sha256(documentBytes);
      const documentId = "doc:fictional";
      const documentPath = join(fixture.documentsRoot, "fictional-r46-07.pdf");
      await writeFile(documentPath, documentBytes);
      beta.recordDocumentArtifact({
        id: documentId,
        jobId: lineage.jobId,
        jobVersionId: lineage.jobVersionId,
        profileVersionId,
        type: "CV",
        template: "fictional-r46-07",
        format: "PDF",
        fileName: "fictional-r46-07.pdf",
        localPath: documentPath,
        contentDigest: documentDigest,
        claimEvidence: ["fictional:source-bound"],
        layoutResult: { pageCount: 1 },
      });
      beta.approveDocument({ documentArtifactId: documentId, contentDigest: documentDigest });
      const packet = ApplicationPacketSchema.parse({
        id: `packet:r46-07:${repetition}`,
        jobId: lineage.jobId,
        jobVersionId: lineage.jobVersionId,
        profileVersionId,
        evaluationVersionId: legacyEvaluationId,
        r2EvaluationId: lineage.r2EvaluationId,
        verificationEvidence: {
          verificationId: lineage.verificationId,
          verifiedAt: lineage.verifiedAt,
          providerExpiresAt: null,
          policyVersion: PROPOSED_LOCAL_VERIFICATION_POLICY.version,
          preparationMaxAgeMs: PROPOSED_LOCAL_VERIFICATION_POLICY.preparationMaxAgeMs,
          preExternalActionMaxAgeMs: PROPOSED_LOCAL_VERIFICATION_POLICY.preExternalActionMaxAgeMs,
          validUntil: freshness.validUntil,
          operation: "PREPARATION",
          contentHash: lineage.contentHash,
        },
        eligibilityStatus: "ELIGIBLE",
        targetUrl,
        targetHost: new URL(targetUrl).hostname,
        // This local preparation state is derived from qualified verification freshness;
        // provider expiry remains UNKNOWN (providerExpiresAt=null) and is never invented.
        jobExpiryState: freshness.state === "FRESH" ? "ACTIVE" : "UNKNOWN",
        duplicateState: "CLEAR",
        versionsCurrent: true,
        documents: [
          {
            id: documentId,
            type: "CV",
            fileName: "fictional-r46-07.pdf",
            digest: documentDigest,
            approved: true,
            stale: false,
            required: true,
          },
        ],
        answers: [
          {
            questionId: "fictional-answer",
            questionText: "Fictional verified answer",
            required: true,
            sensitive: false,
            value: "fictional-value",
            truthState: "VERIFIED_ANSWER",
            disclosureState: "APPROVED",
            factReferences: ["fact:fictional-r46-07"],
          },
        ],
      });
      expect(beta.persistApplicationPacket(packet)).toMatchObject({
        packetId: packet.id,
        status: "READY_TO_APPLY",
      });
      const persistedPacketDigest = packetDigest(packet);
      const runId = beta.registerApplicationRun({
        packetId: packet.id,
        targetKind: "SYNTHETIC_LOCAL",
        targetHost: new URL(targetUrl).hostname,
        formVersion: "fixture-form-v1",
      });
      const target = capability(targetUrl);
      const binding = freezeRunnerBinding(packet, target);
      const bindingDigest = runnerBindingDigest(binding);
      const store = new SqliteNonSubmitRunStore(
        sqlite,
        runId,
        persistedPacketDigest,
        () => fixedNow,
      );
      const currentBinding = () => {
        r2.assertCurrentPreparing(lineage.jobId, lineage.r2EvaluationId);
        const currentDocument = sqlite
          .prepare(
            `SELECT d.content_digest AS digest, d.stale, a.invalidated_at AS invalidatedAt
           FROM document_artifacts d LEFT JOIN document_approvals a
           ON a.document_artifact_id=d.id AND a.content_digest=d.content_digest
           WHERE d.id=? ORDER BY a.approved_at DESC LIMIT 1`,
          )
          .get(documentId) as
          | { digest: string; stale: number; invalidatedAt: string | null }
          | undefined;
        if (
          !currentDocument ||
          currentDocument.digest !== documentDigest ||
          currentDocument.stale !== 0 ||
          currentDocument.invalidatedAt
        )
          throw new Error("R46_07_DOCUMENT_CURRENTNESS_REQUIRED");
        return freezeRunnerBinding(packet, target);
      };
      const adapter = new LoopbackNonSubmitAdapter({
        browser,
        documentBytes: { [documentDigest]: documentBytes },
        operationKey: `r46-07-${repetition}`,
      });
      const runner = new TargetIndependentNonSubmitRunner(
        packet,
        target,
        binding,
        adapter,
        currentBinding,
        () => fixedNow,
        store,
      );
      expect((await runner.map()).state).toBe("MAPPED");
      expect((await runner.fill()).state).toBe("FILLED");
      const uploadCheckpoint = await runner.upload();
      expect(uploadCheckpoint.uploadEvidence?.receivedDigest).toBe(documentDigest);
      expect((await runner.verify()).fieldReadBack).toEqual([
        { questionId: "fictional-answer", value: "fictional-value" },
      ]);
      const preview = await runner.fillPreview();
      expect(preview.state).toBe("FILL_PREVIEW");
      expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(counts).toEqual({ uploads: 1, submissions: 0 });
      expect(
        sqlite.prepare("SELECT count(*) AS count FROM application_run_operations").get(),
      ).toEqual({ count: 5 });
      expect(
        sqlite
          .prepare(
            "SELECT packet_digest AS packetDigest, preview_digest AS previewDigest FROM application_run_previews WHERE run_id=?",
          )
          .get(runId),
      ).toEqual({ packetDigest: persistedPacketDigest, previewDigest: preview.previewDigest });
      expect((runner as unknown as { submit?: unknown }).submit).toBeUndefined();

      // A queue transition after freeze invalidates the real currentness callback before
      // another browser write; no target request or upload is permitted on this path.
      r2.recordQueueDecision({
        jobId: lineage.jobId,
        state: "REVIEWING",
        r2EvaluationId: lineage.r2EvaluationId,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(lineage.jobId),
        actor: "OWNER",
        reasonCode: "OWNER_REVIEW_REQUIRED",
      });
      const staleRunner = new TargetIndependentNonSubmitRunner(
        packet,
        target,
        binding,
        adapter,
        currentBinding,
        () => fixedNow,
        new InMemoryNonSubmitDurableStore(),
      );
      expect(await staleRunner.map()).toMatchObject({
        state: "PAUSED",
        stopReason: "PAGE_CHANGED",
      });
      expect(counts).toEqual({ uploads: 1, submissions: 0 });
      r2.recordQueueDecision({
        jobId: lineage.jobId,
        state: "PREPARING",
        r2EvaluationId: lineage.r2EvaluationId,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(lineage.jobId),
        actor: "OWNER",
        reasonCode: "OWNER_PREPARING_RESTORED",
      });

      const competingSqlite = new BetterSqlite3(fixture.databasePath);
      competingSqlite.pragma("foreign_keys = ON");
      expect(
        new SqliteNonSubmitRunStore(
          competingSqlite,
          runId,
          persistedPacketDigest,
          () => fixedNow,
        ).claim(bindingDigest, "MAP_FOR_FILL"),
      ).toBe(false);
      competingSqlite.close();
      await adapter.close();
      sqlite.close();
      const child = spawnSync(
        process.execPath,
        [
          "-e",
          `const D=require('better-sqlite3'); const db=new D(process.argv[1]); const row=db.prepare('SELECT packet_digest AS packetDigest, preview_digest AS previewDigest FROM application_run_previews WHERE run_id=?').get(process.argv[2]); if(!row||!row.packetDigest||/^0+$/.test(row.packetDigest)) process.exit(2); console.log(JSON.stringify(row)); db.close();`,
          fixture.databasePath,
          runId,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout.trim())).toMatchObject({
        packetDigest: persistedPacketDigest,
      });
      sqlite = new BetterSqlite3(fixture.databasePath);
      sqlite.pragma("foreign_keys = ON");
      const reopenedStore = new SqliteNonSubmitRunStore(
        sqlite,
        runId,
        persistedPacketDigest,
        () => fixedNow,
      );
      expect(reopenedStore.load(bindingDigest)).toMatchObject({
        state: "FILL_PREVIEW",
        sequence: 6,
      });
      expect(counts).toEqual({ uploads: 1, submissions: 0 });
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      sqlite
        .prepare(
          "UPDATE application_run_operations SET effect_json='{}' WHERE run_id=? AND operation='FILL_PREVIEW'",
        )
        .run(runId);
      expect(() => reopenedStore.load(bindingDigest)).toThrow("NON_SUBMIT_SNAPSHOT_CORRUPT");
      expect(() => reopenedStore.checkpoints()).toThrow("NON_SUBMIT_SNAPSHOT_CORRUPT");
      expect(transportCounts).toEqual({ dns: 2, requests: 2 });
      expect(sqlite.prepare("SELECT count(*) AS count FROM source_observations").get()).toEqual({
        count: 1,
      });
      expect(sqlite.prepare("SELECT count(*) AS count FROM job_versions").get()).toEqual({
        count: 1,
      });
      sqlite.close();
    } finally {
      if (sqlite.open) {
        try {
          sqlite.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // Preserve the primary assertion error; cleanup remains best effort.
        }
        try {
          sqlite.close();
        } catch {
          // The connection may already have been closed after disk-reopen verification.
        }
      }
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});
