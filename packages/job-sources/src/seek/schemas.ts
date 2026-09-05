import { z } from "zod";

import { EmploymentTypeSchema } from "@applypilot/job-model";

import {
  NORMALIZATION_WARNING_CODES,
  REQUIREMENT_CLASSIFICATIONS,
  SEEK_ACCESS_MODES,
  SEEK_CAPABILITY_STATES,
  SEEK_ERROR_CODES,
} from "./types";

const AustralianStateSchema = z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const SeekAccessModeSchema = z.enum(SEEK_ACCESS_MODES);
export const SeekCapabilityStateSchema = z.enum(SEEK_CAPABILITY_STATES);
export const SeekErrorCodeSchema = z.enum(SEEK_ERROR_CODES);
export const RequirementClassificationSchema = z.enum(REQUIREMENT_CLASSIFICATIONS);
export const NormalizationWarningCodeSchema = z.enum(NORMALIZATION_WARNING_CODES);

export const RequirementEvidenceSchema = z.object({
  classification: RequirementClassificationSchema,
  originalText: z.string().min(1),
  normalizedText: z.string().min(1),
  ruleId: z.string().min(1),
  sourcePath: z.string().min(1),
  negated: z.boolean(),
});

export const NormalizationWarningSchema = z.object({
  code: NormalizationWarningCodeSchema,
  field: z.string().min(1),
  message: z.string().min(1),
  sourceText: z.string().min(1).nullable(),
});

export const SafeSourceProvenanceSchema = z.object({
  retrievalMethod: z.enum([
    "FIXTURE",
    "USER_SUPPLIED_CONTENT",
    "PUBLIC_INTERFACE",
    "PUBLIC_PAGE",
    "ASSISTED_BROWSER",
  ]),
  contentType: z.string().min(1),
  sourceReference: z.string().min(1),
  fieldSources: z.record(z.string(), z.string()).default({}),
});

export const SeekCapabilityStatusSchema = z.object({
  mode: SeekAccessModeSchema,
  state: SeekCapabilityStateSchema,
  capabilities: z.array(z.enum(["DISCOVERY", "JOB_DETAILS"])),
  networkAccess: z.boolean(),
  reason: z.string().min(1),
});

export const SeekDiscoveryQuerySchema = z
  .object({
    keywords: z.array(z.string().trim().min(1)).default([]),
    locations: z.array(z.string().trim().min(1)).default([]),
    location: z
      .object({
        text: z.string().trim().min(1).optional(),
        suburb: z.string().trim().min(1).optional(),
        postcode: z
          .string()
          .regex(/^\d{4}$/)
          .optional(),
        state: AustralianStateSchema.optional(),
        radiusKm: z.number().int().min(0).max(250).optional(),
      })
      .optional(),
    employmentTypes: z.array(EmploymentTypeSchema.exclude(["UNKNOWN"])).default([]),
    datePostedWithinDays: z.number().int().positive().max(365).optional(),
    sortOrder: z.enum(["RELEVANCE", "DATE_POSTED"]).default("RELEVANCE"),
    pageCursor: z.string().min(1).optional(),
    pageSize: z.number().int().positive().max(100).default(20),
  })
  .superRefine((query, context) => {
    if (
      query.location?.radiusKm !== undefined &&
      !query.location.postcode &&
      !query.location.suburb &&
      !query.location.text
    ) {
      context.addIssue({
        code: "custom",
        path: ["location", "radiusKm"],
        message: "A radius requires a postcode, suburb, or location text",
      });
    }
  });

export const SeekCursorSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("SEEK"),
  mode: SeekAccessModeSchema,
  queryHash: Sha256Schema,
  pageNumber: z.number().int().nonnegative(),
  sourceCursor: z.string().min(1).nullable(),
  previousPageHash: Sha256Schema.nullable(),
});

