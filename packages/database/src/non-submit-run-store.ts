import { randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import type {
  NonSubmitDurableSnapshot,
  NonSubmitDurableStore,
  NonSubmitRunnerCheckpoint,
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

/** SQLite-backed operation claims/checkpoints for the synthetic non-submit lane. */
export class SqliteNonSubmitRunStore implements NonSubmitDurableStore {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly runId: string,
    private readonly packetDigest: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    assertDigest(packetDigest, "PACKET_DIGEST");
  }

  load(bindingDigest: string): NonSubmitDurableSnapshot | null {
    const row = this.sqlite
      .prepare(
        `SELECT effect_json AS effectJson FROM application_run_operations
         WHERE run_id=? AND binding_digest=? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.runId, bindingDigest) as { effectJson: string } | undefined;
    if (!row) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.effectJson) as unknown;
    } catch {
      throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
    }
    return parseSnapshot(parsed);
  }

  claim(bindingDigest: string, operation: RunnerTargetOperation): boolean {
    if (!["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"].includes(operation)) {
      throw new Error("NON_SUBMIT_OPERATION_FORBIDDEN");
    }
    const inProgress = this.sqlite
      .prepare(
        `SELECT 1 FROM application_run_operations
         WHERE run_id=? AND binding_digest=? AND state='CLAIMED' LIMIT 1`,
      )
      .get(this.runId, bindingDigest);
    if (inProgress) return false;
    const now = this.now().toISOString();
    try {
      this.sqlite
        .prepare(
          `INSERT INTO application_run_operations
           (id,run_id,binding_digest,operation,operation_key,state,effect_json,created_at,updated_at)
           VALUES (?,?,?,?,?,'CLAIMED','{}',?,?)`,
        )
        .run(randomUUID(), this.runId, bindingDigest, operation, operation, now, now);
      return true;
    } catch (error) {
      if (String(error).includes("UNIQUE")) return false;
      throw error;
    }
  }

  save(bindingDigest: string, snapshot: NonSubmitDurableSnapshot): void {
    assertDigest(bindingDigest, "BINDING_DIGEST");
    const parsed = parseSnapshot(snapshot);
    const now = this.now().toISOString();
    const operation = parsed.claimedOperations.at(-1);
    if (!operation) return;
    this.sqlite.transaction(() => {
      const updated = this.sqlite
        .prepare(
          `UPDATE application_run_operations
           SET state=?, effect_json=?, updated_at=?
           WHERE run_id=? AND binding_digest=? AND operation_key=?`,
        )
        .run(parsed.state, JSON.stringify(parsed), now, this.runId, bindingDigest, operation);
      if (updated.changes !== 1) throw new Error("NON_SUBMIT_SNAPSHOT_CLAIM_MISSING");
      const latest = parsed.checkpoints.at(-1);
      if (latest?.state === "FILL_PREVIEW" && latest.previewDigest) {
        this.sqlite
          .prepare(
            `INSERT INTO application_run_previews
             (id,run_id,packet_digest,preview_digest,snapshot_json,created_at)
             SELECT ?,?,?,?, ?,?
             WHERE NOT EXISTS (SELECT 1 FROM application_run_previews WHERE run_id=?)`,
          )
          .run(
            randomUUID(),
            this.runId,
            this.packetDigest,
            latest.previewDigest,
            JSON.stringify(latest),
            now,
            this.runId,
          );
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
    return rows.flatMap(({ effectJson }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(effectJson) as unknown;
      } catch {
        throw new Error("NON_SUBMIT_SNAPSHOT_CORRUPT");
      }
      return parseSnapshot(parsed).checkpoints;
    });
  }
}
