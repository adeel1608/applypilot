import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOSTED_ADAPTER_VERSION,
  HostedReviewedBuildRecordSchema,
  compiledHostedBuildDigest,
  assertHostedQualityEvidence,
  hostedHumanReviewCounts,
  hostedReviewsFromPages,
  assertHostedReviewedMergeHead,
} from "@applypilot/application-runner";
import { repositoryRoot } from "./lib/runtime-safety";
const root = repositoryRoot();
const pr = process.argv[process.argv.indexOf("--pr") + 1];
if (!process.argv.includes("--pr") || !/^\d+$/.test(pr ?? ""))
  throw new Error("HOSTED_REVIEWED_PR_REQUIRED");
const command = (name: string, args: string[]) =>
  execFileSync(name, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  }).trim();
const head = command("git", ["rev-parse", "HEAD"]);
const tree = command("git", ["rev-parse", "HEAD^{tree}"]);
if (command("git", ["status", "--porcelain"]).length)
  throw new Error("HOSTED_FROZEN_CLEAN_HEAD_REQUIRED");
const view = JSON.parse(
  command("gh", [
    "pr",
    "view",
    pr,
    "--repo",
    "adeel1608/applypilot",
    "--json",
    "state,mergeCommit,headRefOid,baseRefName,author",
  ]),
) as {
  state: string;
  mergeCommit: { oid: string } | null;
  headRefOid: string;
  baseRefName: string;
  author: { login: string };
};
if (view.state !== "MERGED" || view.baseRefName !== "main" || !view.mergeCommit)
  throw new Error("HOSTED_REVIEWED_MERGE_REQUIRED");
assertHostedReviewedMergeHead(head, view.mergeCommit.oid);
command("git", ["merge-base", "--is-ancestor", view.mergeCommit.oid, head]);
const reviews = hostedReviewsFromPages(
  JSON.parse(
    command("gh", [
      "api",
      `repos/adeel1608/applypilot/pulls/${pr}/reviews?per_page=100`,
      "--paginate",
      "--slurp",
    ]),
  ),
);
const reviewsProven = hostedHumanReviewCounts(reviews, view.author.login, view.headRefOid);
// The repository's documented human review gate is retained even without remote branch protection.
if (reviewsProven.human === 0) throw new Error("HOSTED_HUMAN_REVIEW_REQUIRED");
const ci = JSON.parse(
  command("gh", [
    "run",
    "list",
    "--repo",
    "adeel1608/applypilot",
    "--commit",
    head,
    "--workflow",
    "ci.yml",
    "--status",
    "success",
    "--json",
    "headSha,url,conclusion",
  ]),
) as { headSha: string; url: string; conclusion: string }[];
const success = ci.filter((run) => run.headSha === head && run.conclusion === "success");
if (success.length === 0) throw new Error("HOSTED_EXACT_HEAD_CI_REQUIRED");
const runtime = join(root, "data", "private", "runtime");
const bytes = readFileSync(join(runtime, "hosted-quality-evidence.json"));
const next = join(root, "apps", "web", ".next");
assertHostedQualityEvidence(bytes, next, head, tree);
const record = HostedReviewedBuildRecordSchema.parse({
  schemaVersion: 1,
  build: {
    head,
    tree,
    buildDigest: compiledHostedBuildDigest(next),
    adapterVersion: HOSTED_ADAPTER_VERSION,
  },
  buildIdDigest: createHash("sha256")
    .update(readFileSync(join(next, "BUILD_ID")))
    .digest("hex"),
  qualityEvidenceDigest: createHash("sha256").update(bytes).digest("hex"),
  pullRequests: [`https://github.com/adeel1608/applypilot/pull/${pr}`],
  ciRuns: success.map((run) => run.url).slice(0, 10),
  repositoryPolicySatisfied: true,
  humanReviewCount: reviewsProven.human,
  independentReviewCount: reviewsProven.independent,
  recordedAt: new Date().toISOString(),
});
mkdirSync(runtime, { recursive: true });
writeFileSync(join(runtime, "hosted-reviewed-build.json"), JSON.stringify(record) + "\n", {
  mode: 0o600,
});
console.log(
  `HOSTED_REVIEWED_BUILD_SEALED head=${head} human_reviews=${reviewsProven.human} independent_reviews=${reviewsProven.independent}`,
);
