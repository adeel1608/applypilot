import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import {
  compiledHostedProductionBuildDigest,
  compiledHostedBuildDigest,
  hostedReviewFiles,
  HostedReviewedBuildRecordSchema,
  HOSTED_AI_REVIEW_LABEL,
} from "@applypilot/application-runner";
import { assertHostedOwnedStartup } from "../../scripts/lib/hosted-startup";
import { fictionalAiReviews } from "../helpers/hosted-ai-review-fixture";

const source = resolve(process.cwd());
let root: string,
  head: string,
  tree: string,
  featureHead: string,
  payload: ReturnType<typeof setupPayload>;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
function setupPayload() {
  const review = fictionalAiReviews({
    head: featureHead,
    mergeHead: head,
    tree,
    files: hostedReviewFiles(root, "ad61cbaf2327d99547306801e3d22d0cba4717c1", head),
    pr: 123,
  });
  return {
    pr: {
      state: "MERGED",
      mergeCommit: { oid: head },
      headRefOid: featureHead,
      baseRefName: "main",
      author: { login: "adeel1608" },
    },
    reviews: review.pages,
    ci: [
      {
        headSha: head,
        status: "completed",
        conclusion: "success",
        url: "https://github.com/adeel1608/applypilot/actions/runs/123",
      },
    ],
    threads: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [] as { isResolved: boolean }[],
            },
          },
        },
      },
    },
  };
}
function runCli(value: unknown, reviewIds?: string) {
  writeFileSync(join(root, "data/private/fixture-provider.json"), JSON.stringify(value));
  return spawnSync(
    process.execPath,
    [
      "--require",
      join(root, "data/private/fixture-provider.cjs"),
      "--import",
      pathToFileURL(join(source, "node_modules/tsx/dist/loader.mjs")).href,
      join(source, "scripts/seal-hosted-build.ts"),
      "--pr",
      "123",
      ...(reviewIds ? ["--ai-review-ids", reviewIds] : []),
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        NODE_PATH: join(source, "node_modules"),
        APPLYPILOT_DB_PATH: join(root, "data/applypilot.local.sqlite"),
      },
    },
  );
}
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "applypilot-ai-rollout-"));
  execFileSync("git", ["clone", "--shared", "--no-checkout", "--quiet", source, root], {
    windowsHide: true,
    stdio: "pipe",
  });
  git("checkout", "--detach", "a8c3fc7bdf83521d7512c5b8913ba1accc1578d0");
  const names = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: source, encoding: "utf8", windowsHide: true },
  )
    .split("\0")
    .filter(Boolean);
  for (const name of names) {
    if (name.startsWith("data/private/") || name.includes("..") || isAbsolute(name))
      throw new Error("FICTIONAL_PUBLIC_SOURCE_COPY_INVALID");
    const path = join(source, name);
    if (!lstatSync(path).isFile()) throw new Error("FICTIONAL_SOURCE_LINK_FORBIDDEN");
    mkdirSync(dirname(join(root, name)), { recursive: true });
    copyFileSync(path, join(root, name));
  }
  git("add", "-A");
  git(
    "-c",
    "user.name=Fictional Test",
    "-c",
    "user.email=fictional@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "FICTIONAL_TEST_ONLY reviewed feature",
  );
  featureHead = git("rev-parse", "HEAD");
  tree = git("rev-parse", "HEAD^{tree}");
  head = git(
    "-c",
    "user.name=Fictional Test",
    "-c",
    "user.email=fictional@example.invalid",
    "commit-tree",
    tree,
    "-p",
    "a8c3fc7bdf83521d7512c5b8913ba1accc1578d0",
    "-m",
    `FICTIONAL_TEST_ONLY squash ${randomUUID()}`,
  );
  git("checkout", "--detach", head);
  const runtime = join(root, "data/private/runtime"),
    next = join(root, "apps/web/.next");
  mkdirSync(runtime, { recursive: true });
  mkdirSync(join(next, "server"), { recursive: true });
  mkdirSync(join(next, "static"), { recursive: true });
  writeFileSync(join(next, "BUILD_ID"), "FICTIONAL_TEST_ONLY");
  writeFileSync(join(next, "routes-manifest.json"), "{}");
  writeFileSync(join(next, "prerender-manifest.json"), "{}");
  writeFileSync(join(next, "required-server-files.json"), "{}");
  writeFileSync(join(next, "build-manifest.json"), "{}");
  writeFileSync(join(next, "static/fixture.js"), "/* FICTIONAL_TEST_ONLY */");
  writeFileSync(join(next, "server/fixture.js"), "module.exports='FICTIONAL_TEST_ONLY';");
  writeFileSync(
    join(runtime, "hosted-quality-evidence.json"),
    JSON.stringify({
      schemaVersion: 2,
      head,
      tree,
      buildDigest: compiledHostedProductionBuildDigest(next),
      buildIdDigest: sha("FICTIONAL_TEST_ONLY"),
      command: "release:check:fixture",
      exitCode: 0,
      startedAt: "2026-10-17T00:00:00.000Z",
      completedAt: "2026-10-17T00:01:00.000Z",
    }),
  );
  const db = new Database(join(root, "data/applypilot.local.sqlite"));
  try {
    for (const name of readdirSync(join(root, "packages/database/drizzle"))
      .filter((name) => /^\d{4}.*\.sql$/.test(name))
      .sort())
      db.exec(readFileSync(join(root, "packages/database/drizzle", name), "utf8"));
  } finally {
    db.close();
  }
  const providerPath = join(root, "data/private/fixture-provider.json");
  writeFileSync(
    join(root, "data/private/fixture-provider.cjs"),
    `
// FICTIONAL_TEST_ONLY: intercepted GitHub CLI transport. Never falls through for gh.
const fs=require('node:fs'),cp=require('node:child_process'),original=cp.execFileSync;
cp.execFileSync=function(command,args,options){
  if(command!=='gh')return original.call(this,command,args,options);
  const data=JSON.parse(fs.readFileSync(${JSON.stringify(providerPath)},'utf8'));
  let value;
  if(args[0]==='pr'&&args[1]==='view')value=data.pr;
  else if(args[0]==='run'&&args[1]==='list')value=data.ci;
  else if(args[0]==='api'&&args[1]==='graphql')value=data.threads;
  else if(args[0]==='api'&&args[1].includes('/reviews?'))value=data.reviews;
  else throw new Error('FICTIONAL_GITHUB_TRANSPORT_UNSUPPORTED');
  return JSON.stringify(value);
};
require('node:module').syncBuiltinESMExports();
`,
  );
  payload = setupPayload();
  expect(git("status", "--porcelain")).toBe("");
}, 60000);
afterAll(() => {
  if (!root) return;
  const path = resolve(root),
    rel = relative(resolve(tmpdir()), path);
  if (
    !basename(path).startsWith("applypilot-ai-rollout-") ||
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    throw new Error("FICTIONAL_CLEANUP_PATH_INVALID");
  rmSync(path, { recursive: true, force: true });
});
describe("FICTIONAL actual seal CLI and owned-start admission", () => {
  it("refuses legacy server-only quality for a new AI seal", () => {
    const qualityPath = join(root, "data/private/runtime/hosted-quality-evidence.json");
    const original = readFileSync(qualityPath);
    try {
      const quality = JSON.parse(original.toString());
      quality.schemaVersion = 1;
      quality.buildDigest = compiledHostedBuildDigest(join(root, "apps/web/.next"));
      writeFileSync(qualityPath, JSON.stringify(quality));
      const result = runCli(payload);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("HOSTED_PRODUCTION_QUALITY_REQUIRED");
    } finally {
      writeFileSync(qualityPath, original);
    }
  }, 30000);
  it.each(["CHANGES_REQUIRED", "OPEN_BLOCKER"])(
    "does not hide later trusted %s by selecting older PASS review IDs",
    (kind) => {
      const value = structuredClone(payload),
        adverse = structuredClone(value.reviews[0]![0]!);
      adverse.id = 999;
      adverse.html_url = "https://github.com/adeel1608/applypilot/pull/123#pullrequestreview-999";
      adverse.submitted_at = "2026-10-17T00:00:03.000Z";
      const prefix = `${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n`;
      const report = JSON.parse(adverse.body.slice(prefix.length, -4));
      report.reviewId = randomUUID();
      report.completedAt = adverse.submitted_at;
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
      adverse.body = `${prefix}${JSON.stringify(report)}\n\`\`\``;
      value.reviews[0]!.push(adverse);
      const result = runCli(value, "101,102");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        kind === "CHANGES_REQUIRED"
          ? "HOSTED_AI_REVIEW_CHANGES_REQUIRED"
          : "HOSTED_AI_REVIEW_FINDINGS_UNRESOLVED",
      );
    },
    30000,
  );
  it("seals exact squash tree and admits owned startup with two AI passes and zero humans", () => {
    const result = runCli(payload);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(result.stdout).toContain("OWNER_DELEGATED_AI_REVIEW_ACCEPTED");
    const record = HostedReviewedBuildRecordSchema.parse(
      JSON.parse(
        readFileSync(join(root, "data/private/runtime/hosted-reviewed-build.json"), "utf8"),
      ),
    );
    expect(record).toMatchObject({
      schemaVersion: 2,
      humanReviewCount: 0,
      independentReviewCount: 0,
      aiReviewPassCount: 2,
      build: { head, tree },
    });
    expect(featureHead).not.toBe(head);
    expect(
      assertHostedOwnedStartup(root, join(root, "data/applypilot.local.sqlite")).build.head,
    ).toBe(head);
    const db = new Database(join(root, "data/applypilot.local.sqlite"), { readonly: true });
    try {
      expect(db.prepare("SELECT count(*) FROM source_owner_action_receipts").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM hosted_operation_claims").pluck().get()).toBe(0);
    } finally {
      db.close();
    }
  }, 30000);
  it.each([
    ["no-reports", "HOSTED_AI_REVIEW_REPORTS_REQUIRED"],
    ["failed-ci", "HOSTED_EXACT_HEAD_CI_REQUIRED"],
    ["wrong-ci-head", "HOSTED_EXACT_HEAD_CI_REQUIRED"],
    ["wrong-merge", "HOSTED_EXACT_REVIEWED_MERGE_HEAD_REQUIRED"],
    ["unresolved-thread", "HOSTED_REVIEW_THREAD_UNRESOLVED"],
  ])(
    "rejects %s through the actual production CLI",
    (kind, code) => {
      const value = structuredClone(payload);
      if (kind === "no-reports") value.reviews = [];
      if (kind === "failed-ci") value.ci[0]!.conclusion = "failure";
      if (kind === "wrong-ci-head") value.ci[0]!.headSha = "f".repeat(40);
      if (kind === "wrong-merge") value.pr.mergeCommit.oid = "f".repeat(40);
      if (kind === "unresolved-thread")
        value.threads.data.repository.pullRequest.reviewThreads.nodes = [{ isResolved: false }];
      const result = runCli(value);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(code);
      expect(result.stdout).not.toContain("HOSTED_REVIEWED_BUILD_SEALED");
    },
    30000,
  );
});
