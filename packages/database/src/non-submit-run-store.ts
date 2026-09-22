import { randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import type {
  NonSubmitDurableSnapshot,
  NonSubmitDurableStore,
  NonSubmitRunnerCheckpoint,
  RunnerTargetOperation,
} from "@applypilot/application-runner";

/** SQLite-backed operation claims/checkpoints for the synthetic non-submit lane. */
export class SqliteNonSubmitRunStore implements NonSubmitDurableStore {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly runId: string,
    private readonly packetDigest: string = "0".repeat(64),
    private readonly now: () => Date = () => new Date(),
  ) {}

  load(bindingDigest: string): NonSubmitDurableSnapshot | null {
    const row = this.sqlite
      .prepare(
        `SELECT effect_json AS effectJson FROM application_run_operations
         WHERE run_id=? AND binding_digest=? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(this.runId, bindingDigest) as { effectJson: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.effectJson) as NonSubmitDurableSnapshot;
      if (
        !parsed ||
        !Array.isArray(parsed.checkpoints) ||
        !Array.isArray(parsed.claimedOperations)
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
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
    const now = this.now().toISOString();
    const operation = snapshot.claimedOperations.at(-1);
    if (!operation) return;
    const effectJson = JSON.stringify(snapshot);
    this.sqlite
      .prepare(
        `UPDATE application_run_operations
         SET state=?, effect_json=?, updated_at=?
         WHERE run_id=? AND binding_digest=? AND operation_key=?`,
      )
      .run(snapshot.state, effectJson, now, this.runId, bindingDigest, operation);
    const latest = snapshot.checkpoints.at(-1);
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
  }

  checkpoints(): NonSubmitRunnerCheckpoint[] {
    const rows = this.sqlite
      .prepare(
        `SELECT effect_json AS effectJson FROM application_run_operations
         WHERE run_id=? ORDER BY created_at,rowid`,
      )
      .all(this.runId) as Array<{ effectJson: string }>;
    return rows.flatMap(({ effectJson }) => {
      try {
        const snapshot = JSON.parse(effectJson) as NonSubmitDurableSnapshot;
        return snapshot.checkpoints ?? [];
      } catch {
        return [];
      }
    });
  }
}
