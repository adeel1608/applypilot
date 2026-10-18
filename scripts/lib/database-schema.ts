import type BetterSqlite3 from "better-sqlite3";

export const CURRENT_DATABASE_SCHEMA_VERSION = 15;

export interface DatabaseSchemaStatus {
  pendingMigrations: number;
  unsupported: boolean;
}

export function databaseSchemaStatus(schemaVersion: number): DatabaseSchemaStatus {
  return {
    pendingMigrations: Math.max(0, CURRENT_DATABASE_SCHEMA_VERSION - schemaVersion),
    unsupported: schemaVersion > CURRENT_DATABASE_SCHEMA_VERSION,
  };
}

export function assertMigrationSchemaSupported(schemaVersion: number): void {
  if (databaseSchemaStatus(schemaVersion).unsupported) {
    throw new Error("DATABASE_SCHEMA_NEWER_THAN_APPLICATION");
  }
}

/** For reviewed SQL files that own their BEGIN/COMMIT; never nest another writer. */
export function applyTransactionMigration(sqlite: BetterSqlite3.Database, sql: string): void {
  if (sqlite.inTransaction) throw new Error("MIGRATION_TRANSACTION_ALREADY_ACTIVE");
  try {
    sqlite.exec(sql);
    if (sqlite.inTransaction) throw new Error("MIGRATION_TRANSACTION_NOT_COMMITTED");
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}
