import { randomUUID } from "node:crypto";

import type {
  AdapterCapability,
  DiscoveryPage,
  DiscoveryQuery,
  DiscoveredJobRecord,
  JobSourceAdapter,
} from "../index";
import { SeekAdapterError } from "./errors";
import {
  parseUserSuppliedSeekContent,
  SeekFixtureClient,
  type UserSuppliedSeekContentContext,
} from "./fixture-client";
import { normalizeSeekJob } from "./normalizer";
import { canonicalizeSeekQuery, hashPayload, hashSeekQuery, validateSeekCheckpoint } from "./query";
import type { SeekCheckpoint, SeekRawJobRecord } from "./schemas";
import type {
  SeekAccessMode,
  SeekAuditEvent,
  SeekCapabilityStatus,
  SeekPersistenceItem,
  SeekPersistenceOutcome,
  SeekRunCounts,
} from "./types";

const CAPABILITY_STATUS: Record<SeekAccessMode, SeekCapabilityStatus> = {
  FIXTURE_ONLY: {
    mode: "FIXTURE_ONLY",
    state: "AVAILABLE",
    capabilities: ["DISCOVERY", "JOB_DETAILS"],
    networkAccess: false,
    reason: "Synthetic local fixtures are enabled for deterministic development and tests.",
  },
  USER_SUPPLIED_CONTENT: {
    mode: "USER_SUPPLIED_CONTENT",
    state: "AVAILABLE",
    capabilities: ["JOB_DETAILS"],
    networkAccess: false,
    reason: "Explicitly supplied content can be parsed locally without retrieving a URL.",
  },
  PUBLIC_DISCOVERY: {
    mode: "PUBLIC_DISCOVERY",
    state: "DISABLED",
    capabilities: [],
    networkAccess: false,
    reason: "No approved public discovery interface was established by the Phase 2 research gate.",
  },
  PUBLIC_JOB_DETAILS: {
    mode: "PUBLIC_JOB_DETAILS",
    state: "DISABLED",
    capabilities: [],
    networkAccess: false,
    reason:
      "No approved public job-details interface was established by the Phase 2 research gate.",
  },
  ASSISTED_BROWSER: {
    mode: "ASSISTED_BROWSER",
    state: "DISABLED",
    capabilities: [],
    networkAccess: false,
    reason: "Automated browser retrieval is outside the approved SEEK Phase 2 scope.",
  },
  USER_SUPPLIED_URL: {
    mode: "USER_SUPPLIED_URL",
    state: "DISABLED",
    capabilities: [],
    networkAccess: false,
    reason: "A URL alone cannot be fetched; the user must explicitly provide its content.",
  },
};

export interface SeekAdapterOptions {
  mode?: SeekAccessMode;
  fixtureClient?: SeekFixtureClient;
}

export class SeekAdapter implements JobSourceAdapter {
  readonly sourceName = "SEEK" as const;
  readonly mode: SeekAccessMode;
  private readonly fixtureClient: SeekFixtureClient;

  constructor(options: SeekAdapterOptions = {}) {
    this.mode = options.mode ?? "FIXTURE_ONLY";
    this.fixtureClient = options.fixtureClient ?? new SeekFixtureClient([]);
  }

  capabilityStatus(): SeekCapabilityStatus {
    return {
      ...CAPABILITY_STATUS[this.mode],
      capabilities: [...CAPABILITY_STATUS[this.mode].capabilities],
    };
  }

  capabilities(): readonly AdapterCapability[] {
    return this.capabilityStatus().capabilities;
  }

  async discoverJobs(query: DiscoveryQuery): Promise<DiscoveryPage> {
    if (this.mode !== "FIXTURE_ONLY") {
      throw new SeekAdapterError("ACCESS_DENIED", {
        message: `${this.mode} discovery is disabled by the Phase 2 access decision`,
      });
    }
    return this.fixtureClient.discover(query);
  }

  async fetchJob(externalId: string): Promise<DiscoveredJobRecord> {
    if (this.mode !== "FIXTURE_ONLY") {
      throw new SeekAdapterError("ACCESS_DENIED", {
        message: `${this.mode} job retrieval is disabled by the Phase 2 access decision`,
      });
    }
    return this.fixtureClient.fetch(externalId);
  }

  async normalizeJob(record: DiscoveredJobRecord) {
    if (this.mode !== "FIXTURE_ONLY" && this.mode !== "USER_SUPPLIED_CONTENT") {
      throw new SeekAdapterError("ACCESS_DENIED", {
        message: `${this.mode} normalization is disabled by the Phase 2 access decision`,
      });
    }
    return normalizeSeekJob(record.raw);
  }

