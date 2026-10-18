import { readFileSync, readdirSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  R2_CALIBRATION_SAFETY_GATES,
  R2CalibrationSafetyBundleSchema,
  r2CalibrationOwnerAction,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
  r2CalibrationSafetyDigest,
  type R2CalibrationOwnerGate,
  type ValidatedR2CalibrationSafety,
  scoreR2JobFit,
} from "@applypilot/fit-scorer";
import { SourceCapabilityV2Schema } from "@applypilot/job-sources";
import { testProfile } from "../../../tests/fixture-data";
import { SourceEnablementRepository, runLeverSourceToQueue } from "./source-enablement-repository";
import { R2CalibrationIntakeRepository } from "./r2-calibration-intake";
import {
  assertCurrentCalibrationQualification,
  readCurrentCalibrationQualification,
  currentR2CalibrationEngine,
  validateCalibrationSafety,
  nextCalibrationContext,
} from "./r2-calibration-currentness";
import { R2Repository } from "./r2-repository";

const at = "2026-09-10T00:00:00.000Z",
  clock = () => new Date(at);
const databases: BetterSqlite3.Database[] = [];
const digest = r2CalibrationSafetyDigest;
const threshold = {
  version: "fictional-intake-policy-1",
  minimumLabelAgreementBasisPoints: 8000,
  minimumPairComparisons: 1,
  minimumPairAgreementBasisPoints: 8000,
};

function ownerGate(
  purpose: "CREATE" | "LABEL" | "PAIR" | "QUAL",
  binding: unknown,
): R2CalibrationOwnerGate {
  return {
    action: r2CalibrationOwnerAction(purpose, binding),
    consumedAt: at,
    loopbackValidated: true,
    localSessionValidated: true,
    nonceConsumed: true,
  };
}

/** Fictional trusted-validator return for pure DB tests. The real FS/Git validator has separate integration tests. */
function fictionalSafety(): ValidatedR2CalibrationSafety {
  const head = "a".repeat(40),
    tree = "b".repeat(40);
  const root = `data/private/runtime/r2-calibration-safety/${head}/00000000-0000-4000-8000-000000000000`;
  const bundle = R2CalibrationSafetyBundleSchema.parse({
    schemaVersion: 1,
    mode: "LOCAL_EXECUTED",
    head,
    tree,
    engine: currentR2CalibrationEngine(),
    startedAt: at,
    completedAt: at,
    migrations: [
      { path: "packages/database/drizzle/0015_r2_calibration_intake.sql", sha256: "c".repeat(64) },
    ],
    proofs: R2_CALIBRATION_SAFETY_GATES.map((gate) => ({
      gate,
      command: "fictional-unit-boundary",
      exitCode: 0,
      startedAt: at,
      completedAt: at,
      logArtifact: `${root}/${gate.toLowerCase()}.log`,
      logSha256: "d".repeat(64),
      testFiles: [
        { path: "packages/database/src/r2-calibration-intake.test.ts", gitBlob: "e".repeat(40) },
      ],
      ...(gate === "privacyAudit"
        ? { kind: "PRIVACY_AUDIT", marker: "PRIVACY_AUDIT_PASS" }
        : {
            kind: "VITEST",
            requiredCases: ["fictional trusted-validator fixture"],
            resultArtifact: `${root}/${gate.toLowerCase()}.json`,
            resultSha256: "f".repeat(64),
          }),
    })),
  });
  const bundleDigest = digest(bundle);
  return {
    bundle,
    bundleDigest,
    engineDigest: digest(bundle.engine),
    head,
    tree,
    gates: {
      version: `r2-safety-v1:${bundleDigest}`,
      executableGoldenCorpus: true,
      determinism: true,
      monotonicity: true,
      ablation: true,
      bounds: true,
      recommendationInvariants: true,
      privacyAudit: true,
      migrationIntegrity: true,
    },
  };
}

