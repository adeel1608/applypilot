import { z } from "zod";

import {
  BoundedSourceSchemaDiagnosticSchema,
  SourceContractPathTokenSchema,
  SourceSchemaDiagnosticSchema,
  type SourceSchemaDiagnostic,
  type SourceOperation,
} from "./source-capability";

export const GREENHOUSE_PUBLIC_READER_VERSION = "greenhouse-public-v2.1" as const;
export const SOURCE_SCHEMA_DIAGNOSTIC_LIMITS = Object.freeze({
  issues: 16,
  inspectedNodes: 256,
  unionDepth: 4,
  pathDepth: 8,
  jsonBytes: 16_384,
});
type Issue = z.core.$ZodIssue;
type StructuralType = z.infer<
  typeof BoundedSourceSchemaDiagnosticSchema
>["issues"][number]["actualStructuralType"];

function structural(value: unknown): StructuralType {
  if (value === undefined) return "MISSING";
  if (value === null) return "NULL";
  if (Array.isArray(value)) return "ARRAY";
  switch (typeof value) {
    case "string":
      return "STRING";
    case "number":
      return "NUMBER";
    case "boolean":
      return "BOOLEAN";
    case "object":
      return "OBJECT";
    default:
      throw new Error("SCHEMA_DIAGNOSTIC_INPUT_INVALID");
  }
}

function expected(issue: Issue): StructuralType[] {
  const value = "expected" in issue ? issue.expected : "origin" in issue ? issue.origin : undefined;
  switch (value) {
    case "string":
      return ["STRING"];
    case "int":
    case "number":
      return ["NUMBER"];
    case "boolean":
      return ["BOOLEAN"];
    case "array":
    case "tuple":
      return ["ARRAY"];
    case "object":
    case "record":
      return ["OBJECT"];
    case "null":
      return ["NULL"];
    case "undefined":
      return ["MISSING"];
    default:
      return ["MISSING", "NULL", "STRING", "NUMBER", "BOOLEAN", "ARRAY", "OBJECT"];
  }
}

function actualAtPath(root: unknown, path: readonly PropertyKey[]): StructuralType {
  let value = root;
  for (const token of path.slice(0, SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.pathDepth)) {
    if (value === null || typeof value !== "object") return "MISSING";
    // Do not execute getters or traverse inherited/prototype properties.
    const descriptor = Object.getOwnPropertyDescriptor(value, token);
    if (!descriptor || !("value" in descriptor)) return "MISSING";
    value = descriptor.value;
  }
  return structural(value);
}

