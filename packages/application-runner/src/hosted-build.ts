import { createHash } from "node:crypto";
import { readdirSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { z } from "zod";
import { HostedBuildSchema } from "./hosted-contract";
export const HostedReviewedBuildRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    build: HostedBuildSchema,
    buildIdDigest: z.string().regex(/^[a-f0-9]{64}$/),
    qualityEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    pullRequests: z
      .array(z.url().regex(/^https:\/\/github\.com\/adeel1608\/applypilot\/pull\/[0-9]+$/))
      .min(1)
      .max(10),
    ciRuns: z
      .array(z.url().regex(/^https:\/\/github\.com\/adeel1608\/applypilot\/actions\/runs\/[0-9]+$/))
      .min(1)
      .max(10),
    repositoryPolicySatisfied: z.literal(true),
    humanReviewCount: z.number().int().min(1),
    independentReviewCount: z.number().int().nonnegative(),
    recordedAt: z.iso.datetime(),
  })
  .strict();
export const HostedQualityEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    head: z.string().regex(/^[a-f0-9]{40}$/),
    tree: z.string().regex(/^[a-f0-9]{40}$/),
    buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
    buildIdDigest: z.string().regex(/^[a-f0-9]{64}$/),
    command: z.literal("release:check:fixture"),
    exitCode: z.literal(0),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => Date.parse(value.completedAt) >= Date.parse(value.startedAt));

/** REST review pages are reduced to closed evidence fields; every page is required. */
export function hostedReviewsFromPages(pages: unknown) {
  const review = z.object({
    user: z.object({
      login: z.string().min(1).max(100),
      type: z.enum(["User", "Bot", "Organization"]),
    }),
    state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
    commit_id: z.string().regex(/^[a-f0-9]{40}$/),
    body: z
      .string()
      .max(65536)
      .nullable()
      .transform((value) => value ?? ""),
  });
  const result = z.array(z.array(review).max(100)).max(100).safeParse(pages);
  if (!result.success) throw new Error("HOSTED_REVIEW_HISTORY_INVALID");
  return result.data.flat();
}

/** An ancestor's approval does not review subsequent executable commits. */
export function assertHostedReviewedMergeHead(head: string, reviewedMergeHead: string): void {
  if (
    !/^[a-f0-9]{40}$/.test(head) ||
    !/^[a-f0-9]{40}$/.test(reviewedMergeHead) ||
    head !== reviewedMergeHead
  )
    throw new Error("HOSTED_EXACT_REVIEWED_MERGE_HEAD_REQUIRED");
}

/** Comments never clear a previous change request. Only exact-head human review evidence counts. */
export function hostedHumanReviewCounts(
  reviews: {
    user: { login: string; type: string };
    state: string;
    commit_id: string;
    body: string;
  }[],
  author: string,
  head: string,
): { human: number; independent: number } {
  const decisions = new Map<string, (typeof reviews)[number]>();
  const ownerComments = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
      decisions.set(review.user.login, review);
    if (review.state === "COMMENTED") ownerComments.set(review.user.login, review);
  }
  if ([...decisions.values()].some((review) => review.state === "CHANGES_REQUESTED"))
    throw new Error("HOSTED_CHANGE_REQUEST_UNRESOLVED");
  const approved = new Set(
    [...decisions.values()]
      .filter(
        (review) =>
          review.state === "APPROVED" && review.commit_id === head && review.user.type === "User",
      )
      .map((review) => review.user.login),
  );
  const owner = ownerComments.get(author);
  if (
    owner?.user.type === "User" &&
    owner.commit_id === head &&
    owner.body.trim() === `APPROVE RELEASE REVIEW ${head}`
  )
    approved.add(author);
  return {
    human: approved.size,
    independent: [...approved].filter((login) => login !== author).length,
  };
}

export function assertHostedPathWithoutLinks(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current).isSymbolicLink()) throw new Error("HOSTED_BUILD_INVALID");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** Exact production executable bytes; mutable caches, logs and type output are excluded. */
export function compiledHostedBuildDigest(nextRoot: string): string {
  assertHostedPathWithoutLinks(nextRoot);
  assertHostedPathWithoutLinks(join(nextRoot, "server"));
  const files: string[] = ["BUILD_ID", "routes-manifest.json", "prerender-manifest.json"];
  let entries = 0;
  const visit = (dir: string, depth: number) => {
    if (depth > 16) throw new Error("HOSTED_BUILD_INVALID");
    for (const name of readdirSync(dir).sort()) {
      if (++entries > 50000) throw new Error("HOSTED_BUILD_INVALID");
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("HOSTED_BUILD_INVALID");
      if (stat.isDirectory()) visit(path, depth + 1);
      else if (/\.(?:js|json)$/.test(name) && !name.endsWith(".nft.json"))
        files.push(relative(nextRoot, path));
      if (files.length > 10000) throw new Error("HOSTED_BUILD_INVALID");
    }
  };
  visit(join(nextRoot, "server"), 0);
  let bytes = 0;
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const path = join(nextRoot, file);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 100_000_000 ||
      (bytes += stat.size) > 500_000_000
    )
      throw new Error("HOSTED_BUILD_INVALID");
    hash
      .update(file.replaceAll("\\", "/"))
      .update("\0")
      .update(readFileSync(/* turbopackIgnore: true */ path))
      .update("\0");
  }
  return hash.digest("hex");
}

export function assertHostedQualityEvidence(
  qualityBytes: Uint8Array,
  nextRoot: string,
  head: string,
  tree: string,
): z.infer<typeof HostedQualityEvidenceSchema> {
  try {
    const evidence = HostedQualityEvidenceSchema.parse(
      JSON.parse(Buffer.from(qualityBytes).toString("utf8")),
    );
    if (
      evidence.head !== head ||
      evidence.tree !== tree ||
      createHash("sha256")
        .update(readFileSync(/* turbopackIgnore: true */ join(nextRoot, "BUILD_ID")))
        .digest("hex") !== evidence.buildIdDigest ||
      compiledHostedBuildDigest(nextRoot) !== evidence.buildDigest
    )
      throw new Error();
    return evidence;
  } catch {
    throw new Error("HOSTED_QUALITY_EVIDENCE_INVALID");
  }
}

export function assertHostedBuildEvidence(
  record: z.infer<typeof HostedReviewedBuildRecordSchema>,
  nextRoot: string,
  qualityBytes: Uint8Array,
): void {
  try {
    const evidence = assertHostedQualityEvidence(
      qualityBytes,
      nextRoot,
      record.build.head,
      record.build.tree,
    );
    if (
      evidence.buildDigest !== record.build.buildDigest ||
      evidence.buildIdDigest !== record.buildIdDigest ||
      createHash("sha256").update(qualityBytes).digest("hex") !== record.qualityEvidenceDigest
    )
      throw new Error();
  } catch {
    throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
  }
}
