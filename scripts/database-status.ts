import { existsSync, statSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";

import { databaseSchemaStatus } from "./lib/database-schema";
import { localDatabasePath } from "./lib/runtime-safety";

const databasePath = localDatabasePath();
if (!existsSync(databasePath)) {
  console.log("DATABASE_STATUS absent migration=required");
  process.exit(0);
}
const sqlite = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
try {
  const version = Number(sqlite.pragma("user_version", { simple: true }));
  const integrity = sqlite.pragma("integrity_check", { simple: true });
  const foreignKeyIssues = (sqlite.pragma("foreign_key_check") as unknown[]).length;
  const schemaStatus = databaseSchemaStatus(version);
  console.log(
    `DATABASE_STATUS present bytes=${statSync(databasePath).size} schema_version=${version} pending_migrations=${schemaStatus.pendingMigrations} integrity=${integrity === "ok" ? "PASS" : "FAIL"} foreign_key_issues=${foreignKeyIssues}`,
  );
  if (integrity !== "ok" || foreignKeyIssues > 0 || schemaStatus.unsupported) process.exitCode = 1;
} finally {
  sqlite.close();
}
