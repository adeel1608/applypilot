import { createHash, randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  SyntheticStopReasonSchema,
  assessPacketReadiness,
  type ApplicationPacket,
  type FinalActionConsent,
  type RunnerCheckpoint,
} from "@applypilot/application-runner";
import {
  BetaApplicationEventSchema,
  canTransitionBetaApplication,
  type BetaApplicationEvent,
} from "@applypilot/application-tracker";
import {
  ApplicationRunStateSchema,
  EvaluationCoverageSchema,
  JobFieldEvidenceSchema,
  JobQueueStateSchema,
  JobSchema,
  RequirementEvidenceSchema,
  R2ANormalizationSchema,
  SourceObservationSchema,
  type Job,
  type JobFieldEvidence,
  type RequirementEvidence,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2NormalizedValue,
  type SourceObservation,
} from "@applypilot/job-model";

import { R2ARepository, r2aSemanticDigest } from "./r2a-repository";

const EvaluationVersionInputSchema = z.object({
  id: z.string().min(1).optional(),
  jobId: z.string().min(1),
  jobVersionId: z.string().min(1).nullable(),
  profileVersionId: z.string().min(1),
  evaluationContext: z.enum(["PRIVATE_LOCAL_PROFILE", "DEMO_PROFILE", "UNKNOWN"]),
  eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]),
  eligibilityReasons: z.array(z.unknown()),
  fitScore: z.number().int().min(0).max(100),
  fitContributions: z.array(z.unknown()),
  coverage: EvaluationCoverageSchema,
  eligibilityEngineVersion: z.string().min(1),
  fitEngineVersion: z.string().min(1),
  weightVersion: z.string().min(1),
  stale: z.boolean().default(false),
});

export type EvaluationVersionInput = z.input<typeof EvaluationVersionInputSchema>;

export interface JobVersionInput {
  job: Job;
  sourceObservationId: string | null;
  fieldEvidence?: JobFieldEvidence[];
  requirementEvidence?: RequirementEvidence[];
  r2aNormalization?: R2ANormalization;
}

export interface RecordedJobVersion {
  id: string;
  version: number;
  contentDigest: string;
  created: boolean;
}

const DocumentArtifactInputSchema = z.object({
  id: z.string().min(1).optional(),
  jobId: z.string().min(1),
  jobVersionId: z.string().min(1),
  profileVersionId: z.string().min(1),
  type: z.enum(["CV", "COVER_LETTER"]),
  template: z.string().min(1),
  format: z.enum(["PDF", "DOCX"]),
  fileName: z.string().min(1),
  localPath: z.string().min(1),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  claimEvidence: z.array(z.string().min(1)),
  layoutResult: z.record(z.string(), z.unknown()),
});

export type DocumentArtifactInput = z.input<typeof DocumentArtifactInputSchema>;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownerCorrectionR2Value(field: string, job: Job): R2NormalizedValue {
  if (field === "employmentType") {
    return { kind: "EMPLOYMENT_TYPE", value: job.employmentType };
  }
  if (field === "location") {
    return {
      kind: "LOCATION",
      value: {
        rawLabel: job.location,
        locality: job.suburb,
        suburb: job.suburb,
        stateOrTerritory: job.state,
        postcode: job.postcode,
        countryCode: job.country.toUpperCase() === "AUSTRALIA" ? "AU" : "UNKNOWN",
        workplaceType: "UNKNOWN",
        remoteScope: "UNKNOWN",
      },
    };
  }
  return { kind: "TEXT", value: String((job as unknown as Record<string, unknown>)[field]) };
}

