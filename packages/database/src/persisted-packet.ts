import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  assessPacketReadiness,
  assessVerificationFreshness,
  VerificationFreshnessOperationSchema,
  VerificationFreshnessPolicySchema,
  packetDigest,
  type ApplicationPacket,
  type PacketReadiness,
  type VerificationFreshnessOperation,
  type VerificationFreshnessPolicy,
} from "@applypilot/application-runner";

import { R2Repository } from "./r2-repository";

const ReadinessEnvelopeSchema = z
  .object({
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    packetContractVersion: z.string().min(1).optional(),
    frozenPacket: z.unknown().optional(),
    verificationEvidence: z.unknown().nullable().optional(),
  })
  .passthrough();

type PacketRow = {
  id: string;
  jobId: string;
  jobVersionId: string | null;
  profileVersionId: string;
  evaluationVersionId: string | null;
  r2EvaluationId: string | null;
  targetUrl: string | null;
  targetHost: string | null;
  readinessJson: string;
};

export interface PersistedPacketLoadInput {
  sqlite: BetterSqlite3.Database;
  packetId: string;
  expectedDigest?: string;
  runId?: string;
  now?: Date;
}

export interface PersistedPacketLoadResult {
  packet: ApplicationPacket;
  digest: string;
  readiness: PacketReadiness;
  providerExpiresAt: string | null;
}

export interface PersistedPacketResolveInput extends PersistedPacketLoadInput {
  operation?: VerificationFreshnessOperation;
  policy?: VerificationFreshnessPolicy;
}

export interface PersistedPacketResolveResult extends PersistedPacketLoadResult {
  freshness: ReturnType<typeof assessVerificationFreshness>;
}

function fail(code: string): never {
  throw new Error(code);
}

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(code);
  }
}

function parseAnswerValue(value: string | null): string | number | boolean | null {
  if (value === null) return null;
  const parsed = parseJson(value, "PACKET_PERSISTED_CORRUPT");
  if (
    parsed === null ||
    typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean"
  ) {
    return parsed;
  }
  return fail("PACKET_PERSISTED_CORRUPT");
}

function currentVersionState(sqlite: BetterSqlite3.Database, row: PacketRow): boolean {
  if (!row.jobVersionId) return false;
  const current = sqlite
    .prepare(
      `SELECT
         (SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1) AS currentJob,
         (SELECT active_version_id FROM candidate_profiles WHERE id=(SELECT profile_id FROM candidate_profile_versions WHERE id=?)) AS activeProfile,
         e.job_id AS evaluationJob, e.job_version_id AS evaluationJobVersion,
         e.profile_version_id AS evaluationProfile, e.stale AS stale
       FROM evaluation_versions e WHERE e.id=?`,
    )
    .get(row.jobId, row.profileVersionId, row.evaluationVersionId) as
    | {
        currentJob: string | null;
        activeProfile: string | null;
        evaluationJob: string | null;
        evaluationJobVersion: string | null;
        evaluationProfile: string | null;
        stale: number | null;
      }
    | undefined;
  if (
    !current ||
    current.currentJob !== row.jobVersionId ||
    current.activeProfile !== row.profileVersionId
  ) {
    return false;
  }
  if (
    row.r2EvaluationId &&
    (current.evaluationJob !== row.jobId ||
      current.evaluationJobVersion !== row.jobVersionId ||
      current.evaluationProfile !== row.profileVersionId)
  ) {
    return false;
  }
  if (!row.r2EvaluationId) {
    return (
      current.evaluationJob === row.jobId &&
      current.evaluationJobVersion === row.jobVersionId &&
      current.evaluationProfile === row.profileVersionId &&
      current.stale === 0
    );
  }
  const r2 = sqlite
    .prepare(
      `SELECT job_id AS jobId,job_version_id AS jobVersionId,profile_version_id AS profileVersionId,
              eligibility_status AS eligibilityStatus,stale
       FROM r2_evaluation_versions WHERE id=?`,
    )
    .get(row.r2EvaluationId) as
    | {
        jobId: string;
        jobVersionId: string;
        profileVersionId: string;
        eligibilityStatus: string;
        stale: number;
      }
    | undefined;
  const queue = sqlite
    .prepare(
      `SELECT state,freshness,job_version_id AS jobVersionId,profile_version_id AS profileVersionId,
              r2_evaluation_id AS r2EvaluationId
       FROM r2_queue_decision_versions WHERE job_id=? ORDER BY version DESC LIMIT 1`,
    )
    .get(row.jobId) as
    | {
        state: string;
        freshness: string;
        jobVersionId: string;
        profileVersionId: string;
        r2EvaluationId: string;
      }
    | undefined;
  return Boolean(
    r2 &&
      r2.stale === 0 &&
      r2.jobId === row.jobId &&
      r2.jobVersionId === row.jobVersionId &&
      r2.profileVersionId === row.profileVersionId &&
      queue?.state === "PREPARING" &&
      queue.freshness === "CURRENT" &&
      queue.jobVersionId === row.jobVersionId &&
      queue.profileVersionId === row.profileVersionId &&
      queue.r2EvaluationId === row.r2EvaluationId,
  );
}

