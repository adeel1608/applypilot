import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compiledHostedBuildDigest } from "@applypilot/application-runner";
import { join } from "node:path";
import { repositoryRoot } from "./lib/runtime-safety";
const root = repositoryRoot();
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const head = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
if (git("status", "--porcelain").length) throw new Error("HOSTED_FROZEN_CLEAN_HEAD_REQUIRED");
const startedAt = new Date().toISOString();
execFileSync(
  process.execPath,
  [
    join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    join(root, "scripts", "release-check-fixture.ts"),
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (
  git("rev-parse", "HEAD") !== head ||
  git("rev-parse", "HEAD^{tree}") !== tree ||
  git("status", "--porcelain").length
)
  throw new Error("HOSTED_FROZEN_HEAD_CHANGED");
const dir = join(root, "data", "private", "runtime");
const nextRoot = join(root, "apps", "web", ".next");
const buildDigest = compiledHostedBuildDigest(nextRoot);
const buildIdDigest = createHash("sha256")
  .update(readFileSync(join(nextRoot, "BUILD_ID")))
  .digest("hex");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "hosted-quality-evidence.json"),
  JSON.stringify({
    schemaVersion: 1,
    head,
    tree,
    buildDigest,
    buildIdDigest,
    command: "release:check:fixture",
    exitCode: 0,
    startedAt,
    completedAt: new Date().toISOString(),
  }) + "\n",
  { mode: 0o600 },
);
console.log("HOSTED_FROZEN_QUALITY_PASS");
