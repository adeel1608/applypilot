import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seekFixtureEntries } from "../../fixtures/seek/manifest";
import { JobDiscoveryRepository } from "@applypilot/database";
import { evaluateEligibility } from "@applypilot/eligibility-engine";
import { scoreJobFit } from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import { runSeekDiscovery, SeekAdapter, SeekFixtureClient } from "@applypilot/job-sources";
import { testProfile } from "../fixture-data";

const migration = ["0000_applypilot_foundation.sql", "0001_real_world_job_intake.sql"]
  .map((file) =>
    readFileSync(new URL(`../../packages/database/drizzle/${file}`, import.meta.url), "utf8"),
  )
  .join("\n");
const fixedNow = () => new Date("2026-09-05T12:00:00.000Z");

describe("SEEK fixture discovery pipeline", () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it("resumes from an atomic checkpoint and persists normalized jobs idempotently", async () => {
    const persistence = new JobDiscoveryRepository(sqlite, fixedNow);
    const adapter = new SeekAdapter({
      fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
    });
    const query = { keywords: [], locations: [], pageSize: 5 };
    const partial = await runSeekDiscovery({
      adapter,
      persistence,
      query,
      maxPages: 1,
      now: fixedNow,
    });
    expect(partial).toMatchObject({ status: "PARTIAL", reason: "MAX_PAGES" });
    expect(partial.checkpoint.nextCursor).not.toBeNull();

    const completed = await runSeekDiscovery({ adapter, persistence, query, now: fixedNow });
    expect(completed).toMatchObject({
      status: "COMPLETE",
      reason: "SOURCE_EXHAUSTED",
      counts: { discovered: 14, added: 11, updated: 0, duplicates: 1, failed: 2 },
    });
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(11);
    expect(sqlite.prepare("SELECT COUNT(*) FROM job_source_records").pluck().get()).toBe(11);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) FROM audit_events WHERE event_type = 'discovery.job.failed'")
        .pluck()
        .get(),
    ).toBe(2);

    const resumedCompleted = await runSeekDiscovery({
      adapter,
      persistence,
      query,
      now: fixedNow,
    });
    expect(resumedCompleted.counts).toEqual(completed.counts);
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(11);

    const normalizedJobs = sqlite
      .prepare("SELECT normalized_json AS normalizedJson FROM jobs")
      .all()
      .map((row) =>
        JobSchema.parse(JSON.parse((row as { normalizedJson: string }).normalizedJson)),
      );
    const evaluated = normalizedJobs.map((job) => {
      const eligibility = evaluateEligibility(job, testProfile);
      return { eligibility, fit: scoreJobFit(job, testProfile, eligibility) };
    });
    expect(evaluated).toHaveLength(11);
    expect(evaluated.every(({ fit }) => fit.score >= 0 && fit.score <= 100)).toBe(true);
  });

  it("recognizes unchanged records reached through a distinct query", async () => {
    const persistence = new JobDiscoveryRepository(sqlite, fixedNow);
    const adapter = new SeekAdapter({
      fixtureClient: new SeekFixtureClient(seekFixtureEntries, fixedNow),
    });
    await runSeekDiscovery({
      adapter,
      persistence,
      query: { keywords: ["Retail"], locations: [], pageSize: 10 },
      now: fixedNow,
    });
    const second = await runSeekDiscovery({
      adapter,
      persistence,
      query: { keywords: ["Retail Assistant"], locations: [], pageSize: 10 },
      now: fixedNow,
    });
    expect(second.counts).toMatchObject({ added: 0, updated: 0, duplicates: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) FROM jobs").pluck().get()).toBe(1);
  });
});