function ownerCorrectedR2Normalization(input: {
  prior: R2ANormalization;
  job: Job;
  changedFields: Set<string>;
  correctionId: string;
}): R2ANormalization {
  const effective = new Map<
    string,
    { canonicalField: string; family: R2JobFieldEvidence["family"] }
  >();
  for (const field of input.changedFields) {
    if (["suburb", "state", "postcode", "country"].includes(field)) {
      effective.set("location", { canonicalField: "location.alternative", family: "GEOGRAPHY" });
    } else if (field === "location") {
      effective.set(field, { canonicalField: "location.alternative", family: "GEOGRAPHY" });
    } else if (field === "employmentType") {
      effective.set(field, { canonicalField: "employment.type", family: "EMPLOYMENT" });
    } else if (["title", "company", "category"].includes(field)) {
      effective.set(field, { canonicalField: field, family: "IDENTITY" });
    }
  }
  if (effective.size === 0) return input.prior;
  const affectedCanonical = new Set(
    [...effective.values()].map(({ canonicalField }) => canonicalField),
  );
  const removedIds = new Set(
    input.prior.fieldEvidence
      .filter(({ canonicalField }) => affectedCanonical.has(canonicalField))
      .map(({ id }) => id),
  );
  const removedConflictIds = new Set(
    input.prior.conflicts
      .filter(({ evidenceIds }) => evidenceIds.some((id) => removedIds.has(id)))
      .map(({ id }) => id),
  );
  const carried = input.prior.fieldEvidence
    .filter(({ id }) => !removedIds.has(id))
    .map((item) =>
      item.conflictSetId && removedConflictIds.has(item.conflictSetId)
        ? { ...item, state: "SOURCE_STATED" as const, conflictSetId: null }
        : item,
    );
  const emptyHash = digest("");
  const corrected = [...effective].map(
    ([field, descriptor]): R2JobFieldEvidence => ({
      id: digest(`${input.correctionId}\n${descriptor.canonicalField}`).slice(0, 32),
      sourceObservationId: input.prior.sourceObservationId,
      jobVersionId: null,
      family: descriptor.family,
      canonicalField: descriptor.canonicalField,
      state: "OWNER_CORRECTED",
      modality: null,
      source: {
        sourcePath: `ownerCorrection.${field}`,
        start: 0,
        end: 0,
        sourceLength: input.prior.sourceLength,
        excerpt: "",
        excerptHash: emptyHash,
      },
      normalizedValue: ownerCorrectionR2Value(field, input.job),
      extractorVersion: input.prior.parserVersion,
      ruleId: "R2A_OWNER_CORRECTED",
      derivationInputIds: [],
      ownerCorrectionId: input.correctionId,
      conflictSetId: null,
    }),
  );
  const fieldEvidence = [...carried, ...corrected];
  const coverage = input.prior.coverage.map((item) => {
    const additions = corrected.filter(({ family }) => family === item.family).map(({ id }) => id);
    return {
      ...item,
      evidenceIds: [...item.evidenceIds.filter((id) => !removedIds.has(id)), ...additions],
    };
  });
  return R2ANormalizationSchema.parse({
    ...input.prior,
    fieldEvidence,
    conflicts: input.prior.conflicts.filter(({ id }) => !removedConflictIds.has(id)),
    coverage,
  });
}

