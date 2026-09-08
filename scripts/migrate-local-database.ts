import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { createDatabaseBackup } from "./lib/database-maintenance";
import { localDatabasePath } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const databasePath = localDatabasePath();
  const confirmed = process.argv.includes("--confirm");

  if (!confirmed) {
    let version = 0;
    if (existsSync(databasePath)) {
      const preview = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
      try {
        version = Number(preview.pragma("user_version", { simple: true }));
      } finally {
        preview.close();
      }
    }
    console.log(
      `MIGRATION_PREVIEW current_schema=${version} target_schema=2 pending=${Math.max(0, 2 - version)}`,
    );
    console.log("No changes made. Re-run with --confirm to create a verified backup and migrate.");
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  const existed = existsSync(databasePath);
  if (existed) {
    const manifest = await createDatabaseBackup({
      databasePath,
      backupRoot: join(dirname(databasePath), "private", "backups"),
    });
    console.log(
      `MIGRATION_BACKUP_VERIFIED id=${manifest.backupId} schema_version=${manifest.schemaVersion}`,
    );
  }

  const sqlite = new BetterSqlite3(databasePath);
  try {
    const integrity = sqlite.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("Database integrity check failed before migration.");
    const version = Number(sqlite.pragma("user_version", { simple: true }));
    const existingTables = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    const hasFoundation = existingTables.includes("jobs");
    if (existed && existingTables.length > 0 && !hasFoundation) {
      throw new Error("The selected database is not a recognized ApplyPilot database.");
    }
    const sourceSnapshot = hasFoundation
      ? sqlite
          .prepare(
            `SELECT id, job_id, source_id, external_id, source_url, payload_hash, discovered_at, fetched_at
             FROM job_source_records ORDER BY id`,
          )
          .all()
      : [];
    const sourceDigest = createHash("sha256").update(JSON.stringify(sourceSnapshot)).digest("hex");
    if (!hasFoundation) {
      sqlite.exec(
        readFileSync(
          new URL("../packages/database/drizzle/0000_applypilot_foundation.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    if (version < 1) {
      sqlite.exec(
        readFileSync(
          new URL("../packages/database/drizzle/0001_real_world_job_intake.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    if (version < 2) {
      sqlite.exec(
        readFileSync(
          new URL("../packages/database/drizzle/0002_personal_live_beta_core.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    const migratedSnapshot = sqlite
      .prepare(
        `SELECT id, job_id, source_id, external_id, source_url, payload_hash, discovered_at, fetched_at
         FROM job_source_records ORDER BY id`,
      )
      .all();
    const migratedDigest = createHash("sha256")
      .update(JSON.stringify(migratedSnapshot))
      .digest("hex");
    if (sourceSnapshot.length !== migratedSnapshot.length || sourceDigest !== migratedDigest) {
      throw new Error("Source-record row-count or hash verification failed after migration.");
    }
    const observationCount = Number(
      sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
    );
    const jobVersionCount = Number(
      sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get(),
    );
    const jobCount = Number(sqlite.prepare("SELECT count(*) FROM jobs").pluck().get());
    if (observationCount !== migratedSnapshot.length || jobVersionCount !== jobCount) {
      throw new Error("Beta observation/job-version mapping verification failed after migration.");
    }
    const foreignKeys = sqlite.pragma("foreign_key_check") as unknown[];
    const finalIntegrity = sqlite.pragma("integrity_check", { simple: true });
    if (foreignKeys.length || finalIntegrity !== "ok") {
      throw new Error("Database verification failed after migration.");
    }
    console.log(
      `MIGRATION_COMPLETE schema_version=${Number(sqlite.pragma("user_version", { simple: true }))} integrity=PASS foreign_key_issues=0`,
    );
  } finally {
    sqlite.close();
  }
}

void main();
