import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  HOSTED_ADAPTER_VERSION,
  HostedReviewedBuildRecordSchema,
  compiledHostedProductionBuildDigest,
  assertHostedBuildEvidence,
  assertHostedQualityEvidence,
  hostedHumanReviewCounts,
  hostedReviewsFromPages,
  assertHostedReviewedMergeHead,
} from "@applypilot/application-runner";
import {
  assertHostedSuccessfulCi,
  collectHostedAiReviewEvidence,
} from "./lib/hosted-release-evidence";
import { repositoryRoot, localDatabasePath } from "./lib/runtime-safety";
import { inspectDatabase } from "./lib/database-maintenance";
import { databaseSchemaStatus } from "./lib/database-schema";

function main(): void {
  const root = repositoryRoot();
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const pr = value("--pr");
  if (
    !pr ||
    !/^\d+$/.test(pr) ||
    new Set(args.filter((arg) => arg.startsWith("--"))).size !==
      args.filter((arg) => arg.startsWith("--")).length ||
    args.some((arg, i) => i % 2 === 0 && !["--pr", "--ai-review-ids"].includes(arg)) ||
    args.length % 2 !== 0
  )
    throw new Error("HOSTED_REVIEWED_PR_REQUIRED");
  const selected = value("--ai-review-ids");
  if (selected && !/^\d+,\d+$/.test(selected)) throw new Error("HOSTED_AI_REVIEW_REPORTS_REQUIRED");
  const command = (name: string, parameters: string[]) =>
    execFileSync(name, parameters, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8_000_000,
    }).trim();
  const gh = (...parameters: string[]): unknown => JSON.parse(command("gh", parameters));
  const head = command("git", ["rev-parse", "HEAD"]),
    tree = command("git", ["rev-parse", "HEAD^{tree}"]);
  if (command("git", ["status", "--porcelain"]).length)
    throw new Error("HOSTED_FROZEN_CLEAN_HEAD_REQUIRED");
  const view = z
    .object({
      state: z.literal("MERGED"),
      mergeCommit: z.object({ oid: z.string().regex(/^[a-f0-9]{40}$/) }),
      headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
      baseRefName: z.literal("main"),
      author: z.object({ login: z.string() }),
    })
    .parse(
      gh(
        "pr",
        "view",
        pr,
        "--repo",
        "adeel1608/applypilot",
        "--json",
        "state,mergeCommit,headRefOid,baseRefName,author",
      ),
    );
  assertHostedReviewedMergeHead(head, view.mergeCommit.oid);
  const pages = gh(
    "api",
    `repos/adeel1608/applypilot/pulls/${pr}/reviews?per_page=100`,
    "--paginate",
    "--slurp",
  );
  // Complete history is always checked. AI comments cannot supply human approval or clear requests.
  hostedHumanReviewCounts(hostedReviewsFromPages(pages), view.author.login, view.headRefOid);
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const query = `query($cursor:String){repository(owner:"adeel1608",name:"applypilot"){pullRequest(number:${Number(pr)}){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{isResolved}}}}}`;
    const response = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              reviewThreads: z.object({
                pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
                nodes: z.array(z.object({ isResolved: z.boolean() })).max(100),
              }),
            }),
          }),
        }),
      })
      .parse(
        gh("api", "graphql", "-f", `query=${query}`, ...(cursor ? ["-f", `cursor=${cursor}`] : [])),
      );
    const threads = response.data.repository.pullRequest.reviewThreads;
    if (threads.nodes.some((thread) => !thread.isResolved))
      throw new Error("HOSTED_REVIEW_THREAD_UNRESOLVED");
    if (!threads.pageInfo.hasNextPage) break;
    if (!threads.pageInfo.endCursor || threads.pageInfo.endCursor === cursor || page === 99)
      throw new Error("HOSTED_REVIEW_HISTORY_INVALID");
    cursor = threads.pageInfo.endCursor;
  }
  const ci = assertHostedSuccessfulCi(
    gh(
      "run",
      "list",
      "--repo",
      "adeel1608/applypilot",
      "--commit",
      head,
      "--workflow",
      "ci.yml",
      "--limit",
      "100",
      "--json",
      "headSha,url,conclusion,status",
    ),
    head,
  );
  const review = collectHostedAiReviewEvidence({
    root,
    pr: Number(pr),
    head,
    tree,
    reviewedHead: view.headRefOid,
    pages,
    ...(selected ? { reviewIds: selected.split(",").map(Number) } : {}),
  });
  const database = inspectDatabase(localDatabasePath());
  const status = databaseSchemaStatus(database.schemaVersion);
  if (
    database.integrity !== "PASS" ||
    database.foreignKeyIssues ||
    status.pendingMigrations ||
    status.unsupported
  )
    throw new Error("HOSTED_DATABASE_ROLLOUT_REQUIRED");
  const runtime = join(root, "data", "private", "runtime"),
    next = join(root, "apps", "web", ".next");
  const bytes = readFileSync(join(runtime, "hosted-quality-evidence.json"));
  if (assertHostedQualityEvidence(bytes, next, head, tree).schemaVersion !== 2)
    throw new Error("HOSTED_PRODUCTION_QUALITY_REQUIRED");
  const record = HostedReviewedBuildRecordSchema.parse({
    schemaVersion: 2,
    reviewKind: "OWNER_DELEGATED_AI",
    build: {
      head,
      tree,
      buildDigest: compiledHostedProductionBuildDigest(next),
      adapterVersion: HOSTED_ADAPTER_VERSION,
    },
    buildIdDigest: createHash("sha256")
      .update(readFileSync(join(next, "BUILD_ID")))
      .digest("hex"),
    qualityEvidenceDigest: createHash("sha256").update(bytes).digest("hex"),
    pullRequests: [
      "https://github.com/adeel1608/applypilot/pull/79",
      `https://github.com/adeel1608/applypilot/pull/${pr}`,
    ],
    ciRuns: ci,
    repositoryPolicySatisfied: true,
    humanReviewCount: 0,
    independentReviewCount: 0,
    aiReviewPassCount: 2,
    aiReviewEvidence: review,
    recordedAt: new Date().toISOString(),
  });
  assertHostedBuildEvidence(record, next, bytes, root);
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "hosted-reviewed-build.json"), JSON.stringify(record) + "\n", {
    mode: 0o600,
  });
  console.log(
    `OWNER_DELEGATED_AI_REVIEW_ACCEPTED head=${head} ai_passes=2 human_reviews=0 independent_human_reviews=0`,
  );
  console.log(`HOSTED_REVIEWED_BUILD_SEALED head=${head} build=${record.build.buildDigest}`);
}
try {
  main();
} catch (error) {
  console.error(
    error instanceof Error && /^HOSTED_[A-Z_]+$/.test(error.message)
      ? error.message
      : "HOSTED_BUILD_SEAL_FAILED",
  );
  process.exitCode = 1;
}
