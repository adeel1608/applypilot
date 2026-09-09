import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seekFixtureCases } from "../../../fixtures/seek/manifest";
import {
  createSeekRawJobRecord,
  hashPayload,
  normalizeSeekJob,
  type SeekCheckpoint,
} from "@applypilot/job-sources";
import { JobDiscoveryRepository } from "./job-discovery-repository";

const migration = ["0000_applypilot_foundation.sql", "0001_real_world_job_intake.sql"]
  .map((file) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"))
  .join("\n");
const fixedNow = () => new Date("2026-09-05T12:00:00.000Z");

function checkpoint(overrides: Partial<SeekCheckpoint> = {}): SeekCheckpoint {
  return {
    schemaVersion: 1,
    runId: "3b57ce65-85fb-4265-9296-b55043c17891",
    source: "SEEK",
    mode: "FIXTURE_ONLY",
    queryHash: "a".repeat(64),
    nextCursor: null,
    lastSuccessfulFetchAt: fixedNow().toISOString(),
    lastCommittedPage: 1,
    processedPageHashes: ["b".repeat(64)],
    counts: { discovered: 1, added: 0, updated: 0, duplicates: 0, failed: 0 },
    expiresAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

describe("JobDiscoveryRepository", () => {
  let sqlite: BetterSqlite3.Database;
  let repository: JobDiscoveryRepository;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(migration);
    repository = new JobDiscoveryRepository(sqlite, fixedNow);
  });

  afterEach(() => sqlite.close());

  it("atomically adds, deduplicates, updates, audits, and checkpoints source records", async () => {
    const record = seekFixtureCases[0].record;
    const job = normalizeSeekJob(record);
    const added = await repository.commitPage([{ record, job }], checkpoint());
    expect(added.outcome).toEqual({ added: 1, updated: 0, duplicates: 0 });

    const duplicate = await repository.commitPage(
      [{ record, job }],
      checkpoint({ lastCommittedPage: 2, counts: added.checkpoint.counts }),
    );
    expect(duplicate.outcome).toEqual({ added: 0, updated: 0, duplicates: 1 });

    const changedPayload = { fixture: "retail-001", revision: 2 };
    const changedRecord = createSeekRawJobRecord({
      ...record,
      title: "Updated Casual Retail Assistant",
      rawPayload: changedPayload,
      rawPayloadHash: hashPayload(changedPayload),
    });
    const updatedJob = normalizeSeekJob(changedRecord);
    const updated = await repository.commitPage(
      [{ record: changedRecord, job: updatedJob }],
      checkpoint({ lastCommittedPage: 3, counts: duplicate.checkpoint.counts }),
    );
    expect(updated.outcome).toEqual({ added: 0, updated: 1, duplicates: 0 });
    expect(sqlite.prepare("SELECT title FROM jobs WHERE id = ?").pluck().get(job.id)).toBe(
      "Updated Casual Retail Assistant",
    );
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_source_records").pluck().get()).toBe(1);
    expect(await repository.loadCheckpoint("a".repeat(64), "FIXTURE_ONLY")).toEqual(
      updated.checkpoint,
    );
    expect(sqlite.prepare("SELECT COUNT(*) FROM audit_events").pluck().get()).toBe(3);
  });

  it("rejects non-allowlisted audit metadata instead of attempting broad redaction", async () => {
    await expect(
      repository.recordEvent({
        eventType: "discovery.run.started",
        runId: "3b57ce65-85fb-4265-9296-b55043c17891",
        occurredAt: fixedNow().toISOString(),
        metadata: {
          mode: "FIXTURE_ONLY",
          resumed: false,
          queryHash: "a".repeat(64),
          privateCanary: "candidate-private-canary",
        },
      }),
    ).rejects.toThrow();
    expect(sqlite.prepare("SELECT count(*) FROM audit_events").pluck().get()).toBe(0);

    await expect(
      repository.recordEvent({
        eventType: "discovery.security_stopped",
        runId: "3b57ce65-85fb-4265-9296-b55043c17891",
        occurredAt: fixedNow().toISOString(),
        metadata: {
          code: "AUTH_REQUIRED",
          diagnosticCode: "AUTH_WALL",
          sourceReference: "https://user:password@example.test/path?token=private",
        },
      }),
    ).rejects.toThrow();
  });

  it("rolls back job writes when checkpoint validation fails", async () => {
    const record = seekFixtureCases[0].record;
    await expect(
      repository.commitPage(
        [{ record, job: normalizeSeekJob(record) }],
        checkpoint({ queryHash: "invalid" }) as SeekCheckpoint,
      ),
    ).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) FROM audit_events").pluck().get()).toBe(0);
  });

  it("rejects a concurrent checkpoint owner without duplicating a job", async () => {
    const record = seekFixtureCases[0].record;
    const job = normalizeSeekJob(record);
    await repository.commitPage([{ record, job }], checkpoint());
    await expect(
      repository.commitPage(
        [{ record, job }],
        checkpoint({ runId: "5fe72dc6-6ba0-4e28-a113-4053d9f6f5f7" }),
      ),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_MISMATCH",
      diagnosticCode: "SEEK_CONCURRENT_CHECKPOINT_CONFLICT",
    });
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_source_records").pluck().get()).toBe(1);
  });
});
