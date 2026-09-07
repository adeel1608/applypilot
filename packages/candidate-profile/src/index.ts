import { z } from "zod";

import { normalizeText, VerificationStatus } from "@applypilot/shared";

export const VerificationStatusSchema = z.enum(VerificationStatus);

export function profileFactSchema<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    verification: VerificationStatusSchema,
    source: z.string().min(1).optional(),
    verifiedAt: z.iso.datetime().optional(),
  });
}

export type ProfileFact<T> = {
  value: T;
  verification: z.infer<typeof VerificationStatusSchema>;
  source?: string;
  verifiedAt?: string;
};

const verifiedStringFact = profileFactSchema(z.string().min(1));
const optionalStringFact = profileFactSchema(z.string());

export const VerifiedAchievementSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  evidence: z.string().min(1),
  verification: z.literal(VerificationStatus.VERIFIED),
});

export const CandidateProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileId: z.string().min(1),
    displayNameTemplate: z.string().min(1).default("{firstName} {lastName}"),
    documentFileNameTemplate: z.string().min(1).default("{firstNameUpper} CV ({company}).pdf"),
    identity: z.object({
      firstName: verifiedStringFact,
      lastName: verifiedStringFact,
      preferredName: optionalStringFact.optional(),
    }),
    contact: z.object({
      email: profileFactSchema(z.email()),
      phone: verifiedStringFact,
      linkedInUrl: profileFactSchema(z.url()).optional(),
      portfolioUrl: profileFactSchema(z.url()).optional(),
    }),
    location: z.object({
      suburb: verifiedStringFact,
      postcode: profileFactSchema(z.string().regex(/^\d{4}$/)),
      state: profileFactSchema(z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"])),
      country: verifiedStringFact,
    }),
    education: z.array(
      z.object({
        id: z.string().min(1),
        institution: z.string().min(1),
        qualification: z.string().min(1),
        field: z.string().min(1),
        status: z.enum(["COMPLETED", "IN_PROGRESS", "DEFERRED", "WITHDRAWN"]),
        startDate: z.iso.date().optional(),
        endDate: z.iso.date().optional(),
        verification: VerificationStatusSchema,
      }),
    ),
    employment: z.array(
      z.object({
        id: z.string().min(1),
        employer: z.string().min(1),
        title: z.string().min(1),
        location: z.string().min(1).optional(),
        startDate: z.iso.date(),
        endDate: z.iso.date().optional(),
        responsibilities: z.array(z.string().min(1)),
        achievementIds: z.array(z.string().min(1)).default([]),
        verification: VerificationStatusSchema,
      }),
    ),
    projects: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          summary: z.string().min(1),
          bullets: z.array(z.string().min(1)),
          skills: z.array(z.string().min(1)).default([]),
          verification: VerificationStatusSchema,
        }),
      )
      .default([]),
    verifiedAchievements: z.array(VerifiedAchievementSchema),
    skills: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        level: z.enum(["FOUNDATIONAL", "WORKING", "PROFICIENT", "ADVANCED"]).optional(),
        evidence: z.string().min(1).optional(),
        verification: VerificationStatusSchema,
      }),
    ),
    languages: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        proficiency: z.enum(["BASIC", "CONVERSATIONAL", "PROFESSIONAL", "NATIVE"]),
        verification: VerificationStatusSchema,
      }),
    ),
    licences: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        jurisdiction: z.string().min(1).optional(),
        expiresOn: z.iso.date().optional(),
        verification: VerificationStatusSchema,
      }),
    ),
    certifications: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        issuer: z.string().min(1).optional(),
        expiresOn: z.iso.date().optional(),
        verification: VerificationStatusSchema,
      }),
    ),
    workRights: profileFactSchema(
      z.object({
        country: z.string().min(1),
        status: z.enum(["UNRESTRICTED", "RESTRICTED", "NONE", "UNKNOWN"]),
        maximumHoursPerFortnight: z.number().positive().nullable(),
        notes: z.string().optional(),
      }),
    ),
    availability: z.object({
      timezone: z.string().min(1),
      recurring: z.array(
        z.object({
          day: z.enum([
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ]),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          available: z.boolean(),
          verification: VerificationStatusSchema,
        }),
      ),
      fixedCommitments: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          day: z.enum([
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ]),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          verification: VerificationStatusSchema,
        }),
      ),
      dateWindows: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            startDate: z.iso.date(),
            endDate: z.iso.date(),
            available: z.boolean(),
            verification: VerificationStatusSchema,
          }),
        )
        .optional(),
    }),
    transport: z.object({
      vehicleAccess: profileFactSchema(z.boolean()),
      modes: z.array(z.enum(["WALK", "BICYCLE", "PUBLIC_TRANSPORT", "CAR", "OTHER"])),
      maximumCommuteKm: profileFactSchema(z.number().nonnegative()),
      maximumCommuteMinutes: profileFactSchema(z.number().int().nonnegative()).optional(),
    }),
    preferences: z.object({
      preferredLocations: z.array(z.string().min(1)),
      preferredWorkTypes: z.array(
        z.enum(["CASUAL", "PART_TIME", "FULL_TIME", "CONTRACT", "INTERNSHIP"]),
      ),
      preferredCategories: z.array(z.string().min(1)),
      maximumHoursPerWeek: profileFactSchema(z.number().positive()),
      maximumHoursPerFortnight: profileFactSchema(z.number().positive()),
      earliestStartDate: profileFactSchema(z.iso.date()).optional(),
      salaryExpectation: profileFactSchema(z.string().min(1)).optional(),
      signalVerification: z
        .object({
          preferredLocations: VerificationStatusSchema,
          preferredWorkTypes: VerificationStatusSchema,
          preferredCategories: VerificationStatusSchema,
        })
        .optional(),
    }),
    unsupportedExperience: z.array(z.string().min(1)),
    forbiddenClaims: z.array(z.string().min(1)),
    referees: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        relationship: z.string().min(1),
        contact: z.string().min(1).optional(),
        verification: VerificationStatusSchema,
        private: z.boolean().default(true),
      }),
    ),
    candidatePreferences: z.object({
      coverLetterTone: z.enum(["DIRECT", "WARM", "FORMAL"]),
      includeRefereesOnResume: z.boolean().default(false),
      requireDocumentPreview: z.literal(true),
      requireFinalSubmissionConfirmation: z.literal(true),
    }),
  })
  .superRefine((profile, context) => {
    const achievementIds = new Set(profile.verifiedAchievements.map(({ id }) => id));
    for (const role of profile.employment) {
      for (const achievementId of role.achievementIds) {
        if (!achievementIds.has(achievementId)) {
          context.addIssue({
            code: "custom",
            message: `Employment ${role.id} references unknown achievement ${achievementId}`,
            path: ["employment"],
          });
        }
      }
    }
  });

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export function parseCandidateProfile(input: unknown): CandidateProfile {
  return CandidateProfileSchema.parse(input);
}

export function isVerified<T>(fact: ProfileFact<T> | undefined): fact is ProfileFact<T> {
  return fact?.verification === VerificationStatus.VERIFIED;
}

export function verifiedSkillNames(profile: CandidateProfile): string[] {
  return profile.skills
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .map(({ name }) => name);
}

export function verifiedLicenceNames(profile: CandidateProfile): string[] {
  return profile.licences
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .map(({ name }) => name);
}

export function verifiedQualificationNames(profile: CandidateProfile): string[] {
  return profile.education
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .flatMap(({ qualification, field }) => [qualification, field]);
}

export function isExplicitlyUnsupported(profile: CandidateProfile, claim: string): boolean {
  const normalizedClaim = normalizeText(claim);
  return [...profile.unsupportedExperience, ...profile.forbiddenClaims].some((item) => {
    const normalizedItem = normalizeText(item);
    return normalizedItem.includes(normalizedClaim) || normalizedClaim.includes(normalizedItem);
  });
}

export function verifiedCandidateName(profile: CandidateProfile): string | null {
  if (!isVerified(profile.identity.firstName) || !isVerified(profile.identity.lastName)) {
    return null;
  }
  return `${profile.identity.firstName.value} ${profile.identity.lastName.value}`;
}

export * from "./runtime";
