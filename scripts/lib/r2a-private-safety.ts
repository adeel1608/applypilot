import { execFileSync } from "node:child_process";
import { relative, sep } from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import { CURRENT_DATABASE_SCHEMA_VERSION } from "./database-schema";

export const R2A_PRIVATE_CONFIRMATION = "REPROCESS_R2A_PRIVATE";

export function assertR2APrivateConfirmation(args: readonly string[]): void {
  if (!args.includes(`--confirm=${R2A_PRIVATE_CONFIRMATION}`)) {
    throw new Error(`R2A_PRIVATE_CONFIRMATION_REQUIRED:${R2A_PRIVATE_CONFIRMATION}`);
  }
}

export function assertPrivateDatabaseGitIsolation(databasePath: string, root: string): void {
  const repositoryPath = relative(root, databasePath).split(sep).join("/");
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", repositoryPath], { cwd: root });
  } catch {
    throw new Error("R2A_PRIVATE_DATABASE_NOT_IGNORED");
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", repositoryPath], {
      cwd: root,
      stdio: "ignore",
    });
    throw new Error("R2A_PRIVATE_DATABASE_TRACKED");
  } catch (error) {
    if (error instanceof Error && error.message === "R2A_PRIVATE_DATABASE_TRACKED") throw error;
  }
}

export function assertPrivateR2ADatabasePreflight(sqlite: BetterSqlite3.Database): string {
  const schemaVersion = Number(sqlite.pragma("user_version", { simple: true }));
  if (schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
    throw new Error("R2A_CURRENT_SCHEMA_REQUIRED");
  }
  if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("DATABASE_INTEGRITY_FAILED");
  }
  if ((sqlite.pragma("foreign_key_check") as unknown[]).length > 0) {
    throw new Error("DATABASE_FOREIGN_KEY_FAILED");
  }
  const jobIds = sqlite.prepare("SELECT id FROM jobs ORDER BY id").pluck().all() as string[];
  if (jobIds.length !== 1) throw new Error("PRIVATE_R2A_REPROCESS_REQUIRES_ONE_STORED_JOB");
  const supportedRecords = Number(
    sqlite
      .prepare(
        `SELECT count(*) FROM import_records r
         JOIN import_batches b ON b.id = r.batch_id
         WHERE r.normalized_job_id = ?
           AND r.record_status IN ('IMPORTED','UPDATED','DUPLICATE')
           AND b.detected_jobs = 1
           AND b.input_type IN ('PASTED_SINGLE','PASTED_MULTI','PASTED_HTML','FILE_UPLOAD')
           AND r.acquisition_method IN ('USER_SUPPLIED_CONTENT','FILE_UPLOAD')`,
      )
      .pluck()
      .get(jobIds[0]),
  );
  if (supportedRecords !== 1) throw new Error("R2A_SUPPORTED_PROVENANCE_REQUIRED");
  return jobIds[0]!;
}