async function setup(count = 6) {
  const sqlite = new BetterSqlite3(":memory:");
  databases.push(sqlite);
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort())
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  let sequence = 0;
  const nextId = () => `fictional-intake-${++sequence}`;
  const skillNames = [
    "Customer service",
    "Communication",
    "Teamwork",
    "Organisation",
    "Data entry",
    "Stock control",
  ];
  const profile = CandidateProfileSchema.parse({
    ...testProfile,
    profileId: "profile:intake-fictional",
    skills: skillNames.map((name, i) => ({
      id: `fictional-skill-${i}`,
      name,
      verification: "VERIFIED",
    })),
    workRights: {
      value: { country: "Australia", status: "UNRESTRICTED", maximumHoursPerFortnight: null },
      verification: "VERIFIED",
    },
  });
  const hash = candidateProfileContentHash(profile);
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES (?,NULL,?,?)",
    )
    .run(profile.profileId, at, at);
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
    VALUES ('profile:intake-version',?,1,1,?,?,?)`,
    )
    .run(profile.profileId, JSON.stringify(profile), hash, at);
  sqlite
    .prepare("UPDATE candidate_profiles SET active_version_id='profile:intake-version' WHERE id=?")
    .run(profile.profileId);
  const cap = SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "source-intake-fictional",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional Intake Company",
    tenant: "fictional-intake",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional-intake",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "fictional-source-owner",
    approvedAt: at,
    policyVersion: "fictional-policy-1",
    policyReviewedAt: at,
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 100,
    pageSizeCap: 100,
    responseByteLimit: 500000,
    requestTimeoutMs: 1000,
    runTimeoutMs: 30000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2-intake-fixture",
    createdAt: at,
    updatedAt: at,
    revokedAt: null,
    revocationReason: null,
  });
  const source = new SourceEnablementRepository(sqlite, clock, nextId);
  source.persistCapabilityVersion(cap);
  const sourceProof = (action: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START") => ({
    action,
    consumedAt: at,
    loopbackValidated: true as const,
    localSessionValidated: true as const,
    nonceConsumed: true as const,
  });
  source.recordOwnerApprovalReceipt({
    capability: cap,
    gateProof: sourceProof("SOURCE_CAPABILITY_APPROVE"),
    ownerConfirmed: true,
  });
  const receipts = source.createOwnerStartReceipt({
    capability: cap,
    operation: "LIST_JOBS",
    gateProof: sourceProof("SOURCE_RUN_START"),
    ownerConfirmed: true,
  });
  const postings = Array.from({ length: count }, (_, i) => ({
    id: `fictional-post-${i}`,
    text: `Fictional occupation ${i}`,
    hostedUrl: `https://jobs.lever.co/fictional-intake/fictional-post-${i}`,
    applyUrl: `https://jobs.lever.co/fictional-intake/fictional-post-${i}/apply`,
    descriptionPlain: "This is a fictional part-time position in Melbourne VIC.",
    categories: {
      location: "Melbourne VIC",
      allLocations: ["Melbourne VIC"],
      commitment: "Part-time",
      department: "Fictional duties",
    },
    country: "AU",
    workplaceType: "on-site",
    createdAt: Date.parse(at),
    lists: [
      {
        text: "Requirements",
        content:
          i % 3 === 2
            ? "<p>You must have your own vehicle.</p>"
            : `<ul>${skillNames.map((name) => `<li>${name} skills are required.</li>`).join("")}${i % 3 === 1 ? "<li>If assigned to a laboratory, a specialist licence is required.</li>" : ""}</ul>`,
      },
    ],
  }));
  const result = await runLeverSourceToQueue({
    capability: cap,
    repository: source,
    ownerReceiptChain: receipts,
    now: clock,
    evaluateJob: async () => null,
    queueJob: () => {},
    dependencies: {
      resolveHost: async () => ["8.8.8.8"],
      request: async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(postings)),
        connectedAddress: pinnedAddress,
      }),
    },
  });
  expect(result.status).toBe("COMPLETE");
  const repository = new R2CalibrationIntakeRepository(sqlite, clock, nextId);
  const jobIds = repository.listCandidates().map((c) => c.jobId);
  return { sqlite, repository, jobIds, profile, hash, nextId };
}

