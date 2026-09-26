import { randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import type {
  NonSubmitDurableSnapshot,
  NonSubmitDurableStore,
  NonSubmitClaimHandle,
  NonSubmitRunnerCheckpoint,
  NonSubmitRunnerState,
  RunnerTargetOperation,
} from "@applypilot/application-runner";
import {
  NonSubmitRunnerStateSchema,
  RunnerTargetOperationSchema,
} from "@applypilot/application-runner";

const DurableCheckpointSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    state: NonSubmitRunnerStateSchema,
    stopReason: z.string().min(1).nullable(),
    occurredAt: z.iso.datetime(),
    targetUrl: z.url(),
    formVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    fieldReadBack: z.array(
      z.object({
        questionId: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
      }),
    ),
    uploadEvidence: z
      .object({
        documentId: z.string().min(1),
        expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
        receivedDigest: z.string().regex(/^[a-f0-9]{64}$/),
        acknowledgementId: z.string().min(1),
      })
      .nullable(),
    previewDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

const DurableSnapshotSchema = z
  .object({
    state: NonSubmitRunnerStateSchema,
    sequence: z.number().int().nonnegative(),
    checkpoints: z.array(DurableCheckpointSchema),
    claimedOperations: z.array(RunnerTargetOperationSchema).max(5),
    activeOperation: RunnerTargetOperationSchema.nullable().optional(),
    recoveryRequired: z.boolean().optional(),
    recoveryReason: z.string().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.claimedOperations).size !== value.claimedOperations.length) {
      context.addIssue({
        code: "custom",
        path: ["claimedOperations"],
        message: "DUPLICATE_OPERATION",
      });
    }
    if (value.checkpoints.some((checkpoint) => checkpoint.sequence > value.sequence)) {
      context.addIssue({
        code: "custom",
        path: ["checkpoints"],
        message: "CHECKPOINT_SEQUENCE_AHEAD",
      });
    }
    for (let index = 1; index < value.checkpoints.length; index += 1) {
      if (value.checkpoints[index - 1].sequence >= value.checkpoints[index].sequence) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", index, "sequence"],
          message: "CHECKPOINT_SEQUENCE_NOT_STRICTLY_INCREASING",
        });
      }
    }
    const latest = value.checkpoints.at(-1);
    if (latest && latest.state !== value.state && value.state !== "PAUSED") {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "SNAPSHOT_STATE_MISMATCH",
      });
    }
  });

function parseSnapshot(value: unknown): NonSubmitDurableSnapshot {
  try {
    return DurableSnapshotSchema.parse(value) as NonSubmitDurableSnapshot;
  } catch {
    throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
  }
}

