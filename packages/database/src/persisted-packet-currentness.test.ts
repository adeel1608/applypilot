import { readFileSync, readdirSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApplicationPacketSchema,
  packetDigest,
  PRIVATE_PREPARATION_VERIFICATION_POLICY as policy,
} from "@applypilot/application-runner";
import { resolvePersistedApplicationPacket } from "./persisted-packet";
import { currentR2EvaluationVersions } from "./r2-evaluation-currentness";

const databases: BetterSqlite3.Database[] = [],
  now = "2026-10-18T00:00:00.000Z";
function fixture() {
  const sqlite = new BetterSqlite3(":memory:");
  databases.push(sqlite);
  const folder = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(folder)
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort())
    sqlite.exec(readFileSync(new URL(name, folder), "utf8"));
  sqlite
    .prepare(
      "INSERT INTO jobs(id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job','Fictional role','Fictional employer','Fictional','Fictional','PART_TIME','{}','NEW',?,?,?)",
    )
    .run(now, now, now);
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles(id,active_version_id,created_at,updated_at) VALUES ('profile','profile:v1',?,?)",
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO candidate_profile_versions(id,profile_id,version,schema_version,snapshot_json,content_hash,created_at) VALUES ('profile:v1','profile',1,1,'{}',?,?)",
    )
    .run("a".repeat(64), now);
  sqlite
    .prepare(
      "INSERT INTO job_versions(id,job_id,version,normalized_json,content_digest,created_at) VALUES ('job:v1','job',1,'{}',?,?)",
    )
    .run("b".repeat(64), now);
  sqlite
    .prepare(
      "INSERT INTO evaluation_versions(id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,eligibility_engine_version,fit_engine_version,weight_version,stale,evaluated_at) VALUES ('legacy','job','job:v1','profile:v1','DEMO_PROFILE','ELIGIBLE','[]',90,'[]','{}','legacy','legacy','legacy',1,?)",
    )
    .run(now);
  const versions = currentR2EvaluationVersions();
  sqlite
    .prepare(
      "INSERT INTO r2_evaluation_versions(id,job_id,job_version_id,profile_version_id,evidence_contract_version,normalization_version,coverage_version,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,eligibility_engine_version,fit_scorer_version,weight_version,calibration_state,calibration_context_version,calibration_run_id,recommended,coverage_percent,unresolved_unknown_count,unresolved_condition_count,unresolved_conflict_count,stale,evaluated_at) VALUES ('r2','job','job:v1','profile:v1',?,?,?,'ELIGIBLE','[]',90,'[]',?,?,?,'UNCALIBRATED','fictional',NULL,1,100,0,0,0,0,?)",
    )
    .run(...Object.values(versions), now);
  sqlite
    .prepare(
      "INSERT INTO r2_queue_decision_versions(id,job_id,version,state,freshness,job_version_id,profile_version_id,r2_evaluation_id,evidence_contract_version,duplicate_resolution_version,coverage_version,actor,reason_code,created_at) VALUES ('queue','job',1,'PREPARING','CURRENT','job:v1','profile:v1','r2',?,'fictional',?,'OWNER','FICTIONAL',?)",
    )
    .run(versions.evidenceContractVersion, versions.coverageVersion, now);
  const packet = ApplicationPacketSchema.parse({
    id: "packet",
    jobId: "job",
    jobVersionId: "job:v1",
    profileVersionId: "profile:v1",
    evaluationVersionId: "legacy",
    r2EvaluationId: "r2",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: "http://127.0.0.1:4123/fictional",
    targetHost: "127.0.0.1",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "cv",
        type: "CV",
        fileName: "fictional.pdf",
        digest: "c".repeat(64),
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [],
    verificationEvidence: {
      verificationId: "fictional-missing-verification",
      verifiedAt: now,
      providerExpiresAt: null,
      policyVersion: policy.version,
      preparationMaxAgeMs: policy.preparationMaxAgeMs,
      preExternalActionMaxAgeMs: policy.preExternalActionMaxAgeMs,
      validUntil: "2026-10-19T00:00:00.000Z",
      operation: "PREPARATION",
      contentHash: "d".repeat(64),
    },
  });
  sqlite
    .prepare(
      "INSERT INTO application_packets(id,job_id,job_version_id,profile_version_id,evaluation_version_id,r2_evaluation_id,target_url,target_host,status,readiness_json,version,created_at,updated_at) VALUES ('packet','job','job:v1','profile:v1','legacy','r2',?,?,'READY_TO_APPLY',?,1,?,?)",
    )
    .run(
      packet.targetUrl,
      packet.targetHost,
      JSON.stringify({ packetDigest: packetDigest(packet), frozenPacket: packet }),
      now,
      now,
    );
  return {
    sqlite,
    resolve: () =>
      resolvePersistedApplicationPacket({
        sqlite,
        packetId: "packet",
        policy,
        operation: "PREPARATION",
        now: new Date(now),
      }),
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
describe("existing packet installed evaluation versions", () => {
  it("passes the current tuple to the independent verification ledger gate", () => {
    const f = fixture();
    expect(() => f.resolve()).toThrow("PACKET_VERIFICATION_EVIDENCE_MISMATCH");
  });
  it.each([
    "evidence_contract_version",
    "normalization_version",
    "coverage_version",
    "eligibility_engine_version",
    "fit_scorer_version",
    "weight_version",
  ])("rejects historical %s before reusing a frozen packet", (column) => {
    const f = fixture(),
      before = f.sqlite.prepare("SELECT readiness_json FROM application_packets").pluck().get();
    f.sqlite.prepare(`UPDATE r2_evaluation_versions SET ${column}='historical-version'`).run();
    if (column === "evidence_contract_version" || column === "coverage_version")
      f.sqlite
        .prepare(`UPDATE r2_queue_decision_versions SET ${column}='historical-version'`)
        .run();
    expect(() => f.resolve()).toThrow("PACKET_VERSION_STATE_REQUIRED");
    expect(f.sqlite.prepare("SELECT readiness_json FROM application_packets").pluck().get()).toBe(
      before,
    );
    expect(f.sqlite.prepare("SELECT stale FROM r2_evaluation_versions").pluck().get()).toBe(0);
  });
});
