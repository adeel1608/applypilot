import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  enforceEvaluationProfile,
  type CandidateProfile,
  type CandidateProfileProvider,
  type CandidateProfileRuntimeState,
} from "@applypilot/candidate-profile";
import { evaluateEligibility } from "@applypilot/eligibility-engine";
import { scoreJobFit } from "@applypilot/fit-scorer";
import {
  canonicalizeJobUrl,
  deriveJobIdentity,
  JobFieldEditsSchema,
  ParsedJobFieldsSchema,
  sha256,
  type DetectedJobSource,
  type ImportedJobDraft,
  type JobFieldEdits,
  type PreparedJobImport,
} from "@applypilot/job-importer";
import { JobSchema, type Job } from "@applypilot/job-model";

const tokenLifetimeMs = 30 * 60 * 1000;
const selectionSchema = z.object({
  recordId: z.string().uuid(),
  selected: z.boolean(),
  edits: JobFieldEditsSchema.default({}),
  acknowledgedWarnings: z.array(z.string().min(1).max(100)).max(100).default([]),
  allowUpdate: z.boolean().default(false),
});

export interface StagedImportPreview {
  importId: string;
  previewToken: string;
  expiresAt: string;
  records: Array<
    ImportedJobDraft & {
      duplicateDecision:
        | "NEW"
        | "DUPLICATE_UNCHANGED"
        | "UPDATE_REVIEW_REQUIRED"
        | "IDENTITY_CONFLICT";
    }
  >;
}

export interface ConfirmImportResult {
  importId: string;
  imported: number;
  updated: number;
  duplicates: number;
  skipped: number;
  jobs: Array<{
    jobId: string;
    evaluationState: CandidateProfileRuntimeState | "EVALUATION_FAILED";
  }>;
}

type StoredRecord = {
  id: string;
  batchId: string;
  ordinal: number;
  splitStatus: string;
  recordStatus: string;
  detectedSource: DetectedJobSource;
  acquisitionMethod: "USER_SUPPLIED_CONTENT" | "FILE_UPLOAD";
  sourceConfidence: string;
  segmentContentHash: string;
  originalFieldsJson: string;
  warningsJson: string;
};

type StoredBatch = {
  id: string;
  parserVersion: string;
  contentHash: string;
  status: string;
  createdAt: string;
};

function hashToken(token: string): string {
  return sha256(token);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenKey(importId: string): string {
  return `job-import.preview-token.${importId}`;
}

function sourceId(source: DetectedJobSource): string {
  return `source:${source.toLowerCase()}`;
}

function normalizeImportedJob(
  fields: z.infer<typeof ParsedJobFieldsSchema>,
  source: DetectedJobSource,
  provenance: {
    importId: string;
    recordId: string;
    parserVersion: string;
    acquisitionMethod: string;
    contentHash: string;
    now: string;
    editedFields: string[];
  },
  id: string = randomUUID(),
): Job {
  if (!fields.title || !fields.company || !fields.location || !fields.description) {
    throw new Error("MISSING_REQUIRED_IMPORT_FIELDS");
  }
  const postcode = fields.location.match(/\b(\d{4})\b/)?.[1] ?? null;
  const state =
    fields.location.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)?.[1]?.toUpperCase() ?? null;
  const normalizedState = state as Job["state"];
  return JobSchema.parse({
    id,
    externalId: fields.externalId,
    source,
    sourceUrl: fields.sourceUrl,
    title: fields.title,
    company: fields.company,
    category: fields.category ?? "Unclassified",
    location: fields.location,
    suburb: null,
    postcode,
    state: normalizedState,
    country: state || postcode ? "Australia" : "Unknown",
    estimatedCommuteKm: null,
    employmentType: fields.employmentType,
    casual: fields.employmentType === "CASUAL",
    partTime: fields.employmentType === "PART_TIME",
    fullTime: fields.employmentType === "FULL_TIME",
    contract: fields.employmentType === "CONTRACT",
    internship: fields.employmentType === "INTERNSHIP",
    salary: fields.salaryText
      ? { minimum: null, maximum: null, currency: "AUD", period: "YEAR", text: fields.salaryText }
      : null,
    hoursPerWeek: null,
    hoursPerFortnight: null,
    schedule: { summary: null, fixed: null, shifts: [] },
    description: fields.description,
    responsibilities: fields.responsibilities,
    requirements: fields.requirements,
    preferredRequirements: [],
    requiredSkills: [],
    experienceRequirements: [],
    educationRequirements: [],
    licences: [],
    vehicleRequirement: "UNKNOWN",
    workRightsRequirement: "UNKNOWN",
    physicalRequirements: [],
    trainingProvided: null,
    ambiguities: [
      ...(fields.category ? [] : ["Job category was not supplied; shown as unclassified."]),
      ...(fields.employmentType === "UNKNOWN"
        ? ["Employment type was not explicitly detected."]
        : []),
    ],
    datePosted: fields.datePosted,
    dateDiscovered: provenance.now,
    dateUpdated: null,
    sourceMetadata: {
      provenance: {
        importId: provenance.importId,
        importRecordId: provenance.recordId,
        parserVersion: provenance.parserVersion,
        acquisitionMethod: provenance.acquisitionMethod,
        retrievalMethod: provenance.acquisitionMethod,
        contentHashPrefix: provenance.contentHash.slice(0, 12),
        manuallyEditedFields: provenance.editedFields,
      },
      coverLetterRequired: fields.coverLetterRequired,
    },
    eligibilityStatus: null,
    eligibilityReasons: [],
    fitScore: null,
    fitReasons: [],
    applicationStatus: "NEW",
    documentRequirements: {
      resumeRequired: true,
      coverLetterRequired: fields.coverLetterRequired === true,
      other: [],
    },
    coverLetterRequired: fields.coverLetterRequired === true,
  });
}