  ingestUserSuppliedContent(
    content: string | Record<string, unknown>,
    context: UserSuppliedSeekContentContext,
  ): DiscoveredJobRecord {
    if (this.mode !== "USER_SUPPLIED_CONTENT") {
      throw new SeekAdapterError("ACCESS_DENIED", {
        message: "User-supplied content requires USER_SUPPLIED_CONTENT mode",
      });
    }
    const record = parseUserSuppliedSeekContent(content, context);
    return {
      externalId: record.externalId,
      sourceUrl: record.canonicalUrl,
      raw: record,
      discoveredAt: record.discoveredAt,
    };
  }
}

export interface SeekCommitResult {
  outcome: SeekPersistenceOutcome;
  checkpoint: SeekCheckpoint;
}

export interface SeekDiscoveryPersistence {
  loadCheckpoint(queryHash: string, mode: SeekAccessMode): Promise<unknown | null>;
  commitPage(
    items: Array<SeekPersistenceItem<SeekRawJobRecord>>,
    checkpoint: SeekCheckpoint,
  ): Promise<SeekCommitResult>;
  recordEvent(event: SeekAuditEvent): Promise<void>;
}

export interface SeekDiscoveryRunOptions {
  adapter: SeekAdapter;
  persistence: SeekDiscoveryPersistence;
  query: DiscoveryQuery;
  maxPages?: number;
  maxJobs?: number;
  checkpointTtlMs?: number;
  now?: () => Date;
  runId?: string;
}

export interface SeekDiscoveryRunResult {
  runId: string;
  status: "COMPLETE" | "PARTIAL";
  reason: "SOURCE_EXHAUSTED" | "MAX_PAGES" | "MAX_JOBS" | "DUPLICATE_PAGE";
  counts: SeekRunCounts;
  checkpoint: SeekCheckpoint;
}

function zeroCounts(): SeekRunCounts {
  return { discovered: 0, added: 0, updated: 0, duplicates: 0, failed: 0 };
}

