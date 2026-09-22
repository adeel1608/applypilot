import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  PROPOSED_LOCAL_VERIFICATION_POLICY,
  assessPacketReadiness,
  assessVerificationFreshness,
  deriveJobExpiryState,
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
    current.activeProfile !== row.profileVersionId ||
    current.evaluationJob !== row.jobId ||
    current.evaluationJobVersion !== row.jobVersionId ||
    current.evaluationProfile !== row.profileVersionId ||
    current.stale !== 0
  ) {
    return false;
  }
  if (!row.r2EvaluationId) return true;
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
  const verificationEvidence = envelope.data.verificationEvidence ?? null;
  const documents = input.sqlite
    .prepare(
      `SELECT d.id,d.type,d.file_name AS fileName,d.content_digest AS digest,d.stale,
              pd.required,
              EXISTS(SELECT 1 FROM document_approvals a
                     WHERE a.document_artifact_id=d.id AND a.content_digest=d.content_digest
                       AND a.invalidated_at IS NULL) AS approved
       FROM application_packet_documents pd
       JOIN document_artifacts d ON d.id=pd.document_artifact_id
       WHERE pd.packet_id=? ORDER BY d.id`,
    )
    .all(row.id) as Array<{
    id: string;
    type: string;
    fileName: string;
    digest: string;
    stale: number;
    required: number;
    approved: number;
  }>;
  const answers = input.sqlite
    .prepare(
      `SELECT q.question_key AS questionId,q.question_text AS questionText,q.required,q.sensitive,
              a.answer_json AS answerJson,a.certainty AS truthState,a.disclosure_state AS disclosureState,
              a.fact_references_json AS factReferences
       FROM application_questions q
       LEFT JOIN application_answer_versions a ON a.id=(
         SELECT a2.id FROM application_answer_versions a2
         WHERE a2.question_id=q.id ORDER BY a2.version DESC LIMIT 1)
       WHERE q.packet_id=? ORDER BY q.id`,
    )
    .all(row.id) as Array<{
    questionId: string;
    questionText: string;
    required: number;
    sensitive: number;
    answerJson: string | null;
    truthState: string | null;
    disclosureState: string | null;
    factReferences: string | null;
  }>;
  const evidence = verificationEvidence
    ? z
        .object({
          verificationId: z.string().min(1),
          verifiedAt: z.iso.datetime(),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          providerExpiresAt: z.string().nullable(),
        })
        .passthrough()
        .safeParse(verificationEvidence)
    : null;
  if (verificationEvidence && !evidence?.success)
    return fail("PACKET_VERIFICATION_EVIDENCE_CORRUPT");
  const ledger = evidence?.success
    ? (input.sqlite
        .prepare(
          `SELECT v.verified_at AS verifiedAt,v.content_hash AS contentHash,
                  v.qualification_state AS qualificationState,o.expires_at AS providerExpiresAt,
                  jv.job_id AS jobId,jv.id AS jobVersionId
           FROM source_record_verifications v
           LEFT JOIN source_observations o ON o.id=v.source_observation_id
           LEFT JOIN job_versions jv ON jv.id=v.job_version_id
           WHERE v.id=?`,
        )
        .get(evidence.data.verificationId) as
        | {
            verifiedAt: string;
            contentHash: string | null;
            qualificationState: string;
            providerExpiresAt: string | null;
            jobId: string | null;
            jobVersionId: string | null;
          }
        | undefined)
    : undefined;
  if (
    evidence?.success &&
    (!ledger ||
      ledger.qualificationState !== "QUALIFIED" ||
      ledger.jobId !== row.jobId ||
      ledger.jobVersionId !== row.jobVersionId ||
      ledger.verifiedAt !== evidence.data.verifiedAt ||
      ledger.contentHash !== evidence.data.contentHash ||
      ledger.providerExpiresAt !== evidence.data.providerExpiresAt)
  ) {
    return fail("PACKET_VERIFICATION_EVIDENCE_MISMATCH");
  }
  const providerExpiresAt = ledger?.providerExpiresAt ?? null;
  const packet = ApplicationPacketSchema.safeParse({
    id: row.id,
    jobId: row.jobId,
    jobVersionId: row.jobVersionId ?? fail("PACKET_PERSISTED_CORRUPT"),
    profileVersionId: row.profileVersionId,
    evaluationVersionId: row.evaluationVersionId ?? fail("PACKET_PERSISTED_CORRUPT"),
    r2EvaluationId: row.r2EvaluationId,
    verificationEvidence,
    eligibilityStatus:
      (row.r2EvaluationId
        ? (
            input.sqlite
              .prepare("SELECT eligibility_status AS value FROM r2_evaluation_versions WHERE id=?")
              .get(row.r2EvaluationId) as { value: string } | undefined
          )?.value
        : (
            input.sqlite
              .prepare("SELECT eligibility_status AS value FROM evaluation_versions WHERE id=?")
              .get(row.evaluationVersionId) as { value: string } | undefined
          )?.value) ?? "REVIEW_REQUIRED",
    targetUrl: row.targetUrl,
    targetHost: row.targetHost,
    jobExpiryState: deriveJobExpiryState(providerExpiresAt, input.now ?? new Date()),
    duplicateState: input.sqlite
      .prepare(
        `SELECT 1 FROM r2_duplicate_candidates c WHERE c.state='SUGGESTED' AND
         (c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id=?) OR
          c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id=?)) LIMIT 1`,
      )
      .get(row.jobId, row.jobId)
      ? "UNRESOLVED"
      : "CLEAR",
    versionsCurrent: currentVersionState(input.sqlite, row),
    documents: documents.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      digest: document.digest,
      approved: Boolean(document.approved),
      stale: Boolean(document.stale),
      required: Boolean(document.required),
    })),
    answers: answers.map((answer) => ({
      questionId: answer.questionId,
      questionText: answer.questionText,
      required: Boolean(answer.required),
      sensitive: Boolean(answer.sensitive),
      value: parseAnswerValue(answer.answerJson),
      truthState: answer.truthState ?? "UNKNOWN",
      disclosureState: answer.disclosureState ?? "UNKNOWN",
      factReferences: answer.factReferences
        ? (parseJson(answer.factReferences, "PACKET_PERSISTED_CORRUPT") as string[])
        : [],
    })),
  });
  if (!packet.success) return fail("PACKET_PERSISTED_CORRUPT");
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
  const now = input.now ?? new Date();
  const policy = input.policy ?? PROPOSED_LOCAL_VERIFICATION_POLICY;
  const loaded = loadPersistedApplicationPacket({ ...input, now });
  if (loaded.readiness.blockers.length)
    return fail(`PACKET_NOT_READY:${loaded.readiness.blockers.join(",")}`);
  const evidence = loaded.packet.verificationEvidence;
  if (!evidence) return fail("PACKET_VERIFICATION_REQUIRED");
  if (
    evidence.policyVersion !== policy.version ||
    evidence.preparationMaxAgeMs !== policy.preparationMaxAgeMs ||
    evidence.preExternalActionMaxAgeMs !== policy.preExternalActionMaxAgeMs
  )
    return fail("PACKET_FRESHNESS_POLICY_MISMATCH");
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
  const operation = input.operation ?? "PREPARATION";
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