export const SeekRunCountsSchema = z.object({
  discovered: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const SeekCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  source: z.literal("SEEK"),
  mode: SeekAccessModeSchema,
  queryHash: Sha256Schema,
  nextCursor: z.string().min(1).nullable(),
  lastSuccessfulFetchAt: z.iso.datetime(),
  lastCommittedPage: z.number().int().nonnegative(),
  processedPageHashes: z.array(Sha256Schema).max(100),
  counts: SeekRunCountsSchema,
  expiresAt: z.iso.datetime(),
});

const SeekRawLocationSchema = z.object({
  text: z.string().trim().min(1).nullable(),
  suburb: z.string().trim().min(1).nullable().default(null),
  postcode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .default(null),
  state: AustralianStateSchema.nullable().default(null),
  country: z.string().trim().min(1).nullable().default(null),
});

const RawRecordShape = {
  schemaVersion: z.literal(1),
  parserVersion: z.string().min(1),
  source: z.literal("SEEK"),
  accessMode: SeekAccessModeSchema,
  externalId: z.string().trim().min(1),
  canonicalUrl: z.url(),
  sourcePageUrl: z.url().nullable().default(null),
  title: z.string().trim().min(1).nullable(),
  company: z.string().trim().min(1).nullable().default(null),
  advertiser: z.string().trim().min(1).nullable().default(null),
  location: SeekRawLocationSchema,
  salaryText: z.string().trim().min(1).nullable().default(null),
  employmentTypeText: z.string().trim().min(1).nullable().default(null),
  workType: z.string().trim().min(1).nullable().default(null),
  classification: z.string().trim().min(1).nullable().default(null),
  subclassification: z.string().trim().min(1).nullable().default(null),
  postingText: z.string().trim().min(1).nullable().default(null),
  postingDate: z.string().trim().min(1).nullable().default(null),
  description: z.string().trim().min(1).nullable(),
  responsibilities: z.array(z.string().trim().min(1)).default([]),
  requirementTexts: z.array(z.string().trim().min(1)).default([]),
  requiredSkills: z.array(z.string().trim().min(1)).default([]),
  scheduleText: z.string().trim().min(1).nullable().default(null),
  hoursText: z.string().trim().min(1).nullable().default(null),
  coverLetterRequired: z.boolean().nullable().default(null),
  discoveredAt: z.iso.datetime(),
  fetchedAt: z.iso.datetime(),
  rawPayload: z.unknown(),
  provenance: SafeSourceProvenanceSchema,
  normalizationWarnings: z.array(NormalizationWarningSchema).default([]),
  unknownFields: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["ACTIVE", "REMOVED"]).default("ACTIVE"),
};

export const SeekRawJobRecordInputSchema = z
  .object({
    ...RawRecordShape,
    rawPayloadHash: Sha256Schema.optional(),
  })
  .passthrough();

export const SeekRawJobRecordSchema = z.object({
  ...RawRecordShape,
  rawPayloadHash: Sha256Schema,
});

export const SeekFixtureFileSchema = z.object({
  record: SeekRawJobRecordInputSchema,
  distanceKmFrom3072: z.number().nonnegative(),
  expected: z.object({
    outcome: z.enum(["NORMALIZED", "ERROR", "REMOVED"]),
    employmentType: EmploymentTypeSchema.optional(),
    workRightsRequirement: z
      .enum(["UNRESTRICTED_AUSTRALIA", "VALID_AUSTRALIA", "NOT_SPECIFIED", "UNKNOWN"])
      .optional(),
    requirementClassifications: z.array(RequirementClassificationSchema).default([]),
    errorCode: SeekErrorCodeSchema.optional(),
  }),
});

export type SeekDiscoveryQuery = z.infer<typeof SeekDiscoveryQuerySchema>;
export type SeekCursor = z.infer<typeof SeekCursorSchema>;
export type SeekCheckpoint = z.infer<typeof SeekCheckpointSchema>;
export type SeekRawJobRecordInput = z.infer<typeof SeekRawJobRecordInputSchema>;
export type SeekRawJobRecord = z.infer<typeof SeekRawJobRecordSchema>;
export type SeekFixtureFile = z.infer<typeof SeekFixtureFileSchema>;
