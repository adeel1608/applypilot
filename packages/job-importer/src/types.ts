export const detectedJobSources = [
  "SEEK",
  "INDEED",
  "EMPLOYMENT_HERO",
  "GREENHOUSE",
  "LEVER",
  "WORKDAY",
  "GENERIC_COMPANY_SITE",
  "UNKNOWN",
] as const;

export type DetectedJobSource = (typeof detectedJobSources)[number];
export type BatchDetectedSource = DetectedJobSource | "MIXED";
export type AcquisitionMethod =
  | "USER_SUPPLIED_CONTENT"
  | "FILE_UPLOAD"
  | "FIXTURE"
  | "APPROVED_SOURCE_FETCH"
  | "UNKNOWN";
export type ImportInputType =
  | "PASTED_SINGLE"
  | "PASTED_MULTI"
  | "PASTED_HTML"
  | "FILE_UPLOAD"
  | "URL";
export type SplitStatus = "CONFIDENT" | "REVIEW_REQUIRED" | "FAILED";
export type SourceConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ImportWarning {
  code: string;
  message: string;
  field?: string;
}

export interface SourceDetection {
  source: DetectedJobSource;
  confidence: SourceConfidence;
  ruleIds: string[];
  evidence: string[];
  conflicts: string[];
}

export interface RawImportedJobDocument {
  importId: string;
  inputType: ImportInputType;
  acquisitionMethod: "USER_SUPPLIED_CONTENT" | "FILE_UPLOAD";
  sourceHint: DetectedJobSource | null;
  detectedSource: BatchDetectedSource;
  originalFilename: string | null;
  sourceUrl: string | null;
  contentHash: string;
  createdAt: string;
  parserVersion: string;
  contentLength: number;
  detectedJobs: number;
  warnings: ImportWarning[];
  /** LOCAL_PRIVATE: never include this field in client or audit DTOs. */
  content: string;
}

export interface SanitizedImportContent {
  kind: "TEXT" | "HTML" | "JSON";
  text: string;
  structuredRecords: Array<Record<string, unknown>>;
  links: string[];
  warnings: ImportWarning[];
}

export interface SplitImportedJobRecord {
  id: string;
  ordinal: number;
  status: SplitStatus;
  text: string;
  structured: Record<string, unknown> | null;
  start: number | null;
  end: number | null;
  contentHash: string;
  boundaryRuleIds: string[];
  warnings: ImportWarning[];
}

export interface SplitImportResult {
  status: SplitStatus;
  records: SplitImportedJobRecord[];
  warnings: ImportWarning[];
}

export interface ParsedJobFields {
  externalId: string | null;
  sourceUrl: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  category: string | null;
  description: string | null;
  salaryText: string | null;
  employmentType: "CASUAL" | "PART_TIME" | "FULL_TIME" | "CONTRACT" | "INTERNSHIP" | "UNKNOWN";
  requirements: string[];
  responsibilities: string[];
  datePosted: string | null;
  coverLetterRequired: boolean | null;
}

export type EditableImportField =
  | "externalId"
  | "sourceUrl"
  | "title"
  | "company"
  | "location"
  | "category"
  | "description";

export type JobFieldEdits = Partial<Record<EditableImportField, string | null>>;

export interface ImportedJobDraft {
  recordId: string;
  ordinal: number;
  splitStatus: SplitStatus;
  sourceDetection: SourceDetection;
  fields: ParsedJobFields;
  originalExtractedFields: ParsedJobFields;
  extractionRuleIds: string[];
  contentHash: string;
  excerpt: string;
  warnings: ImportWarning[];
}

export interface PreparedJobImport {
  document: RawImportedJobDocument;
  splitStatus: SplitStatus;
  records: ImportedJobDraft[];
}

export interface PrepareJobImportInput {
  inputType: Exclude<ImportInputType, "URL">;
  acquisitionMethod: "USER_SUPPLIED_CONTENT" | "FILE_UPLOAD";
  content: string | Uint8Array;
  sourceHint?: DetectedJobSource | null;
  sourceUrl?: string | null;
  originalFilename?: string | null;
  declaredMimeType?: string | null;
}

export type UrlPolicyDecision =
  | "FETCH_ALLOWED"
  | "USER_CONTENT_REQUIRED"
  | "UNSUPPORTED"
  | "REVIEW_REQUIRED";

export interface UrlPolicyResult {
  decision: UrlPolicyDecision;
  detectedSource: DetectedJobSource;
  reasonCode: string;
  policyVersion: string;
  normalizedUrl: string | null;
}

export type IdentityKind = "EXTERNAL_ID" | "CANONICAL_URL" | "CONTENT_HASH" | "LOCAL_FINGERPRINT";

export interface JobIdentity {
  kind: IdentityKind;
  value: string;
}
