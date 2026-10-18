import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";

const mocks = vi.hoisted(() => ({
  sqlite: null as unknown,
  beta: null as unknown,
  calibrationRunIsCurrent: vi.fn<(runId: string | null | undefined) => boolean>(() => false),
}));

vi.mock("server-only", () => ({}));
vi.mock("@web/lib/r2-calibration-status", () => ({
  createCurrentR2CalibrationStatusReader: () => mocks.calibrationRunIsCurrent,
}));
vi.mock("@web/lib/local-database", async (importOriginal) => {
  const database = await importOriginal<typeof import("@applypilot/database")>();
  return {
    getLocalDatabase: () =>
      mocks.sqlite ? { sqlite: mocks.sqlite as BetterSqlite3.Database } : null,
    getBetaRepository: () =>
      (mocks.beta as InstanceType<typeof database.BetaRepository> | null) ??
      (mocks.sqlite ? new database.BetaRepository(mocks.sqlite as BetterSqlite3.Database) : null),
    getR2Repository: () => ({ available: () => false }),
    getJobImportRepository: () => null,
    getSourceEnablementRepository: () => null,
    getRunnerEnablementRepository: () => null,
    hasBetaSchema: () => true,
  };
});

import { BetaRepository, currentR2EvaluationVersions } from "@applypilot/database";
import { getBetaJob, listBetaJobs, preparePrivatePacket } from "@web/lib/beta-workspace";

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
  "0011_immutable_r2a_derivation_bindings.sql",
  "0012_source_owner_action_receipts.sql",
  "0013_exact_source_request_binding.sql",
  "0014_hosted_application_workflow.sql",
  "0015_r2_calibration_intake.sql",
] as const;

let sqlite: BetterSqlite3.Database | undefined;

function fixtureDatabase(): BetterSqlite3.Database {
  const db = new BetterSqlite3(":memory:");
  for (const name of migrationNames) {
    db.exec(
      readFileSync(new URL(`../../../packages/database/drizzle/${name}`, import.meta.url), "utf8"),
    );
  }
  db.pragma("foreign_keys = ON");
  const now = "2026-09-30T00:00:00.000Z";
  const job = {
    ...fixtureJob("job-retail-sales-assistant"),
    id: "job-persisted-inspection-packet-gate",
  };
  const profile = { ...testProfile, profileId: "profile-persisted-inspection-packet-gate" };
  const jobVersionId = "job-version-persisted-inspection-packet-gate";
  const profileVersionId = "profile-version-persisted-inspection-packet-gate";

  db.prepare(
    `INSERT INTO jobs
       (id,title,company,category,location,employment_type,normalized_json,application_status,
        date_discovered,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
  ).run(
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
  db.prepare(
    `INSERT INTO job_versions
       (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
     VALUES (?, ?, 1, ?, ?, NULL, ?)`,
  ).run(jobVersionId, job.id, JSON.stringify(job), "a".repeat(64), now);
  db.prepare(
    `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(profile.profileId, profileVersionId, now, now);
  db.prepare(
    `INSERT INTO candidate_profile_versions
       (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
     VALUES (?, ?, 1, 1, ?, ?, ?)`,
  ).run(profileVersionId, profile.profileId, JSON.stringify(profile), "b".repeat(64), now);
  db.prepare(
    `INSERT INTO evaluation_versions
       (id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,
        eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,
        eligibility_engine_version,fit_engine_version,weight_version,stale,evaluated_at)
     VALUES ('legacy-evaluation:inspection-packet-gate',?,?,?,'PRIVATE_LOCAL_PROFILE','ELIGIBLE',
        '[]',80,'[]',?,'1.0.0','1.0.0','fixture-weights',0,?)`,
  ).run(
    job.id,
    jobVersionId,
    profileVersionId,
    JSON.stringify({
      known: 1,
      unknown: 0,
      ambiguous: 0,
      notApplicable: 0,
      percent: 100,
      confidence: "HIGH",
      missingDimensions: [],
    }),
    now,
  );
  db.prepare(
    `INSERT INTO r2_evaluation_versions
       (id,job_id,job_version_id,profile_version_id,evidence_contract_version,
        normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,
        fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,
        weight_version,calibration_state,calibration_context_version,calibration_run_id,
        recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,
        unresolved_conflict_count,stale,evaluated_at)
     VALUES ('r2-evaluation:inspection-packet-gate',?,?,?,'3.1.0','3.1.0','3.1.0:3.1.0',
        'ELIGIBLE','[]',80,'[]','1.0.0','2.2.0','r2-weights-1','UNCALIBRATED',
        'r2-calibration-context-1:unreviewed',NULL,1,100,0,0,0,0,?)`,
  ).run(job.id, jobVersionId, profileVersionId, now);
  const installed = currentR2EvaluationVersions();
  db.prepare(
    `UPDATE r2_evaluation_versions SET evidence_contract_version=?,normalization_version=?,coverage_version=?,eligibility_engine_version=?,fit_scorer_version=?,weight_version=? WHERE id='r2-evaluation:inspection-packet-gate'`,
  ).run(
    installed.evidenceContractVersion,
    installed.normalizationVersion,
    installed.coverageVersion,
    installed.eligibilityEngineVersion,
    installed.scorerVersion,
    installed.weightVersion,
  );
  return db;
}

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
  mocks.sqlite = null;
  mocks.beta = null;
  mocks.calibrationRunIsCurrent.mockReset().mockReturnValue(false);
  vi.restoreAllMocks();
});

