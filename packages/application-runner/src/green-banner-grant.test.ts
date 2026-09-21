import { describe, expect, it } from "vitest";

import {
  assertGreenBannerChildDigest,
  assertGreenBannerChildWithinParent,
  createGreenBannerParentGrant,
  deriveGreenBannerChildCapability,
  greenBannerChildCapabilityDigest,
  type GreenBannerChildInput,
} from "./green-banner-grant";

const mainSha = "a".repeat(40);
const now = new Date("2026-09-22T00:00:00.000Z");
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
    sourceProviders: ["LEVER", "GREENHOUSE"],
    sourceHosts: ["api.lever.co", "api.eu.lever.co", "boards-api.greenhouse.io"],
    targetOrigins: ["https://jobs.lever.co"],
    maxChildTtlMs: 60 * 60 * 1000,
  },
  mainSha,
  createdAt: now.toISOString(),
});

function sourceChild(overrides: Partial<GreenBannerChildInput> = {}): GreenBannerChildInput {
  return {
    schemaVersion: 1,
    childId: "source_child_123456",
    childType: "SOURCE" as const,
    operation: "SOURCE_LIST_JOBS" as const,
    provider: "LEVER" as const,
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
    mainSha,
    createdAt: now.toISOString(),
    expiresAt: "2026-09-22T00:30:00.000Z",
    ...overrides,
  };
}

describe("GREEN_BANNER_SESSION_GRANT_V1", () => {
  it("derives a deterministic bounded source child and validates its digest", () => {
    const child = deriveGreenBannerChildCapability({ parent, child: sourceChild(), now });
    expect(child.parentGrantDigest).toBe(parent.grantDigest);
    expect(child.childDigest).toBe(greenBannerChildCapabilityDigest(child));
    expect(() => assertGreenBannerChildDigest(child)).not.toThrow();
  });

  it.each([
    ["submit", { operation: "SUBMIT" }],
    ["main mismatch", { mainSha: "b".repeat(40) }],
    ["provider outside parent", { provider: "LEVER", allowedHost: "boards-api.greenhouse.io" }],
    ["host outside parent", { allowedHost: "evil.example.test" }],
    ["expired child", { expiresAt: "2026-09-21T23:59:00.000Z" }],
    ["long child", { expiresAt: "2026-09-22T02:00:01.000Z" }],
  ] as Array<[string, Partial<GreenBannerChildInput>]>)("rejects %s", (_label, overrides) => {
    expect(() =>
      deriveGreenBannerChildCapability({ parent, child: sourceChild(overrides), now }),
    ).toThrow();
  });

  it("rejects a target child that leaves the parent origin ceiling", () => {
    const child = sourceChild({
      childId: "target_child_123456",
      childType: "TARGET",
      operation: "OPEN_AND_INSPECT_ONLY",
      provider: null,
      tenant: null,
      allowedHost: null,
      allowedPathPrefix: null,
      targetOrigin: "https://evil.example.test",
      targetPath: "/apply",
      packetDigest: "c".repeat(64),
      adapterVersion: "adapter-v1",
      formVersion: "form-v1",
    });
    expect(() => assertGreenBannerChildWithinParent(parent, child, now)).toThrow(
      "CHILD_TARGET_ORIGIN_ESCALATION",
    );
  });
});
