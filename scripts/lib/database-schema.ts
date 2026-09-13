export const CURRENT_DATABASE_SCHEMA_VERSION = 8;

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
