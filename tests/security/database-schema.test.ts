import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(14);
    expect(databaseSchemaStatus(14)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(12)).toEqual({ pendingMigrations: 2, unsupported: false });
    expect(databaseSchemaStatus(11)).toEqual({ pendingMigrations: 3, unsupported: false });
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 12, unsupported: false });
    expect(databaseSchemaStatus(15)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(15)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(14)).not.toThrow();
  });
});
