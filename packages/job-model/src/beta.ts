import { z } from "zod";

export const RequirementModalitySchema = z.enum([
  "REQUIRED",
  "PREFERRED",
  "CONDITIONAL",
  "UNKNOWN",
  "NEGATED",
]);

export const RequirementKindSchema = z.enum([
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
]);

export const EvidenceCertaintySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const RequirementEvidenceSchema = z.object({
  id: z.string().min(1),
  sourceObservationId: z.string().min(1).nullable(),
  sourcePath: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  originalText: z.string().min(1).max(4096),
  normalizedProposition: z.string().min(1).max(4096),
  modality: RequirementModalitySchema,
  kind: RequirementKindSchema,
  condition: z.string().min(1).max(1000).nullable(),
  certainty: EvidenceCertaintySchema,
  ruleId: z.string().min(1),
  extractorVersion: z.string().min(1),
});

export const JobFieldEvidenceSchema = z.object({
  field: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceObservationId: z.string().min(1).nullable(),
  originalText: z.string().min(1).max(4096),
  normalizedValueJson: z.string().min(1),
  certainty: EvidenceCertaintySchema,
  ruleId: z.string().min(1),
  extractorVersion: z.string().min(1),
});

export const DocumentRequirementStateSchema = z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]);

export const SourceObservationSchema = z.object({
  id: z.string().min(1),
  canonicalJobId: z.string().min(1).nullable(),
  source: z.string().min(1),
  tenant: z.string().min(1).nullable(),
  externalId: z.string().min(1).nullable(),
  sourceUrl: z.url().nullable(),
  acquisitionMethod: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawSnapshotReference: z.string().min(1),
  observedAt: z.iso.datetime(),
  postedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  parserVersion: z.string().min(1),
  policyVersion: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
});

export const EvaluationEvidenceClassSchema = z.enum([
  "LEGAL_LIMIT",
  "CANDIDATE_PREFERENCE",
  "EMPLOYER_REQUIREMENT",
]);

export const EvaluationCoverageSchema = z.object({
  known: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  missingDimensions: z.array(z.string().min(1)),
});

export const DuplicateClusterStateSchema = z.enum(["SUGGESTED", "LINKED", "REJECTED", "SPLIT"]);

export const JobQueueStateSchema = z.enum(["REVIEWING", "SHORTLISTED", "SKIPPED", "PREPARING"]);

export const BetaApplicationStatusSchema = z.enum([
  "DISCOVERED",
  "REVIEWING",
  "SHORTLISTED",
  "PREPARING",
  "READY_TO_APPLY",
  "APPLICATION_IN_PROGRESS",
  "READY_FOR_FINAL_REVIEW",
  "SUBMITTED",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
]);

export const ApplicationRunStateSchema = z.enum([
  "PREPARED",
  "OPENED",
  "MAPPED",
  "FILLED",
  "PAUSED",
  "READY_FOR_FINAL_REVIEW",
  "SYNTHETIC_SUBMITTED",
  "SUBMITTED",
  "OUTCOME_UNKNOWN",
]);

export type RequirementModality = z.infer<typeof RequirementModalitySchema>;
export type RequirementKind = z.infer<typeof RequirementKindSchema>;
export type RequirementEvidence = z.infer<typeof RequirementEvidenceSchema>;
export type JobFieldEvidence = z.infer<typeof JobFieldEvidenceSchema>;
export type SourceObservation = z.infer<typeof SourceObservationSchema>;
export type EvaluationCoverage = z.infer<typeof EvaluationCoverageSchema>;
export type BetaApplicationStatus = z.infer<typeof BetaApplicationStatusSchema>;
export type ApplicationRunState = z.infer<typeof ApplicationRunStateSchema>;