export class BetaRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  recordSourceObservation(
    input: SourceObservation & {
      sourceRecordId?: string | null;
      supersedesObservationId?: string | null;
    },
  ): SourceObservation {
    const observation = SourceObservationSchema.parse(input);
    this.sqlite
      .prepare(
        `INSERT INTO source_observations
          (id, job_id, source_record_id, source, tenant, external_id, source_url,
           acquisition_method, content_hash, raw_snapshot_reference, observed_at, posted_at,
           expires_at, parser_version, policy_version, run_id, supersedes_observation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_record_id, content_hash) DO NOTHING`,
      )
      .run(
        observation.id,
        observation.canonicalJobId,
        input.sourceRecordId ?? null,
        observation.source,
        observation.tenant,
        observation.externalId,
        observation.sourceUrl,
        observation.acquisitionMethod,
        observation.contentHash,
        observation.rawSnapshotReference,
        observation.observedAt,
        observation.postedAt,
        observation.expiresAt,
        observation.parserVersion,
        observation.policyVersion,
        observation.runId,
        input.supersedesObservationId ?? null,
      );
    return observation;
  }

  recordJobVersion(input: JobVersionInput): RecordedJobVersion {
    const job = JobSchema.parse(input.job);
    const normalizedJson = JSON.stringify(job);
    const r2aRepository = new R2ARepository(this.sqlite, this.now);
    const r2aNormalization =
      input.r2aNormalization && r2aRepository.available()
        ? R2ANormalizationSchema.parse(input.r2aNormalization)
        : null;
    if (
      r2aNormalization &&
      (!input.sourceObservationId ||
        r2aNormalization.sourceObservationId !== input.sourceObservationId)
    ) {
      throw new Error("R2A_OBSERVATION_VERSION_MISMATCH");
    }
    const contentDigest = digest(
      r2aNormalization
        ? `${normalizedJson}\nR2A:${r2aSemanticDigest(r2aNormalization)}`
        : normalizedJson,
    );
    const fieldEvidence = (input.fieldEvidence ?? []).map((item) =>
      JobFieldEvidenceSchema.parse(item),
    );
    const requirements = (input.requirementEvidence ?? []).map((item) =>
      RequirementEvidenceSchema.parse(item),
    );

    return this.sqlite.transaction(() => {
      const previous = this.sqlite
        .prepare(
          `SELECT id, version, content_digest AS contentDigest
           FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(job.id) as { id: string; version: number; contentDigest: string | null } | undefined;
      if (previous?.contentDigest === contentDigest) {
        return { ...previous, contentDigest, created: false };
      }

      const version = (previous?.version ?? 0) + 1;
      const jobVersionId = this.id();
      const createdAt = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO job_versions
            (id, job_id, version, normalized_json, content_digest, source_observation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobVersionId,
          job.id,
          version,
          normalizedJson,
          contentDigest,
          input.sourceObservationId,
          createdAt,
        );

      const insertField = this.sqlite.prepare(
        `INSERT INTO job_field_evidence
          (id, job_version_id, field_name, source_observation_id, source_path, original_text,
           normalized_value_json, certainty, rule_id, extractor_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of fieldEvidence) {
        insertField.run(
          this.id(),
          jobVersionId,
          evidence.field,
          evidence.sourceObservationId,
          evidence.sourcePath,
          evidence.originalText,
          evidence.normalizedValueJson,
          evidence.certainty,
          evidence.ruleId,
          evidence.extractorVersion,
          createdAt,
        );
      }

      const insertRequirement = this.sqlite.prepare(
        `INSERT INTO requirement_evidence
          (id, job_version_id, source_observation_id, source_path, start_offset, end_offset,
           original_text, normalized_proposition, modality, kind, condition_text, certainty,
           rule_id, extractor_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of requirements) {
        insertRequirement.run(
          this.id(),
          jobVersionId,
          evidence.sourceObservationId,
          evidence.sourcePath,
          evidence.start,
          evidence.end,
          evidence.originalText,
          evidence.normalizedProposition,
          evidence.modality,
          evidence.kind,
          evidence.condition,
          evidence.certainty,
          evidence.ruleId,
          evidence.extractorVersion,
          createdAt,
        );
      }
      if (r2aNormalization) {
        r2aRepository.recordNormalization(jobVersionId, r2aNormalization);
      }
      return { id: jobVersionId, version, contentDigest, created: true };
    })();
  }

  recordEvaluationVersion(input: EvaluationVersionInput): string {
    const value = EvaluationVersionInputSchema.parse(input);
    const id = value.id ?? this.id();
    this.sqlite
      .prepare(
        `INSERT INTO evaluation_versions
          (id, job_id, job_version_id, profile_version_id, evaluation_context,
           eligibility_status, eligibility_reasons_json, fit_score, fit_contributions_json,
           coverage_json, eligibility_engine_version, fit_engine_version, weight_version,
           stale, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        value.jobId,
        value.jobVersionId,
        value.profileVersionId,
        value.evaluationContext,
        value.eligibilityStatus,
        JSON.stringify(value.eligibilityReasons),
        value.fitScore,
        JSON.stringify(value.fitContributions),
        JSON.stringify(value.coverage),
        value.eligibilityEngineVersion,
        value.fitEngineVersion,
        value.weightVersion,
        value.stale ? 1 : 0,
        this.now().toISOString(),
      );
    return id;
  }

  setQueueState(input: {
    jobId: string;
    state: z.infer<typeof JobQueueStateSchema>;
    evaluationVersionId: string | null;
    reasonCode: string;
  }): void {
    const state = JobQueueStateSchema.parse(input.state);
    const reasonCode = z.string().min(1).max(100).parse(input.reasonCode);
    const now = this.now().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO job_queue_entries
          (job_id, state, evaluation_version_id, reason_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           state = excluded.state,
           evaluation_version_id = excluded.evaluation_version_id,
           reason_code = excluded.reason_code,
           updated_at = excluded.updated_at`,
      )
      .run(input.jobId, state, input.evaluationVersionId, reasonCode, now, now);
  }

  recordDocumentArtifact(input: DocumentArtifactInput): { id: string; version: number } {
    const value = DocumentArtifactInputSchema.parse(input);
    const id = value.id ?? this.id();
    return this.sqlite.transaction(() => {
      const versionRow = this.sqlite
        .prepare(
          `SELECT coalesce(max(version), 0) AS version FROM document_artifacts
           WHERE job_id = ? AND type = ? AND format = ?`,
        )
        .get(value.jobId, value.type, value.format) as { version: number };
      const version = versionRow.version + 1;
      const now = this.now().toISOString();
      const superseded = this.sqlite
        .prepare(
          `SELECT id FROM document_artifacts
           WHERE job_id = ? AND type = ? AND format = ? AND stale = 0`,
        )
        .all(value.jobId, value.type, value.format) as Array<{ id: string }>;
      if (superseded.length) {
        const ids = superseded.map(({ id: artifactId }) => artifactId);
        const placeholders = ids.map(() => "?").join(",");
        this.sqlite
          .prepare(`UPDATE document_artifacts SET stale = 1 WHERE id IN (${placeholders})`)
          .run(...ids);
        this.sqlite
          .prepare(
            `UPDATE document_approvals SET invalidated_at = ?, invalidation_reason = 'DOCUMENT_SUPERSEDED'
             WHERE document_artifact_id IN (${placeholders}) AND invalidated_at IS NULL`,
          )
          .run(now, ...ids);
        this.sqlite
          .prepare(
            `UPDATE application_packets SET status = 'INVALIDATED', readiness_json = ?, updated_at = ?
             WHERE status <> 'INVALIDATED' AND id IN (
               SELECT packet_id FROM application_packet_documents
               WHERE document_artifact_id IN (${placeholders})
             )`,
          )
          .run(
            JSON.stringify({
              status: "REVIEW_REQUIRED",
              blockers: ["DOCUMENT_SUPERSEDED"],
              warnings: [],
            }),
            now,
            ...ids,
          );
      }
      this.sqlite
        .prepare(
          `INSERT INTO document_artifacts
            (id, job_id, job_version_id, profile_version_id, type, template, format,
             file_name, local_path, content_digest, claim_evidence_json, layout_result_json,
             version, stale, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          value.jobId,
          value.jobVersionId,
          value.profileVersionId,
          value.type,
          value.template,
          value.format,
          value.fileName,
          value.localPath,
          value.contentDigest,
          JSON.stringify(value.claimEvidence),
          JSON.stringify(value.layoutResult),
          version,
          now,
        );
      return { id, version };
    })();
  }

  recordOwnerCorrection(input: {
    job: Job;
    reasonCode: string;
    changedFields: string[];
  }): RecordedJobVersion {
    const job = JobSchema.parse(input.job);
    const reasonCode = z.string().min(1).max(100).parse(input.reasonCode);
    const changedFields = z.array(z.string().min(1).max(80)).min(1).parse(input.changedFields);
    return this.sqlite.transaction(() => {
      const correctionId = this.id();
      const previous = this.sqlite
        .prepare(
          `SELECT id, normalized_json AS normalizedJson, content_digest AS contentDigest,
                  source_observation_id AS sourceObservationId
           FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(job.id) as
        | {
            id: string;
            normalizedJson: string;
            contentDigest: string;
            sourceObservationId: string | null;
          }
        | undefined;
      if (!previous) throw new Error("JOB_VERSION_NOT_FOUND");
      const effectiveChangedFields = new Set(changedFields);
      if (effectiveChangedFields.has("location")) {
        for (const field of ["suburb", "state", "postcode", "country"]) {
          effectiveChangedFields.add(field);
        }
      }
      const priorFieldEvidence = this.sqlite
        .prepare(
          `SELECT field_name AS field, source_path AS sourcePath,
                  source_observation_id AS sourceObservationId, original_text AS originalText,
                  normalized_value_json AS normalizedValueJson, certainty, rule_id AS ruleId,
                  extractor_version AS extractorVersion
           FROM job_field_evidence WHERE job_version_id = ? ORDER BY rowid`,
        )
        .all(previous.id) as JobFieldEvidence[];
      const priorRequirementEvidence = this.sqlite
        .prepare(
          `SELECT id, source_observation_id AS sourceObservationId, source_path AS sourcePath,
                  start_offset AS start, end_offset AS end, original_text AS originalText,
                  normalized_proposition AS normalizedProposition, modality, kind,
                  condition_text AS condition, certainty, rule_id AS ruleId,
                  extractor_version AS extractorVersion
           FROM requirement_evidence WHERE job_version_id = ? ORDER BY rowid`,
        )
        .all(previous.id) as RequirementEvidence[];
      const correctedEvidence = [...effectiveChangedFields].map((field): JobFieldEvidence => {
        const value = (job as unknown as Record<string, unknown>)[field];
        const normalizedValueJson = JSON.stringify(value ?? null);
        return {
          field,
          sourceObservationId: null,
          sourcePath: `owner_correction.${field}`,
          originalText: typeof value === "string" && value ? value : normalizedValueJson,
          normalizedValueJson,
          certainty: "HIGH",
          ruleId: "OWNER_CORRECTED",
          extractorVersion: "owner-correction-v1",
        };
      });
      const r2aRepository = new R2ARepository(this.sqlite, this.now);
      const priorR2A = r2aRepository.available()
        ? r2aRepository.getNormalization(previous.id)
        : null;
      const r2aNormalization = priorR2A
        ? ownerCorrectedR2Normalization({
            prior: priorR2A,
            job,
            changedFields: effectiveChangedFields,
            correctionId,
          })
        : undefined;
      const recorded = this.recordJobVersion({
        job,
        sourceObservationId: previous.sourceObservationId,
        fieldEvidence: [
          ...priorFieldEvidence.filter(({ field }) => !effectiveChangedFields.has(field)),
          ...correctedEvidence,
        ],
        requirementEvidence: priorRequirementEvidence,
        r2aNormalization,
      });
      if (!recorded.created) throw new Error("CORRECTION_HAS_NO_CHANGE");
      const now = this.now().toISOString();
      this.sqlite
        .prepare(
          `UPDATE jobs SET title = ?, company = ?, category = ?, location = ?, employment_type = ?,
             normalized_json = ?, eligibility_status = NULL, fit_score = NULL, date_updated = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          job.title,
          job.company,
          job.category,
          job.location,
          job.employmentType,
          JSON.stringify(job),
          now,
          now,
          job.id,
        );
      this.sqlite
        .prepare(
          `INSERT INTO job_corrections
            (id, job_id, from_job_version_id, to_job_version_id, actor, reason_code,
             changed_fields_json, before_digest, after_digest, created_at)
           VALUES (?, ?, ?, ?, 'OWNER', ?, ?, ?, ?, ?)`,
        )
        .run(
          correctionId,
          job.id,
          previous.id,
          recorded.id,
          reasonCode,
          JSON.stringify([...new Set(changedFields)].sort()),
          previous.contentDigest,
          recorded.contentDigest,
          now,
        );
      const activeProfile = this.sqlite
        .prepare(
          "SELECT active_version_id AS id FROM candidate_profiles ORDER BY created_at LIMIT 1",
        )
        .get() as { id: string | null } | undefined;
      if (activeProfile?.id) {
        this.invalidateStaleDependencies({
          jobId: job.id,
          currentJobVersionId: recorded.id,
          currentProfileVersionId: activeProfile.id,
          reasonCode: "OWNER_JOB_CORRECTION",
        });
      }
      return recorded;
    })();
  }

  persistCapabilityConfig(input: {
    source: "GREENHOUSE" | "LEVER";
    tenant: string;
    region: string | null;
    allowedHost: string;
    allowedPathPrefix: string;
    policyVersion: string;
    approved: boolean;
    expiresAt: string;
    requestBudget: number;
    recordBudget: number;
  }): string {
    const value = z
      .object({
        source: z.enum(["GREENHOUSE", "LEVER"]),
        tenant: z.string().min(1),
        region: z.string().nullable(),
        allowedHost: z.string().min(1),
        allowedPathPrefix: z.string().startsWith("/"),
        policyVersion: z.string().min(1),
        approved: z.boolean(),
        expiresAt: z.iso.datetime(),
        requestBudget: z.number().int().min(1).max(30),
        recordBudget: z.number().int().min(1).max(500),
      })
      .parse(input);
    const existing = this.sqlite
      .prepare("SELECT id FROM capability_configs WHERE source = ? AND tenant = ? AND region IS ?")
      .get(value.source, value.tenant, value.region) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO capability_configs
          (id, source, tenant, region, allowed_host, allowed_path_prefix, policy_version,
           approved, expires_at, request_budget, record_budget, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        value.source,
        value.tenant,
        value.region,
        value.allowedHost,
        value.allowedPathPrefix,
        value.policyVersion,
        value.approved ? 1 : 0,
        value.expiresAt,
        value.requestBudget,
        value.recordBudget,
        this.now().toISOString(),
      );
    return id;
  }

  recordDiscoveryRun(input: {
    capabilityConfigId: string;
    status: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED" | "STOPPED";
    cursor: unknown | null;
    requestCount: number;
    recordCount: number;
    safeErrorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  }): string {
    const value = z
      .object({
        capabilityConfigId: z.string().min(1),
        status: z.enum(["RUNNING", "COMPLETE", "PARTIAL", "FAILED", "STOPPED"]),
        cursor: z.unknown().nullable(),
        requestCount: z.number().int().nonnegative().max(30),
        recordCount: z.number().int().nonnegative().max(500),
        safeErrorCode: z.string().min(1).max(100).nullable(),
        startedAt: z.iso.datetime(),
        completedAt: z.iso.datetime().nullable(),
      })
      .parse(input);
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO discovery_runs
          (id, capability_config_id, status, cursor_json, request_count, record_count,
           safe_error_code, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        value.capabilityConfigId,
        value.status,
        value.cursor === null ? null : JSON.stringify(value.cursor),
        value.requestCount,
        value.recordCount,
        value.safeErrorCode,
        value.startedAt,
        value.completedAt,
      );
    return id;
  }

  persistApplicationPacket(input: ApplicationPacket): {
    packetId: string;
    version: number;
    status: ReturnType<typeof assessPacketReadiness>["status"];
  } {
    const packet = ApplicationPacketSchema.parse(input);
    const readiness = assessPacketReadiness(packet);
    return this.sqlite.transaction(() => {
      const versionState = this.sqlite
        .prepare(
          `SELECT
             (SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1) AS currentJobVersionId,
             (SELECT p.active_version_id FROM candidate_profiles p
                JOIN candidate_profile_versions v ON v.profile_id = p.id WHERE v.id = ?) AS currentProfileVersionId,
             e.job_id AS evaluationJobId,
             e.job_version_id AS evaluationJobVersionId,
             e.profile_version_id AS evaluationProfileVersionId,
             e.eligibility_status AS evaluationEligibilityStatus,
             e.stale AS evaluationStale
           FROM evaluation_versions e WHERE e.id = ?`,
        )
        .get(packet.jobId, packet.profileVersionId, packet.evaluationVersionId) as
        | {
            currentJobVersionId: string | null;
            currentProfileVersionId: string | null;
            evaluationJobId: string;
            evaluationJobVersionId: string | null;
            evaluationProfileVersionId: string;
            evaluationEligibilityStatus: string;
            evaluationStale: number;
          }
        | undefined;
      const versionsActuallyCurrent = Boolean(
        versionState &&
          versionState.currentJobVersionId === packet.jobVersionId &&
          versionState.currentProfileVersionId === packet.profileVersionId &&
          versionState.evaluationJobId === packet.jobId &&
          versionState.evaluationJobVersionId === packet.jobVersionId &&
          versionState.evaluationProfileVersionId === packet.profileVersionId &&
          versionState.evaluationEligibilityStatus === packet.eligibilityStatus &&
          !versionState.evaluationStale,
      );
      if (packet.versionsCurrent !== versionsActuallyCurrent) {
        throw new Error("PACKET_VERSION_STATE_MISMATCH");
      }
      const documentState = this.sqlite.prepare(
        `SELECT d.content_digest AS contentDigest, d.stale,
           EXISTS(SELECT 1 FROM document_approvals a
             WHERE a.document_artifact_id = d.id AND a.content_digest = d.content_digest
               AND a.invalidated_at IS NULL) AS approved
         FROM document_artifacts d WHERE d.id = ?`,
      );
      for (const document of packet.documents) {
        const persisted = documentState.get(document.id) as
          | { contentDigest: string; stale: number; approved: number }
          | undefined;
        if (
          !persisted ||
          persisted.contentDigest !== document.digest ||
          Boolean(persisted.stale) !== document.stale ||
          Boolean(persisted.approved) !== document.approved
        ) {
          throw new Error("PACKET_DOCUMENT_STATE_MISMATCH");
        }
      }
      const versionRow = this.sqlite
        .prepare(
          "SELECT coalesce(max(version), 0) AS version FROM application_packets WHERE job_id = ?",
        )
        .get(packet.jobId) as { version: number };
      const version = versionRow.version + 1;
      const now = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO application_packets
            (id, job_id, job_version_id, profile_version_id, evaluation_version_id,
             target_url, target_host, status, readiness_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          packet.id,
          packet.jobId,
          packet.jobVersionId,
          packet.profileVersionId,
          packet.evaluationVersionId,
          packet.targetUrl,
          packet.targetHost,
          readiness.status,
          JSON.stringify(readiness),
          version,
          now,
          now,
        );
      const insertDocument = this.sqlite.prepare(
        `INSERT INTO application_packet_documents (packet_id, document_artifact_id, required)
         VALUES (?, ?, ?)`,
      );
      for (const document of packet.documents) {
        insertDocument.run(packet.id, document.id, document.required ? 1 : 0);
      }
      const insertQuestion = this.sqlite.prepare(
        `INSERT INTO application_questions
          (id, packet_id, question_key, question_text, options_json, required, sensitive,
           version, created_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?, 1, ?)`,
      );
      const insertAnswer = this.sqlite.prepare(
        `INSERT INTO application_answer_versions
          (id, question_id, answer_json, certainty, fact_references_json, disclosure_state,
           version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      for (const answer of packet.answers) {
        const questionId = this.id();
        insertQuestion.run(
          questionId,
          packet.id,
          answer.questionId,
          answer.questionText,
          answer.required ? 1 : 0,
          answer.sensitive ? 1 : 0,
          now,
        );
        insertAnswer.run(
          this.id(),
          questionId,
          answer.value === null ? null : JSON.stringify(answer.value),
          answer.truthState,
          JSON.stringify(answer.factReferences),
          answer.disclosureState,
          now,
        );
      }
      return { packetId: packet.id, version, status: readiness.status };
    })();
  }

  registerApplicationRun(input: {
    packetId: string;
    targetKind: "SYNTHETIC_LOCAL" | "REAL_TARGET";
    targetHost: string;
    formVersion: string;
  }): string {
    const parsed = z
      .object({
        packetId: z.string().min(1),
        targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
        targetHost: z.string().min(1),
        formVersion: z.string().min(1),
      })
      .parse(input);
    const localHost = parsed.targetHost === "localhost" || parsed.targetHost === "127.0.0.1";
    if (parsed.targetKind === "SYNTHETIC_LOCAL" && !localHost) {
      throw new Error("SYNTHETIC_TARGET_MUST_BE_LOCAL");
    }
    const id = this.id();
    const now = this.now().toISOString();
    const state = parsed.targetKind === "REAL_TARGET" ? "PAUSED" : "PREPARED";
    const stopReason = parsed.targetKind === "REAL_TARGET" ? "TARGET_APPROVAL_REQUIRED" : null;
    this.sqlite
      .prepare(
        `INSERT INTO application_runs
          (id, packet_id, target_kind, target_host, form_version, state, stop_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.packetId,
        parsed.targetKind,
        parsed.targetHost,
        parsed.formVersion,
        state,
        stopReason,
        now,
        now,
      );
    return id;
  }

  recordRunnerCheckpoint(runId: string, input: RunnerCheckpoint): void {
    const id = z.string().min(1).parse(runId);
    const state = ApplicationRunStateSchema.parse(input.state);
    const stopReason = input.stopReason ? SyntheticStopReasonSchema.parse(input.stopReason) : null;
    const occurredAt = z.iso.datetime().parse(input.occurredAt);
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO runner_checkpoints
            (id, run_id, sequence, state, safe_metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.id(),
          id,
          z.number().int().nonnegative().parse(input.sequence),
          state,
          JSON.stringify({ stopReason }),
          occurredAt,
        );
      this.sqlite
        .prepare(
          "UPDATE application_runs SET state = ?, stop_reason = ?, updated_at = ? WHERE id = ?",
        )
        .run(state, stopReason, occurredAt, id);
    })();
  }

  persistFinalActionConsent(runId: string, input: FinalActionConsent): void {
    const id = z.string().min(1).parse(runId);
    const consent = z
      .object({
        id: z.string().min(1),
        tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
        packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
        targetHost: z.string().min(1),
        formVersion: z.string().min(1),
        expiresAt: z.iso.datetime(),
        usedAt: z.iso.datetime().nullable(),
      })
      .parse(input);
    const run = this.sqlite
      .prepare(
        "SELECT target_host AS targetHost, form_version AS formVersion FROM application_runs WHERE id = ?",
      )
      .get(id) as { targetHost: string; formVersion: string } | undefined;
    if (!run) throw new Error("APPLICATION_RUN_NOT_FOUND");
    if (run.targetHost !== consent.targetHost || run.formVersion !== consent.formVersion) {
      throw new Error("CONSENT_RUN_BINDING_MISMATCH");
    }
    this.sqlite
      .prepare(
        `INSERT INTO final_action_consents
          (id, run_id, packet_digest, target_host, form_version, token_hash,
           expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        consent.id,
        id,
        consent.packetDigest,
        consent.targetHost,
        consent.formVersion,
        consent.tokenHash,
        consent.expiresAt,
        consent.usedAt,
        this.now().toISOString(),
      );
  }

  approveDocument(input: { documentArtifactId: string; contentDigest: string }): string {
    const artifactId = z.string().min(1).parse(input.documentArtifactId);
    const contentDigest = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.contentDigest);
    const artifact = this.sqlite
      .prepare("SELECT content_digest AS contentDigest, stale FROM document_artifacts WHERE id = ?")
      .get(artifactId) as { contentDigest: string; stale: number } | undefined;
    if (!artifact) throw new Error("DOCUMENT_ARTIFACT_NOT_FOUND");
    if (artifact.stale) throw new Error("STALE_DOCUMENT_CANNOT_BE_APPROVED");
    if (artifact.contentDigest !== contentDigest) throw new Error("DOCUMENT_DIGEST_MISMATCH");
    const existing = this.sqlite
      .prepare(
        `SELECT id FROM document_approvals
         WHERE document_artifact_id = ? AND content_digest = ? AND invalidated_at IS NULL`,
      )
      .get(artifactId, contentDigest) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO document_approvals
          (id, document_artifact_id, content_digest, approved_by, approved_at)
         VALUES (?, ?, ?, 'LOCAL_USER', ?)`,
      )
      .run(id, artifactId, contentDigest, this.now().toISOString());
    return id;
  }

  invalidateStaleDependencies(input: {
    jobId: string;
    currentJobVersionId: string;
    currentProfileVersionId: string;
    reasonCode: string;
  }): { evaluations: number; documents: number; packets: number } {
    const parsed = z
      .object({
        jobId: z.string().min(1),
        currentJobVersionId: z.string().min(1),
        currentProfileVersionId: z.string().min(1),
        reasonCode: z.string().min(1).max(100),
      })
      .parse(input);
    return this.sqlite.transaction(() => {
      const now = this.now().toISOString();
      const evaluations = this.sqlite
        .prepare(
          `UPDATE evaluation_versions SET stale = 1
           WHERE job_id = ? AND (job_version_id <> ? OR profile_version_id <> ?) AND stale = 0`,
        )
        .run(parsed.jobId, parsed.currentJobVersionId, parsed.currentProfileVersionId).changes;
      const documents = this.sqlite
        .prepare(
          `UPDATE document_artifacts SET stale = 1
           WHERE job_id = ? AND (job_version_id <> ? OR profile_version_id <> ?) AND stale = 0`,
        )
        .run(parsed.jobId, parsed.currentJobVersionId, parsed.currentProfileVersionId).changes;
      this.sqlite
        .prepare(
          `UPDATE document_approvals SET invalidated_at = ?, invalidation_reason = ?
           WHERE invalidated_at IS NULL AND document_artifact_id IN
             (SELECT id FROM document_artifacts WHERE job_id = ? AND stale = 1)`,
        )
        .run(now, parsed.reasonCode, parsed.jobId);
      const packets = this.sqlite
        .prepare(
          `UPDATE application_packets SET status = 'INVALIDATED', readiness_json = ?, updated_at = ?
           WHERE job_id = ? AND status <> 'INVALIDATED' AND
             (job_version_id <> ? OR profile_version_id <> ?)`,
        )
        .run(
          JSON.stringify({
            status: "REVIEW_REQUIRED",
            blockers: [parsed.reasonCode],
            warnings: [],
          }),
          now,
          parsed.jobId,
          parsed.currentJobVersionId,
          parsed.currentProfileVersionId,
        ).changes;
      return { evaluations, documents, packets };
    })();
  }

  appendApplicationEvent(
    input: Omit<BetaApplicationEvent, "id" | "fromStatus" | "occurredAt"> & {
      occurredAt?: string;
    },
  ): { created: boolean; eventId: string; status: BetaApplicationEvent["toStatus"] } {
    return this.sqlite.transaction(() => {
      const existing = this.sqlite
        .prepare(
          `SELECT id, to_status AS toStatus FROM application_events_v2
           WHERE idempotency_key = ?`,
        )
        .get(input.idempotencyKey) as
        | { id: string; toStatus: BetaApplicationEvent["toStatus"] }
        | undefined;
      if (existing) return { created: false, eventId: existing.id, status: existing.toStatus };
      const identityColumn = input.applicationId ? "application_id" : "packet_id";
      const identity = input.applicationId ?? input.packetId;
      if (!identity) throw new Error("APPLICATION_EVENT_IDENTITY_REQUIRED");
      const current = this.sqlite
        .prepare(
          `SELECT to_status AS toStatus FROM application_events_v2
           WHERE ${identityColumn} = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
        )
        .get(identity) as { toStatus: BetaApplicationEvent["toStatus"] } | undefined;
      const fromStatus = current?.toStatus ?? null;
      if (fromStatus === null) {
        if (input.toStatus !== "DISCOVERED") throw new Error("APPLICATION_MUST_START_DISCOVERED");
      } else if (!canTransitionBetaApplication(fromStatus, input.toStatus)) {
        throw new Error(`Application cannot transition from ${fromStatus} to ${input.toStatus}`);
      }
      const event = BetaApplicationEventSchema.parse({
        ...input,
        id: this.id(),
        fromStatus,
        occurredAt: input.occurredAt ?? this.now().toISOString(),
      });
      this.sqlite
        .prepare(
          `INSERT INTO application_events_v2
            (id, application_id, packet_id, from_status, to_status, event_type, actor,
             idempotency_key, metadata_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.applicationId,
          event.packetId,
          event.fromStatus,
          event.toStatus,
          event.eventType,
          event.actor,
          event.idempotencyKey,
          JSON.stringify(event.metadata),
          event.occurredAt,
        );
      if (event.applicationId) {
        this.sqlite
          .prepare("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?")
          .run(event.toStatus, event.occurredAt, event.applicationId);
      }
      return { created: true, eventId: event.id, status: event.toStatus };
    })();
  }
}
