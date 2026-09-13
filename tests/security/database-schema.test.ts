import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current R2 schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(8);
    expect(databaseSchemaStatus(8)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 6, unsupported: false });
    expect(databaseSchemaStatus(9)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(9)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(8)).not.toThrow();
  });
});
