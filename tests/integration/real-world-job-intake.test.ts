import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  candidateProfileContentHash,
  type CandidateProfileProvider,
} from "@applypilot/candidate-profile";
import { ApplicationPacketSchema } from "@applypilot/application-runner";
import {
  assertCurrentDocumentGenerationTuple,
  BetaRepository,
  JobImportRepository,
} from "@applypilot/database";
import { prepareJobImport } from "@applypilot/job-importer";
import { testProfile } from "../fixture-data";

const migration = [
  "0000_applypilot_foundation.sql",
  "0001_real_world_job_intake.sql",
  "0002_personal_live_beta_core.sql",
]
  .map((file) =>
    readFileSync(new URL(`../../packages/database/drizzle/${file}`, import.meta.url), "utf8"),
  )
  .join("\n");
const fixedNow = () => new Date("2026-09-05T12:00:00.000Z");
const r2aMigration = readFileSync(
  new URL("../../packages/database/drizzle/0003_r2a_evidence_normalization.sql", import.meta.url),
  "utf8",
);
const content = `Title: Fictional Community Assistant
Company: Example Harbour Services
Location: Sydney NSW 2000
Employment type: Part time
Description: Support visitors, update records, communicate clearly, and hold a driver's licence as required.
Requirements:
- Clear communication
- Accurate data entry
- A driver's licence is required.`;

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
    expect(sqlite.prepare("SELECT COUNT(*) FROM evaluation_versions").pluck().get()).toBe(0);
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
    expect(sqlite.prepare("SELECT COUNT(*) FROM evaluation_versions").pluck().get()).toBe(0);
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
    expect(sqlite.prepare("SELECT COUNT(*) FROM source_observations").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_versions").pluck().get()).toBe(1);
    expect(
      sqlite.prepare("SELECT COUNT(*) FROM requirement_evidence").pluck().get(),
    ).toBeGreaterThan(0);
    expect(
      sqlite
        .prepare(
          `SELECT evaluation_context AS context, job_version_id AS jobVersionId,
                  profile_version_id AS profileVersionId, coverage_json AS coverageJson
           FROM evaluation_versions`,
        )
        .get(),
    ).toMatchObject({
      context: "PRIVATE_LOCAL_PROFILE",
      jobVersionId: expect.any(String),
      profileVersionId: expect.any(String),
      coverageJson: expect.any(String),
    });
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
    expect(sqlite.prepare("SELECT COUNT(*) FROM source_observations").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_versions").pluck().get()).toBe(1);
  });

  it("retains changed-import history and evaluates the explicitly updated current version", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile: testProfile }),
    };
    const first = repository.stage(prepared());
    await repository.confirm(
      first.importId,
      first.previewToken,
      selection(first.records[0]!.recordId),
      provider,
    );
    const changed = prepareJobImport(
      {
        inputType: "PASTED_SINGLE",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: `${content}\n- First aid certification is required.`,
      },
      { now: () => new Date("2026-09-05T12:01:00.000Z") },
    );
    const staged = repository.stage(changed);
    const selected = selection(staged.records[0]!.recordId);
    selected[0]!.allowUpdate = true;
    const result = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selected,
      provider,
    );
    expect(result).toMatchObject({ imported: 0, updated: 1, duplicates: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM source_observations").pluck().get()).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_versions").pluck().get()).toBe(2);
    expect(
      sqlite
        .prepare(
          `SELECT e.job_version_id AS evaluated, v.id AS currentVersion
           FROM evaluation_versions e
           JOIN job_versions v ON v.job_id = e.job_id
           ORDER BY e.evaluated_at DESC, e.rowid DESC, v.version DESC LIMIT 1`,
        )
        .get(),
    ).toEqual(expect.objectContaining({ evaluated: expect.any(String) }));
    const currentVersion = sqlite
      .prepare("SELECT id FROM job_versions ORDER BY version DESC LIMIT 1")
      .pluck()
      .get();
    const currentEvaluationVersion = sqlite
      .prepare("SELECT job_version_id FROM evaluation_versions ORDER BY rowid DESC LIMIT 1")
      .pluck()
      .get();
    expect(currentEvaluationVersion).toBe(currentVersion);
  });

  it("reprocesses exact stored one-job provenance with current evidence and preserves history", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile: testProfile }),
    };
    const staged = repository.stage(prepared());
    const confirmed = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    const jobId = confirmed.jobs[0]!.jobId;
    const originalObservation = sqlite
      .prepare("SELECT id FROM source_observations WHERE job_id = ?")
      .pluck()
      .get(jobId);
    const result = await repository.reprocessLegacyJob(jobId, provider);
    expect(result).toMatchObject({
      jobId,
      sourceObservationId: originalObservation,
      evaluationState: "PRIVATE_LOCAL_PROFILE",
      requirementEvidenceCount: expect.any(Number),
    });
    expect(result.previousJobVersionId).not.toBe(result.jobVersionId);
    expect(result.requirementEvidenceCount).toBeGreaterThan(0);
    expect(sqlite.prepare("SELECT COUNT(*) FROM source_observations").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_versions").pluck().get()).toBe(2);
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) FROM requirement_evidence
           WHERE job_version_id = ? AND source_observation_id = ?`,
        )
        .pluck()
        .get(result.jobVersionId, originalObservation),
    ).toBeGreaterThan(0);
    expect(
      sqlite
        .prepare(
          `SELECT DISTINCT extractor_version FROM requirement_evidence
           WHERE job_version_id = ?`,
        )
        .pluck()
        .get(result.jobVersionId),
    ).toBe("2.0.0");
    expect(
      sqlite
        .prepare("SELECT job_version_id FROM evaluation_versions WHERE id = ?")
        .pluck()
        .get(result.evaluationVersionId),
    ).toBe(result.jobVersionId);
  });

  it("reprocesses a migrated legacy job into R2A without running another evaluation", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile: testProfile }),
    };
    const staged = repository.stage(prepared());
    const confirmed = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    const jobId = confirmed.jobs[0]!.jobId;
    expect(sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get()).toBe(1);
    sqlite.exec(r2aMigration);

    const result = await repository.reprocessLegacyJobR2A(jobId);

    expect(result).toMatchObject({
      coverageCount: 17,
      fieldEvidenceCount: expect.any(Number),
      requirementEvidenceCount: expect.any(Number),
    });
    expect(result.previousJobVersionId).not.toBe(result.jobVersionId);
    expect(sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT stale FROM evaluation_versions").pluck().get()).toBe(1);
    expect(
      sqlite
        .prepare("SELECT count(*) FROM job_normalization_coverage WHERE job_version_id = ?")
        .pluck()
        .get(result.jobVersionId),
    ).toBe(17);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("refuses to guess legacy boundaries for a stored multi-job batch", async () => {
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile: testProfile }),
    };
    const multi = prepareJobImport(
      {
        inputType: "PASTED_MULTI",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: `${content}\n--- JOB ---\n${content.replace(
          "Fictional Community Assistant",
          "Fictional Community Coordinator",
        )}`,
      },
      { now: fixedNow },
    );
    const staged = repository.stage(multi);
    const selections = staged.records.map(({ recordId }) => ({
      recordId,
      selected: true,
      edits: {},
      acknowledgedWarnings: [],
      allowUpdate: false,
    }));
    const result = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selections,
      provider,
    );
    await expect(repository.reprocessLegacyJob(result.jobs[0]!.jobId, provider)).rejects.toThrow(
      "LEGACY_REPROCESS_REQUIRES_OWNER_REIMPORT",
    );
  });

  it("reactivates the identical A profile version after A to B to A", async () => {
    let activeProfile = testProfile;
    const provider: CandidateProfileProvider = {
      resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile: activeProfile }),
    };
    const staged = repository.stage(prepared());
    const confirmed = await repository.confirm(
      staged.importId,
      staged.previewToken,
      selection(staged.records[0]!.recordId),
      provider,
    );
    const jobId = confirmed.jobs[0]!.jobId;
    const aId = sqlite
      .prepare("SELECT active_version_id FROM candidate_profiles WHERE id = ?")
      .pluck()
      .get(testProfile.profileId);
    const aTuple = sqlite
      .prepare(
        `SELECT v.id AS jobVersionId, e.id AS evaluationVersionId,
                e.eligibility_status AS eligibilityStatus
         FROM job_versions v JOIN evaluation_versions e ON e.job_version_id = v.id
         WHERE v.job_id = ? ORDER BY e.rowid DESC LIMIT 1`,
      )
      .get(jobId) as {
      jobVersionId: string;
      evaluationVersionId: string;
      eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED";
    };
    expect(
      assertCurrentDocumentGenerationTuple({
        sqlite,
        profile: testProfile,
        jobVersionId: aTuple.jobVersionId,
        evaluationVersionId: aTuple.evaluationVersionId,
      }),
    ).toEqual({ profileVersionId: aId });
    const changedFileProfile = {
      ...testProfile,
      preferences: {
        ...testProfile.preferences,
        preferredCategories: [...testProfile.preferences.preferredCategories, "Changed file"],
      },
    };
    expect(() =>
      assertCurrentDocumentGenerationTuple({
        sqlite,
        profile: changedFileProfile,
        jobVersionId: aTuple.jobVersionId,
        evaluationVersionId: aTuple.evaluationVersionId,
      }),
    ).toThrow("PROFILE_VERSION_STALE_REEVALUATE_REQUIRED");
    const beta = new BetaRepository(sqlite, fixedNow);
    const artifact = beta.recordDocumentArtifact({
      id: "document:profile-a",
      jobId,
      jobVersionId: aTuple.jobVersionId,
      profileVersionId: String(aId),
      type: "CV",
      template: "fictional",
      format: "PDF",
      fileName: "fictional.pdf",
      localPath: "documents/fictional.pdf",
      contentDigest: "d".repeat(64),
      claimEvidence: ["fictional:fact"],
      layoutResult: { pageCount: 1 },
    });
    beta.approveDocument({ documentArtifactId: artifact.id, contentDigest: "d".repeat(64) });
    beta.persistApplicationPacket(
      ApplicationPacketSchema.parse({
        id: "packet:profile-a",
        jobId,
        jobVersionId: aTuple.jobVersionId,
        profileVersionId: String(aId),
        evaluationVersionId: aTuple.evaluationVersionId,
        eligibilityStatus: aTuple.eligibilityStatus,
        targetUrl: null,
        targetHost: null,
        jobExpiryState: "UNKNOWN",
        duplicateState: "CLEAR",
        versionsCurrent: true,
        documents: [
          {
            id: artifact.id,
            type: "CV",
            fileName: "fictional.pdf",
            digest: "d".repeat(64),
            approved: true,
            stale: false,
            required: true,
          },
        ],
        answers: [],
      }),
    );
    activeProfile = {
      ...testProfile,
      preferences: {
        ...testProfile.preferences,
        preferredCategories: [...testProfile.preferences.preferredCategories, "Fictional B"],
      },
    };
    await repository.reevaluateExistingJob(jobId, provider);
    const bId = sqlite
      .prepare("SELECT active_version_id FROM candidate_profiles WHERE id = ?")
      .pluck()
      .get(testProfile.profileId);
    expect(bId).not.toBe(aId);
    expect(() =>
      assertCurrentDocumentGenerationTuple({
        sqlite,
        profile: activeProfile,
        jobVersionId: aTuple.jobVersionId,
        evaluationVersionId: aTuple.evaluationVersionId,
      }),
    ).toThrow("EVALUATION_STALE_REEVALUATE_REQUIRED");
    expect(
      sqlite
        .prepare("SELECT stale FROM document_artifacts WHERE id = 'document:profile-a'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      sqlite
        .prepare(
          "SELECT invalidated_at IS NOT NULL FROM document_approvals WHERE document_artifact_id = 'document:profile-a'",
        )
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      sqlite
        .prepare("SELECT status FROM application_packets WHERE id = 'packet:profile-a'")
        .pluck()
        .get(),
    ).toBe("INVALIDATED");
    activeProfile = testProfile;
    await repository.reevaluateExistingJob(jobId, provider);
    expect(
      sqlite
        .prepare("SELECT active_version_id FROM candidate_profiles WHERE id = ?")
        .pluck()
        .get(testProfile.profileId),
    ).toBe(aId);
    expect(sqlite.prepare("SELECT COUNT(*) FROM candidate_profile_versions").pluck().get()).toBe(2);
    expect(
      sqlite
        .prepare("SELECT stale FROM document_artifacts WHERE id = 'document:profile-a'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      sqlite
        .prepare("SELECT content_hash FROM candidate_profile_versions WHERE id = ?")
        .pluck()
        .get(aId),
    ).toBe(candidateProfileContentHash(testProfile));
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
