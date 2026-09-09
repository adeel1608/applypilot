import { z } from "zod";

import { RequirementKindSchema, RequirementModalitySchema } from "./beta";

export const R2A_PARSER_VERSION = "3.1.0";
export const R2A_EVIDENCE_CONTRACT_VERSION = "3.1.0";
export const R2A_NORMALIZATION_VERSION = "3.1.0";

export const JobEvidenceStateSchema = z.enum([
  "SOURCE_STATED",
  "OWNER_CORRECTED",
  "DERIVED",
  "UNKNOWN",
  "CONDITIONAL",
  "CONFLICTING",
]);
export const ExtractionCoverageStateSchema = z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]);
export const JobFieldFamilySchema = z.enum([
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

export const SourceEvidencePointerSchema = z
  .object({
    sourcePath: z.string().min(1).max(512),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    sourceLength: z.number().int().nonnegative(),
    excerpt: z.string().max(1000),
    excerptHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((value, context) => {
    if (value.end < value.start) {
      context.addIssue({ code: "custom", path: ["end"], message: "end must be >= start" });
    }
    if (value.end > value.sourceLength) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "end must be within the immutable source",
      });
    }
    if (value.end - value.start !== value.excerpt.length) {
      context.addIssue({
        code: "custom",
        path: ["excerpt"],
        message: "excerpt length must match the bounded source span",
      });
    }
  });

export const AustralianStateSchema = z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
export const WorkplaceTypeSchema = z.enum([
  "REMOTE",
  "HYBRID",
  "ON_SITE",
  "FIELD_BASED",
  "UNKNOWN",
]);
export const RemoteScopeSchema = z.enum(["LOCAL", "STATE", "NATIONAL", "INTERNATIONAL", "UNKNOWN"]);
export const AustralianLocationAlternativeSchema = z.object({
  rawLabel: z.string().min(1).max(1000),
  locality: z.string().min(1).max(200).nullable(),
  suburb: z.string().min(1).max(200).nullable(),
  stateOrTerritory: AustralianStateSchema.nullable(),
  postcode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  countryCode: z.enum(["AU", "UNKNOWN"]),
  workplaceType: WorkplaceTypeSchema,
  remoteScope: RemoteScopeSchema,
});

export const R2EmploymentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CASUAL",
  "CONTRACT",
  "TEMPORARY",
  "FIXED_TERM",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "VOLUNTEER",
  "OTHER",
  "UNKNOWN",
]);
export const HoursUnitSchema = z.enum(["DAY", "WEEK", "FORTNIGHT", "MONTH"]);
export const HoursValueSchema = z.object({
  minimum: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative().nullable(),
  unit: HoursUnitSchema,
});
export const RosterTypeSchema = z.enum(["FIXED", "FLEXIBLE", "ROTATING", "ON_CALL", "UNKNOWN"]);
export const ScheduleValueSchema = z.object({
  days: z.array(
    z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
  ),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  rosterType: RosterTypeSchema,
  overnight: z.boolean().nullable(),
  timezone: z.string().min(1).max(100).nullable(),
  exceptions: z.array(z.string().min(1).max(500)),
});
export const SalaryValueSchema = z.object({
  shape: z.enum(["EXACT", "RANGE", "FROM", "UP_TO", "APPROXIMATE", "UNKNOWN"]),
  minimum: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  period: z.enum(["HOUR", "DAY", "WEEK", "FORTNIGHT", "MONTH", "YEAR", "UNKNOWN"]),
  superannuation: z.enum(["INCLUDED", "EXCLUDED", "PLUS", "UNKNOWN"]),
  commission: z.boolean(),
  bonus: z.boolean(),
});

