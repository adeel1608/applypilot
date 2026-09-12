import { createHash, randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import {
  SourceCapabilityV2Schema,
  runLeverSourceDiscovery,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  SourceStopCodeSchema,
  SourceTransportLifecycleStageSchema,
  validateSourceAuditMetadata,
  type LeverPageV2,
  type LeverPostingRecordV2,
  type SourceCapabilityV2,
  type SourceRunBudget,
  type SourceRunSink,
  type SourceTransportLifecycleStage,
  type SecureSourceTransportDependencies,
} from "@applypilot/job-sources";
import { ParsedJobFieldsSchema, normalizeR2AJobEvidence } from "@applypilot/job-importer";
import { JobSchema } from "@applypilot/job-model";
import { ObservationIdentitySchema, type ObservationIdentity } from "@applypilot/job-normalizer";

import { normalizeImportedJob } from "./job-import-repository";
import { R2ARepository } from "./r2a-repository";
import { R2Repository } from "./r2-repository";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function employmentType(
  value: string | null,
): "CASUAL" | "PART_TIME" | "FULL_TIME" | "CONTRACT" | "INTERNSHIP" | "UNKNOWN" {
  if (!value) return "UNKNOWN";
  if (/part[ -]?time/i.test(value)) return "PART_TIME";
  if (/full[ -]?time/i.test(value)) return "FULL_TIME";
  if (/casual/i.test(value)) return "CASUAL";
  if (/intern/i.test(value)) return "INTERNSHIP";
  if (/contract|temporary|fixed[ -]?term/i.test(value)) return "CONTRACT";
  return "UNKNOWN";
}

function structuredLeverRecord(
  record: LeverPostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  const locations = record.allLocations.length
    ? record.allLocations
    : record.location
      ? [record.location]
      : [];
  const sections = record.sections.map(({ heading, content, kind }) => ({
    heading,
    content,
    kind,
  }));
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { name: capability.tenant, value: record.externalId },
    title: record.title,
    hiringOrganization: { name: capability.alias },
    jobLocation: locations.map((location) => ({ address: location })),
    employmentType: record.commitment,
    description: record.description,
    datePosted: record.postedAt,
    jobLocationType: record.workplaceType,
    baseSalary: record.salaryRange
      ? {
          currency: record.salaryRange.currency,
          value: {
            minValue: record.salaryRange.min,
            maxValue: record.salaryRange.max,
            unitText: record.salaryRange.interval,
          },
        }
      : null,
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    department: record.department,
    team: record.team,
    country: record.country,
    sourceSections: sections,
    requirementTexts: sections
      .filter(({ kind }) => kind === "REQUIREMENTS")
      .map(({ content }) => content),
    responsibilities: sections
      .filter(({ kind }) => kind === "RESPONSIBILITIES")
      .map(({ content }) => content),
    benefitTexts: sections.filter(({ kind }) => kind === "BENEFITS").map(({ content }) => content),
  };
}

