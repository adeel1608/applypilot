import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { BetaRepository, HostedWorkflowRepository } from "@applypilot/database";
import { greenhouseQuestions, HostedSubjectSchema } from "@applypilot/application-runner";
import {
  sourceCapabilityDigest,
  sourceRequestBindingDigest,
  type SourceCapabilityV2,
} from "@applypilot/job-sources";
import { getLocalDatabase } from "./local-database";
import { resolveLocalDataDirectory } from "./local-data-directory";

/** Consume only the retained exact qualified detail response; this never dispatches HTTP. */
export function captureBoundGreenhouseQuestions(
  cap: SourceCapabilityV2,
  runId: string,
): "CAPTURED" | "NOT_REQUESTED" | "QUESTION_CAPTURE_BLOCKED" {
  if (
    cap.source !== "GREENHOUSE" ||
    cap.requestBinding?.operation !== "GET_JOB" ||
    !cap.requestBinding.includeQuestions
  )
    return "NOT_REQUESTED";
  try {
    const sqlite = getLocalDatabase()?.sqlite;
    if (
      !sqlite?.prepare("SELECT 1 FROM sqlite_master WHERE name='hosted_question_discoveries'").get()
    )
      return "QUESTION_CAPTURE_BLOCKED";
    const row = sqlite
      .prepare(
        `SELECT jv.job_id AS jobId,jv.id AS jobVersionId,p.payload_json AS payload,cp.active_version_id AS profileVersionId
      FROM source_record_verifications v JOIN job_versions jv ON jv.id=v.job_version_id
      JOIN source_observation_payloads p ON p.observation_id=v.source_observation_id
      JOIN source_run_checkpoints r ON r.id=v.run_id
      JOIN source_capability_versions c ON c.id=r.capability_version_id
      JOIN source_capability_request_bindings b ON b.capability_version_id=c.id
      JOIN candidate_profiles cp ON 1=1
      WHERE v.run_id=? AND v.external_id=? AND v.qualification_state='QUALIFIED'
      AND r.status='COMPLETE' AND r.operation='GET_JOB' AND r.capability_version_id=v.capability_version_id
      AND r.capability_digest=? AND c.capability_id=? AND c.version=? AND b.request_digest=?
      AND jv.version=(SELECT max(version) FROM job_versions WHERE job_id=jv.job_id)
      ORDER BY cp.updated_at DESC LIMIT 1`,
      )
      .get(
        runId,
        cap.requestBinding.externalId,
        sourceCapabilityDigest(cap),
        cap.capabilityId,
        cap.version,
        sourceRequestBindingDigest(cap.requestBinding),
      ) as
      | { jobId: string; jobVersionId: string; payload: string; profileVersionId: string }
      | undefined;
    if (!row) return "QUESTION_CAPTURE_BLOCKED";
    const verification = new BetaRepository(sqlite).requireLatestQualifiedVerification(
      row.jobId,
      row.jobVersionId,
    );
    if (verification.runId !== runId) return "QUESTION_CAPTURE_BLOCKED";
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    const subject = HostedSubjectSchema.parse({
      provider: "GREENHOUSE",
      region: cap.region,
      tenant: cap.tenant,
      externalId: cap.requestBinding.externalId,
      jobId: row.jobId,
      jobVersionId: row.jobVersionId,
      profileVersionId: row.profileVersionId,
      verificationId: verification.verificationId,
      sourceRunId: runId,
      sourceContentHash: verification.contentHash,
      targetUrl: payload.absolute_url,
    });
    const data = resolveLocalDataDirectory();
    const store = new HostedWorkflowRepository(sqlite, {
      mode: "REAL",
      approvedArtifactRoot: join(data, "private"),
      reviewedBuild: null,
      currentPrivateProfileHash: () =>
        candidateProfileContentHash(
          CandidateProfileSchema.parse(
            JSON.parse(
              readFileSync(/* turbopackIgnore: true */ join(data, "profile.private.json"), "utf8"),
            ),
          ),
        ),
    });
    store.recordDiscovery(subject, greenhouseQuestions(subject, payload));
    return "CAPTURED";
  } catch {
    return "QUESTION_CAPTURE_BLOCKED";
  }
}
