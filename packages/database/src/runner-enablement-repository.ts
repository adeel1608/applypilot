import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  FrozenRunnerBindingSchema,
  RunnerTargetCapabilitySchema,
  runnerTargetCapabilityDigest,
  validateRunnerAuditMetadata,
  type FinalActionConsent,
  type FinalConsentStore,
  type FrozenRunnerBinding,
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
        form_version,adapter_version,approval_state,approval_reference,approved_at,policy_version,
        policy_expires_at,capability_expires_at,configuration_digest,revoked_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      }),
    );
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