describe("private packet preparation verification gate", () => {
  it("propagates the existing verification-required error before packet creation", async () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const repository = new BetaRepository(sqlite);
    const requiredVerification = vi
      .spyOn(repository, "requireLatestQualifiedVerification")
      .mockImplementation(() => {
        throw new Error("PREPARATION_VERIFICATION_REQUIRED");
      });
    mocks.beta = repository;

    await expect(preparePrivatePacket("job-persisted-inspection-packet-gate")).rejects.toThrow(
      "PREPARATION_VERIFICATION_REQUIRED",
    );
    expect(requiredVerification).toHaveBeenCalledWith(
      "job-persisted-inspection-packet-gate",
      "job-version-persisted-inspection-packet-gate",
    );
    expect(sqlite.prepare("SELECT count(*) AS count FROM application_packets").get()).toEqual({
      count: 0,
    });
  });
});

function addCurrentDashboardQueue() {
  const current = currentR2EvaluationVersions();
  sqlite!
    .prepare(
      `INSERT INTO r2_queue_decision_versions (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,evidence_contract_version,duplicate_resolution_version,coverage_version,actor,reason_code,created_at)
    VALUES ('queue:installed','job-persisted-inspection-packet-gate',1,'PREPARING','CURRENT','job-version-persisted-inspection-packet-gate','profile-version-persisted-inspection-packet-gate','r2-evaluation:inspection-packet-gate',?,'fictional-duplicate-version',?,'OWNER','FICTIONAL_OWNER_ACTION',?)`,
    )
    .run(current.evidenceContractVersion, current.coverageVersion, "2026-10-18T00:00:00.000Z");
}