function evidenceLines(record: LeverPostingRecordV2, kind: "REQUIREMENTS" | "RESPONSIBILITIES") {
  return record.sections
    .filter((section) => section.kind === kind)
    .flatMap(({ content }) => content.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((line) => line.slice(0, 4_096));
}

export interface PersistedSourcePageResult {
  createdJobIds: string[];
  duplicateObservationCount: number;
}

export class SourceEnablementRepository implements SourceRunSink {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  available(): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_capability_versions'",
        )
        .get(),
    );
  }

  persistCapabilityVersion(input: SourceCapabilityV2): { id: string; created: boolean } {
    if (!this.available()) throw new Error("SOURCE_V2_SCHEMA_REQUIRED");
    const capability = SourceCapabilityV2Schema.parse(input);
    const digest = sourceCapabilityDigest(capability);
    const existing = this.sqlite
      .prepare(
        `SELECT id, configuration_digest AS digest FROM source_capability_versions
         WHERE capability_id = ? AND version = ?`,
      )
      .get(capability.capabilityId, capability.version) as
      | { id: string; digest: string }
      | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new Error("CAPABILITY_IMMUTABLE_VERSION_CONFLICT");
      return { id: existing.id, created: false };
    }
    const latest = this.sqlite
      .prepare(
        `SELECT id, version FROM source_capability_versions
         WHERE capability_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(capability.capabilityId) as { id: string; version: number } | undefined;
    if (
      (latest &&
        (capability.version !== latest.version + 1 ||
          capability.predecessorVersion !== latest.version)) ||
      (!latest && (capability.version !== 1 || capability.predecessorVersion !== null))
    ) {
      throw new Error("CAPABILITY_VERSION_SEQUENCE_INVALID");
    }
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO source_capability_versions
          (id, capability_id, version, predecessor_id, source, alias, tenant, region,
           allowed_host, allowed_path_prefix, allowed_operations_json, approval_state,
           approval_reference, approved_at, policy_version, policy_reviewed_at, policy_expires_at,
           capability_expires_at, request_budget, record_cap, page_size_cap, response_byte_limit,
           request_timeout_ms, run_timeout_ms, max_redirects, max_retries, max_concurrency,
           parser_version, configuration_digest, revoked_at, revocation_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        capability.capabilityId,
        capability.version,
        latest?.id ?? null,
        capability.source,
        capability.alias,
        capability.tenant,
        capability.region,
        capability.allowedHost,
        capability.allowedPathPrefix,
        JSON.stringify(capability.allowedOperations),
        capability.approvalState,
        capability.approvalReference,
        capability.approvedAt,
        capability.policyVersion,
        capability.policyReviewedAt,
        capability.policyExpiresAt,
        capability.capabilityExpiresAt,
        capability.requestBudget,
        capability.recordCap,
        capability.pageSizeCap,
        capability.responseByteLimit,
        capability.requestTimeoutMs,
        capability.runTimeoutMs,
        capability.maxRedirects,
        capability.maxRetries,
        capability.maxConcurrency,
        capability.parserVersion,
        digest,
        capability.revokedAt,
        capability.revocationReason,
        this.now().toISOString(),
      );
    const audit = validateSourceAuditMetadata("source.capability.versioned", {
      capabilityId: capability.capabilityId,
      version: capability.version,
      state: capability.approvalState,
    });
    this.audit("source.capability.versioned", "source_capability", capability.capabilityId, audit);
    return { id, created: true };
  }

  start(input: {
    capability: SourceCapabilityV2;
    capabilityDigest: string;
    operation: "LIST_JOBS";
    startedAt: string;
  }): string {
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    if (
      sourceCapabilityReadiness(capability, new Date(input.startedAt)).status !== "SOURCE_ENABLED"
    ) {
      throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
    }
    const row = this.currentCapability(capability.capabilityId);
    if (
      !row ||
      row.version !== capability.version ||
      row.digest !== input.capabilityDigest ||
      row.digest !== sourceCapabilityDigest(capability)
    ) {
      throw new Error("CAPABILITY_CHANGED");
    }
    const active = this.sqlite
      .prepare(
        `SELECT 1 FROM source_run_checkpoints
         WHERE capability_version_id = ? AND status = 'RUNNING'`,
      )
      .get(row.id);
    if (active) throw new Error("CONCURRENT_RUN");
    const runId = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO source_run_checkpoints
          (id, capability_version_id, capability_digest, operation, status, current_cursor,
           next_cursor, seen_page_digests_json, request_count, page_count, record_count, byte_count,
           retry_count, redirect_count, safe_error_code, retry_after, owner_started_at,
           owner_cancelled_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'RUNNING', NULL, '0', '[]', 0, 0, 0, 0, 0, 0, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        runId,
        row.id,
        row.digest,
        input.operation,
        input.startedAt,
        input.startedAt,
        input.startedAt,
      );
    const audit = validateSourceAuditMetadata("source.run.started", {
      runId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      operation: input.operation,
    });
    this.audit("source.run.started", "source_run", runId, audit);
    return runId;
  }

  assertCapabilityCurrent(input: {
    runId: string;
    capabilityId: string;
    capabilityVersion: number;
    capabilityDigest: string;
  }): void {
    const run = this.sqlite
      .prepare(
        `SELECT r.status, r.capability_digest AS digest, c.capability_id AS capabilityId,
                c.version
         FROM source_run_checkpoints r
         JOIN source_capability_versions c ON c.id = r.capability_version_id
         WHERE r.id = ?`,
      )
      .get(input.runId) as
      | { status: string; digest: string; capabilityId: string; version: number }
      | undefined;
    const current = this.currentCapability(input.capabilityId);
    if (
      !run ||
      run.status !== "RUNNING" ||
      run.capabilityId !== input.capabilityId ||
      run.version !== input.capabilityVersion ||
      run.digest !== input.capabilityDigest ||
      current?.version !== input.capabilityVersion ||
      current.digest !== input.capabilityDigest
    ) {
      throw new Error("CAPABILITY_CHANGED");
    }
  }

  persistPage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: LeverPageV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): void {
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    const result = this.sqlite.transaction(() => {
      this.assertCapabilityCurrent({
        runId: input.runId,
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.version,
        capabilityDigest: sourceCapabilityDigest(capability),
      });
      const createdJobIds: string[] = [];
      let duplicateObservationCount = 0;
      for (const record of input.page.records) {
        const persisted = this.persistLeverObservation(
          record,
          capability,
          input.runId,
          input.observedAt,
        );
        if (persisted.created) createdJobIds.push(persisted.jobId);
        else duplicateObservationCount += 1;
      }
      const pageNumber = input.budget.pages;
      this.sqlite
        .prepare(
          `INSERT INTO source_run_pages
            (id, run_id, page_number, cursor, next_cursor, page_digest, request_count,
             record_count, byte_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.id(),
          input.runId,
          pageNumber,
          String(input.page.cursor),
          input.page.nextCursor === null ? null : String(input.page.nextCursor),
          input.page.pageDigest,
          input.page.requestCount,
          input.page.records.length,
          input.page.byteCount,
          input.observedAt,
        );
      const digests = this.sqlite
        .prepare("SELECT page_digest FROM source_run_pages WHERE run_id = ? ORDER BY page_number")
        .all(input.runId)
        .map((row) => (row as { page_digest: string }).page_digest);
      this.sqlite
        .prepare(
          `UPDATE source_run_checkpoints SET current_cursor = ?, next_cursor = ?,
             seen_page_digests_json = ?, request_count = ?, page_count = ?, record_count = ?,
             byte_count = ?, retry_count = ?, redirect_count = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          String(input.page.cursor),
          input.page.nextCursor === null ? null : String(input.page.nextCursor),
          JSON.stringify(digests),
          input.budget.attempts,
          input.budget.pages,
          input.budget.records,
          input.budget.bytes,
          input.budget.retries,
          input.budget.redirects,
          input.observedAt,
          input.runId,
        );
      const audit = validateSourceAuditMetadata("source.page.persisted", {
        runId: input.runId,
        pageNumber,
        requestCount: input.page.requestCount,
        recordCount: input.page.records.length,
        byteCount: input.page.byteCount,
      });
      this.audit("source.page.persisted", "source_run", input.runId, audit);
      return { createdJobIds, duplicateObservationCount };
    })();
    void result;
  }

  complete(input: { runId: string; budget: SourceRunBudget; completedAt: string }): void {
    this.finish(input.runId, "COMPLETE", input.budget, null, null, null, input.completedAt);
  }

  stop(input: {
    runId: string;
    budget: SourceRunBudget;
    code: string;
    retryAfter: string | null;
    transportStage: SourceTransportLifecycleStage | null;
    stoppedAt: string;
  }): void {
    this.finish(
      input.runId,
      "STOPPED",
      input.budget,
      input.code,
      input.retryAfter,
      input.transportStage,
      input.stoppedAt,
    );
  }

  jobIdsForRun(runId: string): string[] {
    return (
      this.sqlite
        .prepare(
          `SELECT DISTINCT job_id AS jobId FROM source_observations
           WHERE run_id = ? AND job_id IS NOT NULL ORDER BY observed_at, id`,
        )
        .all(runId) as Array<{ jobId: string }>
    ).map(({ jobId }) => jobId);
  }

  pipelineWorkForCompletedRun(
    runId: string,
  ): Array<{ jobId: string; evaluationId: string | null }> {
    const run = this.sqlite
      .prepare(
        `SELECT r.status,c.capability_id AS capabilityId
         FROM source_run_checkpoints r
         JOIN source_capability_versions c ON c.id=r.capability_version_id
         WHERE r.id=?`,
      )
      .get(runId) as { status: string; capabilityId: string } | undefined;
    if (!run || run.status !== "COMPLETE") throw new Error("SOURCE_RUN_NOT_COMPLETE");
    const jobs = this.sqlite
      .prepare(
        `SELECT DISTINCT o.job_id AS jobId
         FROM source_observations o
         JOIN source_run_checkpoints historical_run ON historical_run.id=o.run_id
         JOIN source_capability_versions historical_capability
           ON historical_capability.id=historical_run.capability_version_id
         WHERE historical_capability.capability_id=? AND o.job_id IS NOT NULL
         ORDER BY o.observed_at,o.id`,
      )
      .all(run.capabilityId) as Array<{ jobId: string }>;
    const work: Array<{ jobId: string; evaluationId: string | null }> = [];
    for (const { jobId } of jobs) {
      const version = this.sqlite
        .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
        .get(jobId) as { id: string } | undefined;
      if (!version) throw new Error("SOURCE_JOB_VERSION_REQUIRED");
      const evaluation = this.sqlite
        .prepare(
          `SELECT id FROM r2_evaluation_versions
           WHERE job_id=? AND job_version_id=? AND stale=0
             AND EXISTS (SELECT 1 FROM candidate_profiles
               WHERE active_version_id=r2_evaluation_versions.profile_version_id)
           ORDER BY evaluated_at DESC,rowid DESC LIMIT 1`,
        )
        .get(jobId, version.id) as { id: string } | undefined;
      if (!evaluation) {
        work.push({ jobId, evaluationId: null });
        continue;
      }
      const queue = this.sqlite
        .prepare(
          `SELECT freshness,r2_evaluation_id AS evaluationId
           FROM r2_queue_decision_versions WHERE job_id=? ORDER BY version DESC LIMIT 1`,
        )
        .get(jobId) as { freshness: string; evaluationId: string } | undefined;
      if (queue?.freshness === "CURRENT" && queue.evaluationId === evaluation.id) continue;
      work.push({ jobId, evaluationId: evaluation.id });
    }
    return work;
  }

  recovery(runId: string) {
    const row = this.sqlite
      .prepare(
        `SELECT status, operation, request_count AS requestCount, page_count AS pageCount,
                record_count AS recordCount, next_cursor AS nextCursor,
                safe_error_code AS safeErrorCode, retry_after AS retryAfter,
                (SELECT json_extract(a.redacted_metadata_json, '$.transportStage')
                 FROM audit_events a
                 WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
                   AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS transportStage
         FROM source_run_checkpoints WHERE id = ?`,
      )
      .get(runId) as (Record<string, unknown> & { transportStage: unknown }) | undefined;
    if (!row) return undefined;
    const stage = SourceTransportLifecycleStageSchema.safeParse(row.transportStage);
    return { ...row, transportStage: stage.success ? stage.data : null };
  }

  cancel(runId: string, cancelledAt = this.now().toISOString()): void {
    if (!/^[A-Za-z0-9:._-]{1,200}$/.test(runId)) throw new Error("SOURCE_RUN_ID_INVALID");
    const run = this.sqlite
      .prepare(
        `SELECT status,request_count AS requestCount,record_count AS recordCount
         FROM source_run_checkpoints WHERE id=?`,
      )
      .get(runId) as { status: string; requestCount: number; recordCount: number } | undefined;
    if (!run) throw new Error("SOURCE_RUN_NOT_FOUND");
    if (run.status !== "RUNNING") throw new Error("SOURCE_RUN_NOT_ACTIVE");
    this.sqlite
      .prepare(
        `UPDATE source_run_checkpoints SET status='STOPPED',safe_error_code='OWNER_CANCELLED',
         owner_cancelled_at=?,completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'`,
      )
      .run(cancelledAt, cancelledAt, cancelledAt, runId);
    const audit = validateSourceAuditMetadata("source.run.stopped", {
      runId,
      code: "OWNER_CANCELLED",
      transportStage: null,
      requestCount: run.requestCount,
      recordCount: run.recordCount,
    });
    this.audit("source.run.stopped", "source_run", runId, audit);
  }

  private currentCapability(
    capabilityId: string,
  ): { id: string; version: number; digest: string } | undefined {
    return this.sqlite
      .prepare(
        `SELECT id, version, configuration_digest AS digest FROM source_capability_versions
         WHERE capability_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(capabilityId) as { id: string; version: number; digest: string } | undefined;
  }

  private persistLeverObservation(
    record: LeverPostingRecordV2,
    capability: SourceCapabilityV2,
    runId: string,
    observedAt: string,
  ): { jobId: string; created: boolean } {
    const location = record.location ?? record.allLocations[0] ?? null;
    if (!location || !record.description.trim())
      throw new Error("SOURCE_RECORD_REQUIRED_FIELD_MISSING");
    const identity = `${record.source}\n${record.region}\n${record.tenant}\n${record.externalId}`;
    const jobId = `source-job-${sha256(identity).slice(0, 32)}`;
    const observationId = `source-observation-${sha256(`${identity}\n${record.contentDigest}`)}`;
    const existingObservation = this.sqlite
      .prepare("SELECT 1 FROM source_observations WHERE id = ?")
      .get(observationId);
    if (existingObservation) return { jobId, created: false };
    const structured = structuredLeverRecord(record, capability);
    const sourceText = JSON.stringify(structured);
    const fields = ParsedJobFieldsSchema.parse({
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      applicationUrl: record.applicationUrl,
      requisitionId: null,
      title: record.title,
      company: capability.alias,
      location,
      category: record.department ?? record.team,
      description: record.description,
      salaryText: null,
      employmentType: employmentType(record.commitment),
      requirements: evidenceLines(record, "REQUIREMENTS"),
      responsibilities: evidenceLines(record, "RESPONSIBILITIES"),
      datePosted: record.postedAt,
      coverLetterRequired: null,
    });
    const job = normalizeImportedJob(
      fields,
      "LEVER",
      {
        importId: runId,
        recordId: observationId,
        parserVersion: capability.parserVersion,
        acquisitionMethod: "APPROVED_SOURCE_FETCH",
        contentHash: record.contentDigest,
        now: observedAt,
        editedFields: [],
      },
      jobId,
    );
    const sourceId = `source-lever-${sha256(`${capability.region}\n${capability.tenant}`).slice(0, 24)}`;
    const sourceName = `LEVER:${capability.region}:${capability.tenant}`;
    this.sqlite
      .prepare(
        `INSERT INTO job_sources (id, name, capabilities_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(name) DO UPDATE SET capabilities_json = excluded.capabilities_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        sourceId,
        sourceName,
        JSON.stringify({ reader: "R1B", version: capability.parserVersion }),
        observedAt,
        observedAt,
      );
    const exists = this.sqlite.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId);
    if (!exists) {
      this.sqlite
        .prepare(
          `INSERT INTO jobs
            (id,title,company,category,location,employment_type,normalized_json,eligibility_status,
             fit_score,application_status,date_posted,date_discovered,date_updated,created_at,updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'NEW', ?, ?, NULL, ?, ?)`,
        )
        .run(
          job.id,
          job.title,
          job.company,
          job.category,
          job.location,
          job.employmentType,
          JSON.stringify(job),
          job.datePosted,
          observedAt,
          observedAt,
          observedAt,
        );
    } else {
      this.sqlite
        .prepare(
          `UPDATE jobs SET title=?, company=?, category=?, location=?, employment_type=?,
             normalized_json=?, eligibility_status=NULL, fit_score=NULL, date_posted=?,
             date_updated=?, updated_at=? WHERE id=?`,
        )
        .run(
          job.title,
          job.company,
          job.category,
          job.location,
          job.employmentType,
          JSON.stringify(job),
          job.datePosted,
          observedAt,
          observedAt,
          job.id,
        );
    }
    const sourceRecordId = `source-record-${sha256(identity)}`;
    this.sqlite
      .prepare(
        `INSERT INTO job_source_records
          (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,discovered_at,
           fetched_at,identity_kind,identity_value,acquisition_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXTERNAL_ID', ?, 'APPROVED_SOURCE_FETCH')
         ON CONFLICT(source_id,identity_kind,identity_value) DO UPDATE SET
           job_id=excluded.job_id, source_url=excluded.source_url,
           fetched_at=excluded.fetched_at`,
      )
      .run(
        sourceRecordId,
        jobId,
        sourceId,
        record.externalId,
        record.sourceUrl,
        JSON.stringify(record.rawPayload),
        record.contentDigest,
        observedAt,
        observedAt,
        record.externalId,
      );
    const persistedSourceRecord = this.sqlite
      .prepare(
        `SELECT id FROM job_source_records
         WHERE source_id = ? AND identity_kind = 'EXTERNAL_ID' AND identity_value = ?`,
      )
      .get(sourceId, record.externalId) as { id: string } | undefined;
    if (!persistedSourceRecord) throw new Error("PERSISTENCE_FAILED");
    const previousObservation = this.sqlite
      .prepare(
        `SELECT id FROM source_observations
         WHERE source_record_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1`,
      )
      .get(persistedSourceRecord.id) as { id: string } | undefined;
    this.sqlite
      .prepare(
        `INSERT INTO source_observations
          (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
           content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
           policy_version,run_id,supersedes_observation_id)
         VALUES (?, ?, ?, 'LEVER', ?, ?, ?, 'APPROVED_SOURCE_FETCH', ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        observationId,
        jobId,
        persistedSourceRecord.id,
        capability.tenant,
        record.externalId,
        record.sourceUrl,
        record.contentDigest,
        `source_observation_payloads:${observationId}`,
        observedAt,
        record.postedAt,
        capability.parserVersion,
        capability.policyVersion,
        runId,
        previousObservation?.id ?? null,
      );
    this.sqlite
      .prepare(
        `INSERT INTO source_observation_payloads
          (observation_id,payload_json,content_digest,created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(observationId, JSON.stringify(record.rawPayload), record.contentDigest, observedAt);
    const version = Number(
      this.sqlite
        .prepare("SELECT coalesce(max(version),0)+1 FROM job_versions WHERE job_id = ?")
        .pluck()
        .get(jobId),
    );
    const jobVersionId = `source-job-version-${sha256(`${jobId}\n${version}\n${record.contentDigest}`)}`;
    this.sqlite
      .prepare(
        `INSERT INTO job_versions
          (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobVersionId,
        jobId,
        version,
        JSON.stringify(job),
        record.contentDigest,
        observationId,
        observedAt,
      );
    const normalization = normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: observationId,
      structured,
      explicitLocation: location,
    });
    new R2ARepository(this.sqlite, this.now).recordNormalization(jobVersionId, normalization);
    this.suggestCrossSourceDuplicates(observationId, capability.source, capability.tenant);
    return { jobId, created: true };
  }

  private observationIdentity(observationId: string): ObservationIdentity {
    const row = this.sqlite
      .prepare(
        `SELECT o.id AS observationId,o.source,o.tenant,o.external_id AS externalId,
         v.normalized_json AS normalizedJson FROM source_observations o
         JOIN job_versions v ON v.id=(SELECT first.id FROM job_versions first
           WHERE first.source_observation_id=o.id ORDER BY first.version,first.rowid LIMIT 1)
         WHERE o.id=?`,
      )
      .get(observationId) as
      | {
          observationId: string;
          source: string;
          tenant: string | null;
          externalId: string | null;
          normalizedJson: string;
        }
      | undefined;
    if (!row) throw new Error("R2_DUPLICATE_OBSERVATION_VERSION_REQUIRED");
    const job = JobSchema.parse(JSON.parse(row.normalizedJson));
    return ObservationIdentitySchema.parse({
      observationId: row.observationId,
      source: row.source,
      tenant: row.tenant,
      externalId: row.externalId,
      applicationUrl: job.sourceMetadata.applicationUrl ?? null,
      requisitionId: job.sourceMetadata.requisitionId ?? null,
      company: job.company,
      title: job.title,
      location: job.location,
      employmentType: job.employmentType,
      datePosted: job.datePosted,
      description: job.description,
    });
  }

  private suggestCrossSourceDuplicates(
    observationId: string,
    source: string,
    tenant: string,
  ): void {
    const r2 = new R2Repository(this.sqlite, this.now);
    if (!r2.available()) return;
    const candidateIds = this.sqlite
      .prepare(
        `SELECT id FROM source_observations
         WHERE id<>? AND NOT (source=? AND coalesce(tenant,'')=?)
         ORDER BY observed_at DESC,rowid DESC LIMIT 200`,
      )
      .all(observationId, source, tenant) as Array<{ id: string }>;
    const current = this.observationIdentity(observationId);
    for (const candidate of candidateIds) {
      r2.suggestDuplicate(current, this.observationIdentity(candidate.id));
    }
  }

  private finish(
    runId: string,
    status: "COMPLETE" | "STOPPED",
    budget: SourceRunBudget,
    code: string | null,
    retryAfter: string | null,
    transportStage: SourceTransportLifecycleStage | null,
    completedAt: string,
  ): void {
    const result = this.sqlite
      .prepare(
        `UPDATE source_run_checkpoints SET status=?, request_count=?, page_count=?, record_count=?,
           byte_count=?, retry_count=?, redirect_count=?, safe_error_code=?, retry_after=?,
           completed_at=?, updated_at=? WHERE id=? AND status='RUNNING'`,
      )
      .run(
        status,
        budget.attempts,
        budget.pages,
        budget.records,
        budget.bytes,
        budget.retries,
        budget.redirects,
        code,
        retryAfter,
        completedAt,
        completedAt,
        runId,
      );
    if (result.changes !== 1) {
      const existing = this.sqlite
        .prepare("SELECT status FROM source_run_checkpoints WHERE id=?")
        .get(runId) as { status: string } | undefined;
      if (existing?.status === "STOPPED") return;
      throw new Error("SOURCE_RUN_NOT_ACTIVE");
    }
    if (code) {
      const audit = validateSourceAuditMetadata("source.run.stopped", {
        runId,
        code: SourceStopCodeSchema.safeParse(code).success ? code : "PERSISTENCE_FAILED",
        transportStage,
        requestCount: budget.attempts,
        recordCount: budget.records,
      });
      this.audit("source.run.stopped", "source_run", runId, audit);
    } else {
      const audit = validateSourceAuditMetadata("source.run.completed", {
        runId,
        requestCount: budget.attempts,
        pageCount: budget.pages,
        recordCount: budget.records,
      });
      this.audit("source.run.completed", "source_run", runId, audit);
    }
  }

  private audit(eventType: string, entityType: string, entityId: string, metadata: object): void {
    this.sqlite
      .prepare(
        `INSERT INTO audit_events
         (id,event_type,entity_type,entity_id,actor,redacted_metadata_json,occurred_at)
         VALUES (?,?,?,?, 'SYSTEM', ?, ?)`,
      )
      .run(
        this.id(),
        eventType,
        entityType,
        entityId,
        JSON.stringify(metadata),
        this.now().toISOString(),
      );
  }
}

export async function runLeverSourceToQueue(input: {
  capability: SourceCapabilityV2;
  repository: SourceEnablementRepository;
  evaluateJob(jobId: string): Promise<string | null>;
  queueJob(jobId: string, evaluationId: string): Promise<void> | void;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}) {
  const result = await runLeverSourceDiscovery({
    capability: input.capability,
    sink: input.repository,
    now: input.now,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  const queuedJobIds: string[] = [];
  if (result.status === "COMPLETE") {
    for (const work of input.repository.pipelineWorkForCompletedRun(result.runId)) {
      const { jobId } = work;
      const evaluationId = work.evaluationId ?? (await input.evaluateJob(jobId));
      if (!evaluationId) continue;
      await input.queueJob(jobId, evaluationId);
      queuedJobIds.push(jobId);
    }
  }
  return { ...result, queuedJobIds };
}
