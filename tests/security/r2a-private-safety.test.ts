import { describe, expect, it } from "vitest";

import {
  R2A_PRIVATE_CONFIRMATION,
  assertPrivateR2ADatabasePreflight,
  assertR2APrivateConfirmation,
} from "../../scripts/lib/r2a-private-safety";

function fakeDatabase(input: {
  schema?: number;
  integrity?: string;
  foreignKeys?: unknown[];
  jobIds?: string[];
  supportedRecords?: number;
}) {
  return {
    pragma(statement: string) {
      if (statement === "user_version") return input.schema ?? 6;
      if (statement === "integrity_check") return input.integrity ?? "ok";
      if (statement === "foreign_key_check") return input.foreignKeys ?? [];
      throw new Error(`UNEXPECTED_PRAGMA:${statement}`);
    },
    prepare(statement: string) {
      return {
        pluck() {
          return {
            all: () => input.jobIds ?? ["job:fictional"],
            get: () => {
              if (statement.includes("import_records")) return input.supportedRecords ?? 1;
              throw new Error("UNEXPECTED_QUERY");
            },
          };
        },
      };
    },
  } as never;
}

describe("private R2A reprocess safety", () => {
  it("requires the exact explicit confirmation token", () => {
    expect(() => assertR2APrivateConfirmation([])).toThrow(
      `R2A_PRIVATE_CONFIRMATION_REQUIRED:${R2A_PRIVATE_CONFIRMATION}`,
    );
    expect(() => assertR2APrivateConfirmation(["--confirm=yes"])).toThrow();
    expect(() =>
      assertR2APrivateConfirmation([`--confirm=${R2A_PRIVATE_CONFIRMATION}`]),
    ).not.toThrow();
  });

  it("accepts only the current, healthy, single-job supported provenance", () => {
    expect(assertPrivateR2ADatabasePreflight(fakeDatabase({}))).toBe("job:fictional");
    expect(() => assertPrivateR2ADatabasePreflight(fakeDatabase({ schema: 7 }))).toThrow(
      "R2A_CURRENT_SCHEMA_REQUIRED",
    );
    expect(() => assertPrivateR2ADatabasePreflight(fakeDatabase({ integrity: "corrupt" }))).toThrow(
      "DATABASE_INTEGRITY_FAILED",
    );
    expect(() => assertPrivateR2ADatabasePreflight(fakeDatabase({ foreignKeys: [{}] }))).toThrow(
      "DATABASE_FOREIGN_KEY_FAILED",
    );
    expect(() => assertPrivateR2ADatabasePreflight(fakeDatabase({ jobIds: [] }))).toThrow(
      "PRIVATE_R2A_REPROCESS_REQUIRES_ONE_STORED_JOB",
    );
    expect(() => assertPrivateR2ADatabasePreflight(fakeDatabase({ supportedRecords: 2 }))).toThrow(
      "R2A_SUPPORTED_PROVENANCE_REQUIRED",
    );
  });
});