/** Reconstructs a packet from durable rows and verifies its canonical digest. */
export function loadPersistedApplicationPacket(
  input: PersistedPacketLoadInput,
): PersistedPacketLoadResult {
  const row = input.sqlite
    .prepare(
      `SELECT id,job_id AS jobId,job_version_id AS jobVersionId,profile_version_id AS profileVersionId,
              evaluation_version_id AS evaluationVersionId,r2_evaluation_id AS r2EvaluationId,
              target_url AS targetUrl,target_host AS targetHost,readiness_json AS readinessJson
       FROM application_packets WHERE id=?`,
    )
    .get(input.packetId) as PacketRow | undefined;
  if (!row) return fail("PACKET_NOT_FOUND");
  if (input.runId) {
    const run = input.sqlite
      .prepare("SELECT packet_id AS packetId FROM application_runs WHERE id=?")
      .get(input.runId) as { packetId: string } | undefined;
    if (!run) return fail("APPLICATION_RUN_NOT_FOUND");
    if (run.packetId !== row.id) return fail("PACKET_RUN_BINDING_MISMATCH");
  }
  const envelope = ReadinessEnvelopeSchema.safeParse(
    parseJson(row.readinessJson, "PACKET_PERSISTED_CORRUPT"),
  );
  if (!envelope.success) return fail("PACKET_PERSISTED_CORRUPT");
  if (envelope.data.frozenPacket === undefined)
    return fail("PACKET_HISTORICAL_REPRESENTATION_UNAVAILABLE");
  const packet = ApplicationPacketSchema.safeParse(envelope.data.frozenPacket);
  if (!packet.success) return fail("PACKET_PERSISTED_CORRUPT");
  if (
    packet.data.id !== row.id ||
    packet.data.jobId !== row.jobId ||
    packet.data.jobVersionId !== row.jobVersionId ||
    packet.data.profileVersionId !== row.profileVersionId ||
    packet.data.evaluationVersionId !== row.evaluationVersionId ||
    packet.data.r2EvaluationId !== row.r2EvaluationId ||
    packet.data.targetUrl !== row.targetUrl ||
    packet.data.targetHost !== row.targetHost
  )
    return fail("PACKET_PERSISTED_DIGEST_MISMATCH");
  const providerExpiresAt = packet.data.verificationEvidence?.providerExpiresAt ?? null;
  const digest = packetDigest(packet.data);
  if (input.expectedDigest && input.expectedDigest !== digest)
    return fail("PACKET_DIGEST_BINDING_MISMATCH");
  if (envelope.data.packetDigest !== digest) return fail("PACKET_PERSISTED_DIGEST_MISMATCH");
  return {
    packet: packet.data,
    digest,
    readiness: assessPacketReadiness(packet.data, { allowUnknownProviderExpiry: true }),
    providerExpiresAt,
  };
}

