import { describe, expect, it } from "vitest";

import {
  PROPOSED_LOCAL_VERIFICATION_POLICY,
  assessVerificationFreshness,
  type VerificationFreshnessPolicy,
} from "./freshness";

const t0 = new Date("2026-09-22T00:00:00.000Z");

describe("verification freshness policy", () => {
  it("keeps local verification freshness separate from provider expiry", () => {
    const result = assessVerificationFreshness({
      verifiedAt: t0.toISOString(),
      evidenceQualified: true,
      providerExpiresAt: null,
      operation: "PREPARATION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: new Date(t0.getTime() + 23 * 60 * 60 * 1000),
    });
    expect(result).toMatchObject({ state: "FRESH", providerExpiry: "UNKNOWN" });
    expect(result.validUntil).toBe("2026-09-23T00:00:00.000Z");
  });

  it("uses the shorter pre-external-action window", () => {
    const result = assessVerificationFreshness({
      verifiedAt: t0.toISOString(),
      evidenceQualified: true,
      providerExpiresAt: "2026-09-23T00:00:00.000Z",
      operation: "PRE_EXTERNAL_ACTION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: new Date(t0.getTime() + 16 * 60 * 1000),
    });
    expect(result.state).toBe("STALE");
    expect(result.reasonCode).toBe("VERIFICATION_STALE");
    expect(result.providerExpiry).toBe("KNOWN");
  });

  it.each([
    [
      "missing evidence",
      { verifiedAt: null, evidenceQualified: true, providerExpiresAt: null },
      "VERIFICATION_NOT_QUALIFIED",
    ],
    [
      "future evidence",
      {
        verifiedAt: "2026-09-22T01:00:00.000Z",
        evidenceQualified: true,
        providerExpiresAt: null,
      },
      "VERIFICATION_FUTURE_TIMESTAMP",
    ],
    [
      "unqualified evidence",
      { verifiedAt: t0.toISOString(), evidenceQualified: false, providerExpiresAt: null },
      "VERIFICATION_NOT_QUALIFIED",
    ],
    [
      "provider closed",
      {
        verifiedAt: t0.toISOString(),
        evidenceQualified: true,
        providerExpiresAt: "2026-09-21T23:00:00.000Z",
      },
      "PROVIDER_EXPIRED",
    ],
  ])("fails closed for %s", (_label, input, reason) => {
    const result = assessVerificationFreshness({
      ...input,
      providerExpiresAt: input.providerExpiresAt ?? null,
      operation: "PREPARATION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: t0,
    });
    expect(result.state).toBe(reason === "PROVIDER_EXPIRED" ? "BLOCKED" : "UNKNOWN");
    expect(result.reasonCode).toBe(reason);
  });

  it("rejects unsafe policy values and never lets replay extend validity", () => {
    expect(() =>
      assessVerificationFreshness({
        verifiedAt: t0.toISOString(),
        evidenceQualified: true,
        providerExpiresAt: null,
        operation: "PREPARATION",
        policy: {
          ...PROPOSED_LOCAL_VERIFICATION_POLICY,
          preparationMaxAgeMs: Infinity,
        } as VerificationFreshnessPolicy,
        now: t0,
      }),
    ).toThrow("FRESHNESS_POLICY_INVALID");
    const first = assessVerificationFreshness({
      verifiedAt: t0.toISOString(),
      evidenceQualified: true,
      providerExpiresAt: null,
      operation: "PREPARATION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: t0,
    });
    const replay = assessVerificationFreshness({
      verifiedAt: t0.toISOString(),
      evidenceQualified: true,
      providerExpiresAt: null,
      operation: "PREPARATION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: new Date(t0.getTime() + 24 * 60 * 60 * 1000 + 1),
    });
    expect(first.validUntil).toBe("2026-09-23T00:00:00.000Z");
    expect(replay.state).toBe("STALE");
  });

  it("requires explicit policy and caps validity at known provider expiry", () => {
    expect(() =>
      assessVerificationFreshness({
        verifiedAt: t0.toISOString(),
        evidenceQualified: true,
        providerExpiresAt: null,
        operation: "PREPARATION",
      } as never),
    ).toThrow("FRESHNESS_POLICY_REQUIRED");
    const result = assessVerificationFreshness({
      verifiedAt: t0.toISOString(),
      evidenceQualified: true,
      providerExpiresAt: "2026-09-22T02:00:00.000Z",
      operation: "PREPARATION",
      policy: PROPOSED_LOCAL_VERIFICATION_POLICY,
      now: new Date("2026-09-22T01:00:00.000Z"),
    });
    expect(result.validUntil).toBe("2026-09-22T02:00:00.000Z");
    expect(result.providerExpiry).toBe("KNOWN");
  });
});
