import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  FrozenInspectionBindingSchema,
  FrozenRunnerBindingSchema,
  RunnerTargetCapabilitySchema,
  deterministicRunnerTargetCapabilityId,
  inspectionAnswersDigest,
  inspectionDisclosuresDigest,
  inspectionDocumentsDigest,
  runnerTargetCapabilityDigest,
  validateRunnerAuditMetadata,
  type FinalActionConsent,
  type FinalConsentStore,
  type FrozenInspectionBinding,
  type FrozenRunnerBinding,
  type InspectionAuditRecord,
  type RunnerTargetCapability,
} from "@applypilot/application-runner";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const RecoveryEventSchema = z
  .object({
    decision: z.enum([
      "PAUSE",
      "RESUME_REFUSED",
      "RESUME_APPROVED",
      "OWNER_CANCELLED",
      "OUTCOME_UNKNOWN",
      "TERMINAL",
    ]),
    reasonCode: z.string().regex(/^[A-Z0-9_]{3,100}$/),
    safeMetadata: z
      .object({
        state: z
          .string()
          .regex(/^[A-Z0-9_]{3,100}$/)
          .optional(),
        checkpointSequence: z.number().int().nonnegative().optional(),
        ownerActionRequired: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export class RunnerEnablementRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  persistTargetCapabilityVersion(input: RunnerTargetCapability): { id: string; created: boolean } {
    const capability = RunnerTargetCapabilitySchema.parse(input);
    const digest = runnerTargetCapabilityDigest(capability);
    const existing = this.sqlite
      .prepare(
        `SELECT id, configuration_digest AS digest FROM runner_target_capability_versions WHERE capability_id=? AND version=?`,
      )
      .get(capability.capabilityId, capability.version) as
      | { id: string; digest: string }
      | undefined;
    if (existing) {
      if (existing.digest !== digest)
        throw new Error("TARGET_CAPABILITY_IMMUTABLE_VERSION_CONFLICT");
      return { id: existing.id, created: false };
    }
    const latest = this.sqlite
      .prepare(
        `SELECT id, version FROM runner_target_capability_versions WHERE capability_id=? ORDER BY version DESC LIMIT 1`,
      )
      .get(capability.capabilityId) as { id: string; version: number } | undefined;
    if (
      (latest &&
        (capability.version !== latest.version + 1 ||
          capability.predecessorVersion !== latest.version)) ||
      (!latest && capability.version !== 1)
    ) {
      throw new Error("TARGET_CAPABILITY_VERSION_SEQUENCE_INVALID");
    }
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO runner_target_capability_versions
       (id,capability_id,version,predecessor_id,target_kind,alias,allowed_origin,allowed_path_prefix,
        form_version,adapter_version,allowed_operations_json,approval_state,approval_reference,
        approved_at,policy_version,policy_expires_at,capability_expires_at,configuration_digest,
        revoked_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        capability.capabilityId,
        capability.version,
        latest?.id ?? null,
        capability.targetKind,
        capability.alias,
        capability.allowedOrigin,
        capability.allowedPathPrefix,
        capability.formVersion,
        capability.adapterVersion,
        JSON.stringify(capability.allowedOperations),
        capability.approvalState,
        capability.approvalReference,
        capability.approvedAt,
        capability.policyVersion,
        capability.policyExpiresAt,
        capability.capabilityExpiresAt,
        digest,
        capability.revokedAt,
        this.now().toISOString(),
      );
    this.audit(
      "runner.target.versioned",
      "runner_target_capability",
      capability.capabilityId,
      validateRunnerAuditMetadata("runner.target.versioned", {
        capabilityId: capability.capabilityId,
        version: capability.version,
        state: capability.approvalState,
        targetKind: capability.targetKind,
        operations: capability.allowedOperations,
      }),
    );
    if (capability.approvalState === "REVOKED") {
      this.audit(
        "runner.target.revoked",
        "runner_target_capability",
        capability.capabilityId,
        validateRunnerAuditMetadata("runner.target.revoked", {
          capabilityId: capability.capabilityId,
          version: capability.version,
          targetKind: capability.targetKind,
        }),
      );
    }
    return { id, created: true };
  }

  assertTargetCapabilityCurrent(input: RunnerTargetCapability): void {
    const capability = RunnerTargetCapabilitySchema.parse(input);
    const row = this.sqlite
      .prepare(
        `SELECT version,configuration_digest AS digest FROM runner_target_capability_versions
         WHERE capability_id=? ORDER BY version DESC LIMIT 1`,
      )
      .get(capability.capabilityId) as { version: number; digest: string } | undefined;
    if (
      !row ||
      row.version !== capability.version ||
      row.digest !== runnerTargetCapabilityDigest(capability)
    ) {
      throw new Error("TARGET_CAPABILITY_CHANGED");
    }
  }

  bindRun(input: {
    runId: string;
    binding: FrozenRunnerBinding;
    targetCapability: RunnerTargetCapability | null;
  }): string {
    const binding = FrozenRunnerBindingSchema.parse(input.binding);
    const capability = input.targetCapability
      ? RunnerTargetCapabilitySchema.parse(input.targetCapability)
      : null;
    let targetCapabilityVersionId: string | null = null;
    if (capability) {
      if (binding.targetCapabilityDigest !== runnerTargetCapabilityDigest(capability))
        throw new Error("TARGET_CAPABILITY_BINDING_MISMATCH");
      const row = this.sqlite
        .prepare(
          `SELECT id FROM runner_target_capability_versions WHERE capability_id=? AND version=? AND configuration_digest=?`,
        )
        .get(capability.capabilityId, capability.version, binding.targetCapabilityDigest) as
        | { id: string }
        | undefined;
      if (!row) throw new Error("TARGET_CAPABILITY_NOT_PERSISTED");
      const latest = this.sqlite
        .prepare(
          `SELECT id,configuration_digest AS digest FROM runner_target_capability_versions
           WHERE capability_id=? ORDER BY version DESC LIMIT 1`,
        )
        .get(capability.capabilityId) as { id: string; digest: string } | undefined;
      if (!latest || latest.id !== row.id || latest.digest !== binding.targetCapabilityDigest) {
        throw new Error("TARGET_CAPABILITY_CHANGED");
      }
      targetCapabilityVersionId = row.id;
    }
    const run = this.sqlite
      .prepare("SELECT packet_id AS packetId FROM application_runs WHERE id=?")
      .get(input.runId) as { packetId: string } | undefined;
    if (!run || run.packetId !== binding.packetId) throw new Error("RUN_PACKET_BINDING_MISMATCH");
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO runner_run_bindings
       (id,run_id,target_capability_version_id,packet_id,packet_digest,job_version_id,
        profile_version_id,evaluation_version_id,documents_digest,answers_digest,disclosures_digest,
        target_origin,target_path,form_version,adapter_version,unresolved_count,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.runId,
        targetCapabilityVersionId,
        binding.packetId,
        binding.packetDigest,
        binding.jobVersionId,
        binding.profileVersionId,
        binding.evaluationVersionId,
        binding.documentsDigest,
        binding.answersDigest,
        binding.disclosuresDigest,
        binding.targetOrigin,
        binding.targetPath,
        binding.formVersion,
        binding.adapterVersion,
        binding.unresolvedCount,
        this.now().toISOString(),
      );
    this.audit(
      "runner.run.bound",
      "application_run",
      input.runId,
      validateRunnerAuditMetadata("runner.run.bound", {
        runId: input.runId,
        packetId: binding.packetId,
        capabilityId: binding.targetCapabilityId,
        capabilityVersion: binding.targetCapabilityVersion,
        unresolvedCount: binding.unresolvedCount,
      }),
    );
    return id;
  }

  currentBinding(runId: string): FrozenRunnerBinding {
    const row = this.sqlite
      .prepare(
        `SELECT b.packet_id AS packetId,b.packet_digest AS packetDigest,b.job_version_id AS jobVersionId,
       b.profile_version_id AS profileVersionId,b.evaluation_version_id AS evaluationVersionId,
       b.documents_digest AS documentsDigest,b.answers_digest AS answersDigest,
       b.disclosures_digest AS disclosuresDigest,b.target_origin AS targetOrigin,
       b.target_path AS targetPath,b.form_version AS formVersion,b.adapter_version AS adapterVersion,
       b.unresolved_count AS unresolvedCount,c.capability_id AS targetCapabilityId,
       c.version AS targetCapabilityVersion,c.configuration_digest AS targetCapabilityDigest
       FROM runner_run_bindings b LEFT JOIN runner_target_capability_versions c ON c.id=b.target_capability_version_id
       WHERE b.run_id=?`,
      )
      .get(runId) as Record<string, unknown> | undefined;
    if (!row || typeof row.targetCapabilityId !== "string")
      throw new Error("RUN_BINDING_NOT_FOUND");
    const current = this.sqlite
      .prepare(
        `SELECT version,configuration_digest AS digest FROM runner_target_capability_versions
         WHERE capability_id=? ORDER BY version DESC LIMIT 1`,
      )
      .get(row.targetCapabilityId) as { version: number; digest: string } | undefined;
    if (
      !current ||
      current.version !== row.targetCapabilityVersion ||
      current.digest !== row.targetCapabilityDigest
    ) {
      throw new Error("TARGET_CAPABILITY_CHANGED");
    }
    return FrozenRunnerBindingSchema.parse({
      ...row,
      targetUrl: `${row.targetOrigin}${row.targetPath}`,
    });
  }

  bindInspection(input: {
    runId: string;
    binding: FrozenInspectionBinding;
    targetCapability: RunnerTargetCapability;
  }): string {
    const binding = FrozenInspectionBindingSchema.parse(input.binding);
    const capability = RunnerTargetCapabilitySchema.parse(input.targetCapability);
    if (
      capability.allowedOperations.length !== 1 ||
      capability.allowedOperations[0] !== "OPEN_AND_INSPECT_ONLY" ||
      binding.targetCapabilityDigest !== runnerTargetCapabilityDigest(capability)
    ) {
      throw new Error("INSPECTION_CAPABILITY_BINDING_MISMATCH");
    }
    if (
      capability.targetKind === "REAL_TARGET" &&
      capability.capabilityId !==
        deterministicRunnerTargetCapabilityId({
          targetKind: capability.targetKind,
          allowedOrigin: capability.allowedOrigin,
          allowedPathPrefix: capability.allowedPathPrefix,
          operation: binding.operation,
          formVersion: capability.formVersion,
          adapterVersion: capability.adapterVersion,
          packetDigest: binding.packetDigest,
        })
    ) {
      throw new Error("INSPECTION_CAPABILITY_PACKET_SCOPE_MISMATCH");
    }
    const capabilityRow = this.sqlite
      .prepare(
        `SELECT id FROM runner_target_capability_versions
         WHERE capability_id=? AND version=? AND configuration_digest=?`,
      )
      .get(capability.capabilityId, capability.version, binding.targetCapabilityDigest) as
      | { id: string }
      | undefined;
    if (!capabilityRow) throw new Error("TARGET_CAPABILITY_NOT_PERSISTED");
    this.assertTargetCapabilityCurrent(capability);
    const packet = this.sqlite
      .prepare(
        `SELECT id,job_id AS jobId,job_version_id AS jobVersionId,
                profile_version_id AS profileVersionId,evaluation_version_id AS evaluationVersionId,
                target_url AS targetUrl
         FROM application_packets WHERE id=?`,
      )
      .get(binding.packetId) as
      | {
          id: string;
          jobId: string;
          jobVersionId: string;
          profileVersionId: string;
          evaluationVersionId: string;
          targetUrl: string | null;
        }
      | undefined;
    if (
      !packet ||
      packet.jobVersionId !== binding.jobVersionId ||
      packet.profileVersionId !== binding.profileVersionId ||
      packet.evaluationVersionId !== binding.evaluationVersionId ||
      packet.targetUrl !== binding.targetUrl
    ) {
      throw new Error("INSPECTION_PACKET_BINDING_MISMATCH");
    }
    const id = z.string().min(1).max(200).parse(input.runId);
    const timestamp = this.now().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO runner_inspection_bindings
         (id,target_capability_version_id,operation,packet_id,packet_digest,job_version_id,
          profile_version_id,evaluation_version_id,documents_digest,answers_digest,
          disclosures_digest,target_url,target_origin,target_path,allowed_path_prefix,form_version,adapter_version,
          unresolved_count,state,safe_stop_reason,field_count,classification_summary_json,
          created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'BOUND',NULL,0,'{}',?,?)`,
      )
      .run(
        id,
        capabilityRow.id,
        binding.operation,
        binding.packetId,
        binding.packetDigest,
        binding.jobVersionId,
        binding.profileVersionId,
        binding.evaluationVersionId,
        binding.documentsDigest,
        binding.answersDigest,
        binding.disclosuresDigest,
        binding.targetUrl,
        binding.targetOrigin,
        binding.targetPath,
        binding.allowedPathPrefix,
        binding.formVersion,
        binding.adapterVersion,
        binding.unresolvedCount,
        timestamp,
        timestamp,
      );
    this.audit(
      "runner.inspection.bound",
      "runner_inspection",
      id,
      validateRunnerAuditMetadata("runner.inspection.bound", {
        runId: id,
        packetId: binding.packetId,
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.version,
        operation: binding.operation,
        unresolvedCount: binding.unresolvedCount,
      }),
    );
    return id;
  }

  currentInspectionBinding(runId: string): FrozenInspectionBinding {
    const id = z.string().min(1).max(200).parse(runId);
    const row = this.sqlite
      .prepare(
        `SELECT b.operation,b.packet_id AS packetId,b.packet_digest AS packetDigest,
                b.job_version_id AS jobVersionId,b.profile_version_id AS profileVersionId,
                b.evaluation_version_id AS evaluationVersionId,b.documents_digest AS documentsDigest,
                b.answers_digest AS answersDigest,b.disclosures_digest AS disclosuresDigest,
                b.target_url AS targetUrl,b.target_origin AS targetOrigin,b.target_path AS targetPath,
                b.allowed_path_prefix AS allowedPathPrefix,
                b.form_version AS formVersion,b.adapter_version AS adapterVersion,
                b.unresolved_count AS unresolvedCount,c.capability_id AS targetCapabilityId,
                c.version AS targetCapabilityVersion,c.configuration_digest AS targetCapabilityDigest,
                p.job_id AS jobId,p.target_url AS currentPacketTargetUrl,
                p.job_version_id AS currentPacketJobVersionId,
                p.profile_version_id AS currentPacketProfileVersionId,
                p.evaluation_version_id AS currentPacketEvaluationVersionId
         FROM runner_inspection_bindings b
         JOIN runner_target_capability_versions c ON c.id=b.target_capability_version_id
         JOIN application_packets p ON p.id=b.packet_id WHERE b.id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row || typeof row.targetCapabilityId !== "string" || typeof row.jobId !== "string") {
      throw new Error("INSPECTION_BINDING_NOT_FOUND");
    }
    const documents = this.sqlite
      .prepare(
        `SELECT d.id,d.content_digest AS digest
         FROM application_packet_documents pd
         JOIN document_artifacts d ON d.id=pd.document_artifact_id
         WHERE pd.packet_id=? ORDER BY pd.rowid`,
      )
      .all(row.packetId) as Array<{ id: string; digest: string }>;
    const answers = (
      this.sqlite
        .prepare(
          `SELECT q.question_key AS questionId,a.answer_json AS valueJson,
                  a.certainty AS truthState,a.disclosure_state AS disclosureState
           FROM application_questions q
           JOIN application_answer_versions a ON a.question_id=q.id
           WHERE q.packet_id=? AND a.version=(
             SELECT max(latest.version) FROM application_answer_versions latest
             WHERE latest.question_id=q.id)
           ORDER BY q.rowid`,
        )
        .all(row.packetId) as Array<{
        questionId: string;
        valueJson: string | null;
        truthState: string;
        disclosureState: string;
      }>
    ).map(({ valueJson, ...answer }) => ({
      ...answer,
      value: valueJson === null ? null : (JSON.parse(valueJson) as string | number | boolean),
    }));
    const current = this.sqlite
      .prepare(
        `SELECT
           (SELECT version FROM runner_target_capability_versions
              WHERE capability_id=? ORDER BY version DESC LIMIT 1) AS capabilityVersion,
           (SELECT configuration_digest FROM runner_target_capability_versions
              WHERE capability_id=? ORDER BY version DESC LIMIT 1) AS capabilityDigest,
           (SELECT id FROM application_packets WHERE job_id=? ORDER BY version DESC LIMIT 1) AS packetId,
           (SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1) AS jobVersionId,
           (SELECT active_version_id FROM candidate_profiles WHERE id=(
              SELECT profile_id FROM candidate_profile_versions WHERE id=?)) AS profileVersionId,
           (SELECT stale FROM evaluation_versions WHERE id=?) AS evaluationStale,
           (SELECT job_version_id FROM evaluation_versions WHERE id=?) AS evaluationJobVersionId,
           (SELECT profile_version_id FROM evaluation_versions WHERE id=?) AS evaluationProfileVersionId`,
      )
      .get(
        row.targetCapabilityId,
        row.targetCapabilityId,
        row.jobId,
        row.jobId,
        row.profileVersionId,
        row.evaluationVersionId,
        row.evaluationVersionId,
        row.evaluationVersionId,
      ) as {
      capabilityVersion: number | null;
      capabilityDigest: string | null;
      packetId: string | null;
      jobVersionId: string | null;
      profileVersionId: string | null;
      evaluationStale: number | null;
      evaluationJobVersionId: string | null;
      evaluationProfileVersionId: string | null;
    };
    if (
      current.capabilityVersion !== row.targetCapabilityVersion ||
      current.capabilityDigest !== row.targetCapabilityDigest ||
      row.currentPacketTargetUrl !== row.targetUrl ||
      row.currentPacketJobVersionId !== row.jobVersionId ||
      row.currentPacketProfileVersionId !== row.profileVersionId ||
      row.currentPacketEvaluationVersionId !== row.evaluationVersionId ||
      current.packetId !== row.packetId ||
      current.jobVersionId !== row.jobVersionId ||
      current.profileVersionId !== row.profileVersionId ||
      current.evaluationStale !== 0 ||
      current.evaluationJobVersionId !== row.jobVersionId ||
      current.evaluationProfileVersionId !== row.profileVersionId ||
      inspectionDocumentsDigest(documents) !== row.documentsDigest ||
      inspectionAnswersDigest(answers) !== row.answersDigest ||
      inspectionDisclosuresDigest(answers) !== row.disclosuresDigest
    ) {
      throw new Error("INSPECTION_BINDING_STALE");
    }
    return FrozenInspectionBindingSchema.parse({
      operation: row.operation,
      packetId: row.packetId,
      packetDigest: row.packetDigest,
      jobVersionId: row.jobVersionId,
      profileVersionId: row.profileVersionId,
      evaluationVersionId: row.evaluationVersionId,
      documentsDigest: row.documentsDigest,
      answersDigest: row.answersDigest,
      disclosuresDigest: row.disclosuresDigest,
      targetUrl: row.targetUrl,
      targetOrigin: row.targetOrigin,
      targetPath: row.targetPath,
      allowedPathPrefix: row.allowedPathPrefix,
      formVersion: row.formVersion,
      adapterVersion: row.adapterVersion,
      unresolvedCount: row.unresolvedCount,
      targetCapabilityId: row.targetCapabilityId,
      targetCapabilityVersion: row.targetCapabilityVersion,
      targetCapabilityDigest: row.targetCapabilityDigest,
    });
  }

  recordInspectionAudit(runId: string, record: InspectionAuditRecord): void {
    const id = z.string().min(1).max(200).parse(runId);
    const row = this.sqlite
      .prepare("SELECT state FROM runner_inspection_bindings WHERE id=?")
      .get(id) as { state: string } | undefined;
    if (!row) throw new Error("INSPECTION_BINDING_NOT_FOUND");
    const timestamp = this.now().toISOString();
    if (record.type === "runner.inspection.opened") {
      if (row.state !== "BOUND") throw new Error("INSPECTION_STATE_INVALID");
      this.sqlite
        .prepare("UPDATE runner_inspection_bindings SET state='OPENED',updated_at=? WHERE id=?")
        .run(timestamp, id);
    } else if (record.type === "runner.inspection.completed") {
      if (row.state !== "OPENED") throw new Error("INSPECTION_STATE_INVALID");
      this.sqlite
        .prepare(
          `UPDATE runner_inspection_bindings SET state='COMPLETED',safe_stop_reason=NULL,
           field_count=?,classification_summary_json=?,updated_at=? WHERE id=?`,
        )
        .run(
          record.metadata.fieldCount,
          JSON.stringify({
            reviewRequiredCount: record.metadata.reviewRequiredCount,
            documentRequiredCount: record.metadata.documentRequiredCount,
            unsupportedCount: record.metadata.unsupportedCount,
          }),
          timestamp,
          id,
        );
    } else {
      if (!new Set(["BOUND", "OPENED"]).has(row.state)) {
        throw new Error("INSPECTION_STATE_INVALID");
      }
      this.sqlite
        .prepare(
          "UPDATE runner_inspection_bindings SET state='STOPPED',safe_stop_reason=?,updated_at=? WHERE id=?",
        )
        .run(record.metadata.reason, timestamp, id);
    }
    this.audit(
      record.type,
      "runner_inspection",
      id,
      validateRunnerAuditMetadata(record.type, { runId: id, ...record.metadata }),
    );
  }

  recordRecoveryEvent(runId: string, input: z.input<typeof RecoveryEventSchema>): string {
    const event = RecoveryEventSchema.parse(input);
    const sequence = Number(
      this.sqlite
        .prepare("SELECT coalesce(max(sequence),-1)+1 FROM runner_recovery_events WHERE run_id=?")
        .pluck()
        .get(runId),
    );
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO runner_recovery_events (id,run_id,sequence,decision,reason_code,safe_metadata_json,occurred_at)
       VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        runId,
        sequence,
        event.decision,
        event.reasonCode,
        JSON.stringify(event.safeMetadata),
        this.now().toISOString(),
      );
    this.audit(
      "runner.recovery.recorded",
      "application_run",
      runId,
      validateRunnerAuditMetadata("runner.recovery.recorded", {
        runId,
        decision: event.decision,
        reasonCode: event.reasonCode,
      }),
    );
    return id;
  }

  consentStore(runId: string): FinalConsentStore {
    return new DatabaseFinalConsentStore(
      this.sqlite,
      runId,
      this.now,
      (eventType, entityId, metadata) =>
        this.audit(eventType, "application_run", entityId, metadata),
    );
  }

  private audit(eventType: string, entityType: string, entityId: string, metadata: object): void {
    this.sqlite
      .prepare(
        `INSERT INTO audit_events
         (id,event_type,entity_type,entity_id,actor,redacted_metadata_json,occurred_at)
         VALUES (?,?,?,?, 'SYSTEM', ?, ?)`,
      )
      .run(
        this.id(),
        eventType,
        entityType,
        entityId,
        JSON.stringify(metadata),
        this.now().toISOString(),
      );
  }
}

class DatabaseFinalConsentStore implements FinalConsentStore {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly runId: string,
    private readonly now: () => Date,
    private readonly audit: (eventType: string, entityId: string, metadata: object) => void,
  ) {}

  issue(binding: FrozenRunnerBinding, ttlMs: number): FinalActionConsent {
    this.assertBinding(binding);
    const token = randomBytes(32).toString("base64url");
    const consent: FinalActionConsent = {
      id: randomUUID(),
      token,
      tokenHash: sha256(token),
      packetDigest: binding.packetDigest,
      targetHost: new URL(binding.targetOrigin).hostname,
      formVersion: binding.formVersion,
      expiresAt: new Date(this.now().getTime() + ttlMs).toISOString(),
      usedAt: null,
    };
    this.sqlite
      .prepare(
        `INSERT INTO final_action_consents (id,run_id,packet_digest,target_host,form_version,token_hash,expires_at,used_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        consent.id,
        this.runId,
        consent.packetDigest,
        consent.targetHost,
        consent.formVersion,
        consent.tokenHash,
        consent.expiresAt,
        null,
        this.now().toISOString(),
      );
    this.audit(
      "runner.consent.issued",
      this.runId,
      validateRunnerAuditMetadata("runner.consent.issued", {
        runId: this.runId,
        consentId: consent.id,
        expiresAt: consent.expiresAt,
      }),
    );
    return consent;
  }

  consume(input: { id: string; token: string; binding: FrozenRunnerBinding; now: Date }): boolean {
    this.assertBinding(input.binding);
    return this.sqlite.transaction(() => {
      const stored = this.sqlite
        .prepare(
          `SELECT token_hash AS tokenHash,packet_digest AS packetDigest,target_host AS targetHost,
         form_version AS formVersion,expires_at AS expiresAt,used_at AS usedAt
         FROM final_action_consents WHERE id=? AND run_id=?`,
        )
        .get(input.id, this.runId) as
        | {
            tokenHash: string;
            packetDigest: string;
            targetHost: string;
            formVersion: string;
            expiresAt: string;
            usedAt: string | null;
          }
        | undefined;
      if (!stored || stored.usedAt || Date.parse(stored.expiresAt) <= input.now.getTime())
        return false;
      const supplied = Buffer.from(sha256(input.token), "hex");
      const expected = Buffer.from(stored.tokenHash, "hex");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected) ||
        stored.packetDigest !== input.binding.packetDigest ||
        stored.targetHost !== new URL(input.binding.targetOrigin).hostname ||
        stored.formVersion !== input.binding.formVersion
      )
        return false;
      const result = this.sqlite
        .prepare("UPDATE final_action_consents SET used_at=? WHERE id=? AND used_at IS NULL")
        .run(input.now.toISOString(), input.id);
      if (result.changes !== 1) return false;
      this.audit(
        "runner.consent.consumed",
        this.runId,
        validateRunnerAuditMetadata("runner.consent.consumed", {
          runId: this.runId,
          consentId: input.id,
        }),
      );
      return true;
    })();
  }

  private assertBinding(binding: FrozenRunnerBinding): void {
    const frozen = FrozenRunnerBindingSchema.parse(binding);
    const stored = this.sqlite
      .prepare(
        `SELECT packet_digest AS packetDigest,target_origin AS targetOrigin,form_version AS formVersion
       FROM runner_run_bindings WHERE run_id=?`,
      )
      .get(this.runId) as
      | { packetDigest: string; targetOrigin: string; formVersion: string }
      | undefined;
    if (
      !stored ||
      stored.packetDigest !== frozen.packetDigest ||
      stored.targetOrigin !== frozen.targetOrigin ||
      stored.formVersion !== frozen.formVersion
    )
      throw new Error("CONSENT_RUN_BINDING_MISMATCH");
  }
}
