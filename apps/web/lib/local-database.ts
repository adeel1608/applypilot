import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import { JobImportRepository, openApplyPilotDatabase } from "@applypilot/database";

type Connection = ReturnType<typeof openApplyPilotDatabase>;
let connection: Connection | null | undefined;

function databasePath(): string {
  const filename = process.env.APPLYPILOT_DB_FILENAME ?? "applypilot.local.sqlite";
  if (!/^[A-Za-z0-9._-]+\.sqlite$/.test(filename)) {
    throw new Error("INVALID_LOCAL_DATABASE_FILENAME");
  }
  return join(process.cwd(), "data", filename);
}

function hasImportSchema(sqlite: BetterSqlite3.Database): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_batches'")
      .get(),
  );
}

export function getLocalDatabase(): Connection | null {
  if (connection !== undefined) return connection;
  const path = databasePath();
  if (!existsSync(path)) {
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
