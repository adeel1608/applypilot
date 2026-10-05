import { z } from "zod";

export const R2ASubphaseSchema = z.enum([
  "R2A_SOURCE_SERIALIZE",
  "R2A_INDEX_STRUCTURED_SPANS",
  "R2A_JSON_STRING_OFFSETS",
  "R2A_STRUCTURED_STRING_CHUNKS",
  "R2A_LOCATION_EXTRACTION",
  "R2A_FIELD_EVIDENCE",
  "R2A_REQUIREMENT_EXTRACTION",
  "R2A_EVIDENCE_ID_RESOLUTION",
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

const safeEvidencePathSegments = new Set([
  "UNSAFE_PATH",
  "FIELD",
  "structured",
  "visibleText",
  "sections",
  "description",
  "item",
  "clause",
  "chunk",
  "line",
  "extract",
  "derived",
  "sourceSections",
  "content",
  "title",
  "name",
  "hiringOrganization",
  "legalName",
  "company",
  "jobLocation",
  "location",
  "address",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
  "streetAddress",
  "text",
  "applicantLocationRequirements",
  "employmentType",
  "workHours",
  "baseSalary",
  "salaryText",
  "hoursText",
  "datePosted",
  "validThrough",
  "value",
  "minValue",
  "maxValue",
  "currency",
  "unitText",
  "salaryCurrency",
  "minimumSalary",
  "maximumSalary",
  "jobBenefits",
  "workplaceType",
  "requirements",
  "responsibilities",
  "qualifications",
  "experienceRequirements",
  "educationRequirements",
]);
const safeEvidenceFamilies = new Set([
  "IDENTITY",
  "GEOGRAPHY",
  "EMPLOYMENT",
  "HOURS",
  "SCHEDULE",
  "COMPENSATION",
  "DATES",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "LICENCES",
  "CERTIFICATIONS",
  "WORK_RIGHTS",
  "VEHICLE",
  "PHYSICAL_REQUIREMENTS",
  "TRAINING",
  "DOCUMENTS",
]);

function isSafeEvidenceDiagnosticSourcePath(value: string): boolean {
  if (value.length > 256) return false;
  return value.split(".").every((segment) => {
    if (safeEvidencePathSegments.has(segment) || /^(?:0|[1-9]\d{0,5})$/.test(segment)) {
      return true;
    }
    const indexedProperty = /^([A-Za-z][A-Za-z0-9_]*)\[(?:0|[1-9]\d{0,5})\]$/.exec(segment);
    if (indexedProperty && safeEvidencePathSegments.has(indexedProperty[1]!)) return true;
    const extractedFamily = /^extract\[([A-Z_]+)\]$/.exec(segment);
    return Boolean(extractedFamily && safeEvidenceFamilies.has(extractedFamily[1]!));
  });
}

const R2AEvidenceCollisionIdentitySchema = z
  .object({
    domain: z.enum(["FIELD", "REQUIREMENT"]),
    family: z.enum([
      "IDENTITY",
      "GEOGRAPHY",
      "EMPLOYMENT",
      "HOURS",
      "SCHEDULE",
      "COMPENSATION",
      "DATES",
      "SKILLS",
      "EXPERIENCE",
      "EDUCATION",
      "LICENCES",
      "CERTIFICATIONS",
      "WORK_RIGHTS",
      "VEHICLE",
      "PHYSICAL_REQUIREMENTS",
      "TRAINING",
      "DOCUMENTS",
    ]),
    canonicalField: z
      .enum([
        "title",
        "company",
        "location.alternative",
        "location.region",
        "location.locality",
        "location.state",
        "location.postcode",
        "location.country",
        "employment.type",
        "dates.posted",
        "dates.closing",
        "hours.structured",
        "hours.day",
        "hours.week",
        "hours.fortnight",
        "hours.month",
        "hours.unknown",
        "salary",
        "salary.minimum",
        "salary.maximum",
        "salary.currency",
        "salary.period",
        "schedule",
        "documents.cvResume",
        "documents.coverLetter",
        "documents.selectionCriteria",
        "documents.portfolio",
        "documents.transcript",
        "documents.licenceCertificateCopy",
        "commute.duration",
        "commute.distance",
        "travel.percentage",
        "training",
        "UNSAFE_FIELD",
      ])
      .nullable(),
    canonicalKind: z
      .enum([
        "WORK_RIGHTS",
        "LEGAL_HOURS",
        "CANDIDATE_HOURS",
        "QUALIFICATION",
        "LICENCE",
        "CERTIFICATION",
        "VEHICLE",
        "AVAILABILITY",
        "LOCATION",
        "EXPERIENCE",
        "SKILL",
        "PHYSICAL",
        "AGE",
        "DOCUMENT",
        "GENERAL",
      ])
      .nullable(),
    sourcePath: z
      .string()
      .regex(/^[A-Za-z0-9_.\[\]_-]{1,256}$/)
      .refine(isSafeEvidenceDiagnosticSourcePath, "source path must use safe structural tokens"),
    start: z.number().int().nonnegative().max(2_000_000),
    end: z.number().int().nonnegative().max(2_000_000),
    ruleId: z.string().regex(/^[A-Z0-9_]{1,128}$/),
    state: z.enum([
      "SOURCE_STATED",
      "OWNER_CORRECTED",
      "DERIVED",
      "UNKNOWN",
      "CONDITIONAL",
      "CONFLICTING",
    ]),
    normalizedValueKind: z.enum([
      "TEXT",
      "LOCATION",
      "EMPLOYMENT_TYPE",
      "HOURS",
      "SCHEDULE",
      "SALARY",
      "DOCUMENT",
      "EXPERIENCE",
      "EDUCATION",
      "LICENCE_CERTIFICATION",
      "WORK_RIGHTS",
      "VEHICLE_TRAVEL",
      "PHYSICAL",
      "TRAINING",
      "DATE",
      "UNKNOWN",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalShapeValid =
      value.domain === "FIELD"
        ? value.canonicalField !== null && value.canonicalKind === null
        : value.canonicalField === null && value.canonicalKind !== null;
    if (!canonicalShapeValid) {
      context.addIssue({
        code: "custom",
        path: ["canonicalField"],
        message: "collision identity canonical field must match its evidence domain",
      });
    }
    if (value.end < value.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "collision identity range must be ordered",
      });
    }
  });
export type R2AEvidenceCollisionIdentity = z.infer<typeof R2AEvidenceCollisionIdentitySchema>;

const R2AEvidenceCollisionGroupSchema = z
  .object({
    duplicateCount: z.number().int().min(2).max(1_000_000),
    identities: z.array(R2AEvidenceCollisionIdentitySchema).min(2).max(16),
    identitiesTruncated: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.identitiesTruncated && value.duplicateCount <= value.identities.length) ||
      (!value.identitiesTruncated && value.duplicateCount !== value.identities.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["identitiesTruncated"],
        message: "collision identity truncation must match the duplicate count",
      });
    }
  });