export const DocumentKindSchema = z.enum([
  "CV_RESUME",
  "COVER_LETTER",
  "SELECTION_CRITERIA",
  "PORTFOLIO",
  "TRANSCRIPT",
  "LICENCE_CERTIFICATE_COPY",
  "OTHER",
]);
export const TriStateRequirementSchema = z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]);
export const DocumentRequirementValueSchema = z.object({
  documentKind: DocumentKindSchema,
  state: TriStateRequirementSchema,
  name: z.string().min(1).max(300).nullable(),
});
export const ExperienceValueSchema = z.object({
  domain: z.string().min(1).max(500),
  minimum: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative().nullable(),
  unit: z.enum(["MONTH", "YEAR", "OCCURRENCE", "UNKNOWN"]),
  recency: z.string().min(1).max(300).nullable(),
  alternatives: z.array(z.string().min(1).max(500)),
  condition: z.string().min(1).max(1000).nullable(),
});
export const EducationValueSchema = z.object({
  level: z.string().min(1).max(200).nullable(),
  field: z.string().min(1).max(300).nullable(),
  equivalence: z.string().min(1).max(500).nullable(),
  completionRequired: z.boolean().nullable(),
  currentStudyAllowed: z.boolean().nullable(),
  condition: z.string().min(1).max(1000).nullable(),
});
export const LicenceCertificationValueSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum(["LICENCE", "CERTIFICATION"]),
  class: z.string().min(1).max(100).nullable(),
  jurisdiction: z.string().min(1).max(200).nullable(),
  validityRequirement: z.string().min(1).max(500).nullable(),
  alternatives: z.array(z.string().min(1).max(500)),
  condition: z.string().min(1).max(1000).nullable(),
});
export const WorkRightsValueSchema = z.object({
  kind: z.enum([
    "VALID_AUSTRALIAN_WORK_RIGHTS",
    "UNRESTRICTED_WORK_RIGHTS",
    "SPONSORSHIP_AVAILABLE",
    "SPONSORSHIP_NOT_AVAILABLE",
    "VISA_REQUIREMENT",
    "HOURS_CONDITION",
    "EXPIRY_CONDITION",
    "UNKNOWN",
  ]),
  wording: z.string().min(1).max(1000).nullable(),
  condition: z.string().min(1).max(1000).nullable(),
});
export const VehicleTravelValueSchema = z.object({
  kind: z.enum(["DRIVER_LICENCE", "OWN_VEHICLE", "VEHICLE_ACCESS", "TRAVEL", "COMMUTE"]),
  percentage: z.number().min(0).max(100).nullable(),
  location: z.string().min(1).max(500).nullable(),
  distanceKm: z.number().nonnegative().nullable(),
  durationMinutes: z.number().nonnegative().nullable(),
});
export const TrainingValueSchema = z.object({
  state: z.enum(["PROVIDED", "NOT_PROVIDED", "REQUIRED", "AVAILABLE", "UNKNOWN"]),
  name: z.string().min(1).max(500).nullable(),
});
export const DatePrecisionSchema = z.enum(["DATE_ONLY", "DATE_TIME", "UNKNOWN"]);
export const DateTimezoneStateSchema = z.enum(["KNOWN", "UNKNOWN"]);
export const DateValueSchema = z.union([
  // Historical 3.0.0 rows stored a nullable UTC timestamp directly. Keep them readable.
  z.iso.datetime(),
  z.null(),
  z
    .object({
      value: z.string().min(1).max(100).nullable(),
      precision: DatePrecisionSchema,
      timezone: DateTimezoneStateSchema,
      offset: z
        .string()
        .regex(/^(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/)
        .nullable(),
    })
    .superRefine((value, context) => {
      const validDateOnly = value.value ? /^\d{4}-\d{2}-\d{2}$/.test(value.value) : false;
      const hasDateTime = value.value?.includes("T") ?? false;
      const consistent =
        (value.precision === "UNKNOWN" &&
          value.value === null &&
          value.timezone === "UNKNOWN" &&
          value.offset === null) ||
        (value.precision === "DATE_ONLY" &&
          validDateOnly &&
          value.timezone === "UNKNOWN" &&
          value.offset === null) ||
        (value.precision === "DATE_TIME" &&
          hasDateTime &&
          ((value.timezone === "KNOWN" && value.offset !== null) ||
            (value.timezone === "UNKNOWN" && value.offset === null)));
      if (!consistent) {
        context.addIssue({
          code: "custom",
          message: "date precision, timezone, offset, and value must be internally consistent",
        });
      }
    }),
]);

export const R2NormalizedValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), value: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal("LOCATION"), value: AustralianLocationAlternativeSchema }),
  z.object({ kind: z.literal("EMPLOYMENT_TYPE"), value: R2EmploymentTypeSchema }),
  z.object({ kind: z.literal("HOURS"), value: HoursValueSchema }),
  z.object({ kind: z.literal("SCHEDULE"), value: ScheduleValueSchema }),
  z.object({ kind: z.literal("SALARY"), value: SalaryValueSchema }),
  z.object({ kind: z.literal("DOCUMENT"), value: DocumentRequirementValueSchema }),
  z.object({ kind: z.literal("EXPERIENCE"), value: ExperienceValueSchema }),
  z.object({ kind: z.literal("EDUCATION"), value: EducationValueSchema }),
  z.object({ kind: z.literal("LICENCE_CERTIFICATION"), value: LicenceCertificationValueSchema }),
  z.object({ kind: z.literal("WORK_RIGHTS"), value: WorkRightsValueSchema }),
  z.object({ kind: z.literal("VEHICLE_TRAVEL"), value: VehicleTravelValueSchema }),
  z.object({ kind: z.literal("PHYSICAL"), value: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal("TRAINING"), value: TrainingValueSchema }),
  z.object({ kind: z.literal("DATE"), value: DateValueSchema }),
  z.object({ kind: z.literal("UNKNOWN"), value: z.null() }),
]);

