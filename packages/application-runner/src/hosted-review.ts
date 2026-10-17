import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { hostedDigest } from "./hosted-contract";

export const HOSTED_AI_REVIEW_LABEL = "AI-AUTHORED TECHNICAL REVIEW UNDER OWNER-DELEGATED POLICY";
export const HOSTED_REVIEW_SCOPE = "LOCAL_PERSONAL_IMPLEMENTATION_AND_TECHNICAL_ROLLOUT";
export const HOSTED_REVIEW_REPOSITORY = "adeel1608/applypilot";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const text = z.string().min(1).max(2000);
const pathSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9_.@/-]+$/)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.split("/").some((part) => ["", ".", "..", ".git"].includes(part)) &&
      !path.startsWith("data/private/"),
  );
export const OwnerDelegatedReviewPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.literal("owner-delegated-ai-review-v1"),
    repository: z.literal(HOSTED_REVIEW_REPOSITORY),
    scope: z.literal(HOSTED_REVIEW_SCOPE),
    scopeBase: z.literal("ad61cbaf2327d99547306801e3d22d0cba4717c1"),
    delegationReference: z.literal("owner-delegation-2026-10-17"),
    trustedReviewPublisher: z.literal("adeel1608"),
    requiredHumanImplementationReviews: z.literal(0),
    requiredAiReviewPasses: z.literal(2),
    independentHumanReviewRequired: z.literal(false),
    requirePassingQualityEvidence: z.literal(true),
    requireExactReviewedCodeCoverage: z.literal(true),
    requireNoBlockingFindings: z.literal(true),
    operationalOwnerConsentsUnchanged: z.literal(true),
  })
  .strict();
export const OwnerReviewDelegationSchema = z
  .object({
    schemaVersion: z.literal(1),
    reference: z.literal("owner-delegation-2026-10-17"),
    policyId: z.literal("owner-delegated-ai-review-v1"),
    repository: z.literal(HOSTED_REVIEW_REPOSITORY),
    scope: z.literal(HOSTED_REVIEW_SCOPE),
    decisionDate: z.literal("2026-10-17"),
    decision: z.literal("DELEGATE_TECHNICAL_REVIEW_TO_AI"),
    sourceKind: z.literal("OWNER_REQUEST_IN_CURRENT_CONVERSATION"),
    sourceSha256: z.literal("b69d98257e80c653a269c6798d73b46f1be0bf307924400f00d18bafc85bdaa8"),
    instruction: z.string().min(100).max(1000),
    historicalHumanReviewClaim: z.literal(false),
  })
  .strict();
export const HostedReviewFileSchema = z
  .object({ path: pathSchema, sha256: sha.nullable() })
  .strict();
const coverageSchema = HostedReviewFileSchema.extend({
  readMode: z.enum([
    "FULL_SOURCE",
    "CHANGED_CODE_AND_COMPLETE_CRITICAL_FUNCTIONS",
    "CHANGED_DOCUMENT_SECTIONS",
    "LOCKFILE_PACKAGE_INTEGRITY",
  ]),
  functions: z.array(z.string().min(1).max(200)).max(100),
}).strict();
export const HOSTED_REVIEW_AREAS = [
  "SOURCE_DIAGNOSTICS",
  "EXACT_SOURCE_CONSENT",
  "PROVENANCE_CURRENTNESS",
  "QUESTIONS_PACKET_FACTS",
  "BROWSER_NETWORK",
  "MAPPING_DISCLOSURE_FILES",
  "CLAIMS_RECOVERY",
  "PREVIEW_SUBMIT_OUTCOME",
  "MIGRATION_PRESERVATION",
  "BUILD_RELEASE",
  "REVIEW_POLICY",
] as const;
export const HostedAiReviewReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.literal("owner-delegated-ai-review-v1"),
    policyDigest: sha,
    delegationDigest: sha,
    repository: z.literal(HOSTED_REVIEW_REPOSITORY),
    scope: z.literal(HOSTED_REVIEW_SCOPE),
    reviewerKind: z.literal("AI"),
    reviewId: z.uuid(),
    purpose: z.enum(["IMPLEMENTATION_CORRECTNESS", "ADVERSARIAL_SECURITY_PRIVACY_RECOVERY"]),
    executionMode: z.enum(["PRIMARY_AGENT", "SEPARATE_READ_ONLY_AGENT", "SAME_AGENT_SECOND_PASS"]),
    executionId: z.string().min(3).max(200),
    priorPassId: z.uuid().nullable(),
    modelIdentity: z.literal("UNKNOWN"),
    independentHumanReview: z.literal(false),
    reviewedBase: commit,
    reviewedHead: commit,
    reviewedTree: commit,
    completedAt: z.iso.datetime(),
    coverage: z.array(coverageSchema).min(1).max(600),
    coverageDigest: sha,
    areas: z
      .array(
        z
          .object({
            area: z.enum(HOSTED_REVIEW_AREAS),
            rationale: z.string().min(40).max(2000),
            evidence: z.array(pathSchema).min(1).max(30),
          })
          .strict(),
      )
      .length(HOSTED_REVIEW_AREAS.length),
    findings: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
            blocking: z.boolean(),
            location: text,
            evidence: text,
            impact: text,
            disposition: z.enum(["OPEN", "RESOLVED", "ACCEPTED_NONBLOCKING"]),
            resolution: text,
          })
          .strict(),
      )
      .max(100),
    validationReferences: z.array(text).min(1).max(40),
    rationale: z.string().min(100).max(5000),
    decision: z.enum(["PASS", "CHANGES_REQUIRED"]),
  })
  .strict();