/** Only structural enums cross this boundary. Zod messages, inputs and unknown keys never do. */
export function sourceSchemaDiagnostic(input: {
  error: z.ZodError;
  payload: unknown;
  provider: "GREENHOUSE" | "LEVER";
  operation: SourceOperation;
}): z.infer<typeof BoundedSourceSchemaDiagnosticSchema> {
  const queue = input.error.issues
    .slice(0, SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes)
    .map((issue) => ({ issue, depth: 0 }));
  const issues: z.infer<typeof BoundedSourceSchemaDiagnosticSchema>["issues"] = [];
  let inspectedIssueCount = 0;
  let truncated = input.error.issues.length > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes;
  while (queue.length && inspectedIssueCount < SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes) {
    const node = queue.shift()!;
    inspectedIssueCount++;
    const originalPath = node.issue.path;
    const path = originalPath.slice(0, SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.pathDepth).map((token) => {
      if (typeof token === "number" && Number.isInteger(token) && token >= 0 && token <= 1_000_000)
        return token;
      const known = SourceContractPathTokenSchema.safeParse(token);
      return known.success ? known.data : ("OTHER" as const);
    });
    if (originalPath.length > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.pathDepth) truncated = true;
    const recordIndex =
      input.operation === "LIST_JOBS"
        ? input.provider === "GREENHOUSE" &&
          originalPath[0] === "jobs" &&
          typeof originalPath[1] === "number"
          ? originalPath[1]
          : input.provider === "LEVER" && typeof originalPath[0] === "number"
            ? originalPath[0]
            : undefined
        : 0;
    const actualStructuralType = actualAtPath(input.payload, originalPath);
    const category =
      node.issue.code === "invalid_type"
        ? actualStructuralType === "MISSING"
          ? "MISSING_REQUIRED"
          : "FIELD_TYPE_MISMATCH"
        : node.issue.code === "invalid_union"
          ? "INVALID_UNION"
          : node.issue.code === "invalid_format"
            ? "INVALID_FORMAT"
            : node.issue.code === "invalid_value"
              ? "INVALID_VALUE"
              : node.issue.code === "too_big" || node.issue.code === "too_small"
                ? "SIZE_CONSTRAINT"
                : "OTHER";
    if (issues.length < SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.issues)
      issues.push({
        boundary: recordIndex === undefined ? "ENVELOPE" : "RECORD",
        ...(recordIndex === undefined ? {} : { recordIndex: Math.min(recordIndex, 1_000_000) }),
        path,
        expectedStructuralTypes:
          originalPath.length > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.pathDepth
            ? ["MISSING", "NULL", "STRING", "NUMBER", "BOOLEAN", "ARRAY", "OBJECT"]
            : expected(node.issue),
        actualStructuralType,
        category:
          originalPath.length > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.pathDepth ? "OTHER" : category,
      });
    else truncated = true;
    if (node.issue.code === "invalid_union") {
      if (node.depth >= SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.unionDepth) truncated = true;
      else {
        if (node.issue.errors.length > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes)
          truncated = true;
        for (const branch of node.issue.errors.slice(
          0,
          SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes,
        )) {
          for (const issue of branch) {
            if (
              queue.length + inspectedIssueCount >=
              SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes
            ) {
              truncated = true;
              break;
            }
            queue.push({ issue, depth: node.depth + 1 });
          }
          if (queue.length + inspectedIssueCount >= SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.inspectedNodes)
            break;
        }
      }
    }
  }
  if (queue.length) truncated = true;
  return BoundedSourceSchemaDiagnosticSchema.parse({
    schemaVersion: 2,
    provider: input.provider,
    operation: input.operation,
    readerVersion:
      input.provider === "GREENHOUSE" ? GREENHOUSE_PUBLIC_READER_VERSION : "lever-public-v2",
    issues,
    inspectedIssueCount,
    truncated,
  });
}

export function decodeSourceSchemaDiagnostic(value: unknown): {
  diagnostic: SourceSchemaDiagnostic | null;
  state: "ABSENT" | "CAPTURED" | "INVALID";
} {
  if (value === null || value === undefined) return { diagnostic: null, state: "ABSENT" };
  try {
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > SOURCE_SCHEMA_DIAGNOSTIC_LIMITS.jsonBytes
    )
      return { diagnostic: null, state: "INVALID" };
    const parsed = SourceSchemaDiagnosticSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? { diagnostic: parsed.data, state: "CAPTURED" }
      : { diagnostic: null, state: "INVALID" };
  } catch {
    return { diagnostic: null, state: "INVALID" };
  }
}

export function displaySourceSchemaDiagnostic(value: SourceSchemaDiagnostic): string {
  const diagnostic = SourceSchemaDiagnosticSchema.parse(value);
  if (!("schemaVersion" in diagnostic))
    return `${diagnostic.issueCategory} / ${diagnostic.field} / expected ${diagnostic.expectedStructuralType}${diagnostic.recordIndex === undefined ? "" : ` / record ${diagnostic.recordIndex}`}`;
  return (
    `${diagnostic.provider} / ${diagnostic.operation} / ${diagnostic.readerVersion}: ` +
    diagnostic.issues
      .map(
        (issue) =>
          `${issue.boundary}${issue.recordIndex === undefined ? "" : ` ${issue.recordIndex}`} / ${issue.path.join("/") || "ROOT"} / ${issue.category} / expected ${issue.expectedStructuralTypes.join("|")} / actual ${issue.actualStructuralType}`,
      )
      .join("; ") +
    ` / inspected ${diagnostic.inspectedIssueCount}${diagnostic.truncated ? " / TRUNCATED" : ""}`
  );
}