export async function runSeekDiscovery(
  options: SeekDiscoveryRunOptions,
): Promise<SeekDiscoveryRunResult> {
  if (options.adapter.mode !== "FIXTURE_ONLY") {
    throw new SeekAdapterError("ACCESS_DENIED", {
      message: "Phase 2 discovery runner is enabled only for fixture mode",
    });
  }
  const now = options.now ?? (() => new Date());
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 100);
  const maxJobs = Math.min(Math.max(options.maxJobs ?? 200, 1), 10_000);
  const checkpointTtlMs = Math.min(
    Math.max(options.checkpointTtlMs ?? 86_400_000, 60_000),
    604_800_000,
  );
  const query = canonicalizeSeekQuery(options.query);
  const queryHash = hashSeekQuery(query);
  const runStartedAt = now();
  const loaded = await options.persistence.loadCheckpoint(queryHash, options.adapter.mode);
  const checkpoint = loaded
    ? validateSeekCheckpoint(loaded, { queryHash, mode: options.adapter.mode, now: now() })
    : null;
  const runId = checkpoint?.runId ?? options.runId ?? randomUUID();
  let counts = checkpoint?.counts ?? zeroCounts();
  let cursor = checkpoint?.nextCursor ?? query.pageCursor ?? null;
  let lastCommittedPage = checkpoint?.lastCommittedPage ?? 0;
  const processedPageHashes = new Set(checkpoint?.processedPageHashes ?? []);
  let finalCheckpoint =
    checkpoint ??
    ({
      schemaVersion: 1,
      runId,
      source: "SEEK",
      mode: options.adapter.mode,
      queryHash,
      nextCursor: cursor,
      lastSuccessfulFetchAt: now().toISOString(),
      lastCommittedPage,
      processedPageHashes: [],
      counts,
      expiresAt: new Date(now().getTime() + checkpointTtlMs).toISOString(),
    } satisfies SeekCheckpoint);
  await options.persistence.recordEvent({
    eventType: "discovery.run.started",
    runId,
    occurredAt: runStartedAt.toISOString(),
    metadata: { mode: options.adapter.mode, resumed: Boolean(checkpoint), queryHash },
  });
  if (checkpoint && checkpoint.nextCursor === null) {
    await options.persistence.recordEvent({
      eventType: "discovery.run.completed",
      runId,
      occurredAt: now().toISOString(),
      metadata: {
        reason: "SOURCE_EXHAUSTED",
        resumed: true,
        durationMs: Math.max(0, now().getTime() - runStartedAt.getTime()),
        ...counts,
      },
    });
    return {
      runId,
      status: "COMPLETE",
      reason: "SOURCE_EXHAUSTED",
      counts,
      checkpoint,
    };
  }

  let reason: SeekDiscoveryRunResult["reason"] = "SOURCE_EXHAUSTED";
  let status: SeekDiscoveryRunResult["status"] = "COMPLETE";
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const pageStartedAt = now();
    const remainingJobs = maxJobs - counts.discovered;
    if (remainingJobs <= 0) {
      reason = "MAX_JOBS";
      status = "PARTIAL";
      break;
    }
    let page: DiscoveryPage;
    try {
      page = await options.adapter.discoverJobs({
        ...query,
        pageCursor: cursor ?? undefined,
        pageSize: Math.min(query.pageSize, remainingJobs),
      });
    } catch (error) {
      const adapterError =
        error instanceof SeekAdapterError
          ? error
          : new SeekAdapterError("NETWORK_ERROR", { cause: error });
      if (adapterError.code === "RATE_LIMITED") {
        await options.persistence.recordEvent({
          eventType: "discovery.rate_limited",
          runId,
          occurredAt: now().toISOString(),
          metadata: {
            code: adapterError.code,
            safeRetryAfter: adapterError.safeRetryAfter,
          },
        });
      }
      if (
        [
          "AUTH_REQUIRED",
          "CAPTCHA_DETECTED",
          "BOT_PROTECTION",
          "ACCESS_DENIED",
          "PAGE_CHANGED",
        ].includes(adapterError.code)
      ) {
        await options.persistence.recordEvent({
          eventType: "discovery.security_stopped",
          runId,
          occurredAt: now().toISOString(),
          metadata: {
            code: adapterError.code,
            diagnosticCode: adapterError.diagnosticCode,
            sourceReference: adapterError.sourceReference,
          },
        });
      }
      await options.persistence.recordEvent({
        eventType: "discovery.run.partial",
        runId,
        occurredAt: now().toISOString(),
        metadata: {
          reason: adapterError.code,
          retryable: adapterError.retryable,
          durationMs: Math.max(0, now().getTime() - runStartedAt.getTime()),
        },
      });
      throw adapterError;
    }
    const rawRecords = page.records.map((record) => record.raw as SeekRawJobRecord);
    const pageHash = hashPayload(
      rawRecords.map((record) => [record.externalId, record.canonicalUrl, record.rawPayloadHash]),
    );
    if (processedPageHashes.has(pageHash)) {
      await options.persistence.recordEvent({
        eventType: "discovery.run.partial",
        runId,
        occurredAt: now().toISOString(),
        metadata: { reason: "DUPLICATE_PAGE", pageHash },
      });
      reason = "DUPLICATE_PAGE";
      status = "PARTIAL";
      break;
    }
    processedPageHashes.add(pageHash);
    const items: Array<SeekPersistenceItem<SeekRawJobRecord>> = [];
    let pageFailures = 0;
    for (const discovered of page.records) {
      try {
        items.push({
          record: discovered.raw as SeekRawJobRecord,
          job: await options.adapter.normalizeJob(discovered),
        });
      } catch (error) {
        pageFailures += 1;
        const adapterError =
          error instanceof SeekAdapterError
            ? error
            : new SeekAdapterError("MALFORMED_RESPONSE", { cause: error });
        await options.persistence.recordEvent({
          eventType: "discovery.job.failed",
          runId,
          occurredAt: now().toISOString(),
          metadata: {
            externalId: discovered.externalId,
            code: adapterError.code,
            diagnosticCode: adapterError.diagnosticCode,
          },
        });
      }
    }
    counts = {
      ...counts,
      discovered: counts.discovered + page.records.length,
      failed: counts.failed + pageFailures,
    };
    lastCommittedPage += 1;
    const proposedCheckpoint: SeekCheckpoint = {
      schemaVersion: 1,
      runId,
      source: "SEEK",
      mode: options.adapter.mode,
      queryHash,
      nextCursor: page.nextCursor ?? null,
      lastSuccessfulFetchAt: now().toISOString(),
      lastCommittedPage,
      processedPageHashes: [...processedPageHashes].slice(-100),
      counts,
      expiresAt: new Date(now().getTime() + checkpointTtlMs).toISOString(),
    };
    const committed = await options.persistence.commitPage(items, proposedCheckpoint);
    finalCheckpoint = committed.checkpoint;
    counts = committed.checkpoint.counts;
    await options.persistence.recordEvent({
      eventType: "discovery.page.completed",
      runId,
      occurredAt: now().toISOString(),
      metadata: {
        page: lastCommittedPage,
        discovered: page.records.length,
        failed: pageFailures,
        pageHash,
        durationMs: Math.max(0, now().getTime() - pageStartedAt.getTime()),
      },
    });
    cursor = page.nextCursor ?? null;
    if (!cursor) {
      reason = "SOURCE_EXHAUSTED";
      break;
    }
    if (counts.discovered >= maxJobs) {
      reason = "MAX_JOBS";
      status = "PARTIAL";
      break;
    }
    if (pageIndex === maxPages - 1) {
      reason = "MAX_PAGES";
      status = "PARTIAL";
    }
  }
  await options.persistence.recordEvent({
    eventType: status === "COMPLETE" ? "discovery.run.completed" : "discovery.run.partial",
    runId,
    occurredAt: now().toISOString(),
    metadata: {
      reason,
      durationMs: Math.max(0, now().getTime() - runStartedAt.getTime()),
      ...counts,
    },
  });
  return { runId, status, reason, counts, checkpoint: finalCheckpoint };
}
