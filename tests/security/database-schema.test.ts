import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current R2 schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(11);
    expect(databaseSchemaStatus(11)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 9, unsupported: false });
    expect(databaseSchemaStatus(12)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(12)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(11)).not.toThrow();
  });
});
