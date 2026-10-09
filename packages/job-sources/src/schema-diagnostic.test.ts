import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BoundedSourceSchemaDiagnosticSchema,
  SourceSchemaDiagnosticSchema,
} from "./source-capability";
import {
  decodeSourceSchemaDiagnostic,
  displaySourceSchemaDiagnostic,
  sourceSchemaDiagnostic,
} from "./schema-diagnostic";

function diagnostic(schema: z.ZodType, payload: unknown) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) throw new Error("FICTIONAL_FAILURE_REQUIRED");
  return sourceSchemaDiagnostic({
    error: parsed.error,
    payload,
    provider: "GREENHOUSE",
    operation: "LIST_JOBS",
  });
}

describe("closed provider schema diagnostics", () => {
  it.each([
    [undefined, "MISSING"],
    [null, "NULL"],
    ["PRIVATE_VALUE_CANARY", "STRING"],
    [12, "NUMBER"],
    [false, "BOOLEAN"],
    [[], "ARRAY"],
    [{ privateKey: "CANARY" }, "OBJECT"],
  ])("emits structural type only for %s", (value, expected) => {
    const output = diagnostic(
      z.object({ jobs: z.array(z.object({ title: z.literal("accepted") })) }),
      { jobs: [{ title: value }] },
    );
    expect(output.issues[0]).toMatchObject({
      boundary: "RECORD",
      recordIndex: 0,
      path: ["jobs", 0, "title"],
      actualStructuralType: expected,
    });
    expect(JSON.stringify(output)).not.toMatch(
      /PRIVATE_VALUE|privateKey|CANARY|message|stack|https|accepted/,
    );
    expect(decodeSourceSchemaDiagnostic(JSON.stringify(output))).toEqual({
      diagnostic: output,
      state: "CAPTURED",
    });
  });

  it("masks unknown paths, including provider-controlled union keys and messages", () => {
    const output = diagnostic(
      z.object({
        jobs: z.array(z.object({ PRIVATE_KEY_CANARY: z.union([z.string(), z.number()]) })),
      }),
      { jobs: [{ PRIVATE_KEY_CANARY: { value: "SECRET_CANARY" } }] },
    );
    expect(output.issues[0]).toMatchObject({
      path: ["jobs", 0, "OTHER"],
      category: "INVALID_UNION",
      actualStructuralType: "OBJECT",
    });
    expect(output.issues.slice(1).map((issue) => issue.expectedStructuralTypes)).toEqual([
      ["STRING"],
      ["NUMBER"],
    ]);
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE_KEY|SECRET|value|message|stack/i);
    expect(displaySourceSchemaDiagnostic(output)).toContain("OTHER");
  });

  it("caps emitted issues, inspected nodes, union depth and path depth independently", () => {
    const issues: z.core.$ZodIssue[] = Array.from({ length: 1000 }, () => ({
      code: "invalid_type",
      expected: "string",
      path: ["jobs", 0, ...Array<string>(20).fill("PRIVATE_KEY_CANARY")],
      message: "PRIVATE_MESSAGE_CANARY",
    }));
    const output = sourceSchemaDiagnostic({
      error: new z.ZodError(issues),
      payload: {},
      provider: "GREENHOUSE",
      operation: "LIST_JOBS",
    });
    expect(output.issues).toHaveLength(16);
    expect(output.inspectedIssueCount).toBe(256);
    expect(output.issues.every((issue) => issue.path.length === 8)).toBe(true);
    expect(output.truncated).toBe(true);
    let issue: z.core.$ZodIssue = {
      code: "invalid_type",
      expected: "number",
      path: [],
      message: "PRIVATE_MESSAGE_CANARY",
    };
    for (let index = 0; index < 50; index++)
      issue = {
        code: "invalid_union",
        path: [],
        message: "PRIVATE_MESSAGE_CANARY",
        errors: [[issue]],
      };
    const union = sourceSchemaDiagnostic({
      error: new z.ZodError([issue]),
      payload: null,
      provider: "GREENHOUSE",
      operation: "GET_JOB",
    });
    expect(union.inspectedIssueCount).toBe(5);
    expect(union.truncated).toBe(true);
    expect(JSON.stringify([output, union])).not.toMatch(/PRIVATE_|message|stack/);
  });

  it("preserves closed legacy records and explicitly rejects unknown stored diagnostics", () => {
    const legacy = {
      field: "hostedUrl",
      expectedStructuralType: "url",
      issueCategory: "INVALID_URL",
      recordIndex: 1,
    };
    expect(decodeSourceSchemaDiagnostic(JSON.stringify(legacy))).toEqual({
      diagnostic: legacy,
      state: "CAPTURED",
    });
    expect(decodeSourceSchemaDiagnostic(null)).toEqual({ diagnostic: null, state: "ABSENT" });
    for (const invalid of [
      "{",
      JSON.stringify({ ...legacy, value: "SECRET_CANARY" }),
      JSON.stringify({ ...legacy, field: "PRIVATE_KEY" }),
      " ".repeat(16385),
    ])
      expect(decodeSourceSchemaDiagnostic(invalid)).toEqual({ diagnostic: null, state: "INVALID" });
    const good = diagnostic(z.object({ jobs: z.array(z.string()) }), { jobs: null });
    expect(
      BoundedSourceSchemaDiagnosticSchema.safeParse({ ...good, provider: "LEVER" }).success,
    ).toBe(false);
    expect(
      SourceSchemaDiagnosticSchema.safeParse({ ...good, issues: Array(17).fill(good.issues[0]) })
        .success,
    ).toBe(false);
  });
});
