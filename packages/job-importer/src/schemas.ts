import { z } from "zod";

import { IMPORT_LIMITS } from "./limits";
import { detectedJobSources } from "./types";

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