export type HostedAiReviewReport = z.infer<typeof HostedAiReviewReportSchema>;
export const HostedRetrievedAiReviewSchema = z
  .object({
    id: z.number().int().positive(),
    url: z
      .url()
      .regex(/^https:\/\/github\.com\/adeel1608\/applypilot\/pull\/\d+#pullrequestreview-\d+$/),
    state: z.literal("COMMENTED"),
    commit: commit,
    submittedAt: z.iso.datetime(),
    author: z.literal("adeel1608"),
    body: z.string().min(100).max(65536),
    bodyDigest: sha,
  })
  .strict();
export const HostedAiReviewEvidenceSchema = z
  .object({
    policy: OwnerDelegatedReviewPolicySchema,
    delegation: OwnerReviewDelegationSchema,
    policyDigest: sha,
    delegationDigest: sha,
    releasePr: z.number().int().positive(),
    reviewedHead: commit,
    reviewedTree: commit,
    mergeHead: commit,
    mergeTree: commit,
    files: z.array(HostedReviewFileSchema).min(1).max(600),
    filesDigest: sha,
    reports: z.array(HostedRetrievedAiReviewSchema).length(2),
    reviewHistory: z.array(HostedRetrievedAiReviewSchema).min(2).max(100),
    aiReviewPassCount: z.literal(2),
    humanReviewCount: z.literal(0),
    independentHumanReviewCount: z.literal(0),
  })
  .strict();
export type HostedAiReviewEvidence = z.infer<typeof HostedAiReviewEvidenceSchema>;
export function hostedReviewBytesDigest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function git(root: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: root,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 8_000_000,
  });
}
export function hostedReviewGit(root: string, ...args: string[]): string {
  return git(root, args).toString("utf8").trim();
}
function noLinks(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current).isSymbolicLink()) throw new Error("HOSTED_REVIEW_POLICY_INVALID");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export function readHostedReviewPolicy(root: string) {
  const policyPath = join(root, "config/owner-delegated-review-policy.json");
  const delegationPath = join(root, "config/owner-review-delegation.json");
  noLinks(policyPath);
  noLinks(delegationPath);
  const policy = OwnerDelegatedReviewPolicySchema.parse(
    JSON.parse(readFileSync(policyPath, "utf8")),
  );
  const delegation = OwnerReviewDelegationSchema.parse(
    JSON.parse(readFileSync(delegationPath, "utf8")),
  );
  return {
    policy,
    delegation,
    policyDigest: hostedDigest(policy),
    delegationDigest: hostedDigest(delegation),
  };
}
/** Coverage is computed from Git blobs, not counters or platform-dependent CRLF bytes. */
export function hostedReviewFiles(root: string, base: string, head: string) {
  commit.parse(base);
  commit.parse(head);
  hostedReviewGit(root, "merge-base", "--is-ancestor", base, head);
  const entries = git(root, ["diff", "--name-status", "--no-renames", "-z", base, head])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (entries.length === 0 || entries.length > 1200 || entries.length % 2 !== 0)
    throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
  const files: z.infer<typeof HostedReviewFileSchema>[] = [];
  for (let i = 0; i < entries.length; i += 2) {
    const status = entries[i]!,
      path = pathSchema.parse(entries[i + 1]);
    if (!["A", "M", "D", "T"].includes(status)) throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
    files.push({ path, sha256: status === "D" ? null : "" });
  }
  const present = files.filter((file) => file.sha256 !== null);
  if (present.length) {
    const tree = git(root, ["ls-tree", "-r", "-z", head, "--", ...present.map((file) => file.path)])
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    if (
      tree.length !== present.length ||
      tree.some((entry) => !/^100(?:644|755) blob [a-f0-9]{40,64}\t/.test(entry))
    )
      throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
    const batch = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16_000_000,
      input: present.map((file) => `${head}:${file.path}\n`).join(""),
    });
    let offset = 0;
    for (const file of present) {
      const end = batch.indexOf(10, offset),
        header = batch.subarray(offset, end).toString("utf8");
      const match = /^[a-f0-9]{40,64} blob (\d+)$/.exec(header);
      if (end < offset || !match) throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
      const size = Number(match[1]);
      offset = end + 1;
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > 8_000_000 ||
        offset + size >= batch.length ||
        batch[offset + size] !== 10
      )
        throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
      file.sha256 = hostedReviewBytesDigest(batch.subarray(offset, offset + size));
      offset += size + 1;
    }
    if (offset !== batch.length) throw new Error("HOSTED_REVIEW_SCOPE_INVALID");
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function parseHostedAiReviewBody(body: string): HostedAiReviewReport {
  if (!body.startsWith(`${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n`) || !body.endsWith("\n```"))
    throw new Error("HOSTED_AI_REVIEW_REPORT_INVALID");
  const json = body.slice(`${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n`.length, -4);
  return HostedAiReviewReportSchema.parse(JSON.parse(json));
}
export function formatHostedAiReviewBody(report: HostedAiReviewReport): string {
  return `${HOSTED_AI_REVIEW_LABEL}\n\n\`\`\`json\n${JSON.stringify(HostedAiReviewReportSchema.parse(report), null, 2)}\n\`\`\``;
}
/** Only retrieved submitted review objects are accepted; conversation comments are a different API. */
export function retrievedHostedAiReviews(pages: unknown, pr: number) {
  const raw = z
    .array(
      z
        .array(
          z.object({
            id: z.number().int().positive(),
            html_url: z.string(),
            state: z.string(),
            commit_id: commit,
            submitted_at: z.string().nullable(),
            body: z.string().nullable(),
            user: z.object({ login: z.string() }),
          }),
        )
        .max(100),
    )
    .max(100)
    .parse(pages)
    .flat();
  return raw
    .filter(
      (review) =>
        review.body?.startsWith(HOSTED_AI_REVIEW_LABEL) &&
        review.state === "COMMENTED" &&
        review.user.login === "adeel1608",
    )
    .map((review) => {
      if (
        review.html_url !==
        `https://github.com/${HOSTED_REVIEW_REPOSITORY}/pull/${pr}#pullrequestreview-${review.id}`
      )
        throw new Error("HOSTED_AI_REVIEW_REFERENCE_INVALID");
      return HostedRetrievedAiReviewSchema.parse({
        id: review.id,
        url: review.html_url,
        state: review.state,
        commit: review.commit_id,
        submittedAt: review.submitted_at,
        author: review.user.login,
        body: review.body,
        bodyDigest: hostedReviewBytesDigest(review.body ?? ""),
      });
    });
}
/** A selected old PASS cannot hide a later adverse review or an unresolved earlier finding. */
export function effectiveHostedAiReviews(
  historyInput: unknown,
  head: string,
  now = new Date(),
  releasePr?: number,
) {
  const parsedHistory = z
    .array(HostedRetrievedAiReviewSchema)
    .min(2)
    .max(100)
    .safeParse(historyInput);
  if (!parsedHistory.success) throw new Error("HOSTED_AI_REVIEW_REPORTS_REQUIRED");
  const history = parsedHistory.data.sort(
    (a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id - b.id,
  );
  const ids = new Set<number>(),
    latest = new Map<string, z.infer<typeof HostedRetrievedAiReviewSchema>>();
  const open = new Map<string, HostedAiReviewReport["findings"][number]>();
  for (const retrieved of history) {
    if (
      (releasePr &&
        retrieved.url !==
          `https://github.com/${HOSTED_REVIEW_REPOSITORY}/pull/${releasePr}#pullrequestreview-${retrieved.id}`) ||
      ids.has(retrieved.id) ||
      retrieved.bodyDigest !== hostedReviewBytesDigest(retrieved.body) ||
      Date.parse(retrieved.submittedAt) > now.getTime()
    )
      throw new Error("HOSTED_AI_REVIEW_HISTORY_INVALID");
    ids.add(retrieved.id);
    const report = parseHostedAiReviewBody(retrieved.body);
    if (
      report.reviewedHead !== retrieved.commit ||
      Date.parse(report.completedAt) > Date.parse(retrieved.submittedAt)
    )
      throw new Error("HOSTED_AI_REVIEW_HISTORY_INVALID");
    for (const finding of report.findings) {
      if (finding.disposition === "RESOLVED") open.delete(finding.id);
      else if (finding.blocking || ["CRITICAL", "HIGH"].includes(finding.severity))
        open.set(finding.id, finding);
    }
    if (retrieved.commit === head) latest.set(report.purpose, retrieved);
  }
  if (open.size) throw new Error("HOSTED_AI_REVIEW_FINDINGS_UNRESOLVED");
  const reports = [
    latest.get("IMPLEMENTATION_CORRECTNESS"),
    latest.get("ADVERSARIAL_SECURITY_PRIVACY_RECOVERY"),
  ];
  if (reports.some((report) => !report)) throw new Error("HOSTED_AI_REVIEW_REPORTS_REQUIRED");
  for (const report of reports) {
    if (parseHostedAiReviewBody(report!.body).decision !== "PASS")
      throw new Error("HOSTED_AI_REVIEW_CHANGES_REQUIRED");
  }
  return reports as z.infer<typeof HostedRetrievedAiReviewSchema>[];
}
/** Unsigned local evidence proves consistency, not independent authorship or human approval. */
export function assertHostedAiReviewEvidence(
  evidenceInput: unknown,
  expected: {
    head: string;
    tree: string;
    reviewedHead: string;
    policy: unknown;
    delegation: unknown;
    files: unknown;
    now?: Date;
  },
) {
  try {
    const evidence = HostedAiReviewEvidenceSchema.parse(evidenceInput);
    const policy = OwnerDelegatedReviewPolicySchema.parse(expected.policy);
    const delegation = OwnerReviewDelegationSchema.parse(expected.delegation);
    const files = z.array(HostedReviewFileSchema).min(1).max(600).parse(expected.files);
    if (
      evidence.mergeHead !== expected.head ||
      evidence.mergeTree !== expected.tree ||
      evidence.reviewedTree !== expected.tree ||
      evidence.reviewedHead !== expected.reviewedHead ||
      evidence.policyDigest !== hostedDigest(policy) ||
      evidence.delegationDigest !== hostedDigest(delegation) ||
      hostedDigest(evidence.policy) !== hostedDigest(policy) ||
      hostedDigest(evidence.delegation) !== hostedDigest(delegation) ||
      policy.delegationReference !== delegation.reference ||
      evidence.filesDigest !== hostedDigest(files) ||
      hostedDigest(evidence.files) !== hostedDigest(files)
    )
      throw new Error();
    if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error();
    const effective = effectiveHostedAiReviews(
      evidence.reviewHistory,
      evidence.reviewedHead,
      expected.now,
      evidence.releasePr,
    );
    if (hostedDigest(effective) !== hostedDigest(evidence.reports)) throw new Error();
    const purposes = new Set<string>(),
      ids = new Set<string>(),
      references = new Set<number>();
    const parsed = evidence.reports.map((retrieved) => {
      if (
        retrieved.author !== policy.trustedReviewPublisher ||
        references.has(retrieved.id) ||
        retrieved.url !==
          `https://github.com/${HOSTED_REVIEW_REPOSITORY}/pull/${evidence.releasePr}#pullrequestreview-${retrieved.id}` ||
        retrieved.commit !== evidence.reviewedHead ||
        retrieved.bodyDigest !== hostedReviewBytesDigest(retrieved.body)
      )
        throw new Error();
      references.add(retrieved.id);
      const report = parseHostedAiReviewBody(retrieved.body);
      if (
        ids.has(report.reviewId) ||
        purposes.has(report.purpose) ||
        report.reviewedBase !== policy.scopeBase ||
        report.reviewedHead !== evidence.reviewedHead ||
        report.reviewedTree !== evidence.reviewedTree ||
        report.policyDigest !== evidence.policyDigest ||
        report.delegationDigest !== evidence.delegationDigest ||
        report.decision !== "PASS" ||
        Date.parse(report.completedAt) > Date.parse(retrieved.submittedAt) ||
        Date.parse(retrieved.submittedAt) > (expected.now ?? new Date()).getTime()
      )
        throw new Error();
      ids.add(report.reviewId);
      purposes.add(report.purpose);
      const coverage = report.coverage.map(({ path, sha256 }) => ({ path, sha256 }));
      if (
        hostedDigest(coverage) !== evidence.filesDigest ||
        report.coverageDigest !== hostedDigest(report.coverage)
      )
        throw new Error();
      for (const file of report.coverage) {
        if (
          /\.(?:[cm]?[jt]sx?|sql)$/.test(file.path) &&
          file.readMode !== "FULL_SOURCE" &&
          !(
            file.readMode === "CHANGED_CODE_AND_COMPLETE_CRITICAL_FUNCTIONS" &&
            file.functions.length > 0
          )
        )
          throw new Error();
        if (file.path === "package-lock.json" && file.readMode !== "LOCKFILE_PACKAGE_INTEGRITY")
          throw new Error();
      }
      if (
        new Set(report.areas.map((area) => area.area)).size !== HOSTED_REVIEW_AREAS.length ||
        report.areas.some((area) =>
          area.evidence.some((path) => !files.some((file) => file.path === path)),
        )
      )
        throw new Error();
      if (
        new Set(report.findings.map((finding) => finding.id)).size !== report.findings.length ||
        report.findings.some(
          (finding) =>
            (finding.blocking || ["CRITICAL", "HIGH"].includes(finding.severity)) &&
            finding.disposition !== "RESOLVED",
        )
      )
        throw new Error();
      return report;
    });
    if (
      !purposes.has("IMPLEMENTATION_CORRECTNESS") ||
      !purposes.has("ADVERSARIAL_SECURITY_PRIVACY_RECOVERY")
    )
      throw new Error();
    const first = parsed.find((report) => report.purpose === "IMPLEMENTATION_CORRECTNESS")!;
    const second = parsed.find(
      (report) => report.purpose === "ADVERSARIAL_SECURITY_PRIVACY_RECOVERY",
    )!;
    if (first.executionMode === "SAME_AGENT_SECOND_PASS" || first.priorPassId !== null)
      throw new Error();
    if (second.executionMode === "SAME_AGENT_SECOND_PASS") {
      if (second.executionId !== first.executionId || second.priorPassId !== first.reviewId)
        throw new Error();
    } else if (
      second.executionMode !== "SEPARATE_READ_ONLY_AGENT" ||
      second.executionId === first.executionId ||
      second.priorPassId !== null
    )
      throw new Error();
    return evidence;
  } catch {
    throw new Error("HOSTED_AI_REVIEW_EVIDENCE_INVALID");
  }
}
export function assertHostedAiReviewAtCheckout(
  evidence: HostedAiReviewEvidence,
  root: string,
  head: string,
  tree: string,
): void {
  const policy = readHostedReviewPolicy(root);
  if (
    hostedReviewGit(root, "rev-parse", "HEAD") !== head ||
    hostedReviewGit(root, "rev-parse", `${head}^{tree}`) !== tree ||
    hostedReviewGit(root, "rev-parse", `${evidence.reviewedHead}^{tree}`) !== tree ||
    hostedReviewGit(root, "status", "--porcelain").length
  )
    throw new Error("HOSTED_AI_REVIEW_EVIDENCE_INVALID");
  assertHostedAiReviewEvidence(evidence, {
    head,
    tree,
    reviewedHead: evidence.reviewedHead,
    ...policy,
    files: hostedReviewFiles(root, policy.policy.scopeBase, head),
  });
}