/** Shared pre-operation gate; callers must invoke it immediately before each action. */
export function resolvePersistedApplicationPacket(
  input: PersistedPacketResolveInput,
): PersistedPacketResolveResult {
  if (input.policy === undefined) return fail("PACKET_POLICY_REQUIRED");
  if (input.operation === undefined) return fail("PACKET_OPERATION_REQUIRED");
  const now = input.now ?? new Date();
  let policy: VerificationFreshnessPolicy;
  let operation: VerificationFreshnessOperation;
  try {
    policy = VerificationFreshnessPolicySchema.parse(input.policy);
    operation = VerificationFreshnessOperationSchema.parse(input.operation);
  } catch {
    return fail("PACKET_AUTHORITY_INVALID");
  }
  const loaded = loadPersistedApplicationPacket({ ...input, now });
  const evidence = loaded.packet.verificationEvidence;
  if (!evidence) return fail("PACKET_VERIFICATION_REQUIRED");
  if (
    evidence.policyVersion !== policy.version ||
    evidence.preparationMaxAgeMs !== policy.preparationMaxAgeMs ||
    evidence.preExternalActionMaxAgeMs !== policy.preExternalActionMaxAgeMs
  )
    return fail("PACKET_FRESHNESS_POLICY_MISMATCH");
  if (
    !currentVersionState(input.sqlite, {
      id: loaded.packet.id,
      jobId: loaded.packet.jobId,
      jobVersionId: loaded.packet.jobVersionId,
      profileVersionId: loaded.packet.profileVersionId,
      evaluationVersionId: loaded.packet.evaluationVersionId,
      r2EvaluationId: loaded.packet.r2EvaluationId,
      targetUrl: loaded.packet.targetUrl,
      targetHost: loaded.packet.targetHost,
      readinessJson: "",
    })
  )
    return fail("PACKET_VERSION_STATE_REQUIRED");
  const readiness = assessPacketReadiness(loaded.packet, { allowUnknownProviderExpiry: true });
  if (readiness.blockers.length) return fail(`PACKET_NOT_READY:${readiness.blockers.join(",")}`);
  const currentEvidence = input.sqlite
    .prepare(
      `SELECT v.verified_at AS verifiedAt,v.content_hash AS contentHash,
              v.qualification_state AS qualificationState,v.run_id AS runId,
              v.page_id AS pageId,v.job_version_id AS jobVersionId,
              v.source_observation_id AS sourceObservationId,
              o.expires_at AS providerExpiresAt
       FROM source_record_verifications v
       JOIN source_run_checkpoints r ON r.id=v.run_id AND r.status='COMPLETE'
       JOIN source_run_pages p ON p.id=v.page_id AND p.run_id=v.run_id AND p.page_digest=v.page_digest
         AND v.record_index < p.record_count
       JOIN job_versions jv ON jv.id=v.job_version_id AND jv.source_observation_id=v.source_observation_id
       LEFT JOIN source_observations o ON o.id=v.source_observation_id AND o.content_hash=v.content_hash
       WHERE v.id=? AND v.disposition='ACCEPTED' AND v.qualification_state='QUALIFIED'
         AND v.job_version_id IS NOT NULL AND v.source_observation_id IS NOT NULL`,
    )
    .get(evidence.verificationId) as
    | {
        verifiedAt: string;
        contentHash: string | null;
        qualificationState: string;
        providerExpiresAt: string | null;
        runId: string;
        pageId: string;
        jobVersionId: string;
        sourceObservationId: string;
      }
    | undefined;
  if (
    !currentEvidence ||
    currentEvidence.qualificationState !== "QUALIFIED" ||
    currentEvidence.jobVersionId !== loaded.packet.jobVersionId ||
    !currentEvidence.runId ||
    !currentEvidence.pageId ||
    !currentEvidence.sourceObservationId ||
    currentEvidence.verifiedAt !== evidence.verifiedAt ||
    currentEvidence.contentHash !== evidence.contentHash ||
    currentEvidence.providerExpiresAt !== evidence.providerExpiresAt
  )
    return fail("PACKET_VERIFICATION_EVIDENCE_MISMATCH");
  for (const document of loaded.packet.documents) {
    const currentDocument = input.sqlite
      .prepare(
        `SELECT d.job_id AS jobId,d.job_version_id AS jobVersionId,
                d.profile_version_id AS profileVersionId,d.content_digest AS digest,d.stale,
                EXISTS(SELECT 1 FROM document_approvals a
                  WHERE a.document_artifact_id=d.id AND a.content_digest=d.content_digest
                    AND a.invalidated_at IS NULL) AS approved
         FROM document_artifacts d WHERE d.id=?`,
      )
      .get(document.id) as
      | {
          jobId: string;
          jobVersionId: string;
          profileVersionId: string;
          digest: string;
          stale: number;
          approved: number;
        }
      | undefined;
    if (
      !currentDocument ||
      currentDocument.jobId !== loaded.packet.jobId ||
      currentDocument.jobVersionId !== loaded.packet.jobVersionId ||
      currentDocument.profileVersionId !== loaded.packet.profileVersionId ||
      currentDocument.digest !== document.digest ||
      Boolean(currentDocument.stale) !== document.stale ||
      Boolean(currentDocument.approved) !== document.approved
    )
      return fail("PACKET_DOCUMENT_CURRENTNESS_REQUIRED");
  }
  for (const answer of loaded.packet.answers) {
    const currentAnswer = input.sqlite
      .prepare(
        `SELECT q.question_key AS questionKey,q.question_text AS questionText,q.required,q.sensitive,
                a.answer_json AS answerJson,a.certainty AS truthState,a.disclosure_state AS disclosureState,
                a.fact_references_json AS factReferences
         FROM application_questions q
         LEFT JOIN application_answer_versions a ON a.id=(
           SELECT a2.id FROM application_answer_versions a2
           WHERE a2.question_id=q.id ORDER BY a2.version DESC LIMIT 1)
         WHERE q.packet_id=? AND q.question_key=? ORDER BY q.version DESC LIMIT 1`,
      )
      .get(loaded.packet.id, answer.questionId) as
      | {
          questionKey: string;
          questionText: string;
          required: number;
          sensitive: number;
          answerJson: string | null;
          truthState: string | null;
          disclosureState: string | null;
          factReferences: string | null;
        }
      | undefined;
    if (
      !currentAnswer ||
      currentAnswer.questionKey !== answer.questionId ||
      currentAnswer.questionText !== answer.questionText ||
      Boolean(currentAnswer.required) !== answer.required ||
      Boolean(currentAnswer.sensitive) !== answer.sensitive
    )
      return fail("PACKET_ANSWER_CURRENTNESS_REQUIRED");
    const currentValue = parseAnswerValue(currentAnswer.answerJson);
    const currentRefs = currentAnswer.factReferences
      ? parseJson(currentAnswer.factReferences, "PACKET_PERSISTED_CORRUPT")
      : [];
    if (
      currentValue !== answer.value ||
      (currentAnswer.truthState ?? "UNKNOWN") !== answer.truthState ||
      (currentAnswer.disclosureState ?? "UNKNOWN") !== answer.disclosureState ||
      JSON.stringify(currentRefs) !== JSON.stringify(answer.factReferences)
    )
      return fail("PACKET_ANSWER_CURRENTNESS_REQUIRED");
  }
  if (loaded.packet.r2EvaluationId) {
    try {
      new R2Repository(input.sqlite, () => now).assertCurrentPreparing(
        loaded.packet.jobId,
        loaded.packet.r2EvaluationId,
      );
    } catch {
      return fail("PACKET_R2_CURRENTNESS_REQUIRED");
    }
  }
  const freshness = assessVerificationFreshness({
    verifiedAt: evidence.verifiedAt,
    evidenceQualified: true,
    providerExpiresAt: loaded.providerExpiresAt,
    operation,
    policy,
    now,
  });
  if (freshness.state !== "FRESH") return fail(`PACKET_FRESHNESS_${freshness.reasonCode}`);
  return { ...loaded, freshness };
}
