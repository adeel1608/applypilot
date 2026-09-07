import { createHash, randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  ApplicationPacketSchema,
  SyntheticStopReasonSchema,
  assessPacketReadiness,
  type ApplicationPacket,
  type FinalActionConsent,
  type RunnerCheckpoint,
} from "@applypilot/application-runner";
import {
  BetaApplicationEventSchema,
  canTransitionBetaApplication,
  type BetaApplicationEvent,
} from "@applypilot/application-tracker";
import {
  ApplicationRunStateSchema,
  EvaluationCoverageSchema,
  JobFieldEvidenceSchema,
  JobQueueStateSchema,
  JobSchema,
  RequirementEvidenceSchema,
  SourceObservationSchema,
  type Job,
  type JobFieldEvidence,
  type RequirementEvidence,
  type SourceObservation,
} from "@applypilot/job-model";

const EvaluationVersionInputSchema = z.object({
  id: z.string().min(1).optional(),
  jobId: z.string().min(1),
  jobVersionId: z.string().min(1).nullable(),
  profileVersionId: z.string().min(1),
  evaluationContext: z.enum(["PRIVATE_LOCAL_PROFILE", "DEMO_PROFILE", "UNKNOWN"]),
  eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]),
  eligibilityReasons: z.array(z.unknown()),
  fitScore: z.number().int().min(0).max(100),
  fitContributions: z.array(z.unknown()),
  coverage: EvaluationCoverageSchema,
  eligibilityEngineVersion: z.string().min(1),
  fitEngineVersion: z.string().min(1),
  weightVersion: z.string().min(1),
  stale: z.boolean().default(false),
});

export type EvaluationVersionInput = z.input<typeof EvaluationVersionInputSchema>;

export interface JobVersionInput {
  job: Job;
  sourceObservationId: string | null;
  fieldEvidence?: JobFieldEvidence[];
  requirementEvidence?: RequirementEvidence[];
}

export interface RecordedJobVersion {
  id: string;
  version: number;
  contentDigest: string;
  created: boolean;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class BetaRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  recordSourceObservation(
    input: SourceObservation & {
      sourceRecordId?: string | null;
      supersedesObservationId?: string | null;
    },
  ): SourceObservation {
    const observation = SourceObservationSchema.parse(input);
    this.sqlite
      .prepare(
        `INSERT INTO source_observations
          (id, job_id, source_record_id, source, tenant, external_id, source_url,
           acquisition_method, content_hash, raw_snapshot_reference, observed_at, posted_at,
           expires_at, parser_version, policy_version, run_id, supersedes_observation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_record_id, content_hash) DO NOTHING`,
      )
      .run(
        observation.id,
        observation.canonicalJobId,
        input.sourceRecordId ?? null,
        observation.source,
        observation.tenant,
        observation.externalId,
        observation.sourceUrl,
        observation.acquisitionMethod,
        observation.contentHash,
        observation.rawSnapshotReference,
        observation.observedAt,
        observation.postedAt,
        observation.expiresAt,
        observation.parserVersion,
        observation.policyVersion,
        observation.runId,
        input.supersedesObservationId ?? null,
      );
    return observation;
  }

