import { readFileSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import BetterSqlite3 from "better-sqlite3";
import {
  HostedCapabilitySchema,
  HostedReviewedBuildRecordSchema,
  compiledHostedBuildDigest,
  assertHostedBuildEvidence,
  assertHostedPathWithoutLinks,
  hostedCapabilityDigest,
  hostedDigest,
} from "@applypilot/application-runner";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { HostedWorkflowRepository } from "@applypilot/database";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";
function main(): void {
  const root = repositoryRoot();
  const index = process.argv.indexOf("--proposal");
  if (index < 0 || !process.argv[index + 1]) throw new Error("HOSTED_PROPOSAL_REQUIRED");
  const path = resolve(root, process.argv[index + 1]!);
  const rel = relative(join(root, "data", "private"), path);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !path.endsWith(".json")
  )
    throw new Error("HOSTED_PRIVATE_PROPOSAL_REQUIRED");
  assertHostedPathWithoutLinks(path);
  const readBuild = () => {
    const record = HostedReviewedBuildRecordSchema.parse(
      JSON.parse(
        readFileSync(
          join(root, "data", "private", "runtime", "hosted-reviewed-build.json"),
          "utf8",
        ),
      ),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    if (
      git("rev-parse", "HEAD") !== record.build.head ||
      git("rev-parse", "HEAD^{tree}") !== record.build.tree ||
      git(
        "status",
        "--porcelain",
        "--untracked-files=no",
        "--",
        "apps",
        "packages",
        "scripts",
        "package.json",
        "package-lock.json",
      ).length ||
      compiledHostedBuildDigest(join(root, "apps", "web", ".next")) !== record.build.buildDigest
    )
      throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
    assertHostedBuildEvidence(
      record,
      join(root, "apps", "web", ".next"),
      readFileSync(join(root, "data", "private", "runtime", "hosted-quality-evidence.json")),
    );
    return record.build;
  };
  const build = readBuild();
  const cap = HostedCapabilitySchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (cap.mode !== "REAL" || hostedDigest(cap.build) !== hostedDigest(build))
    throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
  const sqlite = new BetterSqlite3(localDatabasePath(), { fileMustExist: true });
  sqlite.pragma("foreign_keys=ON");
  try {
    const store = new HostedWorkflowRepository(sqlite, {
      mode: "REAL",
      approvedArtifactRoot: join(root, "data", "private"),
      reviewedBuild: build,
      currentReviewedBuild: readBuild,
      currentPrivateProfileHash: () =>
        candidateProfileContentHash(
          CandidateProfileSchema.parse(
            JSON.parse(readFileSync(join(root, "data", "profile.private.json"), "utf8")),
          ),
        ),
    });
    store.assertSubject(
      cap.subject,
      cap.scope === "APPLICATION" ? "PRE_EXTERNAL_ACTION" : "PREPARATION",
    );
    if (cap.scope === "APPLICATION") {
      const session = store
        .listSessions()
        .find((s) => s.capability.capabilityId === cap.capabilityId && s.state === "INSPECTED");
      if (
        !session?.form ||
        !session.discovery ||
        cap.formDigest !== hostedDigest(session.form) ||
        cap.discoveryDigest !== hostedDigest(session.discovery)
      )
        throw new Error("HOSTED_APPLICATION_BINDING_INVALID");
      store.resolvePacket(cap);
    }
    sqlite
      .transaction(() => {
        store.persistCapability(cap);
        store.assertCapability(cap, build);
      })
      .immediate();
    console.log(
      `HOSTED_PROPOSAL_STAGED id=${cap.capabilityId} version=${cap.version} digest=${hostedCapabilityDigest(cap)} owner_receipts=0 requests=0`,
    );
  } finally {
    sqlite.close();
  }
}
try {
  main();
} catch (error) {
  console.error(
    error instanceof Error && /^HOSTED_[A-Z_]+$/.test(error.message)
      ? error.message
      : "HOSTED_CAPABILITY_STAGING_FAILED",
  );
  process.exitCode = 1;
}
