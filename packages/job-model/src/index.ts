import { z } from "zod";

export const JobSourceSchema = z.enum([
  "SEEK",
  "INDEED",
  "LINKEDIN",
  "EMPLOYMENT_HERO",
  "WORKDAY",
  "GREENHOUSE",
  "LEVER",
  "GENERIC_COMPANY_SITE",
  "FIXTURE",
]);

export const EmploymentTypeSchema = z.enum([
  "CASUAL",
  "PART_TIME",
  "FULL_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "UNKNOWN",
]);

export const ApplicationStatusSchema = z.enum([
  "NEW",
  "REVIEWED",
  "INELIGIBLE",
  "REVIEW_REQUIRED",
  "GOOD_FIT",
  "SHORTLISTED",
  "CV_READY",
  "COVER_LETTER_READY",
  "READY_TO_APPLY",
  "APPLICATION_IN_PROGRESS",
  "APPLIED",
  "ASSESSMENT",
  "INTERVIEW",
  "REJECTED",
  "OFFER",
  "WITHDRAWN",
]);

export const EligibilityStatusSchema = z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]);

const DaySchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

export const JobSchema = z.object({
  id: z.string().min(1),
  externalId: z.string().min(1),
  source: JobSourceSchema,
  sourceUrl: z.url(),
  title: z.string().min(1),
  company: z.string().min(1),
  category: z.string().min(1),
  location: z.string().min(1),
  suburb: z.string().min(1).nullable(),
  postcode: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  state: z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]).nullable(),
  country: z.string().min(1),
  estimatedCommuteKm: z.number().nonnegative().nullable(),
  employmentType: EmploymentTypeSchema,
  casual: z.boolean(),
  partTime: z.boolean(),
  fullTime: z.boolean(),
  contract: z.boolean(),
  internship: z.boolean(),
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
    shifts: z.array(
      z.object({
        day: DaySchema,
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        mandatory: z.boolean(),
      }),
    ),
  }),
  description: z.string().min(1),
  responsibilities: z.array(z.string().min(1)),
  requirements: z.array(z.string().min(1)),
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
  ambiguities: z.array(z.string().min(1)),
  datePosted: z.iso.datetime().nullable(),
  dateDiscovered: z.iso.datetime(),
  dateUpdated: z.iso.datetime().nullable(),
  sourceMetadata: z.record(z.string(), z.unknown()),
  eligibilityStatus: EligibilityStatusSchema.nullable(),
  eligibilityReasons: z.array(z.string()),
  fitScore: z.number().min(0).max(100).nullable(),
  fitReasons: z.array(z.string()),
  applicationStatus: ApplicationStatusSchema,
  documentRequirements: z.object({
    resumeRequired: z.boolean(),
    coverLetterRequired: z.boolean(),
    other: z.array(z.string().min(1)),
  }),
  coverLetterRequired: z.boolean(),
});

export const JobArraySchema = z.array(JobSchema);
export type Job = z.infer<typeof JobSchema>;
export type JobSource = z.infer<typeof JobSourceSchema>;
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type EligibilityStatus = z.infer<typeof EligibilityStatusSchema>;

export function parseJob(input: unknown): Job {
  return JobSchema.parse(input);
}