function jobColumns(job: Job, now: string) {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    category: job.category,
    location: job.location,
    employmentType: job.employmentType,
    normalizedJson: JSON.stringify(job),
    eligibilityStatus: job.eligibilityStatus,
    fitScore: job.fitScore,
    applicationStatus: job.applicationStatus,
    datePosted: job.datePosted,
    dateDiscovered: job.dateDiscovered,
    dateUpdated: job.dateUpdated,
    createdAt: now,
    updatedAt: now,
  };
}

function applyEdits(
  original: z.infer<typeof ParsedJobFieldsSchema>,
  edits: JobFieldEdits,
): z.infer<typeof ParsedJobFieldsSchema> {
  return ParsedJobFieldsSchema.parse({ ...original, ...edits });
}

function stableProfileHash(profile: CandidateProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

export class JobImportRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  stage(prepared: PreparedJobImport): StagedImportPreview {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + tokenLifetimeMs).toISOString();
    const transaction = this.sqlite.transaction(() => {
      const document = prepared.document;
      this.sqlite
        .prepare(
          `INSERT INTO import_batches
            (id, input_type, acquisition_method, source_hint, detected_source, original_filename,
             source_url, content_hash, parser_version, content_length, detected_jobs, warnings_json,
             raw_content_text, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREVIEW_READY', ?)`,
        )
        .run(
          document.importId,
          document.inputType,
          document.acquisitionMethod,
          document.sourceHint,
          document.detectedSource,
          document.originalFilename,
          document.sourceUrl,
          document.contentHash,
          document.parserVersion,
          document.contentLength,
          document.detectedJobs,
          JSON.stringify(document.warnings),
          document.content,
          document.createdAt,
        );
      const insert = this.sqlite.prepare(
        `INSERT INTO import_records
          (id, batch_id, ordinal, split_status, record_status, detected_source, acquisition_method,
           source_confidence, external_id, source_url, segment_content_hash, identity_kind,
           identity_value, boundary_json, original_fields_json, warnings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const record of prepared.records) {
        const identity = deriveJobIdentity(
          record.sourceDetection.source,
          record.fields,
          record.contentHash,
        );
        insert.run(
          record.recordId,
          document.importId,
          record.ordinal,
          record.splitStatus,
          record.splitStatus === "CONFIDENT" ? "PREVIEW_READY" : "REVIEW_REQUIRED",
          record.sourceDetection.source,
          document.acquisitionMethod,
          record.sourceDetection.confidence,
          record.fields.externalId,
          record.fields.sourceUrl,
          record.contentHash,
          identity.kind,
          identity.value,
          JSON.stringify({ ruleIds: record.extractionRuleIds }),
          JSON.stringify(record.originalExtractedFields),
          JSON.stringify(record.warnings),
          document.createdAt,
          document.createdAt,
        );
      }
      this.sqlite
        .prepare(
          `INSERT INTO settings (key, value_json, classification, updated_at)
           VALUES (?, ?, 'LOCAL_PRIVATE', ?)`,
        )
        .run(
          tokenKey(document.importId),
          JSON.stringify({ hash: hashToken(token), expiresAt }),
          document.createdAt,
        );
      this.audit("job_import.preview.ready", "import_batch", document.importId, {
        detectedJobs: document.detectedJobs,
        detectedSource: document.detectedSource,
        acquisitionMethod: document.acquisitionMethod,
      });
    });
    transaction();
    return {
      importId: prepared.document.importId,
      previewToken: token,
      expiresAt,
      records: prepared.records.map((record) => ({
        ...record,
        duplicateDecision: this.duplicateDecision(
          record.sourceDetection.source,
          record.fields,
          deriveJobIdentity(record.sourceDetection.source, record.fields, record.contentHash),
          record.contentHash,
        ),
      })),
    };
  }

  async confirm(
    importId: string,
    previewToken: string,
    selectionsInput: unknown,
    profileProvider: CandidateProfileProvider,
  ): Promise<ConfirmImportResult> {
    const selections = z.array(selectionSchema).min(1).max(100).parse(selectionsInput);
    const selectedById = new Map(selections.map((item) => [item.recordId, item]));
    const persistedJobIds: string[] = [];
    const counts = { imported: 0, updated: 0, duplicates: 0, skipped: 0 };
    const transaction = this.sqlite.transaction(() => {
      const batch = this.sqlite
        .prepare(
          `SELECT id, parser_version AS parserVersion, content_hash AS contentHash,
                  status, created_at AS createdAt FROM import_batches WHERE id = ?`,
        )
        .get(importId) as StoredBatch | undefined;
      if (!batch || batch.status !== "PREVIEW_READY") throw new Error("PREVIEW_NOT_CONFIRMABLE");
      this.verifyToken(importId, previewToken);
      const records = this.sqlite
        .prepare(
          `SELECT id, batch_id AS batchId, ordinal, split_status AS splitStatus,
                  record_status AS recordStatus, detected_source AS detectedSource,
                  acquisition_method AS acquisitionMethod, source_confidence AS sourceConfidence,
                  segment_content_hash AS segmentContentHash, original_fields_json AS originalFieldsJson,
                  warnings_json AS warningsJson FROM import_records WHERE batch_id = ? ORDER BY ordinal`,
        )
        .all(importId) as StoredRecord[];
      if (selections.some(({ recordId }) => !records.some(({ id }) => id === recordId))) {
        throw new Error("UNKNOWN_IMPORT_RECORD");
      }
      const now = this.now().toISOString();
      for (const record of records) {
        const selection = selectedById.get(record.id);
        if (!selection?.selected) {
          this.sqlite
            .prepare(
              "UPDATE import_records SET record_status = 'SKIPPED', updated_at = ? WHERE id = ?",
            )
            .run(now, record.id);
          counts.skipped += 1;
          continue;
        }
        const original = ParsedJobFieldsSchema.parse(JSON.parse(record.originalFieldsJson));
        const fields = applyEdits(original, selection.edits);
        const warnings = z
          .array(z.object({ code: z.string(), message: z.string(), field: z.string().optional() }))
          .parse(JSON.parse(record.warningsJson));
        const blockingWarnings = warnings.filter(({ code }) => code === "MISSING_REQUIRED_FIELD");
        if (
          blockingWarnings.some(
            ({ field }) =>
              field && !fields[field as "title" | "company" | "location" | "description"],
          )
        ) {
          throw new Error("MISSING_REQUIRED_IMPORT_FIELDS");
        }
        if (
          record.splitStatus === "REVIEW_REQUIRED" &&
          !selection.acknowledgedWarnings.includes("SPLIT_REVIEW_REQUIRED")
        ) {
          throw new Error("REVIEW_ACKNOWLEDGEMENT_REQUIRED");
        }
        const identity = deriveJobIdentity(
          record.detectedSource,
          fields,
          record.segmentContentHash,
        );
        this.assertIdentity(record.detectedSource, identity, fields, record.segmentContentHash);
        const duplicate = this.findExisting(record.detectedSource, fields, identity);
        const editedFieldNames = Object.keys(selection.edits);
        if (duplicate && duplicate.payloadHash === record.segmentContentHash) {
          this.sqlite
            .prepare(
              `UPDATE import_records SET record_status = 'DUPLICATE', identity_kind = ?, identity_value = ?,
                 edited_fields_json = ?, override_metadata_json = ?, normalized_job_id = ?, updated_at = ?, imported_at = ?
               WHERE id = ?`,
            )
            .run(
              identity.kind,
              identity.value,
              JSON.stringify(selection.edits),
              JSON.stringify({ editedAt: now, editedBy: "LOCAL_USER", fields: editedFieldNames }),
              duplicate.jobId,
              now,
              now,
              record.id,
            );
          counts.duplicates += 1;
          continue;
        }
        if (duplicate && !selection.allowUpdate) throw new Error("UPDATE_REVIEW_REQUIRED");
        const job = normalizeImportedJob(
          fields,
          record.detectedSource,
          {
            importId,
            recordId: record.id,
            parserVersion: batch.parserVersion,
            acquisitionMethod: record.acquisitionMethod,
            contentHash: record.segmentContentHash,
            now,
            editedFields: editedFieldNames,
          },
          duplicate?.jobId,
        );
        this.ensureSource(record.detectedSource, now);
        if (duplicate) {
          this.updateJob(job, now);
          this.sqlite
            .prepare(
              `UPDATE job_source_records SET external_id = ?, source_url = ?, raw_payload_json = ?,
                 payload_hash = ?, discovered_at = ?, fetched_at = NULL, identity_kind = ?,
                 identity_value = ?, acquisition_method = ? WHERE id = ?`,
            )
            .run(
              fields.externalId,
              fields.sourceUrl ? canonicalizeJobUrl(fields.sourceUrl) : null,
              JSON.stringify({ importId, recordId: record.id, parserVersion: batch.parserVersion }),
              record.segmentContentHash,
              now,
              identity.kind,
              identity.value,
              record.acquisitionMethod,
              duplicate.sourceRecordId,
            );
          counts.updated += 1;
        } else {
          this.insertJob(job, now);
          this.sqlite
            .prepare(
              `INSERT INTO job_source_records
                (id, job_id, source_id, external_id, source_url, raw_payload_json, payload_hash,
                 discovered_at, fetched_at, identity_kind, identity_value, acquisition_method)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              job.id,
              sourceId(record.detectedSource),
              fields.externalId,
              fields.sourceUrl ? canonicalizeJobUrl(fields.sourceUrl) : null,
              JSON.stringify({ importId, recordId: record.id, parserVersion: batch.parserVersion }),
              record.segmentContentHash,
              now,
              identity.kind,
              identity.value,
              record.acquisitionMethod,
            );
          counts.imported += 1;
        }
        persistedJobIds.push(job.id);
        this.sqlite
          .prepare(
            `UPDATE import_records SET record_status = ?, external_id = ?, source_url = ?, identity_kind = ?,
               identity_value = ?, edited_fields_json = ?, override_metadata_json = ?, normalized_job_id = ?,
               updated_at = ?, imported_at = ? WHERE id = ?`,
          )
          .run(
            duplicate ? "UPDATED" : "IMPORTED",
            fields.externalId,
            fields.sourceUrl,
            identity.kind,
            identity.value,
            JSON.stringify(selection.edits),
            JSON.stringify({ editedAt: now, editedBy: "LOCAL_USER", fields: editedFieldNames }),
            job.id,
            now,
            now,
            record.id,
          );
        this.audit(
          duplicate ? "job_import.record.updated" : "job_import.record.imported",
          "job",
          job.id,
          {
            importId,
            recordId: record.id,
            detectedSource: record.detectedSource,
            acquisitionMethod: record.acquisitionMethod,
          },
        );
      }
      this.sqlite
        .prepare(
          "UPDATE import_batches SET status = 'COMPLETED', confirmed_at = ?, completed_at = ? WHERE id = ?",
        )
        .run(now, now, importId);
      this.sqlite.prepare("DELETE FROM settings WHERE key = ?").run(tokenKey(importId));
      this.audit("job_import.batch.completed", "import_batch", importId, counts);
    });
    transaction();
    const jobs: ConfirmImportResult["jobs"] = [];
    for (const jobId of persistedJobIds) {
      jobs.push({ jobId, evaluationState: await this.evaluate(jobId, profileProvider) });
    }
    return { importId, ...counts, jobs };
  }

  listImportedJobs(): Job[] {
    return (
      this.sqlite
        .prepare(
          `SELECT j.normalized_json AS normalizedJson FROM jobs j
         WHERE EXISTS (SELECT 1 FROM import_records r WHERE r.normalized_job_id = j.id)
         ORDER BY j.date_discovered DESC`,
        )
        .all() as Array<{ normalizedJson: string }>
    ).map(({ normalizedJson }) => JobSchema.parse(JSON.parse(normalizedJson)));
  }

  latestSummary(): {
    lastBatchAt: string | null;
    imported: number;
    updated: number;
    duplicates: number;
    review: number;
    failed: number;
  } {
    const lastBatchAt = this.sqlite
      .prepare("SELECT MAX(created_at) FROM import_batches")
      .pluck()
      .get() as string | null;
    const counts = Object.fromEntries(
      (
        this.sqlite
          .prepare(
            "SELECT record_status AS status, COUNT(*) AS count FROM import_records GROUP BY record_status",
          )
          .all() as Array<{ status: string; count: number }>
      ).map(({ status, count }) => [status, count]),
    );
    return {
      lastBatchAt,
      imported: counts.IMPORTED ?? 0,
      updated: counts.UPDATED ?? 0,
      duplicates: counts.DUPLICATE ?? 0,
      review: counts.REVIEW_REQUIRED ?? 0,
      failed: counts.FAILED ?? 0,
    };
  }

  private verifyToken(importId: string, supplied: string): void {
    const row = this.sqlite
      .prepare("SELECT value_json AS valueJson FROM settings WHERE key = ?")
      .get(tokenKey(importId)) as { valueJson: string } | undefined;
    if (!row) throw new Error("INVALID_PREVIEW_TOKEN");
    const value = z
      .object({ hash: z.string().length(64), expiresAt: z.iso.datetime() })
      .parse(JSON.parse(row.valueJson));
    if (
      new Date(value.expiresAt).getTime() < this.now().getTime() ||
      !safeEqual(value.hash, hashToken(supplied))
    ) {
      throw new Error("INVALID_PREVIEW_TOKEN");
    }
  }

  private duplicateDecision(
    source: DetectedJobSource,
    fields: z.infer<typeof ParsedJobFieldsSchema>,
    identity: { kind: string; value: string },
    payloadHash: string,
  ): "NEW" | "DUPLICATE_UNCHANGED" | "UPDATE_REVIEW_REQUIRED" | "IDENTITY_CONFLICT" {
    let existing;
    try {
      existing = this.findExisting(source, fields, identity);
    } catch (error) {
      if (error instanceof Error && error.message === "IDENTITY_CONFLICT") {
        return "IDENTITY_CONFLICT";
      }
      throw error;
    }
    if (!existing) return "NEW";
    return existing.payloadHash === payloadHash ? "DUPLICATE_UNCHANGED" : "UPDATE_REVIEW_REQUIRED";
  }

  private findExisting(
    source: DetectedJobSource,
    fields: z.infer<typeof ParsedJobFieldsSchema>,
    identity: { kind: string; value: string },
  ) {
    type Existing = {
      sourceRecordId: string;
      jobId: string;
      payloadHash: string;
      externalId: string | null;
    };
    const selectBy = (column: "external_id" | "source_url", value: string): Existing | undefined =>
      this.sqlite
        .prepare(
          `SELECT id AS sourceRecordId, job_id AS jobId, payload_hash AS payloadHash,
                  external_id AS externalId
           FROM job_source_records WHERE source_id = ? AND ${column} = ?`,
        )
        .get(sourceId(source), value) as Existing | undefined;
    const externalMatch = fields.externalId
      ? selectBy("external_id", fields.externalId)
      : undefined;
    const canonicalUrl = fields.sourceUrl ? canonicalizeJobUrl(fields.sourceUrl) : null;
    const urlMatch = canonicalUrl ? selectBy("source_url", canonicalUrl) : undefined;
    if (externalMatch && urlMatch && externalMatch.jobId !== urlMatch.jobId) {
      throw new Error("IDENTITY_CONFLICT");
    }
    if (urlMatch?.externalId && fields.externalId && urlMatch.externalId !== fields.externalId) {
      throw new Error("IDENTITY_CONFLICT");
    }
    if (externalMatch ?? urlMatch) return externalMatch ?? urlMatch;
    if (fields.externalId || canonicalUrl) return undefined;
    return this.sqlite
      .prepare(
        `SELECT id AS sourceRecordId, job_id AS jobId, payload_hash AS payloadHash,
                external_id AS externalId
         FROM job_source_records WHERE source_id = ? AND identity_kind = ? AND identity_value = ?`,
      )
      .get(sourceId(source), identity.kind, identity.value) as Existing | undefined;
  }

  private assertIdentity(
    source: DetectedJobSource,
    identity: { kind: string; value: string },
    fields: z.infer<typeof ParsedJobFieldsSchema>,
    contentHash: string,
  ): void {
    const recomputed = deriveJobIdentity(source, fields, contentHash);
    if (recomputed.kind !== identity.kind || recomputed.value !== identity.value)
      throw new Error("INVALID_IDENTITY");
    if (identity.kind === "EXTERNAL_ID" && identity.value !== fields.externalId)
      throw new Error("INVALID_IDENTITY");
    if (identity.kind === "CONTENT_HASH" && identity.value !== contentHash)
      throw new Error("INVALID_IDENTITY");
  }

  private ensureSource(source: DetectedJobSource, now: string): void {
    this.sqlite
      .prepare(
        `INSERT INTO job_sources (id, name, capabilities_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(
        sourceId(source),
        source,
        JSON.stringify({ capabilities: ["USER_SUPPLIED_IMPORT"], networkAccess: false }),
        now,
        now,
      );
  }

  private insertJob(job: Job, now: string): void {
    this.sqlite
      .prepare(
        `INSERT INTO jobs
          (id, title, company, category, location, employment_type, normalized_json,
           eligibility_status, fit_score, application_status, date_posted, date_discovered,
           date_updated, created_at, updated_at)
         VALUES (@id, @title, @company, @category, @location, @employmentType, @normalizedJson,
           @eligibilityStatus, @fitScore, @applicationStatus, @datePosted, @dateDiscovered,
           @dateUpdated, @createdAt, @updatedAt)`,
      )
      .run(jobColumns(job, now));
  }

  private updateJob(job: Job, now: string): void {
    this.sqlite
      .prepare(
        `UPDATE jobs SET title=@title, company=@company, category=@category, location=@location,
         employment_type=@employmentType, normalized_json=@normalizedJson, eligibility_status=NULL,
         fit_score=NULL, application_status=@applicationStatus, date_posted=@datePosted,
         date_discovered=@dateDiscovered, date_updated=@dateUpdated, updated_at=@updatedAt WHERE id=@id`,
      )
      .run(jobColumns(job, now));
  }

  private async evaluate(
    jobId: string,
    provider: CandidateProfileProvider,
  ): Promise<CandidateProfileRuntimeState | "EVALUATION_FAILED"> {
    let resolution;
    try {
      resolution = enforceEvaluationProfile(
        "REAL_IMPORTED_JOB",
        await provider.resolve("REAL_IMPORTED_JOB"),
      );
    } catch {
      this.audit("job_import.evaluation.unavailable", "job", jobId, {
        reasonCode: "PROFILE_PROVIDER_FAILED",
      });
      return "EVALUATION_FAILED";
    }
    if (resolution.state !== "PRIVATE_LOCAL_PROFILE") {
      this.audit("job_import.evaluation.unavailable", "job", jobId, {
        profileState: resolution.state,
      });
      return resolution.state;
    }
    try {
      const transaction = this.sqlite.transaction(() => {
        const row = this.sqlite
          .prepare("SELECT normalized_json AS normalizedJson FROM jobs WHERE id = ?")
          .get(jobId) as { normalizedJson: string } | undefined;
        if (!row) throw new Error("JOB_NOT_FOUND");
        const job = JobSchema.parse(JSON.parse(row.normalizedJson));
        const eligibility = evaluateEligibility(job, resolution.profile);
        const fit = scoreJobFit(job, resolution.profile, eligibility);
        const now = this.now().toISOString();
        const profileVersionId = this.persistProfileVersion(resolution.profile, now);
        const evaluatedJob = JobSchema.parse({
          ...job,
          eligibilityStatus: eligibility.status,
          eligibilityReasons: eligibility.reasons.map(({ message }) => message),
          fitScore: fit.score,
          fitReasons: [...fit.positive, ...fit.negative],
        });
        this.sqlite
          .prepare(
            "UPDATE jobs SET normalized_json = ?, eligibility_status = ?, fit_score = ?, updated_at = ? WHERE id = ?",
          )
          .run(JSON.stringify(evaluatedJob), eligibility.status, fit.score, now, jobId);
        this.sqlite
          .prepare(
            `INSERT INTO eligibility_results
              (id, job_id, profile_version_id, status, reasons_json, engine_version, evaluated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            jobId,
            profileVersionId,
            eligibility.status,
            JSON.stringify(eligibility.reasons),
            eligibility.engineVersion,
            now,
          );
        this.sqlite
          .prepare(
            `INSERT INTO fit_scores
              (id, job_id, profile_version_id, score, reasons_json, contributions_json, engine_version, scored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            jobId,
            profileVersionId,
            fit.score,
            JSON.stringify({ positive: fit.positive, negative: fit.negative }),
            JSON.stringify(fit.contributions),
            fit.engineVersion,
            now,
          );
        this.audit("job_import.evaluation.completed", "job", jobId, {
          profileState: resolution.state,
        });
      });
      transaction();
      return resolution.state;
    } catch {
      this.audit("job_import.evaluation.unavailable", "job", jobId, {
        reasonCode: "EVALUATION_FAILED",
      });
      return "EVALUATION_FAILED";
    }
  }

  private persistProfileVersion(profile: CandidateProfile, now: string): string {
    const hash = stableProfileHash(profile);
    const existing = this.sqlite
      .prepare(
        "SELECT id FROM candidate_profile_versions WHERE profile_id = ? AND content_hash = ? ORDER BY version DESC LIMIT 1",
      )
      .get(profile.profileId, hash) as { id: string } | undefined;
    if (existing) return existing.id;
    this.sqlite
      .prepare(
        `INSERT INTO candidate_profiles (id, active_version_id, created_at, updated_at)
         VALUES (?, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(profile.profileId, now, now);
    const version = Number(
      this.sqlite
        .prepare(
          "SELECT COALESCE(MAX(version), 0) + 1 FROM candidate_profile_versions WHERE profile_id = ?",
        )
        .pluck()
        .get(profile.profileId),
    );
    const id = randomUUID();
    this.sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
          (id, profile_id, version, schema_version, snapshot_json, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profile.profileId,
        version,
        profile.schemaVersion,
        JSON.stringify(profile),
        hash,
        now,
      );
    this.sqlite
      .prepare("UPDATE candidate_profiles SET active_version_id = ?, updated_at = ? WHERE id = ?")
      .run(id, now, profile.profileId);
    return id;
  }

  private audit(
    eventType: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): void {
    const safe = Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) => !/(content|description|fieldValue|profile|token|cookie|secret)/i.test(key),
      ),
    );
    this.sqlite
      .prepare(
        `INSERT INTO audit_events
          (id, event_type, entity_type, entity_id, actor, redacted_metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, 'LOCAL_USER', ?, ?)`,
      )
      .run(
        randomUUID(),
        eventType,
        entityType,
        entityId,
        JSON.stringify(safe),
        this.now().toISOString(),
      );
  }
}
