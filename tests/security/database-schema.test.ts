import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current R2 schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(5);
    expect(databaseSchemaStatus(5)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 3, unsupported: false });
    expect(databaseSchemaStatus(6)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(6)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(5)).not.toThrow();
  });
});
