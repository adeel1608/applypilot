import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import {
  hostedDigest,
  HostedReviewedBuildRecordSchema,
  assertHostedBuildEvidence,
  assertHostedQualityEvidence,
} from "@applypilot/application-runner";
import {
  R2_FIT_SCORER_VERSION,
  R2_FIT_WEIGHT_VERSION,
  R2_GOLDEN_CORPUS_VERSION,
} from "@applypilot/fit-scorer";
export const PERSONAL_LIVE_CRITERIA = [
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "R6",
  "R11",
  "FULL_MATRIX",
] as const;
const decisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    head: z.string().regex(/^[a-f0-9]{40}$/),
    tree: z.string().regex(/^[a-f0-9]{40}$/),
    criteria: z.record(
      z.enum(PERSONAL_LIVE_CRITERIA),
      z
        .object({
          state: z.enum(["ACCEPTED", "BLOCKED"]),
          evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    action: z.literal("PERSONAL_LIVE_V1_OWNER_RELEASE"),
    ownerApprovalId: z.string().min(8).max(200),
    approvedAt: z.iso.datetime(),
  })
  .strict();
export function evaluatePersonalLiveV1(input: {
  head: string;
  tree: string;
  implementationReviewed: boolean;
  qualityProven: boolean;
  sourceProven: boolean;
  matchingQualified: boolean;
  realJourneyProven: boolean;
  databaseHealthy: boolean;
  unresolvedOperations: number;
  ownerDecision?: unknown;
}) {
  const blockers: string[] = [];
  if (!input.implementationReviewed) blockers.push("REVIEWED_ROLLOUT_REQUIRED");
  if (!input.qualityProven) blockers.push("FULL_RELEASE_MATRIX_REQUIRED");
  if (!input.databaseHealthy) blockers.push("DATABASE_HEALTH_REQUIRED");
  if (!input.sourceProven) blockers.push("R1_APPROVED_DISCOVERY_EVIDENCE_REQUIRED");
  if (!input.matchingQualified) blockers.push("R2_PRIVATE_QUALIFICATION_REQUIRED");
  if (!input.realJourneyProven) blockers.push("R4_R5_R6_CURRENT_REAL_JOURNEY_REQUIRED");
  if (input.unresolvedOperations > 0) blockers.push("UNRESOLVED_OPERATION_OUTCOME");
  const owner = decisionSchema.safeParse(input.ownerDecision);
  if (!owner.success || owner.data.head !== input.head || owner.data.tree !== input.tree)
    blockers.push("PERSONAL_LIVE_V1_OWNER_RELEASE_REQUIRED");
  else
    for (const criterion of PERSONAL_LIVE_CRITERIA)
      if (owner.data.criteria[criterion].state !== "ACCEPTED")
        blockers.push(`${criterion}_OWNER_ACCEPTANCE_REQUIRED`);
  return {
    state: blockers.length ? ("NOT_READY" as const) : ("PERSONAL_LIVE_V1_READY" as const),
    blockers,
    criteria: PERSONAL_LIVE_CRITERIA,
    decisionDigest: owner.success ? hostedDigest(owner.data) : null,
  };
}
/** Read-only official R0-R6/R11/full-matrix evaluation; fixtures cannot become a real release. */
export function personalLiveV1Readiness(
  root: string,
  sqlite: BetterSqlite3.Database | null,
  head: string,
  tree: string,
  databaseHealthy: boolean,
) {
  let reviewed = false,
    quality = false,
    owner: unknown;
  try {
    assertHostedQualityEvidence(
      readFileSync(join(root, "data", "private", "runtime", "hosted-quality-evidence.json")),
      join(root, "apps", "web", ".next"),
      head,
      tree,
    );
    quality =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 3000,
      }).trim().length === 0;
  } catch {
    /* Actual offline proof is separate from implementation review. */
  }
  try {
    const record = HostedReviewedBuildRecordSchema.parse(
      JSON.parse(
        readFileSync(
          join(root, "data", "private", "runtime", "hosted-reviewed-build.json"),
          "utf8",
        ),
      ),
    );
    const q = readFileSync(
      join(root, "data", "private", "runtime", "hosted-quality-evidence.json"),
    );
    assertHostedBuildEvidence(record, join(root, "apps", "web", ".next"), q);
    reviewed = quality && record.build.head === head && record.build.tree === tree;
  } catch {
    /* Missing or invalid reviewed executable/quality evidence stays unproven. */
  }
  try {
    owner = JSON.parse(
      readFileSync(join(root, "data", "private", "personal-live-v1-owner-release.json"), "utf8"),
    );
  } catch {
    /* Missing or invalid owner evidence stays unknown. */
  }
  const has = (name: string) =>
    Boolean(sqlite?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  let source = false,
    matching = false,
    journey = false,
    unresolved = 0;
  if (sqlite) {
    if (has("source_run_owner_bindings"))
      source =
        Number(
          sqlite
            .prepare(
              `SELECT count(*) FROM source_run_checkpoints r
               JOIN source_run_owner_bindings b ON b.run_id=r.id
               JOIN source_record_verifications v ON v.run_id=r.id
               JOIN source_owner_action_receipts a ON a.id=b.approval_receipt_id
               JOIN source_owner_action_receipts s ON s.id=b.start_receipt_id
               WHERE r.status='COMPLETE' AND v.qualification_state='QUALIFIED'
               AND a.action='APPROVE' AND s.action='START' AND a.state='CONSUMED' AND s.state='CONSUMED'
               AND s.predecessor_receipt_id=a.id AND a.capability_version_id=s.capability_version_id
               AND a.capability_digest=b.capability_digest AND s.capability_digest=b.capability_digest
               AND s.operation=b.operation AND b.operation=r.operation`,
            )
            .pluck()
            .get(),
        ) > 0;
    if (has("r2_calibration_qualifications"))
      matching =
        Number(
          sqlite
            .prepare(
              "SELECT count(*) FROM r2_calibration_qualifications q JOIN r2_calibration_runs r ON r.id=q.run_id WHERE r.state='CALIBRATED' AND r.scorer_version=? AND r.weight_version=? AND r.corpus_version=? AND q.owner_approval_id IS NOT NULL AND q.owner_approved_at IS NOT NULL AND q.performance_threshold_version IS NOT NULL AND q.safety_gate_version IS NOT NULL AND q.compared_label_count>0 AND q.compared_pair_count>0 AND json_array_length(q.blocker_codes_json)=0",
            )
            .pluck()
            .get(R2_FIT_SCORER_VERSION, R2_FIT_WEIGHT_VERSION, R2_GOLDEN_CORPUS_VERSION),
        ) > 0;
    if (has("hosted_browser_sessions")) {
      journey =
        Number(
          sqlite
            .prepare(
              `SELECT count(*) FROM hosted_browser_sessions s
               JOIN hosted_capability_versions c ON c.id=s.capability_version_id
               JOIN hosted_final_consents f ON f.session_id=s.id
               JOIN hosted_submit_guards g ON g.session_id=s.id
               JOIN hosted_operation_claims o ON o.id=g.claim_id AND o.session_id=s.id
               JOIN candidate_profiles cp ON cp.active_version_id=json_extract(c.capability_json,'$.subject.profileVersionId')
               JOIN job_versions jv ON jv.id=json_extract(c.capability_json,'$.subject.jobVersionId')
               WHERE c.mode='REAL' AND g.mode='REAL' AND s.state='CONFIRMED_SUBMITTED'
               AND s.confirmation_digest IS NOT NULL AND o.operation='SUBMIT' AND o.state='COMPLETE'
               AND s.disclosure_consent_id IS NOT NULL AND s.preview_json IS NOT NULL
               AND jv.version=(SELECT max(version) FROM job_versions WHERE job_id=jv.job_id)
               AND (SELECT count(*) FROM hosted_operation_claims WHERE session_id=s.id AND state='COMPLETE')=7
               AND json_extract(c.capability_json,'$.build.head')=? AND json_extract(c.capability_json,'$.build.tree')=?`,
            )
            .pluck()
            .get(head, tree),
        ) > 0;
      unresolved += Number(
        sqlite
          .prepare(
            "SELECT count(*) FROM hosted_browser_sessions WHERE state IN ('INSPECTING','INSPECTED','MAPPED','FILLED','UPLOADED','VERIFIED','REVIEW_READY','OUTCOME_UNKNOWN')",
          )
          .pluck()
          .get(),
      );
    }
    if (has("source_run_checkpoints"))
      unresolved += Number(
        sqlite
          .prepare("SELECT count(*) FROM source_run_checkpoints WHERE status='RUNNING'")
          .pluck()
          .get(),
      );
    if (has("application_run_operations"))
      unresolved += Number(
        sqlite
          .prepare(
            "SELECT count(*) FROM application_run_operations WHERE state IN ('CLAIMED','OUTCOME_UNKNOWN')",
          )
          .pluck()
          .get(),
      );
  }
  if (process.env.APPLYPILOT_SYNTHETIC_MODE === "1") {
    reviewed = false;
    quality = false;
    source = false;
    matching = false;
    journey = false;
    owner = undefined;
  }
  return evaluatePersonalLiveV1({
    head,
    tree,
    implementationReviewed: reviewed,
    qualityProven: quality,
    sourceProven: source,
    matchingQualified: matching,
    realJourneyProven: journey,
    databaseHealthy,
    unresolvedOperations: unresolved,
    ownerDecision: owner,
  });
}