export type R2AEvidenceCollisionGroup = z.infer<typeof R2AEvidenceCollisionGroupSchema>;

export const R2AFailureDiagnosticSchema = z
  .object({
    subphase: R2ASubphaseSchema,
    rangeErrorClass: R2ARangeErrorClassSchema.nullable(),
    structuralBudget: z
      .enum(["SOURCE_LENGTH", "DEPTH", "NODES", "ARRAY_LENGTH", "STRING_LENGTH"])
      .nullable(),
    metrics: R2AStructuralMetricsSchema,
    schemaFailureClasses: z.array(R2ASchemaFailureClassSchema).min(1).max(3).optional(),
    duplicateEvidenceIdGroups: z.array(R2AEvidenceCollisionGroupSchema).min(1).max(16).optional(),
    duplicateEvidenceIdGroupsTruncated: z.boolean().optional(),
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
    if (value.duplicateEvidenceIdGroups && value.subphase !== "R2A_EVIDENCE_ID_RESOLUTION")
      context.addIssue({
        code: "custom",
        path: ["duplicateEvidenceIdGroups"],
        message: "collision identities require the evidence-ID resolution boundary",
      });
    if (
      value.duplicateEvidenceIdGroups &&
      value.duplicateEvidenceIdGroups.some(({ identitiesTruncated }) => identitiesTruncated) &&
      value.duplicateEvidenceIdGroupsTruncated !== true
    )
      context.addIssue({
        code: "custom",
        path: ["duplicateEvidenceIdGroupsTruncated"],
        message: "truncated collision identities require the truncation marker",
      });
    if (
      value.duplicateEvidenceIdGroups &&
      value.duplicateEvidenceIdGroups.length < 16 &&
      value.duplicateEvidenceIdGroupsTruncated === true &&
      !value.duplicateEvidenceIdGroups.some(({ identitiesTruncated }) => identitiesTruncated)
    )
      context.addIssue({
        code: "custom",
        path: ["duplicateEvidenceIdGroupsTruncated"],
        message: "group truncation requires the maximum group count",
      });
    if (value.duplicateEvidenceIdGroupsTruncated !== undefined && !value.duplicateEvidenceIdGroups)
      context.addIssue({
        code: "custom",
        path: ["duplicateEvidenceIdGroupsTruncated"],
        message: "collision truncation requires identity groups",
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
