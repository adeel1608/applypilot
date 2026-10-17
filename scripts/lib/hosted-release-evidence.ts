import { z } from "zod";
import {
  HostedAiReviewEvidenceSchema,
  assertHostedAiReviewEvidence,
  hostedDigest,
  hostedReviewFiles,
  hostedReviewGit,
  readHostedReviewPolicy,
  retrievedHostedAiReviews,
  effectiveHostedAiReviews,
} from "@applypilot/application-runner";

export function assertHostedSuccessfulCi(input: unknown, head: string): string[] {
  const runs = z
    .array(
      z.object({
        headSha: z.string().regex(/^[a-f0-9]{40}$/),
        status: z.string(),
        conclusion: z.string().nullable(),
        url: z.url().regex(/^https:\/\/github\.com\/adeel1608\/applypilot\/actions\/runs\/\d+$/),
      }),
    )
    .min(1)
    .max(99)
    .safeParse(input);
  if (
    !runs.success ||
    runs.data.some(
      (run) => run.headSha !== head || run.status !== "completed" || run.conclusion !== "success",
    )
  )
    throw new Error("HOSTED_EXACT_HEAD_CI_REQUIRED");
  return [...new Set(runs.data.map((run) => run.url))].slice(0, 10);
}
export function collectHostedAiReviewEvidence(input: {
  root: string;
  pr: number;
  head: string;
  tree: string;
  reviewedHead: string;
  pages: unknown;
  reviewIds?: number[];
}) {
  const policy = readHostedReviewPolicy(input.root);
  if (hostedReviewGit(input.root, "rev-parse", `${input.reviewedHead}^{tree}`) !== input.tree)
    throw new Error("HOSTED_REVIEWED_MERGE_TREE_MISMATCH");
  const files = hostedReviewFiles(input.root, policy.policy.scopeBase, input.head);
  const reviewHistory = retrievedHostedAiReviews(input.pages, input.pr);
  const reports = effectiveHostedAiReviews(reviewHistory, input.reviewedHead, undefined, input.pr);
  if (
    input.reviewIds &&
    (input.reviewIds.length !== 2 ||
      new Set(input.reviewIds).size !== 2 ||
      reports.some((report) => !input.reviewIds!.includes(report.id)))
  )
    throw new Error("HOSTED_AI_REVIEW_REPORTS_REQUIRED");
  const evidence = HostedAiReviewEvidenceSchema.parse({
    ...policy,
    releasePr: input.pr,
    reviewedHead: input.reviewedHead,
    reviewedTree: input.tree,
    mergeHead: input.head,
    mergeTree: input.tree,
    files,
    filesDigest: hostedDigest(files),
    reports,
    reviewHistory,
    aiReviewPassCount: 2,
    humanReviewCount: 0,
    independentHumanReviewCount: 0,
  });
  return assertHostedAiReviewEvidence(evidence, {
    ...policy,
    head: input.head,
    tree: input.tree,
    reviewedHead: input.reviewedHead,
    files,
  });
}
