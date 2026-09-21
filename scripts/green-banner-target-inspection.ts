import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  ApplicationPacketSchema,
  LEVER_APPLICATION_INSPECTION_FORM_VERSION,
  LEVER_REAL_INSPECTION_ADAPTER_VERSION,
  deriveDuplicatePacketState,
  deriveJobExpiryState,
  deriveNextRunnerTargetCapability,
  deriveGreenBannerChildCapability,
  freezeInspectionBinding,
  packetDigest,
  runnerTargetCapabilityDigest,
  runnerTargetCapabilityIdentity,
  runLeverInspectionInFreshBrowser,
  type RunnerTargetCapability,
} from "@applypilot/application-runner";
import {
  BetaRepository,
  GreenBannerGrantRepository,
  RunnerEnablementRepository,
  openApplyPilotDatabase,
} from "@applypilot/database";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const JOB_ID = "source-job-2a28f2764def648964221b971f7e7546";
const EXTERNAL_ID = "2cfe6692-a266-4d27-8832-ef652fa57ee4";
const TARGET_URL = `https://jobs.lever.co/shieldai/${EXTERNAL_ID}/apply`;
const TARGET_PATH = `/shieldai/${EXTERNAL_ID}/apply`;
const TARGET_CHILD_ID = "green_target_cv_inspection_227df70";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mainSha(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const database = openApplyPilotDatabase(localDatabasePath());
  const now = () => new Date();
  let runnerCapability: RunnerTargetCapability | null = null;
  let childCreated = false;
  let childId = TARGET_CHILD_ID;
  let targetIdentity: Parameters<typeof runnerTargetCapabilityIdentity>[0] | null = null;
  let runnerTerminalized = false;
  const grants = new GreenBannerGrantRepository(database.sqlite, now);
  try {
    const sqlite = database.sqlite;
    const parent = grants.getParentGrant();
    const currentSha = mainSha(root);
    if (parent.mainSha !== currentSha) throw new Error("GREEN_BANNER_MAIN_SHA_MISMATCH");
    if (grants.latestParentState(parent.grantId) !== "ACTIVE")
      throw new Error("GREEN_BANNER_PARENT_NOT_ACTIVE");
    if (EXTERNAL_ID === "ec27312c-b829-42fb-9a1f-e5733b38b0c1")
      throw new Error("VALIDATION_TARGET_FORBIDDEN");

    const source = sqlite
      .prepare(
        `SELECT j.normalized_json AS normalizedJson,o.run_id AS runId,o.expires_at AS expiresAt
         FROM jobs j JOIN source_observations o ON o.job_id=j.id
         WHERE j.id=? AND o.external_id=? ORDER BY o.observed_at DESC LIMIT 1`,
      )
      .get(JOB_ID, EXTERNAL_ID) as
      | { normalizedJson: string; runId: string; expiresAt: string | null }
      | undefined;
    if (!source) throw new Error("TARGET_SOURCE_BINDING_NOT_FOUND");
    const job = JSON.parse(source.normalizedJson) as {
      title: string;
      company: string;
      sourceMetadata?: { applicationUrl?: string | null };
    };
    if (job.sourceMetadata?.applicationUrl !== TARGET_URL)
      throw new Error("TARGET_URL_BINDING_MISMATCH");
    const jobVersionId = sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(JOB_ID) as string | undefined;
    const profileVersionId = sqlite
      .prepare("SELECT active_version_id FROM candidate_profiles ORDER BY created_at LIMIT 1")
      .pluck()
      .get() as string | undefined;
    const evaluation = sqlite
      .prepare(
        `SELECT id,eligibility_status AS eligibilityStatus FROM evaluation_versions
         WHERE job_id=? AND job_version_id=? AND profile_version_id=? AND stale=0
         ORDER BY evaluated_at DESC,rowid DESC LIMIT 1`,
      )
      .get(JOB_ID, jobVersionId, profileVersionId) as
      | { id: string; eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED" }
      | undefined;
    if (!jobVersionId || !profileVersionId || !evaluation)
      throw new Error("CURRENT_INSPECTION_VERSIONS_REQUIRED");

    const beta = new BetaRepository(sqlite, now);
    const document = sqlite
      .prepare(
        `SELECT d.id,d.type,d.file_name AS fileName,d.content_digest AS digest,
                d.stale,EXISTS(SELECT 1 FROM document_approvals a
                  WHERE a.document_artifact_id=d.id AND a.content_digest=d.content_digest
                    AND a.invalidated_at IS NULL) AS approved
         FROM document_artifacts d WHERE d.job_id=? AND d.type='CV' AND d.format='PDF'
         ORDER BY d.version DESC LIMIT 1`,
      )
      .get(JOB_ID) as
      | {
          id: string;
          type: "CV";
          fileName: string;
          digest: string;
          stale: number;
          approved: number;
        }
      | undefined;
    if (!document || document.stale) throw new Error("CURRENT_CV_REQUIRED");
    beta.approveDocument({ documentArtifactId: document.id, contentDigest: document.digest });
    const packet = ApplicationPacketSchema.parse({
      id: `inspection_packet_${sha256(`${jobVersionId}|${profileVersionId}|${evaluation.id}|${TARGET_URL}`).slice(0, 24)}`,
      jobId: JOB_ID,
      jobVersionId,
      profileVersionId,
      evaluationVersionId: evaluation.id,
      eligibilityStatus: evaluation.eligibilityStatus,
      targetUrl: TARGET_URL,
      targetHost: "jobs.lever.co",
      jobExpiryState: deriveJobExpiryState(source.expiresAt),
      duplicateState: deriveDuplicatePacketState([]),
      versionsCurrent: true,
      documents: [
        {
          id: document.id,
          type: document.type,
          fileName: document.fileName,
          digest: document.digest,
          approved: true,
          stale: false,
          required: true,
        },
      ],
      answers: [],
    });
    beta.persistApplicationPacket(packet);
    const pDigest = packetDigest(packet);
    const identity = {
      targetKind: "REAL_TARGET" as const,
      allowedOrigin: "https://jobs.lever.co",
      allowedPathPrefix: TARGET_PATH,
      operation: "OPEN_AND_INSPECT_ONLY" as const,
      formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
      adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
      packetDigest: pDigest,
    };
    targetIdentity = identity;
    const createdAt = now().toISOString();
    const child = deriveGreenBannerChildCapability({
      parent,
      now: now(),
      child: {
        schemaVersion: 1,
        childId: TARGET_CHILD_ID,
        childType: "TARGET",
        operation: "OPEN_AND_INSPECT_ONLY",
        provider: null,
        tenant: null,
        allowedHost: null,
        allowedPathPrefix: null,
        targetOrigin: "https://jobs.lever.co",
        targetPath: TARGET_PATH,
        packetDigest: pDigest,
        adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
        formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
        documentDigest: document.digest,
        answersDigest: sha256("[]"),
        disclosuresDigest: sha256("[]"),
        mainSha: currentSha,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString(),
      },
    });
    grants.persistChildCapability(child);
    childCreated = true;
    childId = child.childId;
    runnerCapability = deriveNextRunnerTargetCapability({
      previous: null,
      identity,
      lifecycle: {
        alias: `${job.company} ${job.title} read-only inspection`,
        approvalState: "APPROVED",
        approvalReference: parent.grantId,
        approvedAt: createdAt,
        policyVersion: "real-target-inspection-v1",
        policyExpiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
        capabilityExpiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString(),
        revokedAt: null,
      },
    });
    const runnerRepository = new RunnerEnablementRepository(sqlite, now);
    runnerRepository.persistTargetCapabilityVersion(runnerCapability, identity);
    const binding = freezeInspectionBinding(packet, runnerCapability);
    const runId = `inspection_${randomUUID()}`;
    runnerRepository.bindInspection({ runId, binding, targetCapability: runnerCapability });
    const result = await runLeverInspectionInFreshBrowser({
      capability: runnerCapability,
      binding,
      currentBinding: () => runnerRepository.currentInspectionBinding(runId),
      audit: (record) => runnerRepository.recordInspectionAudit(runId, record),
    });
    const terminalAt = now().toISOString();
    const revoked = deriveNextRunnerTargetCapability({
      previous: runnerCapability,
      identity,
      lifecycle: {
        alias: runnerCapability.alias,
        approvalState: "REVOKED",
        approvalReference: null,
        approvedAt: null,
        policyVersion: runnerCapability.policyVersion,
        policyExpiresAt: runnerCapability.policyExpiresAt,
        capabilityExpiresAt: runnerCapability.capabilityExpiresAt,
        revokedAt: terminalAt,
      },
    });
    runnerRepository.persistTargetCapabilityVersion(revoked, identity);
    grants.transitionChild(child.childId, result.state === "COMPLETED" ? "CONSUMED" : "REVOKED");
    runnerTerminalized = true;
    const reportPath = join(root, "data", "private", "reports", `green-banner-${runId}.json`);
    await mkdir(join(root, "data", "private", "reports"), { recursive: true });
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          runId,
          jobId: JOB_ID,
          externalId: EXTERNAL_ID,
          packetId: packet.id,
          packetDigest: pDigest,
          capabilityId: runnerCapability.capabilityId,
          capabilityVersion: runnerCapability.version,
          capabilityDigest: runnerTargetCapabilityDigest(runnerCapability),
          result,
          candidateOutbound: 0,
          clicks: 0,
          writes: 0,
          uploads: 0,
          submissions: 0,
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        runId,
        jobId: JOB_ID,
        externalId: EXTERNAL_ID,
        packetId: packet.id,
        packetDigest: pDigest,
        capabilityId: runnerCapability.capabilityId,
        capabilityVersion: runnerCapability.version,
        capabilityDigest: runnerTargetCapabilityDigest(runnerCapability),
        resultState: result.state,
        stopReason: result.state === "STOPPED" ? result.stopReason : null,
        fields: result.state === "COMPLETED" ? result.observation.fields.length : 0,
        activeRealTargetCapabilities: Number(
          sqlite
            .prepare(
              `SELECT count(*) FROM runner_target_capability_versions c
               WHERE c.approval_state='APPROVED' AND c.target_kind='REAL_TARGET'
                 AND c.capability_expires_at>? AND c.version=(
                   SELECT max(latest.version) FROM runner_target_capability_versions latest
                   WHERE latest.capability_id=c.capability_id)`,
            )
            .pluck()
            .get(now().toISOString()),
        ),
        candidateOutbound: 0,
        clicks: 0,
        writes: 0,
        uploads: 0,
        submissions: 0,
      }),
    );
  } catch (error) {
    if (runnerCapability && targetIdentity && !runnerTerminalized) {
      try {
        const runnerRepository = new RunnerEnablementRepository(database.sqlite, now);
        const terminalAt = now().toISOString();
        const revoked = deriveNextRunnerTargetCapability({
          previous: runnerCapability,
          identity: targetIdentity,
          lifecycle: {
            alias: runnerCapability.alias,
            approvalState: "REVOKED",
            approvalReference: null,
            approvedAt: null,
            policyVersion: runnerCapability.policyVersion,
            policyExpiresAt: runnerCapability.policyExpiresAt,
            capabilityExpiresAt: runnerCapability.capabilityExpiresAt,
            revokedAt: terminalAt,
          },
        });
        runnerRepository.persistTargetCapabilityVersion(revoked, targetIdentity);
      } catch {
        // Preserve the original safe stop; the private audit will report any recovery failure.
      }
    }
    if (childCreated && grants.latestChildState(childId) === "ACTIVE") {
      grants.transitionChild(childId, "REVOKED");
    }
    throw error;
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GREEN_BANNER_TARGET_INSPECTION_FAILED");
  process.exitCode = 1;
});
