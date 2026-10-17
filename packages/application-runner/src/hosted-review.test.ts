import { describe, expect, it } from "vitest";
import {
  fictionalAiReviews,
  mutateFictionalReview,
} from "../../../tests/helpers/hosted-ai-review-fixture";
import {
  assertHostedAiReviewEvidence,
  HOSTED_AI_REVIEW_LABEL,
  hostedDigest,
  hostedHumanReviewCounts,
  retrievedHostedAiReviews,
  parseHostedAiReviewBody,
  formatHostedAiReviewBody,
  hostedReviewBytesDigest,
} from "./index";
import { evaluatePersonalLiveV1 } from "../../../scripts/lib/personal-live-readiness";
import { assertHostedSuccessfulCi } from "../../../scripts/lib/hosted-release-evidence";

describe("owner-delegated AI technical review: fictional evidence only", () => {
  it("requires an explicit resolution before accepting later passing reports", () => {
    const f = fictionalAiReviews();
    const original = f.evidence.reports[0]!;
    const report = parseHostedAiReviewBody(original.body);
    const finding = {
      id: "A-FICTIONAL",
      severity: "HIGH" as const,
      blocking: true,
      location: "fictional function",
      evidence: "fictional reproduction",
      impact: "fictional impact",
      disposition: "OPEN" as const,
      resolution: "Unresolved fictional finding",
    };
    const priorBody = formatHostedAiReviewBody({
      ...report,
      reviewId: "00000000-0000-4000-8000-000000000100",
      completedAt: "2026-10-17T00:00:00.000Z",
      findings: [finding],
      decision: "CHANGES_REQUIRED",
    });
    f.evidence.reviewHistory.unshift({
      ...original,
      id: 100,
      url: "https://github.com/adeel1608/applypilot/pull/123#pullrequestreview-100",
      submittedAt: "2026-10-17T00:00:00.000Z",
      body: priorBody,
      bodyDigest: hostedReviewBytesDigest(priorBody),
    });
    expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
    mutateFictionalReview(f.evidence, 0, (resolved) => {
      resolved.findings = [
        {
          ...finding,
          disposition: "RESOLVED",
          resolution: "Fictional fix verified in the current exact scope",
        },
      ];
    });
    expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).not.toThrow();
  });
  it.each(["CHANGES_REQUIRED", "OPEN_BLOCKER"])(
    "rejects older selected PASS reports when later history contains %s",
    (kind) => {
      const f = fictionalAiReviews();
      const adverse = structuredClone(f.evidence.reports[0]!);
      adverse.id = 999;
      adverse.url = "https://github.com/adeel1608/applypilot/pull/123#pullrequestreview-999";
      adverse.submittedAt = "2026-10-17T00:00:03.000Z";
      f.evidence.reviewHistory.push(adverse);
      const original = f.evidence.reports[0]!;
      f.evidence.reports[0] = adverse;
      mutateFictionalReview(f.evidence, 0, (report) => {
        report.reviewId = "00000000-0000-4000-8000-000000000999";
        report.completedAt = adverse.submittedAt;
        if (kind === "CHANGES_REQUIRED") report.decision = "CHANGES_REQUIRED";
        else
          report.findings = [
            {
              id: "BLOCK",
              severity: "HIGH",
              blocking: true,
              location: "fictional function",
              evidence: "fictional reproduction",
              impact: "fictional impact",
              disposition: "OPEN",
              resolution: "Unresolved fictional finding",
            },
          ];
      });
      f.evidence.reports[0] = original;
      expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow(
        "HOSTED_AI_REVIEW_EVIDENCE_INVALID",
      );
    },
  );
  it("rejects a cross-PR cached history entry", () => {
    const f = fictionalAiReviews();
    f.evidence.reviewHistory[0] = {
      ...f.evidence.reviewHistory[0]!,
      url: "https://github.com/adeel1608/applypilot/pull/999#pullrequestreview-101",
    };
    expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
  });
  it("accepts two substantive exact-scope AI passes with zero humans, without making Personal Live V1 ready", () => {
    const f = fictionalAiReviews();
    expect(assertHostedAiReviewEvidence(f.evidence, f.expected)).toMatchObject({
      aiReviewPassCount: 2,
      humanReviewCount: 0,
      independentHumanReviewCount: 0,
    });
    expect(
      evaluatePersonalLiveV1({
        head: f.expected.head,
        tree: f.expected.tree,
        implementationReviewed: true,
        qualityProven: true,
        sourceProven: false,
        matchingQualified: false,
        realJourneyProven: false,
        databaseHealthy: true,
        unresolvedOperations: 0,
      }).state,
    ).toBe("NOT_READY");
  });
  it.each(["repository", "scope", "policyId", "scopeBase", "source"])(
    "rejects wrong %s policy/delegation even after recomputing digests",
    (field) => {
      const f = fictionalAiReviews();
      const policy = JSON.parse(JSON.stringify(f.evidence.policy));
      const delegation = JSON.parse(JSON.stringify(f.evidence.delegation));
      if (field === "source") delegation.sourceSha256 = "e".repeat(64);
      else policy[field] = field === "scopeBase" ? "e".repeat(40) : "UNAUTHORIZED";
      expect(() =>
        assertHostedAiReviewEvidence(
          {
            ...f.evidence,
            policy,
            delegation,
            policyDigest: hostedDigest(policy),
            delegationDigest: hostedDigest(delegation),
          },
          { ...f.expected, policy, delegation },
        ),
      ).toThrow("HOSTED_AI_REVIEW_EVIDENCE_INVALID");
    },
  );
  it.each([null, {}, { approved: true }, { aiReviewPassCount: 2, humanReviewCount: 0 }, []])(
    "rejects absent or counterfeit positive evidence %j",
    (input) => {
      expect(() => assertHostedAiReviewEvidence(input, fictionalAiReviews().expected)).toThrow(
        "HOSTED_AI_REVIEW_EVIDENCE_INVALID",
      );
    },
  );
  it("requires reports rather than delegation alone", () => {
    const f = fictionalAiReviews();
    expect(() =>
      assertHostedAiReviewEvidence({ ...f.evidence, reports: [] }, f.expected),
    ).toThrow();
  });
  it.each(["reviewId", "purpose", "reference"])(
    "rejects repeated %s instead of counting one review twice",
    (kind) => {
      const f = fictionalAiReviews(),
        first = parseHostedAiReviewBody(f.evidence.reports[0]!.body);
      if (kind === "reference") f.evidence.reports[1] = f.evidence.reports[0]!;
      else
        mutateFictionalReview(f.evidence, 1, (report) => {
          report[kind] = first[kind as "reviewId" | "purpose"];
        });
      expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
    },
  );
  it("accepts a truthful same-agent second pass with explicit first-pass linkage", () => {
    const f = fictionalAiReviews(),
      first = parseHostedAiReviewBody(f.evidence.reports[0]!.body);
    mutateFictionalReview(f.evidence, 1, (report) => {
      report.executionMode = "SAME_AGENT_SECOND_PASS";
      report.executionId = first.executionId;
      report.priorPassId = first.reviewId;
    });
    expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).not.toThrow();
  });
  it.each(["false-separate", "false-same", "missing-link"])(
    "rejects %s reviewer identity claims",
    (kind) => {
      const f = fictionalAiReviews(),
        first = parseHostedAiReviewBody(f.evidence.reports[0]!.body);
      mutateFictionalReview(f.evidence, 1, (report) => {
        if (kind === "false-separate") report.executionId = first.executionId;
        else {
          report.executionMode = "SAME_AGENT_SECOND_PASS";
          report.priorPassId = kind === "missing-link" ? null : first.reviewId;
          if (kind === "missing-link") report.executionId = first.executionId;
        }
      });
      expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
    },
  );
  it.each([
    "reviewedBase",
    "reviewedHead",
    "reviewedTree",
    "policyDigest",
    "delegationDigest",
    "coverageDigest",
  ])("rejects stale %s despite a recalculated body digest", (field) => {
    const f = fictionalAiReviews();
    mutateFictionalReview(f.evidence, 1, (report) => {
      report[field] = "e".repeat(field.endsWith("Digest") ? 64 : 40);
    });
    expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
  });
  it("rejects omitted changed files and a later executable head", () => {
    const f = fictionalAiReviews();
    expect(() =>
      assertHostedAiReviewEvidence(f.evidence, {
        ...f.expected,
        files: [...f.expected.files, { path: "scripts/later.ts", sha256: "f".repeat(64) }],
      }),
    ).toThrow();
    expect(() =>
      assertHostedAiReviewEvidence(f.evidence, { ...f.expected, head: "e".repeat(40) }),
    ).toThrow();
    expect(() =>
      assertHostedAiReviewEvidence({ ...f.evidence, mergeTree: "e".repeat(40) }, f.expected),
    ).toThrow();
  });
  it.each(["blocking", "high", "changes-required", "missing-area", "future", "counter"])(
    "rejects %s final report",
    (kind) => {
      const f = fictionalAiReviews();
      mutateFictionalReview(f.evidence, 1, (report) => {
        if (kind === "blocking" || kind === "high")
          report.findings = [
            {
              id: "OPEN",
              severity: kind === "high" ? "HIGH" : "MEDIUM",
              blocking: kind === "blocking",
              location: "fictional function",
              evidence: "fictional reproduction",
              impact: "fictional impact",
              disposition: "OPEN",
              resolution: "Unresolved fictional finding",
            },
          ];
        if (kind === "changes-required") report.decision = "CHANGES_REQUIRED";
        if (kind === "missing-area") report.areas = [];
        if (kind === "future") report.completedAt = "2099-01-01T00:00:00.000Z";
        if (kind === "counter") report.approved = true;
      });
      expect(() => assertHostedAiReviewEvidence(f.evidence, f.expected)).toThrow();
    },
  );
  it("rejects untrusted publisher, malformed or dismissed retrieved evidence", () => {
    const f = fictionalAiReviews();
    expect(() =>
      assertHostedAiReviewEvidence(
        {
          ...f.evidence,
          reports: f.evidence.reports.map((report) => ({ ...report, author: "visitor" })),
        },
        f.expected,
      ),
    ).toThrow();
    const pages = structuredClone(f.pages) as { user: { login: string } }[][];
    pages[0]![0]!.user.login = "visitor";
    expect(retrievedHostedAiReviews(pages, 123)).toHaveLength(1);
    const dismissed = structuredClone(f.pages);
    dismissed[0]![0]!.state = "DISMISSED" as "COMMENTED";
    expect(retrievedHostedAiReviews(dismissed, 123)).toHaveLength(1);
    expect(() => retrievedHostedAiReviews([{}], 123)).toThrow();
  });
  it("never counts AI-labelled User activity as human or lets it clear a change request", () => {
    const head = "a".repeat(40),
      ai = {
        state: "APPROVED",
        commit_id: head,
        user: { login: "owner", type: "User" },
        body: HOSTED_AI_REVIEW_LABEL,
      };
    expect(hostedHumanReviewCounts([ai], "owner", head)).toEqual({ human: 0, independent: 0 });
    expect(() =>
      hostedHumanReviewCounts(
        [{ ...ai, state: "CHANGES_REQUESTED", body: "Actual requested change" }, ai],
        "owner",
        head,
      ),
    ).toThrow("HOSTED_CHANGE_REQUEST_UNRESOLVED");
  });
});
describe("actual-head quality workflow evidence", () => {
  const run = {
    headSha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
    url: "https://github.com/adeel1608/applypilot/actions/runs/123",
  };
  it("accepts successful completed workflow evidence for the exact head", () =>
    expect(assertHostedSuccessfulCi([run], run.headSha)).toEqual([run.url]));
  it.each(["failure", "cancelled", "timed_out", "skipped", null])(
    "rejects %s even alongside an old success",
    (conclusion) =>
      expect(() => assertHostedSuccessfulCi([run, { ...run, conclusion }], run.headSha)).toThrow(
        "HOSTED_EXACT_HEAD_CI_REQUIRED",
      ),
  );
  it("rejects missing, wrong-head and in-progress workflow evidence", () => {
    for (const data of [
      [],
      [{ ...run, headSha: "b".repeat(40) }],
      [{ ...run, status: "in_progress" }],
    ])
      expect(() => assertHostedSuccessfulCi(data, run.headSha)).toThrow();
  });
});