describe("installed R2 versions in job views", () => {
  it.each([
    ["CALIBRATED", false, "CALIBRATION_PENDING"],
    ["CALIBRATED", true, "CALIBRATED"],
    ["CALIBRATION_PENDING", true, "CALIBRATION_PENDING"],
    ["UNCALIBRATED", true, "UNCALIBRATED"],
  ] as const)(
    "projects stored %s with current qualification %s without changing matching or history",
    (storedState, isCurrent, projectedState) => {
      sqlite = fixtureDatabase();
      mocks.sqlite = sqlite;
      addCurrentDashboardQueue();
      sqlite
        .prepare(
          `INSERT INTO r2_calibration_runs
        (id,scorer_version,weight_version,corpus_version,fictional_case_count,private_reviewed_count,
         role_family_count,status_count,ordinal_agreement_basis_points,top_k,top_k_utility_basis_points,state,created_at)
        VALUES ('fictional-exact-run','fixture','fixture','fixture',0,0,0,0,0,0,0,'CALIBRATION_PENDING','2026-10-18')`,
        )
        .run();
      sqlite
        .prepare(
          "UPDATE r2_evaluation_versions SET calibration_state=?,calibration_run_id='fictional-exact-run'",
        )
        .run(storedState);
      mocks.calibrationRunIsCurrent.mockReturnValue(isCurrent);
      const before = JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all());
      const queueBefore = JSON.stringify(
        sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all(),
      );
      sqlite.pragma("query_only=ON");
      const expected = {
        calibrationState: projectedState,
        storedCalibrationState: storedState,
        evaluationStale: false,
        eligibilityStatus: "ELIGIBLE",
        fitScore: 80,
        recommended: true,
        queueState: "PREPARING",
        queueFreshness: "CURRENT",
      };
      expect(listBetaJobs()[0]).toMatchObject(expected);
      expect(getBetaJob("job-persisted-inspection-packet-gate")).toMatchObject(expected);
      if (storedState === "CALIBRATED") {
        expect(mocks.calibrationRunIsCurrent).toHaveBeenCalledTimes(2);
        expect(mocks.calibrationRunIsCurrent).toHaveBeenNthCalledWith(1, "fictional-exact-run");
        expect(mocks.calibrationRunIsCurrent).toHaveBeenNthCalledWith(2, "fictional-exact-run");
      } else {
        expect(mocks.calibrationRunIsCurrent).not.toHaveBeenCalled();
      }
      expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all())).toBe(
        before,
      );
      expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all())).toBe(
        queueBefore,
      );
    },
  );

  it("treats a missing exact calibration run as pending and does not check unevaluated rows", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    sqlite
      .prepare(
        "UPDATE r2_evaluation_versions SET calibration_state='CALIBRATED',calibration_run_id=NULL",
      )
      .run();
    addDashboardJob("job-fictional-unscored-calibration");
    const rows = listBetaJobs();
    expect(rows.find(({ id }) => id === "job-persisted-inspection-packet-gate")).toMatchObject({
      calibrationState: "CALIBRATION_PENDING",
      storedCalibrationState: "CALIBRATED",
    });
    expect(rows.find(({ id }) => id === "job-fictional-unscored-calibration")).toMatchObject({
      calibrationState: null,
      storedCalibrationState: null,
    });
    expect(mocks.calibrationRunIsCurrent).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each([
    "evidence_contract_version",
    "normalization_version",
    "coverage_version",
    "eligibility_engine_version",
    "fit_scorer_version",
    "weight_version",
  ])("projects %s drift as stale without rewriting history", (column) => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    addCurrentDashboardQueue();
    sqlite.prepare(`UPDATE r2_evaluation_versions SET ${column}='historical'`).run();
    if (column === "evidence_contract_version" || column === "coverage_version")
      sqlite.prepare(`UPDATE r2_queue_decision_versions SET ${column}='historical'`).run();
    const before = JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all());
    const queueBefore = JSON.stringify(
      sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all(),
    );
    sqlite.pragma("query_only=ON");
    expect(
      listBetaJobs().find(({ id }) => id === "job-persisted-inspection-packet-gate"),
    ).toMatchObject({
      evaluationStale: true,
      recommended: false,
      queueState: "PREPARING",
      queueFreshness: "STALE",
    });
    expect(getBetaJob("job-persisted-inspection-packet-gate")).toMatchObject({
      evaluationStale: true,
      recommended: false,
      queueFreshness: "STALE",
    });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_evaluation_versions").all())).toBe(
      before,
    );
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM r2_queue_decision_versions").all())).toBe(
      queueBefore,
    );
  });

  it("retains genuine current evaluation and queue projections", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    addCurrentDashboardQueue();
    sqlite.pragma("query_only=ON");
    expect(listBetaJobs()[0]).toMatchObject({
      evaluationStale: false,
      recommended: true,
      queueFreshness: "CURRENT",
    });
    expect(getBetaJob("job-persisted-inspection-packet-gate")).toMatchObject({
      evaluationStale: false,
      recommended: true,
      queueFreshness: "CURRENT",
    });
  });

  it("projects a queue bound to another evaluation as stale", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    addCurrentDashboardQueue();
    sqlite.prepare("UPDATE r2_queue_decision_versions SET coverage_version='historical'").run();
    expect(listBetaJobs()[0]?.queueFreshness).toBe("STALE");
    expect(getBetaJob("job-persisted-inspection-packet-gate")?.queueFreshness).toBe("STALE");
  });
});

