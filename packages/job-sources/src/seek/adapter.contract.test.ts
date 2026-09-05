import { describe, expect, it, vi } from "vitest";

import { seekFixtureEntries } from "../../../../fixtures/seek/manifest";
import {
  classifySeekAccessSignal,
  executeWithSeekRetry,
  runSeekDiscovery,
  SeekAdapter,
  SeekAdapterError,
  SeekFixtureClient,
  SEEK_ERROR_CODES,
  type SeekAuditEvent,
  type SeekCheckpoint,
  type SeekCommitResult,
  type SeekDiscoveryPersistence,
  type SeekPersistenceItem,
  type SeekRawJobRecord,
} from "./index";

class MemoryPersistence implements SeekDiscoveryPersistence {
  checkpoint: SeekCheckpoint | null = null;
  events: SeekAuditEvent[] = [];

  async loadCheckpoint(): Promise<unknown | null> {
    return this.checkpoint;
  }

  async commitPage(
    items: Array<SeekPersistenceItem<SeekRawJobRecord>>,
    checkpoint: SeekCheckpoint,
  ): Promise<SeekCommitResult> {
    const outcome = { added: items.length, updated: 0, duplicates: 0 };
    this.checkpoint = {
      ...checkpoint,
      counts: { ...checkpoint.counts, added: checkpoint.counts.added + items.length },
    };
    return { outcome, checkpoint: this.checkpoint };
  }

