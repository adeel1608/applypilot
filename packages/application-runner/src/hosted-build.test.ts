import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HOSTED_ADAPTER_VERSION } from "./hosted-contract";
import {
  assertHostedBuildEvidence,
  assertHostedQualityEvidence,
  compiledHostedBuildDigest,
  hostedHumanReviewCounts,
  hostedReviewsFromPages,
  assertHostedReviewedMergeHead,
  HostedReviewedBuildRecordSchema,
} from "./hosted-build";

const roots: string[] = [];
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => {
  for (const root of roots.splice(0)) {
    const path = resolve(root),
      rel = relative(resolve(tmpdir()), path);
    if (
      !basename(path).startsWith("applypilot-hosted-build-") ||
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    )
      throw new Error("FICTIONAL_CLEANUP_PATH_INVALID");
    rmSync(path, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "applypilot-hosted-build-"));
  roots.push(root);
  const next = join(root, "next");
  mkdirSync(join(next, "server", "chunks"), { recursive: true });
  writeFileSync(join(next, "BUILD_ID"), "fictional-build");
  writeFileSync(join(next, "routes-manifest.json"), "{}");
  writeFileSync(join(next, "prerender-manifest.json"), "{}");
  writeFileSync(
    join(next, "server", "chunks", "production.js"),
    "module.exports = 'fictional-v1';",
  );
  const quality = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      head: "a".repeat(40),
      tree: "b".repeat(40),
      buildDigest: compiledHostedBuildDigest(next),
      buildIdDigest: sha("fictional-build"),
      command: "release:check:fixture",
      exitCode: 0,
      startedAt: "2026-10-09T05:00:00.000Z",
      completedAt: "2026-10-09T05:01:00.000Z",
    }),
  );
  const record = HostedReviewedBuildRecordSchema.parse({
    schemaVersion: 1,
    build: {
      head: "a".repeat(40),
      tree: "b".repeat(40),
      buildDigest: compiledHostedBuildDigest(next),
      adapterVersion: HOSTED_ADAPTER_VERSION,
    },
    buildIdDigest: sha("fictional-build"),
    qualityEvidenceDigest: sha(quality),
    pullRequests: ["https://github.com/adeel1608/applypilot/pull/123"],
    ciRuns: ["https://github.com/adeel1608/applypilot/actions/runs/123"],
    repositoryPolicySatisfied: true,
    humanReviewCount: 1,
    independentReviewCount: 0,
    recordedAt: "2026-10-09T05:02:00.000Z",
  });
  return { root, next, quality, record };
}
describe("hosted reviewed executable evidence", () => {
  it("requires the actual reviewed merge head instead of accepting an older reviewed ancestor", () => {
    expect(() => assertHostedReviewedMergeHead("a".repeat(40), "a".repeat(40))).not.toThrow();
    expect(() => assertHostedReviewedMergeHead("b".repeat(40), "a".repeat(40))).toThrow(
      "HOSTED_EXACT_REVIEWED_MERGE_HEAD_REQUIRED",
    );
    expect(() => assertHostedReviewedMergeHead("a".repeat(40), "not-a-commit")).toThrow(
      "HOSTED_EXACT_REVIEWED_MERGE_HEAD_REQUIRED",
    );
  });
  it("accepts exact compiled bytes plus frozen quality and owner review evidence", () => {
    const f = fixture();
    expect(() => assertHostedBuildEvidence(f.record, f.next, f.quality)).not.toThrow();
  });
  it("rejects changed production bytes even when BUILD_ID is unchanged", () => {
    const f = fixture();
    writeFileSync(
      join(f.next, "server", "chunks", "production.js"),
      "module.exports = 'fictional-v2';",
    );
    expect(() => assertHostedBuildEvidence(f.record, f.next, f.quality)).toThrow(
      "HOSTED_REVIEWED_BUILD_REQUIRED",
    );
  });
  it("proves offline quality separately from human review and rejects a different head", () => {
    const f = fixture();
    expect(
      assertHostedQualityEvidence(f.quality, f.next, f.record.build.head, f.record.build.tree)
        .exitCode,
    ).toBe(0);
    expect(() =>
      assertHostedQualityEvidence(f.quality, f.next, "f".repeat(40), f.record.build.tree),
    ).toThrow("HOSTED_QUALITY_EVIDENCE_INVALID");
  });
  it("rejects an overwritten build even if a new review record hashes its current bytes", () => {
    const f = fixture();
    writeFileSync(
      join(f.next, "server", "chunks", "production.js"),
      "module.exports = 'untested-build';",
    );
    const changed = {
      ...f.record,
      build: { ...f.record.build, buildDigest: compiledHostedBuildDigest(f.next) },
    };
    expect(() => assertHostedBuildEvidence(changed, f.next, f.quality)).toThrow(
      "HOSTED_REVIEWED_BUILD_REQUIRED",
    );
  });
  it("rejects a legacy head-only quality record with no compiled-byte proof", () => {
    const f = fixture();
    const quality = JSON.parse(f.quality.toString()) as Record<string, unknown>;
    delete quality.buildDigest;
    delete quality.buildIdDigest;
    expect(() =>
      assertHostedQualityEvidence(
        Buffer.from(JSON.stringify(quality)),
        f.next,
        f.record.build.head,
        f.record.build.tree,
      ),
    ).toThrow("HOSTED_QUALITY_EVIDENCE_INVALID");
  });
  it.each(["digest", "head", "exit", "time", "buildDigest", "buildIdDigest"] as const)(
    "rejects changed %s quality evidence",
    (kind) => {
      const f = fixture();
      const q = JSON.parse(f.quality.toString()) as Record<string, unknown>;
      if (kind === "digest") q.completedAt = "2026-10-09T05:03:00.000Z";
      if (kind === "head") q.head = "d".repeat(40);
      if (kind === "exit") q.exitCode = 1;
      if (kind === "time") q.completedAt = "2026-10-09T04:00:00.000Z";
      if (kind === "buildDigest" || kind === "buildIdDigest") q[kind] = "f".repeat(64);
      expect(() =>
        assertHostedBuildEvidence(f.record, f.next, Buffer.from(JSON.stringify(q))),
      ).toThrow();
    },
  );
  it.each(["ancestor", "server", "file"] as const)("rejects %s symlink or junction", (kind) => {
    const f = fixture();
    if (kind === "ancestor") {
      const link = join(f.root, "linked");
      symlinkSync(f.next, link, process.platform === "win32" ? "junction" : "dir");
      expect(() => compiledHostedBuildDigest(link)).toThrow("HOSTED_BUILD_INVALID");
    } else {
      symlinkSync(
        join(f.next, "server", "chunks"),
        join(f.next, "server", kind === "server" ? "linked" : "linked.json"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() => compiledHostedBuildDigest(f.next)).toThrow("HOSTED_BUILD_INVALID");
    }
  });
  it("requires a human review without inventing an independent reviewer requirement", () => {
    const f = fixture();
    expect(
      HostedReviewedBuildRecordSchema.safeParse({ ...f.record, humanReviewCount: 0 }).success,
    ).toBe(false);
  });
});
describe("current-head human review proof", () => {
  const head = "a".repeat(40);
  const review = (state: string, login = "reviewer", commit_id = head, body = "") => ({
    state,
    commit_id,
    body,
    user: { login, type: "User" },
  });
  it("distinguishes independent approval and explicit PR-owner comment", () => {
    expect(hostedHumanReviewCounts([review("APPROVED")], "owner", head)).toEqual({
      human: 1,
      independent: 1,
    });
    expect(
      hostedHumanReviewCounts(
        [review("COMMENTED", "owner", head, `APPROVE RELEASE REVIEW ${head}`)],
        "owner",
        head,
      ),
    ).toEqual({ human: 1, independent: 0 });
  });
  it("rejects ordinary comments, stale approvals, and bot approvals", () => {
    expect(
      hostedHumanReviewCounts(
        [
          review("COMMENTED", "owner", head, "Looks good"),
          review("APPROVED", "reviewer", "b".repeat(40)),
          { ...review("APPROVED", "bot"), user: { login: "bot", type: "Bot" } },
        ],
        "owner",
        head,
      ),
    ).toEqual({ human: 0, independent: 0 });
  });
  it("does not clear a change request when a later comment is posted", () => {
    expect(() =>
      hostedHumanReviewCounts(
        [
          review("CHANGES_REQUESTED"),
          review("COMMENTED"),
          review("COMMENTED", "owner", head, `APPROVE RELEASE REVIEW ${head}`),
        ],
        "owner",
        head,
      ),
    ).toThrow("HOSTED_CHANGE_REQUEST_UNRESOLVED");
  });
  it("includes a later-page change request before accepting a first-page approval", () => {
    const reviews = hostedReviewsFromPages([[review("APPROVED")], [review("CHANGES_REQUESTED")]]);
    expect(() => hostedHumanReviewCounts(reviews, "owner", head)).toThrow(
      "HOSTED_CHANGE_REQUEST_UNRESOLVED",
    );
  });
  it("allows a later formal exact-head approval to resolve the same reviewer's earlier request", () => {
    const reviews = hostedReviewsFromPages([[review("CHANGES_REQUESTED")], [review("APPROVED")]]);
    expect(hostedHumanReviewCounts(reviews, "owner", head)).toEqual({ human: 1, independent: 1 });
  });
  it("rejects malformed review pages instead of omitting their decisions", () => {
    expect(() =>
      hostedReviewsFromPages([[review("APPROVED")], { state: "CHANGES_REQUESTED" }]),
    ).toThrow("HOSTED_REVIEW_HISTORY_INVALID");
  });
});
