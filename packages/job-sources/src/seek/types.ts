import type { Job } from "@applypilot/job-model";

export const SEEK_ACCESS_MODES = [
  "FIXTURE_ONLY",
  "PUBLIC_DISCOVERY",
  "PUBLIC_JOB_DETAILS",
  "ASSISTED_BROWSER",
  "USER_SUPPLIED_URL",
  "USER_SUPPLIED_CONTENT",
] as const;

export type SeekAccessMode = (typeof SEEK_ACCESS_MODES)[number];

export const SEEK_CAPABILITY_STATES = [
  "AVAILABLE",
  "DISABLED",
  "REQUIRES_REVIEW",
  "SECURITY_STOP",
] as const;

export type SeekCapabilityState = (typeof SEEK_CAPABILITY_STATES)[number];

export const REQUIREMENT_CLASSIFICATIONS = [
  "EXPLICIT_REQUIREMENT",
  "PREFERRED_REQUIREMENT",
  "AMBIGUOUS_REQUIREMENT",
] as const;

export type RequirementClassification = (typeof REQUIREMENT_CLASSIFICATIONS)[number];

export const SEEK_ERROR_CODES = [
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "CAPTCHA_DETECTED",
  "BOT_PROTECTION",
  "ACCESS_DENIED",
  "PAGE_CHANGED",
  "NETWORK_ERROR",
  "MALFORMED_RESPONSE",
  "JOB_REMOVED",
  "NOT_FOUND",
  "UNSUPPORTED_PAGE",
  "RETRYABLE_SERVER_ERROR",
  "NON_RETRYABLE_ERROR",
  "DUPLICATE_PAGE",
  "CHECKPOINT_MISMATCH",
] as const;

export type SeekErrorCode = (typeof SEEK_ERROR_CODES)[number];

export const NORMALIZATION_WARNING_CODES = [
  "AMBIGUOUS_DATE",
  "INVALID_EXPLICIT_DATE",
  "UNPARSED_SALARY",
  "UNPARSED_HOURS",
  "UNKNOWN_EMPLOYMENT_TYPE",
  "UNKNOWN_LOCATION_PARTS",
  "MISSING_REQUIREMENTS",
] as const;

export type NormalizationWarningCode = (typeof NORMALIZATION_WARNING_CODES)[number];

export interface RequirementEvidence {
  classification: RequirementClassification;
  originalText: string;
  normalizedText: string;
  ruleId: string;
  sourcePath: string;
  negated: boolean;
}

export interface NormalizationWarning {
  code: NormalizationWarningCode;
  field: string;
  message: string;
  sourceText: string | null;
}

export interface SafeSourceProvenance {
  retrievalMethod:
    | "FIXTURE"
    | "USER_SUPPLIED_CONTENT"
    | "PUBLIC_INTERFACE"
    | "PUBLIC_PAGE"
    | "ASSISTED_BROWSER";
  contentType: string;
  sourceReference: string;
  fieldSources: Record<string, string>;
}

export interface SeekCapabilityStatus {
  mode: SeekAccessMode;
  state: SeekCapabilityState;
  capabilities: Array<"DISCOVERY" | "JOB_DETAILS">;
  networkAccess: boolean;
  reason: string;
}

export interface SeekRunCounts {
  discovered: number;
  added: number;
  updated: number;
  duplicates: number;
  failed: number;
}

export interface SeekPersistenceItem<TRaw> {
  record: TRaw;
  job: Job;
}

export interface SeekPersistenceOutcome {
  added: number;
  updated: number;
  duplicates: number;
}

export type SafeAuditValue = string | number | boolean | null;

export interface SeekAuditEvent {
  eventType:
    | "discovery.run.started"
    | "discovery.page.completed"
    | "discovery.job.added"
    | "discovery.job.updated"
    | "discovery.job.duplicate"
    | "discovery.job.failed"
    | "discovery.rate_limited"
    | "discovery.security_stopped"
    | "discovery.run.partial"
    | "discovery.run.completed";
  runId: string;
  occurredAt: string;
  metadata: Record<string, SafeAuditValue>;
}