const EvidenceLinksSchema = z.object({
  derivationInputIds: z.array(z.string().min(1)).default([]),
  ownerCorrectionId: z.string().min(1).nullable().default(null),
  conflictSetId: z.string().min(1).nullable().default(null),
});
export const R2JobFieldEvidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceObservationId: z.string().min(1),
    jobVersionId: z.string().min(1).nullable().default(null),
    family: JobFieldFamilySchema,
    canonicalField: z.string().min(1).max(200),
    state: JobEvidenceStateSchema,
    modality: RequirementModalitySchema.nullable().default(null),
    source: SourceEvidencePointerSchema,
    normalizedValue: R2NormalizedValueSchema,
    extractorVersion: z.string().min(1),
    ruleId: z.string().min(1),
    ...EvidenceLinksSchema.shape,
  })
  .superRefine((value, context) => {
    if (value.state === "DERIVED" && value.derivationInputIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["derivationInputIds"],
        message: "derived evidence requires input evidence",
      });
    }
    if (value.state === "OWNER_CORRECTED" && !value.ownerCorrectionId) {
      context.addIssue({
        code: "custom",
        path: ["ownerCorrectionId"],
        message: "owner-corrected evidence requires a correction link",
      });
    }
    if (value.state === "CONFLICTING" && !value.conflictSetId) {
      context.addIssue({
        code: "custom",
        path: ["conflictSetId"],
        message: "conflicting evidence requires a conflict-set link",
      });
    }
  });
