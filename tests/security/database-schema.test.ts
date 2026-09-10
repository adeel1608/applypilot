import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current R2 schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(6);
    expect(databaseSchemaStatus(6)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 4, unsupported: false });
    expect(databaseSchemaStatus(7)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(7)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(6)).not.toThrow();
  });
});
