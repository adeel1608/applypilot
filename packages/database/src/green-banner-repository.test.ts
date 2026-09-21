import { readFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createGreenBannerParentGrant,
  deriveGreenBannerChildCapability,
  type GreenBannerChildInput,
} from "@applypilot/application-runner";

import { GreenBannerGrantRepository } from "./green-banner-repository";

const databases: BetterSqlite3.Database[] = [];
const now = new Date("2026-09-22T00:00:00.000Z");

function migratedDatabase(): BetterSqlite3.Database {
  const database = new BetterSqlite3(":memory:");
  databases.push(database);
  for (const name of [
    "0000_applypilot_foundation.sql",
    "0001_real_world_job_intake.sql",
    "0002_personal_live_beta_core.sql",
    "0003_r2a_evidence_normalization.sql",
    "0004_r2_matching_quality.sql",
    "0005_r2_matching_quality_hardening.sql",
    "0006_r2_calibration_qualification.sql",
    "0007_personal_live_v1_enablement.sql",
    "0008_real_target_inspection_scope.sql",
    "0009_green_banner_session_grant.sql",
  ]) {
    database.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  return database;
}

const parent = createGreenBannerParentGrant({
  schemaVersion: 1,
  grantId: "GREEN_BANNER_SESSION_GRANT_V1",
  grantType: "GREEN_BANNER_SESSION_GRANT_V1",
  allowedOperations: [
    "SOURCE_LIST_JOBS",
    "OPEN_AND_INSPECT_ONLY",
    "MAP_FOR_FILL",
    "FILL",
    "UPLOAD",
    "VERIFY",
    "FILL_PREVIEW",
  ],
  scope: {
    sourceProviders: ["LEVER"],
    sourceHosts: ["api.lever.co"],
    targetOrigins: ["https://jobs.lever.co"],
    maxChildTtlMs: 60 * 60 * 1000,
  },
  mainSha: "a".repeat(40),
  createdAt: now.toISOString(),
});

const childInput: GreenBannerChildInput = {
  schemaVersion: 1,
  childId: "source_child_123456",
  childType: "SOURCE",
  operation: "SOURCE_LIST_JOBS",
  provider: "LEVER",
  tenant: "fictional",
  allowedHost: "api.lever.co",
  allowedPathPrefix: "/v0/postings/fictional",
  targetOrigin: null,
  targetPath: null,
  packetDigest: null,
  adapterVersion: "lever-v2",
  formVersion: null,
  documentDigest: null,
  answersDigest: null,
  disclosuresDigest: null,
  mainSha: "a".repeat(40),
  createdAt: now.toISOString(),
  expiresAt: "2026-09-22T00:30:00.000Z",
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("green-banner grant persistence", () => {
  it("persists immutable parent/child lineage and terminal child state", () => {
    const database = migratedDatabase();
    const repository = new GreenBannerGrantRepository(
      database,
      () => now,
      () => randomId(),
    );
    expect(repository.persistParentGrant(parent)).toEqual({
      id: parent.grantId,
      created: true,
    });
    expect(repository.persistParentGrant(parent).created).toBe(false);
    const child = deriveGreenBannerChildCapability({ parent, child: childInput, now });
    expect(repository.persistChildCapability(child).created).toBe(true);
    expect(repository.persistChildCapability(child).created).toBe(false);
    expect(repository.latestChildState(child.childId)).toBe("ACTIVE");
    repository.transitionChild(child.childId, "CONSUMED");
    expect(repository.latestChildState(child.childId)).toBe("CONSUMED");
    expect(() => repository.transitionChild(child.childId, "REVOKED")).toThrow(
      "CHILD_CAPABILITY_TERMINAL",
    );
    expect(repository.latestParentState()).toBe("ACTIVE");
  });

  it("does not allow child creation after parent revocation", () => {
    const database = migratedDatabase();
    const repository = new GreenBannerGrantRepository(
      database,
      () => now,
      () => randomId(),
    );
    repository.persistParentGrant(parent);
    repository.transitionParent("REVOKED");
    const child = deriveGreenBannerChildCapability({ parent, child: childInput, now });
    expect(() => repository.persistChildCapability(child)).toThrow("PARENT_GRANT_NOT_ACTIVE");
  });
});

let counter = 0;
function randomId(): string {
  counter += 1;
  return `event-id-${counter}`;
}