export const R2RequirementEvidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceObservationId: z.string().min(1),
    jobVersionId: z.string().min(1).nullable().default(null),
    family: JobFieldFamilySchema,
    canonicalKind: RequirementKindSchema,
    state: JobEvidenceStateSchema,
    modality: RequirementModalitySchema,
    condition: z.string().min(1).max(1000).nullable(),
    source: SourceEvidencePointerSchema,
    normalizedValue: R2NormalizedValueSchema,
    extractorVersion: z.string().min(1),
    ruleId: z.string().min(1),
    ...EvidenceLinksSchema.shape,
  })
  .superRefine((value, context) => {
    if (value.state === "DERIVED") {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "derived requirement evidence is not supported by the R2A persistence contract",
      });
    }
    if (value.derivationInputIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["derivationInputIds"],
        message: "requirement evidence cannot carry derivation inputs in R2A",
      });
    }
    if (value.state === "OWNER_CORRECTED" && !value.ownerCorrectionId) {
      context.addIssue({
        code: "custom",
        path: ["ownerCorrectionId"],
        message: "owner-corrected requirement evidence requires a correction link",
      });
    }
    if (value.state === "CONFLICTING" && !value.conflictSetId) {
      context.addIssue({
        code: "custom",
        path: ["conflictSetId"],
        message: "conflicting requirement evidence requires a conflict-set link",
      });
    }
    if (value.modality === "CONDITIONAL" && !value.condition) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "conditional requirement modality requires retained condition evidence",
      });
    }
    if (
      value.modality === "NEGATED" &&
      value.normalizedValue.kind === "DOCUMENT" &&
      value.normalizedValue.value.state !== "NOT_REQUIRED"
    ) {
      context.addIssue({
        code: "custom",
        path: ["normalizedValue"],
        message: "negated document evidence cannot normalize to a positive requirement",
      });
    }
  });