function assertDigest(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) {
    throw new Error(`${name}_INVALID`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

const NON_SUBMIT_PREFIX: RunnerTargetOperation[] = [
  "MAP_FOR_FILL",
  "FILL",
  "UPLOAD",
  "VERIFY",
  "FILL_PREVIEW",
];

const OPERATION_STATE: Record<RunnerTargetOperation, NonSubmitRunnerState> = {
  MAP_FOR_FILL: "MAPPED",
  FILL: "FILLED",
  UPLOAD: "UPLOADED",
  VERIFY: "VERIFIED",
  FILL_PREVIEW: "FILL_PREVIEW",
  OPEN_AND_INSPECT_ONLY: "OPENED",
  SUBMIT: "PAUSED",
};

type PersistedOperation = {
  operation: RunnerTargetOperation;
  state: string;
  effectJson: string;
};

function parsePersistedRows(rows: PersistedOperation[]): NonSubmitDurableSnapshot[] {
  return rows.map((row) => {
    if (row.effectJson === "{}" || row.state === "CLAIMED")
      throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
    let value: unknown;
    try {
      value = JSON.parse(row.effectJson) as unknown;
    } catch {
      throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
    }
    const snapshot = parseSnapshot(value);
    if (snapshot.state !== row.state && !(row.state === "PAUSED" && snapshot.state === "PAUSED"))
      throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
    return snapshot;
  });
}

function assertSnapshotHistory(
  snapshot: NonSubmitDurableSnapshot,
  operation: RunnerTargetOperation,
  previousOperations: RunnerTargetOperation[],
  previousCheckpoints: NonSubmitRunnerCheckpoint[],
): void {
  if (!NON_SUBMIT_PREFIX.includes(operation)) throw new Error("NON_SUBMIT_OPERATION_FORBIDDEN");
  const operationIndex = NON_SUBMIT_PREFIX.indexOf(operation);
  if (previousOperations.length !== operationIndex)
    throw new Error("NON_SUBMIT_OPERATION_SEQUENCE_INVALID");
  if (
    previousOperations.some((value, index) => value !== NON_SUBMIT_PREFIX[index]) ||
    snapshot.claimedOperations.length !== operationIndex + 1 ||
    snapshot.claimedOperations.some((value, index) => value !== NON_SUBMIT_PREFIX[index])
  )
    throw new Error("NON_SUBMIT_OPERATION_SEQUENCE_INVALID");

  const first = snapshot.checkpoints[0];
  const hasPrepared = first?.state === "PREPARED";
  const expectedLength =
    previousCheckpoints.length + 1 + (previousCheckpoints.length === 0 && hasPrepared ? 1 : 0);
  if (snapshot.checkpoints.length !== expectedLength)
    throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
  for (let index = 0; index < previousCheckpoints.length; index += 1) {
    if (stableJson(snapshot.checkpoints[index]) !== stableJson(previousCheckpoints[index]))
      throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
  }
  if (hasPrepared && (first.sequence !== 1 || first.stopReason !== null))
    throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
  const offset = hasPrepared ? 1 : 0;
  for (let index = 0; index < snapshot.checkpoints.length; index += 1) {
    const checkpoint = snapshot.checkpoints[index];
    if (checkpoint.sequence !== index + 1) throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
    if (index >= offset && index < offset + operationIndex) {
      const expected = OPERATION_STATE[NON_SUBMIT_PREFIX[index - offset]!];
      if (checkpoint.state !== expected || checkpoint.stopReason !== null)
        throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
    }
  }
  const latest = snapshot.checkpoints.at(-1);
  if (!latest || snapshot.sequence !== latest.sequence)
    throw new Error("NON_SUBMIT_CHECKPOINT_HISTORY_INVALID");
  if (snapshot.state === "PAUSED") {
    if (latest.state !== "PAUSED" || latest.stopReason === null)
      throw new Error("NON_SUBMIT_TRANSITION_RESULT_INVALID");
    return;
  }
  if (snapshot.state !== OPERATION_STATE[operation] || latest.state !== snapshot.state) {
    throw new Error("NON_SUBMIT_TRANSITION_RESULT_INVALID");
  }
  if (latest.stopReason !== null) throw new Error("NON_SUBMIT_TRANSITION_RESULT_INVALID");
  if (operation === "UPLOAD" && latest.uploadEvidence === null)
    throw new Error("NON_SUBMIT_UPLOAD_EVIDENCE_REQUIRED");
  if (operation === "FILL_PREVIEW" && latest.previewDigest === null)
    throw new Error("NON_SUBMIT_PREVIEW_EVIDENCE_REQUIRED");
}

/** SQLite-backed operation claims/checkpoints for the synthetic non-submit lane. */
export class SqliteNonSubmitRunStore implements NonSubmitDurableStore {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly runId: string,
    private readonly packetDigest: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    assertDigest(packetDigest, "PACKET_DIGEST");
    const binding = this.sqlite
      .prepare(
        `SELECT json_extract(p.readiness_json,'$.packetDigest') AS packetDigest
         FROM application_runs r JOIN application_packets p ON p.id=r.packet_id
         WHERE r.id=?`,
      )
      .get(runId) as { packetDigest: string | null } | undefined;
    if (!binding) throw new Error("APPLICATION_RUN_NOT_FOUND");
    if (binding.packetDigest !== packetDigest) throw new Error("PACKET_BINDING_MISMATCH");
  }

  load(bindingDigest: string): NonSubmitDurableSnapshot | null {
    assertDigest(bindingDigest, "BINDING_DIGEST");
    const row = this.sqlite
      .prepare(
        `SELECT operation,state,effect_json AS effectJson FROM application_run_operations
         WHERE run_id=? AND binding_digest=? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.runId, bindingDigest) as
      | { operation: RunnerTargetOperation; state: string; effectJson: string }
      | undefined;
    if (!row) {
      const other = this.sqlite
        .prepare("SELECT 1 FROM application_run_operations WHERE run_id=? LIMIT 1")
        .get(this.runId);
      if (other) throw new Error("BINDING_DIGEST_MISMATCH");
      return null;
    }
    if (row.effectJson === "{}" && row.state === "CLAIMED") {
      const previous = this.sqlite
        .prepare(
          `SELECT effect_json AS effectJson FROM application_run_operations
           WHERE run_id=? AND state<>'CLAIMED' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
        )
        .get(this.runId) as { effectJson: string } | undefined;
      const base = previous
        ? parseSnapshot(JSON.parse(previous.effectJson))
        : {
            state: "PREPARED" as const,
            sequence: 0,
            checkpoints: [],
            claimedOperations: [],
            activeOperation: null,
          };
      return parseSnapshot({
        state: "PAUSED",
        sequence: base.sequence,
        checkpoints: base.checkpoints,
        claimedOperations: base.claimedOperations,
        activeOperation: row.operation,
        recoveryRequired: true,
        recoveryReason:
          row.operation === "UPLOAD" ? "UPLOAD_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.effectJson) as unknown;
    } catch {
      throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
    }
    return parseSnapshot(parsed);
  }

  claim(bindingDigest: string, operation: RunnerTargetOperation): NonSubmitClaimHandle | null {
    assertDigest(bindingDigest, "BINDING_DIGEST");
    if (!NON_SUBMIT_PREFIX.includes(operation)) {
      throw new Error("NON_SUBMIT_OPERATION_FORBIDDEN");
    }
    try {
      return this.sqlite.transaction(() => {
        const existingBinding = this.sqlite
          .prepare(
            "SELECT binding_digest AS bindingDigest FROM application_run_operations WHERE run_id=? LIMIT 1",
          )
          .get(this.runId) as { bindingDigest: string } | undefined;
        if (existingBinding && existingBinding.bindingDigest !== bindingDigest) {
          throw new Error("BINDING_DIGEST_MISMATCH");
        }
        const prior = this.sqlite
          .prepare(
            "SELECT operation,state,effect_json AS effectJson FROM application_run_operations WHERE run_id=? AND state<>'CLAIMED' ORDER BY created_at,rowid",
          )
          .all(this.runId) as PersistedOperation[];
        if (prior.length > 0) {
          const snapshots = parsePersistedRows(prior);
          const priorOperations = prior.map((item) => item.operation);
          if (
            priorOperations.some((value, index) => value !== NON_SUBMIT_PREFIX[index]) ||
            snapshots.some((snapshot) => snapshot.state === "PAUSED" || snapshot.recoveryRequired)
          )
            return null;
          const priorCheckpoints = snapshots.at(-1)?.checkpoints ?? [];
          if (operation !== NON_SUBMIT_PREFIX[prior.length]) return null;
          // A completed predecessor is required, not merely a row with the same operation.
          assertSnapshotHistory(
            {
              ...snapshots.at(-1)!,
              claimedOperations: [...priorOperations],
            },
            priorOperations.at(-1)!,
            priorOperations.slice(0, -1),
            snapshots.length > 1 ? (snapshots.at(-2)?.checkpoints ?? []) : [],
          );
          if (priorCheckpoints.length === 0) return null;
        } else if (operation !== NON_SUBMIT_PREFIX[0]) {
          return null;
        }
        const inProgress = this.sqlite
          .prepare(
            `SELECT 1 FROM application_run_operations
             WHERE run_id=? AND binding_digest=? AND state='CLAIMED' LIMIT 1`,
          )
          .get(this.runId, bindingDigest);
        if (inProgress) return null;
        const now = this.now().toISOString();
        const claimId = randomUUID();
        this.sqlite
          .prepare(
            `INSERT INTO application_run_operations
             (id,run_id,binding_digest,operation,operation_key,state,effect_json,created_at,updated_at)
             VALUES (?,?,?,?,?,'CLAIMED','{}',?,?)`,
          )
          .run(claimId, this.runId, bindingDigest, operation, operation, now, now);
        return { claimId, bindingDigest, operation };
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return null;
      throw error;
    }
  }

  save(
    bindingDigest: string,
    snapshot: NonSubmitDurableSnapshot,
    claim: NonSubmitClaimHandle,
  ): void {
    assertDigest(bindingDigest, "BINDING_DIGEST");
    const parsed = parseSnapshot(snapshot);
    const now = this.now().toISOString();
    if (claim.bindingDigest !== bindingDigest) throw new Error("NON_SUBMIT_CLAIM_OWNER_REQUIRED");
    const operation = claim.operation;
    if (!operation) return;
    this.sqlite.transaction(() => {
      const prior = this.sqlite
        .prepare(
          `SELECT operation,state,effect_json AS effectJson FROM application_run_operations
           WHERE run_id=? AND state<>'CLAIMED' ORDER BY created_at,rowid`,
        )
        .all(this.runId) as PersistedOperation[];
      const priorSnapshots = parsePersistedRows(prior);
      const priorOperations = prior.map((item) => item.operation);
      const previousCheckpoints = priorSnapshots.at(-1)?.checkpoints ?? [];
      assertSnapshotHistory(parsed, operation, priorOperations, previousCheckpoints);
      const updated = this.sqlite
        .prepare(
          `UPDATE application_run_operations
           SET state=?, effect_json=?, updated_at=?
           WHERE id=? AND run_id=? AND binding_digest=? AND operation=? AND operation_key=?
             AND state='CLAIMED' AND effect_json='{}'`,
        )
        .run(
          parsed.state,
          JSON.stringify(parsed),
          now,
          claim.claimId,
          this.runId,
          bindingDigest,
          operation,
          operation,
        );
      if (updated.changes !== 1) throw new Error("NON_SUBMIT_SNAPSHOT_CLAIM_MISSING");
      const latest = parsed.checkpoints.at(-1);
      if (latest?.state === "FILL_PREVIEW" && latest.previewDigest) {
        const existing = this.sqlite
          .prepare(
            `SELECT packet_digest AS packetDigest,preview_digest AS previewDigest,
                    snapshot_json AS snapshotJson
             FROM application_run_previews WHERE run_id=?`,
          )
          .get(this.runId) as
          | { packetDigest: string; previewDigest: string; snapshotJson: string }
          | undefined;
        if (existing) {
          if (
            existing.packetDigest !== this.packetDigest ||
            existing.previewDigest !== latest.previewDigest ||
            existing.snapshotJson !== JSON.stringify(latest)
          ) {
            throw new Error("NON_SUBMIT_PREVIEW_CONFLICT");
          }
        } else {
          this.sqlite
            .prepare(
              `INSERT INTO application_run_previews
               (id,run_id,packet_digest,preview_digest,snapshot_json,created_at)
               VALUES (?,?,?,?,?,?)`,
            )
            .run(
              randomUUID(),
              this.runId,
              this.packetDigest,
              latest.previewDigest,
              JSON.stringify(latest),
              now,
            );
        }
      }
    })();
  }

  checkpoints(): NonSubmitRunnerCheckpoint[] {
    const rows = this.sqlite
      .prepare(
        `SELECT effect_json AS effectJson FROM application_run_operations
         WHERE run_id=? ORDER BY created_at,rowid`,
      )
      .all(this.runId) as Array<{ effectJson: string }>;
    const bySequence = new Map<number, NonSubmitRunnerCheckpoint>();
    for (const { effectJson } of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(effectJson) as unknown;
      } catch {
        throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
      }
      if (effectJson === "{}") throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
      for (const checkpoint of parseSnapshot(parsed).checkpoints) {
        const prior = bySequence.get(checkpoint.sequence);
        if (prior && stableJson(prior) !== stableJson(checkpoint)) {
          throw new Error("NON_SUBMIT_SNAPSHOT_CONFLICT");
        }
        bySequence.set(checkpoint.sequence, checkpoint);
      }
    }
    return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
  }
}
