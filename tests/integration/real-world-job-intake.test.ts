import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateProfileProvider } from "@applypilot/candidate-profile";
import { JobImportRepository } from "@applypilot/database";
import { prepareJobImport } from "@applypilot/job-importer";
import { testProfile } from "../fixture-data";

const migration = ["0000_applypilot_foundation.sql", "0001_real_world_job_intake.sql"]
  .map((file) =>
    readFileSync(new URL(`../../packages/database/drizzle/${file}`, import.meta.url), "utf8"),
  )
  .join("\n");
const fixedNow = () => new Date("2026-09-05T12:00:00.000Z");
const content = `Title: Fictional Community Assistant
Company: Example Harbour Services
Location: Sydney NSW 2000
Employment type: Part time
Description: Support visitors, update records, and communicate clearly with the local team.
Requirements:
- Clear communication
- Accurate data entry`;

function prepared() {
  return prepareJobImport(
    {
      inputType: "PASTED_SINGLE",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content,
    },
    { now: fixedNow },
  );
}

function selection(recordId: string) {
  return [
    {
      recordId,
      selected: true,
      edits: {},
      acknowledgedWarnings: ["SPLIT_REVIEW_REQUIRED"],
      allowUpdate: false,
    },
  ];
}

describe("real-world job intake persistence and profile gate", () => {
  let sqlite: BetterSqlite3.Database;
  let repository: JobImportRepository;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(migration);
    repository = new JobImportRepository(sqlite, fixedNow);
  });

  afterEach(() => sqlite.close());

  it("persists a real import but leaves it not evaluated when no private profile exists", async () => {
    const provider: CandidateProfileProvider = {
      resolve: vi.fn<CandidateProfileProvider["resolve"]>(async () => ({
        state: "NO_ACTIVE_PROFILE",
        reasonCode: "PRIVATE_PROFILE_MISSING",
      })),
    };
    const staged = repository.stage(prepared());
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(0);
    const result = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    expect(result).toMatchObject({ imported: 1, updated: 0, duplicates: 0 });
    expect(result.jobs[0]?.evaluationState).toBe("NO_ACTIVE_PROFILE");
    expect(sqlite.prepare("SELECT eligibility_status, fit_score FROM jobs").get()).toEqual({
      eligibility_status: null,
      fit_score: null,
    });
    expect(sqlite.prepare("SELECT COUNT(*) FROM eligibility_results").pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) FROM fit_scores").pluck().get()).toBe(0);
  });

  it("never scores a real imported job with a demo profile", async () => {
    const provider: CandidateProfileProvider = {
      resolve: vi.fn<CandidateProfileProvider["resolve"]>(async () => ({
        state: "DEMO_PROFILE",
        profile: testProfile,
      })),
    };
    const staged = repository.stage(prepared());
    const result = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    expect(result.jobs[0]?.evaluationState).toBe("NO_ACTIVE_PROFILE");
    expect(sqlite.prepare("SELECT COUNT(*) FROM eligibility_results").pluck().get()).toBe(0);
  });

  it("evaluates with a valid private profile and records profile-version provenance", async () => {
    const provider: CandidateProfileProvider = {
      resolve: vi.fn<CandidateProfileProvider["resolve"]>(async () => ({
        state: "PRIVATE_LOCAL_PROFILE",
        profile: testProfile,
      })),
    };
    const staged = repository.stage(prepared());
    const result = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    expect(result.jobs[0]?.evaluationState).toBe("PRIVATE_LOCAL_PROFILE");
    expect(sqlite.prepare("SELECT eligibility_status, fit_score FROM jobs").get()).toMatchObject({
      eligibility_status: expect.any(String),
      fit_score: expect.any(Number),
    });
    expect(sqlite.prepare("SELECT COUNT(*) FROM candidate_profile_versions").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM eligibility_results").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM fit_scores").pluck().get()).toBe(1);
    const audits = JSON.stringify(
      sqlite.prepare("SELECT redacted_metadata_json FROM audit_events").all(),
    );
    expect(audits).not.toContain(testProfile.contact.email.value);
    expect(audits).not.toContain("referee");
  });

  it("deduplicates an unchanged second import and rejects token replay", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "NO_ACTIVE_PROFILE", reasonCode: "PRIVATE_PROFILE_MISSING" }),
    };
    const first = repository.stage(prepared());
    await repository.confirm(
      first.importId,
      first.previewToken,
      selection(first.records[0]!.recordId),
      provider,
    );
    await expect(
      repository.confirm(
        first.importId,
        first.previewToken,
        selection(first.records[0]!.recordId),
        provider,
      ),
    ).rejects.toThrow("PREVIEW_NOT_CONFIRMABLE");
    const second = repository.stage(prepared());
    expect(second.records[0]?.duplicateDecision).toBe("DUPLICATE_UNCHANGED");
    const result = await repository.confirm(
      second.importId,
      second.previewToken,
      selection(second.records[0]!.recordId),
      provider,
    );
    expect(result).toMatchObject({ imported: 0, duplicates: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(1);
  });

  it("enforces canonical identity consistency in SQLite", () => {
    sqlite
      .prepare(
        "INSERT INTO job_sources (id,name,capabilities_json,enabled,created_at,updated_at) VALUES ('source:unknown','UNKNOWN','{}',1,'now','now')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO jobs (id,title,company,category,location,employment_type,normalized_json,application_status,date_discovered,created_at,updated_at) VALUES ('job:1','Role','Company','Category','Sydney','UNKNOWN','{}','NEW','now','now','now')",
      )
      .run();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO job_source_records
            (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,discovered_at,
             identity_kind,identity_value,acquisition_method)
           VALUES ('record:bad','job:1','source:unknown',NULL,NULL,'{}',?,'now','EXTERNAL_ID','fake','UNKNOWN')`,
        )
        .run("a".repeat(64)),
    ).toThrow();
  });

  it("blocks conflicting external-ID and canonical-URL matches", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({
        state: "NO_ACTIVE_PROFILE",
        reasonCode: "PRIVATE_PROFILE_MISSING",
      }),
    };
    const prepareIdentity = (title: string, externalId: string, sourceUrl: string) =>
      prepareJobImport({
        inputType: "PASTED_SINGLE",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: `Title: ${title}
Company: Example Identity Co
Location: Sydney NSW
Description: A complete fictional identity-test job description.
External ID: ${externalId}
URL: ${sourceUrl}`,
      });
    for (const preparedIdentity of [
      prepareIdentity("Identity One", "external-one", "https://careers.example.test/jobs/one"),
      prepareIdentity("Identity Two", "external-two", "https://careers.example.test/jobs/two"),
    ]) {
      const staged = repository.stage(preparedIdentity);
      await repository.confirm(
        staged.importId,
        staged.previewToken,
        selection(staged.records[0]!.recordId),
        provider,
      );
    }
    const conflict = repository.stage(
      prepareIdentity(
        "Conflicting Identity",
        "external-one",
        "https://careers.example.test/jobs/two",
      ),
    );
    expect(conflict.records[0]?.duplicateDecision).toBe("IDENTITY_CONFLICT");
    await expect(
      repository.confirm(
        conflict.importId,
        conflict.previewToken,
        selection(conflict.records[0]!.recordId),
        provider,
      ),
    ).rejects.toThrow("IDENTITY_CONFLICT");
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(2);
  });
});
