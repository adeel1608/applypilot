import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeR2AJobEvidence } from "@applypilot/job-importer";

import { fixtureJob } from "../../../tests/fixture-data";
import {
  createDatabaseBackup,
  inspectDatabase,
  restoreDatabase,
} from "../../../scripts/lib/database-maintenance";
import { BetaRepository } from "./beta-repository";
import { R2ARepository, r2aSemanticDigest } from "./r2a-repository";

const roots: string[] = [];
const now = "2026-09-09T00:00:00.000Z";

function migration(name: string): string {
  return readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
}

function populateSchemaV2(databasePath: string): void {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.exec(migration("0000_applypilot_foundation.sql"));
    sqlite
      .prepare(
        `INSERT INTO job_sources
          (id,name,capabilities_json,enabled,created_at,updated_at)
         VALUES ('source:fixture','FIXTURE','{}',1,?,?)`,
      )
      .run(now, now);
    const job = fixtureJob("job-retail-sales-assistant");
    sqlite
      .prepare(
        `INSERT INTO jobs
          (id,title,company,category,location,employment_type,normalized_json,application_status,
           date_discovered,created_at,updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
      )
      .run(
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
    sqlite
      .prepare(
        `INSERT INTO job_source_records
          (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,
           discovered_at,fetched_at)
         VALUES ('record:fixture',?,'source:fixture','fixture-1','https://example.test/jobs/fixture','{}',?,?,?)`,
      )
      .run(job.id, "a".repeat(64), now, now);
    sqlite.exec(migration("0001_real_world_job_intake.sql"));
    sqlite.exec(migration("0002_personal_live_beta_core.sql"));
    const version = sqlite
      .prepare("SELECT id, source_observation_id AS observationId FROM job_versions LIMIT 1")
      .get() as { id: string; observationId: string };
    sqlite
      .prepare(
        `INSERT INTO job_field_evidence
          (id,job_version_id,field_name,source_observation_id,source_path,original_text,
           normalized_value_json,certainty,rule_id,extractor_version,created_at)
         VALUES ('legacy-field',?,'employmentType',?,'description','part-time',?,
           'MEDIUM','LEGACY_FIELD','2.0.0',?)`,
      )
      .run(version.id, version.observationId, JSON.stringify("PART_TIME"), now);
    sqlite
      .prepare(
        `INSERT INTO job_field_evidence
          (id,job_version_id,field_name,source_observation_id,source_path,original_text,
           normalized_value_json,certainty,rule_id,extractor_version,created_at)
         VALUES ('legacy-field-2',?,'location',?,'description','Fictional Place',?,
           'LOW','LEGACY_FIELD','2.0.0',?)`,
      )
      .run(version.id, version.observationId, JSON.stringify("Fictional Place"), now);
    sqlite
      .prepare(
        `INSERT INTO requirement_evidence
          (id,job_version_id,source_observation_id,source_path,start_offset,end_offset,
           original_text,normalized_proposition,modality,kind,condition_text,certainty,
           rule_id,extractor_version,created_at)
         VALUES ('legacyRequirement',?,?,'description',0,19,'experience preferred',
           'experience preferred','PREFERRED','EXPERIENCE',NULL,'MEDIUM',
           'LEGACY_REQUIREMENT','2.0.0',?)`,
      )
      .run(version.id, version.observationId, now);
    sqlite
      .prepare(
        `INSERT INTO requirement_evidence
          (id,job_version_id,source_observation_id,source_path,start_offset,end_offset,
           original_text,normalized_proposition,modality,kind,condition_text,certainty,
           rule_id,extractor_version,created_at)
         VALUES ('legacyRequirement2',?,?,'description',21,33,'RSA required',
           'RSA required','REQUIRED','CERTIFICATION',NULL,'HIGH',
           'LEGACY_REQUIREMENT','2.0.0',?)`,
      )
      .run(version.id, version.observationId, now);
  } finally {
    sqlite.close();
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("R2A additive migration and repository", () => {
  it("backs up schema v2, conservatively migrates, persists idempotently, and restores", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-r2a-"));
    roots.push(root);
    const data = join(root, "data");
    const databasePath = join(data, "applypilot.sqlite");
    const backupRoot = join(data, "private", "backups");
    await mkdir(backupRoot, { recursive: true });
    populateSchemaV2(databasePath);

    const backup = await createDatabaseBackup({
      databasePath,
      backupRoot,
      now: new Date(now),
      randomSuffix: "a1b2c3d4",
    });
    expect(backup.schemaVersion).toBe(2);

    const sqlite = new BetterSqlite3(databasePath);
    try {
      sqlite.exec(migration("0003_r2a_evidence_normalization.sql"));
      expect(sqlite.pragma("user_version", { simple: true })).toBe(3);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(sqlite.prepare("SELECT evidence_state FROM job_field_evidence_v2").pluck().get()).toBe(
        "UNKNOWN",
      );
      expect(
        sqlite.prepare("SELECT evidence_state FROM requirement_evidence_v2").pluck().get(),
      ).toBe("UNKNOWN");
      expect(
        Number(sqlite.prepare("SELECT count(*) FROM job_normalization_coverage").pluck().get()),
      ).toBe(17);
      expect(Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get())).toBe(1);
      const legacyVersionId = sqlite
        .prepare("SELECT id FROM job_versions ORDER BY version LIMIT 1")
        .pluck()
        .get() as string;
      expect(new R2ARepository(sqlite).getNormalizationResult(legacyVersionId)).toEqual({
        state: "LEGACY_NOT_AVAILABLE",
        normalization: null,
      });

      const observationId = sqlite
        .prepare("SELECT id FROM source_observations LIMIT 1")
        .pluck()
        .get() as string;
      const structured = {
        title: "Fictional R2A Analyst",
        hiringOrganization: { name: "Example Test Works" },
        jobLocation: {
          address: {
            addressLocality: "Parramatta",
            addressRegion: "NSW",
            postalCode: "2150",
            addressCountry: "AU",
          },
        },
        requirements: [
          "Two years experience preferred",
          "Valid Australian work rights required",
          "Cover letter not required",
        ],
      };
      const source = JSON.stringify(structured);
      const normalization = normalizeR2AJobEvidence({
        sourceText: source,
        sourceObservationId: observationId,
        structured,
      });
      const baseJob = fixtureJob("job-retail-sales-assistant");
      const repository = new BetaRepository(
        sqlite,
        () => new Date(now),
        () => "job-version:r2a",
      );
      const recorded = repository.recordJobVersion({
        job: { ...baseJob, dateUpdated: now },
        sourceObservationId: observationId,
        r2aNormalization: normalization,
      });
      expect(recorded.created).toBe(true);
      const r2a = new R2ARepository(sqlite, () => new Date(now));
      const summary = r2a.summary(recorded.id);
      expect(summary.coverageCount).toBe(17);
      expect(summary.fieldEvidenceCount + summary.requirementEvidenceCount).toBeGreaterThan(0);
      expect(r2aSemanticDigest(r2a.getNormalization(recorded.id)!)).toBe(
        r2aSemanticDigest(normalization),
      );
      expect(r2a.recordNormalization(recorded.id, normalization).created).toBe(false);
      const reloaded = r2a.getNormalization(recorded.id)!;
      expect(reloaded.parserVersion).toBe("3.1.0");
      const derived = reloaded.fieldEvidence.find(({ state }) => state === "DERIVED");
      expect(derived?.derivationInputIds.length).toBeGreaterThan(1);
      expect(
        derived?.derivationInputIds.every((id) =>
          reloaded.fieldEvidence.some((evidence) => evidence.id === id),
        ),
      ).toBe(true);
      const corrected = new BetaRepository(sqlite, () => new Date(now)).recordOwnerCorrection({
        job: { ...baseJob, title: "Corrected Fictional R2A Analyst", dateUpdated: now },
        reasonCode: "OWNER_REVIEWED_FIELDS",
        changedFields: ["title"],
      });
      const correctedNormalization = r2a.getNormalization(corrected.id);
      expect(
        correctedNormalization?.fieldEvidence.find(
          ({ canonicalField }) => canonicalField === "title",
        ),
      ).toMatchObject({
        state: "OWNER_CORRECTED",
        ruleId: "R2A_OWNER_CORRECTED",
      });
      expect(sqlite.prepare("SELECT count(*) FROM job_corrections").pluck().get()).toBe(1);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      sqlite
        .prepare(
          "UPDATE job_field_evidence_v2 SET excerpt_hash = ? WHERE job_version_id = ? AND rowid = (SELECT min(rowid) FROM job_field_evidence_v2 WHERE job_version_id = ?)",
        )
        .run("f".repeat(64), recorded.id, recorded.id);
      expect(r2a.getNormalizationResult(recorded.id)).toEqual({
        state: "INVALID",
        normalization: null,
      });
    } finally {
      sqlite.close();
    }

    const restored = await restoreDatabase({
      databasePath,
      backupRoot,
      backupId: backup.backupId,
      confirmation: `RESTORE:${backup.backupId}`,
      now: new Date("2026-09-09T00:01:00.000Z"),
    });
    expect(restored.restored.schemaVersion).toBe(2);
    expect(inspectDatabase(databasePath).tableCounts.requirement_evidence).toBe(2);
  });

  it("rejects evidence linked to a different immutable observation", () => {
    const sqlite = new BetterSqlite3(":memory:");
    try {
      for (const name of [
        "0000_applypilot_foundation.sql",
        "0001_real_world_job_intake.sql",
        "0002_personal_live_beta_core.sql",
        "0003_r2a_evidence_normalization.sql",
      ]) {
        sqlite.exec(migration(name));
      }
      expect(() => new R2ARepository(sqlite).recordNormalization("missing", {} as never)).toThrow();
    } finally {
      sqlite.close();
    }
  });
});