function campaign(c: Awaited<ReturnType<typeof setup>>, thresholds = threshold) {
  const selection = c.repository.previewCampaign(c.jobIds, c.hash);
  const request = { jobIds: c.jobIds, expectedContextDigest: selection.contextDigest, thresholds };
  return c.repository.createCampaign(
    request,
    ownerGate("CREATE", r2CalibrationCreateBinding(request)),
    c.hash,
  );
}
function labelOne(
  c: Awaited<ReturnType<typeof setup>>,
  campaignId: string,
  comparisonId: string,
  family = "RETAIL_CUSTOMER_SERVICE",
) {
  const state = c.repository.readCampaign(campaignId, c.hash),
    member = state.comparisons.find((m) => m.id === comparisonId)!;
  const previous = state.labels.find((l) => l.comparisonId === comparisonId);
  const request = {
    campaignId,
    comparisonId,
    expectedContextDigest: state.contextDigest,
    previousEventId: previous?.id ?? null,
    label:
      member.eligibility.status === "ELIGIBLE"
        ? "GOOD_MATCH"
        : member.eligibility.status === "INELIGIBLE"
          ? "POOR_MATCH"
          : "AMBIGUOUS",
    occupationalFamily: family,
  };
  return c.repository.recordLabel(
    request,
    ownerGate("LABEL", r2CalibrationLabelBinding(request)),
    c.hash,
  );
}
function pairOne(c: Awaited<ReturnType<typeof setup>>, campaignId: string, reverse = false) {
  const state = c.repository.readCampaign(campaignId, c.hash);
  const ordered = [...state.comparisons].sort(
    (a, b) => b.fit.score - a.fit.score || a.id.localeCompare(b.id),
  );
  const first = ordered[0]!,
    last = ordered.at(-1)!;
  const [left, right] = reverse ? [last, first] : [first, last];
  const previous = state.pairs.find(
    (p) =>
      [p.leftComparisonId, p.rightComparisonId].includes(first.id) &&
      [p.leftComparisonId, p.rightComparisonId].includes(last.id),
  );
  const request = {
    campaignId,
    leftComparisonId: left!.id,
    rightComparisonId: right!.id,
    preferredComparisonId: first.id,
    expectedContextDigest: state.contextDigest,
    previousEventId: previous?.id ?? null,
  };
  return c.repository.recordPair(
    request,
    ownerGate("PAIR", r2CalibrationPairBinding(request)),
    c.hash,
  );
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("real retained-source calibration intake", () => {
  it("offers only provisional retained-data hints without deriving outcomes or writing intake", async () => {
    const c = await setup();
    expect(c.repository.listCandidates().map((candidate) => candidate.availabilityHint)).toEqual(
      Array(6).fill("PROVISIONAL"),
    );
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_comparisons").pluck().get()).toBe(
      0,
    );
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_campaigns").pluck().get()).toBe(0);
  });
  it("marks missing payload, unsupported provider, unqualified lineage and owner correction with fixed hints", async () => {
    const c = await setup();
    const candidates = c.repository.listCandidates();
    const observation = (jobId: string) =>
      c.sqlite
        .prepare(
          "SELECT source_observation_id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1",
        )
        .pluck()
        .get(jobId) as string;
    c.sqlite
      .prepare("DELETE FROM source_observation_payloads WHERE observation_id=?")
      .run(observation(candidates[0]!.jobId));
    c.sqlite
      .prepare(
        "UPDATE source_record_verifications SET qualification_state='PAGE_PERSISTED' WHERE source_observation_id=?",
      )
      .run(observation(candidates[1]!.jobId));
    c.sqlite
      .prepare("UPDATE source_observations SET source='UNSUPPORTED_FIXTURE' WHERE id=?")
      .run(observation(candidates[2]!.jobId));
    c.sqlite
      .prepare(
        `INSERT INTO job_corrections (id,job_id,from_job_version_id,to_job_version_id,actor,reason_code,
      changed_fields_json,before_digest,after_digest,created_at) VALUES ('fictional-hint-correction',?,?,?,'OWNER','FICTIONAL_CORRECTION','[]',?,?,?)`,
      )
      .run(
        candidates[3]!.jobId,
        candidates[3]!.jobVersionId,
        candidates[3]!.jobVersionId,
        "a".repeat(64),
        "b".repeat(64),
        at,
      );
    expect(c.repository.listCandidates().map((candidate) => candidate.availabilityHint)).toEqual([
      "RETAINED_SOURCE_MISSING",
      "QUALIFIED_LINEAGE_MISSING",
      "UNSUPPORTED_PROVIDER",
      "OWNER_CORRECTION_UNSUPPORTED",
      "PROVISIONAL",
      "PROVISIONAL",
    ]);
  });
  it("checks only the latest job version and never promises full parser validity from a hint", async () => {
    const c = await setup();
    const [first, second] = c.repository.listCandidates();
    c.sqlite
      .prepare(
        `INSERT INTO job_versions (id,job_id,version,normalized_json,content_digest,created_at)
      SELECT 'fictional-latest-hint',job_id,version+1,normalized_json,content_digest,created_at FROM job_versions WHERE id=?`,
      )
      .run(first!.jobVersionId);
    const latest = c.repository
      .listCandidates()
      .find((candidate) => candidate.jobId === first!.jobId)!;
    expect(latest.jobVersionId).toBe("fictional-latest-hint");
    expect(latest.availabilityHint).not.toBe("PROVISIONAL");
    c.sqlite
      .prepare(
        `UPDATE source_observation_payloads SET payload_json='not-json' WHERE observation_id=(
      SELECT source_observation_id FROM job_versions WHERE id=?)`,
      )
      .run(second!.jobVersionId);
    expect(
      c.repository.listCandidates().find((candidate) => candidate.jobId === second!.jobId)!
        .availabilityHint,
    ).toBe("PROVISIONAL");
    expect(() => c.repository.previewCampaign([second!.jobId])).toThrow();
  });
  it("requires a completed source run even for a retained qualified verification", async () => {
    const c = await setup();
    c.sqlite.prepare("UPDATE source_run_checkpoints SET status='STOPPED'").run();
    expect(
      c.repository
        .listCandidates()
        .every((candidate) => candidate.availabilityHint === "QUALIFIED_LINEAGE_MISSING"),
    ).toBe(true);
  });
  it("derives real final-version comparisons read-only, retaining all original job/source/evaluation history", async () => {
    const c = await setup();
    const tables = [
      "jobs",
      "job_versions",
      "source_observations",
      "source_observation_payloads",
      "source_record_verifications",
      "r2_evaluation_versions",
      "calibration_labels",
      "calibration_pairs",
    ];
    const snapshot = () =>
      digest(tables.map((t) => c.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    const before = snapshot(),
      preview = c.repository.previewCampaign(c.jobIds, c.hash);
    expect(preview.comparisons).toHaveLength(6);
    expect(new Set(preview.comparisons.map((m) => m.eligibility.status))).toEqual(
      new Set(["ELIGIBLE", "REVIEW_REQUIRED", "INELIGIBLE"]),
    );
    expect(
      preview.comparisons.every(
        (m) =>
          m.engine.parserVersion === currentR2CalibrationEngine().parserVersion &&
          m.purpose === "CALIBRATION_OFFLINE",
      ),
    ).toBe(true);
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_campaigns").pluck().get()).toBe(0);
    const id = campaign(c),
      state = c.repository.readCampaign(id, c.hash);
    labelOne(c, id, state.comparisons[0]!.id);
    pairOne(c, id);
    expect(snapshot()).toBe(before);
    expect(c.repository.previewAssessment(id, null, c.hash).assessment.state).toBe("UNCALIBRATED");
  });
  it("rejects stale selection, duplicate actual jobs, a changed profile, and posted owner provenance", async () => {
    const c = await setup(),
      selection = c.repository.previewCampaign(c.jobIds, c.hash);
    const req = { jobIds: c.jobIds, expectedContextDigest: "0".repeat(64), thresholds: threshold };
    expect(() =>
      c.repository.createCampaign(
        req,
        ownerGate("CREATE", r2CalibrationCreateBinding(req)),
        c.hash,
      ),
    ).toThrow("R2_CALIBRATION_CONTEXT_STALE");
    expect(() => c.repository.previewCampaign([c.jobIds[0]!, c.jobIds[0]!], c.hash)).toThrow(
      "R2_CALIBRATION_CORPUS_NOT_UNIQUE",
    );
    expect(() => c.repository.previewCampaign(c.jobIds, "9".repeat(64))).toThrow(
      "R2_CALIBRATION_PROFILE_CHANGED",
    );
    const valid = { ...req, expectedContextDigest: selection.contextDigest };
    expect(() =>
      c.repository.createCampaign(valid, {
        ...ownerGate("CREATE", r2CalibrationCreateBinding(valid)),
        nonceConsumed: false,
      } as never),
    ).toThrow();
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_campaigns").pluck().get()).toBe(0);
  });
  it("preserves revisions and rejects stale/replayed label or reversed-pair duplication", async () => {
    const c = await setup(),
      id = campaign(c),
      initial = c.repository.readCampaign(id),
      member = initial.comparisons[0]!;
    const request = {
      campaignId: id,
      comparisonId: member.id,
      expectedContextDigest: initial.contextDigest,
      previousEventId: null,
      label: "AMBIGUOUS",
      occupationalFamily: "UNKNOWN",
    };
    const proof = ownerGate("LABEL", r2CalibrationLabelBinding(request));
    c.repository.recordLabel(request, proof);
    expect(() => c.repository.recordLabel(request, proof)).toThrow("R2_CALIBRATION_CONTEXT_STALE");
    labelOne(c, id, member.id);
    expect(c.repository.readCampaign(id).labels[0]!.revision).toBe(2);
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_label_events").pluck().get()).toBe(
      2,
    );
    pairOne(c, id);
    pairOne(c, id, true);
    expect(c.repository.readCampaign(id).pairs).toHaveLength(1);
    expect(c.repository.readCampaign(id).pairs[0]!.revision).toBe(2);
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_pair_events").pluck().get()).toBe(
      2,
    );
    expect(() =>
      c.sqlite
        .prepare("UPDATE r2_calibration_campaigns SET thresholds_json='{}' WHERE id=?")
        .run(id),
    ).toThrow("R2_CALIBRATION_IMMUTABLE");
    expect(() => c.sqlite.prepare("DELETE FROM r2_calibration_label_events").run()).toThrow(
      "R2_CALIBRATION_IMMUTABLE",
    );
  });
  it("rolls back the entire append if its safe audit fails", async () => {
    const c = await setup(),
      id = campaign(c),
      member = c.repository.readCampaign(id).comparisons[0]!;
    c.sqlite.exec(
      "CREATE TRIGGER reject_intake_audit BEFORE INSERT ON r2_audit_events WHEN NEW.event_type='r2.calibration.intake.label_recorded' BEGIN SELECT RAISE(ABORT,'FICTIONAL_AUDIT_FAILURE'); END;",
    );
    expect(() => labelOne(c, id, member.id)).toThrow("FICTIONAL_AUDIT_FAILURE");
    expect(c.repository.readCampaign(id).eventCount).toBe(0);
    c.sqlite.exec("DROP TRIGGER reject_intake_audit");
    labelOne(c, id, member.id);
    expect(c.repository.readCampaign(id).eventCount).toBe(1);
  });
  it("keeps suggestions visible without a global CLEAR gate, but excludes known direct linked jobs from one corpus", async () => {
    const c = await setup();
    const observations = c.sqlite
      .prepare("SELECT id FROM source_observations ORDER BY id LIMIT 2")
      .pluck()
      .all() as string[];
    c.sqlite
      .prepare(
        `INSERT INTO r2_duplicate_candidates (id,left_observation_id,right_observation_id,detector_version,state,
      matched_signals_json,conflicting_signals_json,evidence_digest,created_at,updated_at)
      VALUES ('fictional-direct-edge',?,?, 'r2-duplicate-1','SUGGESTED','[]','[]',?,?,?)`,
      )
      .run(observations[0], observations[1], "a".repeat(64), at, at);
    const preview = c.repository.previewCampaign(c.jobIds);
    expect(preview.comparisons.filter((m) => m.unresolvedDirectDuplicateCount > 0)).toHaveLength(2);
    expect(
      c.repository
        .listCandidates()
        .every((candidate) => candidate.availabilityHint === "PROVISIONAL"),
    ).toBe(true);
    const id = campaign(c);
    expect(c.repository.readCampaign(id).comparisons).toHaveLength(6);
    new R2Repository(c.sqlite, clock, c.nextId).decideDuplicate({
      candidateId: "fictional-direct-edge",
      decision: "LINKED",
      reasonCode: "FICTIONAL_OWNER_LINK",
      evidenceVersion: "fictional-direct-1",
    });
    expect(() => c.repository.previewCampaign(c.jobIds)).toThrow(
      "R2_CALIBRATION_CORPUS_KNOWN_DUPLICATE",
    );
  });
  it("rejects source and comparison tampering, and never silently drops owner correction semantics", async () => {
    const c = await setup(),
      id = campaign(c),
      state = c.repository.readCampaign(id),
      m = state.comparisons[0]!;
    const raw = c.sqlite
      .prepare("SELECT payload_json FROM source_observation_payloads WHERE observation_id=?")
      .pluck()
      .get(m.sourceObservationId) as string;
    c.sqlite
      .prepare("UPDATE source_observation_payloads SET payload_json=? WHERE observation_id=?")
      .run(raw + " ", m.sourceObservationId);
    expect(() => c.repository.readCampaign(id)).toThrow("R2_CALIBRATION_CONTEXT_STALE");
    c.sqlite
      .prepare("UPDATE source_observation_payloads SET payload_json=? WHERE observation_id=?")
      .run(raw, m.sourceObservationId);
    expect(c.repository.readCampaign(id).contextDigest).toBe(state.contextDigest);
    c.sqlite.exec("DROP TRIGGER r2_cal_comparison_no_update");
    c.sqlite
      .prepare("UPDATE r2_calibration_comparisons SET snapshot_digest=? WHERE id=?")
      .run("0".repeat(64), m.id);
    expect(() => c.repository.readCampaign(id)).toThrow("R2_CALIBRATION_COMPARISON_CHANGED");
    c.sqlite
      .prepare(
        `INSERT INTO job_corrections (id,job_id,from_job_version_id,to_job_version_id,actor,reason_code,
      changed_fields_json,before_digest,after_digest,created_at) VALUES ('fictional-correction',?,?,?,'OWNER','FICTIONAL_CORRECTION','[]',?,?,?)`,
      )
      .run(m.jobId, m.jobVersionId, m.jobVersionId, "a".repeat(64), "b".repeat(64), at);
    expect(() => c.repository.previewCampaign(c.jobIds)).toThrow(
      "R2_CALIBRATION_CORRECTION_REPLAY_UNSUPPORTED",
    );
  });
  it("requires the stored profile snapshot to belong to its active profile identity", async () => {
    const c = await setup(),
      changed = CandidateProfileSchema.parse({ ...c.profile, profileId: "other-profile" });
    c.sqlite
      .prepare(
        "UPDATE candidate_profile_versions SET snapshot_json=?,content_hash=? WHERE id='profile:intake-version'",
      )
      .run(JSON.stringify(changed), candidateProfileContentHash(changed));
    expect(() => c.repository.previewCampaign(c.jobIds)).toThrow("R2_CALIBRATION_PROFILE_CHANGED");
  });
  it("leaves UNKNOWN family incomplete and never fabricates qualification from a small source sample", async () => {
    const c = await setup(),
      id = campaign(c);
    for (const m of c.repository.readCampaign(id).comparisons) labelOne(c, id, m.id, "UNKNOWN");
    const preview = c.repository.previewAssessment(id, fictionalSafety());
    expect(preview.assessment.comparedLabelCount).toBe(0);
    expect(preview.assessment.roleFamilyCount).toBe(0);
    expect(preview.assessment.blockerCodes).toContain("PRIVATE_LABEL_ROWS_INCONSISTENT");
    expect(preview.readyForOwnerApproval).toBe(false);
    const approval = { campaignId: id, assessmentDigest: preview.assessmentDigest };
    expect(() =>
      c.repository.approveQualification(approval, ownerGate("QUAL", approval), fictionalSafety()),
    ).toThrow("R2_CALIBRATION_NOT_QUALIFIABLE");
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_runs").pluck().get()).toBe(0);
  });
  it.each(R2_CALIBRATION_SAFETY_GATES)(
    "rejects a false or missing individual safety proof %s",
    (gate) => {
      const safety = fictionalSafety();
      expect(validateCalibrationSafety(safety, currentR2CalibrationEngine())).toBe(safety);
      expect(() =>
        validateCalibrationSafety(
          { ...safety, gates: { ...safety.gates, [gate]: false } },
          currentR2CalibrationEngine(),
        ),
      ).toThrow();
      const missing = { ...safety.gates };
      delete (missing as Record<string, unknown>)[gate];
      expect(() =>
        validateCalibrationSafety({ ...safety, gates: missing }, currentR2CalibrationEngine()),
      ).toThrow();
    },
  );
  it("records one isolated30-job fictional qualification, then fails closed on event/source/profile/engine/proof drift", async () => {
    const c = await setup(30),
      id = campaign(c);
    const families = [
      "RETAIL_CUSTOMER_SERVICE",
      "ADMINISTRATION_OFFICE",
      "LOGISTICS_WAREHOUSE",
      "HOSPITALITY_FOOD",
    ];
    const initial = c.repository.readCampaign(id),
      members = initial.comparisons;
    let contextDigest = initial.contextDigest;
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      const request = {
        campaignId: id,
        comparisonId: m.id,
        expectedContextDigest: contextDigest,
        previousEventId: null,
        label:
          m.eligibility.status === "ELIGIBLE"
            ? "GOOD_MATCH"
            : m.eligibility.status === "INELIGIBLE"
              ? "POOR_MATCH"
              : "AMBIGUOUS",
        occupationalFamily: families[i % 4]!,
      };
      const eventId = c.repository.recordLabel(
        request,
        ownerGate("LABEL", r2CalibrationLabelBinding(request)),
        c.hash,
      );
      const eventDigest = c.sqlite
        .prepare("SELECT event_digest FROM r2_calibration_label_events WHERE id=?")
        .pluck()
        .get(eventId) as string;
      contextDigest = nextCalibrationContext(contextDigest, eventDigest);
    }
    pairOne(c, id);
    const safety = fictionalSafety(),
      preview = c.repository.previewAssessment(id, safety);
    expect(preview.assessment.sourceLabelCount).toBe(30);
    expect(preview.assessment.statusCount).toBe(3);
    expect(preview.assessment.roleFamilyCount).toBe(4);
    expect(preview.readyForOwnerApproval).toBe(true);
    const request = { campaignId: id, assessmentDigest: preview.assessmentDigest };
    expect(() =>
      c.repository.approveQualification(
        { ...request, assessmentDigest: "9".repeat(64) },
        ownerGate("QUAL", request),
        safety,
      ),
    ).toThrow("R2_CALIBRATION_ASSESSMENT_CHANGED");
    const runId = c.repository.approveQualification(
      request,
      ownerGate("QUAL", request),
      safety,
      c.hash,
    );
    const binding = {
      runId,
      expectedEngine: currentR2CalibrationEngine(),
      profileVersionId: "profile:intake-version",
      profileHash: c.hash,
      safetyEvidence: safety,
    };
    expect(assertCurrentCalibrationQualification(c.sqlite, binding).runId).toBe(runId);
    expect(readCurrentCalibrationQualification(c.sqlite, binding)?.runId).toBe(runId);
    expect(() =>
      c.repository.approveQualification(request, ownerGate("QUAL", request), safety),
    ).toThrow();
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_runs").pluck().get()).toBe(1);
    expect(() =>
      assertCurrentCalibrationQualification(c.sqlite, { ...binding, profileHash: "0".repeat(64) }),
    ).toThrow();
    expect(() =>
      assertCurrentCalibrationQualification(c.sqlite, {
        ...binding,
        expectedEngine: { ...binding.expectedEngine, normalizationVersion: "historical" },
      }),
    ).toThrow();
    const changedProof = structuredClone(safety);
    changedProof.bundle.proofs[0]!.logSha256 = "0".repeat(64);
    expect(() =>
      assertCurrentCalibrationQualification(c.sqlite, { ...binding, safetyEvidence: changedProof }),
    ).toThrow();
    const m = members.find((member) => member.eligibility.status === "ELIGIBLE")!;
    const eligibility = evaluateR2Eligibility({
      profile: c.profile,
      normalization: m.normalization,
      evaluatedAt: at,
      bindings: {
        ...m.eligibility.bindings,
        evaluationVersionId: "fictional-calibrated-evaluation",
      },
    });
    const fit = scoreR2JobFit({
      profile: c.profile,
      normalization: m.normalization,
      eligibility,
      calibrationContext: {
        version: `r2-intake-qualified:${runId}`,
        state: "CALIBRATED",
        runId,
        scorerVersion: binding.expectedEngine.scorerVersion,
        weightVersion: binding.expectedEngine.weightVersion,
        corpusVersion: binding.expectedEngine.goldenCorpusVersion,
      },
    });
    expect(() =>
      new R2Repository(c.sqlite, clock, c.nextId).recordEvaluation({
        jobId: m.jobId,
        jobVersionId: m.jobVersionId,
        profileVersionId: "profile:intake-version",
        normalization: m.normalization,
        eligibility,
        fit,
      }),
    ).toThrow("R2_CALIBRATION_INTAKE_PROVENANCE_REQUIRED");
    const evaluated = new R2Repository(c.sqlite, clock, c.nextId, {
      calibrationSafety: () => safety,
    }).recordEvaluation({
      jobId: m.jobId,
      jobVersionId: m.jobVersionId,
      profileVersionId: "profile:intake-version",
      normalization: m.normalization,
      eligibility,
      fit,
    });
    expect(evaluated.created).toBe(true);
    expect(fit.recommended).toBe(true);
    const storedEvaluation = c.sqlite
      .prepare("SELECT * FROM r2_evaluation_versions WHERE id=?")
      .get(evaluated.id);
    expect(storedEvaluation).toMatchObject({
      calibration_state: "CALIBRATED",
      calibration_run_id: runId,
      stale: 0,
    });
    // A historical canonical evaluation ID is context, not a comparison input that self-invalidates this run.
    expect(assertCurrentCalibrationQualification(c.sqlite, binding).runId).toBe(runId);
    labelOne(c, id, members[0]!.id);
    expect(readCurrentCalibrationQualification(c.sqlite, binding)).toBeNull();
    expect(
      c.sqlite.prepare("SELECT * FROM r2_evaluation_versions WHERE id=?").get(evaluated.id),
    ).toEqual(storedEvaluation);
    // Current calibration presentation becomes pending; strict score/version admission is independent.
    const preparing = new R2Repository(c.sqlite, clock, c.nextId);
    preparing.recordQueueDecision({
      jobId: m.jobId,
      state: "PREPARING",
      r2EvaluationId: evaluated.id,
      duplicateResolutionVersion: preparing.duplicateResolutionVersion(m.jobId),
      actor: "OWNER",
      reasonCode: "FICTIONAL_OWNER_PREPARING",
    });
    expect(() => preparing.assertCurrentPreparing(m.jobId, evaluated.id)).not.toThrow();
    expect(() =>
      new R2Repository(c.sqlite, clock, c.nextId, {
        calibrationSafety: () => safety,
      }).recordEvaluation({
        jobId: m.jobId,
        jobVersionId: m.jobVersionId,
        profileVersionId: "profile:intake-version",
        normalization: m.normalization,
        eligibility,
        fit,
      }),
    ).toThrow();
    expect(c.sqlite.prepare("SELECT count(*) FROM r2_calibration_runs").pluck().get()).toBe(1);
  }, 30000);
  it("rejects legacy aggregate runs as new current intake provenance", async () => {
    const c = await setup(),
      safety = fictionalSafety();
    expect(() =>
      assertCurrentCalibrationQualification(c.sqlite, {
        runId: "historical-unbound-run",
        expectedEngine: currentR2CalibrationEngine(),
        profileVersionId: "profile:intake-version",
        profileHash: c.hash,
        safetyEvidence: safety,
      }),
    ).toThrow("R2_CALIBRATION_INTAKE_PROVENANCE_REQUIRED");
    expect(new R2Repository(c.sqlite).available()).toBe(true);
  });
});
