import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  RunnerTargetCapabilitySchema,
  freezeRunnerBinding,
} from "@applypilot/application-runner";

import { RunnerEnablementRepository } from "./runner-enablement-repository";

const now = new Date("2026-09-10T00:00:00.000Z");

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
  ]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  const timestamp = now.toISOString();
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:1','profile-version:1',?,?)",
    )
    .run(timestamp, timestamp);
  sqlite
    .prepare(
      "INSERT INTO candidate_profile_versions (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at) VALUES ('profile-version:1','profile:1',1,1,'{}',?,?)",
    )
    .run("a".repeat(64), timestamp);
  sqlite
    .prepare(
      "INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job:1','Fictional role','Fictional company','Operations','Melbourne VIC','PART_TIME','{}','NEW',?,?,?)",
    )
    .run(timestamp, timestamp, timestamp);
  sqlite
    .prepare(
      "INSERT INTO job_versions (id,job_id,version,normalized_json,content_digest,created_at) VALUES ('job-version:1','job:1',1,'{}',?,?)",
    )
    .run("b".repeat(64), timestamp);
  sqlite
    .prepare(
      "INSERT INTO evaluation_versions (id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,eligibility_engine_version,fit_engine_version,weight_version,evaluated_at) VALUES ('evaluation:1','job:1','job-version:1','profile-version:1','DEMO_PROFILE','ELIGIBLE','[]',80,'[]','{}','fixture','fixture','fixture',?)",
    )
    .run(timestamp);
  sqlite
    .prepare(
      "INSERT INTO application_packets (id,job_id,job_version_id,profile_version_id,evaluation_version_id,target_url,target_host,status,readiness_json,version,created_at,updated_at) VALUES ('packet:1','job:1','job-version:1','profile-version:1','evaluation:1','http://127.0.0.1:4123/synthetic-application','127.0.0.1','READY_TO_APPLY','{}',1,?,?)",
    )
    .run(timestamp, timestamp);
  sqlite
    .prepare(
      "INSERT INTO application_runs (id,packet_id,target_kind,target_host,form_version,state,created_at,updated_at) VALUES ('run:1','packet:1','SYNTHETIC_LOCAL','127.0.0.1','synthetic-form-v1','PREPARED',?,?)",
    )
    .run(timestamp, timestamp);
  return sqlite;
}

function capability() {
  return RunnerTargetCapabilitySchema.parse({
    schemaVersion: 1,
    capabilityId: "runner-synthetic-fixture",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local form",
    allowedOrigin: "http://127.0.0.1:4123",
    allowedPathPrefix: "/synthetic-application",
    formVersion: "synthetic-form-v1",
    adapterVersion: "synthetic-adapter-v1",
    approvalState: "APPROVED",
    approvalReference: "fixture-approval",
    approvedAt: now.toISOString(),
    policyVersion: "offline-fixture-v1",
    policyExpiresAt: "2027-09-10T00:00:00.000Z",
    capabilityExpiresAt: "2027-09-10T00:00:00.000Z",
    revokedAt: null,
  });
}

function packet() {
  return ApplicationPacketSchema.parse({
    id: "packet:1",
    jobId: "job:1",
    jobVersionId: "job-version:1",
    profileVersionId: "profile-version:1",
    evaluationVersionId: "evaluation:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: "http://127.0.0.1:4123/synthetic-application",
    targetHost: "127.0.0.1",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "doc:1",
        type: "CV",
        fileName: "fictional.pdf",
        digest: "c".repeat(64),
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "q:1",
        questionText: "Fictional",
        required: true,
        sensitive: true,
        value: true,
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:fictional"],
      },
    ],
  });
}

describe("runner enablement persistence", () => {
  it("persists immutable target approval and an exact frozen run binding", () => {
    const sqlite = database();
    let sequence = 0;
    const repository = new RunnerEnablementRepository(
      sqlite,
      () => now,
      () => `id:${++sequence}`,
    );
    expect(repository.persistTargetCapabilityVersion(capability())).toMatchObject({
      created: true,
    });
    expect(repository.persistTargetCapabilityVersion(capability())).toMatchObject({
      created: false,
    });
    const binding = freezeRunnerBinding(packet(), capability());
    repository.bindRun({ runId: "run:1", binding, targetCapability: capability() });
    expect(repository.currentBinding("run:1")).toEqual(binding);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM audit_events WHERE event_type LIKE 'runner.%'")
        .get(),
    ).toEqual({ count: 2 });
    sqlite.close();
  });

  it("stores only consent hashes and atomically rejects replay", () => {
    const sqlite = database();
    let sequence = 0;
    const repository = new RunnerEnablementRepository(
      sqlite,
      () => now,
      () => `id:${++sequence}`,
    );
    repository.persistTargetCapabilityVersion(capability());
    const binding = freezeRunnerBinding(packet(), capability());
    repository.bindRun({ runId: "run:1", binding, targetCapability: capability() });
    const store = repository.consentStore("run:1");
    const consent = store.issue(binding, 60_000);
    const stored = sqlite
      .prepare("SELECT token_hash AS tokenHash FROM final_action_consents WHERE id=?")
      .get(consent.id) as { tokenHash: string };
    expect(stored.tokenHash).toBe(consent.tokenHash);
    expect(JSON.stringify(stored)).not.toContain(consent.token);
    expect(store.consume({ id: consent.id, token: consent.token, binding, now })).toBe(true);
    expect(store.consume({ id: consent.id, token: consent.token, binding, now })).toBe(false);
    sqlite.close();
  });

  it("invalidates a bound run when a newer revocation version exists", () => {
    const sqlite = database();
    let sequence = 0;
    const repository = new RunnerEnablementRepository(
      sqlite,
      () => now,
      () => `revoked:${++sequence}`,
    );
    const approved = capability();
    repository.persistTargetCapabilityVersion(approved);
    const binding = freezeRunnerBinding(packet(), approved);
    repository.bindRun({ runId: "run:1", binding, targetCapability: approved });
    repository.persistTargetCapabilityVersion({
      ...approved,
      version: 2,
      predecessorVersion: 1,
      approvalState: "REVOKED",
      approvalReference: null,
      approvedAt: null,
      revokedAt: now.toISOString(),
    });
    expect(() => repository.currentBinding("run:1")).toThrow("TARGET_CAPABILITY_CHANGED");
    expect(() => repository.assertTargetCapabilityCurrent(approved)).toThrow(
      "TARGET_CAPABILITY_CHANGED",
    );
    sqlite.close();
  });

  it("records strict recovery metadata and rejects candidate-shaped fields", () => {
    const sqlite = database();
    const repository = new RunnerEnablementRepository(
      sqlite,
      () => now,
      () => "event:1",
    );
    repository.recordRecoveryEvent("run:1", {
      decision: "PAUSE",
      reasonCode: "CAPTCHA",
      safeMetadata: { state: "PAUSED", ownerActionRequired: true },
    });
    expect(
      sqlite.prepare("SELECT decision,reason_code AS reasonCode FROM runner_recovery_events").get(),
    ).toEqual({ decision: "PAUSE", reasonCode: "CAPTCHA" });
    expect(() =>
      repository.recordRecoveryEvent("run:1", {
        decision: "PAUSE",
        reasonCode: "MFA",
        safeMetadata: { state: "PAUSED", candidateName: "forbidden" } as never,
      }),
    ).toThrow();
    sqlite.close();
  });
});
