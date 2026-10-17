import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  HOSTED_AI_REVIEW_LABEL,
  HOSTED_REVIEW_AREAS,
  OwnerDelegatedReviewPolicySchema,
  OwnerReviewDelegationSchema,
  hostedDigest,
  formatHostedAiReviewBody,
  hostedReviewBytesDigest,
  type HostedAiReviewEvidence,
  type HostedAiReviewReport,
} from "@applypilot/application-runner";

/** Fictional transport data only; never publish these reports or install them in canonical runtime. */
export function fictionalAiReviews(input?: {
  head?: string;
  mergeHead?: string;
  tree?: string;
  files?: { path: string; sha256: string | null }[];
  pr?: number;
}) {
  const policy = OwnerDelegatedReviewPolicySchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../config/owner-delegated-review-policy.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const delegation = OwnerReviewDelegationSchema.parse(
    JSON.parse(
      readFileSync(new URL("../../config/owner-review-delegation.json", import.meta.url), "utf8"),
    ),
  );
  const head = input?.head ?? "a".repeat(40),
    mergeHead = input?.mergeHead ?? "b".repeat(40),
    tree = input?.tree ?? "c".repeat(40),
    pr = input?.pr ?? 123;
  const files = input?.files ?? [{ path: "packages/fictional.ts", sha256: "d".repeat(64) }];
  const reports = (
    ["IMPLEMENTATION_CORRECTNESS", "ADVERSARIAL_SECURITY_PRIVACY_RECOVERY"] as const
  ).map((purpose, index) => {
    const coverage = files.map((file) => ({
      ...file,
      readMode: (file.path === "package-lock.json"
        ? "LOCKFILE_PACKAGE_INTEGRITY"
        : file.path.endsWith(".md")
          ? "CHANGED_DOCUMENT_SECTIONS"
          : "FULL_SOURCE") as HostedAiReviewReport["coverage"][number]["readMode"],
      functions: [],
    }));
    const report: HostedAiReviewReport = {
      schemaVersion: 1,
      policyId: policy.policyId,
      policyDigest: hostedDigest(policy),
      delegationDigest: hostedDigest(delegation),
      repository: policy.repository,
      scope: policy.scope,
      reviewerKind: "AI",
      reviewId: randomUUID(),
      purpose,
      executionMode: "SEPARATE_READ_ONLY_AGENT",
      executionId: `fictional-test-agent-${index}`,
      priorPassId: null,
      modelIdentity: "UNKNOWN",
      independentHumanReview: false,
      reviewedBase: policy.scopeBase,
      reviewedHead: head,
      reviewedTree: tree,
      completedAt: "2026-10-17T00:00:01.000Z",
      coverage,
      coverageDigest: hostedDigest(coverage),
      areas: HOSTED_REVIEW_AREAS.map((area) => ({
        area,
        rationale:
          "FICTIONAL_TEST_ONLY: tests exercise the actual closed validator and rejection invariants, without claiming a real review.",
        evidence: [files[0]!.path],
      })),
      findings: [],
      validationReferences: ["FICTIONAL_TEST_ONLY: production validator tests"],
      rationale:
        "FICTIONAL_TEST_ONLY: controlled review transport fixture exercises production validators. It is not an actual agent review or owner authorization, and must never be published or installed in the canonical runtime.",
      decision: "PASS",
    };
    const body = formatHostedAiReviewBody(report);
    return {
      id: index + 101,
      url: `https://github.com/adeel1608/applypilot/pull/${pr}#pullrequestreview-${index + 101}`,
      state: "COMMENTED" as const,
      commit: head,
      submittedAt: "2026-10-17T00:00:02.000Z",
      author: "adeel1608" as const,
      body,
      bodyDigest: hostedReviewBytesDigest(body),
    };
  });
  const evidence: HostedAiReviewEvidence = {
    policy,
    delegation,
    policyDigest: hostedDigest(policy),
    delegationDigest: hostedDigest(delegation),
    releasePr: pr,
    reviewedHead: head,
    reviewedTree: tree,
    mergeHead,
    mergeTree: tree,
    files,
    filesDigest: hostedDigest(files),
    reports,
    reviewHistory: [...reports],
    aiReviewPassCount: 2,
    humanReviewCount: 0,
    independentHumanReviewCount: 0,
  };
  return {
    evidence,
    expected: { head: mergeHead, tree, reviewedHead: head, policy, delegation, files },
    pages: [
      reports.map((report) => ({
        id: report.id,
        html_url: report.url,
        state: report.state,
        commit_id: report.commit,
        submitted_at: report.submittedAt,
        body: report.body,
        user: { login: report.author, type: "User" },
      })),
    ],
  };
}
export function mutateFictionalReview(
  evidence: HostedAiReviewEvidence,
  index: number,
  mutate: (report: Record<string, unknown>) => void,
): void {
  const retrieved = evidence.reports[index]!;
  const report = JSON.parse(
    retrieved.body.slice(`${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n`.length, -4),
  ) as Record<string, unknown>;
  mutate(report);
  retrieved.body = `${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\``;
  retrieved.bodyDigest = hostedReviewBytesDigest(retrieved.body);
}