function canonicalPropositionToken(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /\b(?:must|required|essential|mandatory|preferred|preferably|desirable|optional|not|no|may|depending|where applicable|is|be|have|hold|current|valid)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function r2RequirementPropositionKey(
  evidence: z.infer<typeof R2RequirementEvidenceSchema>,
): string {
  const value = evidence.normalizedValue;
  let subject = evidence.canonicalKind.toLowerCase();
  if (value.kind === "DOCUMENT") subject = value.value.documentKind.toLowerCase();
  else if (value.kind === "LICENCE_CERTIFICATION") {
    subject = [
      value.value.type,
      canonicalPropositionToken(value.value.name),
      value.value.class ?? "",
      value.value.jurisdiction ?? "",
    ]
      .filter(Boolean)
      .join(":")
      .toLowerCase();
  } else if (value.kind === "WORK_RIGHTS") {
    subject = value.value.kind.startsWith("SPONSORSHIP_")
      ? "sponsorship"
      : value.value.kind.toLowerCase();
  } else if (value.kind === "EXPERIENCE") subject = canonicalPropositionToken(value.value.domain);
  else if (value.kind === "EDUCATION") {
    subject = canonicalPropositionToken(
      [value.value.level, value.value.field, value.value.equivalence].filter(Boolean).join(" "),
    );
  } else if (value.kind === "VEHICLE_TRAVEL") subject = value.value.kind.toLowerCase();
  else if (value.kind === "TEXT") subject = canonicalPropositionToken(value.value);
  else if (value.kind === "PHYSICAL") subject = canonicalPropositionToken(value.value);
  return `${evidence.canonicalKind}:${subject || "unknown"}`;
}

export function r2RequirementPolarity(
  evidence: z.infer<typeof R2RequirementEvidenceSchema>,
): "POSITIVE" | "NEGATED" | "UNKNOWN" {
  if (evidence.modality === "NEGATED") return "NEGATED";
  if (evidence.normalizedValue.kind === "DOCUMENT") {
    if (evidence.normalizedValue.value.state === "NOT_REQUIRED") return "NEGATED";
    if (evidence.normalizedValue.value.state === "REQUIRED") return "POSITIVE";
  }
  if (evidence.normalizedValue.kind === "WORK_RIGHTS") {
    if (evidence.normalizedValue.value.kind === "SPONSORSHIP_NOT_AVAILABLE") return "NEGATED";
    if (evidence.normalizedValue.value.kind === "SPONSORSHIP_AVAILABLE") return "POSITIVE";
  }
  return ["REQUIRED", "PREFERRED", "CONDITIONAL"].includes(evidence.modality)
    ? "POSITIVE"
    : "UNKNOWN";
}

export const R2ConflictSetSchema = z.object({
  id: z.string().min(1),
  canonicalField: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(2),
});
export const FieldFamilyCoverageSchema = z.object({
  family: JobFieldFamilySchema,
  state: ExtractionCoverageStateSchema,
  evidenceIds: z.array(z.string().min(1)),
  unparsedSpans: z.array(SourceEvidencePointerSchema),
  parserVersion: z.string().min(1),
});
export const R2ANormalizationSchema = z
  .object({
    sourceObservationId: z.string().min(1),
    sourceLength: z.number().int().nonnegative(),
    parserVersion: z.string().min(1),
    evidenceContractVersion: z.string().min(1),
    normalizationVersion: z.string().min(1),
    fieldEvidence: z.array(R2JobFieldEvidenceSchema),
    requirementEvidence: z.array(R2RequirementEvidenceSchema),
    conflicts: z.array(R2ConflictSetSchema),
    coverage: z.array(FieldFamilyCoverageSchema),
  })
  .superRefine((value, context) => {
    const evidence = [...value.fieldEvidence, ...value.requirementEvidence];
    const fieldEvidenceIds = new Set(value.fieldEvidence.map(({ id }) => id));
    const evidenceIds = new Set<string>();
    for (const [index, item] of evidence.entries()) {
      if (evidenceIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: [index < value.fieldEvidence.length ? "fieldEvidence" : "requirementEvidence"],
          message: `duplicate evidence id: ${item.id}`,
        });
      }
      evidenceIds.add(item.id);
      if (item.sourceObservationId !== value.sourceObservationId) {
        context.addIssue({
          code: "custom",
          path: ["sourceObservationId"],
          message: "evidence must link to the normalization source observation",
        });
      }
      if (item.source.sourceLength !== value.sourceLength) {
        context.addIssue({
          code: "custom",
          path: ["sourceLength"],
          message: "evidence span must use the normalization source length",
        });
      }
    }
    const coverageFamilies = new Set(value.coverage.map(({ family }) => family));
    if (
      value.coverage.length !== JobFieldFamilySchema.options.length ||
      coverageFamilies.size !== JobFieldFamilySchema.options.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "coverage must contain each field family exactly once",
      });
    }
    for (const row of value.coverage) {
      for (const evidenceId of row.evidenceIds) {
        const linked = evidence.find(({ id }) => id === evidenceId);
        if (!linked || linked.family !== row.family) {
          context.addIssue({
            code: "custom",
            path: ["coverage"],
            message: `coverage evidence does not belong to ${row.family}`,
          });
        }
      }
      if (row.state === "COMPLETE" && row.evidenceIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["coverage"],
          message: "empty evidence cannot claim COMPLETE coverage",
        });
      }
      for (const span of row.unparsedSpans) {
        if (span.sourceLength !== value.sourceLength) {
          context.addIssue({
            code: "custom",
            path: ["coverage"],
            message: "unparsed spans must use the normalization source length",
          });
        }
      }
    }
    const conflictIds = new Set<string>();
    for (const conflict of value.conflicts) {
      if (conflictIds.has(conflict.id)) {
        context.addIssue({
          code: "custom",
          path: ["conflicts"],
          message: `duplicate conflict id: ${conflict.id}`,
        });
      }
      conflictIds.add(conflict.id);
      const uniqueMemberIds = new Set(conflict.evidenceIds);
      if (uniqueMemberIds.size !== conflict.evidenceIds.length) {
        context.addIssue({
          code: "custom",
          path: ["conflicts"],
          message: "conflict sets cannot contain duplicate evidence members",
        });
      }
      const members = conflict.evidenceIds
        .map((evidenceId) => evidence.find(({ id }) => id === evidenceId))
        .filter((item): item is (typeof evidence)[number] => Boolean(item));
      for (const evidenceId of conflict.evidenceIds) {
        const item = evidence.find(({ id }) => id === evidenceId);
        if (!item || item.state !== "CONFLICTING" || item.conflictSetId !== conflict.id) {
          context.addIssue({
            code: "custom",
            path: ["conflicts"],
            message: "conflict members must be linked conflicting evidence",
          });
        }
      }
      const fieldMembers = members.filter((item) => "canonicalField" in item);
      const requirementMembers = members.filter((item) => "canonicalKind" in item);
      if (fieldMembers.length === members.length) {
        const canonicalFields = new Set(fieldMembers.map(({ canonicalField }) => canonicalField));
        const normalizedValues = new Set(
          fieldMembers.map(({ normalizedValue }) => JSON.stringify(normalizedValue)),
        );
        const isRegionConsistencyConflict =
          conflict.canonicalField === "location.region" &&
          canonicalFields.size === 2 &&
          canonicalFields.has("location.state") &&
          canonicalFields.has("location.postcode");
        if (
          !isRegionConsistencyConflict &&
          (canonicalFields.size !== 1 ||
            !canonicalFields.has(conflict.canonicalField) ||
            normalizedValues.size < 2)
        ) {
          context.addIssue({
            code: "custom",
            path: ["conflicts"],
            message: "field conflict sets require distinct values for one canonical field",
          });
        }
      } else if (requirementMembers.length === members.length) {
        const propositionKeys = new Set(requirementMembers.map(r2RequirementPropositionKey));
        const polarities = new Set(requirementMembers.map(r2RequirementPolarity));
        const propositionKey = [...propositionKeys][0];
        if (
          propositionKeys.size !== 1 ||
          !polarities.has("NEGATED") ||
          !polarities.has("POSITIVE") ||
          conflict.canonicalField !== `requirement:${propositionKey}`
        ) {
          context.addIssue({
            code: "custom",
            path: ["conflicts"],
            message: "requirement conflict sets require opposite claims for one proposition",
          });
        }
      } else {
        context.addIssue({
          code: "custom",
          path: ["conflicts"],
          message: "conflict sets cannot mix field and requirement evidence",
        });
      }
    }
    for (const item of evidence) {
      if (
        item.conflictSetId &&
        (!conflictIds.has(item.conflictSetId) ||
          !value.conflicts
            .find(({ id }) => id === item.conflictSetId)
            ?.evidenceIds.includes(item.id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["conflicts"],
          message: "evidence references an unknown conflict set",
        });
      }
    }
    for (const item of value.fieldEvidence) {
      for (const inputId of item.derivationInputIds) {
        if (!fieldEvidenceIds.has(inputId) || inputId === item.id) {
          context.addIssue({
            code: "custom",
            path: ["fieldEvidence"],
            message: "derived field evidence must reference another field evidence record",
          });
        }
      }
    }
  });