  recordJobVersion(input: JobVersionInput): RecordedJobVersion {
    const job = JobSchema.parse(input.job);
    const normalizedJson = JSON.stringify(job);
    const contentDigest = digest(normalizedJson);
    const fieldEvidence = (input.fieldEvidence ?? []).map((item) =>
      JobFieldEvidenceSchema.parse(item),
    );
    const requirements = (input.requirementEvidence ?? []).map((item) =>
      RequirementEvidenceSchema.parse(item),
    );

    return this.sqlite.transaction(() => {
      const previous = this.sqlite
        .prepare(
          `SELECT id, version, content_digest AS contentDigest
           FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
        )
        .get(job.id) as { id: string; version: number; contentDigest: string | null } | undefined;
      if (previous?.contentDigest === contentDigest) {
        return { ...previous, contentDigest, created: false };
      }

      const version = (previous?.version ?? 0) + 1;
      const jobVersionId = this.id();
      const createdAt = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO job_versions
            (id, job_id, version, normalized_json, content_digest, source_observation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobVersionId,
          job.id,
          version,
          normalizedJson,
          contentDigest,
          input.sourceObservationId,
          createdAt,
        );

      const insertField = this.sqlite.prepare(
        `INSERT INTO job_field_evidence
          (id, job_version_id, field_name, source_observation_id, source_path, original_text,
           normalized_value_json, certainty, rule_id, extractor_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of fieldEvidence) {
        insertField.run(
          this.id(),
          jobVersionId,
          evidence.field,
          evidence.sourceObservationId,
          evidence.sourcePath,
          evidence.originalText,
          evidence.normalizedValueJson,
          evidence.certainty,
          evidence.ruleId,
          evidence.extractorVersion,
          createdAt,
        );
      }

      const insertRequirement = this.sqlite.prepare(
        `INSERT INTO requirement_evidence
          (id, job_version_id, source_observation_id, source_path, start_offset, end_offset,
           original_text, normalized_proposition, modality, kind, condition_text, certainty,
           rule_id, extractor_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of requirements) {
        insertRequirement.run(
          this.id(),
          jobVersionId,
          evidence.sourceObservationId,
          evidence.sourcePath,
          evidence.start,
          evidence.end,
          evidence.originalText,
          evidence.normalizedProposition,
          evidence.modality,
          evidence.kind,
          evidence.condition,
          evidence.certainty,
          evidence.ruleId,
          evidence.extractorVersion,
          createdAt,
        );
      }
      return { id: jobVersionId, version, contentDigest, created: true };
    })();
  }

  recordEvaluationVersion(input: EvaluationVersionInput): string {
    const value = EvaluationVersionInputSchema.parse(input);
    const id = value.id ?? this.id();
    this.sqlite
      .prepare(
        `INSERT INTO evaluation_versions
          (id, job_id, job_version_id, profile_version_id, evaluation_context,
           eligibility_status, eligibility_reasons_json, fit_score, fit_contributions_json,
           coverage_json, eligibility_engine_version, fit_engine_version, weight_version,
           stale, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        value.jobId,
        value.jobVersionId,
        value.profileVersionId,
        value.evaluationContext,
        value.eligibilityStatus,
        JSON.stringify(value.eligibilityReasons),
        value.fitScore,
        JSON.stringify(value.fitContributions),
        JSON.stringify(value.coverage),
        value.eligibilityEngineVersion,
        value.fitEngineVersion,
        value.weightVersion,
        value.stale ? 1 : 0,
        this.now().toISOString(),
      );
    return id;
  }

  setQueueState(input: {
    jobId: string;
    state: z.infer<typeof JobQueueStateSchema>;
    evaluationVersionId: string | null;
    reasonCode: string;
  }): void {
    const state = JobQueueStateSchema.parse(input.state);
    const reasonCode = z.string().min(1).max(100).parse(input.reasonCode);
    const now = this.now().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO job_queue_entries
          (job_id, state, evaluation_version_id, reason_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           state = excluded.state,
           evaluation_version_id = excluded.evaluation_version_id,
           reason_code = excluded.reason_code,
           updated_at = excluded.updated_at`,
      )
      .run(input.jobId, state, input.evaluationVersionId, reasonCode, now, now);
  }

  persistApplicationPacket(input: ApplicationPacket): {
    packetId: string;
    version: number;
    status: ReturnType<typeof assessPacketReadiness>["status"];
  } {
    const packet = ApplicationPacketSchema.parse(input);
    const readiness = assessPacketReadiness(packet);
    return this.sqlite.transaction(() => {
      const versionState = this.sqlite
        .prepare(
          `SELECT
             (SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1) AS currentJobVersionId,
             (SELECT p.active_version_id FROM candidate_profiles p
                JOIN candidate_profile_versions v ON v.profile_id = p.id WHERE v.id = ?) AS currentProfileVersionId,
             e.job_id AS evaluationJobId,
             e.job_version_id AS evaluationJobVersionId,
             e.profile_version_id AS evaluationProfileVersionId,
             e.eligibility_status AS evaluationEligibilityStatus,
             e.stale AS evaluationStale
           FROM evaluation_versions e WHERE e.id = ?`,
        )
        .get(packet.jobId, packet.profileVersionId, packet.evaluationVersionId) as
        | {
            currentJobVersionId: string | null;
            currentProfileVersionId: string | null;
            evaluationJobId: string;
            evaluationJobVersionId: string | null;
            evaluationProfileVersionId: string;
            evaluationEligibilityStatus: string;
            evaluationStale: number;
          }
        | undefined;
      const versionsActuallyCurrent = Boolean(
        versionState &&
          versionState.currentJobVersionId === packet.jobVersionId &&
          versionState.currentProfileVersionId === packet.profileVersionId &&
          versionState.evaluationJobId === packet.jobId &&
          versionState.evaluationJobVersionId === packet.jobVersionId &&
          versionState.evaluationProfileVersionId === packet.profileVersionId &&
          versionState.evaluationEligibilityStatus === packet.eligibilityStatus &&
          !versionState.evaluationStale,
      );
      if (packet.versionsCurrent !== versionsActuallyCurrent) {
        throw new Error("PACKET_VERSION_STATE_MISMATCH");
      }
      const documentState = this.sqlite.prepare(
        `SELECT d.content_digest AS contentDigest, d.stale,
           EXISTS(SELECT 1 FROM document_approvals a
             WHERE a.document_artifact_id = d.id AND a.content_digest = d.content_digest
               AND a.invalidated_at IS NULL) AS approved
         FROM document_artifacts d WHERE d.id = ?`,
      );
      for (const document of packet.documents) {
        const persisted = documentState.get(document.id) as
          | { contentDigest: string; stale: number; approved: number }
          | undefined;
        if (
          !persisted ||
          persisted.contentDigest !== document.digest ||
          Boolean(persisted.stale) !== document.stale ||
          Boolean(persisted.approved) !== document.approved
        ) {
          throw new Error("PACKET_DOCUMENT_STATE_MISMATCH");
        }
      }
      const versionRow = this.sqlite
        .prepare(
          "SELECT coalesce(max(version), 0) AS version FROM application_packets WHERE job_id = ?",
        )
        .get(packet.jobId) as { version: number };
      const version = versionRow.version + 1;
      const now = this.now().toISOString();
      this.sqlite
        .prepare(
          `INSERT INTO application_packets
            (id, job_id, job_version_id, profile_version_id, evaluation_version_id,
             target_url, target_host, status, readiness_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          packet.id,
          packet.jobId,
          packet.jobVersionId,
          packet.profileVersionId,
          packet.evaluationVersionId,
          packet.targetUrl,
          packet.targetHost,
          readiness.status,
          JSON.stringify(readiness),
          version,
          now,
          now,
        );
      const insertDocument = this.sqlite.prepare(
        `INSERT INTO application_packet_documents (packet_id, document_artifact_id, required)
         VALUES (?, ?, ?)`,
      );
      for (const document of packet.documents) {
        insertDocument.run(packet.id, document.id, document.required ? 1 : 0);
      }
      const insertQuestion = this.sqlite.prepare(
        `INSERT INTO application_questions
          (id, packet_id, question_key, question_text, options_json, required, sensitive,
           version, created_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?, 1, ?)`,
      );
      const insertAnswer = this.sqlite.prepare(
        `INSERT INTO application_answer_versions
          (id, question_id, answer_json, certainty, fact_references_json, disclosure_state,
           version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      for (const answer of packet.answers) {
        const questionId = this.id();
        insertQuestion.run(
          questionId,
          packet.id,
          answer.questionId,
          answer.questionText,
          answer.required ? 1 : 0,
          answer.sensitive ? 1 : 0,
          now,
        );
        insertAnswer.run(
          this.id(),
          questionId,
          answer.value === null ? null : JSON.stringify(answer.value),
          answer.truthState,
          JSON.stringify(answer.factReferences),
          answer.disclosureState,
          now,
        );
      }
      return { packetId: packet.id, version, status: readiness.status };
    })();
  }

  registerApplicationRun(input: {
    packetId: string;
    targetKind: "SYNTHETIC_LOCAL" | "REAL_TARGET";
    targetHost: string;
    formVersion: string;
  }): string {
    const parsed = z
      .object({
        packetId: z.string().min(1),
        targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
        targetHost: z.string().min(1),
        formVersion: z.string().min(1),
      })
      .parse(input);
    const localHost = parsed.targetHost === "localhost" || parsed.targetHost === "127.0.0.1";
    if (parsed.targetKind === "SYNTHETIC_LOCAL" && !localHost) {
      throw new Error("SYNTHETIC_TARGET_MUST_BE_LOCAL");
    }
    const id = this.id();
    const now = this.now().toISOString();
    const state = parsed.targetKind === "REAL_TARGET" ? "PAUSED" : "PREPARED";
    const stopReason = parsed.targetKind === "REAL_TARGET" ? "TARGET_APPROVAL_REQUIRED" : null;
    this.sqlite
      .prepare(
        `INSERT INTO application_runs
          (id, packet_id, target_kind, target_host, form_version, state, stop_reason,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.packetId,
        parsed.targetKind,
        parsed.targetHost,
        parsed.formVersion,
        state,
        stopReason,
        now,
        now,
      );
    return id;
  }

  recordRunnerCheckpoint(runId: string, input: RunnerCheckpoint): void {
    const id = z.string().min(1).parse(runId);
    const state = ApplicationRunStateSchema.parse(input.state);
    const stopReason = input.stopReason ? SyntheticStopReasonSchema.parse(input.stopReason) : null;
    const occurredAt = z.iso.datetime().parse(input.occurredAt);
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO runner_checkpoints
            (id, run_id, sequence, state, safe_metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.id(),
          id,
          z.number().int().nonnegative().parse(input.sequence),
          state,
          JSON.stringify({ stopReason }),
          occurredAt,
        );
      this.sqlite
        .prepare(
          "UPDATE application_runs SET state = ?, stop_reason = ?, updated_at = ? WHERE id = ?",
        )
        .run(state, stopReason, occurredAt, id);
    })();
  }

  persistFinalActionConsent(runId: string, input: FinalActionConsent): void {
    const id = z.string().min(1).parse(runId);
    const consent = z
      .object({
        id: z.string().min(1),
        tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
        packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
        targetHost: z.string().min(1),
        formVersion: z.string().min(1),
        expiresAt: z.iso.datetime(),
        usedAt: z.iso.datetime().nullable(),
      })
      .parse(input);
    const run = this.sqlite
      .prepare(
        "SELECT target_host AS targetHost, form_version AS formVersion FROM application_runs WHERE id = ?",
      )
      .get(id) as { targetHost: string; formVersion: string } | undefined;
    if (!run) throw new Error("APPLICATION_RUN_NOT_FOUND");
    if (run.targetHost !== consent.targetHost || run.formVersion !== consent.formVersion) {
      throw new Error("CONSENT_RUN_BINDING_MISMATCH");
    }
    this.sqlite
      .prepare(
        `INSERT INTO final_action_consents
          (id, run_id, packet_digest, target_host, form_version, token_hash,
           expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        consent.id,
        id,
        consent.packetDigest,
        consent.targetHost,
        consent.formVersion,
        consent.tokenHash,
        consent.expiresAt,
        consent.usedAt,
        this.now().toISOString(),
      );
  }

  approveDocument(input: { documentArtifactId: string; contentDigest: string }): string {
    const artifactId = z.string().min(1).parse(input.documentArtifactId);
    const contentDigest = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.contentDigest);
    const artifact = this.sqlite
      .prepare("SELECT content_digest AS contentDigest, stale FROM document_artifacts WHERE id = ?")
      .get(artifactId) as { contentDigest: string; stale: number } | undefined;
    if (!artifact) throw new Error("DOCUMENT_ARTIFACT_NOT_FOUND");
    if (artifact.stale) throw new Error("STALE_DOCUMENT_CANNOT_BE_APPROVED");
    if (artifact.contentDigest !== contentDigest) throw new Error("DOCUMENT_DIGEST_MISMATCH");
    const existing = this.sqlite
      .prepare(
        `SELECT id FROM document_approvals
         WHERE document_artifact_id = ? AND content_digest = ? AND invalidated_at IS NULL`,
      )
      .get(artifactId, contentDigest) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO document_approvals
          (id, document_artifact_id, content_digest, approved_by, approved_at)
         VALUES (?, ?, ?, 'LOCAL_USER', ?)`,
      )
      .run(id, artifactId, contentDigest, this.now().toISOString());
    return id;
  }

  invalidateStaleDependencies(input: {
    jobId: string;
    currentJobVersionId: string;
    currentProfileVersionId: string;
    reasonCode: string;
  }): { evaluations: number; documents: number; packets: number } {
    const parsed = z
      .object({
        jobId: z.string().min(1),
        currentJobVersionId: z.string().min(1),
        currentProfileVersionId: z.string().min(1),
        reasonCode: z.string().min(1).max(100),
      })
      .parse(input);
    return this.sqlite.transaction(() => {
      const now = this.now().toISOString();
      const evaluations = this.sqlite
        .prepare(
          `UPDATE evaluation_versions SET stale = 1
           WHERE job_id = ? AND (job_version_id <> ? OR profile_version_id <> ?) AND stale = 0`,
        )
        .run(parsed.jobId, parsed.currentJobVersionId, parsed.currentProfileVersionId).changes;
      const documents = this.sqlite
        .prepare(
          `UPDATE document_artifacts SET stale = 1
           WHERE job_id = ? AND (job_version_id <> ? OR profile_version_id <> ?) AND stale = 0`,
        )
        .run(parsed.jobId, parsed.currentJobVersionId, parsed.currentProfileVersionId).changes;
      this.sqlite
        .prepare(
          `UPDATE document_approvals SET invalidated_at = ?, invalidation_reason = ?
           WHERE invalidated_at IS NULL AND document_artifact_id IN
             (SELECT id FROM document_artifacts WHERE job_id = ? AND stale = 1)`,
        )
        .run(now, parsed.reasonCode, parsed.jobId);
      const packets = this.sqlite
        .prepare(
          `UPDATE application_packets SET status = 'INVALIDATED', readiness_json = ?, updated_at = ?
           WHERE job_id = ? AND status <> 'INVALIDATED' AND
             (job_version_id <> ? OR profile_version_id <> ?)`,
        )
        .run(
          JSON.stringify({
            status: "REVIEW_REQUIRED",
            blockers: [parsed.reasonCode],
            warnings: [],
          }),
          now,
          parsed.jobId,
          parsed.currentJobVersionId,
          parsed.currentProfileVersionId,
        ).changes;
      return { evaluations, documents, packets };
    })();
  }

  appendApplicationEvent(
    input: Omit<BetaApplicationEvent, "id" | "fromStatus" | "occurredAt"> & {
      occurredAt?: string;
    },
  ): { created: boolean; eventId: string; status: BetaApplicationEvent["toStatus"] } {
    return this.sqlite.transaction(() => {
      const existing = this.sqlite
        .prepare(
          `SELECT id, to_status AS toStatus FROM application_events_v2
           WHERE idempotency_key = ?`,
        )
        .get(input.idempotencyKey) as
        | { id: string; toStatus: BetaApplicationEvent["toStatus"] }
        | undefined;
      if (existing) return { created: false, eventId: existing.id, status: existing.toStatus };
      const identityColumn = input.applicationId ? "application_id" : "packet_id";
      const identity = input.applicationId ?? input.packetId;
      if (!identity) throw new Error("APPLICATION_EVENT_IDENTITY_REQUIRED");
      const current = this.sqlite
        .prepare(
          `SELECT to_status AS toStatus FROM application_events_v2
           WHERE ${identityColumn} = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
        )
        .get(identity) as { toStatus: BetaApplicationEvent["toStatus"] } | undefined;
      const fromStatus = current?.toStatus ?? null;
      if (fromStatus === null) {
        if (input.toStatus !== "DISCOVERED") throw new Error("APPLICATION_MUST_START_DISCOVERED");
      } else if (!canTransitionBetaApplication(fromStatus, input.toStatus)) {
        throw new Error(`Application cannot transition from ${fromStatus} to ${input.toStatus}`);
      }
      const event = BetaApplicationEventSchema.parse({
        ...input,
        id: this.id(),
        fromStatus,
        occurredAt: input.occurredAt ?? this.now().toISOString(),
      });
      this.sqlite
        .prepare(
          `INSERT INTO application_events_v2
            (id, application_id, packet_id, from_status, to_status, event_type, actor,
             idempotency_key, metadata_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.applicationId,
          event.packetId,
          event.fromStatus,
          event.toStatus,
          event.eventType,
          event.actor,
          event.idempotencyKey,
          JSON.stringify(event.metadata),
          event.occurredAt,
        );
      if (event.applicationId) {
        this.sqlite
          .prepare("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?")
          .run(event.toStatus, event.occurredAt, event.applicationId);
      }
      return { created: true, eventId: event.id, status: event.toStatus };
    })();
  }
}
