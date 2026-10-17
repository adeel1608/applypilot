import { describe, expect, it } from "vitest";
import { evaluatePersonalLiveV1, PERSONAL_LIVE_CRITERIA } from "./personal-live-readiness";
const good = {
  head: "a".repeat(40),
  tree: "b".repeat(40),
  implementationReviewed: true,
  qualityProven: true,
  sourceProven: true,
  matchingQualified: true,
  realJourneyProven: true,
  databaseHealthy: true,
  unresolvedOperations: 0,
};
const owner = {
  schemaVersion: 1,
  head: good.head,
  tree: good.tree,
  criteria: Object.fromEntries(
    PERSONAL_LIVE_CRITERIA.map((c) => [c, { state: "ACCEPTED", evidenceDigest: "c".repeat(64) }]),
  ),
  action: "PERSONAL_LIVE_V1_OWNER_RELEASE",
  ownerApprovalId: "fictional-owner-release",
  approvedAt: "2026-10-09T05:00:00.000Z",
};
describe("official Personal Live V1 release boundary", () => {
  it("does not promote one real application without owner release", () => {
    expect(evaluatePersonalLiveV1(good)).toMatchObject({
      state: "NOT_READY",
      blockers: ["PERSONAL_LIVE_V1_OWNER_RELEASE_REQUIRED"],
    });
  });
  it.each([
    "implementationReviewed",
    "qualityProven",
    "sourceProven",
    "matchingQualified",
    "realJourneyProven",
    "databaseHealthy",
  ] as const)("requires %s even with an owner release decision", (field) => {
    expect(evaluatePersonalLiveV1({ ...good, [field]: false, ownerDecision: owner }).state).toBe(
      "NOT_READY",
    );
  });
  it("requires exact head/tree and every R0-R6/R11/full matrix acceptance", () => {
    expect(
      evaluatePersonalLiveV1({ ...good, ownerDecision: { ...owner, head: "d".repeat(40) } }).state,
    ).toBe("NOT_READY");
    expect(
      evaluatePersonalLiveV1({
        ...good,
        ownerDecision: {
          ...owner,
          criteria: {
            ...owner.criteria,
            R11: { state: "BLOCKED", evidenceDigest: "e".repeat(64) },
          },
        },
      }).blockers,
    ).toContain("R11_OWNER_ACCEPTANCE_REQUIRED");
  });
  it("requires no unresolved operation outcome", () => {
    expect(
      evaluatePersonalLiveV1({ ...good, unresolvedOperations: 1, ownerDecision: owner }).blockers,
    ).toContain("UNRESOLVED_OPERATION_OUTCOME");
  });
  it("returns ready only for the complete fictional evaluation contract", () => {
    expect(evaluatePersonalLiveV1({ ...good, ownerDecision: owner }).state).toBe(
      "PERSONAL_LIVE_V1_READY",
    );
  });
});