export type JobEvidenceState = z.infer<typeof JobEvidenceStateSchema>;
export type JobFieldFamily = z.infer<typeof JobFieldFamilySchema>;
export type SourceEvidencePointer = z.infer<typeof SourceEvidencePointerSchema>;
export type R2NormalizedValue = z.infer<typeof R2NormalizedValueSchema>;
export type R2JobFieldEvidence = z.infer<typeof R2JobFieldEvidenceSchema>;
export type R2RequirementEvidence = z.infer<typeof R2RequirementEvidenceSchema>;
export type FieldFamilyCoverage = z.infer<typeof FieldFamilyCoverageSchema>;
export type R2ANormalization = z.infer<typeof R2ANormalizationSchema>;

export function assertR2ASourcePointers(result: R2ANormalization, source: string): void {
  if (result.sourceLength !== source.length) throw new Error("R2A_SOURCE_LENGTH_MISMATCH");
  const pointers = [
    ...result.fieldEvidence.map((item) => item.source),
    ...result.requirementEvidence.map((item) => item.source),
    ...result.coverage.flatMap((item) => item.unparsedSpans),
  ];
  for (const pointer of pointers) {
    if (
      pointer.sourceLength !== source.length ||
      source.slice(pointer.start, pointer.end) !== pointer.excerpt
    ) {
      throw new Error("R2A_SOURCE_POINTER_MISMATCH");
    }
  }
}
