import { randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import {
  SeekAdapterError,
  SeekCheckpointSchema,
  type SafeAuditValue,
  type SeekAccessMode,
  type SeekAuditEvent,
  type SeekCheckpoint,
  type SeekCommitResult,
  type SeekDiscoveryPersistence,
  type SeekPersistenceItem,
  type SeekPersistenceOutcome,
  type SeekRawJobRecord,
} from "@applypilot/job-sources";
/*
 * Keep persistence behind the source-agnostic foundation tables. The SEEK-specific
 * checkpoint payload lives in settings, so Phase 2 requires no schema migration.
 */
import type { Job } from "@applypilot/job-model";

const SOURCE_ID = "source:seek";

function checkpointKey(queryHash: string, mode: SeekAccessMode): string {
  return `seek.discovery.checkpoint.${mode}.${queryHash}`;
}

function normalizedJobColumns(job: Job, now: string) {
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

export class JobDiscoveryRepository implements SeekDiscoveryPersistence {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadCheckpoint(queryHash: string, mode: SeekAccessMode): Promise<unknown | null> {
    const row = this.sqlite
      .prepare("SELECT value_json AS valueJson FROM settings WHERE key = ?")
      .get(checkpointKey(queryHash, mode)) as { valueJson: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.valueJson) as unknown;
    } catch {
      return { invalidCheckpointJson: true };
    }
  }

  async commitPage(
    items: Array<SeekPersistenceItem<SeekRawJobRecord>>,
    proposedCheckpoint: SeekCheckpoint,
  ): Promise<SeekCommitResult> {
    const transaction = this.sqlite.transaction(() => {
      const now = this.now().toISOString();
      const storedCheckpoint = this.sqlite
        .prepare("SELECT value_json AS valueJson FROM settings WHERE key = ?")
        .get(checkpointKey(proposedCheckpoint.queryHash, proposedCheckpoint.mode)) as
        | { valueJson: string }
        | undefined;
      if (storedCheckpoint) {
        const parsedStored = SeekCheckpointSchema.safeParse(JSON.parse(storedCheckpoint.valueJson));
        if (parsedStored.success && parsedStored.data.runId !== proposedCheckpoint.runId) {
          throw new SeekAdapterError("CHECKPOINT_MISMATCH", {
            message: "A different discovery run already owns this query checkpoint",
            diagnosticCode: "SEEK_CONCURRENT_CHECKPOINT_CONFLICT",
          });
        }
      }
      this.sqlite
        .prepare(
          `INSERT INTO job_sources
            (id, name, capabilities_json, enabled, created_at, updated_at)
           VALUES (?, 'SEEK', ?, 1, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             capabilities_json = excluded.capabilities_json,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
        )
        .run(
          SOURCE_ID,
          JSON.stringify({
            mode: proposedCheckpoint.mode,
            state: "AVAILABLE",
            capabilities: ["DISCOVERY", "JOB_DETAILS"],
            networkAccess: false,
          }),
          now,
          now,
        );

      const outcome: SeekPersistenceOutcome = { added: 0, updated: 0, duplicates: 0 };
      const findExisting = this.sqlite.prepare(
        `SELECT job_id AS jobId, payload_hash AS payloadHash
         FROM job_source_records
         WHERE source_id = ? AND external_id = ?`,
      );
      const insertJob = this.sqlite.prepare(
        `INSERT INTO jobs
          (id, title, company, category, location, employment_type, normalized_json,
           eligibility_status, fit_score, application_status, date_posted, date_discovered,
           date_updated, created_at, updated_at)
         VALUES
          (@id, @title, @company, @category, @location, @employmentType, @normalizedJson,
           @eligibilityStatus, @fitScore, @applicationStatus, @datePosted, @dateDiscovered,
           @dateUpdated, @createdAt, @updatedAt)`,
      );
      const updateJob = this.sqlite.prepare(
        `UPDATE jobs SET
           title = @title,
           company = @company,
           category = @category,
           location = @location,
           employment_type = @employmentType,
           normalized_json = @normalizedJson,
           eligibility_status = @eligibilityStatus,
           fit_score = @fitScore,
           application_status = @applicationStatus,
           date_posted = @datePosted,
           date_discovered = @dateDiscovered,
           date_updated = @dateUpdated,
           updated_at = @updatedAt
         WHERE id = @id`,
      );
      const insertSourceRecord = this.sqlite.prepare(
        `INSERT INTO job_source_records
          (id, job_id, source_id, external_id, source_url, raw_payload_json,
           payload_hash, discovered_at, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const updateSourceRecord = this.sqlite.prepare(
        `UPDATE job_source_records SET
           source_url = ?, raw_payload_json = ?, payload_hash = ?, discovered_at = ?, fetched_at = ?
         WHERE source_id = ? AND external_id = ?`,
      );

      for (const { record, job } of items) {
        const existing = findExisting.get(SOURCE_ID, record.externalId) as
          | { jobId: string; payloadHash: string }
          | undefined;
        let eventType: SeekAuditEvent["eventType"];
        let eventMetadata: Record<string, SafeAuditValue>;
        if (!existing) {
          insertJob.run(normalizedJobColumns(job, now));
          insertSourceRecord.run(
            `seek-record:${record.externalId}`,
            job.id,
            SOURCE_ID,
            record.externalId,
            record.canonicalUrl,
            JSON.stringify(record.rawPayload),
            record.rawPayloadHash,
            record.discoveredAt,
            record.fetchedAt,
          );
          outcome.added += 1;
          eventType = "discovery.job.added";
          eventMetadata = { payloadHash: record.rawPayloadHash };
        } else if (existing.payloadHash === record.rawPayloadHash) {
          outcome.duplicates += 1;
          eventType = "discovery.job.duplicate";
          eventMetadata = { payloadHash: record.rawPayloadHash };
        } else {
          updateJob.run({ ...normalizedJobColumns(job, now), id: existing.jobId });
          updateSourceRecord.run(
            record.canonicalUrl,
            JSON.stringify(record.rawPayload),
            record.rawPayloadHash,
            record.discoveredAt,
            record.fetchedAt,
            SOURCE_ID,
            record.externalId,
          );
          outcome.updated += 1;
          eventType = "discovery.job.updated";
          eventMetadata = {
            previousPayloadHash: existing.payloadHash,
            payloadHash: record.rawPayloadHash,
            fetchedAt: record.fetchedAt,
          };
        }
        this.insertAuditEvent({
          eventType,
          runId: proposedCheckpoint.runId,
          occurredAt: now,
          metadata: {
            source: "SEEK",
            externalId: record.externalId,
            ...eventMetadata,
          },
        });
      }

      const checkpoint = SeekCheckpointSchema.parse({
        ...proposedCheckpoint,
        counts: {
          ...proposedCheckpoint.counts,
          added: proposedCheckpoint.counts.added + outcome.added,
          updated: proposedCheckpoint.counts.updated + outcome.updated,
          duplicates: proposedCheckpoint.counts.duplicates + outcome.duplicates,
        },
      });
      this.sqlite
        .prepare(
          `INSERT INTO settings (key, value_json, classification, updated_at)
           VALUES (?, ?, 'LOCAL_PRIVATE', ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             classification = excluded.classification,
             updated_at = excluded.updated_at`,
        )
        .run(checkpointKey(checkpoint.queryHash, checkpoint.mode), JSON.stringify(checkpoint), now);
      return { outcome, checkpoint };
    });
    return transaction();
  }

  async recordEvent(event: SeekAuditEvent): Promise<void> {
    this.insertAuditEvent(event);
  }

  private insertAuditEvent(event: SeekAuditEvent): void {
    this.sqlite
      .prepare(
        `INSERT INTO audit_events
          (id, event_type, entity_type, entity_id, actor, redacted_metadata_json, occurred_at)
         VALUES (?, ?, 'discovery_run', ?, 'SYSTEM', ?, ?)`,
      )
      .run(
        randomUUID(),
        event.eventType,
        event.runId,
        JSON.stringify(this.redactMetadata(event.metadata)),
        event.occurredAt,
      );
  }

  private redactMetadata(metadata: Record<string, SafeAuditValue>): Record<string, SafeAuditValue> {
    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) => !/(content|description|raw|cookie|token|secret)/i.test(key),
      ),
    );
  }
}
