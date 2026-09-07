import { z } from "zod";

import { IMPORT_LIMITS } from "./limits";
import { detectedJobSources } from "./types";
import { RequirementEvidenceSchema } from "@applypilot/job-model";

export const DetectedJobSourceSchema = z.enum(detectedJobSources);
export const AcquisitionMethodSchema = z.enum([
  "USER_SUPPLIED_CONTENT",
  "FILE_UPLOAD",
  "FIXTURE",
  "APPROVED_SOURCE_FETCH",
  "UNKNOWN",
]);
export const ProductionImportAcquisitionMethodSchema = z.enum([
  "USER_SUPPLIED_CONTENT",
  "FILE_UPLOAD",
]);
export const ImportInputTypeSchema = z.enum([
  "PASTED_SINGLE",
  "PASTED_MULTI",
  "PASTED_HTML",
  "FILE_UPLOAD",
  "URL",
]);
export const SplitStatusSchema = z.enum(["CONFIDENT", "REVIEW_REQUIRED", "FAILED"]);
export const SourceConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const ImportWarningSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  field: z.string().min(1).max(100).optional(),
});

const nullableField = z.string().max(IMPORT_LIMITS.maximumFieldLength).nullable();
const nullableHttpsUrl = z
  .url()
  .max(IMPORT_LIMITS.maximumUrlLength)
  .refine((value) => value.startsWith("https://"), "Source URLs must use HTTPS.")
  .nullable();
export const ParsedJobFieldsSchema = z.object({
  externalId: z.string().min(1).max(2048).nullable(),
  sourceUrl: nullableHttpsUrl,
  title: nullableField,
  company: nullableField,
  location: nullableField,
  category: nullableField,
  description: nullableField,
  salaryText: nullableField,
  employmentType: z.enum(["CASUAL", "PART_TIME", "FULL_TIME", "CONTRACT", "INTERNSHIP", "UNKNOWN"]),
  requirements: z.array(z.string().min(1).max(4096)).max(500),
  responsibilities: z.array(z.string().min(1).max(4096)).max(500),
  datePosted: z.iso.datetime().nullable(),
  coverLetterRequired: z.boolean().nullable(),
  beta: z
    .object({
      location: z.object({
        suburb: z.string().min(1).nullable(),
        postcode: z
          .string()
          .regex(/^\d{4}$/)
          .nullable(),
        state: z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]).nullable(),
        country: z.string().min(1),
      }),
      salary: z
        .object({
          minimum: z.number().nonnegative().nullable(),
          maximum: z.number().nonnegative().nullable(),
          currency: z.string().length(3),
          period: z.enum(["HOUR", "WEEK", "FORTNIGHT", "MONTH", "YEAR"]),
          text: z.string().min(1).nullable(),
        })
        .nullable(),
      hoursPerWeek: z
        .object({
          minimum: z.number().nonnegative().nullable(),
          maximum: z.number().nonnegative().nullable(),
        })
        .nullable(),
      hoursPerFortnight: z
        .object({
          minimum: z.number().nonnegative().nullable(),
          maximum: z.number().nonnegative().nullable(),
        })
        .nullable(),
      schedule: z.object({
        summary: z.string().min(1).nullable(),
        fixed: z.boolean().nullable(),
        shifts: z.array(z.any()),
      }),
      preferredRequirements: z.array(z.string().min(1)),
      requiredSkills: z.array(z.string().min(1)),
      experienceRequirements: z.array(
        z.object({
          key: z.string().min(1),
          description: z.string().min(1),
          mandatory: z.boolean(),
          minimumYears: z.number().nonnegative().nullable(),
        }),
      ),
      educationRequirements: z.array(
        z.object({
          description: z.string().min(1),
          mandatory: z.boolean(),
          qualificationKeywords: z.array(z.string().min(1)),
        }),
      ),
      licences: z.array(z.object({ name: z.string().min(1), mandatory: z.boolean() })),
      vehicleRequirement: z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]),
      workRightsRequirement: z.enum([
        "UNRESTRICTED_AUSTRALIA",
        "VALID_AUSTRALIA",
        "NOT_SPECIFIED",
        "UNKNOWN",
      ]),
      physicalRequirements: z.array(z.string().min(1)),
      trainingProvided: z.boolean().nullable(),
      documentRequirements: z.object({
        resume: z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]),
        coverLetter: z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]),
        other: z.array(z.string().min(1)),
      }),
      requirementEvidence: z.array(RequirementEvidenceSchema),
      extractionCoverage: z.object({
        known: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
        ambiguous: z.number().int().nonnegative(),
        percent: z.number().min(0).max(100),
        confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
      warnings: z.array(z.string().min(1)),
    })
    .optional(),
});

export const PrepareJobImportInputSchema = z.object({
  inputType: ImportInputTypeSchema.exclude(["URL"]),
  acquisitionMethod: ProductionImportAcquisitionMethodSchema,
  sourceHint: DetectedJobSourceSchema.nullish(),
  sourceUrl: z.url().max(IMPORT_LIMITS.maximumUrlLength).nullish(),
  originalFilename: z.string().max(IMPORT_LIMITS.maximumFilenameLength).nullish(),
  declaredMimeType: z.string().max(100).nullish(),
});

export const JobFieldEditsSchema = z
  .object({
    externalId: nullableField.optional(),
    sourceUrl: nullableHttpsUrl.optional(),
    title: nullableField.optional(),
    company: nullableField.optional(),
    location: nullableField.optional(),
    category: nullableField.optional(),
    description: nullableField.optional(),
  })
  .strict();
