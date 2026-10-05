import { z } from "zod";

export const R2ASubphaseSchema = z.enum([
  "R2A_SOURCE_SERIALIZE",
  "R2A_INDEX_STRUCTURED_SPANS",
  "R2A_JSON_STRING_OFFSETS",
  "R2A_STRUCTURED_STRING_CHUNKS",
  "R2A_LOCATION_EXTRACTION",
  "R2A_FIELD_EVIDENCE",
  "R2A_REQUIREMENT_EXTRACTION",
  "R2A_COVERAGE",
  "R2A_POINTER_ASSERTION",
  "R2A_SCHEMA_PARSE",
  "R2A_OTHER",
]);
export type R2ASubphase = z.infer<typeof R2ASubphaseSchema>;

export const R2ARangeErrorClassSchema = z.enum([
  "RANGE_MAX_CALL_STACK",
  "RANGE_INVALID_ARRAY_LENGTH",
  "RANGE_STRING_TOO_LARGE",
  "RANGE_OTHER",
]);
export type R2ARangeErrorClass = z.infer<typeof R2ARangeErrorClassSchema>;

export const R2ASchemaFailureClassSchema = z.enum([
  "DUPLICATE_EVIDENCE_ID",
  "CONFLICT_MEMBER_LINK",
  "OTHER_SCHEMA_INVALID",
]);
export type R2ASchemaFailureClass = z.infer<typeof R2ASchemaFailureClassSchema>;

export const R2AStructureBucketSchema = z
  .object({
    depth: z.enum(["DEPTH_0_4", "DEPTH_5_16", "DEPTH_17_64", "DEPTH_65_256", "DEPTH_257_PLUS"]),
    nodes: z.enum(["NODES_0_16", "NODES_17_256", "NODES_257_4096", "NODES_4097_PLUS"]),
  })
  .strict();

export const R2AStructuralMetricsSchema = z
  .object({
    sourceTextLength: z.number().int().nonnegative().max(2_000_000),
    structuredJsonLength: z.number().int().nonnegative().max(2_000_000).nullable(),
    maxDepth: z.number().int().nonnegative().max(4096),
    nodeCount: z.number().int().nonnegative().max(50_000),
    scalarCount: z.number().int().nonnegative().max(50_000),
    maxArrayLength: z.number().int().nonnegative().max(50_000),
    maxStringLength: z.number().int().nonnegative().max(2_000_000),
    descriptionLength: z.number().int().nonnegative().max(2_000_000),
    metricsCapped: z.boolean(),
    departments: R2AStructureBucketSchema,
    offices: R2AStructureBucketSchema,
    providerMetadata: R2AStructureBucketSchema,
  })
  .strict();
export type R2AStructuralMetrics = z.infer<typeof R2AStructuralMetricsSchema>;

export const R2AFailureDiagnosticSchema = z
  .object({
    subphase: R2ASubphaseSchema,
    rangeErrorClass: R2ARangeErrorClassSchema.nullable(),
    structuralBudget: z
      .enum(["SOURCE_LENGTH", "DEPTH", "NODES", "ARRAY_LENGTH", "STRING_LENGTH"])
      .nullable(),
    metrics: R2AStructuralMetricsSchema,
    schemaFailureClasses: z.array(R2ASchemaFailureClassSchema).min(1).max(3).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.schemaFailureClasses &&
      (value.subphase !== "R2A_SCHEMA_PARSE" ||
        new Set(value.schemaFailureClasses).size !== value.schemaFailureClasses.length)
    )
      context.addIssue({
        code: "custom",
        path: ["schemaFailureClasses"],
        message: "schema classes require the final schema boundary and unique closed values",
      });
  });
export type R2AFailureDiagnostic = z.infer<typeof R2AFailureDiagnosticSchema>;

/** Inspect locally; only the closed enum may leave the catch boundary. */
export function classifyR2ARangeError(error: unknown): R2ARangeErrorClass | null {
  if (!(error instanceof RangeError)) return null;
  if (/maximum call stack|too much recursion/i.test(error.message)) return "RANGE_MAX_CALL_STACK";
  if (/invalid array length/i.test(error.message)) return "RANGE_INVALID_ARRAY_LENGTH";
  if (/invalid string length|string too large/i.test(error.message))
    return "RANGE_STRING_TOO_LARGE";
  return "RANGE_OTHER";
}

/** Map controlled schema invariants locally; never retain messages, paths, or values. */
export function classifyR2ASchemaFailure(error: unknown): R2ASchemaFailureClass[] | null {
  if (!(error instanceof z.ZodError)) return null;
  const classes = new Set<R2ASchemaFailureClass>();
  for (const issue of error.issues) {
    classes.add(
      issue.message.startsWith("duplicate evidence id:")
        ? "DUPLICATE_EVIDENCE_ID"
        : issue.message === "conflict members must be linked conflicting evidence"
          ? "CONFLICT_MEMBER_LINK"
          : "OTHER_SCHEMA_INVALID",
    );
  }
  return classes.size ? [...classes] : null;
}