  async recordEvent(event: SeekAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

describe("SEEK adapter contract", () => {
  const fixedNow = () => new Date("2026-09-05T12:00:00.000Z");

  it("advertises only capabilities allowed by the selected access mode", () => {
    expect(new SeekAdapter().capabilityStatus()).toMatchObject({
      mode: "FIXTURE_ONLY",
      state: "AVAILABLE",
      networkAccess: false,
      capabilities: ["DISCOVERY", "JOB_DETAILS"],
    });
    expect(new SeekAdapter({ mode: "PUBLIC_DISCOVERY" }).capabilities()).toEqual([]);
  });

  it("fails closed for every non-approved live discovery mode", async () => {
    for (const mode of [
      "PUBLIC_DISCOVERY",
      "PUBLIC_JOB_DETAILS",
      "ASSISTED_BROWSER",
      "USER_SUPPLIED_URL",
      "USER_SUPPLIED_CONTENT",
    ] as const) {
      await expect(
        new SeekAdapter({ mode }).discoverJobs({ keywords: [], locations: [] }),
      ).rejects.toMatchObject({ code: "ACCESS_DENIED", humanActionRequired: true });
    }
  });

  it("filters, sorts, radius-checks, and paginates fixture records", async () => {
    const adapter = new SeekAdapter({
      fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
    });
    const query = {
      keywords: [],
      locations: [],
      location: { postcode: "3072" as const, radiusKm: 5 },
      employmentTypes: ["CASUAL" as const],
      sortOrder: "DATE_POSTED" as const,
      pageSize: 1,
    };
    const first = await adapter.discoverJobs(query);
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const second = await adapter.discoverJobs({ ...query, pageCursor: first.nextCursor });
    expect(second.records).toHaveLength(1);
    expect(second.records[0].externalId).toBe(first.records[0].externalId);
    await expect(
      adapter.discoverJobs({ keywords: ["no-such-fixture"], locations: [] }),
    ).resolves.toEqual({ records: [], nextCursor: undefined });
  });

  it("runs bounded pages, checkpoints progress, counts failures, and resumes completed runs", async () => {
    const persistence = new MemoryPersistence();
    const adapter = new SeekAdapter({
      fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
    });
    const first = await runSeekDiscovery({
      adapter,
      persistence,
      query: { keywords: [], locations: [], pageSize: 5 },
      now: fixedNow,
      maxPages: 10,
    });
    expect(first).toMatchObject({
      status: "COMPLETE",
      reason: "SOURCE_EXHAUSTED",
      counts: { discovered: 14, added: 12, failed: 2 },
    });
    expect(first.checkpoint.lastCommittedPage).toBe(3);
    const resumed = await runSeekDiscovery({
      adapter,
      persistence,
      query: { keywords: [], locations: [], pageSize: 5 },
      now: fixedNow,
    });
    expect(resumed.counts).toEqual(first.counts);
    expect(persistence.events.some(({ eventType }) => eventType === "discovery.job.failed")).toBe(
      true,
    );
  });

  it("stops at configured page bounds with a resumable partial checkpoint", async () => {
    const persistence = new MemoryPersistence();
    const result = await runSeekDiscovery({
      adapter: new SeekAdapter({
        fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
      }),
      persistence,
      query: { keywords: [], locations: [], pageSize: 2 },
      maxPages: 1,
      now: fixedNow,
    });
    expect(result).toMatchObject({ status: "PARTIAL", reason: "MAX_PAGES" });
    expect(result.checkpoint.nextCursor).not.toBeNull();
  });

  it("stops at the configured job bound without over-fetching", async () => {
    const result = await runSeekDiscovery({
      adapter: new SeekAdapter({
        fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
      }),
      persistence: new MemoryPersistence(),
      query: { keywords: [], locations: [], pageSize: 10 },
      maxJobs: 3,
      now: fixedNow,
    });
    expect(result).toMatchObject({
      status: "PARTIAL",
      reason: "MAX_JOBS",
      counts: { discovered: 3, added: 3 },
    });
  });

  it("stops safely when a source repeats an identical page", async () => {
    const record = seekFixtureEntries[0].record;
    class RepeatingFixtureClient extends SeekFixtureClient {
      override async discover() {
        return {
          records: [
            {
              externalId: record.externalId,
              sourceUrl: record.canonicalUrl,
              raw: record,
              discoveredAt: record.discoveredAt,
            },
          ],
          nextCursor: "repeat",
        };
      }
    }
    const persistence = new MemoryPersistence();
    const result = await runSeekDiscovery({
      adapter: new SeekAdapter({ fixtureClient: new RepeatingFixtureClient([]) }),
      persistence,
      query: { keywords: [], locations: [], pageSize: 1 },
      now: fixedNow,
    });
    expect(result).toMatchObject({
      status: "PARTIAL",
      reason: "DUPLICATE_PAGE",
      counts: { discovered: 1, added: 1 },
    });
  });

  it("classifies access signals and bounds retries without bypassing security stops", async () => {
    for (const code of SEEK_ERROR_CODES) {
      const error = new SeekAdapterError(code, {
        sourceUrl: "https://seek.example.test/job/1?token=redacted#fragment",
      });
      expect(error.diagnosticCode).toBe(`SEEK_${code}`);
      expect(typeof error.retryable).toBe("boolean");
      expect(typeof error.humanActionRequired).toBe("boolean");
      expect(error.safeRetryAfter).toBeNull();
      expect(error.sourceUrl).toBe("https://seek.example.test/job/1");
    }
    expect(
      classifySeekAccessSignal({ status: 429, retryAfter: "60", now: fixedNow() }),
    ).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      safeRetryAfter: "2026-09-05T12:01:00.000Z",
    });
    expect(classifySeekAccessSignal({ status: 200, marker: "CAPTCHA" })).toMatchObject({
      code: "CAPTCHA_DETECTED",
      retryable: false,
      humanActionRequired: true,
    });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new SeekAdapterError("NETWORK_ERROR"))
      .mockResolvedValue("ok");
    expect(await executeWithSeekRetry(operation, { wait: async () => undefined })).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    const captcha = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new SeekAdapterError("CAPTCHA_DETECTED"));
    await expect(executeWithSeekRetry(captcha)).rejects.toMatchObject({
      code: "CAPTCHA_DETECTED",
    });
    expect(captcha).toHaveBeenCalledTimes(1);
    const rateLimited = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new SeekAdapterError("RATE_LIMITED", { safeRetryAfter: "2099-01-01T00:00:00.000Z" }),
      )
      .mockResolvedValue("too-early");
    await expect(executeWithSeekRetry(rateLimited)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(rateLimited).toHaveBeenCalledTimes(1);
  });

  it("emits a security stop and never retries a CAPTCHA", async () => {
    class BlockedFixtureClient extends SeekFixtureClient {
      override async discover(): Promise<never> {
        throw new SeekAdapterError("CAPTCHA_DETECTED");
      }
    }
    const persistence = new MemoryPersistence();
    await expect(
      runSeekDiscovery({
        adapter: new SeekAdapter({ fixtureClient: new BlockedFixtureClient([]) }),
        persistence,
        query: { keywords: [], locations: [] },
        now: fixedNow,
      }),
    ).rejects.toMatchObject({ code: "CAPTCHA_DETECTED" });
    expect(persistence.events.map(({ eventType }) => eventType)).toContain(
      "discovery.security_stopped",
    );
  });

  it("does not issue network requests in fixture or user-supplied-content modes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const fixtureAdapter = new SeekAdapter({
        fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
      });
      await fixtureAdapter.discoverJobs({ keywords: ["Retail"], locations: [] });
      const contentAdapter = new SeekAdapter({ mode: "USER_SUPPLIED_CONTENT" });
      contentAdapter.ingestUserSuppliedContent(JSON.stringify(seekFixtureEntries[0].record), {
        sourceUrl: seekFixtureEntries[0].record.canonicalUrl,
        discoveredAt: fixedNow().toISOString(),
        fetchedAt: fixedNow().toISOString(),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
