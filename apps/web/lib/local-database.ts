import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import {
  BetaRepository,
  JobImportRepository,
  R2Repository,
  RunnerEnablementRepository,
  SourceEnablementRepository,
  openApplyPilotDatabase,
} from "@applypilot/database";
import { resolveLocalDataDirectory } from "./local-data-directory";

type Connection = ReturnType<typeof openApplyPilotDatabase>;
let connection: Connection | null | undefined;

function databasePath(): string {
  const filename = process.env.APPLYPILOT_DB_FILENAME ?? "applypilot.local.sqlite";
  if (!/^[A-Za-z0-9._-]+\.sqlite$/.test(filename)) {
    throw new Error("INVALID_LOCAL_DATABASE_FILENAME");
  }
  // Local database files must not enter the deployment trace.
  return join(/* turbopackIgnore: true */ resolveLocalDataDirectory(), filename);
}

function hasImportSchema(sqlite: BetterSqlite3.Database): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_batches'")
      .get(),
  );
}

export function hasBetaSchema(sqlite: BetterSqlite3.Database): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_versions'").get(),
  );
}

export function getLocalDatabase(): Connection | null {
  if (connection !== undefined) return connection;
  const path = databasePath();
  if (!existsSync(/* turbopackIgnore: true */ path)) {
    connection = null;
    return null;
  }
  const opened = openApplyPilotDatabase(path);
  if (!hasImportSchema(opened.sqlite)) {
    opened.close();
    connection = null;
    return null;
  }
  connection = opened;
  return connection;
}

export function getJobImportRepository(): JobImportRepository | null {
  const local = getLocalDatabase();
  return local ? new JobImportRepository(local.sqlite) : null;
}

export function getBetaRepository(): BetaRepository | null {
  const local = getLocalDatabase();
  return local && hasBetaSchema(local.sqlite) ? new BetaRepository(local.sqlite) : null;
}

export function getR2Repository(): R2Repository | null {
  const local = getLocalDatabase();
  if (!local) return null;
  const repository = new R2Repository(local.sqlite);
  return repository.available() ? repository : null;
}

export function getSourceEnablementRepository(): SourceEnablementRepository | null {
  const local = getLocalDatabase();
  if (!local) return null;
  const repository = new SourceEnablementRepository(local.sqlite);
  return repository.available() ? repository : null;
}

export function getRunnerEnablementRepository(): RunnerEnablementRepository | null {
  const local = getLocalDatabase();
  if (
    !local ||
    !local.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runner_inspection_bindings'",
      )
      .get()
  )
    return null;
  return new RunnerEnablementRepository(local.sqlite);
}