const dashboardTime = "2026-09-30T00:00:00.000Z";
type DuplicateState = "SUGGESTED" | "LINKED" | "REJECTED" | "SPLIT";
type FixtureValue = string | number | null;

function addDashboardJob(id: string) {
  const job = { ...fixtureJob("job-retail-sales-assistant"), id, title: `Fictional ${id}` };
  sqlite!
    .prepare(
      `INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,
       application_status,date_discovered,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
    )
    .run(
      id,
      job.title,
      job.company,
      job.category,
      job.location,
      job.employmentType,
      JSON.stringify(job),
      dashboardTime,
      dashboardTime,
      dashboardTime,
    );
  sqlite!
    .prepare(
      `INSERT INTO job_versions (id,job_id,version,normalized_json,content_digest,created_at)
     VALUES (?,?,1,?,?,?)`,
    )
    .run(`${id}-v1`, id, JSON.stringify(job), "a".repeat(64), dashboardTime);
  return id;
}

function addDashboardObservation(
  id: string,
  jobId: string,
  observedAt = dashboardTime,
  expiresAt: string | null = null,
) {
  sqlite!
    .prepare(
      `INSERT INTO source_observations (id,job_id,source,acquisition_method,content_hash,
       raw_snapshot_reference,observed_at,expires_at,parser_version)
     VALUES (?,?,'SEEK','FIXTURE',?,'fictional-local',?,?, 'fixture-1')`,
    )
    .run(id, jobId, "b".repeat(64), observedAt, expiresAt);
  return id;
}

function addDashboardDuplicate(
  id: string,
  left: string,
  right: string,
  state: DuplicateState,
  updatedAt = dashboardTime,
) {
  const endpoints = [left, right].sort();
  sqlite!
    .prepare(
      `INSERT INTO r2_duplicate_candidates (id,left_observation_id,right_observation_id,
       detector_version,state,matched_signals_json,conflicting_signals_json,evidence_digest,created_at,updated_at)
     VALUES (?,?,?,'fictional-detector',?,'[]','[]',?,?,?)`,
    )
    .run(id, endpoints[0], endpoints[1], state, "c".repeat(64), dashboardTime, updatedAt);
}

function cloneDashboardRow(
  table: "job_versions" | "r2_evaluation_versions",
  id: string,
  overrides: Record<string, FixtureValue>,
) {
  const original = sqlite!.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<
    string,
    FixtureValue
  >;
  const row = { ...original, ...overrides },
    keys = Object.keys(row);
  sqlite!
    .prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}

function referenceDuplicateStates() {
  return sqlite!
    .prepare(
      `SELECT j.id,
    (SELECT c.state FROM r2_duplicate_candidates c
     WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id=j.id)
        OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id=j.id)
     ORDER BY CASE c.state WHEN 'SUGGESTED' THEN 0 ELSE 1 END,c.updated_at DESC LIMIT 1) AS duplicateState
    FROM jobs j ORDER BY j.id`,
    )
    .all();
}

describe("dashboard duplicate-state read", () => {
  it.each<DuplicateState>(["SUGGESTED", "LINKED", "REJECTED", "SPLIT"])(
    "preserves %s for both endpoints and NULL for unrelated jobs",
    (state) => {
      sqlite = fixtureDatabase();
      mocks.sqlite = sqlite;
      const left = addDashboardJob("job-fictional-left"),
        right = addDashboardJob("job-fictional-right");
      addDashboardDuplicate(
        "candidate-fictional",
        addDashboardObservation("observation-a", left),
        addDashboardObservation("observation-z", right),
        state,
      );
      const rows = listBetaJobs();
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.id === left)?.duplicateState).toBe(state);
      expect(rows.find((row) => row.id === right)?.duplicateState).toBe(state);
      expect(
        rows.find((row) => row.id === "job-persisted-inspection-packet-gate")?.duplicateState,
      ).toBeNull();
      expect(
        rows
          .map(({ id, duplicateState }) => ({ id, duplicateState }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(referenceDuplicateStates());
    },
  );

  it.each(["left", "right"])(
    "includes old observations on the %s side and keeps the latest expiry",
    (side) => {
      sqlite = fixtureDatabase();
      mocks.sqlite = sqlite;
      const job = addDashboardJob("job-fictional-history"),
        peer = addDashboardJob("job-fictional-peer");
      const old = addDashboardObservation(
        side === "left" ? "observation-a-old" : "observation-z-old",
        job,
      );
      const other = addDashboardObservation("observation-m-peer", peer);
      addDashboardObservation(
        "observation-new",
        job,
        "2026-10-01T00:00:00.000Z",
        "2026-10-02T00:00:00.000Z",
      );
      addDashboardDuplicate("candidate-old-observation", old, other, "SUGGESTED");
      expect(listBetaJobs().find((row) => row.id === job)).toMatchObject({
        duplicateState: "SUGGESTED",
        expiresAt: "2026-10-02T00:00:00.000Z",
      });
    },
  );

  it("keeps SUGGESTED ahead of newer resolutions and reads later decisions without a cache", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const job = addDashboardJob("job-fictional-priority"),
      peer = addDashboardJob("job-fictional-peer");
    const a = addDashboardObservation("observation-a", job),
      b = addDashboardObservation("observation-b", peer),
      c = addDashboardObservation("observation-c", peer);
    addDashboardDuplicate("candidate-old-suggestion", a, b, "SUGGESTED");
    addDashboardDuplicate("candidate-new-link", a, c, "LINKED", "2026-10-01T00:00:00.000Z");
    expect(listBetaJobs().find((row) => row.id === job)?.duplicateState).toBe("SUGGESTED");
    sqlite
      .prepare(
        "UPDATE r2_duplicate_candidates SET state='SPLIT' WHERE id='candidate-old-suggestion'",
      )
      .run();
    expect(listBetaJobs().find((row) => row.id === job)?.duplicateState).toBe("LINKED");
    expect(
      listBetaJobs()
        .map(({ id, duplicateState }) => ({ id, duplicateState }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(referenceDuplicateStates());
  });

  it("does not multiply job rows when both candidate endpoints belong to the same job", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const job = addDashboardJob("job-fictional-same-job");
    addDashboardDuplicate(
      "candidate-same-job",
      addDashboardObservation("observation-a", job),
      addDashboardObservation("observation-z", job),
      "REJECTED",
    );
    const rows = listBetaJobs();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.id === job)).toHaveLength(1);
    expect(rows.find((row) => row.id === job)?.duplicateState).toBe("REJECTED");
  });

  it("uses candidate rowid as the deterministic final timestamp tie instead of candidate ID", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const job = addDashboardJob("job-fictional-tie"),
      peer = addDashboardJob("job-fictional-peer");
    const a = addDashboardObservation("observation-a", job),
      b = addDashboardObservation("observation-b", peer),
      c = addDashboardObservation("observation-c", peer);
    addDashboardDuplicate("z-inserted-first", a, b, "LINKED");
    addDashboardDuplicate("a-inserted-second", a, c, "REJECTED");
    expect(listBetaJobs().find((row) => row.id === job)?.duplicateState).toBe("LINKED");
    expect(
      listBetaJobs()
        .map(({ id, duplicateState }) => ({ id, duplicateState }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(referenceDuplicateStates());
  });

  it("preserves latest job/evaluation/queue choices and all stale/null fields", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    const job = "job-persisted-inspection-packet-gate",
      base = "job-version-persisted-inspection-packet-gate";
    cloneDashboardRow("job_versions", base, {
      id: "version-latest",
      version: 2,
      created_at: "2026-10-01T00:00:00.000Z",
    });
    cloneDashboardRow("r2_evaluation_versions", "r2-evaluation:inspection-packet-gate", {
      id: "evaluation-latest",
      job_version_id: "version-latest",
      fit_score: 21,
      stale: 1,
      recommended: 0,
      unresolved_unknown_count: 3,
      unresolved_condition_count: 2,
      unresolved_conflict_count: 1,
      coverage_percent: 57,
      evaluated_at: "2026-10-01T00:00:00.000Z",
    });
    const insert =
      sqlite.prepare(`INSERT INTO r2_queue_decision_versions (id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,evidence_contract_version,duplicate_resolution_version,coverage_version,actor,reason_code,created_at)
      VALUES (?,?,?,? ,?,'version-latest','profile-version-persisted-inspection-packet-gate','evaluation-latest','fixture-1','fixture-1','fixture-1','SYSTEM',?,?)`);
    insert.run("queue-old", job, 1, "SHORTLISTED", "CURRENT", "OLDER_DECISION", dashboardTime);
    insert.run(
      "queue-new",
      job,
      2,
      "SKIPPED",
      "STALE",
      "LATEST_DECISION",
      "2026-10-01T00:00:00.000Z",
    );
    addDashboardJob("job-fictional-unevaluated");
    const rows = listBetaJobs();
    expect(rows[0]?.id).toBe("job-fictional-unevaluated");
    expect(rows.find((row) => row.id === job)).toMatchObject({
      jobVersionId: "version-latest",
      evaluationVersionId: "evaluation-latest",
      legacyEvaluationVersionId: "legacy-evaluation:inspection-packet-gate",
      eligibilityStatus: "ELIGIBLE",
      fitScore: 21,
      evaluationStale: true,
      recommended: false,
      unknownRequirementCount: 3,
      unresolvedConditionCount: 2,
      unresolvedConflictCount: 1,
      coveragePercent: 57,
      queueState: "SKIPPED",
      queueFreshness: "STALE",
      queueReason: "LATEST_DECISION",
      duplicateState: null,
    });
    expect(rows.find((row) => row.id === "job-fictional-unevaluated")).toMatchObject({
      evaluationVersionId: null,
      fitScore: null,
      queueState: null,
      coveragePercent: null,
      duplicateState: null,
      unknownRequirementCount: null,
      recommended: false,
    });
  });

  it("keeps the legacy branch usable without any R2 tables", () => {
    sqlite = new BetterSqlite3(":memory:");
    for (const name of migrationNames.slice(0, 3))
      sqlite.exec(
        readFileSync(
          new URL(`../../../packages/database/drizzle/${name}`, import.meta.url),
          "utf8",
        ),
      );
    mocks.sqlite = sqlite;
    addDashboardJob("job-fictional-legacy");
    expect(listBetaJobs()).toEqual([
      expect.objectContaining({
        id: "job-fictional-legacy",
        duplicateState: null,
        fitScore: null,
        coverage: null,
        unknownRequirementCount: 0,
        calibrationState: null,
      }),
    ]);
  });

  it("reads a dense fixture in one SQL snapshot with two uncorrelated candidate scans", () => {
    sqlite = fixtureDatabase();
    mocks.sqlite = sqlite;
    sqlite.transaction(() => {
      const observations = Array.from({ length: 120 }, (_, index) =>
        addDashboardObservation(
          `observation-${String(index).padStart(3, "0")}`,
          addDashboardJob(`job-fictional-${String(index).padStart(3, "0")}`),
        ),
      );
      for (let left = 0; left < observations.length; left++)
        for (let right = left + 1; right < observations.length; right++)
          addDashboardDuplicate(
            `candidate-${left}-${right}`,
            observations[left]!,
            observations[right]!,
            "SUGGESTED",
          );
    })();
    const prepare = vi.spyOn(sqlite, "prepare");
    sqlite.pragma("query_only=ON");
    const rows = listBetaJobs();
    expect(rows).toHaveLength(121);
    expect(rows.filter((row) => row.duplicateState === "SUGGESTED")).toHaveLength(120);
    const reads = prepare.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes("WITH duplicate_membership"));
    expect(reads).toHaveLength(1);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${reads[0]}`).all() as Array<{
      id: number;
      parent: number;
      detail: string;
    }>;
    const scans = plan.filter((row) => /SCAN c\b/.test(row.detail));
    expect(scans).toHaveLength(2);
    for (const scan of scans) {
      let parent = plan.find((row) => row.id === scan.parent);
      while (parent) {
        expect(parent.detail).not.toContain("CORRELATED");
        parent = plan.find((row) => row.id === parent!.parent);
      }
    }
    expect(sqlite.pragma("query_only", { simple: true })).toBe(1);
  });
});
