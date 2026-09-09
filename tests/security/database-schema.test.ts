import { describe, expect, it } from "vitest";

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  assertMigrationSchemaSupported,
  databaseSchemaStatus,
} from "../../scripts/lib/database-schema";

describe("database schema readiness", () => {
  it("accepts the current R2A schema without a pending migration", () => {
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(3);
    expect(databaseSchemaStatus(3)).toEqual({ pendingMigrations: 0, unsupported: false });
  });

  it("reports older and future schemas conservatively", () => {
    expect(databaseSchemaStatus(2)).toEqual({ pendingMigrations: 1, unsupported: false });
    expect(databaseSchemaStatus(4)).toEqual({ pendingMigrations: 0, unsupported: true });
    expect(() => assertMigrationSchemaSupported(4)).toThrow(
      "DATABASE_SCHEMA_NEWER_THAN_APPLICATION",
    );
    expect(() => assertMigrationSchemaSupported(3)).not.toThrow();
  });
});
